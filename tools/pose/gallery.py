"""Contact sheets of the wrong decisions of one method, to look at them with human eyes.

    python tools/pose/gallery.py --method hog-16x6-b8s        reads work/eval/outputs.npz, writes work/eval/gallery_<method>_*.png
Every tile is the picture as the method saw it (shrunk), with the shown pose, the decided pose and the margin.
"""
import argparse

import cv2
import numpy as np

import evalkit as K
from common import turn
from config import EVAL, POSES, WORK


def sheet(tiles, path, cols=4):
    if not tiles:
        print("no errors for", path.name)
        return
    h, w = tiles[0].shape[:2]
    rows = []
    for i in range(0, len(tiles), cols):
        row = tiles[i : i + cols]
        row += [np.full((h, w, 3), 255, np.uint8)] * (cols - len(row))
        rows.append(np.hstack(row))
    cv2.imwrite(str(path), np.vstack(rows))
    print("wrote", path, f"({len(tiles)} tiles)")


def tile(gray, text):
    t = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    cv2.rectangle(t, (0, 0), (t.shape[1], 14), (255, 255, 255), -1)
    cv2.putText(t, text, (3, 11), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 255), 1, cv2.LINE_AA)
    return t


def main(limit=48):
    ap = argparse.ArgumentParser()
    ap.add_argument("--method", required=True)
    a = ap.parse_args()
    n = a.method
    z = np.load(EVAL / "outputs.npz", allow_pickle=True)
    for sname, arr in (("Bdet", "hold_det.npy"), ("Basis", "hold_asis.npy")):
        pred, margin, comp, country = z[f"{n}__{sname}__pred"], z[f"{n}__{sname}__margin"], z[f"meta__{sname}__complete"], z[f"meta__{sname}__country"]
        imgs = np.load(EVAL / arr, mmap_mode="r")
        wrong = [(p, i) for p in range(4) for i in range(pred.shape[1]) if comp[i] and pred[p, i] != p]
        wrong.sort(key=lambda t: -margin[t[0], t[1]])  # the most confident mistakes first
        tiles = [tile(np.ascontiguousarray(turn(np.asarray(imgs[i]), POSES[p])), f"{country[i]} shown {POSES[p]} -> {POSES[pred[p, i]]} m={margin[p, i]:.2f}") for p, i in wrong[:limit]]
        print(f"{sname}: {len(wrong)} wrong decisions on complete wings")
        sheet(tiles, EVAL / f"gallery_{n}_{sname}.png")
    pred, margin, truth, ids = z[f"{n}__A__pred"], z[f"{n}__A__margin"], z["meta__A__truth"], z["meta__A__ids"]
    sure, check = z["meta__A__sure"], z["meta__A__check"]
    wrong = [i for i in range(len(pred)) if pred[i] != truth[i]]
    tiles = []
    for i in wrong[:limit]:
        g, _ = K.real_gray(WORK / "real" / f"{ids[i]}.png")
        tiles.append(tile(g, f"{ids[i][:14]} truth {POSES[truth[i]]} -> {POSES[pred[i]]} m={margin[i]:.2f}{'' if sure[i] else ' angle unsure'}{' flagged' if check[i] else ''}"))
    print(f"A: {len(wrong)} wrong decisions")
    sheet(tiles, EVAL / f"gallery_{n}_A.png")


if __name__ == "__main__":
    main()
