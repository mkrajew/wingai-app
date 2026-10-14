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
| `S4` | four photos, Detect, and the wings of the third are extracted in the preview ("Extract wings") and processed as pictures of their own. That photo has a second detection that is only a fragment of a wing, which the backend flags in every run; the pose read from a fragment can be sure and wrong, and then the answer of the rotation model turns it back (with a warning in the console) |
| `S5` | the wings of `S3`, two of which are turned by hand in the preview (Flip H, Flip V) before Process |
| `S6` | the photos of `S1` three times, under different names: 24 photos at once (timing) |

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
| `__ABORT_AFTER_MS` | Process is given up after that long (with the back button of the browser: Edit is disabled while the wings are processed) and Process is clicked again; only the second run is reported |
| `__LABEL` | the name of the snapshot: `work/collected-<label>.json` |

For the e2e run set `__TARGET` (`right`, `left`, `original`) and `__LABEL`, and run `e2e-orientation.js` the same way. Its verdicts go to `work/collected-e2e-<label>-<target>.json`.
`__FLOW` is `before` (the default: the wings are turned from their pixels before the request) or `after` (the flow of `main`, which turns them after the answer).

The labels used for the baseline of the `main` branch: `base-S1r`, `base-S1l`, `base-S1o`, `base-S2*`, `base-S3*` (the letter is the orientation), `base-S1o-precise`,
`base-S2o-precise`, `base-S3o-precise`, `base-e2e-<target>` and the repeated S1 runs `base-S1r-t2`, `-t3` and so on (timing, and the proof that a run repeats exactly).

## Judging

```
node tools/regression/compare.mjs <labelA> <labelB>
node tools/regression/compare-oriented.mjs <baseline label> <new label>
backend/.venv/Scripts/python tools/regression/check_upright.py reanalysis <label> right|left|none
backend/.venv/Scripts/python tools/regression/check_upright.py e2e <label> right|left|original
```

* `compare.mjs`: names, what was sent to the backend, the answers, the shown pictures, the landmarks and the console must be equal. The browser draws a canvas
  on the GPU or on the CPU, so a picture may differ by one colour level (block means within 0.6 on average); landmarks within 0.05 px. Timing is only printed.
* `compare-oriented.mjs`: the baseline of `main` (the wings are turned after the answer, the run was made with `__REANALYZE`) against the new flow. The final pictures must be the
  same, every picture sent must be a final picture of the baseline (it was sent already turned), and the landmarks must be those that the backend finds on the final picture,
  which are the ones of the baseline's second analysis. A photo whose request failed is shown, in the new flow, turned like the others (the baseline shows it as it was).
* `check_upright.py reanalysis`: the independent judge. The backend's own alignment to the mean shape says, for every shown picture, which side it is on and
  how far it is turned (near 0 degrees = upright, near 180 = upside down), and how far the landmarks of the app are from the ones found again on the shown picture.
* The distance column is meant for the `rotation` model. On a wing that the `precise` model cannot read (mirrored or upside down) its landmarks are far away: that is
  the baseline of the `precise` runs, not a fault of the harness.
* The landmarks that `precise` gives for such a wing (the ones the backend flags) change from run to run, with the same code and the same picture. When two
  `precise` runs are compared, only the unflagged wings can be expected to be equal.

## Other scripts

* `turn-canvas.js`: does `turnedCanvas` (`src/utils/image.ts`) move the pixels exactly as the turn of the app does? It needs only the Vite page and the helper server.
  It runs on its own and leaves the answer in `window.__turnCanvasResult` (see the header of the file).
* `orient-picture.js`: does `orientPicture.ts` read the pose of real wings (six wings of the PL database in the four poses, a flat picture, a small one and a big one that
  is read from a smaller copy) and turn them to the wanted side, upright, pixel for pixel? It runs on its own like `turn-canvas.js` and leaves the answer in `window.__orientPictureResult`.
* `parity-browser.js`: the pose reading of the app, run in the page on the pixels that a canvas gives, against what the Python reference says (`tools/pose/parity_table.py` makes the table).
  Every twelfth saved crop by default. It runs on its own and leaves the answer in `window.__parityResult`.
* `switches.js`: do the Orientation and Model switches of the header constrain each other as `wingOptions.ts` says (the precise model with the right orientation is allowed,
  with the left one it is not)? It clicks through a row of steps in the real page and needs no backend.

## The review and the upload screens: a change that must not be seen (`review-trace.js`)

`review-trace.js` drives the review screen and the upload screen through a fixed list of 90 steps: the photos with the arrows, the buttons and the list, the zoom slider,
ctrl and the wheel (also in bursts), dragging the picture, the name field, the Edit, Reset, logo and back-button dialogs, the export dialog, language and theme, Delete, Edit
back to the upload screen and the preview window. After every step it records what the page shows: the HTML of the app (blob addresses, thumbnails and the sizes read in the
background are normalised), the values of the inputs, the focus and selection, the scroll of the list, the history state, the language and the dialogs. `compare-trace.mjs`
compares two traces step by step. Made for the lint fixes: the trace of `main` and of the branch had to be identical, and it is, also on the production bundles.

