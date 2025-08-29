'use client';

import { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';

interface FileItem {
  filename: string;
  uploadDate: string;
}

export const FileList = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch files when component mounts
  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    try {
      const response = await fetch('http://localhost:8000/files');
      if (!response.ok) throw new Error('Failed to fetch files');
      const data = await response.json();
      setFiles(data.files);
    } catch (err) {
      setError('Failed to load files');
      console.error(err);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `http://localhost:8000/delete/pdf/${encodeURIComponent(filename)}`,
        { method: 'DELETE' }
      );

      if (!response.ok) throw new Error('Failed to delete file');
      await fetchFiles(); // Refresh the list after deletion
    } catch (err) {
      setError('Failed to delete file');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (error) {
    return <div className="text-red-500 text-center">{error}</div>;
  }

  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold mb-4">Uploaded Files</h2>
      <div className="space-y-2">
        {files.map((file) => (
          <div
            key={file.filename}
            className="flex items-center justify-between p-3 bg-slate-800 rounded-lg"
          >
            <span className="text-sm text-gray-200">{file.filename}</span>
            <button
              onClick={() => handleDelete(file.filename)}
              disabled={isLoading}
              className="p-2 text-red-400 hover:text-red-300 disabled:opacity-50"
              title="Delete file"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {files.length === 0 && (
          <p className="text-center text-gray-400">No files uploaded yet</p>
        )}
      </div>
    </div>
  );
};