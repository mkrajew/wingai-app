import { useEffect, useState } from "react";
import UploadImages from "./components/UploadImages";

export default App;

export type ImageFile = {
  filename: string;
  file: File;
  previewUrl: string;
  status: "new" | "uploading" | "edit" | "done" | "error";
  vector?: number[];
  check?: boolean;
  error?: string;
};

function App() {
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [step, setStep] = useState<"upload" | "review">("upload");

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
          />
        )}
      </div>
    </>
  );
}
