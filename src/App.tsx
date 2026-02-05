import { useEffect, useState } from "react";
import UploadImages from "./components/UploadImages";
import ReviewImages from "./components/ReviewImages";

export default App;

export type ImageFile = {
  filename: string;
  file: File;
  previewUrl: string;
  status: "new" | "uploading" | "edit" | "done" | "error";
  vector?: number[];
  check?: boolean;
  width?: number;
  height?: number;
  error?: string;
};

function App() {
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [reviewIndex, setReviewIndex] = useState(0);

  const addFiles = (files: File[]) => {
    setImageFiles((prevFiles) => {
      const existingKeys = new Set(
        prevFiles.map(
          (f) => `${f.file.name}|${f.file.size}|${f.file.lastModified}`,
        ),
      );

      const newFiles: ImageFile[] = [];
      for (const file of files) {
        const key = `${file.name}|${file.size}|${file.lastModified}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        newFiles.push({
          filename: file.name,
          file: file,
          previewUrl: URL.createObjectURL(file),
          status: "new",
        });
      }

      return [...prevFiles, ...newFiles];
    });
  };

  function removeFile(name: string) {
    setImageFiles((prevFiles) => {
      const toRemove = prevFiles.find((f) => f.filename === name);
      if (toRemove) URL.revokeObjectURL(toRemove.previewUrl);

      return prevFiles.filter((f) => f.filename !== name);
    });
  }

  function renameFile(index: number, newName: string) {
    setImageFiles((prevFiles) =>
      prevFiles.map((file, i) => {
        if (i !== index) return file;

        const originalName = file.filename;
        const lastDot = originalName.lastIndexOf(".");
        const originalExt = lastDot > 0 ? originalName.slice(lastDot) : "";

        const trimmed = newName.trim();
        const base =
          originalExt.length > 0 ? trimmed.replace(/\.[^.]+$/, "") : trimmed;

        const finalName =
          originalExt.length > 0 ? `${base}${originalExt}` : base;

        return { ...file, filename: finalName };
      }),
    );
  }

  function clearFiles() {
    imageFiles.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    setImageFiles([]);
  }

  function updatePoint(
    imageIndex: number,
    pointIndex: number,
    x: number,
    y: number,
  ) {
    setImageFiles((prevFiles) =>
      prevFiles.map((file, idx) => {
        if (idx !== imageIndex || !file.vector || !file.width || !file.height) {
          return file;
        }

        const nextVector = [...file.vector];
        const base = pointIndex * 2;
        if (base < 0 || base + 1 >= nextVector.length) return file;

        const clampedX = Math.min(file.width, Math.max(0, x));
        const clampedY = Math.min(file.height, Math.max(0, y));

        nextVector[base] = clampedX;
        nextVector[base + 1] = clampedY;

        return { ...file, vector: nextVector };
      }),
    );
  }

  function loadImageDimensions(src: string) {
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = src;
    });
  }

  async function processImages() {
    setStep("review");
    setReviewIndex(0);

    const updated = await Promise.all(
      imageFiles.map(async (image) => {
        const { width, height } = await loadImageDimensions(image.previewUrl);
        const vector = Array.from({ length: 38 }, (_, index) => {
          const isX = index % 2 === 0;
          return isX
            ? Math.floor(Math.random() * width)
            : Math.floor(Math.random() * height);
        });
        return {
          ...image,
          vector,
          check: Math.random() < 0.5,
          width,
          height,
        };
      }),
    );

    setImageFiles(updated);
  }

  useEffect(() => {
    return () => {
      imageFiles.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    };
    // TODO: dowiedziec sie o co tu chodzi
  }, []);

  return (
    <>
      <div className="container py-4">
        <h2 className="mb-3">WingAI</h2>
        {step === "upload" && (
          <UploadImages
            images={imageFiles}
            addFiles={addFiles}
            removeFile={removeFile}
            clearFiles={clearFiles}
            renameFile={renameFile}
            onProcess={processImages}
          />
        )}
        {step === "review" && (
          <ReviewImages
            images={imageFiles}
            index={reviewIndex}
            onIndexChange={setReviewIndex}
            onUpdatePoint={updatePoint}
            onRename={renameFile}
          />
        )}
      </div>
    </>
  );
}
