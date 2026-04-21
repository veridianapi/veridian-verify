"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { submitVerification, type VerificationResult } from "./actions";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const BG      = "#050a09";
const CARD    = "#ffffff";
const BRAND   = "#0f6e56";
const BRAND_D = "#0a5c46";
const BRAND_L = "rgba(15,110,86,0.08)";
const BRAND_G = "rgba(15,110,86,0.20)";
const INK     = "#111827";
const INK_2   = "#374151";
const INK_3   = "#6b7280";
const INK_4   = "#9ca3af";
const BORDER  = "#e5e7eb";
const SURFACE = "#f9fafb";
const DANGER  = "#ef4444";
const DANGER_L = "#fef2f2";
const WARN    = "#f59e0b";
const WARN_L  = "#fffbeb";
const OK      = "#10b981";
const OK_L    = "#f0fdf4";

const MONO = 'var(--font-mono,"JetBrains Mono","SF Mono",ui-monospace,monospace)';
const BTN_H = 44;
const R     = 10; // base border-radius

// ─── Types ───────────────────────────────────────────────────────────────────
type FlowStep   = "detecting" | "entry" | "welcome" | "doc-select" | "doc-capture" | "selfie" | "processing" | "result";
type Direction  = "forward" | "backward";
type DocType    = "passport" | "national_id" | "driving_licence" | "residence_permit";
type CapturePhase = "front-cam" | "front-preview" | "back-cam" | "back-preview";
type CamStatus  = "starting" | "live" | "denied";

interface Country { code: string; name: string; flag: string }
interface FrameQuality { brightness: number; variance: number }
interface Chip { text: string; ok: boolean; warn?: boolean }

// ─── Data ────────────────────────────────────────────────────────────────────
const COUNTRIES: Country[] = [
  { code: "ET", name: "Ethiopia",       flag: "🇪🇹" },
  { code: "KE", name: "Kenya",          flag: "🇰🇪" },
  { code: "NG", name: "Nigeria",        flag: "🇳🇬" },
  { code: "ZA", name: "South Africa",   flag: "🇿🇦" },
  { code: "EG", name: "Egypt",          flag: "🇪🇬" },
  { code: "GH", name: "Ghana",          flag: "🇬🇭" },
  { code: "US", name: "United States",  flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "IN", name: "India",          flag: "🇮🇳" },
  { code: "DE", name: "Germany",        flag: "🇩🇪" },
];

const DOC_TYPES: { value: DocType; label: string; meta: string; hasBack: boolean }[] = [
  { value: "passport",         label: "Passport",         meta: "Photo page only",  hasBack: false },
  { value: "driving_licence",  label: "Driving licence",  meta: "Front and back",   hasBack: true  },
  { value: "national_id",      label: "National ID",      meta: "Front and back",   hasBack: true  },
  { value: "residence_permit", label: "Residence permit", meta: "Front only",       hasBack: false },
];

// ─── Utilities ───────────────────────────────────────────────────────────────
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stripPfx = (s: string) => (s.includes(",") ? s.split(",")[1] : s);

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function analyzeFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): FrameQuality | null {
  if (video.videoWidth === 0) return null;
  const w = 80, h = 45;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  let sum = 0, sumSq = 0, n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    sum += lum;
    sumSq += lum * lum;
  }
  const avg = sum / n;
  return { brightness: avg, variance: sumSq / n - avg * avg };
}

function qualityChips(q: FrameQuality | null, isSelfie = false): Chip[] {
  if (!q) return [{ text: "Checking camera…", ok: false, warn: true }];
  const chips: Chip[] = [];
  if (q.brightness < 35)       chips.push({ text: "Too dark — add light", ok: false });
  else if (q.brightness > 215) chips.push({ text: "Too bright — reduce light", ok: false, warn: true });
  else                          chips.push({ text: "Lighting good", ok: true });
  if (q.variance < 180)         chips.push({ text: "Hold still", ok: false, warn: true });
  if (isSelfie && q.variance > 180 && q.brightness >= 35 && q.brightness <= 215)
    chips.push({ text: "Ready to capture", ok: true });
  return chips;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────
function useCamera(facing: "environment" | "user") {
  const [status, setStatus] = useState<CamStatus>("starting");
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!navigator?.mediaDevices?.getUserMedia) { setStatus("denied"); return; }
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) { v.srcObject = stream; v.play().catch(() => { if (!cancelled) setStatus("denied"); }); }
      setStatus("live");
    }).catch(() => { if (!cancelled) setStatus("denied"); });
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, [facing]);

  const capture = useCallback((): string | null => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return null;
    c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    return c.toDataURL("image/jpeg", 0.88);
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return { status, videoRef, canvasRef, capture, stop };
}

function useFrameQuality(videoRef: React.RefObject<HTMLVideoElement | null>, active: boolean) {
  const [quality, setQuality] = useState<FrameQuality | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) { setQuality(null); return; }
    if (!cvRef.current) cvRef.current = document.createElement("canvas");
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v || !cvRef.current) return;
      const q = analyzeFrame(v, cvRef.current);
      if (q) setQuality(q);
    }, 600);
    return () => clearInterval(id);
  }, [active, videoRef]);

  return quality;
}

// ─── FakeQR ───────────────────────────────────────────────────────────────────
function FakeQRCode({ size = 160 }: { size?: number }) {
  const N = 21, c = size / N;
  const inFinder = (x: number, y: number, ox: number, oy: number) => {
    const lx = x - ox, ly = y - oy;
    if (lx < 0 || lx > 6 || ly < 0 || ly > 6) return false;
    return lx === 0 || lx === 6 || ly === 0 || ly === 6 || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
  };
  const inZone = (x: number, y: number) =>
    (x <= 7 && y <= 7) || (x >= 13 && y <= 7) || (x <= 7 && y >= 13);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let fill = false;
    if (inFinder(x, y, 0, 0) || inFinder(x, y, 14, 0) || inFinder(x, y, 0, 14)) fill = true;
    else if (!inZone(x, y)) {
      if (x === 6 || y === 6) fill = (x + y) % 2 === 0;
      else fill = (x * 7 + y * 11 + x * y * 3) % 5 < 2;
    }
    if (fill) cells.push({ x, y });
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius: 8, display: "block" }}>
      <rect width={size} height={size} fill="white" />
      {cells.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x * c} y={y * c} width={c - 0.5} height={c - 0.5} fill={INK} />
      ))}
    </svg>
  );
}

