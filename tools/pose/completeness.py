"""Which wings of set B are complete in their picture? The task assumes good crops: a complete wing, horizontal. Some databases
contain strips that cut a part of the wing off (see the TR pictures with an aspect ratio of 5). A wing counts as complete when every
one of its 19 landmarks is at least MARGIN of the picture size away from the border.

    python tools/pose/completeness.py      -> work/B/complete.json  {country: {name: smallest margin}}
"""
import json

import numpy as np

from build_sets import read_rows
from config import COUNTRIES, WORK

MARGIN = 0.015


def main():
    out = {}
    for cc in COUNTRIES:
        z = np.load(WORK / "B" / f"{cc}.npz")
        rows = dict(read_rows(cc))
        sizes = z["size"]
        res = {}
        for name, (w, h) in zip(z["names"], sizes):
            p = np.array(rows[str(name)]).reshape(-1, 2)  # y up
            left, right = p[:, 0].min() / w, 1 - (p[:, 0].max() + 1) / w
            bottom, top = p[:, 1].min() / h, 1 - (p[:, 1].max() + 1) / h
            res[str(name)] = float(min(left, right, bottom, top))
        out[cc] = res
        m = np.array(list(res.values()))
        print(f"{cc}: {len(m)} wings, complete (all landmarks >= {MARGIN * 100:.1f}% from the border): {(m >= MARGIN).mean() * 100:.1f}%  (median margin {np.median(m) * 100:.1f}%)")
    (WORK / "B" / "complete.json").write_text(json.dumps(out), encoding="utf-8")


if __name__ == "__main__":
    main()
