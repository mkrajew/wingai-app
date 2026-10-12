# Reading the pose of a wing crop from its pixels

Tools that test how well the pose of a wing crop can be read **from the pixels alone**, before the picture goes to the backend.
The task assumes good crops: a complete wing, long axis horizontal (what the YOLO crop of the app gives).

## What is measured

A straightened crop is only rotated, never mirrored, so it is in one of four poses. The canonical pose is the one of the mean shape of the
backend (`frontend/src/utils/wingPose.ts`): the **base of the wing on the right**, the tip on the left and the **thick leading-edge vein at the top**.

| pose | base | thick vein | what it is |
|---|---|---|---|
| `id` | right | top | right wing, upright |
| `rot180` | left | bottom | right wing, upside down |
| `flipH` | left | top | left wing, upright |
| `flipV` | right | bottom | left wing, upside down |

Two yes/no questions give the pose: *is the thick vein at the top?* (not upside down) and *is the base on the right?* (right wing).

## Methods

* **ink** ("where is the ink"): the veins are made to stand out (the picture minus its morphological closing), their mass is compared between the
  right and the left third and between the top and the bottom band.
* **hog**: histograms of gradient directions in a grid of cells ("with position"), compared (normalised cross correlation) with the average wing in
  each of the four poses. The *margin* is the correlation of the best pose minus the one of the second best.
* **ghist**: one gradient histogram for the whole picture (no position), the baseline.

All of them work on a gray picture shrunk to 256 x 96 (`config.py`).

## Data

Not in this repository. Set the folder with `BEES_DATA` (default `~/projects/bees/data`):

| set | what | truth |
|---|---|---|
| **B** | `processed/cropped`: ~26 000 wings of 13 countries with manual landmarks, shown in the 4 poses (`build_sets.py`) | exact (the pose is made by flipping) |
| **A** | real crops of the app: its own detector and `straightenedCrop` on the raw photos (2026 series, BM, Pulawy) | the backend (model `rotation`), as the app judges a wing |
| **A2** | the small, already cropped wings of the Pulawy folder | the backend |
| **C** | perturbed wings of set B (tilt, framing, light, JPEG, blur, noise, a part outside the photo, dirt) | exact |

## Order of work

```
python tools/pose/build_sets.py                 # set B -> work/B/*.npz
python tools/pose/completeness.py               # which wings of B are complete in their picture
python tools/pose/browser/collect_server.py     # the helper server of the browser part
#   in the Vite page: window.__ITEMS = [...]; run browser/export-crops.js   (crops of the real photos, set A)
python tools/pose/import_real.py tools/pose/work/inbox
python tools/pose/label_real.py crops           # backend truth for set A      (backend running)
python tools/pose/label_real.py pulawy          # backend truth for set A2
python tools/pose/sweep.py ink|hog|ghist        # which variant is best (development part of B)
python tools/pose/analyze_sweep.py hog
python tools/pose/evaluate.py                   # the finalists on every set (work/eval/finalists.json)
python tools/pose/stress.py                     # set C
python tools/pose/rules.py                      # the "unsure" rule
```

Everything runs with the Python of the backend (`backend/.venv`), no new dependencies. Big files go to `tools/pose/work/` (git-ignored).
