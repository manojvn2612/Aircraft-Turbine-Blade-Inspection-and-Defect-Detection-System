import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, RefreshCw, CheckCircle2, XCircle, Loader2,
  Clock, AlertTriangle, ChevronDown, ChevronUp, Trash2,
  Settings2, Tag, Play, Square,
  ExternalLink, Server,
  ShieldX, RotateCcw, Zap,
  StopCircle, Activity, Copy, Check, AlertCircle,
  BookOpen, ArrowRight, FileUp,
  PackageOpen, FileText, Hash, Link2, BarChart3,
  Bug, Database, Timer,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LabelStat {
  total: number;
  with_labels: number;
  without_labels: number;
}

interface RetrainStats {
  defective:   number;
  retrain:     number;
  total:       number;
  staging:     number;
  history:     { filename: string; label: string; time: string; source?: string }[];
  label_stats: {
    defective: LabelStat;
    retrain:   LabelStat;
  };
}

// CHANGE 1: added patience to config
interface RetrainConfig {
  epochs:     number;
  batch_size: number;
  lr:         number;
  patience:   number;   // ← NEW
}

type TrainStatus  = "idle" | "starting" | "training" | "done" | "error" | "stopped";
type ServerStatus = "checking" | "running" | "stopped" | "starting";

// CHANGE 2: added early stopping fields to TrainProgress
interface TrainProgress {
  status:           string;
  epoch:            number;
  total_epochs:     number;
  train_loss:       number | null;
  val_loss:         number | null;
  best_val:         number | null;
  message:          string;
  history:          { epoch: number; train_loss: number; val_loss: number }[];
  process_running:  boolean;
  retrain_used?:    number;
  defective_used?:  number;
  // ── NEW early-stopping fields ──────────────────────────────────────────
  patience_counter?: number;   // how many epochs since last improvement
  patience_limit?:   number;   // PATIENCE env var value (sent by backend)
  early_stopped?:    boolean;  // true when ES fired (not manual stop)
  stopped_epoch?:    number;   // epoch at which ES fired
}

interface ZipExtractResult {
  images_found:     number;
  labels_found:     number;
  matched:          number;
  unmatched_images: string[];
  unmatched_labels: string[];
  preview:          { filename: string; label_count: number }[];
}

interface DebugAuditEntry {
  image:         string;
  label_path:    string;
  label_exists:  boolean;
  label_size:    number;
  polygon_count: number;
  trainable:     boolean;
}

interface DebugAudit {
  total_annotated_for_training: number;
  defective: DebugAuditEntry[];
  retrain:   DebugAuditEntry[];
}

const API = "http://localhost:5000";

const DEFECT_CLASSES = [
  { id: 0, name: "Cutter marks and fish marks", color: "#EF4444" },
  { id: 1, name: "Scratches and Black spots",   color: "#F97316" },
  { id: 2, name: "Fingerprints and stains",     color: "#EAB308" },
  { id: 3, name: "Ink marks",                   color: "#22C55E" },
  { id: 4, name: "Jig Marks",                   color: "#06B6D4" },
  { id: 5, name: "Machining Marks",             color: "#3B82F6" },
  { id: 6, name: "Overcut",                     color: "#8B5CF6" },
  { id: 7, name: "Pocket",                      color: "#EC4899" },
];

const LS_LABEL_CONFIG = `<View>
  <Header value="Select label and click the image to start"/>
  <Image name="image" value="$image" zoom="true"/>

  <PolygonLabels name="label" toName="image" strokeWidth="3" pointSize="small" opacity="0.9">
    <Label value="Cutter marks and fish marks" background="#EF4444"/>
    <Label value="Scratches and Black spots"   background="#F97316"/>
    <Label value="Fingerprints and stains"     background="#EAB308"/>
    <Label value="Ink marks"                   background="#22C55E"/>
    <Label value="Jig Marks"                   background="#06B6D4"/>
    <Label value="Machining Marks"             background="#3B82F6"/>
    <Label value="Overcut"                     background="#8B5CF6"/>
    <Label value="Pocket"                      background="#EC4899"/>
  </PolygonLabels>
</View>`;

const TABS = [
  { id: "overview",  label: "Overview",    icon: BarChart3   },
  { id: "annotate",  label: "Annotate",    icon: Tag         },
  { id: "import",    label: "Import Data", icon: PackageOpen },
  { id: "train",     label: "Train Model", icon: Play        },
] as const;

type TabId = typeof TABS[number]["id"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMissingBoxes(stats: RetrainStats | null) {
  if (!stats?.label_stats) return 0;
  return (stats.label_stats.defective?.without_labels ?? 0)
       + (stats.label_stats.retrain?.without_labels   ?? 0);
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied!" : (label ?? "Copy")}
    </button>
  );
}

