"""Final evaluation of the chosen HOG variant and the chosen ink variant on every set.

    python tools/pose/evaluate.py [--train-per-country 600]

Reads work/eval/finalists.json:  {"hog": {spec}, "ink": {"spec": {...}, "x": "x_thirds", "y": "y_halves"}}
Templates (the average wing in the four poses) are made from the development folds of set B only (straightened version).
  B holdout    : the fold 4 of set B, never used for any choice. Two versions: straightened (det) and as in the database (asis).
  B by country : templates from the other 12 countries, tested on a sample of the left out one.
  A            : the real crops of the app (backend truth).     A2: the small, already cropped wings of Pulawy (backend truth).
Writes work/eval/outputs.npz with every prediction and margin, for the rules and the report.
"""
import argparse
import json
import multiprocessing as mp
import sys

import numpy as np

import evalkit as K
import features as F
from common import all_poses
from config import COUNTRIES, POSES, WORK

EVAL = WORK / "eval"
TRAIN_FOLDS_EXCLUDED = K.HOLDOUT_FOLD


def _ink_job(args):
    path, spec, s, e = args
    arr = np.load(path, mmap_mode="r")
    return [F.ink_stats_for(np.asarray(arr[i]), spec) for i in range(s, e)]


def ink_of_array(path, n, spec, pool, chunk=128):
    jobs = [(str(path), spec, s, min(n, s + chunk)) for s in range(0, n, chunk)]
    return [r for part in pool.map(_ink_job, jobs) for r in part]


