"""Shared pieces of the evaluation: loading the sets, computing descriptors in parallel, templates, decisions, metrics."""
import json
import multiprocessing as mp
from pathlib import Path

import cv2
import numpy as np

import features as F
from common import all_poses, fold_of, group_of, luma, shrink, wilson_upper
from config import COUNTRIES, H, POSES, W, WORK

HOLDOUT_FOLD = 4
POSE_X = np.array([1, -1, -1, 1])
POSE_Y = np.array([1, -1, 1, -1])


# ------------------------------------------------------------------------------------------------------------------ loading
def load_b(key="g_det"):
    """Set B: (images (N, H, W) uint8, names, country, fold). key: g_det (straightened like a crop of the app) or g_asis (as in the database)."""
    arrs, names, country = [], [], []
    for cc in COUNTRIES:
        z = np.load(WORK / "B" / f"{cc}.npz")
        arrs.append(z[key])
        names += [str(x) for x in z["names"]]
        country += [cc] * len(z["names"])
    folds = np.array([fold_of(group_of(n)) for n in names])
    return np.concatenate(arrs), np.array(names), np.array(country), folds


def real_gray(path):
    """A crop of the app (png) at the working size, with the mask of the part that is really photo (the crop is black outside the photo)."""
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    gray = luma(img)
    g = shrink(gray)
    valid = cv2.resize((gray > 6).astype(np.uint8) * 255, (W, H), interpolation=cv2.INTER_AREA) > 250
    return g, valid


def load_real():
    """Set A: the real crops with the backend truth. Returns a list of dicts."""
    meta = json.loads((WORK / "real" / "meta.json").read_text(encoding="utf-8"))
    labels = json.loads((WORK / "real" / "labels.json").read_text(encoding="utf-8"))
    from labels import pose_name, sure  # torch only here

    out = []
    for cid, m in meta.items():
        lab = labels.get(cid)
        if not lab:
            continue
        g, valid = real_gray(WORK / "real" / f"{cid}.png")
        pose = pose_name(lab["det"], lab["angle"])
        out.append({"id": cid, "source": m["source"], "main": bool(m["main"]), "conf": m["confidence"], "check": lab["check"], "sure": sure(lab["angle"]),
                    "angle": lab["angle"], "pose": pose, "g": g, "valid": valid, "valid_frac": float(valid.mean())})
    return out


def load_pulawy_small():
    """Set A2: small, already cropped wings (Pulawy) with the backend truth."""
    from config import RAW_SETS
    from labels import pose_name, sure

    labels = json.loads((WORK / "real" / "labels_pulawy_small.json").read_text(encoding="utf-8"))
    out = []
    for rel, lab in labels.items():
        img = cv2.imread(str(RAW_SETS["pulawy"] / rel), cv2.IMREAD_COLOR)
        if img is None:
            continue
        gray = luma(img)
        out.append({"id": rel, "check": lab["check"], "sure": sure(lab["angle"]), "angle": lab["angle"], "pose": pose_name(lab["det"], lab["angle"]),
                    "g": shrink(gray), "valid": np.ones((H, W), bool), "valid_frac": 1.0})
    return out


# ----------------------------------------------------------------------------------------------------------- descriptors
def _rep_job(args):
    path, spec, s, e, poses = args
    arr = np.load(path, mmap_mode="r")
    out = []
    for i in range(s, e):
        ps = all_poses(np.asarray(arr[i]))
        out.append(np.stack([F.rep_one(ps[p], spec) for p in poses]))
    return np.stack(out, axis=1)


def reps_of_array(arr_path, n, spec, pool, poses=POSES, chunk=96):
    """(len(poses), N, D) descriptors of the pictures stored in an .npy file, computed by the pool."""
    jobs = [(str(arr_path), spec, s, min(n, s + chunk), poses) for s in range(0, n, chunk)]
    return np.concatenate(pool.map(_rep_job, jobs), axis=1)


def reps_of_list(images, spec, valids=None):
    """Descriptors of a short list of pictures in the four poses (single process): (4, N, D)."""
    rows = []
    for k, g in enumerate(images):
        v = None if valids is None else valids[k]
        ps = all_poses(g)
        vs = all_poses(v) if v is not None else {p: None for p in POSES}
        rows.append(np.stack([F.rep_one(ps[p], spec, vs[p]) for p in POSES]))
    return np.stack(rows, axis=1)


def templates_of(reps):
    """The average wing in each of the four poses: reps (4, N, D) of the training pictures -> (4, D)."""
    return np.stack([reps[p].mean(0) for p in range(4)])


# ----------------------------------------------------------------------------------------------------------------- decisions
def predict(reps, templates):
    """reps (4, N, D) of test pictures (row p: shown in pose p) -> predicted pose index and margin, both (4, N)."""
    pred = np.zeros(reps.shape[:2], np.int8)
    margin = np.zeros(reps.shape[:2], np.float32)
    for p in range(4):
        best, mg = F.decide(F.scores(reps[p], templates))
        pred[p], margin[p] = best, mg
    return pred, margin


def ink_decision(stats_list, x_stat, y_stat):
    """From the statistics of the canonical pictures: for each picture the pose it is in (index), assuming nothing about it."""
    x = np.array([s[x_stat] for s in stats_list])
    y = np.array([s[y_stat] for s in stats_list])
    pose = np.where(x > 0, np.where(y > 0, 0, 3), np.where(y > 0, 2, 1))  # (x+,y+)=id, (x+,y-)=flipV, (x-,y+)=flipH, (x-,y-)=rot180
    return pose, np.minimum(np.abs(x), np.abs(y))


def metrics(pred, truth):
    """pred, truth: arrays of pose indexes."""
    pred, truth = np.asarray(pred), np.asarray(truth)
    n = truth.size
    ok = pred == truth
    x_ok = POSE_X[pred] == POSE_X[truth]
    y_ok = POSE_Y[pred] == POSE_Y[truth]
    errors = int((~ok).sum())
    return {"n": int(n), "pose": float(ok.mean()) if n else float("nan"), "x": float(x_ok.mean()) if n else float("nan"),
            "y": float(y_ok.mean()) if n else float("nan"), "errors": errors, "upper95": wilson_upper(errors, n)}


def fmt(m):
    return f"n={m['n']:6d} pose {m['pose'] * 100:7.3f}%  x {m['x'] * 100:7.3f}%  y {m['y'] * 100:7.3f}%  errors {m['errors']:4d}  (95% upper bound {m['upper95'] * 100:.2f}%)"
