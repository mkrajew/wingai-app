"""Reference implementations (Python) of the candidate ways to read the pose of a wing crop from its pixels.

Input of every method: a gray picture of the working size (H x W, uint8) and, for crops that stick out of the photo, a boolean
`valid` mask (False where the crop is the black fill outside the photo).

Two families:
  ink  - "where is the ink": the veins (dark thin lines) are made to stand out and their mass is compared between
         the right and the left third (the base of the wing is full of veins, the tip is almost empty) and between the top and the
         bottom band (the thick leading-edge vein runs along one of the long edges).
  hog  - histograms of gradient directions in a grid of cells ("with position"), compared with the average wing in each of the four
         poses. The same without a grid ("ghist", one histogram for the whole picture) is the baseline.
"""
from functools import lru_cache

import cv2
import numpy as np

from config import H, W

EPS = 1e-9


# ----------------------------------------------------------------------------------------------------------- preparation
def prep(gray, valid=None):
    """float32 picture; the area outside the photo is filled with the median of the rest so that it makes no edges."""
    g = gray.astype(np.float32)
    if valid is None or valid.all():
        return g, None
    v = cv2.erode(valid.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    if v.sum() < 0.2 * v.size:
        return g, None
    g = g.copy()
    g[~v] = np.median(g[v])
    return g, v


@lru_cache(maxsize=None)
def _ellipse(k):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))


def vein_map(g, valid=None, k=21, off=8.0, power=1.0):
    """How much darker than its surroundings every pixel is. The closing removes dark structures thinner than the kernel, what is
    left is the background (membrane, slide), so the difference is the veins (and dirt)."""
    bg = cv2.morphologyEx(g, cv2.MORPH_CLOSE, _ellipse(k))
    v = np.clip(bg - g - off, 0, None)
    if power != 1.0:
        v = v**power
    if valid is not None:
        v = v * valid
    return v


