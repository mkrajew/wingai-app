"""Set A2': the small, already cropped wings of the Pulawy folder (another lab and camera), sent through the real YOLO and crop of the app.

They are uploaded the way a user would upload a ready-made wing: the detector still finds it and the app cuts it. As in set B' the picture is put on a
bigger canvas, mirrored or not and turned, so that all four poses appear. There are no manual landmarks: the truth of every crop is what the backend says
(label_real.py pulawy-crops), and only crops that the backend is sure about and does not flag are used.

    python tools/pose/make_pulawy_items.py      -> work/pulawy_items.json   (the browser: window.__ITEMS_FILE = "pulawy_items.json", window.__PREFIX = "pu")
"""
import json
import urllib.parse

import numpy as np

from config import WORK


def main():
    rng = np.random.default_rng(9)
    labels = json.loads((WORK / "real" / "labels_pulawy_small.json").read_text(encoding="utf-8"))
    items = []
    for k, (rel, lab) in enumerate(sorted(labels.items())):
        mirror = bool(rng.random() < 0.5)
        theta = float(rng.choice([0, 90, 180, 270]) + rng.normal(0, 3)) if rng.random() < 0.3 else float(rng.uniform(0, 360))
        items.append({
            "id": f"pu{k}", "cc": "PULAWY", "name": rel, "url": "/rawpl/" + "/".join(urllib.parse.quote(part) for part in rel.split("/")),
            "mirror": mirror, "theta": round(theta, 2), "scale": round(float(rng.uniform(0.7, 1.3)), 3), "w": lab["w"], "h": lab["h"], "lm": [],
        })
    (WORK / "pulawy_items.json").write_text(json.dumps(items), encoding="utf-8")
    print(f"{len(items)} items -> work/pulawy_items.json")


if __name__ == "__main__":
    main()