```js
const get = async (p) => (0, eval)(await (await fetch(`http://127.0.0.1:8765/regression/${p}`, { cache: "no-store" })).text());
// once, with the backend running: record its answers (replay.js keeps them in window.__RECORDED)
window.__REPLAY = null;
await get("replay.js");
Object.assign(window, { __SCENARIO: "S1", __ORIENT: "right", __LABEL: "trace-setup" });
await get("run.js");
await fetch("http://127.0.0.1:8765/regression/collect/trace-responses", { method: "POST", body: JSON.stringify(window.__RECORDED) });
// every run, on a freshly loaded page, without the backend: the recorded answers are replayed
window.__REPLAY = await (await fetch("http://127.0.0.1:8765/regression/work/collected-trace-responses.json")).json();
await get("replay.js");
Object.assign(window, { __SCENARIO: "S1", __ORIENT: "right", __LABEL: "trace-setup" });
await get("run.js");                       // uploads, Detect, Process: the page is left on the review screen
window.__LABEL = "main-1";
await get("review-trace.js");              // work/collected-trace-main-1.json
```

```
node tools/regression/compare-trace.mjs main-1 branch-1     # exit code 0: every step shows the same thing
```

* To compare two versions of the code, serve each from its own copy (`git worktree add`, `npm ci`, `npx vite --port 5199`), not one after the other from one tree, and use the same tab.
* The two pages must be in the same state. Open each of them once before the first run (a new address has no detection model in its cache, and the header shows "Ready"
  only after that), and give the tab a fixed size that fits in the pane (`resize_window`, for example 1000 by 700). The pane is sometimes drawn with a pixel ratio of 1.25, a
  border is then 0.8 of a pixel and the picture is measured a little differently: the size of the points and the result of a drag change. `compare-trace.mjs` does not count a step
  that differs only in the size of the points, and prints the measured sizes of both runs for any other step; with a different `devicePixelRatio` in the two runs, run them again.
* Does the trace see what it should? Break the code on purpose (do not reset the zoom when the photo changes, open the wrong dialog for the back button, drop the blur of the
  zoom field) and the steps that depend on it differ. The steps are listed in the file; add one when a change touches something that no step reaches.

`review-bench.js` counts, for the same kinds of events, the commits of React and the renders of the review screen, from what the dev build of React 19 writes with
`console.timeStamp`. A stopwatch is useless in a hidden pane (it depends on whether the window draws frames), the counts are not. Run it after `run.js` like `review-trace.js`.

## Process waits for the photos and for Detect (`process-wait.js`)

`process-wait.js` runs on its own in a freshly loaded page, with the helper server and the recorded answers of the backend of the previous section (no backend). It uploads
eight photos and a file that is not a picture and watches the Process button: it has to be disabled, with a spinner and a hint, until every thumbnail and size has come (the
broken file gets neither and must not hold it back); then Detect is started at once, while the photos are still loading, and Process has to be disabled the whole time and every
photo that can be read has to keep its thumbnail; then Process and Edit (the list is back with every thumbnail); a flip in the preview window (Process waits for the new
thumbnail); and the hint in Polish. The result is `work/collected-process-wait-<label>.json`. On the code from before the change (`lint-fixes`) it shows Process enabled at
once, no thumbnails when Process can be clicked, and thumbnails that are lost to Detect and never come back (6 of 8 after Edit).

`run.js` and `e2e-orientation.js` wait for an enabled Process button before they click it.

`detect-live.js` (same conditions, the dev build, a window of a proper size, for example `resize_window` to 1000 by 700; without it the picture of the preview has no size and no box is drawn)
uploads 24 photos (`__COPIES`), opens the preview on the first one and clicks Detect. It records when the photos show their detections (one by one, or all at the end), when the boxes of the first
photo are drawn in the open preview, how often React committed while Detect ran and how long its renders took, and the final numbers of detections, which have to be the same in every version.
`__PREVIEW = false` leaves the preview closed. The time of Detect varies from run to run by more than any difference between versions (10 to 17 s for 24 photos in the hidden pane), so compare
versions in the order A B B A, several times.

`rename-draft.js` (same conditions) types a name into the name field of the preview window, then marks the photo to be skipped and lets Detect give it its boxes: the name that is being typed
has to stay. Then the next photo is shown (the field takes its name) and a name is committed with Enter (the photo is renamed, the field and the list show it). `ok` in the result says whether all
of it came out right. Before the name field was keyed on the name of the photo, the typed name was lost at the first change of the photo.

## Notes for working in the Browser pane

* A hidden pane waits about a second in every `canvas.toBlob`, and `img.decode()` never settles there: use `onload`. The tool gives a script 45 seconds,
  so a long one is started without `await` and its answer is read later from `window`.
* The Vite dev server can keep serving the version of a module from before the last of several quick edits. After editing, touch the files
  (`touch frontend/src/...`), or fetch the module with a query (`/src/utils/image.ts?x=1`) to see what the server holds.
