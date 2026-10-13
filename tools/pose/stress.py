"""Set C: the chosen methods on perturbed wings. A sample of the holdout wings of set B (complete wings only) is straightened like a crop of
the app, then perturbed at full resolution (tilt, framing, light, JPEG, blur, noise, a black part outside the photo, dirt) and only then
shrunk and measured, the way a real change in the photo or in the crop would reach the method.

    python tools/pose/stress.py [--n 1000]        needs work/eval/finalists.json and the templates written by evaluate.py
"""
import argparse
import json
import multiprocessing as mp

import cv2
import numpy as np

import features as F
from build_sets import TARGET_ANGLE, detilt
from common import all_poses, fold_of, group_of, luma, shrink, valid_mask
from config import COUNTRIES, CROPPED, EVAL, H, POSES, W, WORK
import evalkit as K

HOLDOUT = 4


def rot(deg):
    def f(im):
        h, w = im.shape[:2]
        m = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
        return cv2.warpAffine(im, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    return f


def zoom(factor):
    """factor < 1: the crop is tighter (the picture is cut at the border), factor > 1: it is looser (the border is repeated)."""

    def f(im):
        h, w = im.shape[:2]
        if factor < 1:
            ch, cw = int(h * factor), int(w * factor)
            y0, x0 = (h - ch) // 2, (w - cw) // 2
            return cv2.resize(im[y0 : y0 + ch, x0 : x0 + cw], (w, h), interpolation=cv2.INTER_LINEAR)
        ph, pw = int(h * (factor - 1) / 2), int(w * (factor - 1) / 2)
        big = cv2.copyMakeBorder(im, ph, ph, pw, pw, cv2.BORDER_REPLICATE)
        return cv2.resize(big, (w, h), interpolation=cv2.INTER_AREA)

    return f


def gain(a):
    return lambda im: np.clip(im.astype(np.float32) * a, 0, 255).astype(np.uint8)


def gamma(g):
    return lambda im: np.clip(255.0 * (im.astype(np.float32) / 255.0) ** g, 0, 255).astype(np.uint8)


def contrast(c):
    def f(im):
        m = im.mean()
        return np.clip((im.astype(np.float32) - m) * c + m, 0, 255).astype(np.uint8)

    return f


def jpeg(q):
    return lambda im: cv2.imdecode(cv2.imencode(".jpg", im, [cv2.IMWRITE_JPEG_QUALITY, q])[1], cv2.IMREAD_COLOR)


def blur(s):
    return lambda im: cv2.GaussianBlur(im, (0, 0), s)


def noise(s):
    rng = np.random.default_rng(5)
    return lambda im: np.clip(im.astype(np.float32) + rng.normal(0, s, im.shape), 0, 255).astype(np.uint8)


def lowres(f):
    def g(im):
        h, w = im.shape[:2]
        small = cv2.resize(im, (max(8, int(w * f)), max(8, int(h * f))), interpolation=cv2.INTER_AREA)
        return cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)

    return g


def black(side, frac):
    """A part of the crop is outside the photo: the crop is black there, the way straightenedCrop leaves it."""

    def f(im):
        im = im.copy()
        h, w = im.shape[:2]
        if side == "left":
            im[:, : int(w * frac)] = 0
        elif side == "right":
            im[:, w - int(w * frac) :] = 0
        elif side == "top":
            im[: int(h * frac)] = 0
        else:
            im[h - int(h * frac) :] = 0
        return im

    return f


def dirt(n):
    def f(im):
        im = im.copy()
        h, w = im.shape[:2]
        rng = np.random.default_rng(7)
        for _ in range(n):
            c = (int(rng.integers(w * 0.1, w * 0.9)), int(rng.integers(h * 0.1, h * 0.9)))
            ax = (int(rng.integers(h * 0.01, h * 0.05)), int(rng.integers(h * 0.01, h * 0.05)))
            cv2.ellipse(im, c, ax, int(rng.integers(0, 180)), 0, 360, (25, 25, 25), -1)
        return im

    return f


