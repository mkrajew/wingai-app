"""Golden vectors for the TypeScript port of the pose reading (frontend/src/utils/areaResize.ts and poseFromPixels.ts).

The Python code of this folder is the reference. This script feeds it pictures that are made by integer formulas, which the
TypeScript tests reproduce exactly (frontend/tests/helpers.ts), and writes what the reference answers to
frontend/tests/fixtures/pose-golden.json. No photo is used, so no picture of the bee databases ends up in the repository.

    python tools/pose/make_golden.py        (needs work/ship/templates.npy, see build_template.py)
"""
import base64
import hashlib
import json

import cv2
import numpy as np

import features as F
from common import luma, shrink, valid_mask
from config import H, POSES, REPO, W, WORK

OUT = REPO / "frontend" / "tests" / "fixtures" / "pose-golden.json"
M32 = 0xFFFFFFFF


# ----------------------------------------------------------------------------------------- the pictures (integer formulas)
def hash32(x, y, seed):
    """A stateless 32 bit hash of a pixel position (the finaliser of murmur3); the same in frontend/tests/helpers.ts."""
    h = ((x.astype(np.uint64) * 73856093) ^ (y.astype(np.uint64) * 19349663) ^ np.uint64((seed * 83492791) & M32)) & np.uint64(M32)
    h ^= h >> np.uint64(15)
    h = (h * np.uint64(2246822519)) & np.uint64(M32)
    h ^= h >> np.uint64(13)
    h = (h * np.uint64(3266489917)) & np.uint64(M32)
    h ^= h >> np.uint64(16)
    return h


def plane(kind, w, h, seed=0):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.int64)
    if kind == "formula":
        v = xx * 7 + yy * 13 + ((xx * yy) >> 5)
    elif kind == "blocks":
        bx, by = xx // 5, yy // 7
        v = ((bx * 37 + by * 91) ^ (bx * by)) + seed
    elif kind == "noise":
        v = hash32(xx, yy, seed).astype(np.int64)
    else:
        raise ValueError(kind)
    return (v & 255).astype(np.uint8)


def black_mask(shapes, w, h):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.int64)
    black = np.zeros((h, w), bool)
    for s in shapes:
        if s["kind"] == "tri":  # a triangle in a corner of the picture: it touches the border
            cx = xx if s["corner"] in ("tl", "bl") else w - 1 - xx
            cy = yy if s["corner"] in ("tl", "tr") else h - 1 - yy
            black |= cx * h + cy * w < (s["percent"] * w * h) // 100
        elif s["kind"] == "disc":  # an island inside the picture, like a very dark vein: it does not touch the border
            black |= (xx - s["cx"]) ** 2 + (yy - s["cy"]) ** 2 <= s["r"] ** 2
        else:
            raise ValueError(s["kind"])
    return black


def picture_bgr(spec):
    """(h, w, 3) uint8, BGR like OpenCV. spec: w, h, channels = [kind of red, kind of green, kind of blue], shapes = black parts."""
    w, h = spec["w"], spec["h"]
    r, g, b = (plane(k, w, h, seed=i + 1) for i, k in enumerate(spec["channels"]))
    img = np.stack([b, g, r], axis=-1)
    img[black_mask(spec.get("shapes", []), w, h)] = 0
    return img


# ----------------------------------------------------------------------------------------------------------- the answers
def sha(a):
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()


def f32_b64(a):
    return base64.b64encode(np.asarray(a, np.float32).tobytes()).decode()


def area_cases():
    sizes = [(2203, 947), (2174, 914), (1000, 400), (612, 252), (512, 192), (768, 288), (300, 120), (257, 97), (256, 96),
             (2560, 960), (1024, 384), (4096, 1536), (333, 111), (1999, 1001), (700, 700), (2048, 256), (256, 400), (1024, 96),
             (512, 96), (256, 192), (768, 96), (1280, 480), (1536, 576)]  # the last five: whole multiples (2 x 1, 1 x 2, 3 x 1, 5 x 5, 6 x 6)
    # more noise pictures of arbitrary sizes: a wrong rounding in the float32 arithmetic shows in about one pixel of 50 000
    rng = np.random.default_rng(11)
    sizes += [(int(rng.integers(257, 3000)), int(rng.integers(97, 1300))) for _ in range(16)]
    kinds = ["noise", "formula", "blocks"]
    out = []
    for i, (w, h) in enumerate(sizes):
        kind = "noise" if i >= len(sizes) - 16 else kinds[i % 3]
        gray = plane(kind, w, h, seed=i)
        out.append({"kind": kind, "seed": i, "w": w, "h": h, "sha256": sha(cv2.resize(gray, (W, H), interpolation=cv2.INTER_AREA))})
    # the 0 / 255 map that valid_mask shrinks
    gray = plane("noise", 1500, 640, seed=99)
    black = (gray <= 128).astype(np.uint8) * 255
    out.append({"kind": "noise", "seed": 99, "w": 1500, "h": 640, "threshold": 128, "sha256": sha(cv2.resize(black, (W, H), interpolation=cv2.INTER_AREA))})
    return out


