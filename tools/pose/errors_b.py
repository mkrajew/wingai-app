"""Which wings of the development sample of set B does a variant get wrong (in cross validation), and why?

    python tools/pose/errors_b.py <index in work/sweep/shortlist.json> [--tag _short]
Prints the wings (country, name, complete or not, margins) and writes work/sweep/errors_<k>.png with their pictures.
"""
import argparse
import json
from collections import Counter

import cv2
import numpy as np

from config import POSES, WORK

SUB = WORK / "sweep"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("k", type=int)
    ap.add_argument("--tag", default="_short")
    ap.add_argument("--set", default="det")
    a = ap.parse_args()
    z = np.load(SUB / f"preds_hog_{a.set}{a.tag}.npz")
    meta = np.load(SUB / "meta.npz")
    imgs = np.load(SUB / f"sub_{a.set}.npy", mmap_mode="r")
    pred, margin, comp = z[f"pred_{a.k}"], z[f"margin_{a.k}"], z["complete"]
    spec = json.loads((SUB / "shortlist.json").read_text())[a.k]
    print("variant", a.k, spec)
    wrong = np.where((pred != np.arange(4)[:, None]).any(axis=0))[0]
    print(f"{len(wrong)} wings with at least one wrong pose of {pred.shape[1]}; complete: {int(comp[wrong].sum())}, incomplete: {int((~comp[wrong]).sum())}")
    by = Counter(meta["country"][wrong].tolist())
    print("by country:", dict(by))
    tiles = []
    for i in wrong[:60]:
        poses = [POSES[pred[p, i]] for p in range(4)]
        print(f"  {meta['country'][i]} {meta['names'][i][:34]:34s} complete={bool(comp[i])}  decided {poses}  margins {[round(float(margin[p, i]), 2) for p in range(4)]}")
        t = cv2.cvtColor(np.ascontiguousarray(imgs[i]), cv2.COLOR_GRAY2BGR)
        cv2.rectangle(t, (0, 0), (t.shape[1], 14), (255, 255, 255), -1)
        cv2.putText(t, f"{meta['country'][i]} {'complete' if comp[i] else 'INCOMPLETE'} {poses[0]}", (3, 11), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 255), 1, cv2.LINE_AA)
        tiles.append(t)
    if tiles:
        cols = 4
        h, w = tiles[0].shape[:2]
        rows = []
        for i in range(0, len(tiles), cols):
            row = tiles[i : i + cols]
            row += [np.full((h, w, 3), 255, np.uint8)] * (cols - len(row))
            rows.append(np.hstack(row))
        cv2.imwrite(str(SUB / f"errors_{a.k}.png"), np.vstack(rows))
        print("wrote", SUB / f"errors_{a.k}.png")


if __name__ == "__main__":
    main()
