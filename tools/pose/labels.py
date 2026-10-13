"""The pose of a wing, read from its landmarks the way the app judges a wing (Procrustes against the mean shape of the backend).

Imports torch and the backend package, so it is only used by the tools that make labels, never by worker processes
that measure pictures.
"""
import math
import sys

import numpy as np

from config import BACKEND_DIR, POSE_XY, XY_POSE

_state = {}


def _load():
    if not _state:
        sys.path.insert(0, str(BACKEND_DIR))
        import torch
        from wings.gpa import center_shape, normalize_shape, procrustes_align

        _state["torch"] = torch
        _state["fns"] = (center_shape, normalize_shape, procrustes_align)
        _state["mean"] = torch.load(BACKEND_DIR / "models" / "mean_shape.pth", weights_only=False).float()
        _state["flip_x"] = torch.tensor([[-1.0, 0.0], [0.0, 1.0]])
    return _state


def pose_y_up(points):
    """(det, angle in degrees) of landmarks given as (x, y) with y UP, the frame of the mean shape and of the manual csv.

    det < 0 means the wing is the mirror image of the mean shape (a "left" wing). The angle is the rotation that the wing
    still needs after it was mirrored (when det < 0) to match the mean shape, so 0 is upright (a few degrees: the mean
    shape itself is tilted) and about 180 is upside down.
    """
    s = _load()
    torch = s["torch"]
    center_shape, normalize_shape, procrustes_align = s["fns"]
    pts = np.array(points, dtype=np.float32).reshape(-1, 2)
    r = procrustes_align(normalize_shape(center_shape(torch.from_numpy(pts))), s["mean"], only_matrix=True, allow_reflection=True)
    det = torch.det(r).item()
    rot = r if det > 0 else s["flip_x"] @ r
    return det, math.degrees(math.atan2(rot[0, 1].item(), rot[0, 0].item()))


def pose_backend(coords, height):
    """The same for the answer of the backend: (x, y) in picture coordinates, y DOWN."""
    pts = np.array(coords, dtype=np.float32).reshape(-1, 2)
    pts[:, 1] = height - 1 - pts[:, 1]
    return pose_y_up(pts)


def pose_name(det, angle):
    """"id", "rot180", "flipH" or "flipV" from the chirality and the angle (the angle must be near 0 or near 180)."""
    turned = abs(angle) > 90
    if det > 0:
        return "rot180" if turned else "id"
    return "flipV" if turned else "flipH"


def sure(angle):
    """The angle is within 30 degrees of upright or of upside down: the pose is clear."""
    return abs(angle) < 30 or abs(angle) > 150


def xy_of(pose):
    return POSE_XY[pose]


def pose_of_xy(x, y):
    return XY_POSE[(int(x), int(y))]
