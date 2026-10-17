# WingAI backend

A FastAPI service that predicts the 19 landmarks of a honey bee forewing from an image. It serves the [frontend](../frontend/README.md), runs behind nginx in the Docker setup and is part of the [WingAI application](../README.md).

## How it works

When the service starts, it loads the two landmark models and the mean wing shape from `models/` once and keeps them in memory. A request to `POST /analyze` then goes through these steps:

1. **Decode.** The image is decoded to one gray channel, with its EXIF orientation applied.
2. **Fit.** It is scaled to fit a 400 x 400 square without changing its proportions, padded with zeros to that size and normalised to zero mean and unit variance.
3. **Predict.** A U-Net outputs a mask with one blob for every landmark. The mask is rounded to 0 and 1.
4. **Locate.** The centre of every blob is a point. A blob larger than 1.5 times the median blob is taken for two landmarks that touch, and a watershed splits it. The points are mapped back to the pixels of the original image.
5. **Number.** The blobs come in no fixed order, so a Procrustes match to the mean wing shape gives every point its landmark number. It copes with up to 3 extra and up to 3 missing points.
6. **Judge.** The service decides whether the result needs a second look (`check`) and whether the wing is a right or a left one (`orientation`).

The work of a request runs in the default thread pool of the event loop, so the server keeps accepting requests while it computes. Images are processed in memory and are not stored.

## Running

