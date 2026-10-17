# WingAI frontend

The web application of WingAI, written in React and TypeScript and built with [Vite](https://vite.dev/). In the browser it can find and crop the wings in photos and turn them to one side. It sends the pictures to the [backend](../backend/README.md) and lets you review, correct and export the landmarks. It is part of the [WingAI application](../README.md).

## What it does

- **Upload** of many `.png` and `.jpg` photos at once, with thumbnails.
- **Wing detection** in the browser, when the detector is provided: every wing is found as a rotated box, cropped and turned horizontal. A photo with several wings can be split into separate images.
- **Orientation:** all wings can be turned to one side, upright. The browser reads the pose of each wing from its pixels, so it can turn the wing before the request.
- **Landmark prediction** by the backend, with a choice of the `precise` or the `rotation` model.
- **Review:** landmarks can be dragged, with zoom and pan. Wings that need a second look are listed and marked.
- **Export** of the coordinates as a CSV, and of the images with the landmarks embedded as PNG for IdentiFly. The formats are described in the [main README](../README.md#output).
- An interface in English and Polish, with a light and a dark theme.

## Running

Requirements: Node.js 20.19 or newer (22.18 or newer to run the tests).

```bash
npm ci
npm run dev
```

The dev server runs on http://localhost:5173. The app calls the backend under `/api`: the dev server (`server.proxy` in `vite.config.ts`) forwards these requests to the backend on `http://127.0.0.1:8000` and removes the prefix, as nginx does in the Docker setup. Start the backend first, see the [main README](../README.md#development). The optional wing detector goes to `public/models/best-dota.onnx`. The files in that folder are git-ignored, and for the Docker image the file has to be there before the image is built.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the dev server. |
| `npm run build` | Type-checks the app, the tests and the Vite configuration (`tsc -b`), then builds the production bundle into `dist/`. |
| `npm run preview` | Serves the built `dist/` locally. |
| `npm run lint` | Runs ESLint. |
| `npm test` | Runs the unit tests. |

## How it works

The app has two screens, **upload** and **review**, and keeps all of its state in `src/App.tsx`.

### From photos to landmarks

1. **Photos are added.** Each gets a thumbnail (128 px on the long edge) and its size, three photos at a time, so that the browser never decodes full-size photos to draw a list. **Process** stays grey until every photo has both.
2. **Detect** (optional) runs the detector over the photos one after the other and shows the boxes of every photo as soon as it is done. In the preview window you choose the box that is cropped, exclude boxes, flip or rotate a photo, or extract every wing into a photo of its own.
3. **Process** runs two stages at the same time, each with four photos at once:
   - *prepare*: the photo is cropped around its main detection and turned horizontal. When a side is chosen, the pose of the wing is read from the pixels and the picture is turned to that side. A crop is shown as soon as it is ready.
   - *analyse*: the picture is sent to `POST /api/analyze` with the chosen model. The answer must hold 38 finite numbers in `coords`, a `check` flag and an `orientation`, otherwise the photo gets an error.

   A photo whose request fails shows its error, and the others go on.
4. **Review.** Each photo shows its landmarks on top of its picture, drawn in an SVG with one unit per image pixel. Landmarks are dragged with the pointer, the picture is zoomed (1 to 3 times) and panned, and the review can jump from one flagged wing to the next. Photos can be renamed or deleted, and **Edit** goes back to the upload screen with the original list.
5. **Export.** **Generate data** downloads `points.csv` and/or `image-metadata.zip`. The ZIP is written by hand (`createZipBlob` in `src/utils.tsx`, entries stored without compression), and the landmarks go into a PNG text chunk (`addPngTextChunk`) under the key `IdentiFly`.

### Wing detector

The detector is an oriented-box YOLO model in ONNX format, run in the browser with ONNX Runtime Web (WebAssembly, one thread). `src/utils/yoloDetector.ts` letterboxes the photo into the input of the model (its declared size, or 640 px when the model accepts any size), runs it and decodes the rows of the output: centre, size, confidence, class and angle, with the NMS already applied by the model. Detections with a confidence below 0.25 are dropped. `src/utils/obb.ts` holds the geometry of the rotated boxes, and `src/utils/obbCrop.ts` cuts the part of a photo inside a box, turned so that its long side is horizontal.

The **Load model** button of the header panel downloads `public/models/best-dota.onnx` and keeps it in the Cache Storage of the browser (`wingai-models-v1`), so the next visit does not download it again. Detect fails until the model is loaded.

### Orientation from pixels

When a side is chosen, the browser turns every wing to it before the request. `src/utils/poseFromPixels.ts` shrinks the crop to 256 x 96 gray pixels (`areaResize.ts` does this exactly as OpenCV's `INTER_AREA`), builds histograms of gradient directions in 16 x 6 cells and compares them with the average wing of each of the four poses (`poseTemplates.ts`, generated from the Python reference in [`tools/pose`](../tools/pose/README.md)). The best pose wins and is trusted when it beats the second best by at least 0.10. A wing whose pose is not read with confidence is left as it is. `src/utils/orientPicture.ts` applies the reading and turns the picture on a canvas.

The two switches of the header choose the model and the orientation, and `planRequest` in `src/utils/wingOptions.ts` turns them into what happens before and after the request. The switches never allow the `precise` model with the left orientation.

| Model | Orientation | Before the request | After the answer |
| --- | --- | --- | --- |
| `precise` | original | nothing | nothing |
| `precise` | right | wings are turned to the right from their pixels | nothing |
| `rotation` | original | nothing | nothing |
| `rotation` | left or right | wings are turned to that side from their pixels | the answer is checked, and a wing that is still on the wrong side or upside down is turned together with its landmarks |

## Project structure

```text
frontend
├── src
│   ├── App.tsx               state and flow: upload, detect, process, review
│   ├── main.tsx              entry point
│   ├── i18n.tsx              English and Polish texts
│   ├── LanguageProvider.tsx  language context
│   ├── utils.tsx             ZIP writer and PNG text chunk of the export
│   ├── components            screens and controls
│   └── utils                 helpers, see below
├── tests                     unit tests and fixtures/pose-golden.json
├── public                    logo and icons; models/ holds the detector (git-ignored)
├── Dockerfile                builds the app and serves it with nginx
├── vite.config.ts            React plugin, the ONNX Runtime assets, the /api proxy of the dev server
├── eslint.config.js
└── tsconfig*.json            app, Node files and tests
```

`src/components`: `UploadImages` (drop zone and list of photos), `ImagePreviewModal` (preview with the detected boxes, flip, rotate and extract), `ReviewImages` (review, editing and export), `DetectionModelPanel` (loading of the detector), `WingOptionSwitches`, `SegmentedSwitch`, `ThemeSwitch` and `LanguageSwitcher` (header controls), `HelpPanel` (keyboard shortcuts) and `ConfirmDialog`.

`src/utils` holds plain functions that need no React where possible, and the unit tests cover most of them:

| Module | Purpose |
| --- | --- |
| `yoloDetector.ts` | Loads the model from the cache, prepares a photo, runs it and decodes the boxes. |
| `obb.ts`, `obbCrop.ts` | Geometry of rotated boxes, and the crop of a photo inside a box. |
| `mainDetection.ts` | Which detection is the main one: the selected one, else the most confident that is not excluded. |
| `detectPhotos.ts` | Detect over a list of photos, one after the other, result by result. |
| `poseFromPixels.ts`, `poseTemplates.ts`, `areaResize.ts` | Reading of the pose from the pixels, the templates it compares with, and the exact area shrinking. |
| `orientPicture.ts`, `wingPose.ts` | Turning a picture to the wanted side, and telling from landmarks whether a wing lies upside down. |
| `landmarks.ts` | Coordinate conventions, turning landmarks together with a picture, the IdentiFly text. |
| `image.ts` | Canvas helpers: loading, thumbnails, transformations. |
| `viewport.ts` | Zoom and pan of the review. |
| `filename.ts`, `imageState.ts` | Names of the output files and the rule for renaming, ids and loading state of the photos. |
| `wingOptions.ts` | The model and orientation switches, their constraints and `planRequest`. |
| `async.ts` | Bounded concurrency and the two-stage `runPipeline`. |
| `modelCache.ts` | URL and cache name of the detector. |

## Tests

`npm test` runs `node --test "tests/**/*.test.ts"`. Node.js 22.18 or newer runs TypeScript as it is, so the tests need no extra packages and no build. They cover the pure modules: area shrinking, the reading of the pose, turning pictures and landmarks, zoom and pan, file names, the state of the photos, the switches and Detect over a list. The pose reading is compared with vectors that the Python reference produced (`tests/fixtures/pose-golden.json`, made by [`tools/pose`](../tools/pose/README.md)), and the area shrinking is checked bit for bit against OpenCV. `tests/helpers.ts` makes the test pictures from integer formulas that the reference uses too.

To check that a change does not alter what **Process** does, use the browser scripts in [`tools/regression`](../tools/regression/README.md).

## Build and Docker image

`npm run build` writes the site to `dist/`. The `ort-assets` plugin in `vite.config.ts` copies the ONNX Runtime `.wasm` and `.mjs` files to the root of `dist/` under their own names, because the detector loads them from `/`, and in the dev server it serves them with the right MIME types.

The `Dockerfile` builds the app in a Node.js 24 image and serves `dist/` with nginx. It copies the whole folder, `public/models/` included, so the detector has to be in place when the image is built. The container has no proxy rules of its own: the nginx in front of it (see [Run locally with Docker](../README.md#run-locally-with-docker)) forwards `/api/` to the backend and serves `.mjs` files with the JavaScript MIME type that the ONNX Runtime worker needs.

## Working on the code

- **Texts.** Every visible text is in `src/i18n.tsx`. To add a language, extend `Lang`, write its `Translations` object (the type checks that no text is missing) and list it in `LanguageSwitcher.tsx`.
- **Theme.** The theme is set with Bootstrap's `data-bs-theme` attribute on the root element, and `src/index.css` defines the colours of both.
- **Fast Refresh.** A file that exports a component exports nothing else (the language provider has its own file for that reason), otherwise editing it reloads the whole page.
- **Types and lint.** TypeScript runs in strict mode, with no unused locals or parameters. ESLint uses the recommended rules of ESLint and typescript-eslint, and the React hooks and Fast Refresh plugins.
- **Browser storage.** `localStorage` keeps the language (`wingai-lang`) and the theme (`wingai-theme`), and the Cache Storage keeps the detector (`wingai-models-v1`).