// ─── Primitive UI ─────────────────────────────────────────────────────────────
function VeridianMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.1)} viewBox="0 0 28 31" fill="none" aria-hidden="true">
      <path d="M14 1L26 5V15C26 22.5 20.7 27.7 14 30C7.3 27.7 2 22.5 2 15V5L14 1Z" fill={BRAND} />
      <path d="M8 12L14 22L20 12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function ShieldHero() {
  return (
    <div style={{ position: "relative", width: 88, height: 88, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{
        position: "absolute", width: 88, height: 88, borderRadius: "50%",
        background: BRAND, opacity: 0.06,
        animation: "ring-pulse 2s ease-out infinite",
      }} />
      <span style={{
        position: "absolute", width: 88, height: 88, borderRadius: "50%",
        background: BRAND, opacity: 0.04,
        animation: "ring-pulse 2s ease-out 0.7s infinite",
      }} />
      <div style={{
        width: 64, height: 64, borderRadius: 20,
        background: BRAND_L, border: `1.5px solid ${BRAND_G}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <VeridianMark size={32} />
      </div>
    </div>
  );
}

function Btn({ onClick, disabled, loading, children, variant = "primary", small }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean;
  children?: React.ReactNode; variant?: "primary" | "ghost" | "danger"; small?: boolean;
}) {
  const h = small ? 38 : BTN_H;
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: disabled || loading ? "#d1d5db" : BRAND,
      color: disabled || loading ? "#9ca3af" : "#fff",
      boxShadow: disabled || loading ? "none" : `0 2px 12px ${BRAND_G}`,
    },
    ghost: { background: CARD, color: BRAND, border: `1.5px solid ${BRAND}` },
    danger: { background: DANGER_L, color: DANGER, border: `1px solid #fca5a5` },
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled || loading}
      style={{
        width: "100%", minHeight: h, borderRadius: 9999,
        border: "none", cursor: disabled || loading ? "not-allowed" : "pointer",
        fontWeight: 600, fontSize: 15, display: "flex",
        alignItems: "center", justifyContent: "center", gap: 8,
        transition: "opacity 0.15s, transform 0.1s",
        ...styles[variant],
      }}>
      {loading ? (
        <svg style={{ animation: "spin 0.9s linear infinite" }} width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="7" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" />
          <path d="M9 2a7 7 0 0 1 7 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : children}
    </button>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Back"
      style={{
        all: "unset", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 13, fontWeight: 600, color: INK_3,
        marginBottom: 20,
      }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Back
    </button>
  );
}

function Divider() {
  return <div style={{ height: 1, background: BORDER, margin: "16px 0" }} />;
}

function Tag({ children, ok, warn }: { children: React.ReactNode; ok?: boolean; warn?: boolean }) {
  const bg = ok ? OK_L : warn ? WARN_L : DANGER_L;
  const color = ok ? "#065f46" : warn ? "#78350f" : "#991b1b";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "4px 10px", borderRadius: 999,
      background: bg, color, fontFamily: MONO, fontSize: 11, fontWeight: 500,
      letterSpacing: 0.2, whiteSpace: "nowrap",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: ok ? OK : warn ? WARN : DANGER,
        flexShrink: 0,
      }} />
      {children}
    </span>
  );
}

function QualityBar({ chips }: { chips: Chip[] }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
      {chips.map((c, i) => <Tag key={i} ok={c.ok} warn={c.warn}>{c.text}</Tag>)}
    </div>
  );
}

function CaptureFlash({ visible }: { visible: boolean }) {
  return (
    <div style={{
      position: "absolute", inset: 0, borderRadius: "inherit",
      background: "#fff", opacity: visible ? 1 : 0, pointerEvents: "none",
      transition: visible ? "none" : "opacity 0.25s ease-out",
      zIndex: 30,
    }} />
  );
}

// ─── Camera Document Overlay ──────────────────────────────────────────────────
function DocOverlay({ isPassport }: { isPassport: boolean }) {
  const rW = isPassport ? 0.62 : 0.84;
  const rH = isPassport ? 0.68 : 0.52;
  const vW = 300, vH = 420;
  const x0 = (vW * (1 - rW)) / 2, y0 = (vH * (1 - rH)) / 2;
  const w  = vW * rW,            h  = vH * rH;
  const br = 12, bl = 24;

  // Build the vignette path: outer rect minus rounded inner rect (even-odd fill rule)
  const roundedRect = (x: number, y: number, rw: number, rh: number, r: number) =>
    `M${x + r},${y} h${rw - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${rh - 2 * r} a${r},${r} 0 0 1 -${r},${r} h${-(rw - 2 * r)} a${r},${r} 0 0 1 -${r},-${r} v${-(rh - 2 * r)} a${r},${r} 0 0 1 ${r},-${r} Z`;

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${vW} ${vH}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {/* Vignette with hole cut out using even-odd fill */}
      <path
        fillRule="evenodd"
        fill="rgba(0,0,0,0.52)"
        d={`M0,0 h${vW} v${vH} h${-vW} Z ${roundedRect(x0, y0, w, h, br)}`}
      />
      {/* Dashed border */}
      <rect x={x0} y={y0} width={w} height={h} rx={br}
        fill="none" stroke={BRAND} strokeWidth="1.5" strokeDasharray="8 5" />
      {/* Corner brackets */}
      {[
        [x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h],
      ].map(([cx, cy], i) => {
        const sx = i % 2 === 0 ? 1 : -1;
        const sy = i < 2 ? 1 : -1;
        return (
          <path key={i}
            d={`M${cx + sx * bl} ${cy} L${cx} ${cy} L${cx} ${cy + sy * bl}`}
            stroke={BRAND} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        );
      })}
    </svg>
  );
}

// ─── Oval Face Overlay ────────────────────────────────────────────────────────
function FaceOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <mask id="face-mask">
          <rect width="300" height="400" fill="white" />
          <ellipse cx="150" cy="188" rx="104" ry="132" fill="black" />
        </mask>
      </defs>
      <rect width="300" height="400" fill="rgba(0,0,0,0.50)" mask="url(#face-mask)" />
      <ellipse cx="150" cy="188" rx="104" ry="132" fill="none" stroke={BRAND} strokeWidth="2" strokeDasharray="8 5" />
      {/* Corner brackets */}
      <path d="M62 56 L46 56 L46 72"  stroke={BRAND} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M238 56 L254 56 L254 72" stroke={BRAND} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M62 320 L46 320 L46 304" stroke={BRAND} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M238 320 L254 320 L254 304" stroke={BRAND} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Progress Rail ────────────────────────────────────────────────────────────
