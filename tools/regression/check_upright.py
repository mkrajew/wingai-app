"""Judges the snapshots of the regression harness offline (no requests), with the backend's own alignment to the mean shape.

    check_upright.py reanalysis <label> [right | left | none]   a run of run.js made with window.__REANALYZE
    check_upright.py e2e <label> <right | left | original>       a run of e2e-orientation.js

reanalysis: for every photo the review shows at the end, the backend was asked again. This gives, for the picture that is shown,
  - its side (left / right) and its angle: after "orient to the right" every photo must be right and about 0 degrees,
  - how far the landmarks drawn by the app are from the landmarks found again on the shown picture (the landmarks drawn by
    the app were transformed together with the picture, the re-detection is independent).
  The angles are written to work/angles-<label>.json.
e2e: the wings that were exported and read again by the backend must be on the wanted side and upright.

Run it with the Python of the backend (backend/.venv): it needs torch and the backend's own `wings` package.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import torch

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))
from wings.gpa import center_shape, normalize_shape, procrustes_align  # noqa: E402

WORK = Path(__file__).resolve().parent / "work"
MEAN = torch.load(BACKEND / "models" / "mean_shape.pth", weights_only=False).float()
FLIP_X = torch.tensor([[-1.0, 0.0], [0.0, 1.0]])


def angle_a(coords, h):
    """The angle (degrees) of the wing to the mean shape; near 0 = upright, near 180 = upside down."""
    pts = np.array(coords, dtype=np.float32).reshape(-1, 2)
    pts[:, 1] = h - 1 - pts[:, 1]
    r = procrustes_align(normalize_shape(center_shape(torch.from_numpy(pts))), MEAN, only_matrix=True, allow_reflection=True)
    rot = r if torch.det(r) > 0 else FLIP_X @ r
    return math.degrees(math.atan2(rot[0, 1].item(), rot[0, 0].item()))


def reanalysis(label, want):
    snap = json.loads((WORK / f"collected-{label}.json").read_text(encoding="utf-8"))
    bad = 0
    angles = []
    print(f"{label}: orientation setting = {snap['orient']}, model = {snap.get('model', 'default')}, expected side after processing = {want}")
    print(f"{'#':>2} {'name':22} {'side':5} {'angle':>7} {'check':5} {'landmark distance to the app (px)  max / mean':>46}")
    for item in snap["reanalysis"]:
        if item.get("skipped"):
            print(f"{item['i']:>2} (no landmarks, skipped)")
            angles.append({"i": item["i"], "skipped": True})
            continue
        if item.get("error"):
            print(f"{item['i']:>2} {item['name']:22} the second analysis failed: {item['error']}  <-- PROBLEM")
            angles.append({"i": item["i"], "skipped": True})
            bad += 1
            continue
        image = snap["images"][item["i"]]
        app = np.array(image["circles"], dtype=np.float64) - 0.5  # SVG user units -> landmark coordinates
        found = np.array(item["coords"], dtype=np.float64).reshape(-1, 2)
        dist = np.linalg.norm(app - found, axis=1)
        ang = angle_a(item["coords"], item["h"])
        angles.append({"i": item["i"], "angle": ang, "side": item["orientation"], "check": item["check"]})
        ok_side = want == "none" or item["orientation"] == want
        ok_angle = want == "none" or abs(ang) < 30
        ok_dist = dist.max() < 25
        ok = ok_side and ok_angle and ok_dist
        bad += 0 if ok else 1
        print(f"{item['i']:>2} {item['name']:22} {item['orientation']:5} {ang:7.1f} {item['check']!s:5} {dist.max():20.2f} / {dist.mean():.2f}   {'OK' if ok else '<-- PROBLEM'}")
    print("\nproblems:", bad)
    (WORK / f"angles-{label}.json").write_text(json.dumps(angles), encoding="utf-8")


def e2e(label, target):
    data = json.loads((WORK / f"collected-e2e-{label}-{target}.json").read_text(encoding="utf-8"))
    bad = 0
    print(f"run {label}, target = {target}")
    for v in data["verdicts"]:
        a = angle_a(v["afterCoords"], v["afterH"])
        turned_on_purpose = v["name"].startswith("R-")
        if target == "original":
            ok = (abs(a) > 90) == turned_on_purpose  # nothing is touched: the turned wings stay upside down, the others stay upright
        else:
            ok = abs(a) < 30 and v["afterSide"] == target
        bad += 0 if ok else 1
        print(f"  {v['name']:40} flagged={v['check']!s:5} turned={v['expectTurn']!s:5} mirrored={v['expectFlip']!s:5} after: side={v['afterSide']:5} angle={a:7.1f}  {'OK' if ok else '<-- PROBLEM'}")
    print("problems:", bad)


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "reanalysis":
        reanalysis(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "none")
    elif len(sys.argv) == 4 and sys.argv[1] == "e2e":
        e2e(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
