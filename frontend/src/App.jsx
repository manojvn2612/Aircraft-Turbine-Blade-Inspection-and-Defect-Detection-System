import { useEffect, useRef, useState } from "react";
import {
  FiUpload,
  FiCamera,
  FiFileText,
  FiArrowLeft,
  FiImage,
  FiPlay,
  FiCheckCircle,
  FiAlertTriangle,
  FiRefreshCw,
  FiSettings,
} from "react-icons/fi";
import jsPDF from "jspdf";
import "./App.css";

const API = "http://127.0.0.1:8000";

export default function App() {
  const [page, setPage] = useState("select"); // "select" | "images" | "review"
  const [status, setStatus] = useState("");
  const [session, setSession] = useState("");
  const [folderName, setFolderName] = useState("");
  const [zoom, setZoom] = useState(100);

  const [images, setImages] = useState([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState("");

  // predictions keyed by filename: { status: "loading"|"done"|"error", data, error }
  const [predictions, setPredictions] = useState({});
  const [predicting, setPredicting] = useState(false);

  // retraining: "idle" | "starting" | "running" | "done" | "failed"
  const [retrainStatus, setRetrainStatus] = useState("idle");
  const [retrainProgress, setRetrainProgress] = useState(0);
  const [retrainMessage, setRetrainMessage] = useState("");
  const retrainPollRef = useRef(null);

  const sessionStarted = useRef(false);
  const fileInputRef = useRef(null);

  function zoomIn() {
    setZoom((z) => Math.min(z + 10, 150));
  }

  function zoomOut() {
    setZoom((z) => Math.max(z - 10, 80));
  }

  useEffect(() => {
    if (sessionStarted.current) return;
    sessionStarted.current = true;
    startSession();
  }, []);

  async function startSession() {
    try {
      const res = await fetch(`${API}/`, {
        credentials: "include",
      });

      const data = await res.json();

      setStatus(data.status);
      setSession(data.session_id);
    } catch (err) {
      console.log(err);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function loadImages() {
    setImagesLoading(true);
    setImagesError("");

    try {
      const res = await fetch(`${API}/images`, { credentials: "include" });

      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      const data = await res.json();
      setImages(data.images || []);
    } catch (err) {
      console.log(err);
      setImagesError("Couldn't load images for this session.");
    } finally {
      setImagesLoading(false);
    }
  }

  async function predictAll() {
    if (images.length === 0) return;
    setPredicting(true);

    setPredictions((prev) => {
      const next = { ...prev };
      images.forEach((name) => {
        next[name] = { status: "loading" };
      });
      return next;
    });

    try {
      // /predict processes every image in the session folder in one call
      // and returns a list of result objects, one per image.
      const res = await fetch(`${API}/predict`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      const data = await res.json();
      const results = data.results || (Array.isArray(data) ? data : []);

      setPredictions((prev) => {
        const next = { ...prev };

        images.forEach((name, i) => {
          const match =
            results.find((r) => r.filename === name) || results[i];

          next[name] = match
            ? { status: "done", data: match }
            : { status: "error", error: "No prediction returned" };
        });

        return next;
      });

      // Send the user straight to the review page once prediction finishes.
      setPage("review");
    } catch (err) {
      console.log(err);
      setPredictions((prev) => {
        const next = { ...prev };
        images.forEach((name) => {
          next[name] = { status: "error", error: "Prediction failed" };
        });
        return next;
      });
    } finally {
      setPredicting(false);
    }
  }

  async function startRetraining() {
    if (retrainStatus === "starting" || retrainStatus === "running") return;

    setRetrainStatus("starting");
    setRetrainProgress(0);
    setRetrainMessage("");

    try {
      const res = await fetch(`${API}/retrain`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      setRetrainStatus("running");
      pollRetrainStatus();
    } catch (err) {
      console.log(err);
      setRetrainStatus("failed");
      setRetrainMessage("Couldn't start retraining. Check the console for details.");
    }
  }

  function pollRetrainStatus() {
    if (retrainPollRef.current) clearInterval(retrainPollRef.current);

    retrainPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/retrain-status`, {
          credentials: "include",
        });

        if (!res.ok) throw new Error(`Request failed (${res.status})`);

        const data = await res.json();

        setRetrainProgress(
          typeof data.progress === "number" ? data.progress : 0
        );
        setRetrainMessage(data.message || "");

        if (data.status === "done") {
          setRetrainStatus("done");
          setRetrainProgress(100);
          clearInterval(retrainPollRef.current);
          retrainPollRef.current = null;
        } else if (data.status === "failed") {
          setRetrainStatus("failed");
          clearInterval(retrainPollRef.current);
          retrainPollRef.current = null;
        } else {
          setRetrainStatus("running");
        }
      } catch (err) {
        console.log(err);
        setRetrainStatus("failed");
        setRetrainMessage("Lost connection while checking retraining status.");
        clearInterval(retrainPollRef.current);
        retrainPollRef.current = null;
      }
    }, 3000);
  }

  useEffect(() => {
    return () => {
      if (retrainPollRef.current) clearInterval(retrainPollRef.current);
    };
  }, []);

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch(`${API}/upload-image`, {
        method: "POST",
        credentials: "include",
        body: form,
      });

      const data = await res.json();

      if (data.folder_name) setFolderName(data.folder_name);
      setPage("images");
      loadImages();
    } catch (err) {
      console.log(err);
      alert("Upload failed. Check the console for details.");
    } finally {
      e.target.value = "";
    }
  }

  async function toggleCamera() {
    try {
      const res = await fetch(`${API}/camera`, {
        method: "POST",
        credentials: "include",
      });

      const data = await res.json();

      if (data.folder_name) setFolderName(data.folder_name);
      setPage("images");
      loadImages();
    } catch (err) {
      console.log(err);
      alert("Camera capture failed. Check the console for details.");
    }
  }

  function goToReview() {
    setPage("review");
  }

  function goBack() {
    setPage("select");
    setFolderName("");
    setImages([]);
    setPredictions({});
  }

  function backToImages() {
    setPage("images");
  }

  return (
    <div className="app" style={{ "--zoom": zoom / 100 }}>
      {/* Header */}
      <header className="header">
        <div className="logo">
          <div className="logoBox">✈</div>

          <div className="logoText">
            <h2>Blade</h2>
            <h2>Defect</h2>
            <h2>Detection</h2>
          </div>
        </div>

        <div className="headerRight">
          <div className="zoomControl">
            <button onClick={zoomOut} aria-label="Zoom out">
              −
            </button>
            <span>{zoom}%</span>
            <button onClick={zoomIn} aria-label="Zoom in">
              +
            </button>
          </div>
        </div>
      </header>

      {page === "select" && (
        <SelectPage
          openFilePicker={openFilePicker}
          toggleCamera={toggleCamera}
          fileInputRef={fileInputRef}
          handleFileChange={handleFileChange}
          status={status}
          session={session}
          retrainStatus={retrainStatus}
          retrainProgress={retrainProgress}
          retrainMessage={retrainMessage}
          onStartRetraining={startRetraining}
        />
      )}

      {page === "images" && (
        <ImagesPage
          folderName={folderName}
          images={images}
          imagesLoading={imagesLoading}
          imagesError={imagesError}
          predictions={predictions}
          predicting={predicting}
          predictAll={predictAll}
          onBack={goBack}
          onViewDetails={goToReview}
        />
      )}

      {page === "review" && (
        <ReviewPage
          folderName={folderName}
          images={images}
          predictions={predictions}
          onBack={backToImages}
        />
      )}
    </div>
  );
}

function SelectPage({
  openFilePicker,
  toggleCamera,
  fileInputRef,
  handleFileChange,
  status,
  session,
  retrainStatus,
  retrainProgress,
  retrainMessage,
  onStartRetraining,
}) {
  const isRetrainBusy = retrainStatus === "starting" || retrainStatus === "running";

  return (
    <main className="main">
      <div className="grid"></div>

      <div className="content">
        <h1>Choose Inspection Mode</h1>
        <p>How would you like to inspect the blade?</p>

        <div className="cards">
          {/* Upload */}
          <button className="card" onClick={openFilePicker}>
            <FiUpload className="icon upload" />
            <h3>Upload Images</h3>
            <p>Select JPG/JPEG files from your device</p>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg"
            className="hiddenInput"
            onChange={handleFileChange}
          />

          {/* Camera */}
          <button className="card" onClick={toggleCamera}>
            <FiCamera className="icon camera" />
            <h3>Image Capture</h3>
            <p>
              Capture images using
              <br />
              pic_clicker desktop app
            </p>
          </button>
        </div>

        <div className="modelActions">
          <button
            className="retrainBtn"
            onClick={onStartRetraining}
            disabled={isRetrainBusy}
          >
            <FiRefreshCw className={isRetrainBusy ? "spin" : ""} />
            {retrainStatus === "starting"
              ? "Starting…"
              : retrainStatus === "running"
              ? "Retraining…"
              : "Start Retraining"}
          </button>

          <button className="secondaryActionBtn" disabled>
            <FiSettings />
            Coming Soon
          </button>
        </div>

        {retrainStatus !== "idle" && (
          <div className="retrainStatusBlock">
            <div className="retrainStatusRow">
              <span className="retrainStatusLabel">
                {retrainStatus === "starting" && "Starting retraining job…"}
                {retrainStatus === "running" && "Retraining in progress…"}
                {retrainStatus === "done" && (
                  <>
                    <FiCheckCircle className="predIconOk" /> Retraining complete
                  </>
                )}
                {retrainStatus === "failed" && (
                  <>
                    <FiAlertTriangle className="predIconWarn" /> Retraining failed
                  </>
                )}
              </span>
              {(retrainStatus === "running" || retrainStatus === "done") && (
                <span className="retrainStatusPercent">{retrainProgress}%</span>
              )}
            </div>

            {(retrainStatus === "running" || retrainStatus === "done") && (
              <div className="progressBar">
                <div
                  className="progressBarFill"
                  style={{ width: `${retrainProgress}%` }}
                />
              </div>
            )}

            {retrainMessage && (
              <p className="retrainMessage">{retrainMessage}</p>
            )}
          </div>
        )}

        {status && (
          <div className="session">
            <strong>Status:</strong> {status}
            <br />
            <strong>Session:</strong> {session}
          </div>
        )}
      </div>
    </main>
  );
}

function ImagesPage({
  folderName,
  images,
  imagesLoading,
  imagesError,
  predictions,
  predicting,
  predictAll,
  onBack,
  onViewDetails,
}) {
  const [generatingReport, setGeneratingReport] = useState(false);

  function extractConfidence(defect) {
    if (!defect || typeof defect !== "object") return null;
    const key = ["confidence", "score", "conf"].find((k) => k in defect);
    if (!key) return null;
    const val = defect[key];
    return typeof val === "number" ? `${(val * 100).toFixed(1)}%` : val;
  }

  function predictedImageSrc(data) {
    if (!data) return null;
    const filename = data.result_filename || `predicted_${data.filename || ""}`;
    if (!filename) return null;
    return `${API}/results/${encodeURIComponent(filename)}`;
  }

  async function fetchImageAsDataUrl(url) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
    const blob = await res.blob();

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // jsPDF needs an explicit format (JPEG/PNG/etc) - derive it from the
    // blob's mime type rather than relying on auto-detection, which can
    // silently fail for some encodings.
    let format = "JPEG";
    if (blob.type.includes("png")) format = "PNG";
    else if (blob.type.includes("webp")) format = "WEBP";
    else if (blob.type.includes("jpeg") || blob.type.includes("jpg")) format = "JPEG";

    return { dataUrl, format };
  }

  const doneCount = images.filter(
    (name) => predictions[name]?.status === "done"
  ).length;

  async function generateReport() {
    setGeneratingReport(true);

    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      const contentWidth = pageWidth - margin * 2;
      let y = 50;

      doc.setFontSize(18);
      doc.setFont(undefined, "bold");
      doc.text("Blade Defect Detection Report", margin, y);
      y += 20;

      doc.setFontSize(10);
      doc.setFont(undefined, "normal");
      doc.setTextColor(120);
      doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
      if (folderName) {
        y += 14;
        doc.text(`Folder: ${folderName}`, margin, y);
      }
      doc.setTextColor(0);
      y += 24;

      doc.setDrawColor(220);
      doc.line(margin, y, pageWidth - margin, y);
      y += 24;

      for (const name of images) {
        const pred = predictions[name];
        const isDone = pred?.status === "done";

        // Reserve roughly the height of an image block; start a fresh
        // page if there isn't enough room left, same idea as the review
        // page's stacked cards.
        const imageBlockHeight = 200;
        if (y + imageBlockHeight > pageHeight - 60) {
          doc.addPage();
          y = 50;
        }

        doc.setFontSize(13);
        doc.setFont(undefined, "bold");
        doc.setTextColor(0);
        doc.text(name, margin, y);
        y += 18;

        if (!isDone) {
          doc.setFontSize(10);
          doc.setFont(undefined, "normal");
          doc.setTextColor(150);
          doc.text(
            pred?.status === "error"
              ? "Prediction failed for this image."
              : "No prediction available.",
            margin,
            y
          );
          doc.setTextColor(0);
          y += 26;
          continue;
        }

        const data = pred.data;

        // Same image the review page shows: predicted/annotated image,
        // falling back to the original upload.
        const src =
          predictedImageSrc(data) || `${API}/images/${encodeURIComponent(name)}`;

        try {
          const { dataUrl, format } = await fetchImageAsDataUrl(src);

          // Figure out a reasonable display size that fits the page width
          // while roughly preserving aspect ratio.
          const imgProps = doc.getImageProperties(dataUrl);
          const maxImgWidth = contentWidth;
          const maxImgHeight = 220;
          let imgWidth = maxImgWidth;
          let imgHeight = (imgProps.height / imgProps.width) * imgWidth;

          if (imgHeight > maxImgHeight) {
            imgHeight = maxImgHeight;
            imgWidth = (imgProps.width / imgProps.height) * imgHeight;
          }

          if (y + imgHeight > pageHeight - 60) {
            doc.addPage();
            y = 50;
          }

          doc.addImage(dataUrl, format, margin, y, imgWidth, imgHeight);
          y += imgHeight + 14;
        } catch (imgErr) {
          console.log("Image embed failed for", name, imgErr);
          doc.setFontSize(10);
          doc.setTextColor(200, 0, 0);
          doc.text(`(Image could not be embedded: ${imgErr.message || "unknown error"})`, margin, y);
          doc.setTextColor(0);
          y += 18;
        }

        // Summary line: defect count, same as the review page's dropdown header.
        doc.setFontSize(11);
        doc.setFont(undefined, "bold");
        const summary =
          data.defect_count > 0
            ? `${data.defect_count} defect(s) found`
            : "No defects found";
        doc.text(summary, margin, y);
        y += 16;

        // Defect list with confidence, same as the review page's expanded panel.
        doc.setFontSize(10);
        doc.setFont(undefined, "normal");

        if (Array.isArray(data.defects) && data.defects.length > 0) {
          data.defects.forEach((d) => {
            if (y > pageHeight - 60) {
              doc.addPage();
              y = 50;
            }
            const conf = extractConfidence(d);
            const line = `  • ${d.defect_name || "Unknown"}${
              conf ? `  —  confidence: ${conf}` : ""
            }`;
            doc.text(line, margin, y);
            y += 14;
          });
        } else {
          doc.setTextColor(150);
          doc.text("No defects detected on this image.", margin, y);
          doc.setTextColor(0);
          y += 14;
        }

        y += 16;
        doc.setDrawColor(235);
        doc.line(margin, y, pageWidth - margin, y);
        y += 24;
      }

      doc.save(`blade-defect-report-${Date.now()}.pdf`);
    } catch (err) {
      console.log(err);
      alert("Couldn't generate the report. Check the console for details.");
    } finally {
      setGeneratingReport(false);
    }
  }

  return (
    <main className="imagesMain">
      <div className="imagesHeader">
        <button className="backBtn" onClick={onBack}>
          <FiArrowLeft />
          Back
        </button>

        <div className="imagesTitleBlock">
          <h1>Captured Images</h1>
          {folderName && (
            <p>
              Folder: <span className="folderTag">{folderName}</span>
            </p>
          )}
        </div>

        <div className="imagesActions">
          <button
            className="viewDetailsBtn"
            onClick={onViewDetails}
            disabled={images.length === 0}
          >
            <FiImage />
            View Details
          </button>

          <button
            className="predictBtn"
            onClick={predictAll}
            disabled={predicting || images.length === 0}
          >
            <FiPlay />
            {predicting ? "Predicting…" : "Predict All"}
          </button>

          <button
            className="reportBtn"
            onClick={generateReport}
            disabled={doneCount === 0 || generatingReport}
          >
            <FiFileText />
            {generatingReport ? "Generating…" : "Make Report"}
          </button>
        </div>
      </div>

      {imagesLoading && <div className="stateMsg">Loading images…</div>}

      {!imagesLoading && imagesError && (
        <div className="stateMsg error">{imagesError}</div>
      )}

      {!imagesLoading && !imagesError && images.length === 0 && (
        <div className="stateMsg">
          <FiImage className="emptyIcon" />
          No images found in this folder yet.
        </div>
      )}

      {!imagesLoading && !imagesError && images.length > 0 && (
        <div className="imageTable">
          <div className="imageTableHeader twoCol">
            <span>Preview</span>
            <span>File Name</span>
          </div>

          {images.map((name) => (
            <div className="imageRow twoCol" key={name}>
              <img
                src={`${API}/images/${encodeURIComponent(name)}`}
                alt={name}
                loading="lazy"
              />
              <span className="imageName">{name}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function ReviewPage({ folderName, images, predictions, onBack }) {
  const [openDropdown, setOpenDropdown] = useState({}); // filename -> bool

  function extractConfidence(defect) {
    if (!defect || typeof defect !== "object") return null;
    const key = ["confidence", "score", "conf"].find((k) => k in defect);
    if (!key) return null;
    const val = defect[key];
    return typeof val === "number" ? `${(val * 100).toFixed(1)}%` : val;
  }

  function predictedImageSrc(data) {
    if (!data) return null;
    const filename = data.result_filename || `predicted_${data.filename || ""}`;
    if (!filename) return null;
    return `${API}/results/${encodeURIComponent(filename)}`;
  }

  function toggleDropdown(name) {
    setOpenDropdown((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  return (
    <main className="reviewMain">
      <div className="imagesHeader">
        <button className="backBtn" onClick={onBack}>
          <FiArrowLeft />
          Back
        </button>

        <div className="imagesTitleBlock">
          <h1>Image Review</h1>
          {folderName && (
            <p>
              Folder: <span className="folderTag">{folderName}</span>
            </p>
          )}
        </div>
      </div>

      {images.length === 0 && (
        <div className="stateMsg">
          <FiImage className="emptyIcon" />
          No images to review yet.
        </div>
      )}

      <div className="reviewList">
        {images.map((name) => {
          const pred = predictions[name];
          const isDone = pred?.status === "done";
          const defects = isDone && Array.isArray(pred.data.defects) ? pred.data.defects : [];
          const defectCount = isDone ? pred.data.defect_count ?? defects.length : null;
          const displaySrc = isDone
            ? predictedImageSrc(pred.data) || `${API}/images/${encodeURIComponent(name)}`
            : `${API}/images/${encodeURIComponent(name)}`;
          const isOpen = !!openDropdown[name];

          return (
            <section className="reviewCard" key={name}>
              <div className="reviewImageWrap">
                <img src={displaySrc} alt={name} loading="lazy" />
              </div>

              <div className="reviewInfo">
                <h3 className="reviewFileName">{name}</h3>

                {!pred && <span className="predIdle">Not predicted yet</span>}

                {pred?.status === "loading" && (
                  <span className="predLoading">Predicting…</span>
                )}

                {pred?.status === "error" && (
                  <span className="predError">
                    <FiAlertTriangle /> {pred.error}
                  </span>
                )}

                {isDone && (
                  <div className="defectDropdown">
                    <button
                      className="dropdownToggle"
                      onClick={() => toggleDropdown(name)}
                    >
                      {defectCount > 0 ? (
                        <FiAlertTriangle className="predIconWarn" />
                      ) : (
                        <FiCheckCircle className="predIconOk" />
                      )}
                      <span>
                        {defectCount > 0
                          ? `${defectCount} defect(s) found`
                          : "No defects found"}
                      </span>
                      <span className={`chevron ${isOpen ? "open" : ""}`}>▾</span>
                    </button>

                    {isOpen && (
                      <div className="dropdownPanel">
                        {defects.length === 0 && (
                          <p className="dropdownEmpty">
                            No defects detected on this image.
                          </p>
                        )}

                        {defects.length > 0 && (
                          <ul className="defectList large">
                            {defects.map((d, i) => (
                              <li key={i}>
                                <span>{d.defect_name || "Unknown"}</span>
                                {extractConfidence(d) && (
                                  <span className="confBadge">
                                    {extractConfidence(d)}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}