# ----------------------------------------------------------------------------------------------------------------- ink
def ink_stats(v):
    """Signed statistics of the vein mass. Positive x: the mass is on the right (base on the right). Positive y: it is at the top
    (the thick leading-edge vein is at the top). Every statistic changes its sign when the picture is turned the matching way."""
    h, w = v.shape
    tot = float(v.sum()) + EPS
    xs = np.arange(w, dtype=np.float64)
    ys = np.arange(h, dtype=np.float64)
    col = v.sum(axis=0).astype(np.float64)
    row = v.sum(axis=1).astype(np.float64)
    x1, x2 = w // 3, (2 * w) // 3
    y1, y2 = h // 4, (3 * h) // 4
    out = {}
    out["x_thirds"] = (v[:, x2:].sum() - v[:, :x1].sum()) / tot
    out["x_halves"] = (v[:, w // 2 :].sum() - v[:, : w // 2].sum()) / tot
    xm = (col * xs).sum() / tot
    out["x_centroid"] = (xm - (w - 1) / 2) / w
    m2 = (col * (xs - xm) ** 2).sum() / tot
    m3 = (col * (xs - xm) ** 3).sum() / tot
    out["x_skew"] = -m3 / (m2**1.5 + EPS)
    out["y_bands"] = (v[:y1].sum() - v[y2:].sum()) / tot
    out["y_halves"] = (v[: h // 2].sum() - v[h // 2 :].sum()) / tot
    ym = (row * ys).sum() / tot
    out["y_centroid"] = (((h - 1) / 2) - ym) / h
    # thickness of the thickest dark line in the top and in the bottom third (the leading-edge vein is the thickest)
    thr = 0.4 * np.percentile(v, 99.5) + EPS
    dt = cv2.distanceTransform((v > thr).astype(np.uint8), cv2.DIST_L2, 3)
    t_top, t_bot = float(dt[: h // 3].max()), float(dt[(2 * h) // 3 :].max())
    out["y_thick"] = (t_top - t_bot) / (max(t_top, t_bot) + EPS)
    return out


def ink_stats_for(gray, spec, valid=None):
    g, v = prep(gray, valid)
    vm = vein_map(g, v, k=spec.get("k", 21), off=spec.get("off", 8.0), power=spec.get("power", 1.0))
    return ink_stats(vm)


# ----------------------------------------------------------------------------------------------------- gradient histograms
@lru_cache(maxsize=None)
def _cell_index(ncx, ncy, bins):
    ch, cw = H // ncy, W // ncx
    ys = (np.arange(ncy * ch) // ch)[:, None]
    xs = (np.arange(ncx * cw) // cw)[None, :]
    return ((ys * ncx + xs) * bins).astype(np.int64), ncy * ch, ncx * cw


def _gradient_bins(img, valid, spec):
    sigma = spec.get("sigma", 0.0)
    if sigma:
        img = cv2.GaussianBlur(img, (0, 0), sigma)
    gx = cv2.Sobel(img, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(img, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx * gx + gy * gy)
    if valid is not None:
        mag = mag * cv2.erode(valid.astype(np.uint8), np.ones((5, 5), np.uint8))
    thr = spec.get("thr", 0.0)
    if thr > 0:
        mag = np.where(mag >= thr * mag.max(), mag, 0.0)
    bins = spec.get("bins", 8)
    ang = np.arctan2(gy, gx)
    if spec.get("signed", True):
        b = np.minimum(((ang + np.pi) * (bins / (2 * np.pi))).astype(np.int64), bins - 1)
    else:
        b = np.minimum(((ang % np.pi) * (bins / np.pi)).astype(np.int64), bins - 1)
    return mag, b


def hog_rep(img, valid, spec):
    ncx, ncy = spec.get("cells", (16, 6))
    bins = spec.get("bins", 8)
    mag, b = _gradient_bins(img, valid, spec)
    base, hh, ww = _cell_index(ncx, ncy, bins)
    idx = (base + b[:hh, :ww]).ravel()
    hist = np.bincount(idx, weights=mag[:hh, :ww].ravel(), minlength=ncx * ncy * bins).reshape(ncy, ncx, bins)
    norm = spec.get("norm", "sqrt")
    if norm == "sqrt":
        hist = np.sqrt(hist)
    elif norm == "log":
        hist = np.log1p(hist)
    elif norm == "block":
        hist = _block_l2hys(hist)
    return hist.ravel().astype(np.float32)


def _block_l2hys(hist):
    ncy, ncx, bins = hist.shape
    blocks = []
    for y in range(ncy - 1):
        for x in range(ncx - 1):
            v = hist[y : y + 2, x : x + 2].ravel()
            v = v / (np.linalg.norm(v) + 1e-3)
            v = np.minimum(v, 0.2)
            v = v / (np.linalg.norm(v) + 1e-3)
            blocks.append(v)
    return np.concatenate(blocks)


def ghist_rep(img, valid, spec):
    """One histogram of gradient directions for the whole picture (no position)."""
    bins = spec.get("bins", 16)
    mag, b = _gradient_bins(img, valid, spec)
    hist = np.bincount(b.ravel(), weights=mag.ravel(), minlength=bins)
    if spec.get("norm", "sqrt") == "sqrt":
        hist = np.sqrt(hist)
    return hist.astype(np.float32)


def rep_one(gray, spec, valid=None):
    """The descriptor of one picture for a hog / ghist spec (a plain dict, so that it can be sent to worker processes)."""
    g, v = prep(gray, valid)
    src = g
    if spec.get("input") == "vein":
        src = vein_map(g, v, k=spec.get("k", 21), off=spec.get("off", 8.0))
    return hog_rep(src, v, spec) if spec["kind"] == "hog" else ghist_rep(src, v, spec)


# ------------------------------------------------------------------------------------------------------- template matching
def normalise_rows(a):
    a = a - a.mean(axis=1, keepdims=True)
    return a / (np.linalg.norm(a, axis=1, keepdims=True) + EPS)


def scores(reps, templates):
    """Normalised cross correlation of every descriptor (rows of reps) with the four templates (rows, in the order of POSES)."""
    return normalise_rows(np.asarray(reps, np.float32)) @ normalise_rows(np.asarray(templates, np.float32)).T


def decide(sc):
    """(index of the best pose, margin to the second best) for every row of scores."""
    order = np.argsort(-sc, axis=1)
    best = order[:, 0]
    top = np.take_along_axis(sc, order[:, :1], axis=1)[:, 0]
    second = np.take_along_axis(sc, order[:, 1:2], axis=1)[:, 0]
    return best, top - second
