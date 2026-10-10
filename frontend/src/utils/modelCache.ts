/**
 * Shared constants for the cached ONNX detection model.
 *
 * Kept in one place so the detector (utils/yoloDetector) and the loader UI
 * (DetectionModelPanel) can't drift: if these two values disagree, a model
 * the user loaded would silently not be found at detection time.
 */
export const MODEL_URL = "/models/detector.onnx";
export const CACHE_NAME = "wingai-models-v1";
