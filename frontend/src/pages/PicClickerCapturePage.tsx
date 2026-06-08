import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";

const BASE = "http://localhost:5000";

interface CapturedImage {
  filename: string;
  url: string;
}

interface BatchResult {
  filename?: string;
  predicted_image?: string;
  detections?: any[];
  error?: string;
  body_message?: string;
}

export default function PicClickerCapturePage() {
  const navigate = useNavigate();
  const [folderName, setFolderName] = useState("");
  const [showFolderDialog, setShowFolderDialog] = useState(true);
  const [captureRunning, setCaptureRunning] = useState(false);
  const [capturedImages, setCapturedImages] = useState<CapturedImage[]>([]);
  const [processedResults, setProcessedResults] = useState<BatchResult[]>([]);
  const [processedFilenames, setProcessedFilenames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pollingActive, setPollingActive] = useState(false);

  // ── Check capture status periodically ──────────────────────────────────────
  useEffect(() => {
    if (!pollingActive || !captureRunning) return;

    const checkStatus = async () => {
      try {
        const statusRes = await axios.get(`${BASE}/capture-status`);
        setCaptureRunning(statusRes.data.running);

        if (statusRes.data.running && folderName) {
          const imagesRes = await axios.get(`${BASE}/list-captured-images?folder=${folderName}`);
          const newImages = imagesRes.data.images || [];
          setCapturedImages(newImages);

          // Process new images
          const currentFilenames = newImages.map((i: CapturedImage) => i.filename);
          const newFilenames = currentFilenames.filter((f: string) => !processedFilenames.includes(f));
          if (newFilenames.length > 0) {
            try {
              const processRes = await axios.post(`${BASE}/process-captured-images`, {
                folder_name: folderName,
                filenames: newFilenames,
              });
              setProcessedResults((prev) => [...prev, ...processRes.data.results]);
              setProcessedFilenames((prev) => [...prev, ...newFilenames]);
            } catch (processErr) {
              console.error("Processing failed:", processErr);
            }
          }
        }
      } catch (err) {
        console.error("Status check failed:", err);
      }
    };

    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, [pollingActive, captureRunning, folderName, processedFilenames]);

  // ── Start pic_clicker with folder name ─────────────────────────────────────
  const handleStartCapture = useCallback(async () => {
    if (!folderName.trim()) {
      setError("Please enter a folder name");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(`${BASE}/start-capture`, {
        folder_name: folderName.trim(),
      });

      setCaptureRunning(true);
      setPollingActive(true);
      setShowFolderDialog(false);
      setCapturedImages([]);
      setProcessedResults([]);
      setProcessedFilenames([]);

      // Initial image list
      const imagesRes = await axios.get(`${BASE}/list-captured-images?folder=${folderName.trim()}`);
      setCapturedImages(imagesRes.data.images || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to start capture");
      setCaptureRunning(false);
    } finally {
      setLoading(false);
    }
  }, [folderName]);

  // ── Stop pic_clicker ───────────────────────────────────────────────────────
  const handleStopCapture = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await axios.post(`${BASE}/stop-capture`);
      setCaptureRunning(false);
      setPollingActive(false);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to stop capture");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Start new capture session ──────────────────────────────────────────────
  const handleNewSession = useCallback(async () => {
    if (captureRunning) {
      await handleStopCapture();
    }
    setShowFolderDialog(true);
    setFolderName("");
    setCapturedImages([]);
    setProcessedResults([]);
    setProcessedFilenames([]);
    setError(null);
  }, [captureRunning, handleStopCapture]);

  // ── View results ───────────────────────────────────────────────────────────
  const handleViewResults = useCallback(() => {
    navigate("/results-batch", {
      state: {
        batchResults: processedResults,
        excelReport: null,
      },
    });
  }, [navigate, processedResults]);

  return (
    <div style={{ display: "flex", height: "100vh", flexDirection: "column", background: "#f5f5f5" }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        color: "white",
        padding: "20px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}>
        <h1 style={{ margin: "0 0 4px 0", fontSize: "28px", fontWeight: "bold" }}>
          Image Capture
        </h1>
        <p style={{ margin: 0, fontSize: "14px", opacity: 0.9 }}>
          Using pic_clicker for professional blade inspection imaging
        </p>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
        {/* Folder Name Dialog */}
        {showFolderDialog && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}>
            <div style={{
              background: "white",
              borderRadius: "12px",
              padding: "32px",
              boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
              maxWidth: "400px",
              width: "90%",
            }}>
              <h2 style={{ margin: "0 0 12px 0", fontSize: "20px", fontWeight: "bold" }}>
                Create New Capture Session
              </h2>
              <p style={{ margin: "0 0 20px 0", fontSize: "14px", color: "#666" }}>
                Enter a folder name to save your captured images
              </p>

              <Input
                type="text"
                placeholder="e.g., Blade_2026-05-11 or Inspection_001"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleStartCapture()}
                style={{ marginBottom: "20px" }}
              />

              {error && (
                <div style={{
                  background: "#fee2e2",
                  color: "#c00",
                  padding: "12px",
                  borderRadius: "6px",
                  marginBottom: "20px",
                  fontSize: "13px",
                }}>
                  {error}
                </div>
              )}

              <div style={{ display: "flex", gap: "10px" }}>
                <Button
                  onClick={handleStartCapture}
                  disabled={loading || !folderName.trim()}
                  style={{
                    flex: 1,
                    background: "#667eea",
                    color: "white",
                    padding: "10px",
                    borderRadius: "6px",
                    border: "none",
                    cursor: loading ? "wait" : "pointer",
                    opacity: loading || !folderName.trim() ? 0.6 : 1,
                  }}
                >
                  {loading ? "Starting..." : "Start Capture"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Status Bar */}
        {!showFolderDialog && (
          <div style={{
            background: "white",
            padding: "16px",
            borderRadius: "8px",
            marginBottom: "20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div>
              <h3 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: "bold" }}>
                Folder: <span style={{ color: "#667eea" }}>{folderName}</span>
              </h3>
              <p style={{ margin: 0, fontSize: "12px", color: "#666" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: captureRunning ? "#22c55e" : "#ef4444",
                    marginRight: "6px",
                  }}
                />
                {captureRunning ? "Capture in progress" : "Capture stopped"}
              </p>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              {captureRunning ? (
                <Button
                  onClick={handleStopCapture}
                  disabled={loading}
                  style={{
                    background: "#ef4444",
                    color: "white",
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Stop Capture
                </Button>
              ) : (
                <Button
                  onClick={() => setShowFolderDialog(true)}
                  style={{
                    background: "#667eea",
                    color: "white",
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Start New Session
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Captured Images Grid */}
        {!showFolderDialog && (
          <div>
            <h2 style={{ margin: "0 0 16px 0", fontSize: "18px", fontWeight: "bold" }}>
              Captured Images ({capturedImages.length})
            </h2>

            {capturedImages.length === 0 ? (
              <div style={{
                background: "white",
                padding: "40px",
                borderRadius: "8px",
                textAlign: "center",
                color: "#666",
              }}>
                <p style={{ fontSize: "14px", margin: 0 }}>
                  {captureRunning
                    ? "No images captured yet. Use pic_clicker to capture images."
                    : "Start a new capture session to begin."}
                </p>
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "16px",
              }}>
                {capturedImages.map((image, idx) => {
                  const result = processedResults.find(r => r.filename === image.filename);
                  return (
                    <div
                      key={idx}
                      style={{
                        background: "white",
                        borderRadius: "8px",
                        overflow: "hidden",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                        transition: "transform 0.2s, box-shadow 0.2s",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-4px)";
                        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
                      }}
                    >
                      <div style={{
                        width: "100%",
                        height: "200px",
                        background: "#f0f0f0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                      }}>
                        <img
                          src={result?.predicted_image ? `data:image/png;base64,${result.predicted_image}` : image.url}
                          alt={image.filename}
                          style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit: "contain",
                          }}
                        />
                      </div>
                      <div style={{
                        padding: "12px",
                        borderTop: "1px solid #eee",
                      }}>
                        <p style={{
                          margin: "0 0 8px 0",
                          fontSize: "12px",
                          color: "#333",
                          fontWeight: "500",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {image.filename}
                        </p>
                        {result?.body_message && (
                          <p style={{
                            margin: "0 0 8px 0",
                            fontSize: "11px",
                            color: "#666",
                          }}>
                            {result.body_message}
                          </p>
                        )}
                        {result?.detections && result.detections.length > 0 ? (
                          <div>
                            <p style={{
                              margin: "0 0 4px 0",
                              fontSize: "11px",
                              fontWeight: "bold",
                              color: "#d32f2f",
                            }}>
                              Defects: {result.detections.length}
                            </p>
                            {result.detections.slice(0, 3).map((det: any, dIdx: number) => (
                              <p key={dIdx} style={{
                                margin: "2px 0",
                                fontSize: "10px",
                                color: "#666",
                              }}>
                                {det.class_name} ({(det.confidence * 100).toFixed(1)}%)
                              </p>
                            ))}
                            {result.detections.length > 3 && (
                              <p style={{
                                margin: "2px 0",
                                fontSize: "10px",
                                color: "#999",
                              }}>
                                ...and {result.detections.length - 3} more
                              </p>
                            )}
                          </div>
                        ) : result ? (
                          <p style={{
                            margin: "0",
                            fontSize: "11px",
                            color: "#4caf50",
                          }}>
                            No defects detected
                          </p>
                        ) : (
                          <p style={{
                            margin: "0",
                            fontSize: "11px",
                            color: "#666",
                          }}>
                            Processing...
                          </p>
                        )}
                        {result?.error && (
                          <p style={{
                            margin: "0",
                            fontSize: "11px",
                            color: "#f44336",
                          }}>
                            Error: {result.error}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
      </div>

      {/* Footer */}
      {!showFolderDialog && (
        <div style={{
          background: "white",
          borderTop: "1px solid #eee",
          padding: "16px 20px",
          display: "flex",
          justifyContent: "flex-end",
          gap: "10px",
          flexShrink: 0,
        }}>
          <Button
            onClick={handleNewSession}
            style={{
              background: "#f0f0f0",
              color: "#333",
              padding: "10px 20px",
              borderRadius: "6px",
              border: "1px solid #ddd",
              cursor: "pointer",
            }}
          >
            New Session
          </Button>
          {processedResults.length > 0 && (
            <Button
              onClick={handleViewResults}
              style={{
                background: "#667eea",
                color: "white",
                padding: "10px 20px",
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
              }}
            >
              View Results
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
