from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

import torch
from contextlib import asynccontextmanager

from wings.modeling.litnet import LitNet
from wings.modeling.loss import DiceLoss
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
    checkpoint_path = MODELS_DIR / "unet.ckpt"

    unet_model = torch.hub.load(
        "mateuszbuda/brain-segmentation-pytorch",
        "unet",
        in_channels=3,
        out_channels=1,
        init_features=32,
        pretrained=False,
        trust_repo=True,
    )
    model = (
        LitNet.load_from_checkpoint(
            checkpoint_path, model=unet_model, num_epochs=60, criterion=DiceLoss()
        )
        .to(device)
        .eval()
    )

    mean_coords = torch.load(MODELS_DIR / "mean_shape.pth", weights_only=False)

    models["device"] = device
    models["model"] = model
    models["shape"] = mean_coords
    yield


app = FastAPI(lifespan=lifespan)
origins = [
    "http://localhost:5173",
    "https://localhost:5173",
    "http://127.0.0.1:5173",
    "https://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"Hello": "WingAI"}


def process_image(image, x_size, y_size):
    try:
        image_tensor, _, _ = load_image(image, unet_fit_rectangle_preprocess)
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
    coordinates = coordinates.detach().flatten().long().tolist()

    return coordinates, check_carefully


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...), x_size: int = Form(...), y_size: int = Form(...)
):
    raw = await file.read()
    encoded = torch.frombuffer(raw, dtype=torch.uint8)

    coords, check = process_image(encoded, x_size, y_size)
    return JSONResponse(content={"coords": coords, "check": check})


class LoadImageError(Exception):
    """Raised when loading an image fails."""

    pass
