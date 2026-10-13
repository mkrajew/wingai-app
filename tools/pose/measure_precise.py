"""How well do the two models of the backend find the landmarks of wings that the app has turned to the right, against the landmarks put by hand?

    python tools/pose/measure_precise.py [--set bprime_test] [--limit N] [--threads 3]     (the backend must be running)

Set T (make_test_items.py, import_bprime.py --prefix bt --out bprime_test): crops of the wings of the TEST split of the models, cut by the real detector
and crop of the app, in all four poses, with the manual landmarks carried into the crop. For every well cut crop (the pose is clear, all 19 landmarks inside) the
backend is asked four times:

    rotation, as it is    what the app has done so far with the rotation model (it turns the wing afterwards, so the landmarks are the same ones)
    precise,  as it is    what the precise model can do so far: only a wing that already lies right and upright is read well
    rotation, turned      the wing turned to the right the way the app does it now, by the pose read from its pixels
    precise,  turned      the same for the precise model: what the "precise + right" option gives

The error of a wing is the mean distance (pixels) between the 19 landmarks of the backend and the manual ones, also as a share of the length of the crop
(its width), so that big and small wings count alike. The turned crops are made with the pose that tools/pose reads from the pixels (the same as the app
reads), and the manual landmarks are turned together with them. Results: work/<set>/measure.json (--out).
"""
import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor

import cv2
import httpx
import numpy as np

import features as F
from common import luma, shrink, valid_mask
from config import BACKEND_URL, POSES, WORK

HOG = {"kind": "hog", "cells": [16, 6], "bins": 8, "signed": True, "input": "gray", "norm": "sqrt", "sigma": 0.0}
SURE = 0.10
# (flip the columns, flip the rows) that brings a crop in the given pose to a right wing that lies upright
FLIPS = {"id": (False, False), "rot180": (True, True), "flipH": (True, False), "flipV": (False, True)}
# the same for a left wing that lies upright (--wanted left: only the rotation model can be asked for it)
FLIPS_LEFT = {"id": (True, False), "rot180": (False, True), "flipH": (False, False), "flipV": (True, True)}
VARIANTS = ("rotation as it is", "precise as it is", "rotation turned", "precise turned")
ACTIVE = VARIANTS  # the variants that are asked for (--wanted left: the rotation ones)
RAW_TRUTH = False  # --raw-truth: the landmarks as the browser carried them into the crop (off by up to 1.4 px, see index_landmarks)


def ask(png, w, h, model):
    for attempt in range(4):
        try:
            t0 = time.perf_counter()
            r = httpx.post(f"{BACKEND_URL}/analyze", files={"file": ("wing.png", png, "image/png")}, data={"x_size": w, "y_size": h, "model": model}, timeout=180)
            r.raise_for_status()
            d = r.json()
            return {"coords": [float(c) for c in d["coords"]], "check": bool(d["check"]), "side": d["orientation"], "ms": (time.perf_counter() - t0) * 1000}
        except Exception:
            time.sleep(1 + attempt)
    return None


def flipped(points, w, h, flip_x, flip_y):
    out = np.array(points, dtype=np.float64).reshape(-1, 2).copy()
    if flip_x:
        out[:, 0] = w - 1 - out[:, 0]
    if flip_y:
        out[:, 1] = h - 1 - out[:, 1]
    return out


def index_landmarks(meta):
    """The manual landmarks in the frame of the crop, as pixel indices (the centre of the pixel in column c, row r is (c, r), the convention of the backend).

    The browser carried the landmark (x, y) of the database picture into the crop as if the index were a coordinate of the picture, where the pixel
    spans [x, x + 1) and its centre is x + 0.5. The centre of the pixel is the point that was meant, so it is moved by the linear part of the whole chain
    (the photo: turn, scale, mirror; the crop: turn by the angle of the box) applied to (0.5, 0.5), and then the coordinate of the picture becomes an index
    again (minus 0.5). Without it the landmarks are off by up to 1.4 pixels, in a direction that depends on the pose of the crop."""
    rot = lambda a: np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    s = meta["scale"]
    linear = rot(-meta["axis_angle"]) @ rot(np.radians(meta["theta"])) @ np.diag([-s if meta["mirror"] else s, s])
    half = np.array([0.5, 0.5])
    return np.array(meta["landmarks"], dtype=np.float64).reshape(-1, 2) + linear @ half - half


