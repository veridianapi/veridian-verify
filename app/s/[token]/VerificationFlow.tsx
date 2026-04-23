"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { submitVerification, getSession, type VerificationResult } from "./actions";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const BG       = "#050a09";
const CARD     = "#111916";
const BRAND    = "#1d9e75";
const BRAND_D  = "#15805f";
const BRAND_L  = "rgba(29,158,117,0.12)";
const BRAND_G  = "rgba(29,158,117,0.25)";
const INK      = "#f0f4f3";
const INK_2    = "#c8d8d3";
const INK_3    = "#a3b3ae";
const INK_4    = "#5a7268";
const BORDER   = "rgba(255,255,255,0.08)";
const SURFACE  = "#0d1211";
const DANGER   = "#dc2626";
const DANGER_L = "rgba(220,38,38,0.12)";
const WARN     = "#d97706";
const WARN_L   = "rgba(217,119,6,0.12)";
const OK       = "#16a34a";
const OK_L     = "rgba(22,163,74,0.12)";
const MONO     = 'var(--font-mono,"JetBrains Mono","SF Mono",ui-monospace,monospace)';
const BTN_H    = 52;
const R_CARD   = 20;

// ─── Types ───────────────────────────────────────────────────────────────────
type FlowStep =
  | "detecting" | "entry" | "welcome"
  | "country-select" | "doc-type"
  | "doc-capture"
  | "uploading" | "upload-error"
  | "selfie-intro" | "selfie"
  | "processing" | "result";

type Direction    = "forward" | "backward";
type DocType      = "passport" | "national_id" | "driving_licence" | "residence_permit";
type DocPhase     = "front-cam" | "front-review" | "back-cam" | "back-review";
type CamStatus    = "starting" | "live" | "denied";
type LivenessPhase = "framing" | "checking" | "done";

interface Country      { code: string; name: string; flag: string }
interface FrameQuality { brightness: number; variance: number }

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

const DOC_TYPES: { value: DocType; label: string; hasBack: boolean }[] = [
  { value: "driving_licence",  label: "Driver's license",  hasBack: true  },
  { value: "passport",         label: "Passport",          hasBack: false },
  { value: "national_id",      label: "National ID",       hasBack: true  },
  { value: "residence_permit", label: "Residence permit",  hasBack: false },
];

// ─── Utilities ───────────────────────────────────────────────────────────────
const delay     = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stripPfx  = (s: string) => (s.includes(",") ? s.split(",")[1] : s);

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

// ─── Hooks ───────────────────────────────────────────────────────────────────
function useCamera(facing: "environment" | "user") {
  const [status, setStatus]    = useState<CamStatus>("starting");
  const videoRef               = useRef<HTMLVideoElement>(null);
  const canvasRef              = useRef<HTMLCanvasElement>(null);
  const streamRef              = useRef<MediaStream | null>(null);

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

// ─── SVG Icons & Marks ───────────────────────────────────────────────────────
function VeridianMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.1)} viewBox="0 0 28 31" fill="none" aria-hidden="true">
      <path d="M14 1L26 5V15C26 22.5 20.7 27.7 14 30C7.3 27.7 2 22.5 2 15V5L14 1Z" fill={BRAND} />
      <path d="M8 12L14 22L20 12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3l5 5-5 5" stroke={INK_4} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DocIcon({ color = BRAND }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="1.5" width="11" height="13" rx="2" stroke={color} strokeWidth="1.4" />
      <line x1="5" y1="6" x2="11" y2="6" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <line x1="5" y1="9" x2="9" y2="9" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────
function Btn({ onClick, disabled, loading, children, variant = "primary", small }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean;
  children?: React.ReactNode;
  variant?: "primary" | "ghost" | "outline" | "danger";
  small?: boolean;
}) {
  const h = small ? 36 : BTN_H;
  const base: React.CSSProperties = {
    width: "100%", minHeight: h, borderRadius: 999,
    border: "none", cursor: disabled || loading ? "not-allowed" : "pointer",
    fontWeight: 600, fontSize: small ? 14 : 16,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    transition: "opacity 0.15s",
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: {
      background: disabled || loading ? "rgba(29,158,117,0.3)" : BRAND,
      color: disabled || loading ? "rgba(240,244,243,0.4)" : BG,
    },
    ghost: {
      background: "transparent",
      color: INK_3,
      border: `1px solid ${BORDER}`,
    },
    outline: {
      background: "transparent",
      color: disabled ? INK_4 : BRAND,
      border: `1.5px solid ${disabled ? BORDER : BRAND}`,
    },
    danger: {
      background: DANGER_L,
      color: DANGER,
      border: `1px solid rgba(220,38,38,0.3)`,
    },
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled || loading}
      style={{ ...base, ...variants[variant] }}>
      {loading ? (
        <svg style={{ animation: "spin 0.9s linear infinite" }} width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
          <path d="M10 2a8 8 0 0 1 8 8" stroke={variant === "primary" ? BG : BRAND} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : children}
    </button>
  );
}

function IconBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} style={{
      all: "unset", cursor: "pointer",
      width: 36, height: 36, borderRadius: 8,
      background: "rgba(255,255,255,0.07)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      {children}
    </button>
  );
}

function PillLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      padding: "8px 16px", borderRadius: 999,
      background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)",
      color: INK, fontSize: 14, fontWeight: 500, lineHeight: 1.4,
      textAlign: "center",
    }}>
      {children}
    </div>
  );
}

