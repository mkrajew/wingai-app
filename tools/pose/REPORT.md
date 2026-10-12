# Reading the pose of a wing crop from its pixels: test report

**Question.** Can the pose of a straightened wing crop (is it upside down, is it a left or a right wing) be read from the pixels alone,
by simple methods without a neural network, before the picture is sent to the backend? The task assumes good crops: a complete wing,
long axis horizontal (what the YOLO crop of the app gives).

**Answer.** Yes. Histograms of gradient directions in a grid of cells ("HOG with position"), compared with the average wing in each of the
four poses, made **no mistake on 19 192 + 18 640 decisions on complete wings of 13 databases (a blind holdout and a leave-one-country-out test), on 234 real crops of the app
(182 of them the main detection of their photo), on 384 small wings from another lab, and 6 mistakes on 92 000 decisions with perturbations**.
"Where is the ink" (ink) is almost as good and much more tolerant of a strongly tilted wing. Used together (both must agree, and the HOG margin must be at least 0.10)
they made **no mistake at all in any of these sets** while accepting 99.7 to 100% of the decisions. The global gradient histogram (no position) is clearly worse.

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
| **A** | real crops: the app's own detector and `straightenedCrop` on the raw photos of the 2026 series (45 photos), skrzydła-BM (105) and Pulawy (42) | 274 crops, 182 are the main detection, sure and not flagged | the backend (model `rotation`) |
| **A2** | small, already cropped wings of the Pulawy folder (another lab and camera) | 1 012, of which 384 sure and not flagged (all upright: the backend flagged the rest) | the backend |
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

### 1. The sweep (development folds, 3 490 wings x 4 poses, cross validation by colony)

All 120 HOG variants read 99.2 to 99.5% of all wings correctly, and **100.000% (0 errors in 13 740 decisions) of the complete wings** for the 12 that were repeated on complete wings only.
Every error of the sweep was a wing cut by the border of its picture (55 of 3 490 sampled wings). The settings hardly matter (the mean over all variants moves by at most 0.04 points per setting), so the choice is made on robustness and simplicity.
With the right setting ink also makes no mistake on complete wings (kernel 11 is the key; 21 and 31 are worse). The global histogram needs 32 bins on the vein map to reach the same, and it is the least robust.

### 2. Every method against every set (errors / decisions)

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

### 3. The rule: accept only when both methods agree and the margin is large enough

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

## Decision proposed

* Method: `hog-16x6-b8s` as the decision, `ink-k11-p1-thirds` as the second opinion, TAU = 0.10. An unsure wing is left as it is and the backend decides, as today.
* The answer of the backend is still checked after the request (its side and whether the wing is upside down). If it disagrees with the pixels, the old correction runs. So a wrong pixel decision costs time and a different source of the landmarks, never a wrongly oriented wing.
* Cost in the browser (this computer, a crop of 2203 x 947): about 17 ms to shrink the crop, 6 ms ink, 1 ms HOG.

## Reproduce

See `README.md` in this folder. Everything runs with the Python of the backend; the data folder is set with `BEES_DATA`.