const RAIL_LABELS = ["Document", "Capture", "Selfie", "Review"];

function ProgressRail({ step }: { step: 0 | 1 | 2 | 3 }) {
  return (
    <div style={{ padding: "12px 20px 0" }}>
      <div style={{ display: "flex", gap: 5 }}>
        {RAIL_LABELS.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= step ? BRAND : "rgba(255,255,255,0.10)",
            transition: "background 0.3s",
          }} />
        ))}
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between", marginTop: 8,
        fontFamily: MONO, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase",
      }}>
        {RAIL_LABELS.map((l, i) => (
          <span key={i} style={{
            color: i === step ? BRAND : i < step ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.2)",
            fontWeight: i === step ? 600 : 400,
          }}>{l}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────
function TopBar({ onBack, step }: { onBack?: () => void; step?: 0 | 1 | 2 | 3 }) {
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px 10px",
      }}>
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Back" style={{
            all: "unset", cursor: "pointer",
            width: 36, height: 36, borderRadius: 8,
            background: "rgba(255,255,255,0.07)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8 2L3 7l5 5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : <div style={{ width: 36 }} />}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <VeridianMark size={18} />
          <span style={{ fontWeight: 700, fontSize: 14, color: "#fff", letterSpacing: -0.2 }}>Veridian</span>
        </div>
        <div style={{ width: 36 }} />
      </div>
      {step !== undefined && <ProgressRail step={step} />}
    </div>
  );
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} style={{
      background: CARD, borderRadius: 20,
      boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
      overflow: "hidden",
    }}>
      {children}
    </div>
  );
}