// ─── Progress pill ─────────────────────────────────────────────────────────────
function ProgressPill({ step }: { step: 0 | 1 }) {
  return (
    <div style={{ display: "flex", gap: 6, padding: "0 4px", marginTop: 10 }}>
      {(["ID", "Selfie"] as const).map((label, i) => (
        <div key={label} style={{ flex: 1 }}>
          <div style={{
            height: 3, borderRadius: 2, marginBottom: 5,
            background: i <= step ? BRAND : "rgba(255,255,255,0.10)",
            transition: "background 0.25s",
          }} />
          <span style={{
            fontFamily: MONO, fontSize: 9, letterSpacing: 0.8,
            textTransform: "uppercase" as const,
            color: i === step ? BRAND : i < step ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)",
            fontWeight: i === step ? 600 : 400,
          }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────
function TopBar({ onBack, onClose, progress }: {
  onBack?: () => void; onClose?: () => void; progress?: 0 | 1;
}) {
  return (
    <div style={{ padding: "14px 20px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {onBack ? (
          <IconBtn onClick={onBack} label="Back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconBtn>
        ) : <div style={{ width: 36 }} />}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <VeridianMark size={18} />
          <span style={{ fontWeight: 700, fontSize: 14, color: INK, letterSpacing: -0.2 }}>Veridian</span>
        </div>
        {onClose ? (
          <IconBtn onClick={onClose} label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </IconBtn>
        ) : <div style={{ width: 36 }} />}
      </div>
      {progress !== undefined && <ProgressPill step={progress} />}
    </div>
  );
}

// ─── Exit Confirmation Dialog ─────────────────────────────────────────────────
function ExitDialog({ onContinue, onExit }: { onContinue: () => void; onExit: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      padding: "0 0 env(safe-area-inset-bottom,0)",
    }}>
      <div className="animate-sheet-up" style={{
        width: "100%", maxWidth: 480,
        background: CARD, borderRadius: "20px 20px 0 0",
        border: `1px solid ${BORDER}`, borderBottom: "none",
        padding: "24px 20px 32px",
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", margin: "0 auto 20px" }} />
        <h3 style={{ fontSize: 18, fontWeight: 600, color: INK, margin: "0 0 8px", textAlign: "center" }}>
          Exit verification?
        </h3>
        <p style={{ fontSize: 14, color: INK_3, textAlign: "center", margin: "0 0 24px", lineHeight: 1.55 }}>
          Your progress will be lost and you&apos;ll need to start over.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onClick={onContinue}>Continue verification</Btn>
          <Btn variant="danger" onClick={onExit}>Exit</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Camera overlay — doc viewfinder ──────────────────────────────────────────
function DocViewfinder({ isPassport, detected }: { isPassport: boolean; detected: boolean }) {
  const rW = isPassport ? 0.62 : 0.84;
  const rH = isPassport ? 0.68 : 0.52;
  const vW = 300, vH = 420;
  const x0 = (vW * (1 - rW)) / 2, y0 = (vH * (1 - rH)) / 2;
  const w = vW * rW, h = vH * rH;
  const br = 12, bl = 28;
  const frameColor = detected ? BRAND : "#fff";

  const roundedRect = (x: number, y: number, rw: number, rh: number, r: number) =>
    `M${x + r},${y} h${rw - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${rh - 2 * r} a${r},${r} 0 0 1 -${r},${r} h${-(rw - 2 * r)} a${r},${r} 0 0 1 -${r},-${r} v${-(rh - 2 * r)} a${r},${r} 0 0 1 ${r},-${r} Z`;

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${vW} ${vH}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path fillRule="evenodd" fill="rgba(0,0,0,0.55)"
        d={`M0,0 h${vW} v${vH} h${-vW} Z ${roundedRect(x0, y0, w, h, br)}`} />
      <rect x={x0} y={y0} width={w} height={h} rx={br}
        fill="none" stroke={frameColor} strokeWidth="1.5"
        strokeDasharray="8 6" opacity={detected ? 1 : 0.6}
        style={{ transition: "stroke 0.3s" }} />
      {([[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]] as [number, number][]).map(([cx, cy], i) => {
        const sx = i % 2 === 0 ? 1 : -1;
        const sy = i < 2 ? 1 : -1;
        return (
          <path key={i}
            d={`M${cx + sx * bl} ${cy} L${cx} ${cy} L${cx} ${cy + sy * bl}`}
            stroke={frameColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"
            style={{ transition: "stroke 0.3s" }} />
        );
      })}
    </svg>
  );
}

// ─── Camera overlay — face oval ───────────────────────────────────────────────
function FaceOverlay({ liveness }: { liveness: LivenessPhase; progress: number }) {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <mask id="face-mask">
          <rect width="300" height="400" fill="white" />
          <ellipse cx="150" cy="188" rx="104" ry="132" fill="black" />
        </mask>
      </defs>
      <rect width="300" height="400" fill="rgba(0,0,0,0.52)" mask="url(#face-mask)" />
      <ellipse cx="150" cy="188" rx="104" ry="132" fill="none"
        stroke={liveness === "checking" ? BRAND : "rgba(255,255,255,0.55)"}
        strokeWidth="2"
        strokeDasharray={liveness === "checking" ? "10 5" : "none"}
        style={{
          transition: "stroke 0.3s",
          animation: liveness === "checking" ? "liveness-spin 2s linear infinite" : "none",
          transformOrigin: "150px 188px",
        }} />
      {liveness === "framing" && <>
        <path d="M62 56 L46 56 L46 72"  stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M238 56 L254 56 L254 72" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M62 320 L46 320 L46 304" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M238 320 L254 320 L254 304" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </>}
    </svg>
  );
}

// ─── Capture flash ─────────────────────────────────────────────────────────────
function CaptureFlash({ visible }: { visible: boolean }) {
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "#fff", opacity: visible ? 1 : 0, pointerEvents: "none",
      transition: visible ? "none" : "opacity 0.22s ease-out",
      zIndex: 30,
    }} />
  );
}

// ─── SCREEN: Entry (desktop QR + polling) ─────────────────────────────────────
function EntryScreen({ token, onMobileComplete }: { token: string; onMobileComplete: (result: VerificationResult) => void }) {
  const [pageUrl, setPageUrl]   = useState("");
  const [copied, setCopied]     = useState(false);
  const [polled, setPolled]     = useState(false);

  useEffect(() => { setPageUrl(window.location.href); }, []);

  // Poll for session completion every 2s
  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
    id = setInterval(async () => {
      try {
        const session = await getSession(token);
        if (session && (session.status === "approved" || session.status === "complete" || session.status === "rejected")) {
          clearInterval(id);
          setPolled(true);
          const success = session.status === "approved" || session.status === "complete";
          onMobileComplete({
            success,
            error: success ? undefined : "Verification was unsuccessful.",
          });
        }
      } catch { /* noop — keep polling */ }
    }, 2000);
    return () => clearInterval(id);
  }, [token, onMobileComplete]);

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
    <div className="animate-fade-up" style={{ padding: "0 20px 40px" }}>
      <div style={{
        background: "#0d1a14", borderRadius: R_CARD,
        border: `1px solid rgba(29,158,117,0.15)`,
        overflow: "hidden",
      }}>
        <div style={{ padding: "36px 28px 8px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <VeridianMark size={44} />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: INK, letterSpacing: -0.4, margin: "0 0 10px" }}>
            Continue on your phone
          </h1>
          <p style={{ fontSize: 14, color: INK_3, lineHeight: 1.6, margin: "0 0 24px", maxWidth: 260, marginLeft: "auto", marginRight: "auto" }}>
            Scan to open on a device with a camera. No app download required.
          </p>
          <div style={{
            display: "inline-flex", padding: 12,
            background: "#fff", borderRadius: 16, marginBottom: 20,
          }}>
            {qrSrc ? (
              <img src={qrSrc} alt="Verification QR code" width={200} height={200}
                style={{ display: "block", borderRadius: 8 }} />
            ) : (
              <div style={{ width: 200, height: 200, borderRadius: 8, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg style={{ animation: "spin 0.9s linear infinite" }} width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <circle cx="14" cy="14" r="11" stroke="#e5e7eb" strokeWidth="2.5" />
                  <path d="M14 3a11 11 0 0 1 11 11" stroke={BRAND} strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </div>
            )}
          </div>

          {/* Polling status */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "10px 16px", borderRadius: 999,
            background: "rgba(255,255,255,0.05)",
            marginBottom: 20,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%", background: BRAND, flexShrink: 0,
              animation: "ring-pulse 2s ease-out infinite",
            }} />
            <span style={{ fontSize: 13, color: INK_3 }}>Waiting for your phone…</span>
          </div>

          <button type="button" onClick={handleCopy} style={{
            all: "unset", cursor: "pointer", boxSizing: "border-box",
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "10px 24px", borderRadius: 999,
            border: "1.5px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
            fontSize: 13, fontWeight: 600,
            color: copied ? "#4ade80" : INK_3,
            transition: "all 0.15s",
            marginBottom: 28,
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
                  <path d="M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke={INK_3} strokeWidth="1.3" />
                  <path d="M6 3V2h4a1 1 0 0 1 1 1v7" stroke={INK_3} strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                Copy link
              </>
            )}
          </button>
        </div>

        <div style={{ padding: "0 28px 28px" }}>
          <p style={{ fontFamily: MONO, fontSize: 10, color: "rgba(255,255,255,0.15)", letterSpacing: 0.5, textAlign: "center", margin: 0 }}>
            Secured by Veridian · End-to-end encrypted
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── SCREEN: Welcome ──────────────────────────────────────────────────────────
function WelcomeScreen({ onNext }: { onNext: () => void }) {
  return (
    <div className="animate-fade-up" style={{ padding: "0 20px 40px" }}>
      <div style={{
        background: CARD, borderRadius: R_CARD,
        border: `1px solid ${BORDER}`, padding: "36px 24px 28px",
      }}>
        {/* Shield */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <div style={{ position: "relative", width: 72, height: 72, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ position: "absolute", width: 72, height: 72, borderRadius: "50%", background: BRAND, opacity: 0.07, animation: "ring-pulse 3s ease-out infinite" }} />
            <div style={{ width: 56, height: 56, borderRadius: 16, background: BRAND_L, border: `1px solid ${BRAND_G}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <VeridianMark size={28} />
            </div>
          </div>
        </div>

        <h1 style={{ fontSize: 28, fontWeight: 600, color: INK, letterSpacing: -0.5, textAlign: "center", margin: "0 0 8px" }}>
          Verify your identity
        </h1>
        <p style={{ fontSize: 15, color: INK_3, textAlign: "center", lineHeight: 1.6, margin: "0 0 28px" }}>
          Secure, private, takes under 2 minutes.
        </p>

        {/* Icon cards */}
        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          {[
            { icon: "🪪", label: "ID Document" },
            { icon: "📷", label: "Selfie" },
            { icon: "✅", label: "Done" },
          ].map(({ icon, label }) => (
            <div key={label} style={{
              flex: 1, background: SURFACE, borderRadius: 12,
              border: `1px solid ${BORDER}`,
              padding: "14px 8px 12px", textAlign: "center",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            }}>
              <span style={{ fontSize: 22 }}>{icon}</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: INK_3, lineHeight: 1.3 }}>{label}</span>
            </div>
          ))}
        </div>

        <Btn onClick={onNext}>Start verification</Btn>

        {/* Consent */}
        <p style={{ fontSize: 13, color: INK_4, textAlign: "center", lineHeight: 1.55, margin: "16px 0 0" }}>
          By continuing, you consent to Veridian processing your biometric data to verify your identity.{" "}
          <a href="https://veridianapi.com/privacy" target="_blank" rel="noopener noreferrer"
            style={{ color: BRAND, textDecoration: "none", fontWeight: 500 }}>
            Read our Privacy Policy.
          </a>
        </p>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 20 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="5.5" width="8" height="5.5" rx="1" stroke={INK_4} strokeWidth="1.1" />
            <path d="M4 5.5V4C4 2.6 4.9 1.5 6 1.5S8 2.6 8 4v1.5" stroke={INK_4} strokeWidth="1.1" fill="none" />
          </svg>
          <span style={{ fontFamily: MONO, fontSize: 11, color: INK_4, letterSpacing: 0.3 }}>Secured by Veridian</span>
        </div>
      </div>
    </div>
  );
}

// ─── SCREEN: Country Select ────────────────────────────────────────────────────
function CountrySelectScreen({ value, onChange, onNext, onBack, onClose }: {
  value: Country | null; onChange: (c: Country) => void;
  onNext: () => void; onBack: () => void; onClose: () => void;
}) {
  const [q, setQ]       = useState("");
  const [open, setOpen] = useState(false);
  const inputRef        = useRef<HTMLInputElement>(null);
  const filtered        = q ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : COUNTRIES;

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  return (
    <div className="animate-slide-fwd" style={{ padding: "0 20px 40px" }}>
      <TopBar onBack={onBack} onClose={onClose} progress={0} />
      <div style={{ padding: "24px 0 0" }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: INK, letterSpacing: -0.4, margin: "0 0 6px" }}>
          Which country issued your ID?
        </h2>
        <p style={{ fontSize: 14, color: INK_3, margin: "0 0 24px", lineHeight: 1.55 }}>
          We&apos;ll show document types available in your country.
        </p>

        {/* Country dropdown */}
        <div>
          <button type="button" onClick={() => setOpen((o) => !o)} style={{
            all: "unset", cursor: "pointer", boxSizing: "border-box",
            width: "100%", minHeight: 52, borderRadius: 16, padding: "0 16px",
            display: "flex", alignItems: "center", gap: 12,
            background: SURFACE, border: `1.5px solid ${open ? BRAND : BORDER}`,
            transition: "border-color 0.15s",
          }}>
            {value && <span style={{ fontSize: 22 }}>{value.flag}</span>}
            <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: value ? INK : INK_4 }}>
              {value ? value.name : "Select country"}
            </span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
              <path d="M4 6l4 4 4-4" stroke={INK_4} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {open && (
            <div style={{
              marginTop: 6, borderRadius: 16, overflow: "hidden",
              border: `1px solid ${BORDER}`, background: SURFACE,
            }}>
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${BORDER}` }}>
                <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="Search…" style={{
                    width: "100%", outline: "none",
                    border: `1px solid ${BORDER}`, borderRadius: 10,
                    padding: "8px 12px", fontSize: 14, boxSizing: "border-box",
                    background: CARD, color: INK,
                  }} />
              </div>
              <div style={{ maxHeight: 240, overflowY: "auto" }}>
                {filtered.length === 0 && (
                  <p style={{ textAlign: "center", padding: 16, fontSize: 13, color: INK_3 }}>No results</p>
                )}
                {filtered.map((c) => (
                  <button key={c.code} type="button"
                    onClick={() => { onChange(c); setOpen(false); setQ(""); }}
                    style={{
                      all: "unset", cursor: "pointer", boxSizing: "border-box",
                      width: "100%", padding: "12px 16px",
                      display: "flex", alignItems: "center", gap: 12,
                      background: value?.code === c.code ? BRAND_L : "transparent",
                      borderBottom: `1px solid ${BORDER}`,
                    }}>
                    <span style={{ fontSize: 20 }}>{c.flag}</span>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: INK }}>{c.name}</span>
                    {value?.code === c.code && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7l3.5 3.5L9 3" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 24 }}>
          <Btn onClick={onNext} disabled={!value}>Continue</Btn>
        </div>
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <a href="mailto:support@veridianapi.com" style={{ fontSize: 14, color: INK_4, textDecoration: "none" }}>
            Need help?
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── SCREEN: Doc Type Select ──────────────────────────────────────────────────
function DocTypeScreen({ country, onSelect, onBack, onClose }: {
  country: Country | null; onSelect: (d: DocType) => void; onBack: () => void; onClose: () => void;
}) {
  return (
    <div className="animate-slide-fwd" style={{ padding: "0 20px 40px" }}>
      <TopBar onBack={onBack} onClose={onClose} progress={0} />
      <div style={{ padding: "24px 0 0" }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: INK, letterSpacing: -0.4, margin: "0 0 6px" }}>
          Choose your document type
        </h2>
        <p style={{ fontSize: 14, color: INK_3, margin: "0 0 20px", lineHeight: 1.55 }}>
          Make sure your document isn&apos;t expired and clearly shows your name and date of birth.
        </p>
        {country && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px",
            borderRadius: 999, background: BRAND_L, marginBottom: 16,
          }}>
            <span style={{ fontSize: 18 }}>{country.flag}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: INK_2 }}>{country.name}</span>
          </div>
        )}
        <div style={{ background: CARD, borderRadius: 16, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
          {DOC_TYPES.map((dt, i) => (
            <button key={dt.value} type="button" onClick={() => onSelect(dt.value)} style={{
              all: "unset", cursor: "pointer", boxSizing: "border-box",
              width: "100%", minHeight: 52, padding: "0 16px",
              display: "flex", alignItems: "center", gap: 14,
              borderBottom: i < DOC_TYPES.length - 1 ? `1px solid rgba(255,255,255,0.06)` : "none",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(29,158,117,0.06)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
              <DocIcon color={BRAND} />
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: INK }}>{dt.label}</span>
              <ChevronRight />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SCREEN: Doc Capture (full-screen camera + review) ────────────────────────
function DocCaptureScreen({ docLabel, docTypeVal, hasBack, onComplete, onBack, onClose }: {
  docLabel: string; docTypeVal: DocType; hasBack: boolean;
  onComplete: (front: string, frontQ: string | null, back: string | null, backQ: string | null) => void;
  onBack: () => void; onClose: () => void;
}) {
  const [phase, setPhase]       = useState<DocPhase>("front-cam");
  const [frontImg, setFrontImg] = useState<string | null>(null);
  const [frontQ, setFrontQ]     = useState<string | null>(null);
  const [backImg, setBackImg]   = useState<string | null>(null);
  const [backQ, setBackQ]       = useState<string | null>(null);
  const [autocapture, setAutocapture] = useState(false);
  const [flash, setFlash]       = useState(false);
  const [camKey, setCamKey]     = useState(0);
  const libRef                  = useRef<HTMLInputElement>(null);

  const { status, videoRef, canvasRef, capture } = useCamera("environment");
  const quality = useFrameQuality(videoRef, status === "live");

  // Autocapture: fire when quality is good and autocapture is on
  const autoFired = useRef(false);
  useEffect(() => {
    if (!autocapture || !quality) return;
    const good = quality.brightness >= 40 && quality.brightness <= 215 && quality.variance >= 200;
    if (good && !autoFired.current) {
      autoFired.current = true;
      setTimeout(() => doCapture(), 400);
    } else if (!good) {
      autoFired.current = false;
    }
  });

  const doCapture = () => {
    setFlash(true);
    setTimeout(() => setFlash(false), 280);
    setTimeout(async () => {
      const d = capture();
      if (!d) return;
      const q = await checkImageQuality(d);
      if (phase === "front-cam") { setFrontImg(d); setFrontQ(q); setPhase("front-review"); }
      else { setBackImg(d); setBackQ(q); setPhase("back-review"); }
    }, 80);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const d = await fileToDataUrl(f); e.target.value = "";
    const q = await checkImageQuality(d);
    if (phase === "front-cam") { setFrontImg(d); setFrontQ(q); setPhase("front-review"); }
    else { setBackImg(d); setBackQ(q); setPhase("back-review"); }
  };

  const isPassport = docTypeVal === "passport";
  const isCapturing = phase === "front-cam" || phase === "back-cam";
  const isFront     = phase === "front-cam" || phase === "front-review";
  const reviewImg   = phase === "front-review" ? frontImg : backImg;
  const reviewQ     = phase === "front-review" ? frontQ : backQ;

  // ── Camera permission denied ──
  if (status === "denied" && isCapturing) {
    return (
      <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column" }}>
        <TopBar onBack={onBack} onClose={onClose} progress={0} />
        <div style={{ flex: 1, padding: "24px 20px" }}>
          <div style={{
            background: CARD, borderRadius: 16, border: `1px solid ${BORDER}`,
            padding: "32px 20px", textAlign: "center",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: INK, margin: "0 0 8px" }}>
              Camera access required
            </h3>
            <p style={{ fontSize: 14, color: INK_3, lineHeight: 1.6, margin: "0 0 20px" }}>
              Allow camera access to photograph your {docLabel.toLowerCase()}. Check your browser settings and reload.
            </p>
            <input ref={libRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Btn onClick={() => { try { window.location.href = "app-settings:"; } catch { /**/ } }}>
                Open settings
              </Btn>
              <Btn variant="outline" onClick={() => libRef.current?.click()}>
                Upload from library
              </Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Review phase ──
  if ((phase === "front-review" || phase === "back-review") && reviewImg) {
    const isBackReview = phase === "back-review";
    return (
      <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column" }}>
        <TopBar onBack={() => { setPhase(isBackReview ? "back-cam" : "front-cam"); setCamKey((k) => k + 1); }} onClose={onClose} progress={0} />
        <div style={{ flex: 1, padding: "20px 20px 0", display: "flex", flexDirection: "column" }}>
          <div style={{
            padding: "8px 14px", borderRadius: 999, background: SURFACE,
            border: `1px solid ${BORDER}`, display: "inline-flex", alignSelf: "center",
            marginBottom: 16,
          }}>
            <span style={{ fontSize: 13, color: INK_3, fontWeight: 500 }}>
              Make sure all the info on your ID is clear and visible.
            </span>
          </div>

          {reviewQ && (
            <div style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              padding: "10px 14px", borderRadius: 12, background: WARN_L,
              border: `1px solid rgba(217,119,6,0.3)`, marginBottom: 12,
            }}>
              <span style={{ fontSize: 14 }}>⚠️</span>
              <p style={{ fontSize: 13, color: "#d97706", margin: 0, lineHeight: 1.45 }}>{reviewQ}</p>
            </div>
          )}

          <div style={{ flex: 1, position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
            <img src={reviewImg} alt="Captured" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <div style={{
              position: "absolute", top: 10, right: 10,
              display: "flex", gap: 5, padding: "5px 10px", borderRadius: 999,
              background: "rgba(22,163,74,0.85)", color: "#fff", fontSize: 11, fontWeight: 600,
            }}>
              ✓ Captured
            </div>
          </div>

          {/* Label card */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 16px", borderRadius: 12, background: CARD,
            border: `1px solid ${BORDER}`, marginBottom: 20,
          }}>
            <DocIcon color={BRAND} />
            <span style={{ fontSize: 13, fontWeight: 500, color: INK_2 }}>
              {docLabel}{isBackReview ? " (back)" : isFront ? " (front)" : ""}
            </span>
          </div>
        </div>

        <div style={{ padding: "0 20px 32px", display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onClick={() => {
            if (phase === "front-review") {
              if (hasBack) { setPhase("back-cam"); setCamKey((k) => k + 1); }
              else onComplete(frontImg!, frontQ, null, null);
            } else {
              onComplete(frontImg!, frontQ, backImg!, backQ);
            }
          }}>
            {phase === "front-review" && hasBack ? "Continue to back" : "Upload this photo"}
          </Btn>
          <Btn variant="outline" onClick={() => { setPhase(isBackReview ? "back-cam" : "front-cam"); setCamKey((k) => k + 1); }}>
            Use different photo
          </Btn>
        </div>
      </div>
    );
  }

  // ── Camera phase ──
  const goodQuality = quality && quality.brightness >= 40 && quality.brightness <= 215 && quality.variance >= 200;
  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "#000", overflow: "hidden" }}>
      {/* Camera feed */}
      {status === "starting" ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg style={{ animation: "spin 0.9s linear infinite" }} width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="16" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
            <path d="M20 4a16 16 0 0 1 16 16" stroke={BRAND} strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      ) : (
        <video ref={videoRef} autoPlay muted playsInline style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          objectFit: "cover",
        }} aria-label="Camera feed" />
      )}

      <DocViewfinder isPassport={isPassport} detected={!!goodQuality} />
      <CaptureFlash visible={flash} />
      <canvas ref={canvasRef} style={{ display: "none" }} aria-hidden="true" />

      {/* Top controls */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        padding: "14px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)",
      }}>
        <button type="button" onClick={onBack} style={{
          all: "unset", cursor: "pointer",
          width: 36, height: 36, borderRadius: 8, background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Autocapture toggle */}
        <button type="button" onClick={() => { setAutocapture((a) => !a); autoFired.current = false; }} style={{
          all: "unset", cursor: "pointer", boxSizing: "border-box",
          display: "flex", alignItems: "center", gap: 7,
          padding: "6px 12px", borderRadius: 999,
          background: autocapture ? BRAND_L : "rgba(0,0,0,0.4)",
          border: `1px solid ${autocapture ? BRAND : "rgba(255,255,255,0.2)"}`,
          fontSize: 12, fontWeight: 600, color: autocapture ? BRAND : "rgba(255,255,255,0.7)",
          transition: "all 0.15s",
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: autocapture ? BRAND : "rgba(255,255,255,0.4)",
            animation: autocapture ? "ring-pulse 1.4s ease-out infinite" : "none",
          }} />
          Autocapture
        </button>

        <button type="button" onClick={onClose} style={{
          all: "unset", cursor: "pointer",
          width: 36, height: 36, borderRadius: 8, background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Instruction pill */}
      <div style={{
        position: "absolute", top: "12%", left: 0, right: 0,
        display: "flex", justifyContent: "center", padding: "0 24px",
      }}>
        <PillLabel>
          {phase === "front-cam"
            ? (isPassport ? "Open to the photo page" : `Front of your ${docLabel.toLowerCase()}`)
            : `Back of your ${docLabel.toLowerCase()}`}
        </PillLabel>
      </div>

      {/* Quality hint */}
      {status === "live" && quality && (
        <div style={{ position: "absolute", bottom: 120, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <div style={{
            padding: "6px 14px", borderRadius: 999,
            background: goodQuality ? "rgba(22,163,74,0.8)" : "rgba(0,0,0,0.55)",
            fontSize: 12, fontWeight: 600, color: goodQuality ? "#fff" : INK_3,
            transition: "all 0.25s",
          }}>
            {quality.brightness < 40 ? "Too dark — add light" : quality.brightness > 215 ? "Too bright — reduce glare" : quality.variance < 200 ? "Hold still" : "Lighting good"}
          </div>
        </div>
      )}

      {/* Upload from library */}
      <input ref={libRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
      <div style={{
        position: "absolute", bottom: 20, left: 20, right: 20,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <button type="button" onClick={() => libRef.current?.click()} style={{
          all: "unset", cursor: "pointer",
          width: 48, height: 48, borderRadius: 12,
          background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="3.5" width="16" height="13" rx="2" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" />
            <circle cx="6.5" cy="8" r="1.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.3" />
            <path d="M2 14l4-4 4 4 3-3 5 5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Capture button */}
        <button type="button" onClick={doCapture} aria-label="Take photo" style={{
          all: "unset", cursor: "pointer",
          width: 72, height: 72, borderRadius: "50%",
          background: BRAND, border: "4px solid rgba(255,255,255,0.85)",
          boxShadow: `0 0 0 3px ${BRAND}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(255,255,255,0.75)" }} />
        </button>

        {/* Tips placeholder */}
        <button type="button" style={{
          all: "unset", cursor: "pointer",
          width: 48, height: 48, borderRadius: 12,
          background: "rgba(0,0,0,0.45)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
        }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="7.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.4" />
            <path d="M9 8v5M9 6h.01" stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>Tips</span>
        </button>
      </div>
    </div>
  );
}

// ─── SCREEN: Uploading ────────────────────────────────────────────────────────
function UploadingScreen() {
  return (
    <div className="animate-fade-up" style={{ padding: "0 20px 40px" }}>
      <div style={{
        background: CARD, borderRadius: R_CARD,
        border: `1px solid ${BORDER}`, padding: "40px 24px 36px",
        textAlign: "center",
      }}>
        {/* Animated ID card illustration */}
        <div style={{
          width: 120, height: 80, borderRadius: 10,
          background: SURFACE, border: `1.5px solid ${BORDER}`,
          margin: "0 auto 28px", position: "relative", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <DocIcon color={INK_4} />
          {/* Scan bar */}
          <div style={{
            position: "absolute", left: 0, right: 0, height: 2,
            background: `linear-gradient(90deg, transparent 0%, ${BRAND} 40%, ${BRAND} 60%, transparent 100%)`,
            animation: "doc-scan 2s ease-in-out infinite",
            boxShadow: `0 0 8px ${BRAND}`,
          }} />
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 600, color: INK, letterSpacing: -0.3, margin: "0 0 8px" }}>
          Uploading your ID...
        </h2>
        <p style={{ fontSize: 14, color: INK_3, lineHeight: 1.6, margin: 0 }}>
          Hang tight — this may take a few seconds.
        </p>
      </div>
    </div>
  );
}

// ─── SCREEN: Upload Error ─────────────────────────────────────────────────────
function UploadErrorScreen({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  const tips = [
    "Avoid flash — use natural daylight",
    "Keep all four corners visible",
    "Move closer if the photo is blurry",
    "Make sure all text is legible",
  ];
  return (
    <div className="animate-fade-up" style={{ padding: "0 20px 40px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 0 8px" }}>
        <IconBtn onClick={onClose} label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </IconBtn>
      </div>
      <div style={{
        background: CARD, borderRadius: R_CARD,
        border: `1px solid ${BORDER}`, padding: "32px 24px 28px",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <div style={{ position: "relative" }}>
            <div style={{ width: 72, height: 56, borderRadius: 8, background: SURFACE, border: `1.5px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <DocIcon color={INK_3} />
            </div>
            <div style={{
              position: "absolute", bottom: -8, right: -8,
              width: 22, height: 22, borderRadius: "50%",
              background: DANGER, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 2l6 6M8 2L2 8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 600, color: INK, textAlign: "center", margin: "0 0 8px" }}>
          Couldn&apos;t upload your ID
        </h2>
        <p style={{ fontSize: 14, color: INK_3, textAlign: "center", margin: "0 0 20px" }}>
          Try again with these tips:
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {tips.map((tip) => (
            <div key={tip} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: BRAND, flexShrink: 0, marginTop: 5 }} />
              <p style={{ fontSize: 14, color: INK_3, margin: 0, lineHeight: 1.45 }}>{tip}</p>
            </div>
          ))}
        </div>

        <Btn onClick={onRetry}>Try again</Btn>
      </div>
    </div>
  );
}

// ─── SCREEN: Selfie Intro ──────────────────────────────────────────────────────
function SelfieIntroScreen({ onNext, onBack, onClose }: { onNext: () => void; onBack: () => void; onClose: () => void }) {
  return (
    <div className="animate-slide-fwd" style={{ padding: "0 20px 40px" }}>
      <TopBar onBack={onBack} onClose={onClose} progress={1} />
      <div style={{ padding: "28px 0 0" }}>
        {/* Face illustration */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <div style={{
            width: 120, height: 120, borderRadius: "50%",
            background: BRAND_L, border: `2px solid ${BRAND_G}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 56,
          }}>
            🧑
          </div>
        </div>

        <h2 style={{ fontSize: 26, fontWeight: 600, color: INK, letterSpacing: -0.4, margin: "0 0 10px" }}>
          Now, a quick selfie
        </h2>
        <p style={{ fontSize: 15, color: INK_3, lineHeight: 1.6, margin: "0 0 28px" }}>
          Move your head slowly left and right so we can match it to your ID photo.{" "}
          <a href="mailto:support@veridianapi.com" style={{ color: BRAND, textDecoration: "none", fontWeight: 500 }}>
            Need help?
          </a>
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
          {[
            "Good lighting on your face",
            "Remove glasses if possible",
            "Look directly at the camera",
          ].map((tip) => (
            <div key={tip} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill={BRAND_L} stroke={BRAND} strokeWidth="1.2" />
                <path d="M5 8l2 2 4-4" stroke={BRAND} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: 14, color: INK_2 }}>{tip}</span>
            </div>
          ))}
        </div>

        <Btn onClick={onNext}>Take selfie</Btn>
      </div>
    </div>
  );
}

// ─── SCREEN: Selfie Camera (liveness) ────────────────────────────────────────
function SelfieScreen({ onComplete, onBack, onClose }: {
  onComplete: (img: string, q: string | null) => void;
  onBack: () => void; onClose: () => void;
}) {
  const [liveness, setLiveness]   = useState<LivenessPhase>("framing");
  const [progress, setProgress]   = useState(0);
  const [image, setImage]         = useState<string | null>(null);
  const [imageQ, setImageQ]       = useState<string | null>(null);
  const [flash, setFlash]         = useState(false);
  const [camKey, setCamKey]       = useState(0);
  const libRef                    = useRef<HTMLInputElement>(null);
  const livenessStarted           = useRef(false);
  const progressRef               = useRef(0);

  const { status, videoRef, canvasRef, capture } = useCamera("user");
  const quality = useFrameQuality(videoRef, status === "live" && liveness === "framing");

  // Detect "face present" from quality and start liveness
  useEffect(() => {
    if (liveness !== "framing" || !quality) return;
    const hasSignal = quality.brightness >= 40 && quality.brightness <= 215 && quality.variance >= 120;
    if (hasSignal && !livenessStarted.current) {
      livenessStarted.current = true;
      setLiveness("checking");
    }
  });

  // Liveness progress timer (2.4s to fill)
  useEffect(() => {
    if (liveness !== "checking") return;
    const id = setInterval(() => {
      progressRef.current = Math.min(progressRef.current + 4, 100);
      setProgress(progressRef.current);
      if (progressRef.current >= 100) {
        clearInterval(id);
        setTimeout(() => doCapture(), 150);
      }
    }, 96);
    return () => clearInterval(id);
  }, [liveness]);

  const doCapture = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 280);
    setTimeout(async () => {
      const d = capture();
      if (!d) return;
      const q = await checkImageQuality(d);
      setImage(d); setImageQ(q);
    }, 80);
  }, [capture]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const d = await fileToDataUrl(f); e.target.value = "";
    const q = await checkImageQuality(d);
    setImage(d); setImageQ(q);
  };

  // Permission denied
  if (status === "denied" && !image) {
    return (
      <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column" }}>
        <TopBar onBack={onBack} onClose={onClose} progress={1} />
        <div style={{ flex: 1, padding: "24px 20px" }}>
          <div style={{ background: CARD, borderRadius: 16, border: `1px solid ${BORDER}`, padding: "32px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🤳</div>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: INK, margin: "0 0 8px" }}>Camera access required</h3>
            <p style={{ fontSize: 14, color: INK_3, lineHeight: 1.6, margin: "0 0 20px" }}>
              Allow camera access to take your selfie. Check your browser settings.
            </p>
            <input ref={libRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Btn onClick={() => { try { window.location.href = "app-settings:"; } catch { /**/ } }}>Open settings</Btn>
              <Btn variant="outline" onClick={() => libRef.current?.click()}>Upload from library</Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Review captured selfie
  if (image) {
    return (
      <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column" }}>
        <TopBar onBack={() => { setImage(null); setImageQ(null); setLiveness("framing"); livenessStarted.current = false; progressRef.current = 0; setProgress(0); setCamKey((k) => k + 1); }} onClose={onClose} progress={1} />
        <div style={{ flex: 1, padding: "20px 20px 0", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "inline-flex", alignSelf: "center", marginBottom: 16, padding: "8px 16px", borderRadius: 999, background: SURFACE, border: `1px solid ${BORDER}` }}>
            <span style={{ fontSize: 13, color: INK_3, fontWeight: 500 }}>Check your selfie — face clearly visible?</span>
          </div>
          {imageQ && (
            <div style={{ display: "flex", gap: 10, padding: "10px 14px", borderRadius: 12, background: WARN_L, border: `1px solid rgba(217,119,6,0.3)`, marginBottom: 12 }}>
              <span style={{ fontSize: 14 }}>⚠️</span>
              <p style={{ fontSize: 13, color: WARN, margin: 0, lineHeight: 1.45 }}>{imageQ}</p>
            </div>
          )}
          <div style={{ flex: 1, position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
            <img src={image} alt="Selfie" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transform: "scaleX(-1)" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 12, background: CARD, border: `1px solid ${BORDER}`, marginBottom: 20 }}>
            <span style={{ fontSize: 16 }}>🤳</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: INK_2 }}>Selfie photo</span>
          </div>
        </div>
        <div style={{ padding: "0 20px 32px", display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onClick={() => onComplete(image, imageQ)}>Use this photo</Btn>
          <Btn variant="outline" onClick={() => { setImage(null); setImageQ(null); setLiveness("framing"); livenessStarted.current = false; progressRef.current = 0; setProgress(0); setCamKey((k) => k + 1); }}>
            Retake selfie
          </Btn>
        </div>
      </div>
    );
  }

  // Live camera with liveness overlay
  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "#000", overflow: "hidden" }}>
      {status === "starting" ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg style={{ animation: "spin 0.9s linear infinite" }} width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="16" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
            <path d="M20 4a16 16 0 0 1 16 16" stroke={BRAND} strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      ) : (
        <video key={camKey} ref={videoRef} autoPlay muted playsInline style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          objectFit: "cover", transform: "scaleX(-1)",
        }} aria-label="Front camera feed" />
      )}

      <FaceOverlay liveness={liveness} progress={progress} />
      <CaptureFlash visible={flash} />
      <canvas ref={canvasRef} style={{ display: "none" }} aria-hidden="true" />

      {/* Top bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        padding: "14px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)",
      }}>
        <button type="button" onClick={onBack} style={{ all: "unset", cursor: "pointer", width: 36, height: 36, borderRadius: 8, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {liveness === "checking" && (
          <span style={{ fontSize: 11, fontFamily: MONO, color: INK_3, letterSpacing: 0.5, textTransform: "uppercase" as const }}>
            Liveness
          </span>
        )}
        <button type="button" onClick={onClose} style={{ all: "unset", cursor: "pointer", width: 36, height: 36, borderRadius: 8, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Instruction */}
      <div style={{
        position: "absolute", bottom: 80, left: 0, right: 0,
        display: "flex", justifyContent: "center", padding: "0 24px",
      }}>
        <PillLabel>
          {liveness === "framing" ? "Position your face within the frame"
            : liveness === "checking" ? "Turn your head slowly left and right"
            : "Verifying..."}
        </PillLabel>
      </div>

      {/* Liveness progress arc */}
      {liveness === "checking" && (
        <div style={{
          position: "absolute", bottom: 20, left: 0, right: 0,
          display: "flex", justifyContent: "center",
        }}>
          <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
            <circle cx="30" cy="30" r="26" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
            <circle cx="30" cy="30" r="26"
              stroke={BRAND} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={`${(progress / 100) * 163.4} 163.4`}
              transform="rotate(-90 30 30)"
              style={{ transition: "stroke-dasharray 0.1s linear" }} />
            <text x="30" y="35" textAnchor="middle" fontSize="12" fontWeight="600" fill={BRAND} fontFamily="sans-serif">
              {progress}%
            </text>
          </svg>
        </div>
      )}
    </div>
  );
}

// ─── SCREEN: Processing ────────────────────────────────────────────────────────
const PROC_STEPS = [
  { label: "Applicant data",      icon: "👤" },
  { label: "Identity document",   icon: "🪪" },
  { label: "Selfie",              icon: "🤳" },
];

function ProcessingScreen({ step }: { step: number }) {
  return (
    <div className="animate-fade-up" style={{ padding: "0 20px 40px" }}>
      <div style={{ background: CARD, borderRadius: R_CARD, border: `1px solid ${BORDER}`, padding: "36px 24px 28px" }}>
        {/* Hourglass */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: SURFACE, border: `1px solid ${BORDER}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 28,
            animation: "veridian-hourglass 2s ease-in-out infinite",
          }}>
            ⏳
          </div>
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 600, color: INK, textAlign: "center", margin: "0 0 6px" }}>
          Checking your data
        </h2>
        <p style={{ fontSize: 14, color: INK_3, textAlign: "center", margin: "0 0 24px", lineHeight: 1.5 }}>
          The verification status will update automatically.
        </p>

        {/* Status checklist */}
        <div style={{ borderRadius: 16, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
          {PROC_STEPS.map(({ label, icon }, i) => {
            const done   = i < step;
            const active = i === step;
            const pend   = i > step;
            return (
              <div key={label} style={{
                display: "flex", alignItems: "center", gap: 14,
                minHeight: 52, padding: "0 16px",
                borderBottom: i < PROC_STEPS.length - 1 ? `1px solid rgba(255,255,255,0.06)` : "none",
                opacity: pend ? 0.45 : 1,
                transition: "opacity 0.25s",
              }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: done || active ? 500 : 400, color: done || active ? INK : INK_3 }}>
                  {label}
                </span>
                {done ? (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <circle cx="9" cy="9" r="8" fill={OK_L} />
                    <path d="M5.5 9l2.5 2.5 4.5-5" stroke={OK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : active ? (
                  <svg style={{ animation: "spin 1.2s linear infinite" }} width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <circle cx="9" cy="9" r="7" stroke={BORDER} strokeWidth="2" />
                    <path d="M9 2a7 7 0 0 1 7 7" stroke={BRAND} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <circle cx="9" cy="9" r="7.5" stroke={BORDER} strokeWidth="1.5" />
                    <path d="M6 9h6M9 6v6" stroke={INK_4} strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── SCREEN: Result ────────────────────────────────────────────────────────────
function ResultScreen({ result, onRetry }: { result: VerificationResult; onRetry: () => void }) {
  return (
    <div className="animate-fade-up" style={{ padding: "0 20px 40px" }}>
      <div style={{ background: CARD, borderRadius: R_CARD, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
        {result.success ? (
          <>
            {/* Green gradient banner */}
            <div style={{
              background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_D} 100%)`,
              padding: "40px 24px 36px", display: "flex", justifyContent: "center",
            }}>
              <div className="animate-scale-in" style={{ width: 96, height: 96 }}>
                <svg width="96" height="96" viewBox="0 0 96 96" fill="none">
                  <circle cx="48" cy="48" r="44" fill="rgba(255,255,255,0.15)" />
                  <circle cx="48" cy="48" r="40" stroke="rgba(255,255,255,0.45)" strokeWidth="2" />
                  <path d="M30 48l13 13 23-25"
                    stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
                    strokeDasharray="58" strokeDashoffset="58" className="animate-check-draw" />
                </svg>
              </div>
            </div>
            <div style={{ padding: "28px 24px 32px", textAlign: "center" }}>
              <h2 style={{ fontSize: 26, fontWeight: 600, color: INK, letterSpacing: -0.4, margin: "0 0 10px" }}>
                Verification complete
              </h2>
              <p style={{ fontSize: 15, color: INK_3, lineHeight: 1.6, margin: "0 0 24px" }}>
                Your identity has been verified. You can close this window.
              </p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect x="2" y="5.5" width="8" height="5.5" rx="1" stroke={INK_4} strokeWidth="1.1" />
                  <path d="M4 5.5V4C4 2.6 4.9 1.5 6 1.5S8 2.6 8 4v1.5" stroke={INK_4} strokeWidth="1.1" fill="none" />
                </svg>
                <span style={{ fontFamily: MONO, fontSize: 11, color: INK_4, letterSpacing: 0.3 }}>Secured by Veridian</span>
              </div>
            </div>
          </>
        ) : (
          <div style={{ padding: "40px 24px 32px", textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
              <div className="animate-scale-in" style={{ width: 80, height: 80 }}>
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <circle cx="40" cy="40" r="36" fill={DANGER_L} />
                  <circle cx="40" cy="40" r="32" stroke={DANGER} strokeWidth="2" />
                  <path d="M26 26l28 28M54 26L26 54" stroke={DANGER} strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 600, color: INK, letterSpacing: -0.4, margin: "0 0 10px" }}>
              Verification unsuccessful
            </h2>
            <p style={{ fontSize: 14, color: INK_3, lineHeight: 1.6, margin: "0 0 24px" }}>
              {result.error ?? "We were unable to verify your identity."}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Btn onClick={onRetry}>Try again</Btn>
              <a href="mailto:support@veridianapi.com" style={{ all: "unset" }}>
                <Btn variant="outline">Get help</Btn>
              </a>
            </div>
          </div>
        )}
      </div>
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
  const [showExit, setShowExit]   = useState(false);

  useEffect(() => {
    const isPhone = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
    setFlowStep(isPhone ? "welcome" : "entry");
  }, []);

  const go = useCallback((to: FlowStep, d: Direction = "forward") => {
    setDir(d); setFlowStep(to);
  }, []);

  const docInfo  = DOC_TYPES.find((d) => d.value === docType);
  const docLabel = docInfo?.label ?? "Document";
  const hasBack  = docInfo?.hasBack ?? false;

  const handleDocComplete = async (front: string, frontQ: string | null, back: string | null, backQ: string | null) => {
    setDocFront(front); setDocFrontQ(frontQ);
    if (back) { setDocBack(back); setDocBackQ(backQ); }
    go("uploading");
    await delay(2800);
    go("selfie-intro");
  };

  const handleSelfieComplete = (img: string, q: string | null) => {
    setSelfie(img);
    handleSubmit(img);
  };

  const handleSubmit = async (selfieImg: string) => {
    if (!docFront || !docType || submitting) return;
    setSubmitting(true);
    go("processing");
    setProcStep(0);
    await delay(900);  setProcStep(1);
    await delay(1050); setProcStep(2);
    const [res] = await Promise.all([
      submitVerification(token, {
        document_front: stripPfx(docFront),
        ...(docBack ? { document_back: stripPfx(docBack) } : {}),
        selfie: stripPfx(selfieImg),
        document_type: docType,
      }),
      delay(980),
    ]);
    setProcStep(3);
    await delay(500);
    setResult(res);
    setSubmitting(false);
    go("result");
  };

  const handleClose = () => {
    const safeSteps: FlowStep[] = ["detecting", "entry", "welcome", "result"];
    if (safeSteps.includes(flowStep)) {
      go("welcome");
    } else {
      setShowExit(true);
    }
  };

  const handleExit = () => {
    setShowExit(false);
    setCountry(null); setDocType(null);
    setDocFront(null); setDocBack(null); setSelfie(null);
    go("welcome");
  };

  const handleMobileComplete = useCallback((res: VerificationResult) => {
    setResult(res); go("result");
  }, [go]);

  const renderStep = () => {
    if (flowStep === "detecting") return null;

    if (flowStep === "entry") {
      return <EntryScreen token={token} onMobileComplete={handleMobileComplete} />;
    }

    if (flowStep === "welcome") {
      return <WelcomeScreen onNext={() => go("country-select")} />;
    }

    if (flowStep === "country-select") {
      return (
        <CountrySelectScreen
          value={country}
          onChange={(c) => { setCountry(c); setDocType(null); }}
          onNext={() => go("doc-type")}
          onBack={() => go("welcome", "backward")}
          onClose={handleClose}
        />
      );
    }

    if (flowStep === "doc-type") {
      return (
        <DocTypeScreen
          country={country}
          onSelect={(d) => { setDocType(d); go("doc-capture"); }}
          onBack={() => go("country-select", "backward")}
          onClose={handleClose}
        />
      );
    }

    if (flowStep === "doc-capture") {
      return (
        <DocCaptureScreen
          docLabel={docLabel}
          docTypeVal={docType ?? "passport"}
          hasBack={hasBack}
          onComplete={handleDocComplete}
          onBack={() => go("doc-type", "backward")}
          onClose={handleClose}
        />
      );
    }

    if (flowStep === "uploading") {
      return <UploadingScreen />;
    }

    if (flowStep === "upload-error") {
      return (
        <UploadErrorScreen
          onRetry={() => go("doc-capture")}
          onClose={handleClose}
        />
      );
    }

    if (flowStep === "selfie-intro") {
      return (
        <SelfieIntroScreen
          onNext={() => go("selfie")}
          onBack={() => go("doc-type", "backward")}
          onClose={handleClose}
        />
      );
    }

    if (flowStep === "selfie") {
      return (
        <SelfieScreen
          onComplete={handleSelfieComplete}
          onBack={() => go("selfie-intro", "backward")}
          onClose={handleClose}
        />
      );
    }

    if (flowStep === "processing") {
      return <ProcessingScreen step={procStep} />;
    }

    if (flowStep === "result" && result) {
      return (
        <ResultScreen
          result={result}
          onRetry={() => {
            setResult(null); setDocFront(null); setDocBack(null); setSelfie(null);
            go("welcome");
          }}
        />
      );
    }

    return null;
  };

  const anim = dir === "forward" ? "animate-slide-fwd" : "animate-slide-bwd";
  const showTopPadding = !["detecting", "doc-capture", "selfie"].includes(flowStep);

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column" }}>
      <div style={{ width: "100%", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <div style={{ flex: 1, paddingTop: showTopPadding ? 20 : 0 }}>
          <div key={flowStep} className={anim}>
            {renderStep()}
          </div>
        </div>

        {!["detecting", "doc-capture", "selfie", "entry"].includes(flowStep) && (
          <p style={{
            textAlign: "center", fontSize: 11, padding: "16px 20px",
            fontFamily: MONO, color: "rgba(255,255,255,0.08)", letterSpacing: 0.5,
          }}>
            Secured by Veridian · End-to-end encrypted
          </p>
        )}
      </div>

      {showExit && (
        <ExitDialog
          onContinue={() => setShowExit(false)}
          onExit={handleExit}
        />
      )}
    </div>
  );
}
