import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

// ─── Shot matrix ──────────────────────────────────────────────────────────────
const DEFAULT_SHOTS = [
  { sr: 1,  part: "Top leading edge",          section: "Aerofoil", elevation: 38,  camAngle: 85,  tableAngle: 55,  zoom: 1.5, focus: 2085, flash: 22 },
  { sr: 2,  part: "Top leading part",           section: "Aerofoil", elevation: 127, camAngle: 105, tableAngle: 78,  zoom: 1.5, focus: 2085, flash: 22 },
  { sr: 3,  part: "Top mid part",               section: "Aerofoil", elevation: 104, camAngle: 102, tableAngle: 115, zoom: 1.5, focus: 2085, flash: 22 },
  { sr: 4,  part: "Top trailing part",          section: "Aerofoil", elevation: 48,  camAngle: 88,  tableAngle: 199, zoom: 1.5, focus: 2085, flash: 22 },
  { sr: 5,  part: "Top trailing edge",          section: "Aerofoil", elevation: 45,  camAngle: 85,  tableAngle: 245, zoom: 1.5, focus: 2020, flash: 22 },
  { sr: 6,  part: "Top leading opp part",       section: "Aerofoil", elevation: 41,  camAngle: 91,  tableAngle: 28,  zoom: 1.5, focus: 2085, flash: 22 },
  { sr: 7,  part: "Top mid opp part",           section: "Aerofoil", elevation: 14,  camAngle: 82,  tableAngle: 280, zoom: 1.5, focus: 2085, flash: 22 },
  { sr: 8,  part: "Top trailing opp part",      section: "Aerofoil", elevation: 102, camAngle: 102, tableAngle: 260, zoom: 1.5, focus: 2085, flash: 22, note: "Change focus" },
  { sr: 9,  part: "Middle leading edge",        section: "Aerofoil", elevation: 190, camAngle: 91,  tableAngle: 56,  zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 10, part: "Middle leading part",        section: "Aerofoil", elevation: 185, camAngle: 79,  tableAngle: 262, zoom: 1.5, focus: 2085, flash: 11 },
  { sr: 11, part: "Middle mid part",            section: "Aerofoil", elevation: 190, camAngle: 91,  tableAngle: 83,  zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 12, part: "Middle trailing part",       section: "Aerofoil", elevation: 157, camAngle: 85,  tableAngle: 86,  zoom: 1.5, focus: 2085, flash: 22 },
  { sr: 13, part: "Middle trailing edge",       section: "Aerofoil", elevation: 200, camAngle: 90,  tableAngle: 232, zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 14, part: "Middle leading opp part",    section: "Aerofoil", elevation: 208, camAngle: 92,  tableAngle: 304, zoom: 1.5, focus: 2085, flash: 8  },
  { sr: 15, part: "Middle mid opp part",        section: "Aerofoil", elevation: 135, camAngle: 74,  tableAngle: 9,   zoom: 1.5, focus: 2085, flash: 8,  note: "Add natural light" },
  { sr: 16, part: "Middle trailing opp part",   section: "Aerofoil", elevation: 189, camAngle: 92,  tableAngle: 254, zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 17, part: "Bottom trailing edge",       section: "Aerofoil", elevation: 190, camAngle: 95,  tableAngle: 330, zoom: 1.5, focus: 2085, flash: 2,  note: "Reverse blade" },
  { sr: 18, part: "Bottom leading part",        section: "Aerofoil", elevation: 42,  camAngle: 81,  tableAngle: 282, zoom: 1.5, focus: 2085, flash: 8  },
  { sr: 19, part: "Bottom mid part",            section: "Aerofoil", elevation: 83,  camAngle: 92,  tableAngle: 119, zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 20, part: "Bottom trailing part",       section: "Aerofoil", elevation: 22,  camAngle: 53,  tableAngle: 292, zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 21, part: "Bottom leading edge",        section: "Aerofoil", elevation: 85,  camAngle: 96,  tableAngle: 132, zoom: 1.5, focus: 2025, flash: 14 },
  { sr: 22, part: "Bottom leading opp part",    section: "Aerofoil", elevation: 49,  camAngle: 88,  tableAngle: 148, zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 23, part: "Bottom mid opp part",        section: "Aerofoil", elevation: 143, camAngle: 101, tableAngle: 161, zoom: 1.5, focus: 2081, flash: 14 },
  { sr: 24, part: "Bottom trailing opp part",   section: "Aerofoil", elevation: 221, camAngle: 110, tableAngle: 298, zoom: 1.5, focus: 2085, flash: 14, note: "Please adjust cloth on top" },
  { sr: 25, part: "Sensitive Zone Opp leading", section: "Base",     elevation: 320, camAngle: 133, tableAngle: 159, zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 26, part: "Sensitive Zone trailing",    section: "Base",     elevation: 37,  camAngle: 47,  tableAngle: 219, zoom: 1.5, focus: 2119, flash: 14, note: "Rotate blade upside down, add gloves" },
  { sr: 27, part: "Critical point leading",     section: "Base",     elevation: 155, camAngle: 116, tableAngle: 138, zoom: 1.5, focus: 2085, flash: 14, note: "Rotate blade upside down" },
  { sr: 28, part: "Weld face Trailing Edge",    section: "Base",     elevation: 0,   camAngle: 73,  tableAngle: 333, zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 29, part: "Stub flanks middle",         section: "Base",     elevation: 20,  camAngle: 82,  tableAngle: 84,  zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 30, part: "Trailing Edge stub opp",     section: "Base",     elevation: 13,  camAngle: 79,  tableAngle: 203, zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 31, part: "Stub flanks mid opp pocket", section: "Base",     elevation: 55,  camAngle: 83,  tableAngle: 297, zoom: 1.5, focus: 2085, flash: 14 },
  { sr: 32, part: "Leading Edge Stub flanks",   section: "Base",     elevation: null, camAngle: null, tableAngle: null, zoom: null, focus: null, flash: null, note: "Cannot capture — needs camera height increase", disabled: true },
];