// ─── Country Picker ────────────────────────────────────────────────────────────
function CountryPicker({ value, onChange }: { value: Country | null; onChange: (c: Country) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = q ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : COUNTRIES;
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: INK_3, display: "block", marginBottom: 6, letterSpacing: 0.3 }}>
        Issuing country
      </label>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{
        all: "unset", cursor: "pointer", boxSizing: "border-box",
        width: "100%", minHeight: BTN_H, borderRadius: R,
        padding: "0 14px",
        display: "flex", alignItems: "center", gap: 10,
        background: SURFACE, border: `1.5px solid ${open ? BRAND : BORDER}`,
        transition: "border-color 0.15s",
      }}>
        {value && <span style={{ fontSize: 20 }}>{value.flag}</span>}
        <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: value ? INK : INK_4 }}>
          {value ? value.name : "Select country"}
        </span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
          <path d="M4 6l4 4 4-4" stroke={INK_3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div style={{
          marginTop: 6, borderRadius: R, overflow: "hidden",
          border: `1px solid ${BORDER}`,
          background: CARD, boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${BORDER}` }}>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search…" style={{
                width: "100%", outline: "none",
                border: `1px solid ${BORDER}`, borderRadius: 8,
                padding: "7px 12px", fontSize: 14, boxSizing: "border-box",
                background: SURFACE,
              }} />
          </div>
          <div style={{ maxHeight: 230, overflowY: "auto" }}>
            {filtered.length === 0 && <p style={{ textAlign: "center", padding: 16, fontSize: 13, color: INK_3 }}>No results</p>}
            {filtered.map((c) => (
              <button key={c.code} type="button" onClick={() => { onChange(c); setOpen(false); setQ(""); }} style={{
                all: "unset", cursor: "pointer", boxSizing: "border-box",
                width: "100%", padding: "11px 14px",
                display: "flex", alignItems: "center", gap: 10,
                background: value?.code === c.code ? BRAND_L : "transparent",
              }}>
                <span style={{ fontSize: 18 }}>{c.flag}</span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: INK }}>{c.name}</span>
                {value?.code === c.code && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7l3.5 3.5L12 3" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Doc Type Row ──────────────────────────────────────────────────────────────
function DocTypeRow({ label, meta, badge, selected, onClick }: {
  label: string; meta: string; badge?: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={{
      all: "unset", cursor: "pointer", boxSizing: "border-box",
      width: "100%", padding: "13px 14px",
      display: "flex", alignItems: "center", gap: 12,
      borderRadius: R, border: `1.5px solid ${selected ? BRAND : BORDER}`,
      background: selected ? BRAND_L : SURFACE,
      transition: "all 0.15s",
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 8, flexShrink: 0,
        background: selected ? BRAND_G : BORDER,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="2" width="14" height="16" rx="2" stroke={selected ? BRAND : INK_3} strokeWidth="1.6" />
          <line x1="6" y1="8" x2="14" y2="8" stroke={selected ? BRAND : INK_3} strokeWidth="1.4" strokeLinecap="round" />
          <line x1="6" y1="11" x2="11" y2="11" stroke={selected ? BRAND : INK_3} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: selected ? BRAND_D : INK }}>{label}</span>
          {badge && (
            <span style={{
              fontFamily: MONO, fontSize: 9, letterSpacing: 0.5, fontWeight: 500,
              color: BRAND, background: BRAND_L, padding: "2px 7px", borderRadius: 999,
              textTransform: "uppercase",
            }}>{badge}</span>
          )}
        </div>
        <span style={{ fontSize: 12, color: INK_3, marginTop: 2, display: "block" }}>{meta}</span>
      </div>
      {selected && (
        <div style={{
          width: 20, height: 20, borderRadius: "50%", background: BRAND,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5l2 2 5-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </button>
  );
}

// ─── SCREEN: Entry (Desktop QR handoff) ──────────────────────────────────────
function EntryScreen({ token: _token, onContinue }: { token: string; onContinue: () => void }) {
  const [pageUrl, setPageUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { setPageUrl(window.location.href); }, []);

  const qrSrc = pageUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pageUrl)}`
    : "";

  const handleCopy = () => {
    if (!pageUrl) return;
    navigator.clipboard?.writeText(pageUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="animate-fade-up" style={{ padding: "0 20px 32px" }}>
      <div style={{
        background: "#0d1a14", borderRadius: 20,
        boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
        overflow: "hidden",
      }}>
        <div style={{ padding: "36px 28px 32px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <VeridianMark size={44} />
          </div>
          <h1 style={{
            fontSize: 26, fontWeight: 700, color: "#fff", letterSpacing: -0.4,
            margin: "0 0 12px",
          }}>
            Open on your phone
          </h1>
          <p style={{
            fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.6,
            margin: "0 0 28px", maxWidth: 280, marginLeft: "auto", marginRight: "auto",
          }}>
            Camera is required for verification. Scan this code with your phone camera.
          </p>

          <div style={{
            display: "inline-flex", padding: 16,
            background: "#fff", borderRadius: 16,
            boxShadow: "0 2px 16px rgba(0,0,0,0.18)",
            marginBottom: 24,
          }}>
            {qrSrc ? (
              <img src={qrSrc} alt="Verification QR code" width={200} height={200}
                style={{ display: "block", borderRadius: 8 }} />
            ) : (
              <div style={{
                width: 200, height: 200, borderRadius: 8,
                background: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg style={{ animation: "spin 0.9s linear infinite" }} width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <circle cx="14" cy="14" r="11" stroke="#e5e7eb" strokeWidth="2.5" />
                  <path d="M14 3a11 11 0 0 1 11 11" stroke={BRAND} strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 28 }}>
            <button type="button" onClick={handleCopy} style={{
              all: "unset", cursor: "pointer", boxSizing: "border-box",
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "10px 24px", borderRadius: 9999,
              border: "1.5px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.07)",
              fontSize: 13, fontWeight: 600,
              color: copied ? "#4ade80" : "rgba(255,255,255,0.75)",
              transition: "all 0.15s",
            }}>
              {copied ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7l3.5 3.5L12 3" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="4" y="1.5" width="7.5" height="9.5" rx="1" stroke="rgba(255,255,255,0.6)" strokeWidth="1.3" />
                    <rect x="2" y="3" width="7.5" height="9.5" rx="1" stroke="rgba(255,255,255,0.6)" strokeWidth="1.3" fill="rgba(255,255,255,0.07)" />
                  </svg>
                  Or copy link
                </>
              )}
            </button>
          </div>

          <p style={{
            fontFamily: MONO, fontSize: 10, color: "rgba(255,255,255,0.2)",
            letterSpacing: 0.5, margin: 0,
          }}>
            Secured by Veridian · End-to-end encrypted
          </p>
        </div>

        <div style={{ padding: "0 28px 28px" }}>
          <button type="button" onClick={onContinue} style={{
            all: "unset", cursor: "pointer", boxSizing: "border-box",
            width: "100%", minHeight: BTN_H, borderRadius: 9999,
            border: "1.5px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.06)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.45)",
          }}>
            Continue on this device
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SCREEN: Welcome ──────────────────────────────────────────────────────────
function WelcomeScreen({ onNext }: { onNext: () => void }) {
  return (
    <div className="animate-fade-up" style={{ padding: "0 20px 32px" }}>
      <Card>
        <div style={{ padding: "32px 24px 24px" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
            <div style={{ position: "relative", width: 80, height: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{
                position: "absolute", width: 80, height: 80, borderRadius: "50%",
                background: BRAND, opacity: 0.06,
                animation: "ring-pulse 3s ease-out infinite",
              }} />
              <span style={{
                position: "absolute", width: 80, height: 80, borderRadius: "50%",
                background: BRAND, opacity: 0.04,
                animation: "ring-pulse 3s ease-out 1s infinite",
              }} />
              <div style={{
                width: 60, height: 60, borderRadius: 18,
                background: BRAND_L, border: `1.5px solid ${BRAND_G}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <VeridianMark size={30} />
              </div>
            </div>
          </div>
          <h1 style={{
            fontSize: 28, fontWeight: 400, color: INK, letterSpacing: -0.5,
            textAlign: "center", margin: "0 0 8px",
            fontFamily: 'var(--font-serif,"Instrument Serif",Georgia,serif)',
          }}>
            Verify your identity
          </h1>
          <p style={{ fontSize: 14, color: INK_3, textAlign: "center", lineHeight: 1.6, margin: "0 0 28px" }}>
            Quick and secure. Takes about 2 minutes.
          </p>

          <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
            {[
              { emoji: "📄", label: "Your ID document" },
              { emoji: "🤳", label: "A quick selfie" },
              { emoji: "⏱", label: "About 2 minutes" },
            ].map(({ emoji, label }) => (
              <div key={label} style={{
                flex: 1, background: SURFACE, borderRadius: 12,
                border: `1px solid ${BORDER}`,
                padding: "14px 8px", textAlign: "center",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              }}>
                <span style={{ fontSize: 24 }}>{emoji}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: INK_2, lineHeight: 1.3 }}>{label}</span>
              </div>
            ))}
          </div>

          <Btn onClick={onNext}>
            Get started
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Btn>

          <div style={{
            marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center",
            gap: 6, fontFamily: MONO, fontSize: 10, color: INK_4, letterSpacing: 0.4,
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="2" y="4.5" width="6" height="4.5" rx="0.5" stroke={INK_4} strokeWidth="1" />
              <path d="M3.5 4.5V3C3.5 1.9 4.1 1 5 1s1.5.9 1.5 2v1.5" stroke={INK_4} strokeWidth="1" fill="none" />
            </svg>
            End-to-end encrypted · Powered by Veridian
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── SCREEN: DocSelect ────────────────────────────────────────────────────────
function DocSelectScreen({ country, docType, onCountry, onDocType, onNext, onBack }: {
  country: Country | null; docType: DocType | null;
  onCountry: (c: Country) => void; onDocType: (d: DocType) => void;
  onNext: () => void; onBack: () => void;
}) {
  return (
    <div className="animate-slide-fwd" style={{ padding: "20px 20px 32px" }}>
      <BackBtn onClick={onBack} />
      <Card>
        <div style={{ padding: "24px 20px" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: INK, letterSpacing: -0.4, margin: "0 0 4px" }}>
            Select your document
          </h2>
          <p style={{ fontSize: 13, color: INK_3, margin: "0 0 20px" }}>Choose the country that issued it</p>

          <CountryPicker value={country} onChange={(c) => { onCountry(c); onDocType(null as unknown as DocType); }} />

          {country && (
            <div style={{ marginTop: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: INK_3, display: "block", marginBottom: 10, letterSpacing: 0.3 }}>
                Document type
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {DOC_TYPES.map(({ value, label, meta }) => (
                  <DocTypeRow key={value}
                    label={label} meta={meta}
                    badge={value === "passport" ? "Recommended" : undefined}
                    selected={docType === value}
                    onClick={() => onDocType(value)}
                  />
                ))}
              </div>
            </div>
          )}

          {country && docType && (
            <div style={{ marginTop: 20 }}>
              <Btn onClick={onNext}>
                Continue
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Btn>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Live Camera View ─────────────────────────────────────────────────────────
function LiveCam({ facing, overlay, onCapture, onDenied }: {
  facing: "environment" | "user";
  overlay: React.ReactNode;
  onCapture: (dataUrl: string) => void;
  onDenied: () => void;
}) {
  const { status, videoRef, canvasRef, capture } = useCamera(facing);
  const quality = useFrameQuality(videoRef, status === "live");
  const chips = qualityChips(quality, facing === "user");
  const [flash, setFlash] = useState(false);

  useEffect(() => { if (status === "denied") onDenied(); }, [status, onDenied]);

  const handleCapture = () => {
    setFlash(true);
    setTimeout(() => setFlash(false), 280);
    setTimeout(() => {
      const d = capture();
      if (d) onCapture(d);
    }, 80); // slight delay so flash is visible
  };

  if (status === "starting") {
    return (
      <div style={{
        aspectRatio: "3/4", background: "#0a0a0a",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
      }}>
        <svg style={{ animation: "spin 0.9s linear infinite" }} width="36" height="36" viewBox="0 0 36 36" fill="none">
          <circle cx="18" cy="18" r="14" stroke="rgba(255,255,255,0.10)" strokeWidth="3" />
          <path d="M18 4a14 14 0 0 1 14 14" stroke={BRAND} strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Starting camera…</p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      <div style={{ position: "relative", aspectRatio: "3/4", background: "#000", overflow: "hidden" }}>
        <video ref={videoRef} autoPlay muted playsInline
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover",
            transform: facing === "user" ? "scaleX(-1)" : "none",
          }} aria-label="Camera feed" />
        {overlay}
        <CaptureFlash visible={flash} />
      </div>

      {/* Quality chips */}
      <div style={{
        position: "absolute", bottom: 88, left: 0, right: 0,
        display: "flex", justifyContent: "center", padding: "0 16px",
      }}>
        <QualityBar chips={chips} />
      </div>

      {/* Capture button */}
      <div style={{
        position: "absolute", bottom: 20, left: 0, right: 0,
        display: "flex", justifyContent: "center",
      }}>
        <button type="button" onClick={handleCapture} aria-label="Capture photo"
          style={{
            all: "unset", cursor: "pointer",
            width: 68, height: 68, borderRadius: "50%",
            background: BRAND, border: "4px solid rgba(255,255,255,0.85)",
            boxShadow: `0 0 0 3px ${BRAND}, 0 6px 24px ${BRAND_G}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "transform 0.1s",
          }}>
          <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(255,255,255,0.75)" }} />
        </button>
      </div>

      <canvas ref={canvasRef} style={{ display: "none" }} aria-hidden="true" />
    </div>
  );
}

// ─── Upload fallback (camera denied) ─────────────────────────────────────────
function UploadFallback({ label, onFile }: {
  label: string; onFile: (dataUrl: string) => void;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    onFile(await fileToDataUrl(f)); e.target.value = "";
  };

  return (
    <div style={{ padding: "20px 20px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px", borderRadius: R, background: WARN_L, border: `1px solid #fcd34d`,
      }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
          <path d="M9 3L1.5 15h15L9 3z" stroke={WARN} strokeWidth="1.5" strokeLinejoin="round" />
          <line x1="9" y1="8" x2="9" y2="11" stroke={WARN} strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="9" cy="13" r="0.75" fill={WARN} />
        </svg>
        <p style={{ fontSize: 12, color: "#78350f", lineHeight: 1.45 }}>
          Camera access denied. Upload a photo of your {label} instead.
        </p>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />
      <input ref={libRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
      <Btn onClick={() => camRef.current?.click()}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 5h2.5l1-1.5h5l1 1.5H14v9H2V5z" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" fill="none" />
          <circle cx="8" cy="10" r="2.2" stroke="#fff" strokeWidth="1.4" />
        </svg>
        Take a photo
      </Btn>
      <Btn variant="ghost" onClick={() => libRef.current?.click()}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="10" rx="1.5" stroke={INK_3} strokeWidth="1.4" />
          <circle cx="5.5" cy="6.5" r="1.2" stroke={INK_3} strokeWidth="1.3" />
          <path d="M2 11l3-3 3 3 2-2 4 4" stroke={INK_3} strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        Choose from library
      </Btn>
    </div>
  );
}

// ─── Image preview ─────────────────────────────────────────────────────────────
function ImagePreviewCard({ src, quality, onRetake, onContinue, continueLabel, submitting }: {
  src: string; quality: string | null; onRetake: () => void;
  onContinue: () => void; continueLabel?: string; submitting?: boolean;
}) {
  return (
    <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      {quality && (
        <div style={{
          display: "flex", gap: 10, alignItems: "flex-start",
          padding: "10px 14px", borderRadius: R, background: WARN_L, border: `1px solid #fcd34d`,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M8 2L1 14h14L8 2z" stroke={WARN} strokeWidth="1.4" strokeLinejoin="round" />
            <line x1="8" y1="7" x2="8" y2="10" stroke={WARN} strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="12" r="0.7" fill={WARN} />
          </svg>
          <p style={{ fontSize: 12, color: "#78350f", lineHeight: 1.5 }}>{quality}</p>
        </div>
      )}
      <div style={{ position: "relative", borderRadius: R, overflow: "hidden", background: SURFACE }}>
        <img src={src} alt="Captured" style={{ width: "100%", display: "block", maxHeight: 280, objectFit: "cover" }} />
        <div style={{
          position: "absolute", top: 10, right: 10,
          display: "flex", gap: 5, padding: "5px 10px", borderRadius: 999,
          background: "rgba(15,110,86,0.88)", color: "#fff", fontSize: 11, fontWeight: 600,
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5l2 2 5-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Captured
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Btn onClick={onContinue} loading={submitting}>{!submitting && (continueLabel ?? "Use this photo")}</Btn>
        <Btn variant="ghost" onClick={onRetake}>Retake</Btn>
      </div>
    </div>
  );
}

// ─── QR Screen (inside flow) ──────────────────────────────────────────────────
function QRFlowScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const url = `https://verify.veridianapi.com/s/${token}`;
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ padding: "0 20px 32px" }}>
      <BackBtn onClick={onBack} />
      <Card>
        <div style={{ padding: "24px 20px" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: "0 0 6px" }}>Continue on another device</h2>
          <p style={{ fontSize: 13, color: INK_3, margin: "0 0 20px", lineHeight: 1.5 }}>
            Scan this code with your phone camera to open the verification there.
          </p>
          <div style={{ display: "flex", justifyContent: "center", padding: "16px", background: SURFACE, borderRadius: 14, marginBottom: 16 }}>
            <FakeQRCode size={160} />
          </div>
          <div style={{ padding: "10px 14px", borderRadius: R, background: SURFACE, border: `1px solid ${BORDER}`, marginBottom: 14 }}>
            <p style={{ fontFamily: MONO, fontSize: 11, color: INK_3, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</p>
          </div>
          <Btn onClick={() => { navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2200); }); }}>
            {copied ? "✓ Copied!" : "Copy link"}
          </Btn>
        </div>
      </Card>
    </div>
  );
}

// ─── SCREEN: DocCapture ───────────────────────────────────────────────────────
function DocCaptureScreen({ docLabel, docTypeVal, hasBack, country, onFront, onBack: onBackDoc, onBack2 }: {
  docLabel: string; docTypeVal: DocType; hasBack: boolean; country: Country | null;
  onFront: (front: string, frontQ: string | null) => void;
  onBack2: (back: string, backQ: string | null) => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<CapturePhase>("front-cam");
  const [frontImg, setFrontImg] = useState<string | null>(null);
  const [frontQ, setFrontQ] = useState<string | null>(null);
  const [camDenied, setCamDenied] = useState(false);
  const [camKey, setCamKey] = useState(0);
  const libRef = useRef<HTMLInputElement>(null);

  const handleCaptureFront = async (dataUrl: string) => {
    const q = await checkImageQuality(dataUrl);
    setFrontImg(dataUrl); setFrontQ(q); setPhase("front-preview");
  };

  const handleCaptureBack = async (dataUrl: string) => {
    const q = await checkImageQuality(dataUrl);
    onBack2(dataUrl, q);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const dataUrl = await fileToDataUrl(f); e.target.value = "";
    if (phase === "front-cam") await handleCaptureFront(dataUrl);
    else if (phase === "back-cam") await handleCaptureBack(dataUrl);
  };

  // Front camera
  if (phase === "front-cam") {
    const isPassport = docTypeVal === "passport";
    return (
      <div className="animate-slide-fwd" style={{ padding: "0 20px 32px" }}>
        <BackBtn onClick={onBackDoc} />
        <Card>
          <div style={{ padding: "16px 20px 12px" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: "0 0 4px" }}>
              {isPassport ? "Open to the photo page" : `Front of your ${docLabel.toLowerCase()}`}
            </h2>
            <p style={{ fontSize: 13, color: INK_3, margin: 0, lineHeight: 1.45 }}>
              {isPassport
                ? "Place the photo page flat in good light. All corners must be visible."
                : "Hold the document flat. Ensure all four corners are in frame."}
            </p>
          </div>
          {camDenied ? (
            <UploadFallback
              label={docLabel.toLowerCase()}
              onFile={handleCaptureFront}
            />
          ) : (
            <LiveCam
              key={camKey}
              facing="environment"
              overlay={<DocOverlay isPassport={isPassport} />}
              onCapture={handleCaptureFront}
              onDenied={() => setCamDenied(true)}
            />
          )}
        </Card>
      </div>
    );
  }

  // Front preview
  if (phase === "front-preview" && frontImg) {
    return (
      <div className="animate-slide-fwd" style={{ padding: "0 20px 32px" }}>
        <BackBtn onClick={() => { setFrontImg(null); setFrontQ(null); setPhase("front-cam"); setCamKey((k) => k + 1); }} />
        <Card>
          <div style={{ padding: "16px 20px 0" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: "0 0 4px" }}>Check the front</h2>
            <p style={{ fontSize: 13, color: INK_3, margin: 0 }}>All text visible and corners in frame?</p>
          </div>
          <ImagePreviewCard
            src={frontImg} quality={frontQ}
            onRetake={() => { setFrontImg(null); setFrontQ(null); setPhase("front-cam"); setCamKey((k) => k + 1); }}
            onContinue={() => {
              if (hasBack) setPhase("back-cam");
              else onFront(frontImg, frontQ);
            }}
            continueLabel={hasBack ? "Continue to back" : "Use this photo"}
          />
        </Card>
      </div>
    );
  }

  // Back camera
  if (phase === "back-cam") {
    return (
      <div className="animate-slide-fwd" style={{ padding: "0 20px 32px" }}>
        <BackBtn onClick={() => setPhase("front-preview")} />
        <Card>
          <div style={{ padding: "16px 20px 12px" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: "0 0 4px" }}>Flip to the back</h2>
            <p style={{ fontSize: 13, color: INK_3, margin: 0, lineHeight: 1.45 }}>
              Now photograph the back of your {docLabel.toLowerCase()}.
            </p>
          </div>
          {camDenied ? (
            <UploadFallback label={`back of ${docLabel.toLowerCase()}`} onFile={handleCaptureBack} />
          ) : (
            <LiveCam
              key={`back-${camKey}`}
              facing="environment"
              overlay={<DocOverlay isPassport={false} />}
              onCapture={handleCaptureBack}
              onDenied={() => setCamDenied(true)}
            />
          )}
        </Card>
        {/* Also continue front when hasBack but back not yet captured — pass front data */}
        <div style={{ marginTop: 12 }}>
          <Btn variant="ghost" onClick={() => onFront(frontImg!, frontQ)}>
            Skip back side
          </Btn>
        </div>
      </div>
    );
  }

  return null;
}

async function checkImageQuality(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.min(img.width, 120), h = Math.min(img.height, 120);
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const brightness = sum / (d.length / 4);
        if (brightness < 40)  resolve("Image appears too dark. Try in better lighting.");
        else if (brightness > 220) resolve("Image appears overexposed. Reduce glare or brightness.");
        else resolve(null);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ─── SCREEN: Selfie ────────────────────────────────────────────────────────────
function SelfieScreen({ image, onCapture, onClear, onSubmit, onBack, submitting }: {
  image: string | null; onCapture: (d: string) => void; onClear: () => void;
  onSubmit: () => void; onBack: () => void; submitting: boolean;
}) {
  const [camDenied, setCamDenied] = useState(false);
  const [selfieQ, setSelfieQ] = useState<string | null>(null);
  const [camKey, setCamKey] = useState(0);
  const libRef = useRef<HTMLInputElement>(null);

  const handleCapture = async (dataUrl: string) => {
    const q = await checkImageQuality(dataUrl);
    setSelfieQ(q); onCapture(dataUrl);
  };

  const retake = () => { setSelfieQ(null); onClear(); setCamKey((k) => k + 1); };

  if (image) {
    return (
      <div className="animate-slide-fwd" style={{ padding: "0 20px 32px" }}>
        <BackBtn onClick={retake} />
        <Card>
          <div style={{ padding: "16px 20px 0" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: "0 0 4px" }}>Check your selfie</h2>
            <p style={{ fontSize: 13, color: INK_3, margin: 0 }}>Face clearly visible and well-lit?</p>
          </div>
          <ImagePreviewCard
            src={image} quality={selfieQ}
            onRetake={retake}
            onContinue={onSubmit}
            continueLabel="Submit verification"
            submitting={submitting}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-slide-fwd" style={{ padding: "0 20px 32px" }}>
      <BackBtn onClick={onBack} />
      <Card>
        <div style={{ padding: "16px 20px 12px" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: "0 0 4px" }}>Take a selfie</h2>
          <p style={{ fontSize: 13, color: INK_3, margin: 0, lineHeight: 1.45 }}>
            Position your face inside the oval. Look directly at the camera.
          </p>
        </div>
        {camDenied ? (
          <UploadFallback label="selfie" onFile={handleCapture} />
        ) : (
          <LiveCam
            key={camKey}
            facing="user"
            overlay={<FaceOverlay />}
            onCapture={handleCapture}
            onDenied={() => setCamDenied(true)}
          />
        )}
      </Card>
    </div>
  );
}

// ─── SCREEN: Processing ────────────────────────────────────────────────────────
const PROC_STEPS = [
  { label: "Uploading documents",   meta: "Secure transfer" },
  { label: "Reading document",      meta: "MRZ + visual fields" },
  { label: "Checking sanctions",    meta: "134 global watchlists" },
  { label: "Matching faces",        meta: "Biometric comparison" },
];

function ProcessingScreen({ step }: { step: number }) {
  return (
    <div className="animate-fade-up" style={{ padding: "0 20px 32px" }}>
      <Card>
        <div style={{ padding: "32px 20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
            <svg style={{ animation: "spin 1.2s linear infinite" }} width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="20" stroke={BORDER} strokeWidth="4" />
              <path d="M24 4a20 20 0 0 1 20 20" stroke={BRAND} strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: INK, textAlign: "center", margin: "0 0 6px" }}>
            Verifying your identity
          </h2>
          <p style={{ fontSize: 13, color: INK_3, textAlign: "center", margin: "0 0 24px", lineHeight: 1.5 }}>
            Please keep this window open
          </p>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {PROC_STEPS.map(({ label, meta }, i) => {
              const done   = i < step;
              const active = i === step;
              const pend   = i > step;
              return (
                <div key={label} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "12px 0",
                  borderBottom: i < PROC_STEPS.length - 1 ? `1px solid ${BORDER}` : "none",
                  opacity: pend ? 0.35 : 1,
                  transition: "opacity 0.3s",
                  animation: active ? "step-appear 0.25s ease-out both" : "none",
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                    background: done ? BRAND : active ? BRAND_L : SURFACE,
                    border: active ? `2px solid ${BRAND}` : done ? "none" : `1.5px solid ${BORDER}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.3s",
                  }}>
                    {done ? (
                      <svg width="15" height="15" viewBox="0 0 13 13" fill="none">
                        <path d="M2 6.5l3 3 6-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : active ? (
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: BRAND, animation: "ring-pulse 1.4s ease-out infinite" }} />
                    ) : (
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: BORDER }} />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: done || active ? 600 : 400, color: done || active ? INK : INK_3, margin: 0 }}>{label}</p>
                    <p style={{ fontFamily: MONO, fontSize: 10, color: INK_4, margin: "2px 0 0", letterSpacing: 0.3 }}>{meta}</p>
                  </div>
                  {done && (
                    <span style={{ fontFamily: MONO, fontSize: 10, color: BRAND, letterSpacing: 0.6, textTransform: "uppercase" as const }}>Done</span>
                  )}
                  {active && (
                    <span style={{ fontFamily: MONO, fontSize: 10, color: BRAND, letterSpacing: 0.6, textTransform: "uppercase" as const }}>Running</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ padding: "0 20px 20px" }}>
          <div style={{
            padding: "12px 14px", borderRadius: R, background: SURFACE, border: `1px solid ${BORDER}`,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke={INK_3} strokeWidth="1.4" />
              <path d="M5 7V5.5A3 3 0 0 1 11 5.5V7" stroke={INK_3} strokeWidth="1.4" fill="none" />
            </svg>
            <p style={{ fontFamily: MONO, fontSize: 10, color: INK_3, margin: 0, letterSpacing: 0.4 }}>
              AES-256 · ISO 27001 · SOC 2 TYPE II
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── SCREEN: Result ────────────────────────────────────────────────────────────
function ResultScreen({ result, onRetry }: { result: VerificationResult; onRetry: () => void }) {
  return (
    <div className="animate-fade-up" style={{ padding: "0 20px 32px" }}>
      <Card>
        <div style={{ padding: "40px 24px 32px", textAlign: "center" }}>
          {result.success ? (
            <>
              <div style={{
                background: "linear-gradient(135deg, #0f6e56 0%, #0a5c46 100%)",
                margin: "-40px -24px 28px",
                padding: "36px 24px 32px",
                display: "flex", justifyContent: "center",
              }}>
                <div className="animate-scale-in" style={{ width: 96, height: 96 }}>
                  <svg width="96" height="96" viewBox="0 0 96 96" fill="none">
                    <circle cx="48" cy="48" r="44" fill="rgba(255,255,255,0.15)" />
                    <circle cx="48" cy="48" r="40" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
                    <path
                      d="M30 48l13 13 23-25"
                      stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
                      strokeDasharray="58" strokeDashoffset="58"
                      className="animate-check-draw"
                    />
                  </svg>
                </div>
              </div>
              <h2 style={{
                fontSize: 26, fontWeight: 400, color: INK, letterSpacing: -0.4, margin: "0 0 10px",
                fontFamily: 'var(--font-serif,"Instrument Serif",Georgia,serif)',
              }}>
                Verification complete
              </h2>
              <p style={{ fontSize: 14, color: INK_3, lineHeight: 1.6, margin: 0 }}>
                You can close this window.
              </p>
            </>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                <div className="animate-scale-in" style={{ width: 84, height: 84 }}>
                  <svg width="84" height="84" viewBox="0 0 84 84" fill="none">
                    <circle cx="42" cy="42" r="38" fill={DANGER_L} />
                    <circle cx="42" cy="42" r="34" stroke={DANGER} strokeWidth="2.5" />
                    <path d="M28 28l28 28M56 28L28 56" stroke={DANGER} strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: INK, letterSpacing: -0.4, margin: "0 0 10px" }}>
                Verification failed
              </h2>
              <p style={{ fontSize: 14, color: INK_3, lineHeight: 1.6, margin: "0 0 24px" }}>
                {result.error ?? "Something went wrong. Please try again."}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Btn onClick={onRetry}>Try again</Btn>
                <a href="mailto:support@veridianapi.com" style={{ all: "unset" }}>
                  <Btn variant="ghost">Contact support</Btn>
                </a>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export function VerificationFlow({ token }: { token: string }) {
  const [flowStep, setFlowStep]   = useState<FlowStep>("detecting");
  const [dir, setDir]             = useState<Direction>("forward");
  const [country, setCountry]     = useState<Country | null>(null);
  const [docType, setDocType]     = useState<DocType | null>(null);
  const [docFront, setDocFront]   = useState<string | null>(null);
  const [docFrontQ, setDocFrontQ] = useState<string | null>(null);
  const [docBack, setDocBack]     = useState<string | null>(null);
  const [docBackQ, setDocBackQ]   = useState<string | null>(null);
  const [selfie, setSelfie]       = useState<string | null>(null);
  const [procStep, setProcStep]   = useState(0);
  const [result, setResult]       = useState<VerificationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Detect desktop on client
  useEffect(() => {
    const isPhone = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
    setFlowStep(isPhone ? "welcome" : "entry");
  }, []);

  const go = useCallback((to: FlowStep, d: Direction = "forward") => {
    setDir(d); setFlowStep(to);
  }, []);

  const docInfo   = DOC_TYPES.find((d) => d.value === docType);
  const docLabel  = docInfo?.label ?? "document";
  const needsBack = docInfo?.hasBack ?? false;

  const handleFrontCaptured = (front: string, q: string | null) => {
    setDocFront(front); setDocFrontQ(q);
    go("selfie");
  };

  const handleBackCaptured = (back: string, q: string | null) => {
    setDocBack(back); setDocBackQ(q);
    go("selfie");
  };

  const handleSubmit = async () => {
    if (!docFront || !selfie || !docType || submitting) return;
    setSubmitting(true);
    go("processing");
    setProcStep(0);
    await delay(900);  setProcStep(1);
    await delay(1050); setProcStep(2);
    const [res] = await Promise.all([
      submitVerification(token, {
        document_front: stripPfx(docFront),
        ...(docBack ? { document_back: stripPfx(docBack) } : {}),
        selfie: stripPfx(selfie),
        document_type: docType,
      }),
      delay(980),
    ]);
    setProcStep(3);
    await delay(850);
    setProcStep(4);
    await delay(350);
    setResult(res);
    setSubmitting(false);
    go("result");
  };

  const railStep = (): 0 | 1 | 2 | 3 => {
    if (flowStep === "doc-select") return 0;
    if (flowStep === "doc-capture") return 1;
    if (flowStep === "selfie") return 2;
    return 3;
  };

  const showRail = !["detecting", "entry", "welcome", "processing", "result"].includes(flowStep);
  const anim = dir === "forward" ? "animate-slide-fwd" : "animate-slide-bwd";

  const renderStep = () => {
    if (flowStep === "detecting") return null;

    if (flowStep === "entry") {
      return <EntryScreen token={token} onContinue={() => go("welcome")} />;
    }

    if (flowStep === "welcome") {
      return <WelcomeScreen onNext={() => go("doc-select")} />;
    }

    if (flowStep === "doc-select") {
      return (
        <DocSelectScreen
          country={country} docType={docType}
          onCountry={(c) => { setCountry(c); setDocType(null); setDocFront(null); setDocBack(null); }}
          onDocType={(d) => { setDocType(d); setDocFront(null); setDocBack(null); }}
          onNext={() => go("doc-capture")}
          onBack={() => go("welcome", "backward")}
        />
      );
    }

    if (flowStep === "doc-capture") {
      return (
        <DocCaptureScreen
          docLabel={docLabel}
          docTypeVal={docType ?? "passport"}
          hasBack={needsBack}
          country={country}
          onFront={handleFrontCaptured}
          onBack2={handleBackCaptured}
          onBack={() => go("doc-select", "backward")}
        />
      );
    }

    if (flowStep === "selfie") {
      return (
        <SelfieScreen
          image={selfie}
          onCapture={setSelfie}
          onClear={() => setSelfie(null)}
          onSubmit={handleSubmit}
          onBack={() => go("doc-capture", "backward")}
          submitting={submitting}
        />
      );
    }

    if (flowStep === "processing") {
      return <ProcessingScreen step={procStep} />;
    }

    if (flowStep === "result" && result) {
      return <ResultScreen result={result} onRetry={() => { setResult(null); setDocFront(null); setDocBack(null); setSelfie(null); go("welcome"); }} />;
    }

    return null;
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column" }}>
      <div style={{ width: "100%", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        {/* Top bar */}
        <TopBar
          onBack={["doc-select", "doc-capture", "selfie"].includes(flowStep) ? (() => {
            if (flowStep === "doc-select") go("welcome", "backward");
            else if (flowStep === "doc-capture") go("doc-select", "backward");
            else if (flowStep === "selfie") go("doc-capture", "backward");
          }) : undefined}
          step={showRail ? railStep() : undefined}
        />

        {/* Content */}
        <div style={{ flex: 1, paddingTop: showRail ? 16 : 24 }}>
          <div key={flowStep} className={anim}>
            {renderStep()}
          </div>
        </div>

        {/* Footer */}
        <p style={{
          textAlign: "center", fontSize: 11, padding: "16px 20px",
          fontFamily: MONO, color: "rgba(255,255,255,0.08)", letterSpacing: 0.5,
        }}>
          Secured by Veridian · End-to-end encrypted
        </p>
      </div>
    </div>
  );
}
