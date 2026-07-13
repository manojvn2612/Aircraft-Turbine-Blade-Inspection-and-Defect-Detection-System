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
  FiFolder,
} from "react-icons/fi";
import jsPDF from "jspdf";
import "./App.css";

const API = "http://127.0.0.1:8000";

export default function App() {
  const [page, setPage] = useState("select"); // "select" | "images" | "review" | "retrain"
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

  // retraining: "idle" | "starting" | "running" | "done" | "scrapped" | "failed"
  const [retrainStatus, setRetrainStatus] = useState("idle");
  const [retrainProgress, setRetrainProgress] = useState(0);
  const [retrainMessage, setRetrainMessage] = useState("");
  const [retrainResult, setRetrainResult] = useState(null);
  // const retrainPollRef = useRef(null);

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
  setRetrainMessage("Training model...");
  setRetrainResult(null);

  try {
    const res = await fetch(`${API}/retrain`, {
      method: "POST",
      credentials: "include",
    });

    if (!res.ok) throw new Error(`Request failed (${res.status})`);

    const data = await res.json();

    setRetrainProgress(100);

    if (data.is_updated) {
      setRetrainStatus("done");
    } else {
      setRetrainStatus("scrapped");
    }

    setRetrainResult(data.response || null);
    setRetrainMessage(data.message || "");
  } catch (err) {
    console.error(err);

    setRetrainStatus("failed");
    setRetrainMessage("Retraining failed.");
  }
}
  // function pollRetrainStatus() {
  //   if (retrainPollRef.current) clearInterval(retrainPollRef.current);

  //   retrainPollRef.current = setInterval(async () => {
  //     try {
  //       const res = await fetch(`${API}/retrain-status`, {
  //         credentials: "include",
  //       });

  //       if (!res.ok) throw new Error(`Request failed (${res.status})`);

  //       const data = await res.json();

  //       setRetrainProgress(
  //         typeof data.progress === "number" ? data.progress : 0
  //       );
  //       setRetrainMessage(data.message || "");

  //       if (data.status === "done") {
  //         setRetrainStatus("done");
  //         setRetrainProgress(100);
  //         setRetrainResult(data.result || null);
  //         clearInterval(retrainPollRef.current);
  //         retrainPollRef.current = null;
  //       } else if (data.status === "scrapped") {
  //         setRetrainStatus("scrapped");
  //         setRetrainProgress(100);
  //         setRetrainResult(null);
  //         clearInterval(retrainPollRef.current);
  //         retrainPollRef.current = null;
  //       } else if (data.status === "failed") {
  //         setRetrainStatus("failed");
  //         clearInterval(retrainPollRef.current);
  //         retrainPollRef.current = null;
  //       } else {
  //         setRetrainStatus("running");
  //       }
  //     } catch (err) {
  //       console.log(err);
  //       setRetrainStatus("failed");
  //       setRetrainMessage("Lost connection while checking retraining status.");
  //       clearInterval(retrainPollRef.current);
  //       retrainPollRef.current = null;
  //     }
  //   }, 3000);
  // }

  // useEffect(() => {
  //   return () => {
  //     if (retrainPollRef.current) clearInterval(retrainPollRef.current);
  //   };
  // }, []);

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
          retrainResult={retrainResult}
          onStartRetraining={startRetraining}
          onOpenRetrainPage={() => setPage("retrain")}
        />
      )}

      {page === "retrain" && (
        <RetrainPage
          retrainStatus={retrainStatus}
          retrainProgress={retrainProgress}
          retrainMessage={retrainMessage}
          retrainResult={retrainResult}
          onStartRetraining={startRetraining}
          onBack={() => setPage("select")}
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
  retrainResult,
  onStartRetraining,
  onOpenRetrainPage,
}) {
  const isRetrainBusy = retrainStatus === "starting" || retrainStatus === "running";
  const [labelingBusy, setLabelingBusy] = useState(false);
  const [labelingMessage, setLabelingMessage] = useState("");

  async function handleRunLabeling() {
    setLabelingBusy(true);
    setLabelingMessage("");

    try {
      const labelingRes = await fetch(`${API}/start-labeling`, {
        method: "POST",
        credentials: "include",
      });
      const labelingData = await labelingRes.json();
      if (!labelingRes.ok) throw new Error(labelingData.detail || "Failed to start labeling tool");

      const folderRes = await fetch(`${API}/open-quick-upload`, {
        method: "POST",
        credentials: "include",
      });
      const folderData = await folderRes.json();
      if (!folderRes.ok) throw new Error(folderData.detail || "Failed to open folder");

      setLabelingMessage("Labeling started and the upload folder is open.");
    } catch (err) {
      console.error(err);
      setLabelingMessage(err.message || "Could not start labeling.");
    } finally {
      setLabelingBusy(false);
    }
  }

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
          <button className="retrainBtn" onClick={handleRunLabeling} disabled={labelingBusy}>
            <FiPlay />
            {labelingBusy ? "Launching…" : "Label"}
          </button>

          <button className="retrainBtn" onClick={onOpenRetrainPage}>
            <FiRefreshCw />
            Retrain Model
          </button>
        </div>

        {labelingMessage && <p className="retrainMessage">{labelingMessage}</p>}

        {retrainStatus !== "idle" && (
          <div className="retrainStatusBlock">
            <div className="retrainStatusRow">
              <span className="retrainStatusLabel">
                {retrainStatus === "starting" && "Starting retraining job…"}
                {retrainStatus === "running" && "Retraining in progress…"}
                {retrainStatus === "done" && (
                  <>
                    <FiCheckCircle className="predIconOk" /> Retraining complete — new model saved
                  </>
                )}
                {retrainStatus === "scrapped" && (
                  <>
                    <FiAlertTriangle className="predIconWarn" /> New model scrapped
                  </>
                )}
                {retrainStatus === "failed" && (
                  <>
                    <FiAlertTriangle className="predIconWarn" /> Retraining failed
                  </>
                )}
              </span>
              {(retrainStatus === "running" ||
                retrainStatus === "done" ||
                retrainStatus === "scrapped") && (
                <span className="retrainStatusPercent">{retrainProgress}%</span>
              )}
            </div>

            {(retrainStatus === "running" ||
              retrainStatus === "done" ||
              retrainStatus === "scrapped") && (
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

            {retrainStatus === "done" &&
              retrainResult &&
              Array.isArray(retrainResult.evaluation_results) && (
                <div className="evalResultsBlock">
                  <div className="evalOverallRow">
                    <span>Overall mIoU</span>
                    <strong>
                      {typeof retrainResult.overall_miou === "number"
                        ? retrainResult.overall_miou.toFixed(4)
                        : "—"}
                    </strong>
                  </div>

                  <table className="evalTable">
                    <thead>
                      <tr>
                        <th>Class</th>
                        <th>IoU</th>
                        <th>Precision</th>
                        <th>Recall</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retrainResult.evaluation_results.map((row, i) => (
                        <tr key={row.class_name || i}>
                          <td>{row.class_name ?? "—"}</td>
                          <td>{typeof row.iou === "number" ? row.iou.toFixed(4) : "—"}</td>
                          <td>
                            {typeof row.precision === "number"
                              ? row.precision.toFixed(4)
                              : "—"}
                          </td>
                          <td>
                            {typeof row.recall === "number"
                              ? row.recall.toFixed(4)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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

function RetrainPage({ retrainStatus, retrainProgress, retrainMessage, retrainResult, onStartRetraining, onBack }) {
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [uploadingZip, setUploadingZip] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [launchingLabeling, setLaunchingLabeling] = useState(false);
  const [labelingMessage, setLabelingMessage] = useState("");
  const [showStepOnePrompt, setShowStepOnePrompt] = useState(false);
  const [showStepTwoPrompt, setShowStepTwoPrompt] = useState(false);
  const zipInputRef = useRef(null);

  async function handleSaveModel() {
    setSaving(true);
    setSaveMessage("");

    try {
      const res = await fetch(`${API}/save-model`, {
        method: "POST",
        credentials: "include",
      });

      const data = await res.json();
      setSaveMessage(data.message || "");
    } catch (err) {
      console.error(err);
      setSaveMessage("Failed to save model.");
    } finally {
      setSaving(false);
    }
  }

  async function handleZipUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingZip(true);
    setUploadMessage("");

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch(`${API}/upload-retrain-zip`, {
        method: "POST",
        credentials: "include",
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      setUploadMessage(data.message || "Dataset uploaded successfully.");
    } catch (err) {
      console.error(err);
      setUploadMessage(err.message || "Failed to upload dataset.");
    } finally {
      setUploadingZip(false);
      event.target.value = "";
    }
  }

  async function handleStartLabeling() {
    setLaunchingLabeling(true);
    setLabelingMessage("");

    try {
      const res = await fetch(`${API}/start-labeling`, {
        method: "POST",
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to start labeling tool");

      setShowStepOnePrompt(true);
      setShowStepTwoPrompt(false);
      setLabelingMessage(data.message || "Labeling tool started.");
    } catch (err) {
      console.error(err);
      setLabelingMessage(err.message || "Failed to start labeling tool.");
    } finally {
      setLaunchingLabeling(false);
    }
  }

  const isRetrainBusy = retrainStatus === "starting" || retrainStatus === "running";
  const isAccepted = retrainResult?.is_updated === true;

  return (
    <main className="retrainPageMain">
      <div className="imagesHeader">
        <button className="backBtn" onClick={onBack}>
          <FiArrowLeft />
          Back
        </button>

        <div className="imagesTitleBlock">
          <h1>Model Retraining</h1>
          <p>Review training results and decide whether to keep the new model.</p>
        </div>
      </div>

      <div className="retrainPageCard">
        <div className="modelActions">
          <button className="retrainBtn" onClick={onStartRetraining} disabled={isRetrainBusy}>
            <FiRefreshCw className={isRetrainBusy ? "spin" : ""} />
            {retrainStatus === "starting"
              ? "Starting…"
              : retrainStatus === "running"
              ? "Retraining…"
              : "Start Retraining"}
          </button>

          <button className="saveModelBtn" onClick={handleSaveModel} disabled={!isAccepted || saving}>
            <FiCheckCircle />
            {saving ? "Saving…" : "Save Model"}
          </button>
        </div>

        <div className="zipUploadBox">
          <h3>Upload Retraining Dataset</h3>
          <p>Upload a ZIP archive containing your retraining images and labels. It will be extracted into the retraining folder.</p>
          <input ref={zipInputRef} type="file" accept=".zip" className="hiddenInput" onChange={handleZipUpload} />
          <button className="uploadZipBtn" onClick={() => zipInputRef.current?.click()} disabled={uploadingZip}>
            <FiUpload />
            {uploadingZip ? "Uploading…" : "Upload ZIP"}
          </button>
          {uploadMessage && <p className="retrainMessage">{uploadMessage}</p>}
        </div>

        <div className="zipUploadBox">
          <h3>Open Labeling Tool</h3>
          <p>Launch the labeling workflow and follow the prompts to add all files and blade labels.</p>
          <button className="launchLabelingBtn" onClick={handleStartLabeling} disabled={launchingLabeling}>
            <FiPlay />
            {launchingLabeling ? "Starting…" : "Run Labeling"}
          </button>
          {labelingMessage && <p className="retrainMessage">{labelingMessage}</p>}
        </div>

        {showStepOnePrompt && (
          <div className="modalOverlay">
            <div className="modalCard">
              <h3>Add files to labeling</h3>
              <p>Add all the images from the retraining folder into the labeling interface before continuing.</p>
              <div className="modalActions">
                <button className="modalButtonPrimary" onClick={() => { setShowStepOnePrompt(false); setShowStepTwoPrompt(true); }}>
                  Next
                </button>
                <button className="modalButtonSecondary" onClick={() => setShowStepOnePrompt(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {showStepTwoPrompt && (
          <div className="modalOverlay">
            <div className="modalCard">
              <h3>Add blade labels</h3>
              <p>Please make sure each image has blade labels added before you continue with retraining.</p>
              <div className="modalActions">
                <button className="modalButtonPrimary" onClick={() => setShowStepTwoPrompt(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {retrainStatus !== "idle" && (
          <div className="retrainStatusBlock">
            <div className="retrainStatusRow">
              <span className="retrainStatusLabel">
                {retrainStatus === "starting" && "Starting retraining job…"}
                {retrainStatus === "running" && "Retraining in progress…"}
                {retrainStatus === "done" && <><FiCheckCircle className="predIconOk" /> Retraining complete</>}
                {retrainStatus === "scrapped" && <><FiAlertTriangle className="predIconWarn" /> Previous model kept</>}
                {retrainStatus === "failed" && <><FiAlertTriangle className="predIconWarn" /> Retraining failed</>}
              </span>
              {(retrainStatus === "running" || retrainStatus === "done" || retrainStatus === "scrapped") && (
                <span className="retrainStatusPercent">{retrainProgress}%</span>
              )}
            </div>

            {(retrainStatus === "running" || retrainStatus === "done" || retrainStatus === "scrapped") && (
              <div className="progressBar">
                <div className="progressBarFill" style={{ width: `${retrainProgress}%` }} />
              </div>
            )}

            {retrainMessage && <p className="retrainMessage">{retrainMessage}</p>}

            {retrainStatus === "scrapped" && (
              <div className="retrainNotice">
                The previous model performed better, so the newly retrained model was discarded.
              </div>
            )}

            {retrainStatus === "done" && retrainResult && retrainResult.evaluation_results && (
              <div className="evalResultsBlock">
                <div className="evalOverallRow">
                  <span>Overall mIoU</span>
                  <strong>{typeof retrainResult.overall_miou === "number" ? retrainResult.overall_miou.toFixed(4) : "—"}</strong>
                </div>

                <table className="evalTable">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>IoU</th>
                      <th>Precision</th>
                      <th>Recall</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retrainResult.evaluation_results.map((row, i) => (
                      <tr key={row.class_name || i}>
                        <td>{row.class_name ?? "—"}</td>
                        <td>{typeof row.iou === "number" ? row.iou.toFixed(4) : "—"}</td>
                        <td>{typeof row.precision === "number" ? row.precision.toFixed(4) : "—"}</td>
                        <td>{typeof row.recall === "number" ? row.recall.toFixed(4) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {saveMessage && <p className="retrainMessage">{saveMessage}</p>}
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
  const [markingState, setMarkingState] = useState({});
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

  function toggleDropdown(name) {
    setOpenDropdown((prev) => ({ ...prev, [name]: !prev[name] }));
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

    let format = "JPEG";
    if (blob.type.includes("png")) format = "PNG";
    else if (blob.type.includes("webp")) format = "WEBP";
    else if (blob.type.includes("jpeg") || blob.type.includes("jpg")) format = "JPEG";

    return { dataUrl, format };
  }

  async function generateReport() {
    setGeneratingReport(true);

    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      const contentWidth = pageWidth - margin * 2;
      const imageColWidth = 220;
      const defectColWidth = contentWidth - imageColWidth - 24;
      let y = 48;

      doc.setFontSize(18);
      doc.setFont(undefined, "bold");
      doc.text("Blade Defect Detection Report", margin, y);
      y += 18;

      doc.setFontSize(10);
      doc.setFont(undefined, "normal");
      doc.setTextColor(120);
      doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
      if (folderName) {
        y += 14;
        doc.text(`Folder: ${folderName}`, margin, y);
      }
      doc.setTextColor(0);
      y += 22;

      doc.setDrawColor(220);
      doc.line(margin, y, pageWidth - margin, y);
      y += 20;

      for (const name of images) {
        const pred = predictions[name];
        const isDone = pred?.status === "done";
        const data = isDone ? pred.data : null;

        const rowHeight = isDone
          ? 160 + Math.max(0, (data?.defects?.length || 0) * 12)
          : 110;

        if (y + rowHeight > pageHeight - 40) {
          doc.addPage();
          y = 48;
        }

        doc.setDrawColor(220);
        doc.roundedRect(margin, y, contentWidth, rowHeight, 8, 8, "S");
        doc.setDrawColor(230);
        doc.line(margin + imageColWidth + 12, y, margin + imageColWidth + 12, y + rowHeight);

        doc.setFontSize(12);
        doc.setFont(undefined, "bold");
        doc.text(name, margin + 12, y + 18);

        if (!isDone || !data) {
          doc.setFontSize(10);
          doc.setFont(undefined, "normal");
          doc.setTextColor(140);
          const note = pred?.status === "error"
            ? "Prediction failed for this image."
            : "No prediction available.";
          doc.text(note, margin + imageColWidth + 24, y + 30);
          doc.setTextColor(0);
          y += rowHeight + 16;
          continue;
        }

        const src = predictedImageSrc(data) || `${API}/images/${encodeURIComponent(name)}`;

        try {
          const { dataUrl, format } = await fetchImageAsDataUrl(src);
          const imgProps = doc.getImageProperties(dataUrl);
          const maxImgHeight = rowHeight - 36;
          const maxImgWidth = imageColWidth - 24;
          let imgWidth = maxImgWidth;
          let imgHeight = (imgProps.height / imgProps.width) * imgWidth;

          if (imgHeight > maxImgHeight) {
            imgHeight = maxImgHeight;
            imgWidth = (imgProps.width / imgProps.height) * imgHeight;
          }

          doc.addImage(
            dataUrl,
            format,
            margin + 12,
            y + 26,
            imgWidth,
            imgHeight
          );
        } catch (imgErr) {
          console.log("Image embed failed for", name, imgErr);
          doc.setFontSize(10);
          doc.setTextColor(200, 0, 0);
          doc.text(`Image could not be embedded.`, margin + 12, y + 36);
          doc.setTextColor(0);
        }

        const summary = data.defect_count > 0
          ? `${data.defect_count} defect(s) found`
          : "No defects found";
        doc.setFontSize(11);
        doc.setFont(undefined, "bold");
        doc.text(summary, margin + imageColWidth + 24, y + 28);

        doc.setFontSize(10);
        doc.setFont(undefined, "normal");
        const lines = [];
        if (Array.isArray(data.defects) && data.defects.length > 0) {
          data.defects.forEach((d) => {
            const conf = extractConfidence(d);
            lines.push(`${d.defect_name || "Unknown"}${conf ? ` (${conf})` : ""}`);
          });
        } else {
          lines.push("No defects detected on this image.");
        }

        const wrapped = doc.splitTextToSize(lines.join("\n"), defectColWidth - 12);
        doc.text(wrapped, margin + imageColWidth + 24, y + 48);

        y += rowHeight + 16;
      }

      doc.save(`blade-defect-report-${Date.now()}.pdf`);
    } catch (err) {
      console.log(err);
      alert("Couldn't generate the report. Check the console for details.");
    } finally {
      setGeneratingReport(false);
    }
  }

  async function markImage(name, decision) {
    const pred = predictions[name];
    if (!pred?.data) return;

    setMarkingState((prev) => ({ ...prev, [name]: "loading" }));

    try {
      const res = await fetch(`${API}/mark-image-status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: name,
          decision,
          result_filename: pred.data.result_filename || null,
          defect_names: (pred.data.defects || []).map((d) => d.defect_name),
          defect_count: pred.data.defect_count || 0,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to mark image");

      setMarkingState((prev) => ({ ...prev, [name]: data.status || decision }));
    } catch (err) {
      console.error(err);
      setMarkingState((prev) => ({ ...prev, [name]: "error" }));
    }
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

        <button
          className="reportBtn"
          onClick={generateReport}
          disabled={images.length === 0 || generatingReport}
        >
          <FiFileText />
          {generatingReport ? "Generating…" : "Make Report"}
        </button>
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
                    <div className="reviewActions">
                      <button
                        className="markBtn clear"
                        onClick={() => markImage(name, "clear")}
                        disabled={markingState[name] === "loading"}
                      >
                        {markingState[name] === "loading" ? "Processing…" : "Clear"}
                      </button>
                      <button
                        className="markBtn defect"
                        onClick={() => markImage(name, "defective")}
                        disabled={markingState[name] === "loading"}
                      >
                        {markingState[name] === "loading" ? "Processing…" : "Defective"}
                      </button>
                      <button
                        className="markBtn retrain"
                        onClick={() => markImage(name, "retrain")}
                        disabled={markingState[name] === "loading"}
                      >
                        {markingState[name] === "loading" ? "Processing…" : "Retrain"}
                      </button>
                    </div>

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