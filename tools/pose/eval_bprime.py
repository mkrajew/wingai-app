"""Set B' (after the real YOLO and crop of the app): how do the methods read the pose of well cut wings in all four poses?

    python tools/pose/eval_bprime.py [--only name,name] [--hog hog-16x6-b8s --ink ink-k11-p1-thirds]

Uses only crops where the detector found the wing, the pose is clear and the crop is complete (all 19 landmarks inside, 1.5% from the border).
Templates are the ones trained on the development folds (work/eval/templates_<method>.npy), so the wings are unseen.
"""
import argparse
import json

import numpy as np

import evalkit as K
import features as F
import methods as M
from config import EVAL, POSES, WORK
from rules import TAUS, ink_views

BP = WORK / "bprime"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--hog", default="hog-16x6-b8s")
    ap.add_argument("--ink", default="ink-k11-p1-thirds")
    a = ap.parse_args()
    meta = json.loads((BP / "meta.json").read_text(encoding="utf-8"))
    z = np.load(BP / "crops.npz")
    g, valid = z["g"], z["valid"]
    det = [m["detected"] for m in meta]
    print(f"synthetic photos: {len(meta)}; the detector found a wing in {sum(det)} ({sum(det) / len(meta) * 100:.2f}%)")
    sure = np.array([m.get("sure", False) for m in meta])
    comp = np.array([m.get("complete", False) for m in meta])
    good = np.array(det) & sure & comp
    print(f"clear pose: {int(sure.sum())}; complete among them: {int(good.sum())}  (cut by the detector: {int((sure & ~comp).sum())})")
    pose = np.array([POSES.index(m["pose"]) if m.get("pose") else -1 for m in meta])
    country = np.array([m["cc"] for m in meta])
    theta = np.array([m["theta"] for m in meta])
    print("poses of the good crops:", {p: int(((pose == i) & good).sum()) for i, p in enumerate(POSES)})
    ax = np.abs(((theta + 45) % 90) - 45)  # distance of the turn from the nearest multiple of 90 degrees
    axis_like = ax < 6
    print(f"turns within 6 degrees of 0/90/180/270 (the wing axis on the boundary of the axis normalisation): {int((axis_like & good).sum())}")
    idx = np.where(good)[0]
    imgs = [g[i] for i in idx]
    valids = [valid[i] for i in idx]
    truth = pose[idx]
    cn, ax_ = country[idx], axis_like[idx]
    methods = M.load()
    if a.only:
        methods = [m for m in methods if m["name"] in a.only.split(",")]
    out, preds, margins = {}, {}, {}
    print(f"\n{'method':26s} {'errors':>8s} {'acc':>9s} | errors per true pose: id rot180 flipH flipV | axis-like | worst country")
    for m in methods:
        name = m["name"]
        if m["kind"] == "template":
            tp = EVAL / f"templates_{name}.npy"
            if not tp.exists():
                continue
            reps = K.reps_of_list(imgs, m["spec"], valids)[0]
            pred, mg = F.decide(F.scores(reps, np.load(tp)))
        else:
            stats = [F.ink_stats_for(x, m["spec"], v) for x, v in zip(imgs, valids)]
            pose_c, mg = K.ink_decision(stats, m["x"], m["y"])
            # the crop is NOT canonical here: the ink statistics give the pose of the crop as it is
            pred = pose_c
        preds[name], margins[name] = pred, mg
        wrong = pred != truth
        per = [int((wrong & (truth == i)).sum()) for i in range(4)]
        worst = max(((c, int((wrong & (cn == c)).sum()), int((cn == c).sum())) for c in sorted(set(cn.tolist()))), key=lambda t: t[1] / max(t[2], 1))
        print(f"{name:26s} {int(wrong.sum()):8d} {(1 - wrong.mean()) * 100:8.3f}% | {per[0]:12d} {per[1]:6d} {per[2]:5d} {per[3]:5d} | {int((wrong & ax_).sum()):9d} | {worst[0]} {worst[1]}/{worst[2]}")
        out[name] = {"errors": int(wrong.sum()), "n": int(truth.size), "per_pose_errors": per, "upper95": K.wilson_upper(int(wrong.sum()), int(truth.size))}

    if a.hog in preds and a.ink in preds:
        hp, hm, ip = preds[a.hog], margins[a.hog], preds[a.ink]
        print(f"\nconfusion matrix of {a.hog} (rows: true pose, columns: decided)")
        print("          " + " ".join(f"{p:>7s}" for p in POSES))
        for i, p in enumerate(POSES):
            print(f"  {p:7s} " + " ".join(f"{int(((truth == i) & (hp == j)).sum()):7d}" for j in range(4)))
        ok = hp == truth
        print(f"margin of the correct decisions: min {hm[ok].min():.3f}, 0.1% {np.percentile(hm[ok], 0.1):.3f}, 1% {np.percentile(hm[ok], 1):.3f}, median {np.median(hm[ok]):.3f}")
        if (~ok).any():
            print(f"margin of the wrong decisions: max {hm[~ok].max():.3f}, median {np.median(hm[~ok]):.3f}")
        print(f"\nthe rule: {a.hog} margin >= TAU and {a.ink} agrees")
        print("   tau  accepted  wrong among accepted  (95% upper bound)")
        for tau in TAUS:
            acc = (hm >= tau) & (hp == ip)
            err = int((acc & (hp != truth)).sum())
            print(f"  {tau:5.2f}  {acc.sum() / len(acc) * 100:7.2f}%  {err:10d}            {K.wilson_upper(err, int(acc.sum())) * 100:.3f}%")
        out["rule"] = {"hog": a.hog, "ink": a.ink}
        bad = np.where(hp != truth)[0]
        print("\nthe wrong decisions of", a.hog, ":", [(meta[idx[i]]["id"], POSES[truth[i]], POSES[hp[i]], round(float(hm[i]), 2)) for i in bad][:20])
    (BP / "results.json").write_text(json.dumps(out), encoding="utf-8")
    np.savez_compressed(BP / "outputs.npz", idx=idx, truth=truth, **{f"{k}__pred": v for k, v in preds.items()}, **{f"{k}__margin": v for k, v in margins.items()})


if __name__ == "__main__":
    main()
