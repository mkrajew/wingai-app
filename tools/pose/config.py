"""Paths and constants of the pose tools (tools/pose)."""
import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO / "backend"

# The bees data lives outside this repository. Override the folder with the BEES_DATA environment variable.
BEES_DATA = Path(os.environ.get("BEES_DATA", Path.home() / "projects" / "bees" / "data"))
CROPPED = BEES_DATA / "processed" / "cropped"  # <CC>-wing-images/ and <CC>-raw-coordinates.csv (manual landmarks)
RAW = BEES_DATA / "raw"
RAW_SETS = {
    "swietokrzyskie": RAW / "skrzydełka 2026 świętokrzyskie",
    "bm": RAW / "skrzydła-BM",
    "pulawy": RAW / "pulawy",
}
BACKEND_URL = os.environ.get("WINGAI_BACKEND", "http://127.0.0.1:8000")

# Big generated files (git-ignored)
WORK = Path(os.environ.get("POSE_WORK", Path(__file__).resolve().parent / "work"))

# The working size of a wing picture. A crop is shrunk to this before anything is measured. 256 x 96 is
# divisible by the cell sizes that are tried (8, 16, 32 px), so a flip of the picture is an exact permutation of the cells.
W, H = 256, 96

# The four poses a straightened crop can have. The crop is only rotated, never mirrored, and its long axis is horizontal.
# Canonical pose = the pose of the mean shape of the backend: the base of the wing on the RIGHT, the tip on the LEFT and
# the thick leading-edge vein at the TOP (see frontend/src/utils/wingPose.ts).
POSES = ("id", "rot180", "flipH", "flipV")
# (x, y): x = +1 when the base is on the right, y = +1 when the thick vein is at the top
POSE_XY = {"id": (1, 1), "rot180": (-1, -1), "flipH": (-1, 1), "flipV": (1, -1)}
XY_POSE = {v: k for k, v in POSE_XY.items()}

COUNTRIES = ["AT", "ES", "GR", "HR", "HU", "MD", "ME", "PL", "PT", "RO", "RS", "SI", "TR"]
