import asyncio
from dataclasses import dataclass
from enum import StrEnum
from functools import partial
from wings.modeling.unet import UNet
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from loguru import logger

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
    FULL_ROTATION_MULTISTART_ANGLES,
)

models = {}


class WingModel(StrEnum):
    """Landmark models a request can choose from (the `model` form field)."""

    precise = "precise"
    rotation = "rotation"


@dataclass(frozen=True)
class ModelSpec:
    checkpoint: str
    # Keyword arguments for handle_coordinates. Its reflection allowance is also
    # used by the residual check in process_image, so that check is never more
    # lenient than the matching it judges.
    gpa: dict


MODEL_SPECS = {
    # Trained without augmentation: it only ever saw upright wings of a single
    # chirality, so landmarks are matched by rotation alone -- handle_coordinates'
    # defaults, which is also how the bees evaluation runs this checkpoint. A
    # mirrored or rotated wing simply comes out flagged (check_carefully).
    WingModel.precise: ModelSpec("final-precise.ckpt", {}),
    WingModel.rotation: ModelSpec(
        "final-rotation-2.ckpt",
        # allow_reflection=True: the model may detect landmarks on a
        # horizontally-mirrored wing too, which a rotation-only match can't
        # align correctly against mean_coords even when detection itself is
        # fine. multistart_angles/pca_prealign: a real uploaded photo could
        # be rotated by any amount -- without these, the correspondence
        # search can get stuck in a wrong landmark ordering near hard angles
        # like 90 degrees even though detection itself is accurate.
        {
            "allow_reflection": True,
            "multistart_angles": FULL_ROTATION_MULTISTART_ANGLES,
            "pca_prealign": True,
        },
    ),
}
DEFAULT_MODEL = WingModel.rotation


def load_net(checkpoint: str, device: torch.device) -> LitNet:
    unet_model = UNet(in_channels=1, out_channels=1, kernel_size=5)
    return (
        LitNet.load_from_checkpoint(
            MODELS_DIR / checkpoint,
            model=unet_model,
            criterion=BCEDiceLoss(),
            num_epochs=60,
            strict=False,
        )
        .to(device)
        .eval()
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # Every model is loaded once, here, and stays in memory while the server runs.
    nets = {
        name: load_net(spec.checkpoint, device) for name, spec in MODEL_SPECS.items()
    }

    mean_coords = torch.load(MODELS_DIR / "mean_shape.pth", weights_only=False)

    preprocess = partial(unet_fit_rectangle_preprocess, output_size=400)

    models["device"] = device
    models["nets"] = nets
    models["shape"] = mean_coords
    models["preprocess"] = preprocess
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/")
def root():
    return {"Hello": "WingAI"}


def process_image(image, model_name: WingModel):
    spec = MODEL_SPECS[model_name]

    try:
        image_tensor, x_size, y_size = load_image(image, models["preprocess"])
    except Exception as e:
        raise LoadImageError("Failed to load image") from e

    with torch.inference_mode():
        output = models["nets"][model_name](
            image_tensor.to(models["device"]).unsqueeze(0)
        )
    mask = torch.round(output).squeeze().detach().cpu().numpy()

    mask_coords = final_coords(mask, x_size, y_size)
    mask_coords = torch.tensor(mask_coords)
    check_carefully = len(mask_coords) < 19 or len(mask_coords) > 22

    try:
        # Matching options are per model, see MODEL_SPECS.
        coordinates = handle_coordinates(mask_coords, models["shape"], **spec.gpa)
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
        # Same reflection allowance as the matching above: where it is allowed,
        # coordinates may still be in a mirrored spatial arrangement even after
        # correct identity matching; where it isn't, a mirrored arrangement means
        # the matching failed and has to stay flagged.
        gpa = procrustes_align(
            normalize_shape(center_shape(coordinates)),
            models["shape"],
            allow_reflection=spec.gpa.get("allow_reflection", False),
        )
        gpa_vals = torch.linalg.norm(models["shape"] - gpa, dim=1)
        check_carefully = gpa_vals.max().item() > 0.04

    # Orientation relative to mean_shape's own chirality: the best rotation-
    # or-reflection alignment to mean_shape needing a reflection (det<0)
    # means this wing is mirrored relative to mean_shape ("left"); a plain
    # rotation fitting as well or better (det>0) means it already shares
    # mean_shape's chirality ("right"). Computed unconditionally (even when
    # check_carefully is True) so the caller can decide whether to trust it
    # alongside that flag, rather than silently omitting it on uncertain
    # detections. (A model matched without reflection, i.e. precise, can't
    # identify landmarks on a mirrored wing, so its value is only meaningful
    # when check_carefully is False.)
    r = procrustes_align(
        normalize_shape(center_shape(coordinates)), models["shape"],
        only_matrix=True, allow_reflection=True,
    )
    orientation = "left" if torch.det(r).item() < 0 else "right"

    coordinates[:, 1] = y_size - coordinates[:, 1] - 1
    coordinates = coordinates.detach().flatten().tolist()

    return coordinates, check_carefully, orientation


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    x_size: int = Form(...),
    y_size: int = Form(...),
    model: WingModel = Form(DEFAULT_MODEL),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")

    encoded = torch.frombuffer(bytearray(raw), dtype=torch.uint8)

    loop = asyncio.get_event_loop()
    try:
        coords, check, orientation = await loop.run_in_executor(
            None, process_image, encoded, model
        )
    except LoadImageError:
        raise HTTPException(
            status_code=422, detail="Could not decode the uploaded image."
        )
    except Exception:
        logger.exception(f"Image analysis failed for {file.filename!r}")
        raise HTTPException(status_code=500, detail="Image analysis failed.")

    return JSONResponse(
        content={"coords": coords, "check": check, "orientation": orientation}
    )


class LoadImageError(Exception):
    """Raised when loading an image fails."""

    pass
