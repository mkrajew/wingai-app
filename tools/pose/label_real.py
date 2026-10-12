"""The truth for the real pictures: what the backend (the model "rotation", exactly the request the app sends) says about the pose of a wing.

    python tools/pose/label_real.py crops      # the real crops in work/real (set A)
    python tools/pose/label_real.py pulawy     # the small, already cropped wings of the Pulawy folder (set A2)

The backend must be running (WINGAI_BACKEND, default http://127.0.0.1:8000). Answers are cached in work/real/labels*.json.
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import httpx

import labels
from config import BACKEND_URL, RAW_SETS, WORK

REAL = WORK / "real"


def ask(png_bytes, w, h, name):
    for attempt in range(3):
        try:
            r = httpx.post(
                f"{BACKEND_URL}/analyze",
                files={"file": (name, png_bytes, "image/png")},
                data={"x_size": w, "y_size": h, "model": "rotation"},
                timeout=180,
            )
            r.raise_for_status()
            return r.json()
        except Exception:
            time.sleep(1 + attempt)
    return None


def label_one(item):
    key, path = item
    data = Path(path).read_bytes()
    img = cv2.imdecode(__import__("numpy").frombuffer(data, __import__("numpy").uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        return key, None
    h, w = img.shape[:2]
    t0 = time.time()
    ans = ask(data, w, h, Path(path).name)
    if ans is None:
        return key, None
    det, angle = labels.pose_backend([float(c) for c in ans["coords"]], h)
    return key, {"det": det, "angle": angle, "check": bool(ans["check"]), "side": ans["orientation"], "w": w, "h": h, "ms": round((time.time() - t0) * 1000)}


def run(items, out_path, threads=3):
    cache = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
    todo = [(k, p) for k, p in items if k not in cache]
    print(f"{len(items)} pictures, {len(todo)} to label", flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(threads) as ex:
        for i, (key, res) in enumerate(ex.map(label_one, todo), 1):
            if res is not None:
                cache[key] = res
            if i % 50 == 0:
                out_path.write_text(json.dumps(cache), encoding="utf-8")
                print(f"  {i}/{len(todo)}  {time.time() - t0:.0f}s", flush=True)
    out_path.write_text(json.dumps(cache), encoding="utf-8")
    print(f"done: {len(cache)} labels")


def main():
    what = sys.argv[1]
    if what == "crops":
        meta = json.loads((REAL / "meta.json").read_text(encoding="utf-8"))
        run([(cid, REAL / f"{cid}.png") for cid in meta], REAL / "labels.json")
    elif what == "pulawy":
        root = RAW_SETS["pulawy"]
        items = []
        for p in sorted(root.rglob("*.png")):
            w, h = __import__("PIL.Image", fromlist=["Image"]).open(p).size
            if max(w, h) < 2500:
                items.append((str(p.relative_to(root)).replace("\\", "/"), p))
        run(items, REAL / "labels_pulawy_small.json")


if __name__ == "__main__":
    main()