def per_country(pred_idx, country, truth_idx=0):
    out = {}
    for cc in COUNTRIES:
        m = country == cc
        if m.any():
            out[cc] = K.metrics(pred_idx[m], np.full(int(m.sum()), truth_idx))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-per-country", type=int, default=600)
    ap.add_argument("--loco-per-country", type=int, default=500)
    a = ap.parse_args()
    EVAL.mkdir(parents=True, exist_ok=True)
    fin = json.loads((EVAL / "finalists.json").read_text(encoding="utf-8"))
    hog_spec, ink = fin["hog"], fin["ink"]
    complete = json.loads((WORK / "B" / "complete.json").read_text(encoding="utf-8"))
    rng = np.random.default_rng(11)
    res = {}
    outputs = {}

    with mp.Pool(14) as pool:
        # ------------------------------------------------------------------------------------------- templates (set B, development folds)
        imgs, names, country, folds = K.load_b("g_det")
        dev = np.where(folds != K.HOLDOUT_FOLD)[0]
        train = []
        for cc in COUNTRIES:
            idx = dev[country[dev] == cc]
            train += list(rng.choice(idx, min(a.train_per_country, len(idx)), replace=False))
        train = np.array(sorted(train))
        np.save(EVAL / "train_det.npy", imgs[train])
        reps_train = K.reps_of_array(EVAL / "train_det.npy", len(train), hog_spec, pool)
        templates = K.templates_of(reps_train)
        np.save(EVAL / "templates_hog.npy", templates)
        print(f"templates from {len(train)} development wings of set B, descriptor length {templates.shape[1]}")

        # ------------------------------------------------------------------------------------------------- B holdout, both versions
        for key, tag in (("g_det", "B holdout, straightened"), ("g_asis", "B holdout, as in the database")):
            if key == "g_det":
                im, nm, cn, fo = imgs, names, country, folds
            else:
                im, nm, cn, fo = K.load_b(key)
            hold = np.where(fo == K.HOLDOUT_FOLD)[0]
            comp = np.array([complete[cn[i]][nm[i]] >= 0.015 for i in hold])
            path = EVAL / f"hold_{key}.npy"
            np.save(path, im[hold])
            reps = K.reps_of_array(path, len(hold), hog_spec, pool)
            pred, margin = K.predict(reps, templates)
            truth = np.arange(4)[:, None] * np.ones_like(pred)
            stats = ink_of_array(path, len(hold), ink["spec"], pool)
            ipose, imargin = K.ink_decision(stats, ink["x"], ink["y"])
            res[tag] = {"hog_all": K.metrics(pred.ravel(), truth.ravel()), "hog_complete": K.metrics(pred[:, comp].ravel(), truth[:, comp].ravel()),
                        "ink_all": K.metrics(ipose, np.zeros_like(ipose)), "ink_complete": K.metrics(ipose[comp], np.zeros(int(comp.sum()), int))}
            agree = pred[0] == ipose
            res[tag]["agree"] = {"n": int(agree.sum()), "of": int(agree.size), "errors": int((agree & (pred[0] != 0)).sum()),
                                 "n_complete": int((agree & comp).sum()), "of_complete": int(comp.sum()), "errors_complete": int((agree & comp & (pred[0] != 0)).sum())}
            outputs[key] = {"pred": pred, "margin": margin, "ink_pose": ipose, "ink_margin": imargin, "complete": comp, "country": cn[hold]}
            print(f"\n== {tag}: {len(hold)} wings x 4 poses ({int(comp.sum())} complete)")
            for k in ("hog_all", "hog_complete", "ink_all", "ink_complete"):
                print(f"  {k:13s} {K.fmt(res[tag][k])}")
            print(f"  both agree: {res[tag]['agree']}")
            print("  HOG per country (all four poses, complete or not):")
            pc = {}
            for cc in COUNTRIES:
                m = cn[hold] == cc
                if m.any():
                    pc[cc] = K.metrics(pred[:, m].ravel(), truth[:, m].ravel())
            res[tag]["hog_by_country"] = pc
            print("   " + "  ".join(f"{cc} {v['pose'] * 100:.2f}%({v['errors']})" for cc, v in pc.items()))
            del im

        # ------------------------------------------------------------------------------------- leave one country out (HOG)
        print("\n== leave one country out (templates from the other 12 countries; complete wings, a sample of each country):")
        c_train = country[train]
        loco = {}
        for cc in COUNTRIES:
            others = c_train != cc
            tmpl = K.templates_of(reps_train[:, others])
            idx = np.where((country == cc) & np.array([complete[cc][n] >= 0.015 for n in names]))[0]
            idx = np.sort(rng.choice(idx, min(a.loco_per_country, len(idx)), replace=False))
            path = EVAL / "loco.npy"
            np.save(path, imgs[idx])
            reps = K.reps_of_array(path, len(idx), hog_spec, pool)
            pred, margin = K.predict(reps, tmpl)
            truth = np.arange(4)[:, None] * np.ones_like(pred)
            loco[cc] = K.metrics(pred.ravel(), truth.ravel())
            print(f"  {cc}: {K.fmt(loco[cc])}")
        res["leave one country out"] = loco

    # ------------------------------------------------------------------------------------------ A: real crops of the app
    real = K.load_real()
    print(f"\n== A: real crops of the app: {len(real)} crops")
    imgs_real = [r["g"] for r in real]
    valids = [r["valid"] for r in real]
    reps_a = K.reps_of_list(imgs_real, hog_spec, valids)[0]  # the crop as it is
    sc = F.scores(reps_a, templates)
    best, margin = F.decide(sc)
    truth = np.array([POSES.index(r["pose"]) for r in real])
    stats = [F.ink_stats_for(r["g"], ink["spec"], r["valid"]) for r in real]
    ipose, imargin = K.ink_decision(stats, ink["x"], ink["y"])
    strata = {
        "main, sure, not flagged": lambda r: r["main"] and r["sure"] and not r["check"],
        "main, sure (flagged too)": lambda r: r["main"] and r["sure"],
        "all detections, sure, not flagged": lambda r: r["sure"] and not r["check"],
        "all detections, sure": lambda r: r["sure"],
    }
    res["A"] = {}
    for sname, fn in strata.items():
        sel = np.array([fn(r) for r in real])
        res["A"][sname] = {"hog": K.metrics(best[sel], truth[sel]), "ink": K.metrics(ipose[sel], truth[sel]),
                           "agree_n": int((best[sel] == ipose[sel]).sum()), "agree_errors": int(((best[sel] == ipose[sel]) & (best[sel] != truth[sel])).sum())}
        print(f"  [{sname}]  n={int(sel.sum())}\n     HOG {K.fmt(res['A'][sname]['hog'])}\n     ink {K.fmt(res['A'][sname]['ink'])}\n     agree {res['A'][sname]['agree_n']}, errors among agreeing {res['A'][sname]['agree_errors']}")
    for src in ("swietokrzyskie", "bm", "pulawy"):
        sel = np.array([r["source"] == src and r["main"] and r["sure"] and not r["check"] for r in real])
        res["A"][f"main, sure, not flagged, {src}"] = {"hog": K.metrics(best[sel], truth[sel]), "ink": K.metrics(ipose[sel], truth[sel])}
        print(f"  [{src}, main, sure, not flagged] n={int(sel.sum())}  HOG errors {res['A'][f'main, sure, not flagged, {src}']['hog']['errors']}  ink errors {res['A'][f'main, sure, not flagged, {src}']['ink']['errors']}")
    outputs["A"] = {"pred": best, "margin": margin, "ink_pose": ipose, "ink_margin": imargin, "truth": truth, "ids": np.array([r["id"] for r in real]),
                    "main": np.array([r["main"] for r in real]), "sure": np.array([r["sure"] for r in real]), "check": np.array([r["check"] for r in real]),
                    "source": np.array([r["source"] for r in real]), "valid_frac": np.array([r["valid_frac"] for r in real])}

    # ---------------------------------------------------------------------------------------------- A2: small Pulawy wings
    try:
        small = K.load_pulawy_small()
    except FileNotFoundError:
        small = []
    if small:
        print(f"\n== A2: small, already cropped Pulawy wings: {len(small)}")
        reps_s = K.reps_of_list([r["g"] for r in small], hog_spec)[0]
        best_s, margin_s = F.decide(F.scores(reps_s, templates))
        truth_s = np.array([POSES.index(r["pose"]) for r in small])
        stats_s = [F.ink_stats_for(r["g"], ink["spec"]) for r in small]
        ipose_s, imargin_s = K.ink_decision(stats_s, ink["x"], ink["y"])
        res["A2"] = {}
        for sname, fn in (("sure, not flagged", lambda r: r["sure"] and not r["check"]), ("sure", lambda r: r["sure"])):
            sel = np.array([fn(r) for r in small])
            res["A2"][sname] = {"hog": K.metrics(best_s[sel], truth_s[sel]), "ink": K.metrics(ipose_s[sel], truth_s[sel])}
            print(f"  [{sname}] n={int(sel.sum())}\n     HOG {K.fmt(res['A2'][sname]['hog'])}\n     ink {K.fmt(res['A2'][sname]['ink'])}")
        print("  poses of the small wings (backend):", {p: int((truth_s == i).sum()) for i, p in enumerate(POSES)})
        outputs["A2"] = {"pred": best_s, "margin": margin_s, "ink_pose": ipose_s, "ink_margin": imargin_s, "truth": truth_s,
                         "sure": np.array([r["sure"] for r in small]), "check": np.array([r["check"] for r in small]), "ids": np.array([r["id"] for r in small])}

    (EVAL / "results.json").write_text(json.dumps(res, default=str), encoding="utf-8")
    flat = {f"{k}__{kk}": v for k, d in outputs.items() for kk, v in d.items()}
    np.savez_compressed(EVAL / "outputs.npz", **flat)
    print("\nsaved results.json and outputs.npz in", EVAL)


if __name__ == "__main__":
    main()
