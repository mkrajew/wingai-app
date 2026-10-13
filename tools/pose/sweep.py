"""Sweep of the candidate methods on set B (development part): which variant reads the pose best?

    python tools/pose/sweep.py hog|ink|ghist [--set det|asis] [--per-country N]

The sample is drawn from the development folds only (the holdout fold is never touched here). Template methods are scored with
4-fold cross validation by colony: the templates of a fold are the average wing of the other folds. Every sample is shown in all four poses.
Ink methods need no templates; their statistics are antisymmetric under the flips, so the canonical picture decides for all four poses
(checked in check_equivariance()).
"""
import argparse
import itertools
import json
import multiprocessing as mp
import time

import numpy as np

import features as F
from common import all_poses, fold_of, group_of
from config import COUNTRIES, POSES, WORK

SUB = WORK / "sweep"
HOLDOUT_FOLD = 4
_G = None


# ------------------------------------------------------------------------------------------------------------- the sample
def make_subsample(per_country, seed=1):
    SUB.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    keep = {"det": [], "asis": []}
    names, country, fold = [], [], []
    for cc in COUNTRIES:
        z = np.load(WORK / "B" / f"{cc}.npz")
        n = z["names"]
        folds = np.array([fold_of(group_of(str(x))) for x in n])
        dev = np.where(folds != HOLDOUT_FOLD)[0]
        pick = rng.choice(dev, min(per_country, len(dev)), replace=False)
        pick.sort()
        keep["det"].append(z["g_det"][pick])
        keep["asis"].append(z["g_asis"][pick])
        names += [str(x) for x in n[pick]]
        country += [cc] * len(pick)
        fold += list(folds[pick])
    for k in keep:
        np.save(SUB / f"sub_{k}.npy", np.concatenate(keep[k]))
    np.savez(SUB / "meta.npz", names=np.array(names), country=np.array(country), fold=np.array(fold))
    print(f"sample: {len(names)} wings from {len(COUNTRIES)} countries")


def _init(path):
    global _G
    _G = np.load(path, mmap_mode="r")


def _reps(args):
    spec, s, e = args
    out = []
    for i in range(s, e):
        ps = all_poses(np.asarray(_G[i]))
        out.append(np.stack([F.rep_one(ps[p], spec) for p in POSES]))
    return np.stack(out, axis=1)  # (4, n, D)


def _ink(args):
    spec, s, e = args
    return [F.ink_stats_for(np.asarray(_G[i]), spec) for i in range(s, e)]


def chunks(n, size=96):
    return [(i, min(n, i + size)) for i in range(0, n, size)]


# ------------------------------------------------------------------------------------------------------------ scoring
def load_complete(meta):
    comp = json.loads((WORK / "B" / "complete.json").read_text(encoding="utf-8"))
    return np.array([comp[str(cc)][str(n)] >= 0.015 for cc, n in zip(meta["country"], meta["names"])])


def score_templates(reps, folds, countries, complete=None):
    """4-fold cross validation by colony fold. reps: (4, N, D). Returns the metrics of the variant, the predictions and the margins."""
    n = reps.shape[1]
    dev_folds = sorted(set(folds.tolist()))
    pred = np.zeros((4, n), np.int8)
    margin = np.zeros((4, n), np.float32)
    for k in dev_folds:
        train, test = folds != k, folds == k
        templates = np.stack([reps[p][train].mean(0) for p in range(4)])
        for p in range(4):
            sc = F.scores(reps[p][test], templates)
            best, mg = F.decide(sc)
            pred[p, test], margin[p, test] = best, mg
    res = summarise(pred, margin, countries)
    if complete is not None:
        c = summarise(pred[:, complete], margin[:, complete], countries[complete])
        res.update({"pose_c": c["pose"], "x_c": c["x"], "y_c": c["y"], "errors_c": c["errors"], "n_c": c["n"], "worst_country_c": c["worst_country"],
                    "margin_min_ok_c": c["margin_min_ok"], "margin_max_wrong_c": c["margin_max_wrong"]})
    return res, pred, margin


def summarise(pred, margin, countries):
    truth = np.arange(4)[:, None]
    ok = pred == truth
    x_true = np.array([1, -1, -1, 1])[:, None]
    y_true = np.array([1, -1, 1, -1])[:, None]
    x_pred = np.array([1, -1, -1, 1])[pred]
    y_pred = np.array([1, -1, 1, -1])[pred]
    per_country = {cc: float(ok[:, countries == cc].mean()) for cc in sorted(set(countries.tolist()))}
    return {
        "pose": float(ok.mean()),
        "x": float((x_pred == x_true).mean()),
        "y": float((y_pred == y_true).mean()),
        "errors": int((~ok).sum()),
        "n": int(ok.size),
        "worst_country": min(per_country.items(), key=lambda kv: kv[1]),
        "margin_min_ok": float(margin[ok].min()) if ok.any() else 0.0,
        "margin_p1_ok": float(np.percentile(margin[ok], 1)) if ok.any() else 0.0,
        "margin_max_wrong": float(margin[~ok].max()) if (~ok).any() else 0.0,
    }