def read_pose(img, templates):
    """The pose of a crop and the margin, as the app reads it (the Python reference, equal to the TypeScript byte for byte)."""
    gray = luma(img)
    rep = F.rep_one(shrink(gray), HOG, valid_mask(gray))
    best, margin = F.decide(F.scores(rep[None, :], templates))
    return POSES[int(best[0])], float(margin[0])


def measure_one(args):
    folder, meta, templates = args
    path = folder / "png" / f"{meta['id']}.png"
    png = path.read_bytes()
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    pose, margin = read_pose(img, templates)
    flip_x, flip_y = FLIPS[pose] if margin >= SURE else (False, False)
    turned = img[:, ::-1] if flip_x else img
    turned = turned[::-1, :] if flip_y else turned
    ok, enc = cv2.imencode(".png", np.ascontiguousarray(turned))
    png_turned = enc.tobytes()
    base = np.array(meta["landmarks"], dtype=np.float64) if RAW_TRUTH else index_landmarks(meta)
    manual = {"as it is": base, "turned": flipped(base, w, h, flip_x, flip_y)}
    rec = {"id": meta["id"], "cc": meta["cc"], "pose": meta["pose"], "w": w, "h": h, "read": pose, "margin": margin, "turn": [flip_x, flip_y], "variants": {}}
    for name in ACTIVE:
        model, state = name.split(" ", 1)
        ans = ask(png if state == "as it is" else png_turned, w, h, model)
        if ans is None:
            rec["variants"][name] = None
            continue
        diff = np.array(ans["coords"]).reshape(-1, 2) - manual[state]
        err = np.linalg.norm(diff, axis=1)
        rec["variants"][name] = {"check": ans["check"], "side": ans["side"], "ms": ans["ms"], "err": [round(float(e), 3) for e in err],
                                 "mean": float(err.mean()), "share": float(err.mean() / w), "bias": [float(v) for v in diff.mean(axis=0)],
                                 "coords": [round(c, 3) for c in ans["coords"]]}
    return rec


