"""Contact sheets of the wrong decisions, to look at them with human eyes.

    python tools/pose/gallery.py        reads work/eval/outputs.npz, writes work/eval/gallery_*.png
Every tile is the picture as the method saw it (shrunk), with the shown pose, the decided pose and the margin.
"""
import cv2
import numpy as np

import evalkit as K
from common import turn
from config import POSES, WORK

EVAL = WORK / "eval"


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
    z = np.load(EVAL / "outputs.npz", allow_pickle=True)
    for key in ("g_det", "g_asis"):
        if f"{key}__pred" not in z:
            continue
        pred, margin, comp, country = z[f"{key}__pred"], z[f"{key}__margin"], z[f"{key}__complete"], z[f"{key}__country"]
        imgs = np.load(EVAL / f"hold_{key}.npy", mmap_mode="r")
        wrong = [(p, i) for p in range(4) for i in range(pred.shape[1]) if comp[i] and pred[p, i] != p]
        wrong.sort(key=lambda t: -margin[t[0], t[1]])  # the most confident mistakes first
        tiles = [tile(np.ascontiguousarray(turn(np.asarray(imgs[i]), POSES[p])), f"{country[i]} shown {POSES[p]} -> {POSES[pred[p, i]]} m={margin[p, i]:.2f}") for p, i in wrong[:limit]]
        sheet(tiles, EVAL / f"gallery_B_{key}.png")
        print(f"  B {key}: {len(wrong)} wrong decisions on complete wings")
    if "A__pred" in z:
        pred, margin, truth, ids = z["A__pred"], z["A__margin"], z["A__truth"], z["A__ids"]
        sure = z["A__sure"]
        wrong = [i for i in range(len(pred)) if pred[i] != truth[i]]
        tiles = []
        for i in wrong[:limit]:
            g, _ = K.real_gray(WORK / "real" / f"{ids[i]}.png")
            tiles.append(tile(g, f"{ids[i][:14]} truth {POSES[truth[i]]} -> {POSES[pred[i]]} m={margin[i]:.2f}{'' if sure[i] else ' unsure label'}"))
        sheet(tiles, EVAL / "gallery_A.png")
        print(f"  A: {len(wrong)} wrong decisions")


if __name__ == "__main__":
    main()
