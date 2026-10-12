"""The candidate methods that evaluate.py and stress.py compare.

kind "template": a descriptor (hog / ghist spec) compared with the average wing in each of the four poses (templates made from set B).
kind "ink"     : the statistics of the vein mass; `x` and `y` name the statistic whose sign gives the base (right) and the thick vein (top).
"""
import json

from config import EVAL


def hog(cells, bins, signed, inp, norm, sigma):
    return {"kind": "hog", "cells": list(cells), "bins": bins, "signed": signed, "input": inp, "norm": norm, "sigma": sigma}


def ghist(bins, signed, inp):
    return {"kind": "ghist", "bins": bins, "signed": signed, "input": inp, "norm": "sqrt"}


DEFAULT_METHODS = [
    {"name": "hog-16x6-b8s", "kind": "template", "spec": hog((16, 6), 8, True, "gray", "sqrt", 0.0)},
    {"name": "hog-8x3-b4s", "kind": "template", "spec": hog((8, 3), 4, True, "gray", "sqrt", 0.0)},
    {"name": "hog-8x3-b16u-s1", "kind": "template", "spec": hog((8, 3), 16, False, "gray", "sqrt", 1.0)},
    {"name": "hog-16x6-b16u-s1", "kind": "template", "spec": hog((16, 6), 16, False, "gray", "sqrt", 1.0)},
    {"name": "hog-16x6-b8s-vein", "kind": "template", "spec": hog((16, 6), 8, True, "vein", "none", 0.0)},
    {"name": "ghist-16s-gray", "kind": "template", "spec": ghist(16, True, "gray")},
    {"name": "ghist-32s-gray", "kind": "template", "spec": ghist(32, True, "gray")},
    {"name": "ghist-32s-vein", "kind": "template", "spec": ghist(32, True, "vein")},
    {"name": "hog-16x6-b8s-aug6", "kind": "template", "spec": hog((16, 6), 8, True, "gray", "sqrt", 0.0), "aug": {"tilt": 6, "copies": 3}},
    {"name": "hog-16x6-b8s-aug12", "kind": "template", "spec": hog((16, 6), 8, True, "gray", "sqrt", 0.0), "aug": {"tilt": 12, "copies": 4}},
    {"name": "hog-16x6-b16u-s1-aug12", "kind": "template", "spec": hog((16, 6), 16, False, "gray", "sqrt", 1.0), "aug": {"tilt": 12, "copies": 4}},
    {"name": "ink-k11-p2-halves", "kind": "ink", "spec": {"k": 11, "off": 4, "power": 2.0}, "x": "x_halves", "y": "y_halves"},
    {"name": "ink-k11-p2-centroid", "kind": "ink", "spec": {"k": 11, "off": 8, "power": 2.0}, "x": "x_halves", "y": "y_centroid"},
    {"name": "ink-k11-p1-thirds", "kind": "ink", "spec": {"k": 11, "off": 20, "power": 1.0}, "x": "x_thirds", "y": "y_halves"},
    {"name": "ink-k21-thirds", "kind": "ink", "spec": {"k": 21, "off": 8, "power": 1.0}, "x": "x_thirds", "y": "y_centroid"},
]


def load():
    path = EVAL / "methods.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return DEFAULT_METHODS
