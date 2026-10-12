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
from common import all_poses, fold_of, group_of, luma, shrink
from config import COUNTRIES, CROPPED, H, POSES, W, WORK
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
    return cv2.resize((gray > 6).astype(np.uint8) * 255, (W, H), interpolation=cv2.INTER_AREA) > 250, gray


def job(args):
    cc, name, angle, hog_spec, ink_spec = args
    img = cv2.imread(str(CROPPED / f"{cc}-wing-images" / name), cv2.IMREAD_COLOR)
    delta = angle - TARGET_ANGLE
    base = detilt(img, delta) if abs(delta) > 0.3 else img
    reps, inks = {}, {}
    for pname, fn in PERTURBATIONS.items():
        im = fn(base)
        valid, gray = valid_of(im)
        g = shrink(gray)
        if (~valid).any():
            vs = all_poses(valid)
        else:
            valid, vs = None, {p: None for p in POSES}
        ps = all_poses(g)
        reps[pname] = np.stack([F.rep_one(ps[p], hog_spec, vs[p]) for p in POSES])
        inks[pname] = F.ink_stats_for(g, ink_spec, valid)
    return reps, inks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1000)
    a = ap.parse_args()
    fin = json.loads((WORK / "eval" / "finalists.json").read_text(encoding="utf-8"))
    hog_spec, ink = fin["hog"], fin["ink"]
    templates = np.load(WORK / "eval" / "templates_hog.npy")
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
    print(f"{len(items)} complete holdout wings, {len(PERTURBATIONS)} perturbations each")

    with mp.Pool(14) as pool:
        out = pool.map(job, [(cc, n, an, hog_spec, ink["spec"]) for cc, n, an in items], chunksize=8)

    print(f"\n{'perturbation':22s} {'HOG pose':>9s} {'HOG x':>7s} {'HOG y':>7s} {'err':>5s} | {'ink pose':>9s} {'ink err':>7s} | both agree: n  errors")
    table = {}
    for pname in PERTURBATIONS:
        reps = np.stack([o[0][pname] for o in out], axis=1)  # (4, N, D)
        pred, margin = K.predict(reps, templates)
        truth = np.arange(4)[:, None] * np.ones_like(pred)
        mh = K.metrics(pred.ravel(), truth.ravel())
        ip, _ = K.ink_decision([o[1][pname] for o in out], ink["x"], ink["y"])
        # ink statistics are antisymmetric: the canonical wing decides for the four poses
        mi = K.metrics(ip, np.zeros_like(ip))
        agree = (pred[0] == ip)
        n_agree, err_agree = int(agree.sum()), int((agree & (pred[0] != 0)).sum())
        table[pname] = {"hog": mh, "ink": mi, "agree_n": n_agree, "agree_errors": err_agree}
        print(f"{pname:22s} {mh['pose'] * 100:8.2f}% {mh['x'] * 100:6.2f}% {mh['y'] * 100:6.2f}% {mh['errors']:5d} | {mi['pose'] * 100:8.2f}% {mi['errors']:7d} | {n_agree:5d} {err_agree:3d}")
    (WORK / "eval" / "stress_results.json").write_text(json.dumps(table), encoding="utf-8")


if __name__ == "__main__":
    main()
