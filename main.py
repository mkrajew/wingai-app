from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse

import torch
from contextlib import asynccontextmanager

from wings.modeling.litnet import LitNet
from wings.modeling.loss import DiceLoss
from wings.config import MODELS_DIR

from wings.utils import load_image
from wings.visualizing.image_preprocess import (
    unet_fit_rectangle_preprocess,
    final_coords,
)
from wings.gpa import handle_coordinates


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


@app.get("/")
def root():
    return {"Hello": "WingAI"}


def process_image(image, x_size, y_size):
    image_tensor, _, _ = load_image(image, unet_fit_rectangle_preprocess)
    image_tensor = image_tensor

    output = models["model"](image_tensor.to(models["device"]).unsqueeze(0))
    mask = torch.round(output).squeeze().detach().cpu().numpy()

    mask_coords = final_coords(mask, x_size, y_size)
    mask_coords = torch.tensor(mask_coords)

    coordinates = handle_coordinates(mask_coords, models["shape"]).detach().tolist()

    return coordinates


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...), x_size: int = Form(...), y_size: int = Form(...)
):
    raw = await file.read()
    encoded = torch.frombuffer(raw, dtype=torch.uint8)

    coords = process_image(encoded, x_size, y_size)
    return JSONResponse(content={"coords": coords})
