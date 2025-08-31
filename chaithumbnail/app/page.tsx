"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";

const API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent";
const MAX_FILE_SIZE_MB = 10;

// -------------------------
// Constants (stable refs)
// -------------------------
const FACTS = [
  "A staggering 90% of the best-performing videos on YouTube have custom thumbnails.",
  "Thumbnails act as a mini movie poster, summarizing your video's content and style in one glance.",
  "YouTube's algorithm uses a thumbnail's click-through rate to determine how often to show a video.",
  "Your thumbnail and title are the two most important factors in getting people to click on your video.",
  "Using human faces in thumbnails can increase engagement and a sense of connection.",
];

const inspirationThumbnails: { title: string; url: string }[] = [
  {
    title: "Generic",
    url: "https://marketplace.canva.com/EAEqfS4X0Xw/1/0/1600w/canva-most-attractive-youtube-thumbnail-wK95f3XNRaM.jpg",
  },
  {
    title: "Hitesh Chaudhary",
    url: "https://hiteshchoudhary.com/images/web-udemy.jpg",
  },
  {
    title: "Dhruv Rathee",
    url: "https://pbs.twimg.com/media/GcXNF_pWgAAgeTO?format=jpg&name=large",
  },
  {
    title: "Mr Beast",
    url: "https://cdn.dribbble.com/userupload/5606077/file/original-cdde5f5117af8be3d9e8f883a37f3315.png?resize=752x&vertical=center",
  },
  {
    title: "Vox",
    url: "https://img.youtube.com/vi/h42QVfrUVFw/maxresdefault.jpg",
  },
];

// -------------------------
// Types for request/response
// -------------------------
type InlineData = { mimeType: string; data: string };
type TextPart = { text: string };
type InlineDataPart = { inlineData: InlineData };
type Part = TextPart | InlineDataPart;

type ContentResp = { parts: Array<TextPart | InlineDataPart> };
type CandidateResp = { content: ContentResp };
type GenerateResp = { candidates?: CandidateResp[] };

function isInlineDataPart(p: TextPart | InlineDataPart): p is InlineDataPart {
  return "inlineData" in p;
}

