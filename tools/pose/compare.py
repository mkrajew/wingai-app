"""One table with every method against every set (reads work/eval/results.json and stress_results.json).

    python tools/pose/compare.py [--markdown]
Each cell is  errors/decisions  (a decision = one wing shown in one pose; for ink and for the real sets one wing = one decision).
"""
import argparse
import json

from config import EVAL


def cell(m):
    return f"{m['errors']}/{m['n']}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--markdown", action="store_true")
    a = ap.parse_args()
    res = json.loads((EVAL / "results.json").read_text(encoding="utf-8"))
    stress = json.loads((EVAL / "stress_results.json").read_text(encoding="utf-8")) if (EVAL / "stress_results.json").exists() else {}
    cols = ["B holdout (straightened)", "B holdout (as in database)", "other country (LOCO)", "A real, main", "A real, all", "A2 Pulawy small", "stress (22 perturbations)"]
    rows = []
    for name, r in res.items():
        lo_err = sum(v["errors"] for v in r["LOCO"].values())
        lo_n = sum(v["n"] for v in r["LOCO"].values())
        st = stress.get(name)
        rows.append([
            name,
            cell(r["Bdet"]["complete"]), cell(r["Basis"]["complete"]), f"{lo_err}/{lo_n}",
            cell(r["A"]["main sure unflagged"]), cell(r["A"]["all sure unflagged"]),
            cell(r["A2"]) if "A2" in r else "-",
            f"{sum(v['errors'] for v in st.values())}/{sum(v['n'] for v in st.values())}" if st else "-",
        ])
    if a.markdown:
        print("| method | " + " | ".join(cols) + " |")
        print("|---|" + "---|" * len(cols))
        for row in rows:
            print("| " + " | ".join(row) + " |")
    else:
        w = [max(len(row[0]) for row in rows) + 1] + [max(len(c), max(len(row[i + 1]) for row in rows)) + 2 for i, c in enumerate(cols)]
        print("method".ljust(w[0]) + "".join(c.rjust(w[i + 1]) for i, c in enumerate(cols)))
        for row in rows:
            print(row[0].ljust(w[0]) + "".join(v.rjust(w[i + 1]) for i, v in enumerate(row[1:])))
    print("\nA real, per source (main detection, sure, not flagged):")
    for name, r in res.items():
        parts = [f"{src} {cell(r['A'][f'main sure unflagged {src}'])}" for src in ("swietokrzyskie", "bm", "pulawy")]
        print(f"  {name:22s} " + "   ".join(parts))
    print("\nother country (LOCO), errors per country:")
    for name, r in res.items():
        print(f"  {name:22s} " + " ".join(f"{cc}:{v['errors']}" for cc, v in r["LOCO"].items() if v["errors"]) or "none")


if __name__ == "__main__":
    main()
