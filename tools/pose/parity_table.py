"""What the Python reference says about every crop that was saved from the app (sets A, B' and A2'), for check_ts_parity.mjs.

    python tools/pose/parity_table.py        -> work/parity/table.json

For every picture: the checksums of its working gray picture, of its mask of the photo and of its descriptor, the correlations with the
shipped templates, the pose and the margin; and the truth (the backend for A and A2', the manual landmarks for B') with the flags that
say which crops are well cut ("good": the same rule as eval_a_complete.py, eval_bprime.py and eval_pulawy_crops.py use; set A: the main
detection of its photo with the box inside the photo, flagged ones included) and which the backend flags.
"""
import hashlib
import json

import numpy as np

import evalkit as K
import features as F
from config import POSES, WORK
from labels import pose_name, sure

HOG = {"kind": "hog", "cells": [16, 6], "bins": 8, "signed": True, "input": "gray", "norm": "sqrt", "sigma": 0.0}
OUT = WORK / "parity"


def sha(a):
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()


def items():
    """(set, path relative to work/, truth pose or None, good, flagged by the backend) of every picture."""
    real_meta = json.loads((WORK / "real" / "meta.json").read_text(encoding="utf-8"))
    real_labels = json.loads((WORK / "real" / "labels.json").read_text(encoding="utf-8"))
    for cid, m in real_meta.items():
        lab = real_labels.get(cid)
        if not lab:
            continue
        pose = pose_name(lab["det"], lab["angle"]) if sure(lab["angle"]) else None
        g, valid = K.real_gray(WORK / "real" / f"{cid}.png")
        good = bool(m["main"] and valid.mean() >= 0.97 and pose is not None)
        yield "A", f"real/{cid}.png", pose, good, bool(lab["check"])
    for m in json.loads((WORK / "bprime" / "meta.json").read_text(encoding="utf-8")):
        if not m["detected"]:
            continue
        yield "Bp", f"bprime/png/{m['id']}.png", m["pose"] if m["sure"] else None, bool(m["sure"] and m["complete"]), False
    pu_meta = json.loads((WORK / "pulawy_crops" / "meta.json").read_text(encoding="utf-8"))
    pu_labels = json.loads((WORK / "pulawy_crops" / "labels.json").read_text(encoding="utf-8"))
    for cid, m in pu_meta.items():
        lab = pu_labels.get(cid)
        if not m["detected"] or not lab:
            continue
        pose = pose_name(lab["det"], lab["angle"]) if sure(lab["angle"]) else None
        yield "A2p", f"pulawy_crops/{cid}.png", pose, bool(pose is not None and not lab["check"]), bool(lab["check"])


def main():
    templates = np.load(WORK / "ship" / "templates.npy").astype(np.float32)
    out = []
    for n, (name, rel, pose, good, flagged) in enumerate(items()):
        g, valid = K.real_gray(WORK / rel)
        rep = F.rep_one(g, HOG, valid)
        sc = F.scores(rep[None, :], templates)
        best, margin = F.decide(sc)
        out.append({"set": name, "png": rel, "truth": pose, "good": good, "flagged": flagged, "gray_sha256": sha(g), "valid_all": bool(valid.all()),
                    "valid_sha256": sha(valid.astype(np.uint8)), "descriptor_sha256": sha(rep), "scores": [float(v) for v in sc[0]],
                    "best": POSES[int(best[0])], "margin": float(margin[0])})
        if (n + 1) % 1000 == 0:
            print(n + 1, "pictures", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "table.json").write_text(json.dumps(out), encoding="utf-8")
    for s in ("A", "Bp", "A2p"):
        rows = [r for r in out if r["set"] == s]
        good = [r for r in rows if r["good"]]
        print(f"set {s}: {len(rows)} pictures, {len(good)} good, errors of the reference among the good: {sum(r['best'] != r['truth'] for r in good)}")


if __name__ == "__main__":
    main()
