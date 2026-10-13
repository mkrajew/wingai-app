"""Set B': wings of the databases, put on a bigger canvas like a photo and sent through the REAL detector and crop of the app.

The browser (browser/export-yolo-crops.js) takes every item of work/bprime_items.json: it draws the database picture on a canvas, mirrored
or not, turned by a random angle, scaled (a synthetic photo, the way a wing lies on a slide), finds the wing with the app's YOLO model, cuts it with the
app's straightenedCrop and sends the crop with the manual landmarks carried into the frame of the crop. The truth of every crop (which of the four
poses it is in) comes from those landmarks, so there is no backend in it.

Both mirror states and every angle occur, so all four poses appear naturally: a crop is never mirrored, so the mirrored photos give the left wings
(flipH, flipV) and the others the right wings (id, rot180); the angle decides which end of the wing the crop has on the right.
A part of the angles is exactly 0, 90, 180 or 270 degrees (with a small noise): the wing axis then lies on the boundary where the detector's axis
angle flips by 180 degrees.

    python tools/pose/make_bprime_items.py [--per-country 250]
Only wings of the holdout fold that are complete in their own picture are used.
"""
import argparse
import json

import numpy as np

from build_sets import read_rows
from common import fold_of, group_of
from config import COUNTRIES, WORK

HOLDOUT = 4


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-country", type=int, default=250)
    a = ap.parse_args()
    rng = np.random.default_rng(5)
    complete = json.loads((WORK / "B" / "complete.json").read_text(encoding="utf-8"))
    items = []
    for cc in COUNTRIES:
        z = np.load(WORK / "B" / f"{cc}.npz")
        names = [str(n) for n in z["names"]]
        sizes = z["size"]
        rows = dict(read_rows(cc))
        idx = [i for i, n in enumerate(names) if fold_of(group_of(n)) == HOLDOUT and complete[cc][n] >= 0.015]
        take = sorted(rng.choice(idx, min(a.per_country, len(idx)), replace=False)) if idx else []
        for i in take:
            vals = rows[names[i]]
            lm = [[vals[2 * k], vals[2 * k + 1]] for k in range(19)]  # (x, y) with y UP, in the database picture
            for mirror in (False, True):
                if rng.random() < 0.3:
                    theta = float(rng.choice([0, 90, 180, 270]) + rng.normal(0, 3))
                else:
                    theta = float(rng.uniform(0, 360))
                items.append({
                    "id": f"{cc}-{i}-{int(mirror)}", "cc": cc, "name": names[i], "mirror": mirror, "theta": round(theta, 2),
                    "scale": round(float(rng.uniform(0.7, 1.3)), 3), "w": int(sizes[i][0]), "h": int(sizes[i][1]), "lm": lm,
                })
        print(f"{cc}: {len(take)} wings -> {2 * len(take)} synthetic photos")
    order = rng.permutation(len(items))  # so that every slice (every browser tab) gets a mix of the countries
    items = [items[k] for k in order]
    (WORK / "bprime_items.json").write_text(json.dumps(items), encoding="utf-8")
    print(f"{len(items)} items -> work/bprime_items.json")


if __name__ == "__main__":
    main()
