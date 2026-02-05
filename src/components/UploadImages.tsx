import { useCallback, useEffect, useState } from "react";
import type { ImageFile } from "../App";
import { useDropzone } from "react-dropzone";
import { formatBytes } from "../utils";
import ImagePreviewModal from "./ImagePreviewModal";

export default UploadImages;

type UploadImagesProps = {
  images: ImageFile[];
  addFiles: (files: File[]) => void;
  removeFile: (filename: string) => void;
  clearFiles: () => void;
  renameFile: (index: number, newName: string) => void;
  onProcess: () => void;
};
function UploadImages({
  images,
  addFiles,
  removeFile,
  clearFiles,
  renameFile,
  onProcess,
}: UploadImagesProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    if (previewIndex === null) return;
    if (previewIndex >= images.length) {
      setPreviewIndex(null);
    }
  }, [images.length, previewIndex]);

  return (
    <>
      <DropZoneArea addFiles={addFiles} />
      <ImageList
        images={images}
        removeFile={removeFile}
        clearFiles={clearFiles}
        onProcess={onProcess}
        onSelectImage={(_image, index) => {
          setPreviewIndex(index);
        }}
        onPreviewFirst={() => {
          if (images.length === 0) return;
          setPreviewIndex(0);
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
      />
    </>
  );
}

type DropZoneAreaProps = {
  addFiles: (accepted: File[]) => void;
};
function DropZoneArea({ addFiles }: DropZoneAreaProps) {
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
          ? "#e8f2ff"
          : isHovering
            ? "#f1f3f7"
            : "#f8f9fa",
      }}
    >
      <input {...getInputProps()} />
      <div className="fw-semibold ">
        {isDragActive
          ? "Drop files here..."
          : "Drag photos here or click to select"}
      </div>
      <div className="text-muted mt-1">Supported formats: .png, .jpg</div>
    </div>
  );
}

type ImageListProps = {
  images: ImageFile[];
  removeFile: (filename: string) => void;
  clearFiles: () => void;
  onProcess: () => void;
  onSelectImage: (image: ImageFile, index: number) => void;
  onPreviewFirst: () => void;
};
function ImageList({
  images,
  removeFile,
  clearFiles,
  onProcess,
  onSelectImage,
  onPreviewFirst,
}: ImageListProps) {
  if (images.length === 0) return null;
  return (
    <div className="d-flex flex-column mt-3">
      <div className="d-flex flex-row align-items-center justify-content-between gap-3 mb-3">
        <h3>
          Uploaded {images.length} {images.length === 1 ? "image" : "images"}:
        </h3>
        <div className="d-flex align-items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={onProcess}>
          Process
        </button>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onPreviewFirst}
          >
            Preview
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={clearFiles}
          >
            Clear
          </button>
        </div>
      </div>
      <ul
        className="list-group w-100"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "0.5rem",
        }}
      >
        {images.map((image) => (
          <ImageListItem
            image={image}
            onRemove={removeFile}
            onSelect={(selected) =>
              onSelectImage(selected, images.indexOf(selected))
            }
          />
        ))}
      </ul>
    </div>
  );
}

type ImageListItemProps = {
  image: ImageFile;
  onRemove: (filename: string) => void;
  onSelect: (image: ImageFile) => void;
};
function ImageListItem({ image, onRemove, onSelect }: ImageListItemProps) {
  return (
    <li
      key={image.filename}
      className="list-group-item d-flex align-items-center gap-3 rounded p-1"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(image)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect(image);
      }}
      style={{ cursor: "pointer" }}
    >
      <img
        src={image.previewUrl}
        alt={image.filename}
        width={56}
        height={56}
        style={{ objectFit: "cover" }}
        className="rounded border"
      />
      <div className="flex-grow-1 flex-column">
        <div className="fw-semibold">{image.filename}</div>
        <div className="text-muted">{formatBytes(image.file.size)}</div>
      </div>
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
