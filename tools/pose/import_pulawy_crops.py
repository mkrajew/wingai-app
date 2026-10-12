"""Set A2': the crops of the small Pulawy wings after the real YOLO and crop (work/inbox/collected-pu-*.json) -> work/pulawy_crops/<id>.png and meta.json.
The truth comes from the backend (label_real.py pulawy-crops), evaluate with eval_pulawy_crops.py.
"""
import base64
import json

from config import WORK


def main():
    out = WORK / "pulawy_crops"
    out.mkdir(parents=True, exist_ok=True)
    meta = {}
    for p in sorted((WORK / "inbox").glob("collected-pu-*.json")):
        for r in json.loads(p.read_text(encoding="utf-8")):
            if "png" not in r:
                meta[r["id"]] = {"detected": False, "name": r["name"]}
                continue
            (out / f"{r['id']}.png").write_bytes(base64.b64decode(r.pop("png")))
            r.pop("landmarks", None)
            r["detected"] = True
            meta[r["id"]] = r
    (out / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    print(f"{len(meta)} photos, the detector found a wing in {sum(1 for m in meta.values() if m['detected'])}")


if __name__ == "__main__":
    main()