# --------------------------------------------------------------------------------------------------------------- the grids
def hog_grid():
    out = []
    for cells, bins, signed, inp, norm, sigma in itertools.product(
        [(8, 3), (16, 6), (32, 12)], [4, 8, 16], [True, False], ["gray", "vein"], ["sqrt", "none"], [0.0, 1.0]
    ):
        if not signed and bins == 4:
            continue
        out.append({"kind": "hog", "cells": cells, "bins": bins, "signed": signed, "input": inp, "norm": norm, "sigma": sigma})
    return out


def ghist_grid():
    return [
        {"kind": "ghist", "bins": b, "signed": s, "input": i, "norm": "sqrt"}
        for b, s, i in itertools.product([8, 16, 32], [True, False], ["gray", "vein"])
    ]


def ink_grid():
    return [{"k": k, "off": off, "power": pw} for k, off, pw in itertools.product([11, 15, 21, 31], [4, 8, 12, 20], [1.0, 2.0])]


INK_STATS = ["x_thirds", "x_halves", "x_centroid", "x_skew", "y_bands", "y_halves", "y_centroid", "y_thick"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("family", choices=["hog", "ink", "ghist"])
    ap.add_argument("--set", default="det", choices=["det", "asis"])
    ap.add_argument("--per-country", type=int, default=300)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--specs-json", help="a json list of specs to evaluate instead of the grid; the predictions are saved")
    ap.add_argument("--tag", default="")
    args = ap.parse_args()
    if args.rebuild or not (SUB / "meta.npz").exists():
        make_subsample(args.per_country)
    meta = np.load(SUB / "meta.npz")
    folds, countries = meta["fold"], meta["country"]
    n = len(folds)
    path = SUB / f"sub_{args.set}.npy"
    results = []
    t0 = time.time()
    with mp.Pool(14, initializer=_init, initargs=(str(path),)) as pool:
        if args.family == "ink":
            for spec in ink_grid():
                rows = [r for part in pool.map(_ink, [(spec, s, e) for s, e in chunks(n)]) for r in part]
                complete = load_complete(meta)
                res = {}
                for st in INK_STATS:
                    v = np.array([r[st] for r in rows])
                    res[st] = float((v[complete] > 0).mean())  # complete canonical wings: the statistic must be positive
                    res[st + "_all"] = float((v > 0).mean())
                res["spec"] = spec
                results.append(res)
                print(f"ink {spec}  " + " ".join(f"{st}={res[st] * 100:.2f}" for st in INK_STATS) + "   (complete wings only)", flush=True)
        else:
            grid = json.loads(open(args.specs_json, encoding="utf-8").read()) if args.specs_json else (hog_grid() if args.family == "hog" else ghist_grid())
            complete = load_complete(meta)
            saved = {}
            for k, spec in enumerate(grid):
                parts = pool.map(_reps, [(spec, s, e) for s, e in chunks(n)])
                reps = np.concatenate(parts, axis=1)
                res, pred, margin = score_templates(reps, folds, countries, complete)
                res["spec"] = spec
                results.append(res)
                saved[f"pred_{k}"], saved[f"margin_{k}"] = pred, margin
                print(
                    f"{args.family} {json.dumps(spec)}  pose {res['pose'] * 100:.3f}% (errors {res['errors']}/{res['n']}) x {res['x'] * 100:.2f} y {res['y'] * 100:.2f}"
                    f"  | complete only: pose {res['pose_c'] * 100:.3f}% (errors {res['errors_c']}/{res['n_c']}) x {res['x_c'] * 100:.2f} y {res['y_c'] * 100:.2f}"
                    f"  worst {res['worst_country_c'][0]} {res['worst_country_c'][1] * 100:.1f}  [{time.time() - t0:.0f}s]",
                    flush=True,
                )
            if args.specs_json:
                np.savez_compressed(SUB / f"preds_{args.family}_{args.set}{args.tag}.npz", folds=folds, countries=countries, complete=complete, **saved)
    out = SUB / f"results_{args.family}_{args.set}{args.tag}.json"
    out.write_text(json.dumps(results, default=str), encoding="utf-8")
    print("saved", out)


if __name__ == "__main__":
    main()
