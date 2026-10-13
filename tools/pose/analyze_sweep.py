"""Reads work/sweep/results_*.json (or the live output of the sweep) and ranks the variants, and shows what every setting does on average.

    python tools/pose/analyze_sweep.py hog|ghist|ink [--set det|asis] [--top 15]
"""
import argparse
import json
from collections import defaultdict

from config import WORK


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("family")
    ap.add_argument("--set", default="det")
    ap.add_argument("--top", type=int, default=15)
    a = ap.parse_args()
    res = json.loads((WORK / "sweep" / f"results_{a.family}_{a.set}.json").read_text(encoding="utf-8"))
    if a.family == "ink":
        stats = [k for k in res[0] if k != "spec"]
        print("best settings per statistic (share of canonical wings where the statistic has the right sign):")
        for st in stats:
            best = max(res, key=lambda r: r[st])
            print(f"  {st:11s} {best[st] * 100:6.2f}%  {best['spec']}")
        return
    res.sort(key=lambda r: (-r["pose"], -r["margin_min_ok"]))
    print(f"top {a.top} of {len(res)}:")
    for r in res[: a.top]:
        s = r["spec"]
        print(f"  pose {r['pose'] * 100:.3f}% x {r['x'] * 100:.2f} y {r['y'] * 100:.2f} err {r['errors']:3d}  worst {r['worst_country'][0]} {r['worst_country'][1] * 100:.1f}  "
              f"margin ok min {r['margin_min_ok']:.3f}  cells={s.get('cells')} bins={s.get('bins')} signed={s.get('signed')} input={s.get('input')} norm={s.get('norm')} sigma={s.get('sigma')}")
    print("\nwhat each setting does (mean pose accuracy over all variants that use it):")
    for key in ("cells", "bins", "signed", "input", "norm", "sigma"):
        groups = defaultdict(list)
        for r in res:
            groups[str(r["spec"].get(key))].append(r["pose"])
        print("  " + key + ": " + "   ".join(f"{k} -> {sum(v) / len(v) * 100:.3f}% (n={len(v)})" for k, v in sorted(groups.items())))


if __name__ == "__main__":
    main()
