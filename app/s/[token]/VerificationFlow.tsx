"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { submitVerification, getSession, type VerificationResult } from "./actions";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const BG       = "#050a09";
const CARD     = "#ffffff";
const BRAND    = "#0f6e56";
const BRAND_D  = "#0a5240";
const BRAND_L  = "rgba(15,110,86,0.08)";
const INK      = "#111827";
const INK_3    = "#6b7280";
const INK_4    = "#9ca3af";
const BORDER   = "#e5e7eb";
const SURFACE  = "#f9fafb";
const DANGER   = "#dc2626";
const DANGER_L = "rgba(220,38,38,0.08)";
const WARN     = "#d97706";
const OK       = "#16a34a";
const OK_L     = "rgba(22,163,74,0.08)";
const BTN_H    = 52;
// Dark overlay text (camera screens)
const INK_D    = "#f0f4f3";
const INK_D3   = "#a3b3ae";

// ─── Types ───────────────────────────────────────────────────────────────────
type FlowStep =
  | "detecting" | "entry" | "cam-denied"
  | "welcome" | "doc-type"
  | "doc-capture" | "selfie"
  | "processing" | "result";

type DocType       = "passport" | "national_id" | "driving_licence" | "residence_permit";
type DocPhase      = "front" | "back";
type CamStatus     = "starting" | "live" | "denied";
type QualityStatus = "unknown" | "good" | "glare" | "blurry" | "dark";

interface Country      { code: string; name: string; flag: string }
interface FrameQuality { brightness: number; variance: number }

// ─── Error messages ───────────────────────────────────────────────────────────
const ERROR_MESSAGES: Record<string, string> = {
  blurry:       "Document image was too blurry. Try better lighting and hold steady.",
  glare:        "Glare detected on the document. Tilt it slightly away from the light.",
  face_mismatch:"Selfie doesn't match document photo. Ensure good lighting and face the camera directly.",
  expired:      "Document appears expired. Please use a valid, unexpired ID.",
  default:      "We couldn't verify this document.",
};

function parseErrorType(error: string): string {
  const e = error.toLowerCase();
  if (e.includes("blur"))                                          return "blurry";
  if (e.includes("glare") || e.includes("reflect"))               return "glare";
  if (e.includes("face") || e.includes("match") || e.includes("selfie")) return "face_mismatch";
  if (e.includes("expir"))                                         return "expired";
  return "default";
}

// ─── Data ────────────────────────────────────────────────────────────────────
const COUNTRIES: Country[] = [
  { code: "ET", name: "Ethiopia",       flag: "🇪🇹" },
  { code: "KE", name: "Kenya",          flag: "🇰🇪" },
  { code: "NG", name: "Nigeria",        flag: "🇳🇬" },
  { code: "ZA", name: "South Africa",   flag: "🇿🇦" },
  { code: "EG", name: "Egypt",          flag: "🇪🇬" },
  { code: "GH", name: "Ghana",          flag: "🇬🇭" },
  { code: "TZ", name: "Tanzania",       flag: "🇹🇿" },
  { code: "UG", name: "Uganda",         flag: "🇺🇬" },
  { code: "US", name: "United States",  flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "IN", name: "India",          flag: "🇮🇳" },
  { code: "DE", name: "Germany",        flag: "🇩🇪" },
  { code: "FR", name: "France",         flag: "🇫🇷" },
  { code: "CA", name: "Canada",         flag: "🇨🇦" },
  { code: "AU", name: "Australia",      flag: "🇦🇺" },
];

const DOC_TYPES: { value: DocType; label: string; icon: string; hasBack: boolean }[] = [
  { value: "passport",         label: "Passport",         icon: "🛂", hasBack: false },
  { value: "driving_licence",  label: "Driving licence",  icon: "🚗", hasBack: true  },
  { value: "national_id",      label: "National ID",      icon: "🪪", hasBack: true  },
  { value: "residence_permit", label: "Residence permit", icon: "📄", hasBack: false },
];

const PROC_STEPS = [
  "Uploading securely…",
  "Reading your document…",
  "Checking sanctions database…",
  "Matching faces…",
];

// ─── Utilities ───────────────────────────────────────────────────────────────
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result as string);
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
    sum += lum; sumSq += lum * lum;
  }
  const avg = sum / n;
  return { brightness: avg, variance: sumSq / n - avg * avg };
}

function toQualityStatus(q: FrameQuality | null): QualityStatus {
  if (!q) return "unknown";
  if (q.brightness > 215) return "glare";
  if (q.brightness < 40)  return "dark";
  if (q.variance < 120)   return "blurry";
  return "good";
}

// ─── Hooks ───────────────────────────────────────────────────────────────────
function useCamera(facing: "environment" | "user") {
  const [status, setStatus] = useState<CamStatus>("starting");
  const videoRef            = useRef<HTMLVideoElement>(null);
  const canvasRef           = useRef<HTMLCanvasElement>(null);
  const streamRef           = useRef<MediaStream | null>(null);

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

  return { status, videoRef, canvasRef, capture };
}

