import GridBackground from "@/components/GridBackground";
import { Input } from "@/components/ui/input";
import { Upload, Loader2, Camera } from "lucide-react";
import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const HomePageDemo = () => {
  const [mode, setMode] = useState<"select" | "upload">("select");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleApiRequest = async () => {
    const formData = new FormData();
    files.forEach((file) => formData.append("images", file));
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post("http://localhost:5000/predict-batch", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      navigate("/results-batch", {
        state: {
          batchResults: res.data.results,
          excelReport: res.data.excel_report,
        },
      });
    } catch (err: any) {
      setError(err?.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
    setFiles(selectedFiles);
  };

  useEffect(() => {
    if (files.length > 0) handleApiRequest();
  }, [files]);

  // ── Mode selection screen ──────────────────────────────────────────
  if (mode === "select") {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-10 overflow-hidden pt-32">
        <div className="z-10 flex flex-col items-center gap-2">
          <h1 className="text-2xl font-semibold text-gray-700">Choose Inspection Mode</h1>
          <p className="text-sm text-gray-400">How would you like to inspect the blade?</p>
        </div>

        <div className="z-10 flex gap-6">
          {/* Upload card */}
          <button
            onClick={() => setMode("upload")}
            className="flex flex-col items-center gap-4 p-10 w-60 border-2 border-dashed border-gray-300 rounded-2xl bg-white hover:border-blue-400 hover:bg-blue-50 transition-all shadow-sm"
          >
            <Upload className="w-10 h-10 text-blue-500" />
            <div className="flex flex-col items-center gap-1">
              <span className="font-semibold text-gray-700">Upload Images</span>
              <span className="text-xs text-gray-400 text-center">
                Select JPG/JPEG files from your device
              </span>
            </div>
          </button>

          {/* Pic Clicker capture card */}
          <button
            onClick={() => navigate("/capture-images")}
            className="flex flex-col items-center gap-4 p-10 w-60 border-2 border-dashed border-gray-300 rounded-2xl bg-white hover:border-green-400 hover:bg-green-50 transition-all shadow-sm"
          >
            <Camera className="w-10 h-10 text-green-500" />
            <div className="flex flex-col items-center gap-1">
              <span className="font-semibold text-gray-700">Image Capture</span>
              <span className="text-xs text-gray-400 text-center">
                Capture images using pic_clicker desktop app
              </span>
            </div>
          </button>
        </div>

        <div className="absolute pt-16 pointer-events-none">
          <GridBackground />
        </div>
      </div>
    );
  }

  // ── Upload screen ──────────────────────────────────────────────────
  return (
    <div className="w-full h-full flex flex-col items-center justify-center overflow-hidden pt-52">
      {loading ? (
        <div className="z-50 flex flex-col items-center justify-center gap-4 w-1/3 h-64 border-2 border-gray-300 border-dashed rounded-2xl bg-gray-100">
          <Loader2 className="w-8 h-8 text-gray-500 animate-spin" />
          <p className="text-gray-600 font-medium">
            Processing {files.length} image{files.length > 1 ? "s" : ""}...
          </p>
          <p className="text-xs text-gray-400">This may take a moment</p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-4 z-10">
          {/* Back button */}
          <button
            onClick={() => setMode("select")}
            className="self-start text-sm text-gray-400 hover:text-gray-600 mb-2"
          >
            ← Back
          </button>

          <label
            htmlFor="dropzone-file"
            className="flex flex-col items-center justify-center w-full h-64 border-2 border-gray-300 border-dashed rounded-2xl cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex flex-col items-center justify-center gap-4 pt-5 pb-6">
              <Upload className="w-8 text-gray-500" />
              <div className="flex flex-col items-center">
                <p className="mb-2 text-sm text-gray-500 px-64">
                  <span className="font-semibold">
                    Click to upload blade images for inspection
                  </span>
                </p>
                <p className="text-xs text-gray-500">JPG or JPEG — multiple files supported</p>
              </div>
            </div>
            <Input
              id="dropzone-file"
              type="file"
              accept=".jpg,.jpeg"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </label>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
              {error}
            </p>
          )}
        </div>
      )}

      <div className="absolute pt-16 pointer-events-none">
        <GridBackground />
      </div>
    </div>
  );
};

export default HomePageDemo;