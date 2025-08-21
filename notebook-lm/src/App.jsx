import React, { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";

export default function App() {
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [input, setInput] = useState("");

  // Fetch uploaded files
  const fetchFiles = async () => {
    const res = await fetch("http://localhost:5000/files");
    const data = await res.json();
    setFiles(data);
    if (!selectedFile && data.length > 0) setSelectedFile(data[0]);
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  // Upload + Index
  const onDrop = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;
    setLoading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", acceptedFiles[0]);

      const res = await fetch("http://localhost:5000/index", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Indexing done successfully ✅" });
        fetchFiles();
      } else {
        setMessage({ type: "error", text: "Failed to index document ❌" });
      }
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  // Chat
  const sendMessage = async () => {
    if (!input.trim() || !selectedFile) return;

    const userMessage = { role: "user", content: input };
    setChatHistory((prev) => [...prev, userMessage]);

    try {
      const res = await fetch("http://localhost:5000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: selectedFile, query: input }),
      });

      const data = await res.json();
      setChatHistory((prev) => [...prev, { role: "assistant", content: data.answer }]);
    } catch (err) {
      setChatHistory((prev) => [...prev, { role: "assistant", content: "⚠️ Chat failed" }]);
    }
    setInput("");
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-gray-50 p-6">
      {/* Upload Box */}
      <div
        {...getRootProps()}
        className={`w-[400px] h-40 flex flex-col items-center justify-center rounded-xl cursor-pointer border-2 border-dashed transition mb-6
        ${isDragActive ? "bg-blue-100 border-blue-400" : "bg-gray-100 border-gray-300"}`}
      >
        <input {...getInputProps()} />
        {loading ? (
          <div className="flex flex-col items-center">
            <div className="animate-spin border-4 border-blue-500 border-t-transparent rounded-full w-8 h-8"></div>
            <p className="text-gray-700 mt-2">Indexing...</p>
          </div>
        ) : (
          <>
            <p className="text-lg font-medium text-gray-700">
              {isDragActive ? "Drop the file here..." : "Drag & drop a file, or click to select"}
            </p>
            <p className="text-sm text-gray-500 mt-2">PDF files only</p>
          </>
        )}
      </div>

      {/* File Selector */}
      {files.length > 0 && (
        <div className="mb-4">
          <label className="mr-2 font-medium">Select File:</label>
          <select
            className="border p-2 rounded"
            value={selectedFile || ""}
            onChange={(e) => setSelectedFile(e.target.value)}
          >
            {files.map((f, i) => (
              <option key={i} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Chat UI */}
      <div className="w-full max-w-2xl bg-white shadow rounded-lg flex flex-col h-[500px]">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {chatHistory.map((msg, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg max-w-[80%] ${
                msg.role === "user" ? "bg-blue-500 text-white ml-auto" : "bg-gray-200 text-gray-800"
              }`}
            >
              {msg.content}
            </div>
          ))}
        </div>
        <div className="border-t p-3 flex items-center">
          <input
            className="flex-1 border rounded-lg px-3 py-2 mr-2"
            placeholder="Ask something about the PDF..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          />
          <button
            onClick={sendMessage}
            className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
          >
            Send
          </button>
        </div>
      </div>

      {/* Toast */}
      {message && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg shadow-md text-white
          ${message.type === "success" ? "bg-green-500" : "bg-red-500"}`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
