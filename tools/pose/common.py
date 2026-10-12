"""Small helpers shared by the pose tools. Only numpy and OpenCV, so that worker processes start fast."""
import cv2
import numpy as np

from config import H, POSES, W


def luma(bgr):
    """Integer luma of a BGR picture, the same arithmetic as the app will use: (77 R + 150 G + 29 B + 128) >> 8."""
    if bgr.ndim == 2:
        return bgr
    b = bgr[..., 0].astype(np.uint16)
    g = bgr[..., 1].astype(np.uint16)
    r = bgr[..., 2].astype(np.uint16)
    return ((77 * r + 150 * g + 29 * b + 128) >> 8).astype(np.uint8)


def shrink(gray, w=W, h=H):
    """Area average down to the working size (what the app does with the pixels of the crop)."""
    return cv2.resize(gray, (w, h), interpolation=cv2.INTER_AREA)


def turn(a, pose):
    """The picture (or any array with rows, columns first) in one of the four poses."""
    if pose == "id":
        return a
    if pose == "rot180":
        return a[::-1, ::-1]
    if pose == "flipH":
        return a[:, ::-1]
    if pose == "flipV":
        return a[::-1, :]
    raise ValueError(pose)


def all_poses(a):
    return {p: np.ascontiguousarray(turn(a, p)) for p in POSES}


def group_of(name):
    """The colony (country and the number after it) of a wing picture: its wings are never split between the train and test folds."""
    parts = name.split(".")[0].split("-")
    return "-".join(parts[:2])


def fold_of(group, n=5):
    import zlib

    return zlib.crc32(group.encode()) % n


def wilson_upper(errors, n, z=1.96):
    """Upper end of the 95% Wilson interval of an error rate (for 0 errors it is about 3.84 / (n + 3.84))."""
    if n == 0:
        return 1.0
    p = errors / n
    den = 1 + z * z / n
    centre = p + z * z / (2 * n)
    spread = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return float(min(1.0, (centre + spread) / den))