function useFrameQuality(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
): QualityStatus {
  const [qs, setQs]   = useState<QualityStatus>("unknown");
  const cvRef         = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) { setQs("unknown"); return; }
    if (!cvRef.current) cvRef.current = document.createElement("canvas");
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v || !cvRef.current) return;
      setQs(toQualityStatus(analyzeFrame(v, cvRef.current)));
    }, 500);
    return () => clearInterval(id);
  }, [active, videoRef]);

  return qs;
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function VeridianMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.1)} viewBox="0 0 28 31" fill="none" aria-hidden="true">
      <path d="M14 1L26 5V15C26 22.5 20.7 27.7 14 30C7.3 27.7 2 22.5 2 15V5L14 1Z" fill={BRAND} />
      <path d="M8 12L14 22L20 12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function ProgressDots({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 12 }}>
      {([1, 2, 3] as const).map((i) => (
        <div key={i} style={{
          height: 6, borderRadius: 3,
          width: i === current ? 20 : 8,
          background: i <= current ? BRAND : BORDER,
          transition: "all 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        }} />
      ))}
    </div>
  );
}

function TopBar({ onBack, onClose, progress, dark = false }: {
  onBack?: () => void; onClose?: () => void; progress?: 1 | 2 | 3; dark?: boolean;
}) {
  const stroke   = dark ? "rgba(255,255,255,0.7)" : INK_3;
  const btnStyle: React.CSSProperties = {
    all: "unset" as const, cursor: "pointer",
    width: 36, height: 36, borderRadius: 8,
    background: dark ? "rgba(255,255,255,0.07)" : "transparent",
    border: dark ? "none" : `1px solid ${BORDER}`,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  };
  return (
    <div style={{ padding: "16px 20px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Back" style={btnStyle}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : <div style={{ width: 36 }} />}

        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <VeridianMark size={18} />
          <span style={{ fontWeight: 700, fontSize: 14, color: dark ? INK_D : INK, letterSpacing: -0.2 }}>
            Veridian
          </span>
        </div>

        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close" style={btnStyle}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        ) : <div style={{ width: 36 }} />}
      </div>
      {progress !== undefined && <ProgressDots current={progress} />}
    </div>
  );
}

function SecuredFooter() {
  return (
    <div style={{
      textAlign: "center",
      padding: "12px 0 max(28px, env(safe-area-inset-bottom, 28px))",
      fontSize: 11, color: INK_4, letterSpacing: 0.3,
    }}>
      🔒 Secured by Veridian · End-to-end encrypted
    </div>
  );
}

function Btn({ onClick, disabled, loading, children, variant = "primary", small }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean;
  children?: React.ReactNode;
  variant?: "primary" | "ghost" | "outline";
  small?: boolean;
}) {
  const h = small ? 40 : BTN_H;
  const base: React.CSSProperties = {
    width: "100%", minHeight: h, borderRadius: 9999, border: "none",
    cursor: disabled || loading ? "not-allowed" : "pointer",
    fontWeight: 600, fontSize: small ? 14 : 16,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    transition: "opacity 0.15s",
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: {
      background: disabled || loading ? "rgba(15,110,86,0.28)" : BRAND,
      color: disabled || loading ? "rgba(255,255,255,0.4)" : "#fff",
    },
    ghost: {
      background: "transparent", color: disabled ? INK_4 : INK_3,
      border: `1.5px solid ${BORDER}`,
    },
    outline: {
      background: "transparent", color: disabled ? INK_4 : BRAND,
      border: `1.5px solid ${disabled ? BORDER : BRAND}`,
    },
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled || loading}
      style={{ ...base, ...variants[variant] }}>
      {loading ? (
        <svg style={{ animation: "spin 0.9s linear infinite" }} width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8" stroke="rgba(0,0,0,0.1)" strokeWidth="2.5" />
          <path d="M10 2a8 8 0 0 1 8 8" stroke={variant === "primary" ? "#fff" : BRAND} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : children}
    </button>
  );
}

function DarkBtn({ onClick, disabled, loading, children, variant = "primary" }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean;
  children?: React.ReactNode; variant?: "primary" | "ghost";
}) {
  const base: React.CSSProperties = {
    width: "100%", minHeight: BTN_H, borderRadius: 9999, border: "none",
    cursor: disabled || loading ? "not-allowed" : "pointer",
    fontWeight: 600, fontSize: 16,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: {
      background: disabled || loading ? "rgba(15,110,86,0.28)" : BRAND,
      color: disabled || loading ? "rgba(255,255,255,0.4)" : "#fff",
    },
    ghost: {
      background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)",
      border: "1px solid rgba(255,255,255,0.12)",
    },
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled || loading}
      style={{ ...base, ...variants[variant] }}>
      {loading ? (
        <svg style={{ animation: "spin 0.9s linear infinite" }} width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
          <path d="M10 2a8 8 0 0 1 8 8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : children}
    </button>
  );
}

// Real-time quality feedback chip (shown on camera screens)
function QualityChip({ status }: { status: QualityStatus }) {
  const map: Record<QualityStatus, { bg: string; color: string; border: string; text: string }> = {
    unknown: { bg: "rgba(0,0,0,0.55)",       color: "rgba(255,255,255,0.65)", border: "rgba(255,255,255,0.12)", text: "Starting camera…" },
    good:    { bg: "rgba(22,163,74,0.92)",    color: "#fff",                  border: "transparent",            text: "✓ Ready to capture" },
    glare:   { bg: "rgba(217,119,6,0.92)",    color: "#fff",                  border: "transparent",            text: "Glare detected — tilt slightly" },
    blurry:  { bg: "rgba(220,38,38,0.92)",    color: "#fff",                  border: "transparent",            text: "Too blurry — hold steady" },
    dark:    { bg: "rgba(220,38,38,0.92)",    color: "#fff",                  border: "transparent",            text: "Too dark — find better lighting" },
  };
  const c = map[status];
  return (
    <div style={{
      display: "inline-flex", alignItems: "center",
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      borderRadius: 9999, padding: "7px 16px",
      fontSize: 13, fontWeight: 600,
      backdropFilter: "blur(8px)",
      transition: "background 0.25s, color 0.25s",
      whiteSpace: "nowrap",
    }}>
      {c.text}
    </div>
  );
}