const BASE = "http://localhost:5000";
const CAMERA_STREAM_URL = `${BASE}/camera-stream`;

// ─── Auto-generate image name from shot metadata ──────────────────────────────
function generateImageName(s: typeof DEFAULT_SHOTS[0]): string {
  const slug = s.part.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
  return [
    `S${String(s.sr).padStart(2, "0")}`,
    slug,
    s.section,
    s.elevation  != null ? `Elev${s.elevation}`  : null,
    s.camAngle   != null ? `Cam${s.camAngle}`    : null,
    s.tableAngle != null ? `Tbl${s.tableAngle}`  : null,
    s.zoom       != null ? `Z${s.zoom}`          : null,
    s.focus      != null ? `F${s.focus}`         : null,
    s.flash      != null ? `Fl${s.flash}`        : null,
  ].filter(Boolean).join("_");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function MetaPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 min-w-[52px]">
      <span className="text-[10px] font-medium tracking-wide uppercase text-gray-400 mb-0.5">{label}</span>
      <span className="text-sm font-semibold text-gray-700 tabular-nums">{value}</span>
    </div>
  );
}

function SliderControl({
  label, icon, min, max, step = 1, value, decimals = 0,
  onChange, disabled = false, unit = "",
}: {
  label: string; icon: React.ReactNode; min: number; max: number; step?: number;
  value: number; decimals?: number; onChange: (v: number) => void;
  disabled?: boolean; unit?: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-gray-500 flex items-center gap-1.5">{icon} {label}</span>
        <span className={`text-xs font-semibold tabular-nums ${disabled ? "text-gray-300" : "text-blue-600"}`}>
          {value.toFixed(decimals)}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-gray-200 accent-blue-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
      />
    </div>
  );
}

