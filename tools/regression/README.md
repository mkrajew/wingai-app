# Regression harness for "Process"

Browser scripts that run the real flow of the app (upload, Detect with the YOLO model, crop, the backend, the review screen) and record what
the backend receives and what the review shows. The same run before and after a change can then be compared. It was made for the change that
orients a wing from its pixels (`tools/pose`), and it is not part of the app.

## What has to run

| what | how |
|---|---|
| the backend | `cd backend && uv run uvicorn main:app --port 8000` |
| the frontend | `cd frontend && npm run dev` (the `/api` proxy of the main README is needed) |
| the helper server | `python tools/pose/browser/collect_server.py` (serves the photos from the bees data folder, `BEES_DATA`, and the scripts; collects the results in `tools/regression/work/`, git-ignored) |

Data: the photos `IMG_6466` to `IMG_6473` of the 2026 Swietokrzyskie series (`/raw/`) and wings of `processed/cropped/PL-wing-images`.

## Scenarios (`run.js`)

| scenario | what is uploaded |
|---|---|
| `S1` | eight photos, all cropped by the detector: all four poses of a wing are among them |
| `S2` | six photos and one more under a name that gives the same output name; after Detect a clean wing saved as JPEG (not cropped) and a broken `.jpg`; the backend answers 500 for one photo |
| `S3` | seven wings that are already cut (no Detect), upright or upside down, on either side, flagged or not |

`e2e-orientation.js` uploads natural wings, their mirror images and two wings turned by 180 degrees, processes them, downloads the ZIP and checks
pixels, landmarks and the metadata against what the backend said. Edit must bring the originals back.

## Running one

Load the Vite page afresh (every run patches `fetch` and the console), then run in the page, for example with the browser tool:

```js
Object.assign(window, { __SCENARIO: "S1", __ORIENT: "right", __REANALYZE: true, __LABEL: "base-S1r" });
await (0, eval)(await (await fetch("http://127.0.0.1:8765/regression/run.js", { cache: "no-store" })).text());
```

| variable | meaning |
|---|---|
| `__SCENARIO` | `S1` (default), `S2`, `S3` |
| `__ORIENT` | `right`, `left`, `original`: the orientation switch (S1 and S3 leave it alone when it is not set) |
| `__MODEL` | `precise`, `rotation`: the model switch (precise puts the orientation on `original`) |
| `__REANALYZE` | `true`: send every shown picture to the backend again, for `check_upright.py` |
| `__LABEL` | the name of the snapshot: `work/collected-<label>.json` |

For the e2e run set `__TARGET` (`right`, `left`, `original`) and `__LABEL`, and run `e2e-orientation.js` the same way. Its verdicts go to `work/collected-e2e-<label>-<target>.json`.

The labels used for the baseline of the `main` branch: `base-S1r`, `base-S1l`, `base-S1o`, `base-S2*`, `base-S3*` (the letter is the orientation), `base-S1o-precise`,
`base-S2o-precise`, `base-S3o-precise`, `base-e2e-<target>` and the repeated S1 runs `base-S1r-t2`, `-t3` and so on (timing, and the proof that a run repeats exactly).

## Judging

```
node tools/regression/compare.mjs <labelA> <labelB>
backend/.venv/Scripts/python tools/regression/check_upright.py reanalysis <label> right|left|none
backend/.venv/Scripts/python tools/regression/check_upright.py e2e <label> right|left|original
```

* `compare.mjs`: names, what was sent to the backend, the answers, the shown pictures, the landmarks and the console must be equal. The browser draws a canvas
  on the GPU or on the CPU, so a picture may differ by one colour level (block means within 0.6 on average); landmarks within 0.05 px. Timing is only printed.
* `check_upright.py reanalysis`: the independent judge. The backend's own alignment to the mean shape says, for every shown picture, which side it is on and
  how far it is turned (near 0 degrees = upright, near 180 = upside down), and how far the landmarks of the app are from the ones found again on the shown picture.
* The distance column is meant for the `rotation` model. On a wing that the `precise` model cannot read (mirrored or upside down) its landmarks are far away: that is
  the baseline of the `precise` runs, not a fault of the harness.
* The landmarks that `precise` gives for such a wing (the ones the backend flags) change from run to run, with the same code and the same picture. When two
  `precise` runs are compared, only the unflagged wings can be expected to be equal.

## Other scripts

* `turn-canvas.js`: does `turnedCanvas` (`src/utils/image.ts`) move the pixels exactly as the turn of the app does? It needs only the Vite page and the helper server.
  It runs on its own and leaves the answer in `window.__turnCanvasResult` (see the header of the file).
* `switches.js`: do the Orientation and Model switches of the header constrain each other as `wingOptions.ts` says (the precise model with the right orientation is allowed,
  with the left one it is not)? It clicks through a row of steps in the real page and needs no backend.

## Notes for working in the Browser pane

* A hidden pane waits about a second in every `canvas.toBlob`, and `img.decode()` never settles there: use `onload`. The tool gives a script 45 seconds,
  so a long one is started without `await` and its answer is read later from `window`.
* The Vite dev server can keep serving the version of a module from before the last of several quick edits. After editing, touch the files
  (`touch frontend/src/...`), or fetch the module with a query (`/src/utils/image.ts?x=1`) to see what the server holds.