// Document corner-bracket overlay
function DocCorners({ good }: { good: boolean }) {
  const col = good ? BRAND : "rgba(255,255,255,0.85)";
  const bl  = 26;
  const pts: [number, number, number, number][] = [
    [24, 20, 1, 1], [276, 20, -1, 1], [24, 220, 1, -1], [276, 220, -1, -1],
  ];
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      viewBox="0 0 300 240" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path fillRule="evenodd" fill="rgba(0,0,0,0.42)"
        d="M0,0 h300 v240 h-300 Z M24,20 h252 a8,8 0 0 1 8,8 v184 a8,8 0 0 1 -8,8 h-252 a8,8 0 0 1 -8,-8 v-184 a8,8 0 0 1 8,-8 Z" />
      <rect x="24" y="20" width="252" height="200" rx="8"
        fill="none" stroke={col} strokeWidth="1.5" strokeDasharray="8 5"
        opacity={good ? 1 : 0.65} style={{ transition: "stroke 0.3s, opacity 0.3s" }} />
      {pts.map(([cx, cy, sx, sy], i) => (
        <g key={i} stroke={col} strokeWidth="3" strokeLinecap="round" style={{ transition: "stroke 0.3s" }}>
          <line x1={cx} y1={cy} x2={cx + sx * bl} y2={cy} />
          <line x1={cx} y1={cy} x2={cx} y2={cy + sy * bl} />
        </g>
      ))}
    </svg>
  );
}

// Selfie oval guide overlay
function SelfieOval({ ready }: { ready: boolean }) {
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      viewBox="0 0 300 380" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path fillRule="evenodd" fill="rgba(0,0,0,0.45)"
        d="M0,0 h300 v380 h-300 Z M150,60 a80,110 0 1 1 0,220 a80,110 0 1 1 0,-220 Z" />
      <ellipse cx="150" cy="170" rx="80" ry="110"
        fill="none" stroke={ready ? BRAND : "rgba(255,255,255,0.55)"}
        strokeWidth="2.5" strokeDasharray="7 4"
        style={{ transition: "stroke 0.3s" }} />
    </svg>
  );
}

// ─── DESKTOP ENTRY ────────────────────────────────────────────────────────────
function EntryScreen({ token, businessName }: { token: string; businessName?: string }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl]       = useState("");
  useEffect(() => { setUrl(window.location.href); }, []);
  const qrUrl = url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}&bgcolor=0d1a14&color=0f6e56&margin=12`
    : "";
  return (
    <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
      <div style={{ maxWidth: 400, width: "100%", background: "#0d1a14", borderRadius: 24, border: "1px solid rgba(15,110,86,0.2)", padding: "40px 32px", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <VeridianMark size={40} />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: INK_D, margin: "0 0 8px", letterSpacing: -0.5 }}>
          {businessName ? `Verify for ${businessName}` : "Identity Verification"}
        </h1>
        <p style={{ fontSize: 14, color: INK_D3, margin: "0 0 28px", lineHeight: 1.55 }}>
          Scan with your phone to complete verification
        </p>
        {qrUrl && (
          <div style={{ display: "inline-block", borderRadius: 16, overflow: "hidden", border: "3px solid rgba(15,110,86,0.25)", boxShadow: "0 0 40px rgba(15,110,86,0.12)", marginBottom: 24 }}>
            <img src={qrUrl} width={180} height={180} alt="Scan to verify" />
          </div>
        )}
        <p style={{ fontSize: 12, color: "rgba(163,179,174,0.5)", margin: "0 0 14px" }}>or copy link to share</p>
        <button
          onClick={() => { navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
          style={{ background: "rgba(15,110,86,0.12)", border: "1px solid rgba(15,110,86,0.25)", color: INK_D3, borderRadius: 9999, padding: "10px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          {copied ? "✓ Copied!" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

// ─── CAMERA PERMISSION DENIED ─────────────────────────────────────────────────
function CamDeniedScreen({ onRetry, onContinueWithout }: {
  onRetry: () => void; onContinueWithout: () => void;
}) {
  const ua        = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS     = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const instructions = isIOS
    ? "Go to Settings → Safari → Camera → Allow"
    : isAndroid
    ? "Go to Settings → Apps → Chrome → Permissions → Camera → Allow"
    : "Click the camera icon in your browser's address bar and allow access, then refresh.";

  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar />
      <div style={{ flex: 1, padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: 20, background: DANGER_L, border: "1px solid rgba(220,38,38,0.18)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect x="4" y="8" width="24" height="18" rx="4" stroke={DANGER} strokeWidth="1.8" />
            <circle cx="16" cy="17" r="5" stroke={DANGER} strokeWidth="1.8" />
            <path d="M20 5h-8l-2 3h12l-2-3Z" stroke={DANGER} strokeWidth="1.8" strokeLinejoin="round" />
            <line x1="22" y1="10" x2="28" y2="4" stroke={DANGER} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 8px", letterSpacing: -0.4 }}>
          Camera access required
        </h2>
        <p style={{ fontSize: 14, color: INK_3, margin: "0 0 24px", lineHeight: 1.6 }}>
          We need your camera to capture documents and your selfie.
        </p>
        <div style={{ width: "100%", padding: "16px", borderRadius: 12, background: SURFACE, border: `1px solid ${BORDER}`, marginBottom: 28, textAlign: "left" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: INK_3, margin: "0 0 6px", textTransform: "uppercase" as const, letterSpacing: 1 }}>
            How to enable
          </p>
          <p style={{ fontSize: 14, color: INK, margin: 0, lineHeight: 1.65 }}>{instructions}</p>
        </div>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onClick={onRetry}>Try again</Btn>
          <Btn variant="ghost" onClick={onContinueWithout}>Upload a photo instead</Btn>
        </div>
      </div>
      <SecuredFooter />
    </div>
  );
}

// ─── SCREEN 1: WELCOME ────────────────────────────────────────────────────────
function WelcomeScreen({ businessName, onStart, onClose }: {
  businessName?: string; onStart: () => void; onClose: () => void;
}) {
  const checklist = [
    "A valid passport, driving licence, or national ID",
    "A clear selfie photo",
    "Good lighting — avoid shadows",
  ];
  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar onClose={onClose} />
      <div style={{ flex: 1, padding: "28px 20px 0", display: "flex", flexDirection: "column" }}>
        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_D} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", boxShadow: `0 8px 32px rgba(15,110,86,0.28)` }}>
            <svg width="36" height="40" viewBox="0 0 36 40" fill="none">
              <path d="M18 2L32 7V18C32 28.5 25.5 35 18 38C10.5 35 4 28.5 4 18V7L18 2Z"
                fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
              <path d="M11 19l5.5 5.5 9.5-10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, margin: "0 0 8px", letterSpacing: -0.5, lineHeight: 1.2 }}>
            {businessName ? `${businessName} needs to verify your identity` : "Verify your identity"}
          </h1>
          <p style={{ fontSize: 15, color: INK_3, margin: 0, lineHeight: 1.55 }}>
            This takes about 2 minutes
          </p>
        </div>

        {/* Checklist */}
        <div style={{ borderRadius: 14, border: `1px solid ${BORDER}`, overflow: "hidden", marginBottom: 16 }}>
          {checklist.map((item, i) => (
            <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", borderBottom: i < checklist.length - 1 ? `1px solid ${BORDER}` : "none" }}>
              <div style={{ width: 20, height: 20, borderRadius: 10, background: OK_L, border: `1px solid rgba(22,163,74,0.25)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5l2.5 2.5 4.5-5" stroke={OK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span style={{ fontSize: 14, color: INK, lineHeight: 1.55 }}>{item}</span>
            </div>
          ))}
        </div>

        {/* Privacy */}
        <p style={{ fontSize: 12, color: INK_4, lineHeight: 1.65, margin: 0, textAlign: "center", padding: "0 8px" }}>
          Your documents are encrypted and deleted after verification.
        </p>
      </div>
      <div style={{ padding: "20px 20px 0" }}>
        <Btn onClick={onStart}>Begin verification</Btn>
      </div>
      <SecuredFooter />
    </div>
  );
}

