# Reading the pose of a wing crop from its pixels: test report

**Question.** Can the pose of a straightened wing crop (is it upside down, is it a left or a right wing) be read from the pixels alone,
by simple methods without a neural network, before the picture is sent to the backend? The task assumes good crops: a complete wing,
long axis horizontal (what the YOLO crop of the app gives).

**Answer.** Yes. Histograms of gradient directions in a grid of cells ("HOG with position"), compared with the average wing in each of the
four poses, made **no mistake on 5 104 well cut crops after the real YOLO model and crop of the app, in all four poses**:
192 main detections of real raw photos (2026 series, BM, Pulawy), 3 933 wings of 13 databases (put on a canvas like a photo, mirrored or not, turned at random,
then found and cut by the detector) and 979 small wings of another lab. The smallest margin of a correct decision is 0.30, three times the margin of 0.10 that the rule asks for.
"Where is the ink" (ink) made no mistake either with the right setting and is much more tolerant of a strongly tilted wing. A YOLO crop is straight to within a few degrees (3 933 crops of B': median 0.4, 99.9% below 2.6, at most 4.9 degrees; real crops of A: at most 2.1), so that tolerance is a reserve.
Used together (both must agree, and the HOG margin must be at least 0.10) they made no mistake in any set and accepted all of these crops.
The global gradient histogram (no position) is clearly worse. Everything measured without the detector in between (26 000 wings, 92 000 perturbed decisions) says the same and is kept below as a broader check.

## What is after YOLO and what is not

The aim is the statistics of **crops that the app really makes**: the YOLO OBB model (`best-dota.onnx`) finds the wing, `straightenedCrop` cuts it, and only well cut wings count.
Partly visible wings (the other detections at the border of a photo) are not good crops and are left out of the headline numbers.

| set | after the real YOLO and crop? | well cut means |
|---|---|---|
| **A** (real raw photos) | yes | the main detection of the photo, its box inside the photo (at least 97% of the crop is photo) |
| **B'** (databases on a canvas) | yes | all 19 manual landmarks inside the crop, 1.5% from its border |
| **A2'** (small Pulawy wings on a canvas) | yes | the backend is sure about the pose and does not flag the wing |
| B, C, A2 | **no**: pictures of the databases cut by their authors, or perturbed | landmarks inside the picture |

## Poses and the two questions

A crop is only rotated, never mirrored, so it is in one of four poses. Canonical = the pose of the mean shape of the backend (`wingPose.ts`):
the base of the wing on the right, the thick leading-edge vein at the top.

| pose | base | thick vein | what it is |
|---|---|---|---|
| `id` | right | top | right wing, upright |
| `rot180` | left | bottom | right wing, upside down |
| `flipH` | left | top | left wing, upright |
| `flipV` | right | bottom | left wing, upside down |

Upside down = the thick vein is at the bottom. Which wing = where the base is, once the wing is upright.

## Data

| set | what | size | truth |
|---|---|---|---|
| **B** | wings of 13 databases with manual landmarks (AT ES GR HR HU MD ME PL PT RO RS SI TR), straightened like a crop of the app (rotated until the backend reads the same angle as for real crops), each shown in the 4 poses. Split by colony (5 folds); the development folds choose, the holdout fold (4 816 wings, 4 798 complete) judges | 26 468 wings | exact (the pose is made by flipping) |
| **A** | real crops: the app's own detector and `straightenedCrop` on the raw photos of the 2026 series (45 photos), skrzydła-BM (105) and Pulawy (42) | 274 crops; 194 are the main detection of their photo, 192 of them with the box inside the photo (180 of those are also not flagged by the backend) | the backend (model `rotation`) |
| **A2** | small, already cropped wings of the Pulawy folder (another lab and camera) | 1 012, of which 384 sure and not flagged (all upright: the backend flagged the rest) | the backend |
| **B'** | the holdout wings of set B put on a canvas like a photo (mirrored or not, turned at random, scaled; 30% of the turns are exactly 0, 90, 180 or 270 degrees plus noise) and sent through the **real YOLO model and crop of the app**; the manual landmarks are carried into the crop | 3 937 photos: the detector found the wing in 3 936 (99.97%), 3 933 crops are complete (979 `id`, 985 `rot180`, 1 001 `flipH`, 968 `flipV`) | exact (the landmarks of the crop) |
| **A2'** | the 1 012 small Pulawy wings the same way | the detector found the wing in all 1 011 that loaded; the backend flags 32 (3%) and is sure about the rest: 979 crops (238, 263, 234, 244) | the backend |
| **C** | 1 000 complete holdout wings, 23 perturbations: tilt (±3°, ±6°), tighter/looser crop (10%), brightness, gamma, contrast, JPEG (40, 70), blur, noise, low resolution, black part outside the photo (15% on each side, 30%), dirt | 92 000 decisions per method | exact |

"Complete" = every one of the 19 landmarks is at least 1.5% of the picture away from its border (strips that cut a wing are not good crops).
The residual tilt of the real crops is small: median 0.34°, 99th percentile 1.5°, maximum 2.1° (182 main crops, from the angle that the backend reads).

## Methods

* **hog** (primary): Sobel gradients of the gray picture (256 x 96), direction in 8 signed bins, magnitude summed in a 16 x 6 grid of 16 px cells, square root; 768 numbers.
  The pose is the one whose template (the average descriptor of the training wings shown in that pose) correlates best. The *margin* is the difference to the second best.
* **ink**: the picture minus its morphological closing (ellipse 11 x 11) = the veins; offset 20; the vein mass in the right third against the left third
  (the base is full of veins, the tip is almost empty) and in the top half against the bottom half (the thick vein).
* **ghist**: one gradient histogram for the whole picture, no position (the baseline).
* About 120 HOG variants (cells 8x3, 16x6, 32x12; 4, 8, 16 bins; signed or not; gray or vein map; sqrt or none; smoothing), 12 global-histogram variants and 32 ink settings with 8 statistics each were compared on the development folds.

## Results

### 0. After the real YOLO and crop (the sets that count)

All methods use the templates made from the development folds of set B; none of these wings or photos was used to make a template.
Errors / crops (95% upper bound of the error rate):

| method | A real, main, inside the photo (192) | B' databases through YOLO (3 933) | A2' Pulawy small through YOLO (979) |
|---|---|---|---|
| **hog-16x6-b8s** | **0** (1.96%) | **0** (0.10%) | **0** (0.39%) |
| hog-8x3-b4s, hog-8x3-b16u-s1, hog-16x6-b16u-s1, hog-16x6-b8s-vein | 0 | 0 | not run |
| ghist-32s-gray / ghist-32s-vein | 0 | 0 | not run |
| ghist-16s-gray | 0 | 34 | not run |
| **ink-k11-p1-thirds** | 0 | **0** | **0** |
| ink-k11-p2-halves | 0 | 3 | 0 |
| ink-k11-p2-centroid | 0 | 10 | 0 |
| ink-k21-thirds (the first guess) | 1 (of 182) | 86 | not run |

* Every one of the four poses is in each set (A: 99 / 36 / 39 / 18, B': 979 / 985 / 1 001 / 968, A2': 238 / 263 / 234 / 244); the confusion matrix of `hog-16x6-b8s` on B' is the diagonal.
* The margin of the correct decisions of `hog-16x6-b8s`: B' minimum 0.324 (median 0.515), A2' minimum 0.375, A minimum 0.30. With the rule (margin at least 0.10 and ink agrees) **every crop is accepted and none is wrong**, for every TAU up to 0.30.
* 1 520 of the B' crops were turned to within 6 degrees of a multiple of 90, where the axis angle of the detector flips by 180 degrees: all correct. The method reads the pixels of the crop, not the angle of the box.
* A cut wing never reached these numbers: the detector gave a crop that cut a landmark off in 3 of 3 936 cases (those are not counted), and the main detections cut by the photo border were left out of A (2 of 194; both are also right).
* After the YOLO crop the backend flags 3% of the small Pulawy wings; sent as they are (without the detector) it flagged 62% of them. The cut itself helps the backend.

### 1. The sweep (broader check, no detector in between)

(Development folds, 3 490 wings x 4 poses, cross validation by colony.)

All 120 HOG variants read 99.2 to 99.5% of all wings correctly, and **100.000% (0 errors in 13 740 decisions) of the complete wings** for the 12 that were repeated on complete wings only.
Every error of the sweep was a wing cut by the border of its picture (55 of 3 490 sampled wings). The settings hardly matter (the mean over all variants moves by at most 0.04 points per setting), so the choice is made on robustness and simplicity.
With the right setting ink also makes no mistake on complete wings (kernel 11 is the key; 21 and 31 are worse). The global histogram needs 32 bins on the vein map to reach the same, and it is the least robust.

### 2. Every method against the sets without the detector (errors / decisions)

| method | B holdout (straightened) | B holdout (tilted as in the database) | other country (LOCO) | A real, main | A real, all | A2 Pulawy small | perturbations |
|---|---|---|---|---|---|---|---|
| **hog-16x6-b8s** | **0/19192** | 1525/19192 | **0/18640** | **0/182** | **0/234** | **0/384** | **6/92000** |
| hog-8x3-b4s | 4/19192 | 1316/19192 | 4/18640 | 0/182 | 0/234 | 0/384 | 221/92000 |
| hog-8x3-b16u-s1 | 0/19192 | 1180/19192 | 0/18640 | 0/182 | 0/234 | 0/384 | 12/92000 |
| hog-16x6-b16u-s1 | 0/19192 | 1366/19192 | 0/18640 | 0/182 | 0/234 | 0/384 | 12/92000 |
| hog-16x6-b8s-vein | 0/19192 | 1378/19192 | 0/18640 | 0/182 | 0/234 | 0/384 | 6/92000 |
| hog-16x6-b8s-aug12 (tilt-averaged template) | 0/19192 | 1121/19192 | 0/18640 | 0/182 | 0/234 | 0/384 | 6/92000 |
| ghist-16s-gray | 749/19192 | 2632/19192 | 1550/18640 | 0/182 | 0/234 | 0/384 | 8637/92000 |
| ghist-32s-gray | 10/19192 | 2174/19192 | 52/18640 | 0/182 | 0/234 | 0/384 | 1677/92000 |
| ghist-32s-vein | 0/19192 | 2189/19192 | 4/18640 | 0/182 | 0/234 | 0/384 | 2495/92000 |
| **ink-k11-p1-thirds** | **0/19192** | **56/19192** | 1/4660 wings | 0/182 | 0/234 | 0/384 | 32/92000 |
| ink-k11-p2-halves | 4/19192 | 48/19192 | 2/4660 wings | 0/182 | 0/234 | 0/384 | 76/92000 |
| ink-k21-thirds (the first guess) | 132/19192 | 308/19192 | 52/4660 wings | 1/182 | 1/234 | 18/384 | 656/92000 |

(A decision is one wing shown in one pose. Ink statistics change sign exactly under the flips, so for LOCO a wing counts once.)

* **Tilt is the one weakness of HOG.** Wings tilted by 10 to 25° (ES, GR, PT, as framed in their databases) are mistaken about their top and bottom (1 525 of 19 192). Ink hardly notices (56).
  The real crops of the app never come close to that tilt (at most 2.1°), and the perturbation test with ±6° gives HOG 2 to 8 mistakes out of 4 000. Averaging the template over tilts helps a little (1 121) and was not kept: it lowers the margins on the small Pulawy wings.
* **Ink is weak where HOG is strong**: a black part at the top (the thick vein is cut off) or at the right (the base) of the crop, and very dark pictures (12 to 16 mistakes per 4 000).
  HOG makes 0 to 4 there.
* The global histogram (no position) is not safe: tilt, black parts and the left out countries break it.

### 3. The rule: accept only when both methods agree and the margin is large enough (sets without the detector; after YOLO it accepts everything and none is wrong)

HOG `hog-16x6-b8s` with ink `ink-k11-p1-thirds`. Cells: share of decisions accepted / wrong decisions among the accepted.

| set | decisions | HOG errors | ink errors | TAU 0.00 | 0.05 | 0.10 | 0.15 | 0.20 | 0.30 |
|---|---|---|---|---|---|---|---|---|---|
| B holdout, straightened | 19 192 | 0 | 0 | 100%/0 | 100%/0 | 100%/0 | 99.9%/0 | 99.8%/0 | 97.7%/0 |
| other country (LOCO) | 18 640 | 0 | 4 | 100%/0 | 100%/0 | 99.9%/0 | 99.8%/0 | 99.6%/0 | 91.0%/0 |
| perturbations | 92 000 | 6 | 32 | 100%/0 | 99.9%/0 | 99.7%/0 | 99.1%/0 | 98.2%/0 | 91.3%/0 |
| A real crops, main | 182 | 0 | 0 | 100%/0 | 100%/0 | 100%/0 | 100%/0 | 100%/0 | 100%/0 |
| A real crops, all complete | 234 | 0 | 0 | 100%/0 | 100%/0 | 100%/0 | 100%/0 | 100%/0 | 100%/0 |
| A2 small Pulawy wings | 384 | 0 | 0 | 100%/0 | 100%/0 | 100%/0 | 80.2%/0 | 10.2%/0 | 0%/0 |
| B holdout, tilted as in the database | 19 192 | 1 525 | 56 | 92.3%/56 | 90.7%/56 | 89.5%/48 | 88.0%/28 | 86.7%/12 | 84.2%/0 |

The margin of the small Pulawy wings is lower (median 0.17) than the margin of the other sets (median 0.5): they come from another lab, and the backend itself flags 62% of them. A margin of 0.10 keeps them all.
With the template that will ship (made from 7 650 complete wings of all 13 countries, none of A or A2): **A main 182/182 accepted, 0 mistakes; A all 234/234, 0; A2 383/384, 0**.

### 4. Where it fails

* Wings cut by the border of the photo (the other detections of a photo, a piece of a neighbour): 11 wrong out of 273 real crops when these are counted, all of them fragments that the backend flags too. They are not the main detection.
* A wing tilted by 15° or more in the crop (not what YOLO gives): HOG is wrong, ink is mostly right, the agreement rule leaves 48 mistakes among 17 000 accepted decisions at TAU 0.10 and none from TAU 0.25.
* The truth of the real sets is what the backend reads, not a human label. The number of real crops is small (274 crops, 182 main).

### 5. What the turn gives the two models of the backend (set T)

**Set T.** 745 wings of the test split of the backend's models (the list in `bees/reports/deepwings_full_test_raw_coords.json`, so the models did not see them in training), eight countries,
one synthetic photo each, through the real YOLO model and crop of the app. All 745 were found and are well cut: 164 `id`, 204 `rot180`, 178 `flipH`, 199 `flipV`. The pose that the app reads was right
and sure in all 745 (smallest margin 0.314). The median crop is 689 px wide (the pictures of the databases are small), so 1 px is about 0.15% of the length of the wing.
The backend was asked about every crop as it lies and turned the way the app turns it (`measure_precise.py`). The error of a wing is the mean distance of its 19 landmarks from the manual ones.

| the wing goes to the backend | model | mean error | median | 90% | flagged by the backend |
|---|---|---|---|---|---|
| as it lies (what the app did so far; the wing and its landmarks were turned afterwards) | `rotation` | 1.68 px (0.236% of the length) | 1.36 px | 2.10 px | 7 (1%) |
| as it lies (what is possible so far) | `precise` | 152.6 px (21.9%) | 157 px | 289 px | 584 (78%) |
| turned to the right | `rotation` | 1.45 px (0.201%) | 1.16 px | 1.77 px | 3 |
| **turned to the right** | **`precise`** | **1.12 px (0.160%)** | 1.01 px | 1.59 px | 10 |
| turned to the left | `rotation` | 1.22 px (0.171%) | 1.09 px | 1.75 px | 3 |

* **The precise model reads only a wing that lies upright on the right.** As the wings lie it is wrong and flags every wing of the other three poses (204 of 204, 178 of 178, 199 of 199), and it reads the 164 `id` wings well (0.155% of the length, 3 of them flagged).
  After the turn to the right it is the most accurate of the lot: closer than `rotation` to the manual landmarks in 67% of the wings, by 0.33 px on average (95% interval 0.07 to 0.77 px), by 0.11 px (0.10 to 0.13) when the wings that either model flags are left out.
  Its worst wing is 16.9 px off (`rotation` has wings 130 px off). It flags 10 wings, whose mean error is 3.2 px (the 3 wings that `rotation` flags are 61 px off), and no wing is flagged by both.
* **For the rotation model, turning first is better than the way it was done** (it was asked about the wing as it lay and the landmarks were turned with the picture): 0.23 px better to the right and 0.46 px to the left
  on average (95% intervals 0.006 to 0.065 and 0.030 to 0.117 points of the length), closer in 62% and 65% of the wings (the wings that needed no turn are equal). The exception is a left wing that already lies upright (`flipH`), which
  is a little less accurate once it is mirrored to the right (0.167% to 0.215% of the length): the rotation model is most accurate on that pose.
* **Time.** One request at a time, the backend needs 0.71 s for `rotation` and 0.70 s for `precise` (median of 40 crops); turning the wing changes nothing, the size is the same.

*The truth has to be in the convention of the backend.* The browser carried the manual landmarks into the crops with the index of a pixel taken for a coordinate of the picture, where the pixel spans [x, x + 1) and its centre is x + 0.5.
That puts a half pixel into every landmark, turned with the photo: up to 1.4 px, in a direction that depends on the pose of the crop. Measured against them, the rotation model looked worse on turned wings, which was not so.
`measure_precise.py` (`index_landmarks`) moves the landmarks to the pixel indices of the backend. After it the mean signed error of a wing turned to the right is the same whichever pose the crop had:
`rotation` (-0.5, +0.5) px, `precise` (+0.15, -0.35) px, the offsets of the models themselves.
This is a test on wings of the databases put on a canvas like a photo, not on real photos (which have no manual landmarks), and it says nothing about wings that the pose reading is not sure about.

## Decision taken (what the app does)

The proposal of this report was HOG with the ink method as the second opinion. The app uses **HOG alone** (`hog-16x6-b8s`, a margin of at least 0.10 is "sure"): after the
detector the two never disagreed, so the second one adds code and no decisions. Its weak spot, a picture that is tilted by 15° or more, is not what the detector gives.

* **Every picture is read**, the crops of the detector and the pictures that were not cropped (a wing that is already cut, a photo without a detection). When the reading is
  sure, the picture is turned to the chosen side, upright, before it is sent. When it is not sure, or cannot be read, or anything fails, the picture is left as it is.
  "Keep original orientation" runs none of this.
* **The rotation model** still has its answer checked afterwards (the side and whether the wing is upside down), as a safety net: a wing that is turned after all is logged as a
  disagreement. **The precise model** (offered with the right orientation) has no correction afterwards, and every wing goes to it, whatever the reading says.
* Cost in the browser (this computer, a crop of 2203 x 947): about 21 to 27 ms for the whole reading, 59 ms for a crop of 4000 x 1700.
* The TypeScript of the app gives the same working picture, mask and descriptor as the Python reference byte for byte on all 5 221 crops saved from the app (`check_ts_parity.mjs`, in Node),
  and on every twelfth of them in the browser, where the picture comes from a canvas (`tools/regression/parity-browser.js`); `frontend/tests` has the vectors.

## Reproduce

See `README.md` in this folder. Everything runs with the Python of the backend; the data folder is set with `BEES_DATA`.
