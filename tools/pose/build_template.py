"""The template that will ship with the app: the average wing in each of the four poses, from the complete wings of ALL countries of set B
(straightened version), at most PER_COUNTRY wings of each country so that no country dominates. The real sets (A, A2) are not used,
so they stay a blind test of the shipped template.

    python tools/pose/build_template.py [--per-country 800]  -> work/ship/templates.npy, work/ship/templates.json, work/ship/check.json
"""
import argparse
import json
import multiprocessing as mp

import numpy as np

import evalkit as K
import features as F
from config import COUNTRIES, POSES, WORK
from methods import DEFAULT_METHODS

SHIP = WORK / "ship"
HOG = next(m for m in DEFAULT_METHODS if m["name"] == "hog-16x6-b8s")["spec"]
INK = next(m for m in DEFAULT_METHODS if m["name"] == "ink-k11-p1-thirds")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-country", type=int, default=800)
    a = ap.parse_args()
    SHIP.mkdir(parents=True, exist_ok=True)
    complete = json.loads((WORK / "B" / "complete.json").read_text(encoding="utf-8"))
    imgs, names, country, folds = K.load_b("g_det")
    ok = np.array([complete[c][n] >= 0.015 for c, n in zip(country, names)])
    rng = np.random.default_rng(21)
    pick = []
    for cc in COUNTRIES:
        idx = np.where((country == cc) & ok)[0]
        pick += list(rng.choice(idx, min(a.per_country, len(idx)), replace=False))
    pick = np.array(sorted(pick))
    np.save(SHIP / "train.npy", imgs[pick])
    print(f"template from {len(pick)} complete wings of {len(COUNTRIES)} countries")
    with mp.Pool(14) as pool:
        reps = K.reps_of_array(SHIP / "train.npy", len(pick), HOG, pool)
    templates = K.templates_of(reps).astype(np.float32)
    np.save(SHIP / "templates.npy", templates)
    (SHIP / "templates.json").write_text(json.dumps({"spec": HOG, "poses": list(POSES), "templates": [[round(float(v), 5) for v in row] for row in templates]}), encoding="utf-8")
    print("descriptor length", templates.shape[1])

    # blind test on the real sets
    real = K.load_real()
    truth = np.array([POSES.index(r["pose"]) for r in real])
    reps_a = K.reps_of_list([r["g"] for r in real], HOG, [r["valid"] for r in real])[0]
    best, margin = F.decide(F.scores(reps_a, templates))
    stats = [F.ink_stats_for(r["g"], INK["spec"], r["valid"]) for r in real]
    ink_pose, _ = K.ink_decision(stats, INK["x"], INK["y"])
    out = {}
    for name, sel in (("A main, sure, unflagged", [r["main"] and r["sure"] and not r["check"] for r in real]),
                      ("A all, sure, unflagged", [r["sure"] and not r["check"] for r in real])):
        sel = np.array(sel)
        accepted = sel & (margin >= 0.10) & (best == ink_pose)
        out[name] = {"n": int(sel.sum()), "hog_errors": int((best[sel] != truth[sel]).sum()), "ink_errors": int((ink_pose[sel] != truth[sel]).sum()),
                     "accepted": int(accepted.sum()), "errors_among_accepted": int((best[accepted] != truth[accepted]).sum())}
        print(name, out[name])
    small = K.load_pulawy_small()
    truth_s = np.array([POSES.index(r["pose"]) for r in small])
    reps_s = K.reps_of_list([r["g"] for r in small], HOG)[0]
    best_s, margin_s = F.decide(F.scores(reps_s, templates))
    ink_s, _ = K.ink_decision([F.ink_stats_for(r["g"], INK["spec"]) for r in small], INK["x"], INK["y"])
    sel = np.array([r["sure"] and not r["check"] for r in small])
    accepted = sel & (margin_s >= 0.10) & (best_s == ink_s)
    out["A2 sure, unflagged"] = {"n": int(sel.sum()), "hog_errors": int((best_s[sel] != truth_s[sel]).sum()), "ink_errors": int((ink_s[sel] != truth_s[sel]).sum()),
                                 "accepted": int(accepted.sum()), "errors_among_accepted": int((best_s[accepted] != truth_s[accepted]).sum())}
    print("A2", out["A2 sure, unflagged"])
    (SHIP / "check.json").write_text(json.dumps(out), encoding="utf-8")


if __name__ == "__main__":
    main()