Requirements: Python 3.13 and [uv](https://docs.astral.sh/uv/).

Add the model files (see below), then start the service:

```bash
uv sync
uv run uvicorn main:app --port 8000
```

The API listens on `http://localhost:8000`, with interactive documentation at `/docs`. PyTorch is installed in its CPU build, from the PyTorch index set in `pyproject.toml`, so the service runs on the CPU.

### Model files

| File | Purpose |
| --- | --- |
| `models/final-precise.ckpt` | checkpoint of the `precise` model |
| `models/final-rotation-2.ckpt` | checkpoint of the `rotation` model |
| `models/mean_shape.pth` | the mean wing shape that the points are matched to |

The weights are not part of the repository and the files in `models/` are git-ignored, so add them yourself. The service loads all three at startup and stops with an error when one is missing. Restart it after you change them. The checkpoints and the mean shape are Python pickles, so use only files that you trust. The weights come from the training pipeline in [bees](https://github.com/mkrajew/bees).

### Docker

The image is built from `python:3.13-slim`. `uv sync --frozen` installs exactly what `uv.lock` says, and `UV_PYTHON_DOWNLOADS=never` makes uv use the Python of the image instead of downloading another one. The system libraries that OpenCV needs (`libgl1`, `libglib2.0-0`) are installed too. The image holds `main.py` and `wings/` but no models: mount the folder at `/app/backend/models`. The container listens on port 8000. Docker Compose starts it and nginx forwards `/api/` to it, see [Run locally with Docker](../README.md#run-locally-with-docker).

## API

### `GET /`

A health check. It returns `{"Hello": "WingAI"}`.

### `POST /analyze`

Takes `multipart/form-data`:

| Field | Type | Description |
| --- | --- | --- |
| `file` | file | The wing image (the app sends PNG and JPEG). |
| `x_size` | integer | Required, but not used: the size is taken from the decoded image. |
| `y_size` | integer | Required, but not used: the size is taken from the decoded image. |
| `model` | string | `precise` or `rotation`. The default is `rotation`. |

```bash
curl -F "file=@wing.png" -F "x_size=700" -F "y_size=270" -F "model=rotation" \
  http://localhost:8000/analyze
```

In the Docker setup the same endpoint is `http://localhost:8080/api/analyze`, because nginx forwards `/api/` to the backend and removes the prefix.

```jsonc
{
  "coords": [190.24, 149.2, 208.42, 150.34], // shortened: a real response has 38 numbers
  "check": false,
  "orientation": "right"
}
```

- `coords`: 38 numbers, `x1, y1, ..., x19, y19`, the 19 landmarks in the order of the mean shape. They are pixel indices of the uploaded image, as in the training data: the point (c, r) is the centre of the pixel in column c and row r. The origin is the top-left corner and the y axis points down.
- `check`: `true` when a person should look at the result, see below.
- `orientation`: `right` when the wing has the handedness of the mean shape, `left` when it is the mirror image of it.

Errors:

| Status | When |
| --- | --- |
| `422` | The file is empty or cannot be decoded as an image, or a form field is missing or invalid (`model` must be `precise` or `rotation`). |
| `500` | The analysis failed. The details are logged together with the name of the file. |

## Models and matching

Both models are the same U-Net (one input channel, one output channel, 5 x 5 convolution kernels) wrapped in a Lightning module. They differ in their weights and in how the points are matched to the mean shape.

| | `precise` | `rotation` |
| --- | --- | --- |
| Checkpoint | `final-precise.ckpt` | `final-rotation-2.ckpt` |
| Trained on | Upright wings of one handedness, without augmentation | Wings in any pose, mirrored ones too |
| Matching | By rotation only | By rotation or reflection, started from 8 angles 45 degrees apart (each as it is and mirrored) and from the angles that PCA suggests |
| Use it for | Upright wings with the base on the right | Wings in any pose |

With `precise`, a mirrored or rotated wing simply comes out flagged.

### The review flag

`check` is `true` when:

- the U-Net found fewer than 19 or more than 22 blobs;
- the matching failed, so the points are only the detected blobs, cut to 19 or filled up with random points inside the image;
- after the matching, a landmark lies farther than 0.04 from its place in the mean shape. Both shapes are centred, scaled to unit length and aligned first, so the distance is relative to the size of the wing.

How the number of blobs is handled:

- **20 to 22 blobs.** The extra ones are dropped. The service tries every way to drop them and keeps the one that fits the mean shape best. This alone does not flag the wing.
- **16 to 18 blobs.** The missing landmarks are put where the mean shape has them after it is fitted to the points that were found. The wing is flagged.
- **Fewer than 16 or more than 22 blobs.** The landmark numbers cannot be trusted: the missing points are random and the extra blobs are cut off. The wing is flagged.

Points that are made up are random, so two requests for the same image can differ.

### Orientation

`orientation` says how the wing relates to the mean shape: `right` when a rotation fits it best and `left` when it needs a reflection. It is computed for every answer, also for flagged ones. With the `precise` model it only means something when `check` is `false`, because that model's matching cannot number the points of a mirrored wing.

## Project structure

```text
backend
├── main.py                  FastAPI app: model loading, /analyze, the review flag
├── wings
│   ├── config.py            location of models/ and the log output
│   ├── utils.py             decoding of the image
│   ├── image_preprocess.py  fitting the image into the U-Net input, blobs to coordinates
│   ├── gpa.py               Procrustes matching of the points to the mean shape
│   └── modeling
│       ├── unet.py          the U-Net (MIT licence, see the header of the file)
│       ├── litnet.py        Lightning module that wraps the network
│       ├── loss.py          loss functions
│       └── models.py        wrappers of pretrained networks
├── models                   model files (git-ignored)
├── Dockerfile
├── pyproject.toml           dependencies
└── uv.lock                  pinned versions
```

`wings` also holds code that the service does not call: the training and evaluation steps of `LitNet`, the loss functions other than `BCEDiceLoss` (which is only built to load a checkpoint), `modeling/models.py`, the other preprocessing variants, `order_coords` and `generalized_procrustes_analysis`, which computes a mean shape.

## Dependencies

FastAPI, Uvicorn, python-multipart, PyTorch and torchvision (CPU build, from the PyTorch index), Lightning, OpenCV, NumPy, SciPy, loguru and tqdm. They are declared in `pyproject.toml` and pinned in `uv.lock`.

## Notes

- The service keeps nothing: no uploaded image, no result, no state besides the loaded models.
- It has no authentication and no request limit. In the Docker setup nginx sits in front of it and limits an upload to 100 MB.
- The backend has no unit tests of its own. The browser scripts in [`tools/regression`](../tools/regression/README.md) run the whole flow of the app against a running backend and record what it receives and answers, so that a change can be compared with the previous behaviour.
