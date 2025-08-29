"use client";
import * as React from "react";
import { Upload } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL as string;

const FileUploadComponent: React.FC = () => {
  const [status, setStatus] = React.useState<"idle" | "uploading" | "done" | "error">("idle");

  const handleFileUploadButtonClick = () => {
    const el = document.createElement("input");
    el.type = "file";
    el.accept = "application/pdf";
    el.onchange = async () => {
      const file = el.files?.[0];
      if (!file) return;

      const formData = new FormData();
      formData.append("pdf", file);

      setStatus("uploading");
      try {
        const res = await fetch(`${API_URL}/upload/pdf`, { method: "POST", body: formData });
        if (!res.ok) throw new Error("Upload failed");
        setStatus("done");
        setTimeout(() => setStatus("idle"), 1200);
      } catch {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 1500);
      }
    };
    el.click();
  };

  return (
    <div className="bg-slate-900 text-white shadow-2xl p-4 rounded-lg border-2 border-white w-full">
      <button
        onClick={handleFileUploadButtonClick}
        className="w-full flex flex-col items-center justify-center gap-2"
      >
        <h3 className="font-semibold">Upload PDF File</h3>
        <Upload />
        <span className="text-xs opacity-80">
          {status === "idle" && "Click to select a PDF"}
          {status === "uploading" && "Uploading…"}
          {status === "done" && "Uploaded ✅"}
          {status === "error" && "Upload failed ❌"}
        </span>
      </button>
    </div>
  );
};

export default FileUploadComponent;
