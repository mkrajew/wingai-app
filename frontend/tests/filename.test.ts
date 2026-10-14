import assert from "node:assert/strict";
import { test } from "node:test";
import { renamedFilename } from "../src/utils/filename.ts";

// ---- the name that a photo gets when a name is typed for it, before it is made different from the names of the other photos
test("a name typed without an extension gets the extension of the photo", () => {
  assert.equal(renamedFilename("wing_01", "IMG_6466.JPG"), "wing_01.JPG");
  assert.equal(renamedFilename("IMG_6466", "IMG_6466.JPG"), "IMG_6466.JPG");
});

test("a name typed with the extension of the photo does not get it twice, and the photo keeps its own letter case of it", () => {
  assert.equal(renamedFilename("wing_01.JPG", "IMG_6466.JPG"), "wing_01.JPG");
  assert.equal(renamedFilename("wing_01.jpg", "IMG_6466.JPG"), "wing_01.JPG");
  assert.equal(renamedFilename("IMG_6466.JPG", "IMG_6466.JPG"), "IMG_6466.JPG");
});

test("another extension that is typed is replaced by the extension of the photo", () => {
  assert.equal(renamedFilename("wing_01.png", "IMG_6466.JPG"), "wing_01.JPG");
});

test("a dot before the extension of the photo does not cost the name anything", () => {
  assert.equal(renamedFilename("wing.01.JPG", "IMG_6466.JPG"), "wing.01.JPG");
});

test("a processed photo (*.dw.png) keeps the ending .dw.png, whatever ending is typed", () => {
  assert.equal(renamedFilename("wing", "IMG_6466.dw.png"), "wing.dw.png");
  assert.equal(renamedFilename("wing.dw.png", "IMG_6466.dw.png"), "wing.dw.png");
  assert.equal(renamedFilename("wing.DW.PNG", "IMG_6466.dw.png"), "wing.dw.png");
  assert.equal(renamedFilename("wing.png", "IMG_6466.dw.png"), "wing.dw.png");
  assert.equal(renamedFilename("wing.JPG", "IMG_6466.dw.png"), "wing.dw.png");
});

test("a photo that has no extension gets the name as it is typed", () => {
  assert.equal(renamedFilename("wing", "IMG_6466"), "wing");
  assert.equal(renamedFilename("wing.png", "IMG_6466"), "wing.png");
});

test("spaces around the typed name are not part of the name", () => {
  assert.equal(renamedFilename("  wing_01  ", "IMG_6466.JPG"), "wing_01.JPG");
});

test("nothing typed, or only spaces, gives no name", () => {
  assert.equal(renamedFilename("", "IMG_6466.JPG"), null);
  assert.equal(renamedFilename("   ", "IMG_6466.JPG"), null);
});

// ---- text typed after the whole name (after its extension): it is part of the name, and the extension goes to the end
test("text that is typed after the whole name stays in the name, and the extension is put at the end", () => {
  assert.equal(renamedFilename("IMG_6466.JPGabc", "IMG_6466.JPG"), "IMG_6466.JPGabc.JPG");
  assert.equal(renamedFilename("IMG_6466.JPG_new", "IMG_6466.JPG"), "IMG_6466.JPG_new.JPG");
  assert.equal(renamedFilename("IMG_6466.JPG new", "IMG_6466.JPG"), "IMG_6466.JPG new.JPG");
  assert.equal(renamedFilename("IMG_6466.JPG.v2", "IMG_6466.JPG"), "IMG_6466.JPG.v2.JPG");
});

test("text typed after the extension is found whatever the letter case of the extension typed", () => {
  assert.equal(renamedFilename("IMG_6466.jpgabc", "IMG_6466.JPG"), "IMG_6466.jpgabc.JPG");
});

test("text typed after the ending of a processed photo also stays, and .dw.png goes to the end", () => {
  assert.equal(renamedFilename("IMG_6466.dw.pngabc", "IMG_6466.dw.png"), "IMG_6466.dw.pngabc.dw.png");
});

test("only the extension at the very end of the typed name is taken off", () => {
  assert.equal(renamedFilename("a.JPG.JPG", "IMG_6466.JPG"), "a.JPG.JPG");
});
