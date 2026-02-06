from pathlib import Path

import tqdm
import torch
from loguru import logger

PROJ_ROOT = Path(__file__).resolve().parents[1]
logger.info(f"PROJ_ROOT path is: {PROJ_ROOT}")

MODELS_DIR = PROJ_ROOT / "models"
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
logger.info(f"{torch.cuda.get_device_name()=}" if torch.cuda.is_available() else "cpu")


logger.remove(0)
logger.add(lambda msg: tqdm.write(msg, end=""), colorize=True)
