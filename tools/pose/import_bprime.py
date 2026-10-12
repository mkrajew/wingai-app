"""Set B': turns the crops that the browser posted (work/inbox/collected-bp-*.json) into arrays and the truth.

Truth: the manual landmarks, carried into the frame of the crop by the browser, are read the way the app judges a wing (Procrustes against the mean shape):
chirality and angle -> one of the four poses. A crop is "complete" when all 19 landmarks lie inside it, at least MARGIN of its size from the border.

    python tools/pose/import_bprime.py      -> work/bprime/crops.npz (+ the png files for the galleries in work/bprime/png/)
"""
import base64
import json

import cv2
import numpy as np

import labels
from common import luma, shrink, valid_mask
from config import POSES, WORK

MARGIN = 0.015


def main():
    out = WORK / "bprime"
    (out / "png").mkdir(parents=True, exist_ok=True)
    recs = []
    for p in sorted((WORK / "inbox").glob("collected-bp-*.json")):
        recs += json.loads(p.read_text(encoding="utf-8"))
    print(f"{len(recs)} records")
    g, valid, meta = [], [], []
    no_det = 0
    for r in recs:
        if "png" not in r:
            no_det += 1
            meta.append({"id": r["id"], "cc": r["cc"], "name": r["name"], "mirror": r["mirror"], "theta": r["theta"], "detected": False})
            g.append(np.zeros((96, 256), np.uint8)); valid.append(np.ones((96, 256), bool))
            continue
        png = base64.b64decode(r["png"])
        (out / "png" / f"{r['id']}.png").write_bytes(png)
        img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
        gray = luma(img)
        h, w = gray.shape
        lm = np.array(r["landmarks"], dtype=np.float64)  # in the crop, y down
        inside = (lm[:, 0] >= MARGIN * w) & (lm[:, 0] <= (1 - MARGIN) * w) & (lm[:, 1] >= MARGIN * h) & (lm[:, 1] <= (1 - MARGIN) * h)
        up = lm.copy()
        up[:, 1] = h - 1 - up[:, 1]
        det, angle = labels.pose_y_up(up)
        meta.append({"id": r["id"], "cc": r["cc"], "name": r["name"], "mirror": r["mirror"], "theta": r["theta"], "detected": True, "conf": r["det"]["conf"],
                     "ndet": r["ndet"], "others": r["others"], "crop": r["crop"], "complete": bool(inside.all()), "points_inside": int(inside.sum()),
                     "det": det, "angle": angle, "sure": labels.sure(angle), "pose": labels.pose_name(det, angle) if labels.sure(angle) else None,
                     "axis_angle": r["axisAngle"]})
        g.append(shrink(gray))
        valid.append(valid_mask(gray))
    np.savez_compressed(out / "crops.npz", g=np.stack(g), valid=np.stack(valid))
    (out / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    det = [m for m in meta if m["detected"]]
    print(f"detected {len(det)} of {len(meta)} (no detection: {no_det})")
    if det:
        sure = [m for m in det if m["sure"]]
        comp = [m for m in sure if m["complete"]]
        print(f"pose clear (angle within 30 degrees of upright or upside down): {len(sure)}; complete crops among them: {len(comp)}")
        print("poses of the complete crops:", {p: sum(1 for m in comp if m["pose"] == p) for p in POSES})
        print("mirror x pose:", {(int(mir), p): sum(1 for m in comp if m["mirror"] == mir and m["pose"] == p) for mir in (False, True) for p in POSES})
        conf = np.array([m["conf"] for m in det])
        print(f"YOLO confidence of the main detection: min {conf.min():.2f}, 5% {np.percentile(conf, 5):.2f}, median {np.median(conf):.2f}")
        print("incomplete or unclear crops:", [(m["id"], m["points_inside"], round(m["angle"], 1)) for m in det if not (m["sure"] and m["complete"])][:12])


if __name__ == "__main__":
    main()