function Step({ n, title, children, last }: { n: number; title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
          {n}
        </div>
        {!last && <div className="flex-1 w-px bg-slate-200 mt-2" />}
      </div>
      <div className={`${last ? "pb-0" : "pb-6"} flex-1`}>
        <p className="text-sm font-semibold text-slate-800 mb-1">{title}</p>
        <div className="text-sm text-slate-500 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function LossSparkline({ history }: { history: { epoch: number; train_loss: number; val_loss: number }[] }) {
  const recent = history.slice(-30);
  const allVals = recent.flatMap(h => [h.train_loss, h.val_loss]).filter(v => v != null && isFinite(v));
  if (!allVals.length) return null;
  const minV = Math.min(...allVals), maxV = Math.max(...allVals);
  const range = maxV - minV || 1;
  const W = 480, H = 56, pad = 4;
  const toX = (i: number) => pad + (i / (recent.length - 1)) * (W - 2 * pad);
  const toY = (v: number) => H - pad - ((v - minV) / range) * (H - 2 * pad);
  const makePath = (key: "train_loss" | "val_loss") =>
    recent.filter(h => isFinite(h[key]))
      .map((h, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(h[key]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
      <path d={makePath("train_loss")} fill="none" stroke="#6366F1" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={makePath("val_loss")}   fill="none" stroke="#F97316" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 2" />
    </svg>
  );
}

// ─── CHANGE 3: PatienceBar — visual patience countdown shown during training ──
// Shows a row of dots: filled = epochs used up, empty = remaining patience.
// Green when reset, amber as it fills up, red when close to stopping.
function PatienceBar({
  counter,
  limit,
}: {
  counter: number;
  limit: number;
}) {
  if (!limit) return null;
  const pct     = counter / limit;
  const color   = pct === 0 ? "bg-emerald-500"
                : pct < 0.5 ? "bg-amber-400"
                : pct < 0.8 ? "bg-orange-500"
                : "bg-red-500";
  const textCol = pct === 0 ? "text-emerald-600"
                : pct < 0.5 ? "text-amber-600"
                : pct < 0.8 ? "text-orange-600"
                : "text-red-600";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-slate-500 font-medium">
          <Timer className="w-3.5 h-3.5" />
          Early stop patience
        </span>
        <span className={`font-mono font-semibold ${textCol}`}>
          {counter} / {limit}
          {counter === 0 && " — improved ✓"}
          {counter >= limit && " — stopping"}
        </span>
      </div>
      {/* Dot grid — each dot = 1 patience epoch */}
      <div className="flex gap-1 flex-wrap">
        {Array.from({ length: limit }).map((_, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-sm transition-colors duration-300 ${
              i < counter ? color : "bg-slate-200"
            }`}
          />
        ))}
      </div>
      {counter > 0 && counter < limit && (
        <p className="text-xs text-slate-400">
          {limit - counter} more epoch{limit - counter !== 1 ? "s" : ""} without improvement will trigger early stop
        </p>
      )}
    </div>
  );
}

// ─── Training Requirements Checklist ─────────────────────────────────────────

function TrainingRequirements({ stats, statsLoading, onGoToAnnotate, onGoToImport }: {
  stats: RetrainStats | null;
  statsLoading: boolean;
  onGoToAnnotate: () => void;
  onGoToImport: () => void;
}) {
  const defectiveWithLabels = stats?.label_stats?.defective?.with_labels ?? 0;
  const retrainWithLabels   = stats?.label_stats?.retrain?.with_labels   ?? 0;
  const totalAnnotated      = defectiveWithLabels + retrainWithLabels;
  const missingLabels       = getMissingBoxes(stats);
  // CHANGE 4: totalImages now sums both dirs (no approved dir)
  const totalImages         = (stats?.defective ?? 0) + (stats?.retrain ?? 0);

  const checks = [
    {
      id: "has_images",
      label: "At least 1 image in training queue",
      detail: totalImages > 0
        ? `${totalImages} image${totalImages !== 1 ? "s" : ""} found (defective + corrections)`
        : "No images found — import a YOLO zip in Import Data",
      ok: totalImages > 0,
      action: totalImages === 0 ? { label: "Import Data", fn: onGoToImport } : null,
    },
    {
      id: "has_labels",
      label: "All images have defect polygon annotations",
      detail: missingLabels > 0
        ? `${missingLabels} image${missingLabels !== 1 ? "s" : ""} missing polygon labels — annotate in Label Studio and re-import`
        : totalAnnotated > 0
        ? `${totalAnnotated} image${totalAnnotated !== 1 ? "s" : ""} fully annotated ✓`
        : totalImages > 0
        ? "Images found but none have polygon labels yet"
        : "No images to check",
      ok: totalImages > 0 && missingLabels === 0 && totalAnnotated > 0,
      action: missingLabels > 0 ? { label: "Annotate", fn: onGoToAnnotate } : null,
    },
    {
      id: "label_format",
      label: "Labels are in YOLO polygon format (.txt)",
      detail: "Each .txt label file must contain at least one polygon line: class_id x1 y1 x2 y2 … (≥3 points). Empty label files are skipped. Export from Label Studio as YOLO format (with images) to get the correct format.",
      ok: totalAnnotated > 0,
      action: totalAnnotated === 0 && totalImages > 0 ? { label: "Import YOLO zip", fn: onGoToImport } : null,
    },
  ];

  const allOk = checks.every(c => c.ok);

  if (statsLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-3 text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Checking training requirements…</span>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${allOk ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <div className={`px-5 py-3 border-b flex items-center gap-2 ${allOk ? "border-emerald-200 bg-emerald-100/50" : "border-amber-200 bg-amber-100/50"}`}>
        <Database className={`w-4 h-4 ${allOk ? "text-emerald-600" : "text-amber-600"}`} />
        <p className={`text-sm font-bold ${allOk ? "text-emerald-800" : "text-amber-800"}`}>
          {allOk ? "All requirements met — ready to train" : "Training requirements not met"}
        </p>
      </div>
      <div className="divide-y divide-amber-100/60">
        {checks.map(check => (
          <div key={check.id} className="px-5 py-3.5 flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              {check.ok
                ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                : <XCircle className="w-4 h-4 text-red-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${check.ok ? "text-emerald-800" : "text-red-800"}`}>
                {check.label}
              </p>
              <p className={`text-xs mt-0.5 leading-relaxed ${check.ok ? "text-emerald-600" : "text-red-600"}`}>
                {check.detail}
              </p>
            </div>
            {check.action && (
              <button
                onClick={check.action.fn}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors"
              >
                {check.action.label} <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Debug Audit Panel ────────────────────────────────────────────────────────

function DebugAuditPanel() {
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [data,    setData]    = useState<DebugAudit | null>(null);
  const [err,     setErr]     = useState<string | null>(null);

  const fetchAudit = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await axios.get<DebugAudit>(`${API}/retrain-debug`);
      setData(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Failed to fetch debug info");
    } finally { setLoading(false); }
  };

  const toggle = () => {
    if (!open && !data) fetchAudit();
    setOpen(v => !v);
  };

  const allEntries = [...(data?.defective ?? []), ...(data?.retrain ?? [])];

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
        onClick={toggle}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          <Bug className="w-4 h-4 text-slate-400" />
          Diagnose: image/label audit
          {data && (
            <span className={`text-xs font-normal px-2 py-0.5 rounded-full border ${
              data.total_annotated_for_training > 0
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-red-50 text-red-700 border-red-200"
            }`}>
              {data.total_annotated_for_training} trainable
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); fetchAudit(); }}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? "animate-spin" : ""}`} />
          </button>
          {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100">
          {loading && (
            <div className="px-5 py-4 flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Auditing files…
            </div>
          )}
          {err && (
            <div className="px-5 py-4 text-sm text-red-600 bg-red-50">{err}</div>
          )}
          {data && !loading && (
            <div className="px-5 py-4 flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-50 border border-slate-200 rounded-lg py-3">
                  <p className="text-2xl font-bold text-slate-700 font-mono">{allEntries.length}</p>
                  <p className="text-xs text-slate-400 mt-0.5">total images</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg py-3">
                  <p className="text-2xl font-bold text-emerald-700 font-mono">{data.total_annotated_for_training}</p>
                  <p className="text-xs text-emerald-500 mt-0.5">trainable (label ≥ 1 byte)</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg py-3">
                  <p className="text-2xl font-bold text-red-700 font-mono">{allEntries.length - data.total_annotated_for_training}</p>
                  <p className="text-xs text-red-400 mt-0.5">missing / empty label</p>
                </div>
              </div>

              {allEntries.length > 0 && (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-3 py-2 font-semibold text-slate-500">Image</th>
                        <th className="text-center px-3 py-2 font-semibold text-slate-500">Label exists</th>
                        <th className="text-center px-3 py-2 font-semibold text-slate-500">Size (bytes)</th>
                        <th className="text-center px-3 py-2 font-semibold text-slate-500">Polygons</th>
                        <th className="text-center px-3 py-2 font-semibold text-slate-500">Trainable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allEntries.map((entry, i) => (
                        <tr key={i} className={entry.trainable ? "bg-white" : "bg-red-50"}>
                          <td className="px-3 py-2 font-mono text-slate-600 truncate max-w-[200px]">{entry.image}</td>
                          <td className="px-3 py-2 text-center">
                            {entry.label_exists
                              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 inline" />
                              : <XCircle     className="w-3.5 h-3.5 text-red-500 inline" />}
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-slate-500">{entry.label_size}</td>
                          <td className="px-3 py-2 text-center font-mono text-slate-500">{entry.polygon_count}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded-full font-semibold text-xs border ${
                              entry.trainable
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-red-50 text-red-700 border-red-200"
                            }`}>
                              {entry.trainable ? "Yes" : entry.label_exists ? "Empty label" : "No label"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {allEntries.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">
                  No images found in defective or retrain directories.
                </p>
              )}

              <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <strong className="text-slate-600">How the gate works:</strong> Training starts only when at least 1 image
                has a matching <code className="font-mono bg-slate-100 px-1 rounded">.txt</code> label file with size &gt; 0 bytes
                (i.e., at least one polygon line). Images with missing or empty label files are skipped.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RetrainPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("overview");

  const [stats,        setStats]        = useState<RetrainStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [trainStatus,   setTrainStatus]   = useState<TrainStatus>("idle");
  const [trainProgress, setTrainProgress] = useState<TrainProgress | null>(null);
  const [trainMsg,      setTrainMsg]      = useState("");
  const [showConfig,    setShowConfig]    = useState(false);
  const [showHistory,   setShowHistory]   = useState(false);
  const [clearConfirm,  setClearConfirm]  = useState(false);
  const [clearLoading,  setClearLoading]  = useState(false);
  const [stopLoading,   setStopLoading]   = useState(false);
  const [showLsConfig,  setShowLsConfig]  = useState(false);

  // CHANGE 5: patience added to default config
  const [config, setConfig] = useState<RetrainConfig>({
    epochs:     50,
    batch_size: 4,
    lr:         0.0003,
    patience:   10,   // ← NEW
  });

  const progressPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Annotate tab ──────────────────────────────────────────────────────────
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");
  const [serverUrl,    setServerUrl]    = useState("http://localhost:8080");
  const [serverMsg,    setServerMsg]    = useState("");
  const [syncLoading,  setSyncLoading]  = useState(false);
  const [syncMsg,      setSyncMsg]      = useState<{ text: string; ok: boolean } | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Import tab ────────────────────────────────────────────────────────────
  const zipInputRef    = useRef<HTMLInputElement>(null);
  const [zipLoading,    setZipLoading]    = useState(false);
  const [zipResult,     setZipResult]     = useState<ZipExtractResult | null>(null);
  const [zipMsg,        setZipMsg]        = useState<{ text: string; ok: boolean } | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const missingBoxes   = getMissingBoxes(stats);
  const totalTrainable = (stats?.label_stats?.defective?.with_labels ?? 0)
                       + (stats?.label_stats?.retrain?.with_labels   ?? 0);
  const progressPct    = trainProgress && trainProgress.total_epochs > 0
    ? Math.round((trainProgress.epoch / trainProgress.total_epochs) * 100) : 0;

  const canTrain = totalTrainable > 0
    && missingBoxes === 0
    && trainStatus !== "training"
    && trainStatus !== "starting";

  // ── Fetchers ──────────────────────────────────────────────────────────────
  const fetchStats = async () => {
    try {
      const r = await axios.get<RetrainStats>(`${API}/retrain-stats`);
      setStats(r.data);
    } catch { /* ignore */ }
    finally { setStatsLoading(false); }
  };

  // ── Label Studio ──────────────────────────────────────────────────────────
  const checkServer = async () => {
    try {
      const r = await axios.get<{ status: string; url: string }>(`${API}/annotation-server/status`);
      setServerStatus(r.data.status as ServerStatus);
      setServerUrl(r.data.url);
      if (r.data.status === "running" && statusPollRef.current) {
        clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
    } catch { setServerStatus("stopped"); }
  };

  const handleStartServer = async () => {
    setServerStatus("starting");
    setServerMsg("");
    try {
      const r = await axios.post<{ status: string; url: string; note?: string }>(`${API}/annotation-server/start`);
      setServerStatus(r.data.status as ServerStatus);
      setServerUrl(r.data.url);
      if (r.data.note) setServerMsg(r.data.note);
      if (r.data.status === "starting") {
        if (statusPollRef.current) clearInterval(statusPollRef.current);
        statusPollRef.current = setInterval(async () => {
          try {
            const s = await axios.get<{ status: string; url: string }>(`${API}/annotation-server/status`);
            setServerStatus(s.data.status as ServerStatus);
            if (s.data.status === "running") {
              if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
              setServerMsg("Label Studio is ready — open it and draw polygons around defects.");
            }
          } catch { /* ignore */ }
        }, 3000);
      }
    } catch (err: any) {
      setServerStatus("stopped");
      setServerMsg(err?.response?.data?.error || "Failed to start.");
    }
  };

  const handleStopServer = async () => {
    if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
    try { await axios.post(`${API}/annotation-server/stop`); setServerStatus("stopped"); setServerMsg(""); }
    catch { /* ignore */ }
  };

  const handleSync = async () => {
    setSyncLoading(true); setSyncMsg(null);
    try {
      const r = await axios.post<{ message?: string; error?: string }>(`${API}/annotation-server/sync`);
      setSyncMsg(r.data.error
        ? { text: r.data.error, ok: false }
        : { text: r.data.message || "Sync triggered.", ok: true });
    } catch (err: any) {
      setSyncMsg({ text: err?.response?.data?.error || "Sync failed.", ok: false });
    } finally { setSyncLoading(false); }
  };

  // ── ZIP upload ────────────────────────────────────────────────────────────
  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setZipLoading(true); setZipMsg(null); setZipResult(null);
    const fd = new FormData();
    fd.append("zip", file);
    try {
      const r = await axios.post<ZipExtractResult>(`${API}/import-yolo-zip`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setZipResult(r.data);
      setZipMsg({
        text: `Extracted ${r.data.images_found} images and ${r.data.labels_found} label files — ${r.data.matched} matched pairs ready for training.`,
        ok: true,
      });
      fetchStats();
    } catch (err: any) {
      setZipMsg({ text: `Import failed: ${err?.response?.data?.error ?? "Unknown error"}`, ok: false });
    } finally {
      setZipLoading(false);
      if (zipInputRef.current) zipInputRef.current.value = "";
    }
  };

  // ── Training ──────────────────────────────────────────────────────────────
  const pollTrainProgress = async () => {
    try {
      const r = await axios.get<TrainProgress>(`${API}/retrain-progress`);
      const data = r.data;
      setTrainProgress(data);

      if (data.status === "done") {
        setTrainStatus("done");
        setTrainMsg(data.message || "Retraining complete.");
        _stopProgressPoll();
        fetchStats();
      } else if (data.status === "error") {
        setTrainStatus("error");
        setTrainMsg(data.message || "Retraining failed.");
        _stopProgressPoll();
      } else if (data.status === "stopped") {
        setTrainStatus("stopped");
        setTrainMsg(data.message || "Training was stopped.");
        _stopProgressPoll();
      } else if (data.status === "training" || data.process_running) {
        setTrainStatus("training");
      } else if (!data.process_running && data.status === "idle") {
        setTrainStatus("idle");
        setTrainMsg("");
        setTrainProgress(null);
        _stopProgressPoll();
      }
    } catch { /* ignore */ }
  };

  const _stopProgressPoll = () => {
    if (progressPollRef.current) { clearInterval(progressPollRef.current); progressPollRef.current = null; }
  };
  const _startProgressPoll = () => {
    _stopProgressPoll();
    progressPollRef.current = setInterval(pollTrainProgress, 3000);
  };

  // CHANGE 6: patience is now sent to backend in the config payload
  const handleTrain = async () => {
    setTrainStatus("starting");
    setTrainMsg("");
    setTrainProgress(null);
    try {
      await axios.post(`${API}/retrain`, config);   // config now includes patience
      setTrainStatus("training");
      _startProgressPoll();
    } catch (err: any) {
      setTrainStatus("error");
      const msg = err?.response?.data?.error || "Failed to start training.";
      setTrainMsg(msg);
    }
  };

  const handleStopTraining = async () => {
    setStopLoading(true);
    try {
      await axios.post(`${API}/retrain-stop`);
      setTrainMsg("Stop signal sent — waiting for process to exit…");
      _startProgressPoll();
    } catch (err: any) {
      setTrainMsg(err?.response?.data?.error || "Failed to send stop signal.");
    } finally { setStopLoading(false); }
  };

  const handleClear = async () => {
    if (!clearConfirm) { setClearConfirm(true); return; }
    setClearLoading(true); setClearConfirm(false);
    try {
      await axios.post(`${API}/retrain-clear`);
      fetchStats();
      setTrainStatus("idle"); setTrainMsg(""); setTrainProgress(null);
      setZipResult(null); setZipMsg(null);
    } catch { /* ignore */ }
    finally { setClearLoading(false); }
  };

  useEffect(() => {
    fetchStats();
    checkServer();
    (async () => {
      try {
        const r = await axios.get<TrainProgress>(`${API}/retrain-progress`);
        const data = r.data;
        if (data.process_running || data.status === "training") {
          setTrainStatus("training");
          setTrainProgress(data);
          _startProgressPoll();
        } else if (data.status === "done") {
          setTrainStatus("done");
          setTrainMsg(data.message || "Training complete.");
          setTrainProgress(data);
        } else if (data.status === "stopped") {
          setTrainStatus("stopped");
          setTrainMsg(data.message || "Training was stopped.");
          setTrainProgress(data);
        } else if (data.status === "error") {
          setTrainStatus("error");
          setTrainMsg(data.message || "Training encountered an error.");
          setTrainProgress(data);
        }
      } catch { /* idle */ }
    })();

    const si = setInterval(fetchStats, 10_000);
    const ss = setInterval(checkServer, 15_000);
    return () => {
      clearInterval(si); clearInterval(ss);
      if (statusPollRef.current) clearInterval(statusPollRef.current);
      _stopProgressPoll();
    };
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* ── Top bar ── */}
      <div className="bg-slate-900 text-white px-8 py-4 flex items-center gap-4 sticky top-0 z-20">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="w-px h-5 bg-slate-700" />
        <h1 className="font-semibold text-sm tracking-wide">Model Improvement</h1>
        {(trainStatus === "training" || trainStatus === "starting") && (
          <div className="ml-auto flex items-center gap-2 text-xs text-amber-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {trainStatus === "starting"
              ? "Starting…"
              : `Training — epoch ${trainProgress?.epoch ?? 0} / ${trainProgress?.total_epochs ?? config.epochs}`}
            {/* CHANGE 7: patience counter in top bar */}
            {trainProgress?.patience_counter !== undefined && trainProgress?.patience_limit && (
              <span className="text-amber-300/70 font-mono">
                · patience {trainProgress.patience_counter}/{trainProgress.patience_limit}
              </span>
            )}
            <button onClick={() => setTab("train")} className="underline hover:text-amber-200">View →</button>
          </div>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div className="bg-white border-b border-slate-200 px-6 sticky top-[56px] z-10">
        <div className="max-w-4xl mx-auto flex gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                tab === id
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
              {id === "annotate" && missingBoxes > 0 && (
                <span className="ml-1 text-xs bg-red-100 text-red-700 border border-red-200 rounded-full px-1.5 py-0.5 font-semibold">
                  {missingBoxes}
                </span>
              )}
              {id === "import" && zipResult && (
                <span className="ml-1 text-xs bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-1.5 py-0.5 font-semibold">
                  {zipResult.matched}
                </span>
              )}
              {id === "train" && (trainStatus === "training" || trainStatus === "starting") && (
                <span className="ml-1 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* ════════════════════════════════════════════════════ OVERVIEW */}
        {tab === "overview" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Model Improvement Overview</h2>
              <p className="text-sm text-slate-500 mt-1">
                Improve the model by annotating blade images with defect polygons in Label Studio,
                exporting as a YOLO zip, and retraining.
              </p>
            </div>

            {/* Flow cards */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-5">
              <p className="text-sm font-bold text-indigo-800 mb-4 flex items-center gap-2">
                <BookOpen className="w-4 h-4" /> How model improvement works
              </p>
              <div className="grid grid-cols-3 gap-4">
                {([
                  { n: 1, tab: "annotate" as TabId, title: "Annotate in Label Studio",
                    body:  "Start Label Studio, draw polygons around every defect, then export as YOLO format zip." },
                  { n: 2, tab: "import"  as TabId, title: "Import YOLO zip",
                    body:  "Upload the exported zip. Images and labels are extracted and matched automatically." },
                  { n: 3, tab: "train"   as TabId, title: "Train the model",
                    body:  "Fine-tune the model on your annotated data. Early stopping prevents over-fitting automatically." },
                ] as const).map(({ n, title, body, tab: t }) => (
                  <button key={n} onClick={() => setTab(t)}
                    className="text-left bg-white border border-indigo-200 rounded-xl px-4 py-4 hover:border-indigo-400 hover:shadow-sm transition-all">
                    <div className="w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center mb-3">{n}</div>
                    <p className="text-sm font-semibold text-indigo-800 mb-1">{title}</p>
                    <p className="text-xs text-indigo-600 leading-relaxed">{body}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Stats — CHANGE 8: removed "approved" row, now only defective + retrain */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-start gap-3">
                <ShieldX className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-2xl font-bold text-red-700">{statsLoading ? "…" : stats?.defective ?? 0}</p>
                  <p className="text-sm font-semibold text-red-700">Defective images</p>
                  <p className="text-xs text-red-500 mt-0.5">
                    With labels: {stats?.label_stats?.defective?.with_labels ?? 0} / {stats?.defective ?? 0}
                  </p>
                </div>
              </div>
              <div className="bg-violet-50 border border-violet-200 rounded-xl px-5 py-4 flex items-start gap-3">
                <RotateCcw className="w-6 h-6 text-violet-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-2xl font-bold text-violet-700">{statsLoading ? "…" : stats?.retrain ?? 0}</p>
                  <p className="text-sm font-semibold text-violet-700">Model corrections</p>
                  <p className="text-xs text-violet-500 mt-0.5">
                    With labels: {stats?.label_stats?.retrain?.with_labels ?? 0} / {stats?.retrain ?? 0}
                  </p>
                </div>
              </div>
            </div>

            {missingBoxes > 0 && (
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-amber-800">
                    {missingBoxes} image{missingBoxes !== 1 ? "s" : ""} still need defect polygons
                  </p>
                  <p className="text-sm text-amber-700 mt-0.5">Without annotations the model won't learn where defects are.</p>
                </div>
                <button onClick={() => setTab("annotate")}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors">
                  Annotate <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {(stats?.history?.length ?? 0) > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
                  onClick={() => setShowHistory(v => !v)}>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Clock className="w-4 h-4 text-slate-400" /> Recent activity
                    <span className="text-xs font-normal text-slate-400">(last {stats?.history?.length})</span>
                  </div>
                  {showHistory ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {showHistory && (
                  <div className="border-t border-slate-100 divide-y divide-slate-100 max-h-56 overflow-y-auto">
                    {[...(stats?.history ?? [])].reverse().map((e, i) => (
                      <div key={i} className="flex items-center justify-between px-5 py-3">
                        <div className="flex items-center gap-3">
                          {e.label === "defective" && <ShieldX   className="w-4 h-4 text-red-500 shrink-0" />}
                          {e.label === "retrain"   && <RotateCcw className="w-4 h-4 text-violet-500 shrink-0" />}
                          <span className="text-sm text-slate-700 truncate max-w-xs">{e.filename}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                            e.label === "defective"
                              ? "bg-red-50 text-red-700 border-red-200"
                              : "bg-violet-50 text-violet-700 border-violet-200"
                          }`}>
                            {e.label === "defective" ? "Defective" : "Correction"}
                          </span>
                          <span className="text-xs text-slate-400">{new Date(e.time).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(stats?.total ?? 0) > 0 && (
              <div className="border border-red-200 rounded-xl px-5 py-4 bg-red-50">
                <p className="text-sm font-semibold text-red-700 mb-1 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Danger zone
                </p>
                <p className="text-xs text-red-600 mb-3">
                  Permanently deletes all {stats?.total} labeled images and annotations.
                </p>
                <button onClick={handleClear}
                  disabled={clearLoading || trainStatus === "training"}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors">
                  {clearLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {clearConfirm ? "Click again to confirm delete" : "Clear all data"}
                </button>
                {trainStatus === "training" && (
                  <p className="text-xs text-red-500 mt-2">Stop training before clearing data.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════ ANNOTATE */}
        {tab === "annotate" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Annotate in Label Studio</h2>
              <p className="text-sm text-slate-500 mt-1">
                Start Label Studio, import your blade images, draw polygons around every defect,
                then export as <strong>YOLO format (with images)</strong> and upload the zip in Import Data.
              </p>
            </div>

            {missingBoxes > 0 && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-800">
                    {missingBoxes} image{missingBoxes !== 1 ? "s" : ""} still need polygons
                  </p>
                  <p className="text-sm text-red-700 mt-0.5">
                    Annotate in Label Studio, export as YOLO with images, then upload the zip in Import Data.
                  </p>
                </div>
              </div>
            )}

            {missingBoxes === 0 && totalTrainable > 0 && (
              <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-emerald-800">All images annotated — ready to train!</p>
                  <p className="text-sm text-emerald-700 mt-0.5">Go to Train Model to start.</p>
                </div>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl px-6 py-5">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    serverStatus === "running"  ? "bg-emerald-100" :
                    serverStatus === "starting" ? "bg-amber-100"   : "bg-slate-100"
                  }`}>
                    <Server className={`w-5 h-5 ${
                      serverStatus === "running"  ? "text-emerald-600" :
                      serverStatus === "starting" ? "text-amber-500"   : "text-slate-400"
                    }`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Label Studio</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`w-2 h-2 rounded-full ${
                        serverStatus === "running"  ? "bg-emerald-500 animate-pulse" :
                        serverStatus === "starting" ? "bg-amber-400 animate-pulse"   : "bg-slate-300"
                      }`} />
                      <span className="text-xs text-slate-500 capitalize">{serverStatus}</span>
                      {serverStatus === "running" && (
                        <a href={serverUrl} target="_blank" rel="noreferrer"
                          className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5">
                          {serverUrl} <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    {serverStatus === "starting" && (
                      <p className="text-xs text-amber-600 mt-1">Starting up — takes 15–60 seconds…</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {(serverStatus === "stopped" || serverStatus === "checking") && (
                    <button onClick={handleStartServer}
                      className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors">
                      <Play className="w-4 h-4" /> Start Label Studio
                    </button>
                  )}
                  {serverStatus === "starting" && (
                    <button disabled
                      className="flex items-center gap-2 px-5 py-2.5 bg-amber-100 text-amber-700 rounded-lg text-sm font-semibold cursor-not-allowed">
                      <Loader2 className="w-4 h-4 animate-spin" /> Starting…
                    </button>
                  )}
                  {serverStatus === "running" && (
                    <>
                      <a href={serverUrl} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                        <ExternalLink className="w-4 h-4" /> Open Label Studio
                      </a>
                      <button onClick={handleSync} disabled={syncLoading}
                        className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50">
                        {syncLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Sync images
                      </button>
                      <button onClick={handleStopServer}
                        className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-200 transition-colors">
                        <Square className="w-4 h-4" /> Stop
                      </button>
                    </>
                  )}
                  <button onClick={checkServer} className="p-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors">
                    <RefreshCw className="w-4 h-4 text-slate-500" />
                  </button>
                </div>
              </div>
              {serverMsg && (
                <p className="mt-3 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">{serverMsg}</p>
              )}
              {syncMsg && (
                <p className={`mt-3 text-xs rounded-lg px-3 py-2 border ${
                  syncMsg.ok ? "text-indigo-700 bg-indigo-50 border-indigo-200" : "text-red-700 bg-red-50 border-red-200"
                }`}>{syncMsg.text}</p>
              )}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-start gap-3">
              <FileUp className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">After annotating — export and import</p>
                <p className="text-sm text-amber-700 mt-0.5">
                  In Label Studio click <strong>Export → YOLO format (with images)</strong> to download a zip.
                  Then go to{" "}
                  <button className="underline font-semibold" onClick={() => setTab("import")}>Import Data</button>
                  {" "}to upload it here.
                </p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
                onClick={() => setShowLsConfig(v => !v)}
              >
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-slate-400" /> First time Label Studio setup
                </p>
                {showLsConfig ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>
              {showLsConfig && (
                <div className="border-t border-slate-100 px-5 py-5 flex flex-col gap-5">
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">Step-by-step</p>
                    <Step n={1} title="Open Label Studio and log in">
                      Email: <code className="bg-slate-100 px-1 rounded text-xs font-mono">admin@blade.local</code>
                      {" · "}
                      Password: <code className="bg-slate-100 px-1 rounded text-xs font-mono">bladeinspect123</code>
                    </Step>
                    <Step n={2} title="Create a new project">
                      Click <strong>Create Project</strong>, name it "Blade Defects", then go to <strong>Labeling Setup</strong>.
                    </Step>
                    <Step n={3} title='Select "Object Detection with Bounding Boxes"'>
                      In Labeling Setup choose <strong>Computer Vision → Object Detection with Bounding Boxes</strong>.
                    </Step>
                    <Step n={4} title="Paste the label configuration">
                      Click <strong>Code</strong> (top right), replace everything with the config below, click Save.
                    </Step>
                    <Step n={5} title="Import your images">
                      Go to <strong>Import</strong> and upload blade images, or use <strong>Sync images</strong> above.
                    </Step>
                    <Step n={6} title="Draw polygons on each image">
                      Click a task, pick a defect type, draw a polygon around it, click <strong>Submit</strong>.
                    </Step>
                    <Step n={7} title="Export as YOLO with images" last>
                      Click <strong>Export → YOLO format (with images)</strong>. Upload the zip in <strong>Import Data</strong>.
                    </Step>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Label configuration</p>
                      <CopyButton text={LS_LABEL_CONFIG} label="Copy config" />
                    </div>
                    <pre className="bg-slate-900 text-slate-200 text-xs rounded-xl p-4 overflow-x-auto leading-relaxed font-mono whitespace-pre">
{LS_LABEL_CONFIG}
                    </pre>
                  </div>

                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Defect class reference</p>
                    <div className="grid grid-cols-2 gap-2">
                      {DEFECT_CLASSES.map(cls => (
                        <div key={cls.id} className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                          <span className="w-3.5 h-3.5 rounded shrink-0" style={{ backgroundColor: cls.color }} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-700 truncate">{cls.name}</p>
                            <p className="text-xs text-slate-400">Class ID: {cls.id}</p>
                          </div>
                          <CopyButton text={cls.name} label="Copy" />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-3 text-xs text-slate-500">
                    <Server className="w-4 h-4 shrink-0 text-slate-400" />
                    <span>Not installed?</span>
                    <div className="flex items-center gap-2">
                      <code className="bg-slate-900 text-emerald-400 px-2 py-0.5 rounded font-mono">pip install label-studio</code>
                      <CopyButton text="pip install label-studio" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════ IMPORT DATA */}
        {tab === "import" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Import YOLO Zip</h2>
              <p className="text-sm text-slate-500 mt-1">
                Upload the zip exported from Label Studio (<strong>Export → YOLO format with images</strong>).
                Images and label files are extracted, matched, and queued for training automatically.
              </p>
            </div>

            <label className={`flex flex-col items-center justify-center gap-3 w-full h-44 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
              zipLoading
                ? "border-indigo-300 bg-indigo-50 cursor-not-allowed"
                : "border-slate-300 bg-white hover:bg-slate-50 hover:border-indigo-300"
            }`}>
              {zipLoading
                ? <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                : <PackageOpen className="w-8 h-8 text-slate-400" />}
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-600">
                  {zipLoading ? "Extracting zip…" : "Click to upload YOLO zip"}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  .zip exported from Label Studio — contains images + .txt label files
                </p>
              </div>
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                disabled={zipLoading}
                onChange={handleZipUpload}
              />
            </label>

            {zipMsg && (
              <p className={`text-sm rounded-lg px-4 py-3 border ${
                zipMsg.ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {zipMsg.text}
              </p>
            )}

            {zipResult && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-slate-200 flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-slate-600" />
                      </div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Images</p>
                    </div>
                    <p className="text-3xl font-bold text-slate-800 font-mono">{zipResult.images_found}</p>
                    <p className="text-xs text-slate-400 mt-0.5">extracted from zip</p>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-slate-200 flex items-center justify-center">
                        <FileText className="w-4 h-4 text-slate-600" />
                      </div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Label files</p>
                    </div>
                    <p className="text-3xl font-bold text-slate-800 font-mono">{zipResult.labels_found}</p>
                    <p className="text-xs text-slate-400 mt-0.5">.txt files found</p>
                  </div>

                  <div className={`border rounded-xl px-5 py-4 ${
                    zipResult.matched === zipResult.images_found
                      ? "bg-emerald-50 border-emerald-200"
                      : "bg-amber-50 border-amber-200"
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                        zipResult.matched === zipResult.images_found ? "bg-emerald-200" : "bg-amber-200"
                      }`}>
                        <Link2 className={`w-4 h-4 ${
                          zipResult.matched === zipResult.images_found ? "text-emerald-700" : "text-amber-700"
                        }`} />
                      </div>
                      <p className={`text-xs font-semibold uppercase tracking-wide ${
                        zipResult.matched === zipResult.images_found ? "text-emerald-600" : "text-amber-600"
                      }`}>Matched</p>
                    </div>
                    <p className={`text-3xl font-bold font-mono ${
                      zipResult.matched === zipResult.images_found ? "text-emerald-700" : "text-amber-700"
                    }`}>{zipResult.matched}</p>
                    <p className={`text-xs mt-0.5 ${
                      zipResult.matched === zipResult.images_found ? "text-emerald-500" : "text-amber-600"
                    }`}>
                      {zipResult.matched === zipResult.images_found
                        ? "All images matched ✓"
                        : `${zipResult.images_found - zipResult.matched} images without labels`}
                    </p>
                  </div>
                </div>

                {zipResult.preview && zipResult.preview.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                      <Hash className="w-4 h-4 text-slate-400" />
                      <p className="text-sm font-semibold text-slate-700">Extracted files</p>
                      <span className="text-xs text-slate-400 ml-auto">{zipResult.preview.length} entries</span>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                      {zipResult.preview.map((item, i) => (
                        <div key={i} className="flex items-center justify-between px-5 py-2.5">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${item.label_count > 0 ? "bg-emerald-500" : "bg-amber-400"}`} />
                            <span className="text-sm text-slate-600 truncate font-mono">{item.filename}</span>
                          </div>
                          <div className="shrink-0 ml-4">
                            {item.label_count > 0 ? (
                              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                {item.label_count} polygon{item.label_count !== 1 ? "s" : ""}
                              </span>
                            ) : (
                              <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                No label
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(zipResult.unmatched_images.length > 0 || zipResult.unmatched_labels.length > 0) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-amber-100 transition-colors"
                      onClick={() => setShowUnmatched(v => !v)}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                        <AlertTriangle className="w-4 h-4" /> Unmatched files
                        <span className="text-xs font-normal text-amber-600">
                          ({zipResult.unmatched_images.length} images · {zipResult.unmatched_labels.length} labels)
                        </span>
                      </div>
                      {showUnmatched
                        ? <ChevronUp className="w-4 h-4 text-amber-500" />
                        : <ChevronDown className="w-4 h-4 text-amber-500" />}
                    </button>
                    {showUnmatched && (
                      <div className="border-t border-amber-200 px-5 py-4 grid grid-cols-2 gap-4">
                        {zipResult.unmatched_images.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-amber-700 mb-2">Images without a label file</p>
                            <ul className="space-y-1">
                              {zipResult.unmatched_images.map((f, i) => (
                                <li key={i} className="text-xs text-amber-600 font-mono truncate">{f}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {zipResult.unmatched_labels.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-amber-700 mb-2">Label files without an image</p>
                            <ul className="space-y-1">
                              {zipResult.unmatched_labels.map((f, i) => (
                                <li key={i} className="text-xs text-amber-600 font-mono truncate">{f}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {zipResult.matched > 0 && (
                  <div className="flex items-center gap-4 pt-1">
                    <button onClick={() => setTab("train")}
                      className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold text-sm hover:bg-indigo-700 transition-colors">
                      <Play className="w-4 h-4" /> Go to Train Model
                    </button>
                    <p className="text-sm text-slate-500">
                      {zipResult.matched} matched pair{zipResult.matched !== 1 ? "s" : ""} ready
                    </p>
                  </div>
                )}
              </div>
            )}

            {!zipResult && !zipLoading && (
              <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl px-6 py-10 flex flex-col items-center gap-3 text-slate-400">
                <PackageOpen className="w-10 h-10" />
                <p className="text-sm font-medium">No zip imported yet</p>
                <p className="text-xs text-center max-w-sm">
                  Annotate images in Label Studio, export as{" "}
                  <strong className="text-slate-500">YOLO format (with images)</strong>,
                  then upload the zip above.
                </p>
                <button onClick={() => setTab("annotate")}
                  className="mt-2 flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold hover:bg-indigo-100 transition-colors">
                  <Tag className="w-3.5 h-3.5" /> Go to Annotate
                </button>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════ TRAIN MODEL */}
        {tab === "train" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Train Model</h2>
              <p className="text-sm text-slate-500 mt-1">
                Fine-tune the model on your annotated defective blade images.
                Early stopping will automatically stop training when the model stops improving.
              </p>
            </div>

            <TrainingRequirements
              stats={stats}
              statsLoading={statsLoading}
              onGoToAnnotate={() => setTab("annotate")}
              onGoToImport={() => setTab("import")}
            />

            {!statsLoading && (
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
                  <p className="text-2xl font-bold text-red-700">{stats?.defective ?? 0}</p>
                  <p className="text-sm font-semibold text-red-700">Defective images</p>
                  <p className="text-xs text-red-500 mt-0.5">
                    {stats?.label_stats?.defective?.with_labels ?? 0} with labels · {stats?.label_stats?.defective?.without_labels ?? 0} missing
                  </p>
                </div>
                <div className="bg-violet-50 border border-violet-200 rounded-xl px-5 py-4">
                  <p className="text-2xl font-bold text-violet-700">{stats?.retrain ?? 0}</p>
                  <p className="text-sm font-semibold text-violet-700">Model corrections</p>
                  <p className="text-xs text-violet-500 mt-0.5">
                    {stats?.label_stats?.retrain?.with_labels ?? 0} with labels · {stats?.label_stats?.retrain?.without_labels ?? 0} missing
                  </p>
                </div>
              </div>
            )}

            {/* CHANGE 9: Config accordion — now includes patience field */}
            {trainStatus !== "training" && trainStatus !== "starting" && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
                  onClick={() => setShowConfig(v => !v)}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Settings2 className="w-4 h-4 text-slate-400" /> Training settings
                    {/* Show patience value inline so user can see it without opening */}
                    <span className="text-xs font-normal text-slate-400 ml-1">
                      · {config.epochs} epochs · patience {config.patience}
                    </span>
                  </div>
                  {showConfig ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {showConfig && (
                  <div className="border-t border-slate-100 px-5 py-4 flex flex-col gap-4">
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { key: "epochs",     label: "Epochs",        min: 1,    max: 500, step: 1,      def: 50     },
                        { key: "batch_size", label: "Batch size",    min: 1,    max: 32,  step: 1,      def: 4      },
                        { key: "lr",         label: "Learning rate", min: 1e-5, max: 0.1, step: 0.0001, def: 0.0003 },
                      ].map(({ key, label, min, max, step, def }) => (
                        <div key={key}>
                          <label className="block text-xs font-semibold text-slate-500 mb-1.5">{label}</label>
                          <input
                            type="number" min={min} max={max} step={step}
                            value={(config as any)[key]}
                            onChange={e => setConfig(c => ({ ...c, [key]: parseFloat(e.target.value) || def }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                          <p className="text-xs text-slate-400 mt-1">Default: {def}</p>
                        </div>
                      ))}
                    </div>
                    {/* Patience gets its own row with explanation */}
                    <div className="border-t border-slate-100 pt-4">
                      <div className="flex items-start gap-4">
                        <div className="w-48">
                          <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1.5">
                            <Timer className="w-3.5 h-3.5" /> Early stop patience
                          </label>
                          <input
                            type="number" min={1} max={100} step={1}
                            value={config.patience}
                            onChange={e => setConfig(c => ({ ...c, patience: parseInt(e.target.value) || 10 }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                          <p className="text-xs text-slate-400 mt-1">Default: 10</p>
                        </div>
                        <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-500 leading-relaxed">
                          <strong className="text-slate-700">What is early stopping?</strong><br />
                          If the validation loss doesn't improve for this many consecutive epochs, training stops automatically
                          and the best model checkpoint is saved. This prevents over-fitting and saves time.
                          Lower values stop sooner; higher values train longer before giving up.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Progress card */}
            {(trainStatus === "training" || trainStatus === "starting") && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Activity className="w-4 h-4 text-indigo-500" />
                    Training in progress
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse ml-1" />
                  </div>
                  {trainStatus === "training" && trainProgress && (
                    <span className="text-xs font-mono text-slate-500">
                      Epoch {trainProgress.epoch} / {trainProgress.total_epochs}
                    </span>
                  )}
                </div>
                <div className="px-5 py-4 flex flex-col gap-4">
                  {trainStatus === "training" && trainProgress && trainProgress.total_epochs > 0 ? (
                    <div>
                      <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                        <span>Progress</span><span>{progressPct}%</span>
                      </div>
                      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-sm text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                      {trainStatus === "starting" ? "Launching training…" : (trainProgress?.message || "Waiting for first epoch…")}
                    </div>
                  )}

                  {trainProgress && (trainProgress.train_loss !== null || trainProgress.val_loss !== null) && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                        <p className="text-xs text-slate-400 mb-0.5">Train loss</p>
                        <p className="text-lg font-bold text-slate-700 font-mono">
                          {trainProgress.train_loss !== null ? trainProgress.train_loss.toFixed(4) : "—"}
                        </p>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                        <p className="text-xs text-slate-400 mb-0.5">Val loss</p>
                        <p className="text-lg font-bold text-slate-700 font-mono">
                          {trainProgress.val_loss !== null ? trainProgress.val_loss.toFixed(4) : "—"}
                        </p>
                      </div>
                      <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
                        <p className="text-xs text-indigo-400 mb-0.5">Best val</p>
                        <p className="text-lg font-bold text-indigo-700 font-mono">
                          {trainProgress.best_val !== null ? trainProgress.best_val.toFixed(4) : "—"}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* CHANGE 10: PatienceBar shown live during training */}
                  {trainStatus === "training"
                    && trainProgress?.patience_counter !== undefined
                    && trainProgress?.patience_limit !== undefined
                    && trainProgress.patience_limit > 0 && (
                    <PatienceBar
                      counter={trainProgress.patience_counter}
                      limit={trainProgress.patience_limit}
                    />
                  )}

                  {trainProgress?.history && trainProgress.history.length > 1 && (
                    <div>
                      <p className="text-xs text-slate-400 mb-2">
                        Loss history <span className="text-slate-300">— indigo = train, orange = val</span>
                      </p>
                      <LossSparkline history={trainProgress.history} />
                    </div>
                  )}

                  {trainProgress?.message && (
                    <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                      {trainProgress.message}
                    </p>
                  )}

                  <div className="flex justify-end pt-1">
                    <button onClick={handleStopTraining} disabled={stopLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-semibold hover:bg-red-100 disabled:opacity-50 transition-colors">
                      {stopLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <StopCircle className="w-4 h-4" />}
                      Stop training
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Start button */}
            {(trainStatus === "idle" || trainStatus === "done" || trainStatus === "error" || trainStatus === "stopped") && (
              <button
                onClick={handleTrain}
                disabled={!canTrain}
                className={`flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-semibold text-sm transition-all ${
                  canTrain
                    ? "bg-slate-900 text-white hover:bg-slate-700 shadow-sm"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                <Play className="w-5 h-5" />
                {totalTrainable === 0
                  ? "No annotated images yet — import a YOLO zip first"
                  : missingBoxes > 0
                  ? "Annotate all images before training"
                  : "Start training"}
              </button>
            )}

            {/* CHANGE 11: Done banner — shows early stopping explanation when relevant */}
            {trainStatus === "done" && (
              <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-sm text-emerald-800 flex-1">
                  <p className="font-bold">
                    {trainProgress?.early_stopped
                      ? `Early stopping triggered at epoch ${trainProgress.stopped_epoch}`
                      : trainMsg}
                  </p>
                  {/* Early stop explanation */}
                  {trainProgress?.early_stopped && (
                    <p className="text-emerald-700 mt-1">
                      Val loss didn't improve for {trainProgress.patience_limit} consecutive epochs.
                      The best checkpoint was automatically saved — no accuracy was lost.
                    </p>
                  )}
                  {trainProgress && (
                    <p className="mt-1 text-emerald-700 font-mono text-xs">
                      Best val loss: {trainProgress.best_val?.toFixed(4) ?? "—"}
                      {trainProgress.early_stopped && trainProgress.stopped_epoch && (
                        <> · stopped at epoch {trainProgress.stopped_epoch} / {trainProgress.total_epochs}</>
                      )}
                    </p>
                  )}
                  <div className="mt-3 bg-white border border-emerald-200 rounded-lg px-4 py-3">
                    <p className="font-semibold text-emerald-900 text-xs mb-1">To activate the new model:</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-emerald-100 px-2 py-1 rounded font-mono text-emerald-800 flex-1">
                        copy hr_net_retrained.pth hr_net.pth
                      </code>
                      <CopyButton text="copy hr_net_retrained.pth hr_net.pth" />
                    </div>
                    <p className="text-xs text-emerald-600 mt-1.5">Then restart the backend server.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Stopped */}
            {trainStatus === "stopped" && (
              <div className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl px-5 py-4">
                <StopCircle className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-slate-700">Training stopped</p>
                  <p className="text-sm text-slate-500 mt-0.5">{trainMsg}</p>
                </div>
              </div>
            )}

            {/* Error */}
            {trainStatus === "error" && trainMsg && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4">
                <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-red-800">Training failed</p>
                  <p className="text-sm text-red-700 mt-0.5">{trainMsg}</p>
                  {trainMsg.toLowerCase().includes("annotated") && (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => setTab("import")}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-100 text-red-700 border border-red-200 hover:bg-red-200 transition-colors">
                        <PackageOpen className="w-3.5 h-3.5" /> Import YOLO zip
                      </button>
                      <button onClick={() => setTab("annotate")}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-100 text-red-700 border border-red-200 hover:bg-red-200 transition-colors">
                        <Tag className="w-3.5 h-3.5" /> Annotate images
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <DebugAuditPanel />
          </div>
        )}

      </div>
    </div>
  );
}

// ── Inline SVG shim ───────────────────────────────────────────────────────────
function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}