def bootstrap(diff, n=4000, seed=1):
    rng = np.random.default_rng(seed)
    means = np.array([diff[rng.integers(0, len(diff), len(diff))].mean() for _ in range(n)])
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def summary(recs):
    print(f"\n{len(recs)} crops. Error = mean distance of the 19 landmarks from the manual ones; share = that as a percent of the length of the crop")
    print(f"{'':20s} {'n':>5s} | {'mean px':>8s} {'median px':>9s} {'90% px':>7s} {'99% px':>7s} | {'mean share':>10s} {'median':>7s} {'90%':>6s} | {'flagged':>8s} | {'ms (median)':>11s}")
    for name in ACTIVE:
        rows = [r["variants"][name] for r in recs if r["variants"].get(name)]
        px = np.array([r["mean"] for r in rows])
        sh = np.array([r["share"] for r in rows]) * 100
        ms = np.array([r["ms"] for r in rows])
        flagged = sum(r["check"] for r in rows)
        print(f"{name:20s} {len(rows):5d} | {px.mean():8.2f} {np.median(px):9.2f} {np.percentile(px, 90):7.2f} {np.percentile(px, 99):7.2f} | {sh.mean():9.3f}% {np.median(sh):6.3f}% {np.percentile(sh, 90):5.3f}% | {flagged:4d} ({flagged / len(rows) * 100:3.0f}%) | {np.median(ms):11.0f}")
    if "precise turned" in ACTIVE:
        both = [r for r in recs if r["variants"].get("precise turned") and r["variants"].get("rotation turned")]
        d = np.array([r["variants"]["precise turned"]["share"] - r["variants"]["rotation turned"]["share"] for r in both]) * 100
        lo, hi = bootstrap(d)
        better = float((d < 0).mean() * 100)
        print(f"\nprecise minus rotation on the turned wings, share of the length: mean {d.mean():+.4f} points (95% interval {lo:+.4f} to {hi:+.4f}); precise is closer to the manual landmarks in {better:.0f}% of the wings")
        d_px = np.array([r["variants"]["precise turned"]["mean"] - r["variants"]["rotation turned"]["mean"] for r in both])
        lo, hi = bootstrap(d_px)
        print(f"                           in pixels: mean {d_px.mean():+.3f} px (95% interval {lo:+.3f} to {hi:+.3f})")
    both = [r for r in recs if r["variants"].get("rotation turned") and r["variants"].get("rotation as it is")]
    d = np.array([r["variants"]["rotation turned"]["share"] - r["variants"]["rotation as it is"]["share"] for r in both]) * 100
    lo, hi = bootstrap(d)
    print(f"rotation: turned minus as it is, share of the length: mean {d.mean():+.4f} points (95% interval {lo:+.4f} to {hi:+.4f}); turned is closer in {float((d < 0).mean() * 100):.0f}% of the wings")
    print("\nby the pose the crop had (error as a share of the length, mean):")
    print(f"{'pose':8s} {'n':>5s} " + " ".join(f"{v:>18s}" for v in ACTIVE))
    for pose in POSES:
        rows = [r for r in recs if r["pose"] == pose]
        cells = []
        for name in ACTIVE:
            vals = [r["variants"][name]["share"] * 100 for r in rows if r["variants"].get(name)]
            flagged = sum(r["variants"][name]["check"] for r in rows if r["variants"].get(name))
            cells.append(f"{np.mean(vals):7.3f}% fl {flagged:3d}/{len(vals):3d}")
        print(f"{pose:8s} {len(rows):5d} " + " ".join(f"{c:>18s}" for c in cells))
    print("\nmean signed error, backend minus manual (px: x, y), by the pose the crop had; a convention offset would show here:")
    print(f"{'pose':8s} " + " ".join(f"{v:>20s}" for v in ACTIVE))
    for pose in POSES:
        cells = []
        for name in ACTIVE:
            b = np.array([r["variants"][name]["bias"] for r in recs if r["pose"] == pose and r["variants"].get(name) and not r["variants"][name]["check"]])
            cells.append(f"{b[:, 0].mean():+6.2f} {b[:, 1].mean():+6.2f}" if len(b) else "-")
        print(f"{pose:8s} " + " ".join(f"{c:>20s}" for c in cells))
    models = [m for m in ("rotation turned", "precise turned") if m in ACTIVE]
    print("\nby country (turned wings, share of the length: " + " / ".join(m.split()[0] for m in models) + "):")
    for cc in sorted({r["cc"] for r in recs}):
        rows = [r for r in recs if r["cc"] == cc and all(r["variants"].get(m) for m in models)]
        print(f"  {cc}: n={len(rows):3d}  " + "  /  ".join(f"{np.mean([r['variants'][m]['share'] for r in rows]) * 100:6.3f}%" for m in models))
    errs = {m: np.array([r["variants"][m]["err"] for r in recs if r["variants"].get(m)]) for m in models}
    print("\nmean error of each landmark, turned wings (px): " + "; ".join(f"{m.split()[0]}: " + " ".join(f"{v:.1f}" for v in e.mean(axis=0)) for m, e in errs.items()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="bprime_test")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--threads", type=int, default=3, help="requests at the same time (use 1 to time the models)")
    ap.add_argument("--out", default="measure.json", help="the file in work/<set>/ for the results")
    ap.add_argument("--raw-truth", action="store_true", help="measure against the landmarks as the browser carried them (for comparison only)")
    ap.add_argument("--wanted", choices=("right", "left"), default="right", help="the side the wings are turned to; left: only the rotation model is asked")
    a = ap.parse_args()
    global RAW_TRUTH, FLIPS, ACTIVE
    RAW_TRUTH = a.raw_truth
    if a.wanted == "left":
        FLIPS = FLIPS_LEFT
        ACTIVE = ("rotation as it is", "rotation turned")
    folder = WORK / a.set
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    good = [m for m in meta if m["detected"] and m.get("sure") and m.get("complete")]
    print(f"{len(meta)} crops, {len(good)} are well cut with a clear pose; poses: " + ", ".join(f"{p} {sum(m['pose'] == p for m in good)}" for p in POSES))
    if a.limit:
        good = good[: a.limit]
    templates = np.load(WORK / "ship" / "templates.npy").astype(np.float32)
    t0 = time.time()
    recs = []
    with ThreadPoolExecutor(a.threads) as ex:
        for i, rec in enumerate(ex.map(measure_one, [(folder, m, templates) for m in good]), 1):
            recs.append(rec)
            if i % 50 == 0:
                print(f"  {i}/{len(good)}  {time.time() - t0:.0f}s", flush=True)
    (folder / a.out).write_text(json.dumps(recs), encoding="utf-8")
    reads = [r for r in recs if r["read"] == r["pose"]]
    sure = [r for r in recs if r["margin"] >= SURE]
    print(f"\npose read from the pixels: {len(reads)}/{len(recs)} right, {len(sure)}/{len(recs)} sure; smallest margin of a right reading {min(r['margin'] for r in reads):.3f}")
    summary([r for r in recs if all(r["variants"].get(v) for v in ACTIVE)])


if __name__ == "__main__":
    main()