PERTURBATIONS = {
    "none": lambda im: im,
    "tilt +3": rot(3), "tilt -3": rot(-3), "tilt +6": rot(6), "tilt -6": rot(-6),
    "tighter 10%": zoom(0.9), "looser 10%": zoom(1.1),
    "darker x0.7": gain(0.7), "brighter x1.3": gain(1.3), "gamma 0.6": gamma(0.6), "gamma 1.6": gamma(1.6), "contrast x0.6": contrast(0.6),
    "jpeg 40": jpeg(40), "jpeg 70": jpeg(70), "blur 2": blur(2.0), "noise 8": noise(8), "low resolution x0.3": lowres(0.3),
    "black left 15%": black("left", 0.15), "black right 15%": black("right", 0.15), "black top 15%": black("top", 0.15), "black bottom 15%": black("bottom", 0.15),
    "black left 30%": black("left", 0.30), "dirt x5": dirt(5),
}


def valid_of(img):
    gray = luma(img)
    return valid_mask(gray), gray


def job(args):
    cc, name, angle, methods = args
    img = cv2.imread(str(CROPPED / f"{cc}-wing-images" / name), cv2.IMREAD_COLOR)
    delta = angle - TARGET_ANGLE
    base = detilt(img, delta) if abs(delta) > 0.3 else img
    out = {}
    for pname, fn in PERTURBATIONS.items():
        im = fn(base)
        valid, gray = valid_of(im)
        g = shrink(gray)
        if (~valid).any():
            vs = all_poses(valid)
        else:
            valid, vs = None, {p: None for p in POSES}
        ps = all_poses(g)
        row = {}
        for m in methods:
            if m["kind"] == "template":
                row[m["name"]] = np.stack([F.rep_one(ps[p], m["spec"], vs[p]) for p in POSES])
            else:
                row[m["name"]] = F.ink_stats_for(g, m["spec"], valid)
        out[pname] = row
    return out


def main():
    import methods as M
    from rules import ink_views

    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1000)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    methods = M.load()
    if a.only:
        methods = [m for m in methods if m["name"] in a.only.split(",")]
    templates = {m["name"]: np.load(EVAL / f"templates_{m['name']}.npy") for m in methods if m["kind"] == "template"}
    complete = json.loads((WORK / "B" / "complete.json").read_text(encoding="utf-8"))

    rng = np.random.default_rng(3)
    items = []
    for cc in COUNTRIES:
        z = np.load(WORK / "B" / f"{cc}.npz")
        for name, ang in zip(z["names"], z["angle"]):
            name = str(name)
            if fold_of(group_of(name)) == HOLDOUT and complete[cc][name] >= 0.015:
                items.append((cc, name, float(ang)))
    pick = rng.choice(len(items), min(a.n, len(items)), replace=False)
    items = [items[i] for i in sorted(pick)]
    print(f"{len(items)} complete holdout wings, {len(PERTURBATIONS)} perturbations each, {len(methods)} methods")

    with mp.Pool(14) as pool:
        out = pool.map(job, [(cc, n, an, methods) for cc, n, an in items], chunksize=6)

    table = {m["name"]: {} for m in methods}
    saved = {}
    for m in methods:
        name = m["name"]
        for pname in PERTURBATIONS:
            if m["kind"] == "template":
                reps = np.stack([o[pname][name] for o in out], axis=1)  # (4, N, D)
                pred, margin = K.predict(reps, templates[name])
            else:
                pose, mg = K.ink_decision([o[pname][name] for o in out], m["x"], m["y"])
                pred = ink_views(pose)
                margin = np.stack([mg] * 4)
            saved[f"{name}__{pname}__pred"], saved[f"{name}__{pname}__margin"] = pred.astype(np.int8), margin.astype(np.float32)
            truth = np.arange(4)[:, None] * np.ones_like(pred)
            table[name][pname] = K.metrics(pred.ravel(), truth.ravel())
    names = [m["name"] for m in methods]
    print("\nerrors out of %d decisions (%d wings x 4 poses); the smaller the better" % (4 * len(items), len(items)))
    print(f"{'perturbation':22s} " + " ".join(f"{n[:17]:>17s}" for n in names))
    for pname in PERTURBATIONS:
        print(f"{pname:22s} " + " ".join(f"{table[n][pname]['errors']:17d}" for n in names))
    print(f"{'TOTAL':22s} " + " ".join(f"{sum(table[n][p]['errors'] for p in PERTURBATIONS):17d}" for n in names))
    (EVAL / "stress_results.json").write_text(json.dumps(table), encoding="utf-8")
    np.savez_compressed(EVAL / "stress_outputs.npz", **saved)


if __name__ == "__main__":
    main()
