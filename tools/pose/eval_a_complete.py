"""Set A (real photos -> the app's YOLO and crop) with an explicit rule for "a well cut wing": the main detection of the photo whose box lies inside the
photo (the part of the crop that is photo, `valid`, is at least 97%). A wing that is cut by the border of the photo is rejected, as in the app's workflow.

    python tools/pose/eval_a_complete.py [--hog hog-16x6-b8s --ink ink-k11-p1-thirds]     reads work/eval/outputs.npz
"""
import argparse

import numpy as np

import evalkit as K
from config import EVAL, POSES
from rules import TAUS


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hog", default="hog-16x6-b8s")
    ap.add_argument("--ink", default="ink-k11-p1-thirds")
    a = ap.parse_args()
    z = np.load(EVAL / "outputs.npz", allow_pickle=True)
    real = K.load_real()
    ids = list(z["meta__A__ids"])
    assert [r["id"] for r in real] == ids
    valid_frac = np.array([r["valid_frac"] for r in real])
    conf = np.array([r["conf"] for r in real])
    main_, sure, check, truth = z["meta__A__main"], z["meta__A__sure"], z["meta__A__check"], z["meta__A__truth"]
    hog, hm, ink = z[f"{a.hog}__A__pred"], z[f"{a.hog}__A__margin"], z[f"{a.ink}__A__pred"]
    print(f"real crops: {len(ids)}; main detections: {int(main_.sum())}; main and box inside the photo (>=97% is photo): {int((main_ & (valid_frac >= 0.97)).sum())}")
    print(f"main detections cut by the border of the photo (valid < 97%): {[(r['id'], round(r['valid_frac'], 2), POSES.index(r['pose'])) for r in real if r['main'] and r['valid_frac'] < 0.97]}")
    strata = {
        "main, inside the photo, sure, not flagged": main_ & (valid_frac >= 0.97) & sure & ~check,
        "main, inside the photo, sure (flagged too)": main_ & (valid_frac >= 0.97) & sure,
        "main, cut by the photo border, sure": main_ & (valid_frac < 0.97) & sure,
    }
    for name, sel in strata.items():
        n = int(sel.sum())
        print(f"\n[{name}]  n={n}   poses: " + ", ".join(f"{p} {int(((truth == i) & sel).sum())}" for i, p in enumerate(POSES)))
        for label, pred in (("HOG", hog), ("ink", ink)):
            err = int(((pred != truth) & sel).sum())
            print(f"   {label}: errors {err}/{n}  (95% upper bound {K.wilson_upper(err, n) * 100:.2f}%)")
        if n:
            print("   rule (HOG margin >= TAU and ink agrees): " + "  ".join(f"{t:.2f}: {int(((hm >= t) & (hog == ink) & sel).sum())}acc/{int(((hm >= t) & (hog == ink) & sel & (hog != truth)).sum())}err" for t in TAUS[:6]))
    wrong = np.where((hog != truth) & main_ & sure)[0]
    print("\nmain detections where HOG is wrong:", [(ids[i], round(float(valid_frac[i]), 2), POSES[truth[i]], POSES[hog[i]], bool(check[i])) for i in wrong])


if __name__ == "__main__":
    main()
