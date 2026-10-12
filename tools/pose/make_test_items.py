"""Set T: wings of the TEST split of the backend's models, put on a bigger canvas like a photo and sent through the real detector and crop of the app.

It is set B' (make_bprime_items.py) for the wings that the models of the backend have never seen: the test split of the models is the list of wings in
bees/reports/deepwings_full_test_raw_coords.json (2 172 wings). One synthetic photo per wing (mirrored or not, turned by a random angle, scaled), so
all four poses of a crop occur. Used by measure_precise.py, which asks the backend how well it finds the landmarks that were put by hand.

    python tools/pose/make_test_items.py [--cap 140]    -> work/test_items.json
    (in the Vite page: window.__ITEMS_FILE = "test_items.json"; window.__PREFIX = "bt"; window.__FROM/__TO = a slice; run browser/export-yolo-crops.js)
    python tools/pose/import_bprime.py --prefix bt --out bprime_test
"""
import argparse
import json
from collections import Counter

import numpy as np

from build_sets import read_rows
from config import BEES_DATA, COUNTRIES, WORK

TEST_SPLIT = BEES_DATA.parent / "reports" / "deepwings_full_test_raw_coords.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=int, default=140, help="the most wings of one country")
    a = ap.parse_args()
    rng = np.random.default_rng(23)
    test = set(json.loads(TEST_SPLIT.read_text(encoding="utf-8")))
    complete = json.loads((WORK / "B" / "complete.json").read_text(encoding="utf-8"))
    items = []
    for cc in COUNTRIES:
        z = np.load(WORK / "B" / f"{cc}.npz")
        names = [str(n) for n in z["names"]]
        sizes = z["size"]
        rows = dict(read_rows(cc))
        idx = [i for i, n in enumerate(names) if n in test and complete[cc][n] >= 0.015]
        take = sorted(rng.choice(idx, min(a.cap, len(idx)), replace=False)) if idx else []
        for i in take:
            vals = rows[names[i]]
            lm = [[vals[2 * k], vals[2 * k + 1]] for k in range(19)]  # (x, y) with y UP, in the database picture
            mirror = bool(rng.random() < 0.5)
            theta = float(rng.choice([0, 90, 180, 270]) + rng.normal(0, 3)) if rng.random() < 0.3 else float(rng.uniform(0, 360))
            items.append({
                "id": f"{cc}-{i}-t", "cc": cc, "name": names[i], "mirror": mirror, "theta": round(theta, 2),
                "scale": round(float(rng.uniform(0.7, 1.3)), 3), "w": int(sizes[i][0]), "h": int(sizes[i][1]), "lm": lm,
            })
        if idx:
            print(f"{cc}: {len(idx)} wings of the test split in set B, {len(take)} taken")
    order = rng.permutation(len(items))
    items = [items[k] for k in order]
    (WORK / "test_items.json").write_text(json.dumps(items), encoding="utf-8")
    print(f"{len(items)} items -> work/test_items.json; mirrored: {sum(i['mirror'] for i in items)}; countries: {dict(Counter(i['cc'] for i in items))}")


if __name__ == "__main__":
    main()
