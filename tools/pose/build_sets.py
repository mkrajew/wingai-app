"""Set B: the wings of the ready-made bee databases (13 countries, manual landmarks), shrunk to the working size.

For every picture two versions are made:
  g_asis - as it is in the database (its own framing and tilt)
  g_det  - straightened like a crop of the app: rotated until the wing stands as upright as in the real crops of the app (the angle that the backend
           reads from a real crop is TARGET_ANGLE degrees, the mean shape itself is tilted a little)
Only wings that are in the canonical pose (right-wing look, upright) are kept: the other three poses are made by turning the pictures, so
the truth of every sample is exact. Needs: python tools/pose/build_sets.py [country ...]
"""
import csv
import multiprocessing as mp
import sys
import time

import cv2
import numpy as np

import labels
from common import luma, shrink
from config import COUNTRIES, CROPPED, H, W, WORK

TARGET_ANGLE = -2.6  # median angle of the upright real crops of the app (see work/real, label_real.py)


def read_rows(cc):
    rows = []
    with open(CROPPED / f"{cc}-raw-coordinates.csv", newline="", encoding="utf-8") as f:
        for rec in csv.DictReader(f):
            vals = [rec[k] for k in rec if k != "file"]
            if len(vals) != 38 or any(v == "" for v in vals):
                continue
            try:
                rows.append((rec["file"], [float(v) for v in vals]))
            except ValueError:
                continue
    return rows


def detilt(img, delta):
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), delta, 1.0)  # positive = counter-clockwise on the screen
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def work(task):
    cc, name, angle = task
    img = cv2.imread(str(CROPPED / f"{cc}-wing-images" / name), cv2.IMREAD_COLOR)
    if img is None or min(img.shape[:2]) < 20:
        return None
    asis = shrink(luma(img))
    delta = angle - TARGET_ANGLE  # the angle read from the landmarks is the rotation the wing still NEEDS, so a wing turned counter-clockwise by d reads -d
    det = shrink(luma(detilt(img, delta))) if abs(delta) > 0.3 else asis
    return name, asis, det, img.shape[1], img.shape[0]


def check_detilt(cc="PL", n=60):
    """The rotation has the right direction: the landmarks of a straightened picture read the target angle."""
    rows = read_rows(cc)[:n]
    errs = []
    for name, vals in rows:
        img = cv2.imread(str(CROPPED / f"{cc}-wing-images" / name), cv2.IMREAD_COLOR)
        h, w = img.shape[:2]
        det0, a0 = labels.pose_y_up(np.array(vals).reshape(-1, 2))
        delta = a0 - TARGET_ANGLE
        m = cv2.getRotationMatrix2D((w / 2, h / 2), delta, 1.0)
        p = np.array(vals).reshape(-1, 2)
        p_down = np.stack([p[:, 0], h - 1 - p[:, 1], np.ones(len(p))], 1)
        q_down = p_down @ m.T
        q_up = np.stack([q_down[:, 0], h - 1 - q_down[:, 1]], 1)
        _, a1 = labels.pose_y_up(q_up)
        errs.append(abs(a1 - TARGET_ANGLE))
    print(f"de-tilt check on {len(errs)} wings: max |angle after - target| = {max(errs):.2f} deg, median {np.median(errs):.3f}")
    assert max(errs) < 1.0, "the rotation goes the wrong way"


def main():
    ccs = sys.argv[1:] or COUNTRIES
    (WORK / "B").mkdir(parents=True, exist_ok=True)
    check_detilt()
    t0 = time.time()
    for cc in ccs:
        rows = read_rows(cc)
        tasks, skipped = [], 0
        angles = {}
        for name, vals in rows:
            det, angle = labels.pose_y_up(np.array(vals).reshape(-1, 2))
            if det > 0 and abs(angle) < 30:
                tasks.append((cc, name, angle))
                angles[name] = angle
            else:
                skipped += 1
        with mp.Pool(14) as pool:
            res = [r for r in pool.imap(work, tasks, chunksize=32) if r is not None]
        names = np.array([r[0] for r in res])
        np.savez_compressed(
            WORK / "B" / f"{cc}.npz",
            names=names,
            angle=np.array([angles[n] for n in names], np.float32),
            size=np.array([[r[3], r[4]] for r in res], np.int32),
            g_asis=np.stack([r[1] for r in res]),
            g_det=np.stack([r[2] for r in res]),
        )
        print(f"{cc}: rows {len(rows)}, canonical {len(tasks)}, not canonical (skipped) {skipped}, saved {len(res)}  [{time.time() - t0:.0f}s]", flush=True)


if __name__ == "__main__":
    main()