// -------------------------
// Loading State Component
// -------------------------
const LoadingState: React.FC = () => {
  const [fact, setFact] = useState("");

  useEffect(() => {
    const pick = () => FACTS[Math.floor(Math.random() * FACTS.length)];
    setFact(pick());
    const interval = setInterval(() => setFact(pick()), 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center animate-fadeIn">
      <style>
        {`
          .loader-animation {
            display: inline-block;
            position: relative;
            width: 80px;
            height: 80px;
          }
          .loader-animation div {
            animation: lds-roller 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
            transform-origin: 40px 40px;
          }
          .loader-animation div:after {
            content: " ";
            display: block;
            position: absolute;
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #60a5fa;
            margin: -4px 0 0 -4px;
          }
          .loader-animation div:nth-child(1) { animation-delay: -0.036s; }
          .loader-animation div:nth-child(1):after { top: 63px; left: 63px; }
          .loader-animation div:nth-child(2) { animation-delay: -0.072s; }
          .loader-animation div:nth-child(2):after { top: 68px; left: 56px; }
          .loader-animation div:nth-child(3) { animation-delay: -0.108s; }
          .loader-animation div:nth-child(3):after { top: 71px; left: 48px; }
          .loader-animation div:nth-child(4) { animation-delay: -0.144s; }
          .loader-animation div:nth-child(4):after { top: 72px; left: 40px; }
          .loader-animation div:nth-child(5) { animation-delay: -0.18s; }
          .loader-animation div:nth-child(5):after { top: 71px; left: 32px; }
          .loader-animation div:nth-child(6) { animation-delay: -0.216s; }
          .loader-animation div:nth-child(6):after { top: 68px; left: 24px; }
          .loader-animation div:nth-child(7) { animation-delay: -0.252s; }
          .loader-animation div:nth-child(7):after { top: 63px; left: 17px; }
          .loader-animation div:nth-child(8) { animation-delay: -0.288s; }
          .loader-animation div:nth-child(8):after { top: 56px; left: 12px; }
          @keyframes lds-roller {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
      <div className="loader-animation">
        <div></div><div></div><div></div><div></div>
        <div></div><div></div><div></div><div></div>
      </div>
      <p className="mt-6 text-xl text-gray-300 font-semibold animate-pulse">{fact}</p>
      <p className="mt-2 text-md text-gray-400">
        Your thumbnail is being generated. Please wait...
      </p>
    </div>
  );
};

// -------------------------
// Main App
// -------------------------
const App: React.FC = () => {
  const [image, setImage] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [inspirationImage, setInspirationImage] = useState<string | null>(null);
  const [description, setDescription] = useState<string>("");
  const [thumbnailText, setThumbnailText] = useState<string>("");
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pillCategories, setPillCategories] = useState<string[]>([]);
  const [pillMoods, setPillMoods] = useState<string[]>([]);
  const [customCategory, setCustomCategory] = useState<string>("");
  const [customMood, setCustomMood] = useState<string>("");
  const [isDraggingBase, setIsDraggingBase] = useState<boolean>(false);
  const [isDraggingInspiration, setIsDraggingInspiration] = useState<boolean>(false);
  const [isDraggingLogo, setIsDraggingLogo] = useState<boolean>(false);

  const pillCategoryOptions = [
    "Cooking",
    "Gaming",
    "Tech",
    "DIY",
    "Travel",
    "Vlog",
    "Tutorial",
    "Review",
  ];
  const pillMoodOptions = [
    "Excited",
    "Serious",
    "Thumbs Up",
    "Confused",
    "Happy",
    "Surprised",
    "Shouting",
    "Thinking",
    "Winking",
  ];

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const inspirationInputRef = useRef<HTMLInputElement | null>(null);

  const handlePillClick = (pill: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter((prev) => (prev.includes(pill) ? prev.filter((p) => p !== pill) : [...prev, pill]));
  };

  const handleImageUpload = (file: File | undefined | null, setter: (val: string | null) => void) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`File size exceeds the limit of ${MAX_FILE_SIZE_MB}MB. Please choose a smaller image.`);
      setter(null);
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onloadend = () => setter((reader.result as string) ?? null);
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent, setter: (val: boolean) => void) => {
    e.preventDefault();
    setter(true);
  };

  const handleDragLeave = (e: React.DragEvent, setter: (val: boolean) => void) => {
    e.preventDefault();
    setter(false);
  };

  const handleDrop = (e: React.DragEvent, setter: (val: string | null) => void) => {
    e.preventDefault();
    setter(null);
    const files = (e.dataTransfer && e.dataTransfer.files) || null;
    if (files && files[0]) {
      handleImageUpload(files[0], setter);
    }
  };

  const handleAddCustomPill = (
    e: React.FormEvent,
    customValue: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    customSetter: (val: string) => void,
    currentPills: string[]
  ) => {
    e.preventDefault();
    const v = customValue.trim();
    if (v !== "" && !currentPills.includes(v)) {
      setter((prev) => [...prev, v]);
      customSetter("");
    }
  };

  const handleInspirationSelection = async (inspiration: { title: string; url: string }) => {
    try {
      // Show immediately
      setInspirationImage(inspiration.url);
      // Also cache as data URL for request payload
      const response = await fetch(inspiration.url);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        setInspirationImage(reader.result as string);
      };
      reader.readAsDataURL(blob);
    } catch {
      setError("Failed to load inspiration image.");
    }
  };

  const generateThumbnail = async () => {
    setLoading(true);
    setGeneratedImage(null);
    setError(null);

    if (!image) {
      setError("Please upload a base photo.");
      setLoading(false);
      return;
    }

    if (!API_KEY) {
      setError("API Key is missing. Please set NEXT_PUBLIC_GEMINI_API_KEY in your .env.local.");
      setLoading(false);
      return;
    }

    if (!inspirationImage) {
      setError("Please select an inspiration thumbnail.");
      setLoading(false);
      return;
    }

    try {
      const parts: Part[] = [];

      // Base image
      const base64Image = image.split(",")[1];
      const mimeType = image.split(":")[1].split(";")[0];
      parts.push({ inlineData: { mimeType, data: base64Image } });

      let prompt =
        "Create a high-quality YouTube thumbnail in a 16:9 aspect ratio. Use the uploaded image as the base.";

      const categoriesString = pillCategories.join(", ");
      const moodsString = pillMoods.join(", ");

      if (categoriesString) {
        prompt += ` The main theme is: ${categoriesString}.`;
      }
      if (moodsString) {
        prompt += ` The subject's expression should convey the following moods: ${moodsString}.`;
      }
      if (description.trim()) {
        prompt += ` Additional details: ${description.trim()}.`;
      }
      if (thumbnailText.trim()) {
        prompt += ` The thumbnail MUST have the following text overlaid on it: "${thumbnailText}".`;
      }

      // Logo (optional)
      if (logo) {
        const logoBase64 = logo.split(",")[1];
        const logoMimeType = logo.split(":")[1].split(";")[0];
        parts.push({ inlineData: { mimeType: logoMimeType, data: logoBase64 } });
        prompt +=
          " The third image is a brand logo. It must be placed in either the top-left or top-right corner of the thumbnail.";
      }

      // Inspiration (style) image
      if (inspirationImage) {
        const base64Inspiration = inspirationImage.startsWith("data:")
          ? inspirationImage.split(",")[1]
          : null;
        const inspirationMimeType = inspirationImage.startsWith("data:")
          ? inspirationImage.split(":")[1].split(";")[0]
          : "image/jpeg"; // fallback type for remote URL if still not converted
        if (base64Inspiration) {
          parts.push({ inlineData: { mimeType: inspirationMimeType, data: base64Inspiration } });
        }
        prompt += " Use the second image for style and composition inspiration.";
      }

      prompt +=
        " Make the image eye-catching, with bold, clear text and vibrant colors. The final image should be a single, polished thumbnail.";

      parts.unshift({ text: prompt });

      const payload = {
        contents: [{ parts }],
        generationConfig: { responseModalities: ["IMAGE"] },
      };

      let response: Response | undefined;
      const MAX_RETRIES = 3;
      for (let i = 0; i < MAX_RETRIES; i++) {
        try {
          response = await fetch(`${API_URL}?key=${API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (response.ok) break;
          const errorData = await response.json().catch(() => ({}));
          console.error("API Error Response:", errorData);
          throw new Error(`API call failed with status ${response.status}`);
        } catch {
          if (i < MAX_RETRIES - 1) {
            await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, i)));
          } else {
            throw new Error("Max retries reached.");
          }
        }
      }

      if (!response) {
        throw new Error("No response from API.");
      }

      const result: GenerateResp = await response.json();
      console.log("Gemini API Full Response:", result);

      const imagePart = result?.candidates?.[0]?.content?.parts?.find(isInlineDataPart);
      const base64Data = imagePart?.inlineData?.data;

      if (base64Data) {
        setGeneratedImage(`data:image/png;base64,${base64Data}`);
      } else {
        setError("Failed to generate image. Please try again with a different prompt.");
      }
    } catch (err) {
      console.error("Generation error:", err);
      setError("An error occurred. Please check the console for details.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!generatedImage) return;
    const link = document.createElement("a");
    link.href = generatedImage;
    link.download = "youtube_thumbnail.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const allCategories = [...new Set([...pillCategoryOptions, ...pillCategories])];
  const allMoods = [...new Set([...pillMoodOptions, ...pillMoods])];

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8 font-sans antialiased flex flex-col items-center">
      <div className="w-full max-w-4xl bg-gray-900 rounded-3xl shadow-xl p-8">
        <h1 className="text-4xl font-extrabold text-center mb-4 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-600">
          Chai Thumbnail Generator
        </h1>
        <p className="text-center text-gray-400 mb-8">
          You create the videos. We&apos;ll manage the thumbnails.
        </p>

        <div className="grid md:grid-cols-2 gap-8 mb-8">
          {/* Main Image Upload */}
          <div className="flex flex-col items-center p-6 bg-gray-800 rounded-2xl border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-blue-300">
              Your Base Photo<span className="text-red-500">*</span>
            </h2>
            <div
              id="base-photo-dropzone"
              className={`w-full h-48 bg-gray-700 rounded-xl flex items-center justify-center cursor-pointer border-2 border-dashed transition-colors ${
                isDraggingBase ? "border-blue-500" : "border-gray-600"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => handleDragOver(e, setIsDraggingBase)}
              onDragLeave={(e) => handleDragLeave(e, setIsDraggingBase)}
              onDrop={(e) => {
                setIsDraggingBase(false);
                handleDrop(e, setImage);
              }}
            >
              {image ? (
                <div className="relative w-full h-48">
                  <Image
                    src={image}
                    alt="Base"
                    fill
                    unoptimized
                    className="rounded-lg object-contain"
                  />
                </div>
              ) : (
                <span className="text-gray-400 text-center">Click or drag to upload</span>
              )}
            </div>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              onChange={(e) => handleImageUpload(e.target.files?.[0], setImage)}
              accept="image/*"
            />
          </div>

          {/* Inspiration Image Upload */}
          <div className="flex flex-col items-center p-6 bg-gray-800 rounded-2xl border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-purple-300">
              Your Inspiration<span className="text-red-500">*</span>
            </h2>
            <div
              id="inspiration-photo-dropzone"
              className={`w-full h-48 bg-gray-700 rounded-xl flex items-center justify-center cursor-pointer border-2 border-dashed transition-colors ${
                isDraggingInspiration ? "border-purple-500" : "border-gray-600"
              }`}
              onClick={() => inspirationInputRef.current?.click()}
              onDragOver={(e) => handleDragOver(e, setIsDraggingInspiration)}
              onDragLeave={(e) => handleDragLeave(e, setIsDraggingInspiration)}
              onDrop={(e) => {
                setIsDraggingInspiration(false);
                handleDrop(e, setInspirationImage);
              }}
            >
              {inspirationImage ? (
                <div className="relative w-full h-48">
                  <Image
                    src={inspirationImage}
                    alt="Inspiration"
                    fill
                    unoptimized
                    className="rounded-lg object-contain"
                  />
                </div>
              ) : (
                <span className="text-gray-400 text-center">Upload your own or select below</span>
              )}
            </div>
            <input
              type="file"
              ref={inspirationInputRef}
              className="hidden"
              onChange={(e) => handleImageUpload(e.target.files?.[0], setInspirationImage)}
              accept="image/*"
            />
          </div>
        </div>

        {/* Pre-provided Inspiration Thumbnails */}
        <div className="mb-8 p-6 bg-gray-800 rounded-2xl border border-gray-700">
          <h3 className="text-xl font-semibold mb-4 text-gray-300">
            Choose an Inspiration Thumbnail
          </h3>
          <p className="text-gray-400 mb-4">
            Selecting one of these ensures a proper 16:9 aspect ratio.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            {/* eslint-disable @next/next/no-img-element */}
            {inspirationThumbnails.map((thumb) => (
              <div
                key={thumb.title}
                className={`cursor-pointer rounded-xl overflow-hidden shadow-lg transition-transform transform hover:scale-105 ${
                  inspirationImage === thumb.url ? "ring-4 ring-blue-500" : ""
                }`}
                onClick={() => handleInspirationSelection(thumb)}
              >
                <div className="w-48" style={{ height: 108 }}>
                  <img
                    src={thumb.url}
                    alt={thumb.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="text-center p-2 bg-gray-700">
                  <span className="text-sm font-medium">{thumb.title}</span>
                </div>
              </div>
            ))}
            {/* eslint-enable @next/next/no-img-element */}
          </div>
        </div>

        {/* Optional Text and Pill Options */}
        <div className="mb-8 p-6 bg-gray-800 rounded-2xl border border-gray-700">
          <h3 className="text-xl font-semibold mb-4 text-gray-300">
            Customize your thumbnail (Optional)
          </h3>
          <label
            htmlFor="thumbnailText"
            className="block text-lg font-semibold mb-2 text-gray-300"
          >
            Add text to your thumbnail
          </label>
          <input
            id="thumbnailText"
            type="text"
            className="w-full p-4 rounded-xl bg-gray-700 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., '10X FASTER'"
            value={thumbnailText}
            onChange={(e) => setThumbnailText(e.target.value)}
          />

          <label
            htmlFor="description"
            className="block text-lg font-semibold mt-6 mb-2 text-gray-300"
          >
            Add a text description
          </label>
          <textarea
            id="description"
            className="w-full h-24 p-4 rounded-xl bg-gray-700 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., A dramatic photo of me with a confused expression."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          ></textarea>

          <h3 className="text-lg font-semibold mt-6 mb-2 text-gray-300">Select a category</h3>
          <div className="flex flex-wrap gap-2 mb-2">
            {allCategories.map((pill) => (
              <button
                key={pill}
                type="button"
                className={`px-4 py-2 rounded-full font-medium transition-colors ${
                  pillCategories.includes(pill)
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:border-blue-500"
                }`}
                onClick={() => handlePillClick(pill, setPillCategories)}
              >
                {pill}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) =>
              handleAddCustomPill(
                e,
                customCategory,
                setPillCategories,
                setCustomCategory,
                allCategories
              )
            }
            className="flex gap-2"
          >
            <input
              type="text"
              className="flex-grow p-2 rounded-full bg-gray-700 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Add custom category"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors"
            >
              Add
            </button>
          </form>

          <h3 className="text-lg font-semibold mt-6 mb-2 text-gray-300">
            Select a mood or action
          </h3>
          <div className="flex flex-wrap gap-2 mb-2">
            {allMoods.map((pill) => (
              <button
                key={pill}
                type="button"
                className={`px-4 py-2 rounded-full font-medium transition-colors ${
                  pillMoods.includes(pill)
                    ? "bg-purple-600 text-white hover:bg-purple-700"
                    : "bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:border-purple-500"
                }`}
                onClick={() => handlePillClick(pill, setPillMoods)}
              >
                {pill}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) =>
              handleAddCustomPill(e, customMood, setPillMoods, setCustomMood, allMoods)
            }
            className="flex gap-2"
          >
            <input
              type="text"
              className="flex-grow p-2 rounded-full bg-gray-700 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Add custom mood or action"
              value={customMood}
              onChange={(e) => setCustomMood(e.target.value)}
            />
            <button
              type="submit"
              className="px-4 py-2 bg-purple-500 text-white rounded-full hover:bg-purple-600 transition-colors"
            >
              Add
            </button>
          </form>
        </div>

        {/* Branding Section */}
        <div className="mb-8 p-6 bg-gray-800 rounded-2xl border border-gray-700">
          <h2 className="text-xl font-semibold mb-4 text-yellow-300">
            Add Your Branding (Optional)
          </h2>
          <div
            id="logo-dropzone"
            className={`flex flex-col items-center p-4 bg-gray-700 rounded-xl cursor-pointer transition-colors border-2 border-dashed ${
              isDraggingLogo ? "border-yellow-500" : "border-gray-600"
            }`}
            onClick={() => logoInputRef.current?.click()}
            onDragOver={(e) => handleDragOver(e, setIsDraggingLogo)}
            onDragLeave={(e) => handleDragLeave(e, setIsDraggingLogo)}
            onDrop={(e) => {
              setIsDraggingLogo(false);
              handleDrop(e, (val) => setLogo(val));
            }}
          >
            <h3 className="text-lg font-semibold mb-2 text-gray-300">Channel Logo</h3>
            <div className="w-32 h-32 bg-gray-600 rounded-full flex items-center justify-center border-2 border-dashed border-gray-500 overflow-hidden">
              {logo ? (
                <div className="relative w-full h-full">
                  <Image
                    src={logo}
                    alt="Logo"
                    fill
                    unoptimized
                    className="rounded-full object-contain"
                  />
                </div>
              ) : (
                <span className="text-gray-400 text-center text-sm">Click or drag to upload</span>
              )}
            </div>
            <input
              type="file"
              ref={logoInputRef}
              className="hidden"
              onChange={(e) => handleImageUpload(e.target.files?.[0], setLogo)}
              accept="image/*"
            />
          </div>
        </div>

        {/* Generate Button */}
        <div className="text-center">
          <button
            type="button"
            className="w-full md:w-auto px-12 py-4 rounded-full text-lg font-bold text-white transition-all transform hover:scale-105 shadow-lg
                     bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-opacity-50"
            onClick={generateThumbnail}
            disabled={loading}
          >
            {loading ? "Generating..." : "Generate Thumbnail"}
          </button>
        </div>

        {/* Result & Loading Indicator */}
        <div className="mt-8">
          {loading && <LoadingState />}
          {error && (
            <div className="bg-red-900 text-red-300 p-4 rounded-lg text-center mt-4 border border-red-700">
              {error}
            </div>
          )}
          {generatedImage && (
            <div className="bg-gray-800 p-4 rounded-2xl flex flex-col items-center">
              <h2 className="text-xl font-semibold mb-4 text-green-400">
                Your Generated Thumbnail
              </h2>
              <div className="relative w-full max-w-lg" style={{ aspectRatio: "16 / 9" }}>
                <Image
                  src={generatedImage}
                  alt="Generated Thumbnail"
                  fill
                  unoptimized
                  className="rounded-xl shadow-lg border-2 border-gray-700 object-contain"
                />
              </div>
              <button
                type="button"
                onClick={handleDownload}
                className="mt-4 px-6 py-2 rounded-full text-lg font-bold text-white transition-all transform hover:scale-105 shadow-lg
                     bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 focus:outline-none focus:ring-4 focus:ring-green-500 focus:ring-opacity-50"
              >
                Download Thumbnail
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
