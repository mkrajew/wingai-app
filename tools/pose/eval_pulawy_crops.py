"""Set A2': the small Pulawy wings after the real YOLO and crop, in all four poses (truth: the backend, only crops that it is sure about and does not flag).

    python tools/pose/eval_pulawy_crops.py [--hog hog-16x6-b8s --ink ink-k11-p1-thirds]
"""
import argparse
import json

import numpy as np

import evalkit as K
import features as F
import methods as M
from config import EVAL, POSES, WORK
from labels import pose_name, sure
from rules import TAUS

FOLDER = WORK / "pulawy_crops"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hog", default="hog-16x6-b8s")
    ap.add_argument("--ink", default="ink-k11-p1-thirds")
    a = ap.parse_args()
    meta = json.loads((FOLDER / "meta.json").read_text(encoding="utf-8"))
    labels = json.loads((FOLDER / "labels.json").read_text(encoding="utf-8"))
    det = [cid for cid, m in meta.items() if m["detected"]]
    print(f"{len(meta)} small wings, the detector found a wing in {len(det)}; labelled by the backend: {len(labels)}")
    ids = [cid for cid in det if cid in labels]
    flagged = [cid for cid in ids if labels[cid]["check"]]
    unsure = [cid for cid in ids if not sure(labels[cid]["angle"])]
    good = [cid for cid in ids if not labels[cid]["check"] and sure(labels[cid]["angle"])]
    print(f"flagged by the backend: {len(flagged)}; angle not clear: {len(unsure)}; used (sure and not flagged): {len(good)}")
    truth = np.array([POSES.index(pose_name(labels[c]["det"], labels[c]["angle"])) for c in good])
    print("poses:", {p: int((truth == i).sum()) for i, p in enumerate(POSES)})
    gv = [K.real_gray(FOLDER / f"{c}.png") for c in good]
    imgs, valids = [x[0] for x in gv], [x[1] for x in gv]
    methods = [m for m in M.load() if m["name"] in (a.hog, a.ink) or m["name"].startswith(("hog-16x6-b8s", "ink-k11"))]
    preds, margins = {}, {}
    print(f"\n{'method':26s} {'errors':>7s} {'accuracy':>9s} | wrong per true pose: id rot180 flipH flipV")
    for m in methods:
        name = m["name"]
        if m["kind"] == "template":
            tp = EVAL / f"templates_{name}.npy"
            if not tp.exists():
                continue
            reps = K.reps_of_list(imgs, m["spec"], valids)[0]
            pred, mg = F.decide(F.scores(reps, np.load(tp)))
        else:
            pred, mg = K.ink_decision([F.ink_stats_for(x, m["spec"], v) for x, v in zip(imgs, valids)], m["x"], m["y"])
        preds[name], margins[name] = pred, mg
        wrong = pred != truth
        per = [int((wrong & (truth == i)).sum()) for i in range(4)]
        print(f"{name:26s} {int(wrong.sum()):7d} {(1 - wrong.mean()) * 100:8.3f}% | {per[0]:20d} {per[1]:6d} {per[2]:5d} {per[3]:5d}")
    hp, hm, ip = preds[a.hog], margins[a.hog], preds[a.ink]
    ok = hp == truth
    print(f"\nmargin of the correct HOG decisions: min {hm[ok].min():.3f}, 1% {np.percentile(hm[ok], 1):.3f}, median {np.median(hm[ok]):.3f}")
    print("the rule (HOG margin >= TAU and ink agrees):  " + "  ".join(f"{t:.2f}: {int(((hm >= t) & (hp == ip)).sum())}/{len(hp)} acc, {int(((hm >= t) & (hp == ip) & (hp != truth)).sum())} err" for t in TAUS[:7]))
    print("wrong HOG decisions:", [(good[i], POSES[truth[i]], POSES[hp[i]], round(float(hm[i]), 2)) for i in np.where(~ok)[0]][:15])


if __name__ == "__main__":
    main()
