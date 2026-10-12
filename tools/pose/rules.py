"""The "unsure" rule: when is the pose read from the pixels trusted?

A pose is accepted when the margin of the template decision (best minus second best correlation) is at least TAU and the ink method says
the same pose. Everything else is "unsure": the wing is left as it is and the old way (the answer of the backend) decides.

    python tools/pose/rules.py --hog hog-16x6-b8s --ink ink-k11-p1-thirds     reads work/eval/outputs.npz (and stress_outputs.npz)
"""
import argparse

import numpy as np

from config import EVAL
from evalkit import POSE_X, POSE_Y

TAUS = [0.0, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3]


def index_of_xy(x, y):
    return np.where(x > 0, np.where(y > 0, 0, 3), np.where(y > 0, 2, 1))


def ink_views(ink_pose):
    """The ink pose of the picture in each of the four poses, from the ink pose of the canonical picture."""
    sx, sy = POSE_X[ink_pose], POSE_Y[ink_pose]
    return np.stack([index_of_xy(sx * POSE_X[p], sy * POSE_Y[p]) for p in range(4)])


class Tally:
    """Counts, per TAU, how many decisions are accepted and how many of those are wrong."""

    def __init__(self):
        self.n = 0
        self.hog_err = 0
        self.ink_err = 0
        self.acc = np.zeros(len(TAUS), int)
        self.err = np.zeros(len(TAUS), int)
        self.caught = 0  # wrong HOG decisions that the rule refuses

    def add(self, hog, margin, ink, truth, mask=None):
        mask = np.ones(hog.shape, bool) if mask is None else np.broadcast_to(mask, hog.shape)
        ok = hog == truth
        self.n += int(mask.sum())
        self.hog_err += int((~ok & mask).sum())
        self.ink_err += int(((ink != truth) & mask).sum())
        for i, tau in enumerate(TAUS):
            a = (margin >= tau) & (hog == ink) & mask
            self.acc[i] += int(a.sum())
            self.err[i] += int((a & ~ok).sum())
        self.caught += int((~ok & mask & ~((margin >= 0.1) & (hog == ink))).sum())

    def line(self, title):
        cells = "  ".join(f"{self.acc[i] / max(self.n, 1) * 100:5.1f}%/{self.err[i]}" for i in range(len(TAUS)))
        return f"{title:34s} n={self.n:6d} hog err {self.hog_err:4d} ink err {self.ink_err:4d} | {cells}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hog", required=True)
    ap.add_argument("--ink", required=True)
    a = ap.parse_args()
    z = np.load(EVAL / "outputs.npz", allow_pickle=True)
    print("each cell: share of decisions accepted / wrong decisions among the accepted, for TAU = " + " ".join(f"{t:.2f}" for t in TAUS))
    head = f"{'set':34s} {'':8s} {'':14s}{'':13s}  " + "  ".join(f"{t:8.2f}" for t in TAUS)
    print(head)

    def get(set_name, key):
        return z[f"{a.hog}__{set_name}__{key}"], z[f"{a.ink}__{set_name}__{key}"]

    for sname, label in (("Bdet", "B holdout straightened (complete)"), ("Basis", "B holdout as in database (complete)")):
        hp, _ = get(sname, "pred")
        hm, _ = get(sname, "margin")
        _, ip = get(sname, "pred")
        t = Tally()
        t.add(hp, hm, ip, np.arange(4)[:, None] * np.ones_like(hp), z[f"meta__{sname}__complete"][None, :])
        print(t.line(label))
    hp, ip = get("LOCO", "pred")
    hm, _ = get("LOCO", "margin")
    t = Tally()
    t.add(hp, hm, ip, np.arange(4)[:, None] * np.ones_like(hp))
    print(t.line("other country (LOCO, complete)"))
    sel = z["meta__A__main"] & z["meta__A__sure"] & ~z["meta__A__check"]
    hp, ip = get("A", "pred")
    hm, _ = get("A", "margin")
    t = Tally()
    t.add(hp, hm, ip, z["meta__A__truth"], sel)
    print(t.line("A real crops, main, sure, unflagged"))
    sel = z["meta__A__sure"] & ~z["meta__A__check"]
    t = Tally()
    t.add(hp, hm, ip, z["meta__A__truth"], sel)
    print(t.line("A real crops, all, sure, unflagged"))
    sel = z["meta__A__sure"]
    t = Tally()
    t.add(hp, hm, ip, z["meta__A__truth"], sel)
    print(t.line("A real crops, all, sure (flagged too)"))
    hp, ip = get("A2", "pred")
    hm, _ = get("A2", "margin")
    t = Tally()
    t.add(hp, hm, ip, z["meta__A2__truth"], z["meta__A2__sure"] & ~z["meta__A2__check"])
    print(t.line("A2 small Pulawy, sure, unflagged"))
    try:
        s = np.load(EVAL / "stress_outputs.npz")
    except FileNotFoundError:
        return
    t = Tally()
    for key in s.files:
        if key.startswith(f"{a.hog}__") and key.endswith("__pred"):
            pname = key[len(a.hog) + 2 : -len("__pred")]
            hp, hm, ip = s[key], s[f"{a.hog}__{pname}__margin"], s[f"{a.ink}__{pname}__pred"]
            t.add(hp, hm, ip, np.arange(4)[:, None] * np.ones_like(hp))
    print(t.line("stress (all perturbations)"))


if __name__ == "__main__":
    main()
