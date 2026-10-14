import { useCallback, useState } from "react";
import type { ImageFile } from "../App";
import { useDropzone } from "react-dropzone";
import { formatBytes } from "../utils";
import { photosLoading } from "../utils/imageState";
import ImagePreviewModal from "./ImagePreviewModal";
import ConfirmDialog from "./ConfirmDialog";
import { useT } from "../i18n";

export default UploadImages;

type UploadImagesProps = {
  images: ImageFile[];
  addFiles: (files: File[]) => void;
  removeFile: (filename: string) => void;
  clearFiles: () => void;
  renameFile: (index: number, newName: string) => void;
  onProcess: () => void;
  onDetect: () => void;
  isDetecting: boolean;
  detectionError: string | null;
  onToggleDetections: (index: number) => void;
  onDetectSingle: (index: number) => void;
  onFlipImage: (imageIndex: number, direction: "horizontal" | "vertical") => void;
  onRotateImage: (imageIndex: number, direction: "cw" | "ccw") => void;
  onToggleSkipProcessing: (filename: string) => void;
  onSelectDetection: (imageIndex: number, detIndex: number) => void;
  onToggleDetectionExclusion: (imageIndex: number, detIndex: number) => void;
  onExtractDetections: (imageIndex: number) => void;
  transformingFiles: Set<string>;
};
function UploadImages({
  images,
  addFiles,
  removeFile,
  clearFiles,
  renameFile,
  onProcess,
  onDetect,
  isDetecting,
  detectionError,
  onToggleDetections,
  onDetectSingle,
  onFlipImage,
  onRotateImage,
  onToggleSkipProcessing,
  onSelectDetection,
  onToggleDetectionExclusion,
  onExtractDetections,
  transformingFiles,
}: UploadImagesProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [filterText, setFilterText] = useState("");

  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredEntries = images
    .map((image, index) => ({ image, index }))
    .filter(({ image }) =>
      normalizedFilter.length === 0
        ? true
        : image.filename.toLowerCase().includes(normalizedFilter),
    );

  // The photo that is shown in the preview window is gone: close the window. Done while rendering, so the window
  // is never drawn with an index that is past the end of the list.
  if (previewIndex !== null && previewIndex >= images.length) {
    setPreviewIndex(null);
  }

  return (
    <>
      <DropZoneArea addFiles={addFiles} />
      <ImageList
        entries={filteredEntries}
        totalCount={images.length}
        filterText={filterText}
        onFilterChange={setFilterText}
        removeFile={removeFile}
        clearFiles={clearFiles}
        onProcess={onProcess}
        onDetect={onDetect}
        isDetecting={isDetecting}
        isLoadingPhotos={photosLoading(images)}
        detectionError={detectionError}
        onToggleSkipProcessing={onToggleSkipProcessing}
        onSelectImage={(_image, originalIndex) => {
          setPreviewIndex(originalIndex);
        }}
        onPreviewFirst={() => {
          if (filteredEntries.length === 0) return;
          setPreviewIndex(filteredEntries[0].index);
        }}
      />
      <ImagePreviewModal
        images={images}
        previewIndex={previewIndex}
        onPreviewIndexChange={(index) => {
          setPreviewIndex(index);
        }}
        onClose={() => {
          setPreviewIndex(null);
        }}
        onRemove={removeFile}
        onRename={renameFile}
        onToggleDetections={onToggleDetections}
        onDetectSingle={onDetectSingle}
        onSelectDetection={onSelectDetection}
        onToggleDetectionExclusion={onToggleDetectionExclusion}
        onExtractDetections={onExtractDetections}
        onFlipImage={onFlipImage}
        onRotateImage={onRotateImage}
        onToggleSkipProcessing={onToggleSkipProcessing}
        isDetecting={isDetecting}
        transformingFiles={transformingFiles}
      />
    </>
  );
}

type DropZoneAreaProps = {
  addFiles: (accepted: File[]) => void;
};
function DropZoneArea({ addFiles }: DropZoneAreaProps) {
  const t = useT();
  const [isHovering, setIsHovering] = useState(false);
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      addFiles(acceptedFiles);
    },
    [addFiles],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
    },
  });
  return (
    <div
      {...getRootProps()}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className="border rounded p-4 text-center d-flex flex-column justify-content-center align-items-center"
      style={{
        cursor: "pointer",
        height: "250px",
        borderStyle: "dashed",
        borderWidth: "2px",
        backgroundColor: isDragActive
          ? "var(--bs-primary-bg-subtle)"
          : isHovering
            ? "var(--bs-secondary-bg)"
            : "var(--bs-tertiary-bg)",
      }}
    >
      <input {...getInputProps()} />
      <div className="fw-semibold ">
        {isDragActive ? t.dropFilesHere : t.dragPhotosHere}
      </div>
      <div className="text-muted mt-1">{t.supportedFormats}</div>
    </div>
  );
}