// ─── Camera Panel Drawer ──────────────────────────────────────────────────────
function CameraPanel({
  open, onClose,
  cameraList, selectedCamId, setSelectedCamId,
  cameraOpen, onOpenClose, loadingCam, camError,
  flash, setFlash, zoom, setZoom, focus, setFocus,
  autoExpo, setAutoExpo, expoTime, setExpoTime, expoGain, setExpoGain,
  autoFocus, setAutoFocus,
  onRefreshList, onApplyWB, sendSetting,
  picClickerRunning,
}: any) {
  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
      />
      <div
        className="fixed top-0 right-0 bottom-0 w-80 bg-white border-l border-gray-200 z-50 overflow-y-auto shadow-xl transition-transform duration-300"
        style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <p className="text-sm font-semibold text-gray-800">Camera Control</p>
            <p className="text-xs text-gray-400 mt-0.5">AFDM412 · uvcham bridge</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg border border-gray-200 bg-gray-50 text-gray-400 hover:bg-gray-100 flex items-center justify-center text-sm transition-colors">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-5">

          {/* pic_clicker status */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${
            picClickerRunning
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-amber-50 border-amber-200 text-amber-700"
          }`}>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${picClickerRunning ? "bg-green-500 animate-pulse" : "bg-amber-400"}`} />
            {picClickerRunning ? "pic_clicker.py is running" : "pic_clicker.py not detected — start it first"}
          </div>

          {/* Device */}
          <DrawerSection label="Device">
            <div className="flex gap-2 mb-2">
              <select
                value={selectedCamId}
                onChange={e => setSelectedCamId(e.target.value)}
                disabled={cameraOpen}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {cameraList.length === 0 && <option value="">No cameras detected</option>}
                {cameraList.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={onRefreshList} disabled={cameraOpen} title="Refresh"
                className="w-9 rounded-lg border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 disabled:opacity-40 text-base transition-colors">
                ↺
              </button>
            </div>
            <button onClick={onOpenClose} disabled={loadingCam}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
                cameraOpen ? "bg-red-500 hover:bg-red-600 text-white" : "bg-blue-500 hover:bg-blue-600 text-white"
              } disabled:opacity-50`}>
              {loadingCam ? "…" : cameraOpen ? "⏹ Close Camera" : "▶ Open Camera"}
            </button>
            {camError && (
              <p className="mt-2 text-xs text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{camError}</p>
            )}
          </DrawerSection>

          <DrawerDivider />

          {/* Optics — Flash, Zoom, Focus */}
          <DrawerSection label="Optics" locked={!cameraOpen}>
            <SliderControl label="Flash" icon="⚡" min={0} max={22} value={flash} disabled={!cameraOpen}
              onChange={v => { setFlash(v); sendSetting("flash", v); }} />
            <SliderControl label="Zoom" icon="🔍" min={5} max={30} value={Math.round(zoom * 10)} decimals={1}
              disabled={!cameraOpen} unit="×"
              onChange={v => { setZoom(v / 10); sendSetting("zoom", v / 10); }} />
            <SliderControl label="Focus" icon="◎" min={0} max={5068} value={focus} disabled={!cameraOpen}
              onChange={v => { setFocus(v); sendSetting("focus", v); }} />
          </DrawerSection>

          <DrawerDivider />

          {/* Autofocus */}
          <DrawerSection label="Autofocus" locked={!cameraOpen}>
            <div className="flex gap-2">
              {[
                { label: "AF On",  active: autoFocus,  action: () => { setAutoFocus(true);  axios.post(`${BASE}/camera/autofocus`, { enabled: true }); } },
                { label: "AF Off", active: !autoFocus, action: () => { setAutoFocus(false); axios.post(`${BASE}/camera/autofocus`, { enabled: false }); } },
              ].map(({ label, active, action }) => (
                <button key={label} onClick={action} disabled={!cameraOpen || active}
                  className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-colors ${
                    active ? "border-blue-300 bg-blue-50 text-blue-600" : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50"
                  } disabled:cursor-not-allowed`}>{label}</button>
              ))}
            </div>
          </DrawerSection>

          <DrawerDivider />

          {/* Exposure */}
          <DrawerSection label="Exposure" locked={!cameraOpen}>
            <label className={`flex items-center gap-3 mb-4 ${cameraOpen ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}>
              <div className={`relative w-9 h-5 rounded-full border transition-colors ${autoExpo ? "bg-blue-500 border-blue-500" : "bg-gray-200 border-gray-300"}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${autoExpo ? "left-4" : "left-0.5"}`} />
                <input type="checkbox" checked={autoExpo} disabled={!cameraOpen}
                  onChange={e => { setAutoExpo(e.target.checked); sendSetting("auto_expo", e.target.checked); }}
                  className="absolute inset-0 opacity-0 cursor-pointer" />
              </div>
              <span className={`text-xs font-medium ${autoExpo ? "text-blue-600" : "text-gray-400"}`}>Auto Exposure</span>
            </label>
            <SliderControl label="Shutter" icon="⏱" min={0} max={2000000} step={1000} value={expoTime}
              disabled={!cameraOpen || autoExpo}
              onChange={v => { setExpoTime(v); sendSetting("expo_time", v); }} />
            <SliderControl label="Gain" icon="📶" min={0} max={480} value={expoGain}
              disabled={!cameraOpen || autoExpo}
              onChange={v => { setExpoGain(v); sendSetting("expo_gain", v); }} />
          </DrawerSection>

          <DrawerDivider />

          {/* White Balance */}
          <DrawerSection label="White Balance" locked={!cameraOpen}>
            <button onClick={onApplyWB} disabled={!cameraOpen}
              className="w-full py-2 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-600 text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              ⬜ Auto White Balance
            </button>
          </DrawerSection>

          <div className="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-100">
            <p className="text-xs text-amber-700 leading-relaxed">
              <strong className="text-amber-800">ℹ Background process required</strong><br />
              Run <code className="bg-amber-100 px-1 py-0.5 rounded text-[10px]">python pic_clicker.py</code> before opening the camera. Commands route via Flask file-bridge.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function DrawerSection({ label, children, locked = false }: { label: string; children: React.ReactNode; locked?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${locked ? "text-gray-200" : "text-gray-400"}`}>{label}</span>
        <div className="flex-1 h-px bg-gray-100" />
        {locked && <span className="text-[9px] text-gray-200 tracking-wider">LOCKED</span>}
      </div>
      {children}
    </div>
  );
}