def bin_cases():
    """Direction bins as features._gradient_bins computes them (float32 arctan2): random gradients and every exact tie."""
    rng = np.random.default_rng(5)
    gx = list(rng.integers(-1020, 1021, 300)) + list(rng.integers(-2040, 2041, 100) / 2)
    gy = list(rng.integers(-1020, 1021, 300)) + list(rng.integers(-2040, 2041, 100) / 2)
    for k in (1, 2, 3, 7, 100, 255, 1020, 0.5, 2.5):
        for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1), (-1, -1), (1, -1)):
            gx.append(k * sx)
            gy.append(k * sy)
    gx, gy = np.array(gx, np.float32), np.array(gy, np.float32)
    ang = np.arctan2(gy, gx)
    b = np.minimum(((ang + np.pi) * (8 / (2 * np.pi))).astype(np.int64), 7)
    return [[float(x), float(y), int(k)] for x, y, k in zip(gx, gy, b)]


def pipeline_case(spec, templates):
    bgr = picture_bgr(spec)
    gray = luma(bgr)
    g = shrink(gray)
    valid = valid_mask(gray)
    rep = F.rep_one(g, HOG, valid)
    sc = F.scores(rep[None, :], templates)
    best, margin = F.decide(sc)
    return {"spec": spec, "luma_sha256": sha(gray), "gray_sha256": sha(g), "valid_all": bool(valid.all()), "valid_cells": int(valid.sum()),
            "valid_sha256": sha(valid.astype(np.uint8)), "descriptor_b64": f32_b64(rep), "scores": [float(v) for v in sc[0]],
            "best": int(best[0]), "margin": float(margin[0])}


HOG = {"kind": "hog", "cells": [16, 6], "bins": 8, "signed": True, "input": "gray", "norm": "sqrt", "sigma": 0.0}
TRI_TL = {"kind": "tri", "corner": "tl", "percent": 12}


def disc(w, h, r):
    return {"kind": "disc", "cx": w // 2, "cy": h // 2, "r": r}


def dump(gold):
    """JSON with one line per top-level key, and one line per case in the lists of cases (so that a diff stays readable)."""
    compact = {"separators": (",", ":")}
    lines = []
    for key, value in gold.items():
        if key in ("area", "pipeline") and isinstance(value, list):
            lines.append(f'"{key}":[\n' + ",\n".join(json.dumps(v, **compact) for v in value) + "\n]")
        else:
            lines.append(f'"{key}":{json.dumps(value, **compact)}')
    return "{\n" + ",\n".join(lines) + "\n}\n"


def main():
    templates = np.load(WORK / "ship" / "templates.npy").astype(np.float32)
    assert templates.shape == (4, 768), templates.shape
    ch = ["formula", "blocks", "noise"]
    specs = [
        {"w": 2203, "h": 947, "channels": ch, "shapes": [TRI_TL, disc(2203, 947, 40)]},           # a crop with a part outside the photo
        {"w": 1100, "h": 470, "channels": ch, "shapes": []},                                      # all photo
        {"w": 512, "h": 192, "channels": ch, "shapes": [disc(512, 192, 12)]},                     # the exact 2 x 2 shrink, a dark island
        {"w": 612, "h": 252, "channels": ["blocks", "formula", "noise"], "shapes": [{"kind": "tri", "corner": "br", "percent": 150}]},  # most of it outside: the mask is not used
        {"w": 1800, "h": 700, "channels": ["noise", "noise", "noise"], "shapes": [{"kind": "tri", "corner": "tr", "percent": 25}, {"kind": "tri", "corner": "bl", "percent": 8}]},
        {"w": 256, "h": 96, "channels": ["formula", "formula", "formula"], "shapes": [{"kind": "tri", "corner": "tr", "percent": 20}]},  # the working size itself
        {"w": 256, "h": 96, "channels": ["blocks", "blocks", "blocks"], "shapes": [disc(256, 96, 9)]},
        {"w": 256, "h": 96, "channels": ["noise", "noise", "noise"], "shapes": []},
        {"w": 256, "h": 96, "channels": ["formula", "formula", "formula"], "shapes": [{"kind": "tri", "corner": "tl", "percent": 3}]},
    ]
    gold = {
        "generator": "tools/pose/make_golden.py",
        "hog": HOG, "poses": list(POSES), "work": [W, H],
        "templates_sha256": sha(templates),
        "area": area_cases(),
        "bins": bin_cases(),
        "pipeline": [pipeline_case(s, templates) for s in specs],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(dump(gold), encoding="utf-8")
    print(f"{OUT} ({OUT.stat().st_size / 1024:.0f} KB): {len(gold['area'])} area cases, {len(gold['bins'])} bins, {len(gold['pipeline'])} pictures")
    for p in gold["pipeline"]:
        s = p["spec"]
        print(f"  {s['w']}x{s['h']} valid_all={p['valid_all']} cells={p['valid_cells']} best={POSES[p['best']]} margin={p['margin']:.4f}")


if __name__ == "__main__":
    main()
