from functools import partial
from wings.modeling.unet import UNet
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse

import torch
from contextlib import asynccontextmanager

from wings.modeling.litnet import LitNet
from wings.modeling.loss import BCEDiceLoss
from wings.config import MODELS_DIR

from wings.utils import load_image
from wings.image_preprocess import (
    unet_fit_rectangle_preprocess,
    final_coords,
)
from wings.gpa import (
    handle_coordinates,
    procrustes_align,
    normalize_shape,
    center_shape,
)


models = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    kernel_size = 5
    checkpoint_path = MODELS_DIR / f"unet-final-k{kernel_size}.ckpt"

    unet_model = UNet(in_channels=1, out_channels=1, kernel_size=kernel_size)
    model = (
        LitNet.load_from_checkpoint(
            checkpoint_path,
            model=unet_model,
            criterion=BCEDiceLoss(),
            num_epochs=60,
            strict=False,
        )
        .to(device)
        .eval()
    )

    mean_coords = torch.load(MODELS_DIR / "mean_shape.pth", weights_only=False)

    preprocess = partial(unet_fit_rectangle_preprocess, output_size=400)

    models["device"] = device
    models["model"] = model
    models["shape"] = mean_coords
    models["preprocess"] = preprocess
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/")
def root():
    return {"Hello": "WingAI"}


def process_image(image):
    try:
        image_tensor, x_size, y_size = load_image(image, models["preprocess"])
    except Exception as e:
        raise LoadImageError("Failed to load image") from e

    output = models["model"](image_tensor.to(models["device"]).unsqueeze(0))
    mask = torch.round(output).squeeze().detach().cpu().numpy()

    mask_coords = final_coords(mask, x_size, y_size)
    mask_coords = torch.tensor(mask_coords)
    check_carefully = len(mask_coords) < 19 or len(mask_coords) > 22

    try:
        coordinates = handle_coordinates(mask_coords, models["shape"])
        # coordinates[:, 1] = y_size - coordinates[:, 1] - 1
        # coordinates = coordinates.detach().flatten().long().tolist()
    except Exception:
        check_carefully = True
        if len(mask_coords) > 19:
            mask_coords = mask_coords[:19]
        elif len(mask_coords) < 19:
            missing_points = 19 - len(mask_coords)
            xmin, ymin = 0, 0
            xmax, ymax = x_size, y_size
            random_x = torch.empty(missing_points).uniform_(xmin, xmax)
            random_y = torch.empty(missing_points).uniform_(ymin, ymax)
            random_points = torch.stack([random_x, random_y], dim=1)
            mask_coords = torch.cat([mask_coords, random_points], dim=0)
        coordinates = mask_coords

    if not check_carefully:
        gpa = procrustes_align(
            normalize_shape(center_shape(coordinates)), models["shape"]
        )
        gpa_vals = torch.linalg.norm(models["shape"] - gpa, dim=1)
        check_carefully = gpa_vals.max().item() > 0.04

    coordinates[:, 1] = y_size - coordinates[:, 1] - 1
    coordinates = coordinates.detach().flatten().tolist()

    return coordinates, check_carefully


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...), x_size: int = Form(...), y_size: int = Form(...)
):
    raw = await file.read()
    encoded = torch.frombuffer(bytearray(raw), dtype=torch.uint8)

    coords, check = process_image(encoded)
    return JSONResponse(content={"coords": coords, "check": check})


class LoadImageError(Exception):
    """Raised when loading an image fails."""

    pass