function DrawerDivider() { return <div className="h-px bg-gray-100" />; }

// ─── Qt Snap Monitor ──────────────────────────────────────────────────────────
// Polls /camera/latest-snap every 1.5 s. When pic_clicker saves a new file
// (via its own Snap button), we detect it, fetch the image, and add it to
// the captured map — so it appears in the UI just like a browser SNAP.
function useQtSnapMonitor(
  shots: typeof DEFAULT_SHOTS,
  selectedShot: number | null,
  setCapturedImages: React.Dispatch<React.SetStateAction<Record<number, string>>>,
  handleSelectShot: (s: typeof DEFAULT_SHOTS[0]) => void,
) {
  const lastSnap = useRef<string>("");

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const r = await axios.get(`${BASE}/camera/latest-snap`);
        const { filename } = r.data;
        if (!filename || filename === lastSnap.current) return;
        lastSnap.current = filename;

        // Parse shot number from S##_ prefix
        const match = filename.match(/^S(\d{2})_/);
        if (!match) return;
        const sr   = parseInt(match[1], 10);
        const shot = shots.find(s => s.sr === sr);
        if (!shot) return;

        // Fetch the image blob
        const imgRes = await axios.get(
          `${BASE}/camera/snap-file?filename=${encodeURIComponent(filename)}`,
          { responseType: "blob" }
        );
        const blobUrl = URL.createObjectURL(imgRes.data);
        setCapturedImages(prev => ({ ...prev, [sr]: blobUrl }));

        // Auto-advance if this was the active shot
        if (selectedShot === sr) {
          const next = shots.find(s => s.sr > sr && !s.disabled);
          if (next) handleSelectShot(next);
        }
      } catch {}
    }, 1500);
    return () => clearInterval(interval);
  }, [shots, selectedShot, setCapturedImages, handleSelectShot]);
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CapturePage() {
  const navigate = useNavigate();

  const [shots, setShots]                 = useState(DEFAULT_SHOTS);
  const [selectedShot, setSelectedShot]   = useState<number | null>(null);
  const [capturedImages, setCapturedImages] = useState<Record<number, string>>({});
  const [filterSection, setFilterSection] = useState("All");
  const [showOnlyPending, setShowOnlyPending] = useState(false);

  const [panelOpen, setPanelOpen]         = useState(false);
  const [picClickerRunning, setPicClickerRunning] = useState(false);

  const [cameraList, setCameraList]       = useState<{ id: string; name: string }[]>([]);
  const [selectedCamId, setSelectedCamId] = useState<string>("");
  const [cameraOpen, setCameraOpen]       = useState(false);
  const [streamOk, setStreamOk]           = useState(false);

  const [flash, setFlash]       = useState(0);
  const [zoom, setZoom]         = useState(1.5);
  const [focus, setFocus]       = useState(0);
  const [autoExpo, setAutoExpo] = useState(false);
  const [expoTime, setExpoTime] = useState(0);
  const [expoGain, setExpoGain] = useState(0);
  const [autoFocus, setAutoFocus] = useState(false);

  const [loadingSnap, setLoadingSnap] = useState(false);
  const [loadingCam, setLoadingCam]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [camError, setCamError]       = useState<string | null>(null);
  const [applyingShot, setApplyingShot] = useState(false);

  const streamRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    axios.get(`${BASE}/shots`).then(r => setShots(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const check = () => axios.get(`${BASE}/camera-status`)
      .then(r => setStreamOk(r.data.available)).catch(() => setStreamOk(false));
    check();
    const t = setInterval(check, 3000);
    return () => clearInterval(t);
  }, []);

  // Poll pic_clicker status
  useEffect(() => {
    const check = () => axios.get(`${BASE}/pic-clicker/status`)
      .then(r => setPicClickerRunning(r.data.running)).catch(() => setPicClickerRunning(false));
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

  const refreshCameraList = useCallback(async () => {
    try {
      const r = await axios.get(`${BASE}/camera/list`);
      const list = r.data.cameras || [];
      setCameraList(list);
      if (list.length > 0 && !selectedCamId) setSelectedCamId(list[0].id);
    } catch { setCamError("Could not reach backend. Is Flask running on :5000?"); }
  }, [selectedCamId]);

  useEffect(() => { refreshCameraList(); }, []);

  const syncSettings = useCallback(async () => {
    try {
      const r = await axios.get(`${BASE}/camera/settings`);
      const d = r.data;
      setCameraOpen(d.open);
      setFlash(d.flash ?? 0);
      setZoom(d.zoom ?? 1.5);
      setFocus(d.focus ?? 0);
      setAutoExpo(d.auto_expo ?? false);
      setExpoTime(d.expo_time ?? 0);
      setExpoGain(d.expo_gain ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    if (!cameraOpen) return;
    syncSettings();
    const t = setInterval(syncSettings, 5000);
    return () => clearInterval(t);
  }, [cameraOpen, syncSettings]);

  const handleOpenClose = useCallback(async () => {
    setCamError(null); setLoadingCam(true);
    try {
      if (cameraOpen) {
        await axios.post(`${BASE}/camera/close`);
        setCameraOpen(false);
      } else {
        if (!selectedCamId) { setCamError("Select a camera first"); return; }
        await axios.post(`${BASE}/camera/open`, { camera_id: selectedCamId });
        setCameraOpen(true);
        setTimeout(syncSettings, 1200);
      }
    } catch (e: any) { setCamError(e?.response?.data?.error || "Camera command failed"); }
    finally { setLoadingCam(false); }
  }, [cameraOpen, selectedCamId, syncSettings]);

  const sendSetting = useCallback(async (key: string, value: number | boolean) => {
    try { await axios.post(`${BASE}/camera/set`, { [key]: value }); } catch {}
  }, []);

  // Apply shot settings AND push nomenclature name to Qt's Image Name field
  const applyShot = useCallback(async (s: typeof DEFAULT_SHOTS[0]) => {
    if (s.disabled) return;
    setApplyingShot(true);
    try {
      const name = generateImageName(s);
      const payload: Record<string, any> = {};
      if (s.flash != null) { payload.flash = s.flash; setFlash(s.flash); }
      if (s.zoom  != null) { payload.zoom  = s.zoom;  setZoom(s.zoom); }
      if (s.focus != null) { payload.focus = s.focus; setFocus(s.focus); }

      // Push camera optics (only if camera open)
      if (cameraOpen && Object.keys(payload).length > 0) {
        await axios.post(`${BASE}/camera/set`, payload);
      }

      // ALWAYS push the name — Qt will show it in the Image Name field
      await axios.post(`${BASE}/camera/set-name`, { name });
    } catch {}
    finally { setApplyingShot(false); }
  }, [cameraOpen]);

  const handleSelectShot = useCallback((s: typeof DEFAULT_SHOTS[0]) => {
    if (s.disabled) return;
    setSelectedShot(s.sr);
    applyShot(s);
  }, [applyShot]);

  // Qt snap monitor — detects files saved by pic_clicker's own Snap button
  useQtSnapMonitor(shots, selectedShot, setCapturedImages, handleSelectShot);

  // Browser SNAP — grabs live frame from Flask
  const handleSnap = useCallback(async () => {
    if (!selectedShot) return;
    const currentShot = shots.find(s => s.sr === selectedShot);
    if (!currentShot) return;
    setLoadingSnap(true); setError(null);
    try {
      const imageName = generateImageName(currentShot);
      const res = await axios.get(`${BASE}/camera-snap`, {
        responseType: "blob",
        params: { name: imageName },
      });
      const url = URL.createObjectURL(res.data);
      setCapturedImages(prev => ({ ...prev, [selectedShot]: url }));

      // Register with backend so Qt snap monitor + snap-file route know about it
      const fd = new FormData();
      fd.append("image", res.data, `${imageName}.jpg`);
      fd.append("name", imageName);
      await axios.post(`${BASE}/camera/save-snap`, fd).catch(() => {});

      const next = shots.find(s => s.sr > selectedShot && !s.disabled && !capturedImages[s.sr]);
      if (next) handleSelectShot(next);
    } catch { setError("Snap failed — open camera first."); }
    finally { setLoadingSnap(false); }
  }, [selectedShot, capturedImages, shots, handleSelectShot]);

  // Inspect all → /predict-batch
  const handleInspectAll = useCallback(async () => {
    const entries = Object.entries(capturedImages);
    if (!entries.length) return;
    setLoadingSnap(true); setError(null);
    try {
      const formData = new FormData();
      for (const [sr, blobUrl] of entries) {
        const res  = await fetch(blobUrl);
        const blob = await res.blob();
        const s    = shots.find(s => s.sr === Number(sr));
        const name = s ? generateImageName(s) : `shot_${sr}`;
        formData.append("images", blob, `${name}.jpg`);
      }
      const result = await axios.post(`${BASE}/predict-batch`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      navigate("/results-batch", {
        state: { batchResults: result.data.results, excelReport: result.data.excel_report },
      });
    } catch (err: any) { setError(err?.response?.data?.error || "Inspection failed."); }
    finally { setLoadingSnap(false); }
  }, [capturedImages, shots, navigate]);

  const shot       = shots.find(s => s.sr === selectedShot);
  const captured   = Object.keys(capturedImages).length;
  const totalValid = shots.filter(s => !s.disabled).length;
  const progress   = Math.round((captured / totalValid) * 100);

  const visibleShots = shots.filter(s => {
    if (filterSection !== "All" && s.section !== filterSection) return false;
    if (showOnlyPending && capturedImages[s.sr]) return false;
    return true;
  });

  const statusColor = cameraOpen && streamOk ? "bg-green-400" : cameraOpen ? "bg-amber-400" : "bg-red-400";
  const statusLabel = cameraOpen && streamOk ? "Live" : cameraOpen ? "No stream" : "Closed";

  return (
    <div className="flex h-screen overflow-hidden flex-col bg-gray-50 font-sans text-gray-800">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="h-14 flex items-center gap-3 px-4 bg-white border-b border-gray-200 flex-shrink-0 shadow-sm">
        <button onClick={() => navigate("/")} className="text-xs text-gray-400 hover:text-gray-600 mr-1">← Back</button>
        <div className="w-px h-5 bg-gray-200" />

        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColor} ${cameraOpen && streamOk ? "animate-pulse" : ""}`} />
          <span className="text-xs text-gray-500">{statusLabel}</span>
        </div>
        <div className="w-px h-5 bg-gray-200" />

        {cameraOpen && (
          <div className="flex gap-5 items-center">
            {[
              { label: "FLASH", min: 0, max: 22,   val: flash,              set: (v: number) => { setFlash(v);      sendSetting("flash", v); } },
              { label: "ZOOM",  min: 5, max: 30,   val: Math.round(zoom*10), set: (v: number) => { setZoom(v/10); sendSetting("zoom", v/10); } },
              { label: "FOCUS", min: 0, max: 5068, val: focus,              set: (v: number) => { setFocus(v);      sendSetting("focus", v); } },
            ].map(({ label, min, max, val, set }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[9px] font-semibold tracking-widest text-gray-400">{label}</span>
                <input type="range" min={min} max={max} value={val}
                  onChange={e => set(Number(e.target.value))}
                  className="w-20 h-1.5 appearance-none bg-gray-200 rounded-full accent-blue-500 cursor-pointer" />
                <span className="text-xs text-gray-600 tabular-nums min-w-[28px]">
                  {label === "ZOOM" ? (val/10).toFixed(1) : val}
                </span>
              </div>
            ))}
          </div>
        )}

        {shot && !shot.disabled && (
          <button onClick={() => applyShot(shot)} disabled={applyingShot}
            className="px-3 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-purple-600 text-xs font-semibold hover:bg-purple-100 transition-colors disabled:opacity-50">
            {applyingShot ? "…" : `⚡ Apply Shot ${shot.sr}`}
          </button>
        )}

        {/* Qt status chip */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${
          picClickerRunning ? "bg-green-50 border-green-200 text-green-600" : "bg-amber-50 border-amber-200 text-amber-600"
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${picClickerRunning ? "bg-green-500 animate-pulse" : "bg-amber-400"}`} />
          {picClickerRunning ? "Qt running" : "Qt offline"}
        </div>

        <button onClick={() => setPanelOpen(true)}
          className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-sm font-medium shadow-sm transition-colors">
          📷 Camera Control
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cameraOpen ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"}`}>
            {cameraOpen ? "Open" : "Closed"}
          </span>
        </button>
      </div>

      {/* ── Main layout ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: shot matrix */}
        <div className="w-72 flex flex-col border-r border-gray-200 bg-white">
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">Shot Matrix</span>
              <span className="text-xl font-bold text-gray-800">32</span>
            </div>
            <div className="mb-3">
              <div className="flex justify-between mb-1.5">
                <span className="text-xs text-gray-400">{captured} captured</span>
                <span className={`text-xs font-semibold ${progress === 100 ? "text-green-500" : "text-blue-500"}`}>{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100">
                <div className={`h-full rounded-full transition-all duration-500 ${progress === 100 ? "bg-green-400" : "bg-blue-400"}`}
                  style={{ width: `${progress}%` }} />
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {["All","Aerofoil","Base"].map(sec => (
                <button key={sec} onClick={() => setFilterSection(sec)}
                  className={`text-[10px] px-2.5 py-1 rounded-full border font-medium transition-colors ${
                    filterSection === sec ? "border-blue-300 bg-blue-50 text-blue-600" : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50"
                  }`}>{sec}</button>
              ))}
              <button onClick={() => setShowOnlyPending(p => !p)}
                className={`text-[10px] px-2.5 py-1 rounded-full border font-medium transition-colors ${
                  showOnlyPending ? "border-amber-300 bg-amber-50 text-amber-600" : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50"
                }`}>Pending</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {visibleShots.map(s => {
              const isDone = !!capturedImages[s.sr];
              const isSelected = selectedShot === s.sr;
              return (
                <div key={s.sr} onClick={() => handleSelectShot(s)}
                  className={`flex items-center gap-3 px-4 py-2.5 transition-colors border-l-2 ${
                    s.disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"
                  } ${isSelected ? "bg-blue-50 border-l-blue-400" : "bg-white border-l-transparent hover:bg-gray-50"}`}>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0 border ${
                    isDone ? "bg-green-50 text-green-500 border-green-200"
                    : isSelected ? "bg-blue-100 text-blue-600 border-blue-200"
                    : "bg-gray-50 text-gray-400 border-gray-200"
                  }`}>{isDone ? "✓" : s.sr}</div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${isSelected ? "text-gray-800" : "text-gray-600"}`}>{s.part}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                        s.section === "Aerofoil" ? "bg-sky-50 text-sky-500 border border-sky-100" : "bg-purple-50 text-purple-500 border border-purple-100"
                      }`}>{s.section}</span>
                      {s.note && <span className="text-[10px] text-amber-400">⚠</span>}
                      {isDone && <span className="text-[9px] text-green-500 font-medium">● saved</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t border-gray-100">
            <button onClick={handleInspectAll} disabled={captured === 0 || loadingSnap}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
                captured > 0 ? "bg-blue-500 hover:bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-300 cursor-not-allowed"
              }`}>
              {loadingSnap ? "Processing…" : `Inspect ${captured} image${captured !== 1 ? "s" : ""} →`}
            </button>
          </div>
        </div>

        {/* Center: camera viewport */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Shot info bar */}
          {shot ? (
            <div className="px-5 py-3 border-b border-gray-200 bg-white flex flex-col gap-2 flex-shrink-0">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Shot {shot.sr} / 32 · {shot.section}</p>
                  <p className="text-base font-semibold text-gray-800 mt-0.5">{shot.part}</p>
                  {/* Filename shown here and pushed to Qt Image Name field automatically */}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-gray-400 flex-shrink-0">Filename:</span>
                    <code className="text-[10px] font-mono text-blue-500 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded truncate">
                      {generateImageName(shot)}.jpg
                    </code>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {[["Elev", shot.elevation],["Cam°", shot.camAngle],["Table°", shot.tableAngle],
                    ["Zoom", shot.zoom],["Focus", shot.focus],["Flash", shot.flash]]
                    .map(([label, value]) => (
                      <MetaPill key={label as string} label={label as string} value={value ?? "—"} />
                    ))}
                </div>
              </div>
              {shot.note && (
                <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-700 flex items-start gap-2">
                  <span className="flex-shrink-0">⚠</span> {shot.note}
                </div>
              )}
            </div>
          ) : (
            <div className="px-5 py-3 border-b border-gray-200 bg-white">
              <p className="text-sm text-gray-400">Select a shot from the matrix to begin</p>
            </div>
          )}

          {/* Viewport */}
          <div className="flex-1 flex items-center justify-center bg-gray-900 relative overflow-hidden">
            {streamOk ? (
              <img ref={streamRef} src={`${CAMERA_STREAM_URL}?t=${Date.now()}`} alt="Live camera feed"
                className="max-w-full max-h-full object-contain z-10"
                onError={() => setStreamOk(false)} />
            ) : (
              <div className="text-center z-10">
                <div className="text-4xl mb-3 opacity-20 grayscale">◎</div>
                <p className="text-sm text-gray-500">Camera feed unavailable</p>
                <p className="text-xs text-gray-600 mt-1.5">{cameraOpen ? "Waiting for stream…" : "Open camera via Camera Control"}</p>
                {!cameraOpen && (
                  <button onClick={() => setPanelOpen(true)}
                    className="mt-4 px-5 py-2 rounded-xl border border-blue-300 bg-blue-900/20 text-blue-400 text-sm hover:bg-blue-900/40 transition-colors">
                    Open Camera Control
                  </button>
                )}
              </div>
            )}

            {selectedShot && capturedImages[selectedShot] && (
              <div className="absolute top-3 right-3 z-20 w-28 h-20 rounded-xl overflow-hidden border-2 border-green-400 shadow-lg">
                <img src={capturedImages[selectedShot]} alt="Captured" className="w-full h-full object-cover" />
                <div className="absolute bottom-0 inset-x-0 py-1 bg-green-500 text-white text-[9px] text-center font-semibold tracking-wider">CAPTURED ✓</div>
              </div>
            )}

            {streamOk && ["tl","tr","bl","br"].map(pos => (
              <div key={pos} className="absolute z-10 w-5 h-5" style={{
                top: pos.includes("t") ? 12 : "auto", bottom: pos.includes("b") ? 12 : "auto",
                left: pos.includes("l") ? 12 : "auto", right: pos.includes("r") ? 12 : "auto",
                borderTop:    pos.includes("t") ? "2px solid rgba(96,165,250,0.5)" : "none",
                borderBottom: pos.includes("b") ? "2px solid rgba(96,165,250,0.5)" : "none",
                borderLeft:   pos.includes("l") ? "2px solid rgba(96,165,250,0.5)" : "none",
                borderRight:  pos.includes("r") ? "2px solid rgba(96,165,250,0.5)" : "none",
              }} />
            ))}
          </div>

          {/* Snap bar */}
          <div className="px-4 py-3 border-t border-gray-200 bg-white flex items-center gap-3 flex-shrink-0">
            {error && <p className="flex-1 text-xs text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>}
            {shot && !shot.disabled && !error && (
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-gray-400 flex-shrink-0">Save as:</span>
                <span className="text-[10px] font-mono text-gray-500 truncate">{generateImageName(shot)}.jpg</span>
              </div>
            )}
            <div className="ml-auto flex gap-2 items-center flex-shrink-0">
              {selectedShot && capturedImages[selectedShot] && (
                <button onClick={() => setCapturedImages(prev => { const n = {...prev}; delete n[selectedShot!]; return n; })}
                  className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-500 text-sm hover:bg-gray-50 transition-colors">
                  Retake
                </button>
              )}
              <button onClick={handleSnap} disabled={!selectedShot || loadingSnap || !!shot?.disabled || !cameraOpen}
                title={!cameraOpen ? "Open camera first" : undefined}
                className={`px-8 py-2.5 rounded-xl text-sm font-bold tracking-wider transition-all ${
                  selectedShot && !shot?.disabled && cameraOpen
                    ? "bg-blue-500 hover:bg-blue-600 text-white shadow-md"
                    : "bg-gray-100 text-gray-300 cursor-not-allowed"
                }`}>
                {loadingSnap ? "Capturing…" : "SNAP"}
              </button>
            </div>
          </div>
        </div>

        {/* Right: thumbnails */}
        <div className="w-44 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="p-3 pb-2 border-b border-gray-100">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Captured</p>
            <p className="text-2xl font-bold text-gray-800 mt-0.5">{captured}</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
            {shots.filter(s => capturedImages[s.sr]).map(s => (
              <div key={s.sr} onClick={() => setSelectedShot(s.sr)}
                className={`rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${
                  selectedShot === s.sr ? "border-blue-400 shadow-md" : "border-gray-100 hover:border-gray-300"
                }`}>
                <img src={capturedImages[s.sr]} alt={s.part} className="w-full h-16 object-cover block" />
                <div className="px-2 py-1.5 bg-gray-50">
                  <p className="text-[9px] font-semibold text-gray-500">{String(s.sr).padStart(2,"0")} · {s.section}</p>
                  <p className="text-[10px] text-gray-700 leading-tight truncate">{s.part}</p>
                </div>
              </div>
            ))}
            {captured === 0 && <p className="text-xs text-gray-300 text-center mt-6 leading-relaxed">No images<br />captured yet</p>}
          </div>
        </div>
      </div>

      <CameraPanel
        open={panelOpen} onClose={() => setPanelOpen(false)}
        cameraList={cameraList} selectedCamId={selectedCamId} setSelectedCamId={setSelectedCamId}
        cameraOpen={cameraOpen} onOpenClose={handleOpenClose} loadingCam={loadingCam} camError={camError}
        flash={flash} setFlash={setFlash} zoom={zoom} setZoom={setZoom} focus={focus} setFocus={setFocus}
        autoExpo={autoExpo} setAutoExpo={setAutoExpo} expoTime={expoTime} setExpoTime={setExpoTime}
        expoGain={expoGain} setExpoGain={setExpoGain} autoFocus={autoFocus} setAutoFocus={setAutoFocus}
        onRefreshList={refreshCameraList} onApplyWB={() => axios.post(`${BASE}/camera/white-balance`)}
        sendSetting={sendSetting} picClickerRunning={picClickerRunning}
      />
    </div>
  );
}