type ImageListProps = {
  entries: { image: ImageFile; index: number }[];
  totalCount: number;
  filterText: string;
  onFilterChange: (value: string) => void;
  removeFile: (filename: string) => void;
  clearFiles: () => void;
  onProcess: () => void;
  onDetect: () => void;
  isDetecting: boolean;
  // Some photo has not got its thumbnail or its size yet.
  isLoadingPhotos: boolean;
  detectionError: string | null;
  onToggleSkipProcessing: (filename: string) => void;
  onSelectImage: (image: ImageFile, index: number) => void;
  onPreviewFirst: () => void;
};
function ImageList({
  entries,
  totalCount,
  filterText,
  onFilterChange,
  removeFile,
  clearFiles,
  onProcess,
  onDetect,
  isDetecting,
  isLoadingPhotos,
  detectionError,
  onToggleSkipProcessing,
  onSelectImage,
  onPreviewFirst,
}: ImageListProps) {
  const t = useT();
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  if (totalCount === 0) return null;
  // Process waits until Detect has finished and the photos have their thumbnails and sizes: it keeps the list that
  // "Edit" brings back, and a photo that was still loading would stay without them.
  const processWaitsFor = isDetecting
    ? t.processWaitsForDetect
    : isLoadingPhotos
      ? t.processWaitsForPhotos
      : null;
  return (
    <div className="d-flex flex-column mt-3">
      <div className="d-flex flex-column flex-lg-row align-items-lg-center gap-3 mb-3">
        <h3 className="mb-0">
          {t.uploadedImages(totalCount)}
        </h3>
        <div className="flex-grow-1">
          <div className="d-flex align-items-center gap-2">
            <input
              id="upload-filter"
              type="text"
              className="form-control"
              placeholder={t.typeToFilter}
              value={filterText}
              onChange={(event) => onFilterChange(event.target.value)}
            />
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button
            type="button"
            className="btn btn-primary d-flex align-items-center gap-2"
            onClick={onProcess}
            disabled={processWaitsFor !== null}
            title={processWaitsFor ?? undefined}
          >
            {!isDetecting && isLoadingPhotos && (
              <span
                className="spinner-border spinner-border-sm"
                role="status"
                aria-hidden="true"
              />
            )}
            {t.process}
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onPreviewFirst}
          >
            {t.preview}
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => setIsClearConfirmOpen(true)}
          >
            {t.clear}
          </button>
          <button
            type="button"
            className="btn btn-outline-primary d-flex align-items-center gap-2"
            onClick={onDetect}
            disabled={isDetecting}
          >
            {isDetecting && (
              <span
                className="spinner-border spinner-border-sm"
                role="status"
                aria-hidden="true"
              />
            )}
            {t.detect}
          </button>
        </div>
      </div>
      {detectionError && (
        <div className="alert alert-danger py-2 px-3 mb-2 small" role="alert">
          {t.detectionFailed(detectionError ?? "")}
        </div>
      )}
      <ul
        className="list-group w-100"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "0.5rem",
        }}
      >
        {entries.length === 0 ? (
          <li className="list-group-item text-center text-muted">
            {t.noFilesMatch}
          </li>
        ) : (
          entries.map(({ image, index }) => (
            <ImageListItem
              key={`${image.filename}-${index}`}
              image={image}
              onRemove={removeFile}
              onToggleSkipProcessing={() => onToggleSkipProcessing(image.filename)}
              onSelect={() => onSelectImage(image, index)}
            />
          ))
        )}
      </ul>
      {isClearConfirmOpen && (
        <ConfirmDialog
          title={t.clearTitle}
          message={t.clearMessage}
          confirmLabel={t.clear}
          cancelLabel={t.cancel}
          closeLabel={t.close}
          onConfirm={() => {
            setIsClearConfirmOpen(false);
            clearFiles();
          }}
          onCancel={() => setIsClearConfirmOpen(false)}
        />
      )}
    </div>
  );
}

type ImageListItemProps = {
  image: ImageFile;
  onRemove: (filename: string) => void;
  onToggleSkipProcessing: () => void;
  onSelect: () => void;
};
function ImageListItem({ image, onRemove, onToggleSkipProcessing, onSelect }: ImageListItemProps) {
  const t = useT();
  const width = image.width;
  const height = image.height;
  let dimensionLabel = t.dimensionsLoading;

  if (
    typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0
  ) {
    dimensionLabel = `${Math.round(width)}x${Math.round(height)}px`;
  }

  return (
    <li
      className="list-group-item d-flex align-items-center gap-3 rounded p-1"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      style={{ cursor: "pointer" }}
    >
      <div className="position-relative" style={{ flexShrink: 0 }}>
        {image.thumbUrl ? (
          <img
            src={image.thumbUrl}
            alt={image.filename}
            width={56}
            height={56}
            style={{ objectFit: "cover", display: "block" }}
            className="rounded border"
          />
        ) : (
          <div
            className="rounded border"
            style={{ width: 56, height: 56, background: "var(--bs-secondary-bg)" }}
            aria-hidden="true"
          />
        )}
        {image.detections !== undefined && (
          <span
            className={`badge position-absolute bottom-0 end-0 ${
              image.detections.length > 0 && (image.showDetections ?? true)
                ? "bg-success"
                : "bg-secondary"
            }`}
            style={{ fontSize: "0.6rem" }}
          >
            {image.detections.length}
          </span>
        )}
      </div>
      <div className="flex-grow-1 flex-column">
        <div className="fw-semibold">{image.filename}</div>
        <div className="text-muted">
          {formatBytes(image.file.size)} • {dimensionLabel}
        </div>
      </div>
      <button
        type="button"
        className={`btn btn-sm py-0 px-1 ${image.skipProcessing ? "btn-outline-secondary" : "btn-outline-success"}`}
        style={{ fontSize: "0.65rem", whiteSpace: "nowrap" }}
        title={image.skipProcessing ? "Excluded from processing — click to include" : "Included in processing — click to exclude"}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSkipProcessing();
        }}
      >
        {image.skipProcessing ? t.skipProcessing : t.processImage}
      </button>
      <button
        type="button"
        className="btn btn-close"
        onClick={(event) => {
          event.stopPropagation();
          onRemove(image.filename);
        }}
      />
    </li>
  );
}
