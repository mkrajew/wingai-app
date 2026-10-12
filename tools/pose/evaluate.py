"""Evaluation of every candidate method (methods.py) on every set.

    python tools/pose/evaluate.py [--train-per-country 600] [--loco-per-country 400] [--only name,name]

Templates (the average wing in the four poses) are made from the development folds of set B only (straightened version).
  Bdet / Basis : the holdout fold 4 of set B, never used for any choice; straightened like a crop of the app / as in the database
  LOCO         : templates from the other 12 countries, tested on a sample of the left out country (complete wings)
  A            : the real crops of the app (truth: the backend)        A2: small, already cropped wings of Pulawy (truth: the backend)
Writes work/eval/results.json (all metrics) and work/eval/outputs.npz (every prediction, for compare.py, rules.py, gallery.py).
"""
import argparse
import json
import multiprocessing as mp

import numpy as np

import evalkit as K
import features as F
import methods as M
from config import COUNTRIES, EVAL, POSES, WORK
from rules import ink_views


def _ink_job(args):
    path, spec, s, e = args
    arr = np.load(path, mmap_mode="r")
    return [F.ink_stats_for(np.asarray(arr[i]), spec) for i in range(s, e)]


def ink_stats_of_array(path, n, spec, pool, chunk=128):
    return [r for part in pool.map(_ink_job, [(str(path), spec, s, min(n, s + chunk)) for s in range(0, n, chunk)]) for r in part]