// ─── SCREEN 2: DOCUMENT TYPE ──────────────────────────────────────────────────
function DocTypeScreen({ onSelect, onBack, onClose }: {
  onSelect: (dt: DocType, hasBack: boolean) => void;
  onBack: () => void; onClose: () => void;
}) {
  const [query,        setQuery]        = useState("");
  const [countryCode,  setCountryCode]  = useState("ET");
  const [showDropdown, setShowDropdown] = useState(false);

  const selectedCountry = COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0];
  const filtered = COUNTRIES.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar onBack={onBack} onClose={onClose} progress={1} />
      <div style={{ flex: 1, padding: "24px 20px", display: "flex", flexDirection: "column" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 20px", letterSpacing: -0.4 }}>
          Your document
        </h2>

        {/* Country selector */}
        <label style={{ fontSize: 11, fontWeight: 700, color: INK_3, textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 6, display: "block" }}>
          Issuing country
        </label>
        <div style={{ position: "relative", marginBottom: 24 }}>
          <div style={{ position: "relative" }}>
            <svg style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
              width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke={INK_4} strokeWidth="1.4" />
              <path d="M9.5 9.5l2.5 2.5" stroke={INK_4} strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input type="text"
              placeholder={`${selectedCountry.flag} ${selectedCountry.name}`}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              style={{ width: "100%", height: 44, borderRadius: 10, border: `1.5px solid ${showDropdown ? BRAND : BORDER}`, background: SURFACE, paddingLeft: 38, paddingRight: 16, fontSize: 15, color: INK, outline: "none", boxSizing: "border-box", transition: "border-color 0.15s" }}
            />
          </div>
          {showDropdown && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={() => { setShowDropdown(false); setQuery(""); }} />
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 10, borderRadius: 10, border: `1px solid ${BORDER}`, background: CARD, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 220, overflowY: "auto" }}>
                {filtered.map((c, i) => (
                  <button key={c.code} type="button"
                    onClick={() => { setCountryCode(c.code); setShowDropdown(false); setQuery(""); }}
                    style={{ all: "unset", display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 14px", cursor: "pointer", borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : "none", background: countryCode === c.code ? BRAND_L : "transparent", boxSizing: "border-box" }}>
                    <span style={{ fontSize: 18 }}>{c.flag}</span>
                    <span style={{ fontSize: 14, color: INK, fontWeight: countryCode === c.code ? 600 : 400 }}>{c.name}</span>
                    {countryCode === c.code && (
                      <svg style={{ marginLeft: "auto" }} width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7l4 4 6-6" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Doc type rows */}
        <label style={{ fontSize: 11, fontWeight: 700, color: INK_3, textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 8, display: "block" }}>
          Document type
        </label>
        <div style={{ borderRadius: 12, border: `1px solid ${BORDER}`, overflow: "hidden", marginBottom: 16 }}>
          {DOC_TYPES.map((dt, i) => (
            <button key={dt.value} type="button"
              onClick={() => onSelect(dt.value, dt.hasBack)}
              style={{ all: "unset", display: "flex", alignItems: "center", gap: 14, width: "100%", minHeight: 56, padding: "0 16px", cursor: "pointer", borderBottom: i < DOC_TYPES.length - 1 ? `1px solid ${BORDER}` : "none", boxSizing: "border-box", transition: "background 0.1s" }}>
              <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{dt.icon}</span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: INK }}>{dt.label}</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 3l5 5-5 5" stroke={INK_4} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>

        <p style={{ fontSize: 12, color: INK_4, lineHeight: 1.6, margin: 0 }}>
          The name on your document may differ from your everyday name — that&apos;s fine.
        </p>
      </div>
      <SecuredFooter />
    </div>
  );
}

// ─── SCREEN 3: DOCUMENT CAPTURE ───────────────────────────────────────────────
function DocCaptureScreen({ docType, phase, onCapture, onBack, onClose }: {
  docType: DocType; phase: DocPhase;
  onCapture: (img: string) => void;
  onBack: () => void; onClose: () => void;
}) {
  const [mode,     setMode]     = useState<"cam" | "review">("cam");
  const [captured, setCaptured] = useState<string | null>(null);
  const fileRef                 = useRef<HTMLInputElement>(null);
  const { status, videoRef, canvasRef, capture } = useCamera("environment");
  const quality = useFrameQuality(videoRef, status === "live" && mode === "cam");

  const docLabel = DOC_TYPES.find((d) => d.value === docType)?.label ?? docType;
  const title    = `${phase === "front" ? "Front" : "Back"} of your ${docLabel.toLowerCase()}`;
  const good     = quality === "good";

  const doCapture = () => {
    const img = capture();
    if (img) { setCaptured(img); setMode("review"); }
  };

  const doFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    setCaptured(url); setMode("review");
  };

  // Camera unavailable fallback
  if (status === "denied") {
    return (
      <div style={{ background: BG, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <TopBar onBack={onBack} onClose={onClose} dark />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: INK_D, margin: "0 0 8px" }}>Camera unavailable</h3>
          <p style={{ fontSize: 14, color: INK_D3, margin: "0 0 28px", lineHeight: 1.55 }}>
            Upload a clear photo of your document instead.
          </p>
          <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 10 }}>
            <DarkBtn onClick={() => fileRef.current?.click()}>Upload photo</DarkBtn>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={doFile} />
          </div>
        </div>
      </div>
    );
  }

  // Review screen
  if (mode === "review" && captured) {
    return (
      <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <TopBar onClose={onClose} progress={1} />
        <div style={{ flex: 1, padding: "24px 20px", display: "flex", flexDirection: "column" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: INK, margin: "0 0 4px", letterSpacing: -0.3 }}>
            Does this look clear?
          </h2>
          <p style={{ fontSize: 14, color: INK_3, margin: "0 0 20px" }}>
            All text should be sharp and fully visible
          </p>
          <div style={{ flex: 1, borderRadius: 12, overflow: "hidden", border: `1px solid ${BORDER}`, background: SURFACE, display: "flex", alignItems: "center", maxHeight: 360 }}>
            <img src={captured} alt="Captured document" style={{ width: "100%", maxHeight: 360, objectFit: "contain", display: "block" }} />
          </div>
        </div>
        <div style={{ padding: "0 20px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onClick={() => onCapture(captured)}>Use this photo</Btn>
          <Btn variant="ghost" onClick={() => { setCaptured(null); setMode("cam"); }}>Retake</Btn>
        </div>
        <SecuredFooter />
      </div>
    );
  }

  // Camera viewfinder
  return (
    <div style={{ background: "#000", minHeight: "100dvh", position: "relative", overflow: "hidden" }}>
      <video ref={videoRef} playsInline muted autoPlay
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {status === "live" && <DocCorners good={good} />}

      {/* Header */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        <TopBar onBack={onBack} onClose={onClose} dark />
      </div>
      <div style={{ position: "absolute", top: 72, left: 0, right: 0, textAlign: "center", padding: "0 24px" }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: INK_D, margin: "0 0 3px" }}>{title}</h2>
        <p style={{ fontSize: 13, color: INK_D3, margin: 0 }}>Place on flat surface in good lighting</p>
      </div>

      {/* Quality chip — top of viewfinder area */}
      <div style={{ position: "absolute", top: 132, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <QualityChip status={quality} />
      </div>

      {/* Controls */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 20px 48px", display: "flex", flexDirection: "column", gap: 12 }}>
        <DarkBtn onClick={doCapture} disabled={status !== "live"}>Capture document</DarkBtn>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={doFile} />
        <DarkBtn variant="ghost" onClick={() => fileRef.current?.click()}>Upload from library</DarkBtn>
      </div>
    </div>
  );
}

// ─── SCREEN 4: SELFIE ─────────────────────────────────────────────────────────
function SelfieScreen({ onCapture, onBack, onClose }: {
  onCapture: (img: string) => void; onBack: () => void; onClose: () => void;
}) {
  const [mode,     setMode]     = useState<"cam" | "review">("cam");
  const [captured, setCaptured] = useState<string | null>(null);
  const fileRef                 = useRef<HTMLInputElement>(null);
  const { status, videoRef, canvasRef, capture } = useCamera("user");
  const quality = useFrameQuality(videoRef, status === "live" && mode === "cam");
  const ready   = quality === "good";

  const doCapture = () => {
    const img = capture();
    if (img) { setCaptured(img); setMode("review"); }
  };

  const doFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    setCaptured(url); setMode("review");
  };

  if (status === "denied") {
    return (
      <div style={{ background: BG, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <TopBar onBack={onBack} onClose={onClose} dark />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🤳</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: INK_D, margin: "0 0 8px" }}>Camera unavailable</h3>
          <p style={{ fontSize: 14, color: INK_D3, margin: "0 0 28px", lineHeight: 1.55 }}>Upload a clear selfie photo instead.</p>
          <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 10 }}>
            <DarkBtn onClick={() => fileRef.current?.click()}>Upload selfie</DarkBtn>
            <input ref={fileRef} type="file" accept="image/*" capture="user" style={{ display: "none" }} onChange={doFile} />
          </div>
        </div>
      </div>
    );
  }

  if (mode === "review" && captured) {
    return (
      <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <TopBar onClose={onClose} progress={2} />
        <div style={{ flex: 1, padding: "24px 20px", display: "flex", flexDirection: "column" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: INK, margin: "0 0 4px", letterSpacing: -0.3 }}>
            Good selfie?
          </h2>
          <p style={{ fontSize: 14, color: INK_3, margin: "0 0 28px" }}>
            Your face should be centered and well-lit
          </p>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ width: 200, height: 200, borderRadius: "50%", overflow: "hidden", border: `3px solid ${BRAND}`, flexShrink: 0 }}>
              <img src={captured} alt="Selfie preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          </div>
        </div>
        <div style={{ padding: "0 20px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onClick={() => onCapture(captured)}>Use this photo</Btn>
          <Btn variant="ghost" onClick={() => { setCaptured(null); setMode("cam"); }}>Retake</Btn>
        </div>
        <SecuredFooter />
      </div>
    );
  }

  return (
    <div style={{ background: "#111", minHeight: "100dvh", position: "relative", overflow: "hidden" }}>
      <video ref={videoRef} playsInline muted autoPlay
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <SelfieOval ready={ready} />

      {/* Header */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        <TopBar onBack={onBack} onClose={onClose} dark />
      </div>
      <div style={{ position: "absolute", top: 68, left: 0, right: 0, textAlign: "center", padding: "0 20px" }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: INK_D, margin: "0 0 4px" }}>Now take a selfie</h2>
        <p style={{ fontSize: 13, color: INK_D3, margin: "0 0 10px" }}>
          Look directly at the camera in good lighting
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
          {["Remove glasses", "Face forward", "Good light"].map((tip) => (
            <span key={tip} style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", background: "rgba(0,0,0,0.45)", borderRadius: 9999, padding: "3px 10px", backdropFilter: "blur(4px)" }}>
              {tip}
            </span>
          ))}
        </div>
      </div>

      {/* Status label */}
      <div style={{ position: "absolute", bottom: 160, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <div style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", borderRadius: 9999, padding: "8px 18px", color: INK_D, fontSize: 13, fontWeight: 500, border: `1px solid ${ready ? BRAND : "rgba(255,255,255,0.15)"}`, transition: "border-color 0.3s" }}>
          {ready ? "✓ Ready to capture" : "Position your face in the oval"}
        </div>
      </div>

      {/* Controls */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 20px 48px", display: "flex", flexDirection: "column", gap: 12 }}>
        <DarkBtn onClick={doCapture} disabled={status !== "live"}>Take photo</DarkBtn>
        <input ref={fileRef} type="file" accept="image/*" capture="user" style={{ display: "none" }} onChange={doFile} />
        <DarkBtn variant="ghost" onClick={() => fileRef.current?.click()}>Upload instead</DarkBtn>
      </div>
    </div>
  );
}

// ─── SCREEN 5: PROCESSING ─────────────────────────────────────────────────────
function ProcessingScreen({ step }: { step: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px" }}>
      {/* Animated hourglass */}
      <div style={{ width: 72, height: 72, borderRadius: 20, background: BRAND_L, border: `1px solid rgba(15,110,86,0.18)`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
        <svg width="32" height="36" viewBox="0 0 32 36" fill="none"
          style={{ animation: "veridian-hourglass 2s ease-in-out infinite" }}>
          <path d="M6 2h20v8L16 18 6 10V2Z" fill={BRAND} opacity="0.6" />
          <path d="M6 34h20v-8L16 18 6 26v8Z" fill={BRAND} />
          <rect x="4" y="1" width="24" height="4" rx="2" fill={BRAND} />
          <rect x="4" y="31" width="24" height="4" rx="2" fill={BRAND} />
        </svg>
      </div>
      <h3 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 6px", textAlign: "center", letterSpacing: -0.4 }}>
        Verifying your identity
      </h3>
      <p style={{ fontSize: 14, color: INK_3, margin: `0 0 ${slow ? 16 : 28}px`, textAlign: "center" }}>
        Usually takes under 30 seconds
      </p>

      {slow && (
        <div style={{ background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)", borderRadius: 10, padding: "10px 16px", marginBottom: 20, textAlign: "center", width: "100%" }}>
          <span style={{ fontSize: 13, color: WARN, fontWeight: 500 }}>
            Taking a little longer — still working
          </span>
        </div>
      )}

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
        {PROC_STEPS.map((label, i) => {
          const done   = i < step;
          const active = i === step;
          return (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12, background: done ? OK_L : SURFACE, border: `1px solid ${done ? "rgba(22,163,74,0.2)" : BORDER}`, transition: "all 0.35s" }}>
              <div style={{ width: 24, height: 24, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: done ? OK : "transparent", border: active ? `2px solid ${BRAND}` : done ? "none" : `2px solid ${BORDER}`, transition: "all 0.35s" }}>
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : active ? (
                  <svg style={{ animation: "spin 1s linear infinite" }} width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.5" stroke={BORDER} strokeWidth="2" />
                    <path d="M7 1.5a5.5 5.5 0 0 1 5.5 5.5" stroke={BRAND} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : null}
              </div>
              <span style={{ fontSize: 14, fontWeight: active ? 600 : 400, color: done ? OK : active ? INK : INK_3 }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: "auto", paddingTop: 20, width: "100%" }}>
        <SecuredFooter />
      </div>
    </div>
  );
}

// ─── SCREEN 6: RESULT ─────────────────────────────────────────────────────────
function ResultScreen({ result, attempts, onRetry, onClose }: {
  result: VerificationResult; attempts: number; onRetry: () => void; onClose: () => void;
}) {
  if (result.success) {
    return (
      <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <div style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_D} 100%)`, padding: "64px 24px 40px", textAlign: "center" }}>
          <div className="animate-scale-in" style={{ width: 80, height: 80, borderRadius: 40, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <path className="animate-check-draw" d="M8 20l9 9 15-15"
                stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray="56" strokeDashoffset="56" />
            </svg>
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: "#fff", margin: "0 0 6px", letterSpacing: -0.5 }}>
            Verification complete
          </h2>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.85)", margin: 0 }}>
            Your identity has been confirmed
          </p>
        </div>
        <div style={{ flex: 1, padding: "28px 20px" }}>
          <div style={{ padding: "18px", borderRadius: 12, background: SURFACE, border: `1px solid ${BORDER}` }}>
            <p style={{ fontSize: 14, color: INK_3, margin: 0, lineHeight: 1.65 }}>
              You can close this window and return to the app that requested verification.
            </p>
          </div>
        </div>
        <div style={{ padding: "0 20px 0" }}>
          <Btn onClick={onClose}>Close</Btn>
        </div>
        <div style={{ textAlign: "center", padding: "12px 0 max(28px, env(safe-area-inset-bottom, 28px))", fontSize: 11, color: INK_4, letterSpacing: 0.3 }}>
          Secured by Veridian · End-to-end encrypted
        </div>
      </div>
    );
  }

  const errType     = result.error ? parseErrorType(result.error) : "default";
  const errMsg      = ERROR_MESSAGES[errType] ?? ERROR_MESSAGES.default;
  const showTips    = attempts >= 2;
  const showTalkBtn = attempts >= 3;

  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar onClose={onClose} />
      <div style={{ flex: 1, padding: "24px 20px", display: "flex", flexDirection: "column" }}>
        <div style={{ width: 60, height: 60, borderRadius: 18, background: DANGER_L, border: "1px solid rgba(220,38,38,0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M14 9v7m0 4h.01" stroke={DANGER} strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="14" cy="14" r="11" stroke={DANGER} strokeWidth="1.8" />
          </svg>
        </div>
        <h3 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 8px", letterSpacing: -0.4 }}>
          Verification failed
        </h3>
        <p style={{ fontSize: 15, color: INK_3, margin: "0 0 20px", lineHeight: 1.6 }}>
          {errMsg}
        </p>

        {showTips && (
          <div style={{ borderRadius: 12, border: `1px solid ${BORDER}`, overflow: "hidden", marginBottom: 16 }}>
            <div style={{ padding: "12px 14px", background: SURFACE, borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: INK_3, textTransform: "uppercase" as const, letterSpacing: 1 }}>
                Tips for a better result
              </span>
            </div>
            {[
              "Use bright, even lighting without shadows",
              "Place document flat on a dark surface",
              "Hold phone directly above — no angle",
              "Make sure all four corners are visible",
            ].map((tip, i, arr) => (
              <div key={tip} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: i < arr.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: BRAND, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: INK_3 }}>{tip}</span>
              </div>
            ))}
          </div>
        )}

        {attempts > 1 && (
          <p style={{ fontSize: 12, color: INK_4, margin: 0 }}>Attempt {attempts} of 3</p>
        )}
      </div>
      <div style={{ padding: "0 20px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <Btn onClick={onRetry}>Try again</Btn>
        <Btn variant="ghost"
          onClick={() => { window.location.href = "mailto:support@veridianapi.com"; }}>
          {showTalkBtn ? "Talk to support" : "Get help"}
        </Btn>
      </div>
      <SecuredFooter />
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export function VerificationFlow({ token }: { token: string }) {
  const [step,       setStep]      = useState<FlowStep>("detecting");
  const [direction,  setDirection] = useState<"forward" | "backward">("forward");
  const [bizName,    setBizName]   = useState<string | undefined>();
  const [showExit,   setShowExit]  = useState(false);
  const [docType,    setDocType]   = useState<DocType>("passport");
  const [docHasBack, setDocHasBack]= useState(false);
  const [docPhase,   setDocPhase]  = useState<DocPhase>("front");
  const [frontImg,   setFrontImg]  = useState<string | null>(null);
  const [backImg,    setBackImg]   = useState<string | null>(null);
  const [procStep,   setProcStep]  = useState(0);
  const [result,     setResult]    = useState<VerificationResult | null>(null);
  const [attempts,   setAttempts]  = useState(0);

  const go = useCallback((next: FlowStep, dir: "forward" | "backward" = "forward") => {
    setDirection(dir); setStep(next);
  }, []);

  // Device detection + camera permission check
  useEffect(() => {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
    if (!mobile) { go("entry"); return; }
    if (!navigator?.mediaDevices?.getUserMedia) { go("cam-denied"); return; }
    if (navigator.permissions) {
      navigator.permissions
        .query({ name: "camera" as PermissionName })
        .then((r) => go(r.state === "denied" ? "cam-denied" : "welcome"))
        .catch(() => go("welcome"));
    } else {
      go("welcome");
    }
  }, [go]);

  // Desktop: poll for mobile-side completion
  useEffect(() => {
    if (step !== "entry") return;
    const id = setInterval(async () => {
      const s = await getSession(token);
      if (!s) return;
      if (s.business_name) setBizName(s.business_name);
      if (["approved", "complete", "rejected"].includes(s.status)) {
        setResult({ success: s.status !== "rejected" });
        go("result");
      }
    }, 2000);
    return () => clearInterval(id);
  }, [step, token, go]);

  // Fetch business name for welcome screen
  useEffect(() => {
    if (step !== "welcome") return;
    getSession(token).then((s) => { if (s?.business_name) setBizName(s.business_name); });
  }, [step, token]);

  const safeSteps: FlowStep[] = ["detecting", "entry", "cam-denied", "welcome", "result"];
  const handleClose = () => {
    if (safeSteps.includes(step)) window.close();
    else setShowExit(true);
  };

  const handleDocCapture = (img: string) => {
    if (docPhase === "front") {
      setFrontImg(img);
      if (docHasBack) {
        setDocPhase("back"); // key change on DocCaptureScreen remounts it
      } else {
        go("selfie");
      }
    } else {
      setBackImg(img);
      go("selfie");
    }
  };

  const handleSelfieCapture = (img: string) => handleSubmit(img);

  const handleSubmit = async (selfie: string) => {
    go("processing");
    setProcStep(0);

    // Start API call immediately, animate steps in parallel
    const apiCall = submitVerification(token, {
      document_type:  docType,
      document_front: frontImg!,
      ...(backImg ? { document_back: backImg } : {}),
      selfie,
    });

    for (let i = 0; i < 4; i++) {
      await delay(1100);
      setProcStep(i + 1);
    }

    const res = await apiCall;
    setResult(res);
    setAttempts((n) => n + 1);
    await delay(300);
    go("result");
  };

  const handleRetry = () => {
    setDocPhase("front");
    setFrontImg(null);
    setBackImg(null);
    go("doc-type");
  };

  const animClass = direction === "forward" ? "animate-slide-fwd" : "animate-slide-bwd";

  const renderStep = () => {
    switch (step) {
      case "detecting": return null;

      case "entry":
        return <EntryScreen token={token} businessName={bizName} />;

      case "cam-denied":
        return (
          <CamDeniedScreen
            onRetry={() => {
              if (navigator.permissions) {
                navigator.permissions
                  .query({ name: "camera" as PermissionName })
                  .then((r) => go(r.state === "denied" ? "cam-denied" : "welcome"))
                  .catch(() => go("welcome"));
              } else {
                go("welcome");
              }
            }}
            onContinueWithout={() => go("welcome")}
          />
        );

      case "welcome":
        return (
          <WelcomeScreen
            businessName={bizName}
            onStart={() => go("doc-type")}
            onClose={handleClose}
          />
        );

      case "doc-type":
        return (
          <DocTypeScreen
            onSelect={(dt, hasBack) => {
              setDocType(dt); setDocHasBack(hasBack); setDocPhase("front");
              go("doc-capture");
            }}
            onBack={() => go("welcome", "backward")}
            onClose={handleClose}
          />
        );

      case "doc-capture":
        return (
          <DocCaptureScreen
            key={docPhase}
            docType={docType}
            phase={docPhase}
            onCapture={handleDocCapture}
            onBack={() => {
              if (docPhase === "back") { setDocPhase("front"); }
              else { go("doc-type", "backward"); }
            }}
            onClose={handleClose}
          />
        );

      case "selfie":
        return (
          <SelfieScreen
            onCapture={handleSelfieCapture}
            onBack={() => go("doc-capture", "backward")}
            onClose={handleClose}
          />
        );

      case "processing":
        return <ProcessingScreen step={procStep} />;

      case "result":
        return (
          <ResultScreen
            result={result ?? { success: false, error: "Verification was unsuccessful." }}
            attempts={attempts}
            onRetry={handleRetry}
            onClose={() => window.close()}
          />
        );

      default: return null;
    }
  };

  return (
    <>
      <div key={step} className={animClass} style={{ minHeight: "100dvh" }}>
        {renderStep()}
      </div>

      {showExit && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div className="animate-sheet-up" style={{ width: "100%", maxWidth: 480, background: CARD, borderRadius: "20px 20px 0 0", border: `1px solid ${BORDER}`, borderBottom: "none", padding: "24px 20px 40px" }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: BORDER, margin: "0 auto 20px" }} />
            <h3 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: "0 0 8px", textAlign: "center" }}>
              Exit verification?
            </h3>
            <p style={{ fontSize: 14, color: INK_3, textAlign: "center", margin: "0 0 24px", lineHeight: 1.55 }}>
              Your progress will be lost and you&apos;ll need to start over.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Btn onClick={() => setShowExit(false)}>Continue verification</Btn>
              <Btn variant="ghost" onClick={() => { setShowExit(false); window.close(); }}>Exit</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
