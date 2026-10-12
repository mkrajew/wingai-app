"""Set A: the REAL crops of the app. The browser harness (browser/export-crops.js) runs the app's own detector and its own
straightenedCrop on raw photos and posts every crop (shrunk to at most 1100 px) with what the detector said. This script turns the
posted files (collected-crop-*.json) into work/real/<id>.png and work/real/meta.json.

    python tools/pose/import_real.py <folder with collected-crop-*.json>
"""
import base64
import json
import sys
from pathlib import Path

from config import WORK


def source_of(cid):
    if cid.startswith("IMG_"):
        return "swietokrzyskie"
    if cid.startswith("bm"):
        return "bm"
    if cid.startswith("pl"):
        return "pulawy"
    return "other"


def main(src):
    out = WORK / "real"
    out.mkdir(parents=True, exist_ok=True)
    meta_path = out / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    n = 0
    for p in sorted(Path(src).glob("collected-crop-*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        cid = p.stem.replace("collected-crop-", "")
        (out / f"{cid}.png").write_bytes(base64.b64decode(d.pop("png")))
        d["source"] = source_of(cid)
        meta[cid] = d
        n += 1
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    print(f"imported {n} crops, {len(meta)} in total")


if __name__ == "__main__":
    main(sys.argv[1])