def ink_pred(stats, m):
    pose, margin = K.ink_decision(stats, m["x"], m["y"])
    return pose, margin


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-per-country", type=int, default=600)
    ap.add_argument("--loco-per-country", type=int, default=400)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    EVAL.mkdir(parents=True, exist_ok=True)
    methods = M.load()
    if a.only:
        methods = [m for m in methods if m["name"] in a.only.split(",")]
    complete = json.loads((WORK / "B" / "complete.json").read_text(encoding="utf-8"))
    rng = np.random.default_rng(11)
    res, out = {}, {}

    # ------------------------------------------------------------------------------------------------ the sets, written once
    imgs, names, country, folds = K.load_b("g_det")
    is_complete = np.array([complete[c][n] >= 0.015 for c, n in zip(country, names)])
    dev = np.where(folds != K.HOLDOUT_FOLD)[0]
    train = np.array(sorted(i for cc in COUNTRIES for i in rng.choice(dev[country[dev] == cc], min(a.train_per_country, int((country[dev] == cc).sum())), replace=False)))
    np.save(EVAL / "train_det.npy", imgs[train])
    c_train = country[train]
    hold = np.where(folds == K.HOLDOUT_FOLD)[0]
    sets = {"Bdet": (EVAL / "hold_det.npy", hold, is_complete[hold], country[hold])}
    np.save(EVAL / "hold_det.npy", imgs[hold])
    imgs_asis, *_ = K.load_b("g_asis")
    np.save(EVAL / "hold_asis.npy", imgs_asis[hold])
    sets["Basis"] = (EVAL / "hold_asis.npy", hold, is_complete[hold], country[hold])
    del imgs_asis
    loco_idx = np.array(sorted(i for cc in COUNTRIES for i in rng.choice(np.where((country == cc) & is_complete)[0], min(a.loco_per_country, int(((country == cc) & is_complete).sum())), replace=False)))
    np.save(EVAL / "loco.npy", imgs[loco_idx])
    loco_country = country[loco_idx]
    del imgs
    real = K.load_real()
    small = K.load_pulawy_small() if (WORK / "real" / "labels_pulawy_small.json").exists() else []
    print(f"train {len(train)} wings, holdout {len(hold)} ({int(is_complete[hold].sum())} complete), loco {len(loco_idx)}, real crops {len(real)}, small Pulawy {len(small)}")
    truth_real = np.array([POSES.index(r["pose"]) for r in real])
    strata = {
        "main sure unflagged": np.array([r["main"] and r["sure"] and not r["check"] for r in real]),
        "main sure": np.array([r["main"] and r["sure"] for r in real]),
        "all sure unflagged": np.array([r["sure"] and not r["check"] for r in real]),
    }
    for src in ("swietokrzyskie", "bm", "pulawy"):
        strata[f"main sure unflagged {src}"] = np.array([r["source"] == src and r["main"] and r["sure"] and not r["check"] for r in real])
    truth_small = np.array([POSES.index(r["pose"]) for r in small]) if small else None
    sel_small = np.array([r["sure"] and not r["check"] for r in small]) if small else None

    with mp.Pool(14) as pool:
        for m in methods:
            name = m["name"]
            r = res.setdefault(name, {})
            print(f"\n=== {name}", flush=True)
            if m["kind"] == "template":
                spec = m["spec"]
                reps_train = K.reps_of_array(EVAL / "train_det.npy", len(train), spec, pool, aug=m.get("aug"))
                templates = K.templates_of(reps_train)
                np.save(EVAL / f"templates_{name}.npy", templates)
                for sname, (path, idx, comp, cn) in sets.items():
                    reps = K.reps_of_array(path, len(idx), spec, pool)
                    pred, margin = K.predict(reps, templates)
                    out[f"{name}__{sname}__pred"], out[f"{name}__{sname}__margin"] = pred, margin
                    truth = np.arange(4)[:, None] * np.ones_like(pred)
                    r[sname] = {"complete": K.metrics(pred[:, comp].ravel(), truth[:, comp].ravel()), "all": K.metrics(pred.ravel(), truth.ravel())}
                    print(f"  {sname:6s} complete: {K.fmt(r[sname]['complete'])}", flush=True)
                # leave one country out
                reps = K.reps_of_array(EVAL / "loco.npy", len(loco_idx), spec, pool)
                lo = {}
                preds_l = np.zeros(reps.shape[:2], np.int8)
                margins_l = np.zeros(reps.shape[:2], np.float32)
                for cc in COUNTRIES:
                    t = K.templates_of(reps_train[:, c_train != cc])
                    mask = loco_country == cc
                    p, mg = K.predict(reps[:, mask], t)
                    preds_l[:, mask], margins_l[:, mask] = p, mg
                    lo[cc] = K.metrics(p.ravel(), (np.arange(4)[:, None] * np.ones_like(p)).ravel())
                out[f"{name}__LOCO__pred"], out[f"{name}__LOCO__margin"] = preds_l, margins_l
                r["LOCO"] = lo
                tot_err = sum(v["errors"] for v in lo.values())
                tot_n = sum(v["n"] for v in lo.values())
                print(f"  LOCO   errors {tot_err}/{tot_n}; worst country: " + ", ".join(f"{c} {v['pose'] * 100:.2f}%" for c, v in sorted(lo.items(), key=lambda kv: kv[1]['pose'])[:3]), flush=True)
                # real crops
                reps_a = K.reps_of_list([x["g"] for x in real], spec, [x["valid"] for x in real])[0]
                pa, ma = F.decide(F.scores(reps_a, templates))
                out[f"{name}__A__pred"], out[f"{name}__A__margin"] = pa, ma
                r["A"] = {s: K.metrics(pa[sel], truth_real[sel]) for s, sel in strata.items()}
                if small:
                    reps_s = K.reps_of_list([x["g"] for x in small], spec)[0]
                    ps_, ms_ = F.decide(F.scores(reps_s, templates))
                    out[f"{name}__A2__pred"], out[f"{name}__A2__margin"] = ps_, ms_
                    r["A2"] = K.metrics(ps_[sel_small], truth_small[sel_small])
            else:
                spec = m["spec"]
                for sname, (path, idx, comp, cn) in sets.items():
                    stats = ink_stats_of_array(path, len(idx), spec, pool)
                    pose, margin = ink_pred(stats, m)
                    views = ink_views(pose)
                    out[f"{name}__{sname}__pred"], out[f"{name}__{sname}__margin"] = views.astype(np.int8), np.stack([margin] * 4).astype(np.float32)
                    truth = np.arange(4)[:, None] * np.ones_like(views)
                    r[sname] = {"complete": K.metrics(views[:, comp].ravel(), truth[:, comp].ravel()), "all": K.metrics(views.ravel(), truth.ravel())}
                    print(f"  {sname:6s} complete: {K.fmt(r[sname]['complete'])}", flush=True)
                stats = ink_stats_of_array(EVAL / "loco.npy", len(loco_idx), spec, pool)
                pose, margin = ink_pred(stats, m)
                lo = {cc: K.metrics(pose[loco_country == cc], np.zeros(int((loco_country == cc).sum()), int)) for cc in COUNTRIES}
                out[f"{name}__LOCO__pred"] = ink_views(pose).astype(np.int8)
                out[f"{name}__LOCO__margin"] = np.stack([margin] * 4).astype(np.float32)
                r["LOCO"] = lo
                print(f"  LOCO   errors {sum(v['errors'] for v in lo.values())}/{sum(v['n'] for v in lo.values())} wings (canonical view; antisymmetric for the other poses)", flush=True)
                stats_a = [F.ink_stats_for(x["g"], spec, x["valid"]) for x in real]
                pa, ma = ink_pred(stats_a, m)
                out[f"{name}__A__pred"], out[f"{name}__A__margin"] = pa, ma.astype(np.float32)
                r["A"] = {s: K.metrics(pa[sel], truth_real[sel]) for s, sel in strata.items()}
                if small:
                    stats_s = [F.ink_stats_for(x["g"], spec) for x in small]
                    ps_, ms_ = ink_pred(stats_s, m)
                    out[f"{name}__A2__pred"], out[f"{name}__A2__margin"] = ps_, ms_.astype(np.float32)
                    r["A2"] = K.metrics(ps_[sel_small], truth_small[sel_small])
            for s in ("main sure unflagged", "all sure unflagged"):
                print(f"  A [{s}]: {K.fmt(r['A'][s])}")
            if small:
                print(f"  A2 small Pulawy (sure, not flagged): {K.fmt(r['A2'])}", flush=True)

    out["meta__A__ids"] = np.array([x["id"] for x in real])
    out["meta__A__truth"] = truth_real
    out["meta__A__main"] = np.array([x["main"] for x in real])
    out["meta__A__sure"] = np.array([x["sure"] for x in real])
    out["meta__A__check"] = np.array([x["check"] for x in real])
    out["meta__A__source"] = np.array([x["source"] for x in real])
    if small:
        out["meta__A2__truth"] = truth_small
        out["meta__A2__sure"] = np.array([x["sure"] for x in small])
        out["meta__A2__check"] = np.array([x["check"] for x in small])
        out["meta__A2__ids"] = np.array([x["id"] for x in small])
    for sname, (path, idx, comp, cn) in sets.items():
        out[f"meta__{sname}__complete"] = comp
        out[f"meta__{sname}__country"] = cn
    out["meta__LOCO__country"] = loco_country
    (EVAL / "results.json").write_text(json.dumps(res, default=str), encoding="utf-8")
    np.savez_compressed(EVAL / "outputs.npz", **out)
    print("\nsaved results.json and outputs.npz in", EVAL)


if __name__ == "__main__":
    main()
