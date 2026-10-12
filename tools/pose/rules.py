"""The "unsure" rule: when is the pose read from the pixels trusted?

A pose is accepted when the margin of the HOG decision (best minus second best correlation) is at least TAU and the ink method says the
same pose. Everything else is "unsure": the wing is left as it is and the old way (the answer of the backend) decides.

    python tools/pose/rules.py      reads work/eval/outputs.npz (written by evaluate.py)
"""
import numpy as np

from config import WORK
from evalkit import POSE_X, POSE_Y

TAUS = [0.0, 0.02, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3]


def index_of_xy(x, y):
    return np.where(x > 0, np.where(y > 0, 0, 3), np.where(y > 0, 2, 1))


def ink_views(ink_pose):
    """The ink pose of the picture in each of the four poses, from the ink pose of the canonical picture."""
    sx, sy = POSE_X[ink_pose], POSE_Y[ink_pose]
    return np.stack([index_of_xy(sx * POSE_X[p], sy * POSE_Y[p]) for p in range(4)])


def table(title, pred, margin, ink, truth, extra_mask=None):
    ok = pred == truth
    mask = np.ones(pred.shape, bool) if extra_mask is None else extra_mask
    n = int(mask.sum())
    print(f"\n{title}   (n={n}, HOG errors {int((~ok & mask).sum())}, ink errors {int(((ink != truth) & mask).sum())})")
    print("   tau    margin only: accepted  errors | + ink agrees: accepted  errors   coverage")
    for tau in TAUS:
        a1 = (margin >= tau) & mask
        a2 = a1 & (pred == ink)
        print(f"  {tau:5.2f}   {int(a1.sum()):17d} {int((a1 & ~ok).sum()):7d} | {int(a2.sum()):21d} {int((a2 & ~ok).sum()):7d}    {a2.sum() / n * 100:6.2f}%")
    wrong = margin[~ok & mask]
    if wrong.size:
        print(f"  margins of the wrong HOG decisions: max {wrong.max():.3f}, median {np.median(wrong):.3f}, n={wrong.size}")


def main():
    z = np.load(WORK / "eval" / "outputs.npz", allow_pickle=True)
    for key, tag in (("g_det", "B holdout, straightened, complete wings, four poses"), ("g_asis", "B holdout, as in the database, complete wings, four poses")):
        if f"{key}__pred" not in z:
            continue
        pred, margin, ipose, comp = z[f"{key}__pred"], z[f"{key}__margin"], z[f"{key}__ink_pose"], z[f"{key}__complete"]
        truth = np.arange(4)[:, None] * np.ones_like(pred)
        table(tag, pred, margin, ink_views(ipose), truth, np.broadcast_to(comp[None, :], pred.shape))
    if "A__pred" in z:
        pred, margin, ipose, truth = z["A__pred"], z["A__margin"], z["A__ink_pose"], z["A__truth"]
        sel = z["A__main"] & z["A__sure"] & ~z["A__check"]
        table("A real crops, main detection, sure, not flagged", pred, margin, ipose, truth, sel)
        sel = z["A__sure"] & ~z["A__check"]
        table("A real crops, all detections, sure, not flagged", pred, margin, ipose, truth, sel)
        sel = z["A__sure"]
        table("A real crops, all detections, sure (flagged too)", pred, margin, ipose, truth, sel)
    if "A2__pred" in z:
        pred, margin, ipose, truth = z["A2__pred"], z["A2__margin"], z["A2__ink_pose"], z["A2__truth"]
        table("A2 small Pulawy wings, sure, not flagged", pred, margin, ipose, truth, z["A2__sure"] & ~z["A2__check"])


if __name__ == "__main__":
    main()
