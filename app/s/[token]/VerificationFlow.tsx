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
const INK_2    = "#374151";
const INK_3    = "#6b7280";
const INK_4    = "#9ca3af";
const BORDER   = "#e5e7eb";
const SURFACE  = "#f9fafb";
const DANGER   = "#dc2626";
const DANGER_L = "rgba(220,38,38,0.08)";
const BTN_H    = 52;
const MONO     = 'var(--font-mono,"JetBrains Mono","SF Mono",ui-monospace,monospace)';
// Dark-overlay text (camera screens)
const INK_D    = "#f0f4f3";
const INK_D3   = "#a3b3ae";

// ─── Types ───────────────────────────────────────────────────────────────────
type FlowStep =
  | "detecting" | "entry" | "welcome"
  | "country-select" | "doc-type"
  | "doc-capture" | "uploading" | "upload-error"
  | "selfie-intro" | "selfie"
  | "processing" | "result";

type Direction     = "forward" | "backward";
type DocType       = "passport" | "national_id" | "driving_licence" | "residence_permit";
type DocPhase      = "front-cam" | "front-review" | "back-cam" | "back-review";
type CamStatus     = "starting" | "live" | "denied";
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
        else if (brightness > 220) resolve("Image appears overexposed. Reduce glare.");
        else resolve(null);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
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

// ─── Shared Primitives ────────────────────────────────────────────────────────
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

function Btn({ onClick, disabled, loading, children, variant = "primary", small }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean;
  children?: React.ReactNode;
  variant?: "primary" | "ghost" | "outline" | "danger";
  small?: boolean;
}) {
  const h = small ? 36 : BTN_H;
  const base: React.CSSProperties = {
    width: "100%", minHeight: h, borderRadius: 999, border: "none",
    cursor: disabled || loading ? "not-allowed" : "pointer",
    fontWeight: 600, fontSize: small ? 14 : 16,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    transition: "opacity 0.15s",
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: {
      background: disabled || loading ? "rgba(15,110,86,0.3)" : BRAND,
      color: disabled || loading ? "rgba(255,255,255,0.4)" : "#fff",
    },
    ghost: {
      background: "transparent", color: disabled ? INK_4 : INK_3,
      border: `1px solid ${BORDER}`,
    },
    outline: {
      background: "transparent",
      color: disabled ? INK_4 : BRAND,
      border: `1.5px solid ${disabled ? BORDER : BRAND}`,
    },
    danger: {
      background: DANGER_L, color: DANGER,
      border: `1px solid rgba(220,38,38,0.2)`,
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
    width: "100%", minHeight: BTN_H, borderRadius: 999, border: "none",
    cursor: disabled || loading ? "not-allowed" : "pointer",
    fontWeight: 600, fontSize: 16,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    transition: "opacity 0.15s",
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: {
      background: disabled || loading ? "rgba(15,110,86,0.3)" : BRAND,
      color: disabled || loading ? "rgba(255,255,255,0.4)" : "#fff",
    },
    ghost: {
      background: "rgba(255,255,255,0.08)",
      color: "rgba(255,255,255,0.7)",
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

function IconBtn({ onClick, label, children, dark = false }: {
  onClick: () => void; label: string; children: React.ReactNode; dark?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} style={{
      all: "unset", cursor: "pointer",
      width: 36, height: 36, borderRadius: 8,
      background: dark ? "rgba(255,255,255,0.07)" : "transparent",
      border: dark ? "none" : `1px solid ${BORDER}`,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      {children}
    </button>
  );
}

function ProgressDots({ step }: { step: 0 | 1 }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", marginTop: 12 }}>
      {[0, 1].map((i) => (
        <div key={i} style={{
          height: 6, borderRadius: 3,
          width: i === step ? 20 : 6,
          background: i <= step ? BRAND : BORDER,
          transition: "all 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        }} />
      ))}
    </div>
  );
}

function TopBar({ onBack, onClose, progress, dark = false }: {
  onBack?: () => void; onClose?: () => void; progress?: 0 | 1; dark?: boolean;
}) {
  const iconStroke = dark ? "rgba(255,255,255,0.7)" : INK_3;
  return (
    <div style={{ padding: "16px 20px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {onBack ? (
          <IconBtn onClick={onBack} label="Back" dark={dark}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke={iconStroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconBtn>
        ) : <div style={{ width: 36 }} />}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <VeridianMark size={18} />
          <span style={{ fontWeight: 700, fontSize: 14, color: dark ? INK_D : INK, letterSpacing: -0.2 }}>Veridian</span>
        </div>
        {onClose ? (
          <IconBtn onClick={onClose} label="Close" dark={dark}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke={iconStroke} strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </IconBtn>
        ) : <div style={{ width: 36 }} />}
      </div>
      {progress !== undefined && <ProgressDots step={progress} />}
    </div>
  );
}

function ExitDialog({ onContinue, onExit }: { onContinue: () => void; onExit: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div className="animate-sheet-up" style={{
        width: "100%", maxWidth: 480,
        background: CARD, borderRadius: "20px 20px 0 0",
        border: `1px solid ${BORDER}`, borderBottom: "none",
        padding: "24px 20px 40px",
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: BORDER, margin: "0 auto 20px" }} />
        <h3 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: "0 0 8px", textAlign: "center" }}>
          Exit verification?
        </h3>
        <p style={{ fontSize: 14, color: INK_3, textAlign: "center", margin: "0 0 24px", lineHeight: 1.55 }}>
          Your progress will be lost and you&apos;ll need to start over.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onClick={onContinue}>Continue verification</Btn>
          <Btn variant="ghost" onClick={onExit}>Exit</Btn>
        </div>
      </div>
    </div>
  );
}

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
          <g key={i} stroke={frameColor} strokeWidth="2.5" strokeLinecap="round"
            style={{ transition: "stroke 0.3s" }}>
            <line x1={cx} y1={cy} x2={cx + sx * bl} y2={cy} />
            <line x1={cx} y1={cy} x2={cx} y2={cy + sy * bl} />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Screens ─────────────────────────────────────────────────────────────────

function EntryScreen({ token, businessName }: { token: string; businessName?: string }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => { setUrl(window.location.href); }, []);

  const qrUrl = url
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}&bgcolor=0d1a14&color=0f6e56&margin=12`
    : "";

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{
      minHeight: "100dvh", background: BG,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "40px 24px",
    }}>
      <div style={{
        maxWidth: 400, width: "100%",
        background: "#0d1a14", borderRadius: 24,
        border: "1px solid rgba(15,110,86,0.2)",
        padding: "40px 32px", textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
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
          <div style={{
            display: "inline-block", borderRadius: 16, overflow: "hidden",
            border: "3px solid rgba(15,110,86,0.25)",
            boxShadow: "0 0 40px rgba(15,110,86,0.12)", marginBottom: 24,
          }}>
            <img src={qrUrl} width={180} height={180} alt="Scan to verify" />
          </div>
        )}
        <p style={{ fontSize: 12, color: "rgba(163,179,174,0.5)", margin: "0 0 16px", fontFamily: MONO }}>
          or copy link to share
        </p>
        <button onClick={copy} style={{
          background: "rgba(15,110,86,0.12)", border: "1px solid rgba(15,110,86,0.25)",
          color: INK_D3, borderRadius: 999, padding: "10px 20px",
          fontSize: 13, fontWeight: 500, cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          {copied ? "✓ Copied!" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

function WelcomeScreen({ businessName, onStart, onClose }: {
  businessName?: string; onStart: () => void; onClose: () => void;
}) {
  const features = [
    { icon: "🪪", title: "Government ID", desc: "Passport or driver's license" },
    { icon: "📷", title: "Quick selfie",   desc: "10-second liveness check" },
    { icon: "🔒", title: "Secure & private", desc: "Bank-grade encryption" },
  ];
  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar onClose={onClose} />
      <div style={{ flex: 1, padding: "32px 20px 0", display: "flex", flexDirection: "column" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20,
            background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_D} 100%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px",
            boxShadow: `0 8px 32px rgba(15,110,86,0.25)`,
          }}>
            <svg width="36" height="40" viewBox="0 0 36 40" fill="none">
              <path d="M18 2L32 7V18C32 28 25 34 18 37C11 34 4 28 4 18V7L18 2Z"
                fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
              <path d="M11 19l5 5 9-9" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, margin: "0 0 10px", letterSpacing: -0.5, lineHeight: 1.2 }}>
            {businessName ? `${businessName} needs to verify your identity` : "Verify your identity"}
          </h1>
          <p style={{ fontSize: 15, color: INK_3, margin: 0, lineHeight: 1.55 }}>
            Quick and secure — takes about 2 minutes
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {features.map((f) => (
            <div key={f.icon} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "14px 16px", borderRadius: 12,
              background: SURFACE, border: `1px solid ${BORDER}`,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, fontSize: 20,
                background: BRAND_L, display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>{f.icon}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: INK, lineHeight: 1.3 }}>{f.title}</div>
                <div style={{ fontSize: 13, color: INK_3, marginTop: 1 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: INK_4, textAlign: "center", lineHeight: 1.6, margin: 0 }}>
          By continuing you agree to biometric data processing. Your data is encrypted and never sold.
        </p>
      </div>
      <div style={{ padding: "20px 20px 40px" }}>
        <Btn onClick={onStart}>Start verification</Btn>
      </div>
    </div>
  );
}

function CountrySelectScreen({ onSelect, onBack, onClose }: {
  onSelect: (c: Country) => void; onBack: () => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Country | null>(null);
  const filtered = COUNTRIES.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar onBack={onBack} onClose={onClose} />
      <div style={{ flex: 1, padding: "24px 20px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 6px", letterSpacing: -0.4 }}>
          Select your country
        </h2>
        <p style={{ fontSize: 14, color: INK_3, margin: "0 0 20px" }}>Choose where your ID was issued</p>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <svg style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
            width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke={INK_4} strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke={INK_4} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input type="text" placeholder="Search countries…"
            value={query} onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%", height: 44, borderRadius: 10,
              border: `1.5px solid ${BORDER}`, background: SURFACE,
              paddingLeft: 40, paddingRight: 16, fontSize: 15, color: INK,
              outline: "none", boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", borderRadius: 12, border: `1px solid ${BORDER}` }}>
          {filtered.map((c, i) => (
            <button key={c.code} type="button" onClick={() => setSelected(c)}
              style={{
                all: "unset", display: "flex", alignItems: "center", gap: 12,
                width: "100%", padding: "14px 16px", cursor: "pointer",
                borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : "none",
                background: selected?.code === c.code ? BRAND_L : "transparent",
                boxSizing: "border-box",
              }}>
              <span style={{ fontSize: 22 }}>{c.flag}</span>
              <span style={{ flex: 1, fontSize: 15, color: INK, fontWeight: 500 }}>{c.name}</span>
              {selected?.code === c.code && (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8l4 4 6-6" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: "12px 20px 40px" }}>
        <Btn onClick={() => selected && onSelect(selected)} disabled={!selected}>Continue</Btn>
      </div>
    </div>
  );
}

function DocTypeScreen({ onSelect, onBack, onClose }: {
  onSelect: (dt: DocType, hasBack: boolean) => void; onBack: () => void; onClose: () => void;
}) {
  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar onBack={onBack} onClose={onClose} progress={0} />
      <div style={{ flex: 1, padding: "24px 20px" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 6px", letterSpacing: -0.4 }}>
          Choose document type
        </h2>
        <p style={{ fontSize: 14, color: INK_3, margin: "0 0 24px" }}>Select a valid government-issued ID</p>
        <div style={{ borderRadius: 14, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
          {DOC_TYPES.map((dt, i) => (
            <button key={dt.value} type="button" onClick={() => onSelect(dt.value, dt.hasBack)}
              style={{
                all: "unset", display: "flex", alignItems: "center", gap: 14,
                width: "100%", padding: "16px 16px", cursor: "pointer",
                borderBottom: i < DOC_TYPES.length - 1 ? `1px solid ${BORDER}` : "none",
                background: "transparent", boxSizing: "border-box",
              }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: BRAND_L, border: `1px solid rgba(15,110,86,0.2)`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <rect x="2" y="3" width="14" height="12" rx="2.5" stroke={BRAND} strokeWidth="1.5" />
                  <line x1="5" y1="8" x2="13" y2="8" stroke={BRAND} strokeWidth="1.2" strokeLinecap="round" />
                  <line x1="5" y1="11" x2="9" y2="11" stroke={BRAND} strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{dt.label}</div>
                <div style={{ fontSize: 12, color: INK_4, marginTop: 2 }}>
                  {dt.hasBack ? "Front & back required" : "Front only"}
                </div>
              </div>
              <ChevronRight />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DocCaptureScreen({ docType, phase, onCapture, onBack, onClose }: {
  docType: DocType; phase: DocPhase;
  onCapture: (img: string, quality: string | null) => void;
  onBack: () => void; onClose: () => void;
}) {
  const isFront    = phase === "front-cam" || phase === "front-review";
  const isPassport = docType === "passport";
  const { status, videoRef, canvasRef, capture } = useCamera("environment");
  const quality = useFrameQuality(videoRef, status === "live");
  const [review, setReview]       = useState<string | null>(null);
  const [autocapture, setAuto]    = useState(true);
  const autoFiredRef              = useRef(false);
  const fileRef                   = useRef<HTMLInputElement>(null);

  const good = quality
    ? quality.brightness >= 40 && quality.brightness <= 215 && quality.variance >= 120
    : false;

  useEffect(() => {
    if (!good) { autoFiredRef.current = false; return; }
    if (!autocapture || autoFiredRef.current || review) return;
    autoFiredRef.current = true;
    const t = setTimeout(async () => {
      const img = capture();
      if (img) { const q = await checkImageQuality(img); setReview(img); }
    }, 400);
    return () => clearTimeout(t);
  }, [good, autocapture, review, capture]);

  const doCapture = async () => {
    const img = capture();
    if (img) { const q = await checkImageQuality(img); setReview(img); }
  };

  const doFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    setReview(url);
  };

  if (status === "denied") {
    return (
      <div style={{ background: BG, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <TopBar onBack={onBack} onClose={onClose} dark />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📷</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: INK_D, margin: "0 0 8px" }}>Camera access needed</h3>
          <p style={{ fontSize: 14, color: INK_D3, margin: "0 0 28px", lineHeight: 1.55 }}>
            Allow camera access in settings, or upload a photo instead.
          </p>
          <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 10 }}>
            <DarkBtn onClick={() => fileRef.current?.click()}>Upload photo</DarkBtn>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={doFile} />
            <DarkBtn variant="ghost" onClick={() => window.location.reload()}>Retry camera</DarkBtn>
          </div>
        </div>
      </div>
    );
  }

  if (review) {
    return (
      <div style={{ background: BG, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <TopBar onClose={onClose} dark />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
          <p style={{ fontSize: 14, color: INK_D3, margin: "0 0 16px", textAlign: "center" }}>
            Check the photo is clear and readable
          </p>
          <div style={{ borderRadius: 12, overflow: "hidden", width: "100%", maxWidth: 360 }}>
            <img src={review} alt="Captured document" style={{ width: "100%", display: "block" }} />
          </div>
        </div>
        <div style={{ padding: "0 20px 40px", display: "flex", flexDirection: "column", gap: 10 }}>
          <DarkBtn onClick={async () => {
            const q = await checkImageQuality(review);
            onCapture(review, q);
          }}>Use this photo</DarkBtn>
          <DarkBtn variant="ghost" onClick={() => { setReview(null); autoFiredRef.current = false; }}>Retake</DarkBtn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#000", minHeight: "100dvh", position: "relative", overflow: "hidden" }}>
      <video ref={videoRef} playsInline muted autoPlay
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {status === "live" && <DocViewfinder isPassport={isPassport} detected={good} />}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        <TopBar onBack={onBack} onClose={onClose} dark />
      </div>
      <div style={{ position: "absolute", bottom: 160, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <div style={{
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
          borderRadius: 999, padding: "8px 18px", color: INK_D, fontSize: 13, fontWeight: 500,
          border: `1px solid ${good ? BRAND : "rgba(255,255,255,0.15)"}`, transition: "border-color 0.3s",
        }}>
          {status === "starting" ? "Starting camera…" : good ? "Hold still — capturing" : (isFront ? "Position front of document" : "Position back of document")}
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 20px 48px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 13, color: INK_D3 }}>Auto-capture</span>
          <button onClick={() => setAuto((v) => !v)} style={{
            all: "unset", width: 40, height: 22, borderRadius: 11,
            background: autocapture ? BRAND : "rgba(255,255,255,0.15)",
            position: "relative", cursor: "pointer", transition: "background 0.2s",
          }}>
            <span style={{
              position: "absolute", top: 2, left: autocapture ? 20 : 2,
              width: 18, height: 18, borderRadius: 9, background: "#fff", transition: "left 0.2s",
            }} />
          </button>
        </div>
        <DarkBtn onClick={doCapture} disabled={status !== "live"}>
          {isFront ? "Capture front" : "Capture back"}
        </DarkBtn>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={doFile} />
        <DarkBtn variant="ghost" onClick={() => fileRef.current?.click()}>Upload from library</DarkBtn>
      </div>
    </div>
  );
}

function UploadingScreen() {
  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{
        position: "relative", width: 120, height: 80,
        background: SURFACE, borderRadius: 10, border: `1.5px solid ${BORDER}`,
        overflow: "hidden", marginBottom: 32, boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
      }}>
        <div style={{
          position: "absolute", left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${BRAND}, transparent)`,
          boxShadow: `0 0 8px ${BRAND}`,
          animation: "doc-scan 1.8s ease-in-out infinite",
        }} />
        <div style={{ padding: "16px 12px" }}>
          <div style={{ height: 8, background: BORDER, borderRadius: 3, marginBottom: 6, width: "70%" }} />
          <div style={{ height: 6, background: BORDER, borderRadius: 3, marginBottom: 4, width: "50%" }} />
          <div style={{ height: 6, background: BORDER, borderRadius: 3, width: "60%" }} />
        </div>
      </div>
      <h3 style={{ fontSize: 20, fontWeight: 700, color: INK, margin: "0 0 8px", textAlign: "center" }}>
        Uploading document
      </h3>
      <p style={{ fontSize: 14, color: INK_3, textAlign: "center", margin: 0 }}>This will only take a moment</p>
    </div>
  );
}

function UploadErrorScreen({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  const tips = [
    "Ensure the document is well-lit",
    "All four corners must be visible",
    "No blurring or motion",
    "Remove any protective sleeve",
  ];
  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar onClose={onClose} />
      <div style={{ flex: 1, padding: "32px 20px" }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: DANGER_L, border: "1px solid rgba(220,38,38,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 8v5m0 3h.01" stroke={DANGER} strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="12" r="9" stroke={DANGER} strokeWidth="1.8" />
          </svg>
        </div>
        <h3 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 8px" }}>
          Couldn&apos;t read document
        </h3>
        <p style={{ fontSize: 14, color: INK_3, margin: "0 0 24px", lineHeight: 1.55 }}>
          Please try again and make sure:
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tips.map((tip) => (
            <div key={tip} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 14px", borderRadius: 10, background: SURFACE, border: `1px solid ${BORDER}`,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, background: BRAND, flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: INK_2 }}>{tip}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: "0 20px 40px" }}>
        <Btn onClick={onRetry}>Try again</Btn>
      </div>
    </div>
  );
}

function SelfieIntroScreen({ onStart, onBack, onClose }: {
  onStart: () => void; onBack: () => void; onClose: () => void;
}) {
  const tips = ["Look directly at the camera", "Good lighting on your face", "Remove sunglasses"];
  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar onBack={onBack} onClose={onClose} progress={1} />
      <div style={{ flex: 1, padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{
          width: 100, height: 100, borderRadius: 50,
          background: BRAND_L, border: `2px solid rgba(15,110,86,0.2)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 28, fontSize: 48,
        }}>🤳</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 8px", textAlign: "center", letterSpacing: -0.4 }}>
          Take a selfie
        </h2>
        <p style={{ fontSize: 14, color: INK_3, margin: "0 0 28px", textAlign: "center", lineHeight: 1.55 }}>
          We&apos;ll briefly scan to confirm it&apos;s really you
        </p>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
          {tips.map((tip) => (
            <div key={tip} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 14px", borderRadius: 10, background: SURFACE, border: `1px solid ${BORDER}`,
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l4 4 6-6" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ fontSize: 14, color: INK_2 }}>{tip}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: "0 20px 40px" }}>
        <Btn onClick={onStart}>Take selfie</Btn>
      </div>
    </div>
  );
}

function SelfieScreen({ onCapture, onBack, onClose }: {
  onCapture: (img: string, quality: string | null) => void;
  onBack: () => void; onClose: () => void;
}) {
  const { status, videoRef, canvasRef, capture } = useCamera("user");
  const quality = useFrameQuality(videoRef, status === "live");
  const [liveness, setLiveness]   = useState<LivenessPhase>("framing");
  const [progress, setProgress]   = useState(0);
  const [review, setReview]       = useState<string | null>(null);
  const progressRef               = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef                   = useRef<HTMLInputElement>(null);

  const good = quality
    ? quality.brightness >= 40 && quality.brightness <= 215 && quality.variance >= 120
    : false;

  useEffect(() => {
    if (!good || liveness !== "framing") return;
    setLiveness("checking");
    setProgress(0);
    progressRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) { clearInterval(progressRef.current!); return 100; }
        return p + 4;
      });
    }, 96);
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [good, liveness]);

  useEffect(() => {
    if (progress < 100 || liveness !== "checking") return;
    setLiveness("done");
    const img = capture();
    if (img) setReview(img);
  }, [progress, liveness, capture]);

  useEffect(() => {
    if (liveness === "checking" && !good) {
      if (progressRef.current) clearInterval(progressRef.current);
      setLiveness("framing");
      setProgress(0);
    }
  }, [good, liveness]);

  const doFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    setReview(url);
  };

  if (status === "denied") {
    return (
      <div style={{ background: BG, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <TopBar onBack={onBack} onClose={onClose} dark />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🤳</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: INK_D, margin: "0 0 8px" }}>Camera access needed</h3>
          <p style={{ fontSize: 14, color: INK_D3, margin: "0 0 28px", lineHeight: 1.55 }}>
            Allow camera access or upload a selfie photo.
          </p>
          <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 10 }}>
            <DarkBtn onClick={() => fileRef.current?.click()}>Upload selfie</DarkBtn>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={doFile} />
          </div>
        </div>
      </div>
    );
  }

  if (review) {
    return (
      <div style={{ background: BG, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <TopBar onClose={onClose} dark />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <p style={{ fontSize: 14, color: INK_D3, margin: "0 0 20px", textAlign: "center" }}>Review your selfie</p>
          <div style={{ borderRadius: "50%", overflow: "hidden", width: 200, height: 200, border: `3px solid ${BRAND}` }}>
            <img src={review} alt="Selfie preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>
        <div style={{ padding: "0 20px 40px", display: "flex", flexDirection: "column", gap: 10 }}>
          <DarkBtn onClick={async () => {
            const q = await checkImageQuality(review);
            onCapture(review, q);
          }}>Use this photo</DarkBtn>
          <DarkBtn variant="ghost" onClick={() => { setReview(null); setLiveness("framing"); setProgress(0); }}>
            Retake
          </DarkBtn>
        </div>
      </div>
    );
  }

  const r = 56, circ = 2 * Math.PI * r;
  const offset = circ * (1 - progress / 100);

  return (
    <div style={{ background: "#111", minHeight: "100dvh", position: "relative", overflow: "hidden" }}>
      <video ref={videoRef} playsInline muted autoPlay
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="130" height="130" style={{ position: "absolute" }}>
          {liveness === "checking" && (
            <circle cx="65" cy="65" r={r} fill="none" stroke={BRAND} strokeWidth="3"
              strokeDasharray={`${circ}`} strokeDashoffset={offset} strokeLinecap="round"
              style={{ transform: "rotate(-90deg)", transformOrigin: "65px 65px", transition: "stroke-dashoffset 0.1s linear" }}
            />
          )}
          <circle cx="65" cy="65" r="60" fill="none"
            stroke={liveness === "checking" ? BRAND : "rgba(255,255,255,0.4)"}
            strokeWidth="2" strokeDasharray="4 3" style={{ transition: "stroke 0.3s" }} />
        </svg>
      </div>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        <TopBar onBack={onBack} onClose={onClose} dark />
      </div>
      <div style={{ position: "absolute", bottom: 140, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <div style={{
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
          borderRadius: 999, padding: "8px 18px", color: INK_D, fontSize: 13, fontWeight: 500,
          border: `1px solid ${liveness === "checking" ? BRAND : "rgba(255,255,255,0.15)"}`,
          transition: "border-color 0.3s",
        }}>
          {liveness === "framing"
            ? (good ? "Hold still…" : "Center your face")
            : liveness === "checking"
            ? "Checking liveness…"
            : "Complete!"}
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "0 20px 48px" }}>
        <DarkBtn onClick={() => { const img = capture(); if (img) setReview(img); }} disabled={status !== "live"}>
          Take selfie
        </DarkBtn>
      </div>
    </div>
  );
}

function ProcessingScreen({ step }: { step: number }) {
  const items = [
    "Checking document authenticity",
    "Matching face to document",
    "Running compliance checks",
  ];
  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px" }}>
      <div style={{
        width: 72, height: 72, borderRadius: 20,
        background: BRAND_L, border: `1px solid rgba(15,110,86,0.2)`,
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 28,
      }}>
        <svg width="32" height="36" viewBox="0 0 32 36" fill="none"
          style={{ animation: "veridian-hourglass 2s ease-in-out infinite" }}>
          <path d="M6 2h20v8L16 18 6 10V2Z" fill={BRAND} opacity="0.6" />
          <path d="M6 34h20v-8L16 18 6 26v8Z" fill={BRAND} />
          <rect x="4" y="1" width="24" height="4" rx="2" fill={BRAND} />
          <rect x="4" y="31" width="24" height="4" rx="2" fill={BRAND} />
        </svg>
      </div>
      <h3 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 8px", textAlign: "center", letterSpacing: -0.4 }}>
        Verifying identity
      </h3>
      <p style={{ fontSize: 14, color: INK_3, margin: "0 0 32px", textAlign: "center" }}>
        Please wait — this takes 10–20 seconds
      </p>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => {
          const done   = i < step;
          const active = i === step;
          return (
            <div key={item} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "14px 16px", borderRadius: 12,
              background: done ? BRAND_L : SURFACE,
              border: `1px solid ${done ? "rgba(15,110,86,0.2)" : BORDER}`,
              transition: "all 0.3s",
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: 12, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: done ? BRAND : "transparent",
                border: active ? `2px solid ${BRAND}` : done ? "none" : `2px solid ${BORDER}`,
                transition: "all 0.3s",
              }}>
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : active ? (
                  <div style={{
                    width: 8, height: 8, borderRadius: 4, background: BRAND,
                    animation: "veridian-pulse-dot 1.2s ease-in-out infinite",
                  }} />
                ) : null}
              </div>
              <span style={{ fontSize: 14, fontWeight: active ? 600 : 400, color: done ? BRAND : active ? INK : INK_3 }}>
                {item}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultScreen({ result, onRetry, onClose }: {
  result: VerificationResult; onRetry: () => void; onClose: () => void;
}) {
  if (result.success) {
    return (
      <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <div style={{
          background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_D} 100%)`,
          padding: "64px 24px 40px", textAlign: "center",
        }}>
          <div className="animate-scale-in" style={{
            width: 80, height: 80, borderRadius: 40,
            background: "rgba(255,255,255,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
          }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <path className="animate-check-draw" d="M8 20l9 9 15-15"
                stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray="56" strokeDashoffset="56" />
            </svg>
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: "#fff", margin: "0 0 6px", letterSpacing: -0.5 }}>
            Verified!
          </h2>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.8)", margin: 0 }}>
            Your identity has been confirmed
          </p>
        </div>
        <div style={{ flex: 1, padding: "28px 20px" }}>
          <div style={{ padding: 20, borderRadius: 14, background: SURFACE, border: `1px solid ${BORDER}` }}>
            <p style={{ fontSize: 14, color: INK_3, margin: 0, lineHeight: 1.6 }}>
              You can now close this window and return to the app that requested verification.
            </p>
          </div>
        </div>
        <div style={{ padding: "0 20px 40px" }}>
          <Btn onClick={onClose}>Close</Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: CARD, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar onClose={onClose} />
      <div style={{ flex: 1, padding: "32px 20px" }}>
        <div style={{
          width: 60, height: 60, borderRadius: 18,
          background: DANGER_L, border: "1px solid rgba(220,38,38,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20,
        }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M14 9v7m0 4h.01" stroke={DANGER} strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="14" cy="14" r="11" stroke={DANGER} strokeWidth="1.8" />
          </svg>
        </div>
        <h3 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 8px", letterSpacing: -0.4 }}>
          Verification failed
        </h3>
        <p style={{ fontSize: 14, color: INK_3, margin: 0, lineHeight: 1.55 }}>
          {result.error ?? "We couldn't verify your identity. Please try again."}
        </p>
      </div>
      <div style={{ padding: "0 20px 40px", display: "flex", flexDirection: "column", gap: 10 }}>
        <Btn onClick={onRetry}>Try again</Btn>
        <Btn variant="ghost" onClick={() => { window.location.href = "mailto:support@veridianapi.com"; }}>
          Get help
        </Btn>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export function VerificationFlow({ token }: { token: string }) {
  const [step, setStep]               = useState<FlowStep>("detecting");
  const [direction, setDirection]     = useState<Direction>("forward");
  const [businessName, setBizName]    = useState<string | undefined>();
  const [showExit, setShowExit]       = useState(false);
  const [docType, setDocType]         = useState<DocType>("passport");
  const [docHasBack, setDocHasBack]   = useState(false);
  const [docPhase, setDocPhase]       = useState<DocPhase>("front-cam");
  const [frontImg, setFrontImg]       = useState<string | null>(null);
  const [backImg, setBackImg]         = useState<string | null>(null);
  const [procStep, setProcStep]       = useState(0);
  const [result, setResult]           = useState<VerificationResult | null>(null);

  const go = useCallback((next: FlowStep, dir: Direction = "forward") => {
    setDirection(dir); setStep(next);
  }, []);

  useEffect(() => {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
    go(mobile ? "welcome" : "entry");
  }, [go]);

  useEffect(() => {
    if (step !== "entry") return;
    const id = setInterval(async () => {
      const s = await getSession(token);
      if (!s) return;
      if (s.business_name) setBizName(s.business_name);
      if (s.status === "approved" || s.status === "complete" || s.status === "rejected") {
        setResult({ success: s.status !== "rejected" });
        go("result");
      }
    }, 2000);
    return () => clearInterval(id);
  }, [step, token, go]);

  useEffect(() => {
    if (step !== "welcome") return;
    getSession(token).then((s) => { if (s?.business_name) setBizName(s.business_name); });
  }, [step, token]);

  const safeSteps: FlowStep[] = ["detecting", "entry", "welcome", "result"];
  const handleClose = () => {
    if (safeSteps.includes(step)) window.close();
    else setShowExit(true);
  };

  const handleDocCapture = async (img: string, q: string | null) => {
    if (docPhase === "front-cam") {
      setFrontImg(img);
      if (docHasBack) { setDocPhase("back-cam"); }
      else { go("uploading"); await delay(2800); go("selfie-intro"); }
    } else {
      setBackImg(img);
      go("uploading"); await delay(2800); go("selfie-intro");
    }
  };

  const handleSelfieCapture = (img: string, _q: string | null) => handleSubmit(img);

  const handleSubmit = async (selfie: string) => {
    go("processing");
    await delay(600);  setProcStep(1);
    await delay(700);  setProcStep(2);
    await delay(900);  setProcStep(3);
    const res = await submitVerification(token, {
      document_type: docType,
      document_front: frontImg!,
      ...(backImg ? { document_back: backImg } : {}),
      selfie,
    });
    setResult(res);
    await delay(400);
    go("result");
  };

  const animClass = direction === "forward" ? "animate-slide-fwd" : "animate-slide-bwd";

  const renderStep = () => {
    switch (step) {
      case "detecting": return null;
      case "entry":
        return <EntryScreen token={token} businessName={businessName} />;
      case "welcome":
        return <WelcomeScreen businessName={businessName} onStart={() => go("country-select")} onClose={handleClose} />;
      case "country-select":
        return <CountrySelectScreen onSelect={() => go("doc-type")} onBack={() => go("welcome", "backward")} onClose={handleClose} />;
      case "doc-type":
        return <DocTypeScreen
          onSelect={(dt, hasBack) => { setDocType(dt); setDocHasBack(hasBack); setDocPhase("front-cam"); go("doc-capture"); }}
          onBack={() => go("country-select", "backward")} onClose={handleClose}
        />;
      case "doc-capture":
        return <DocCaptureScreen
          docType={docType} phase={docPhase}
          onCapture={handleDocCapture}
          onBack={() => go("doc-type", "backward")} onClose={handleClose}
        />;
      case "uploading":  return <UploadingScreen />;
      case "upload-error":
        return <UploadErrorScreen onRetry={() => { setDocPhase("front-cam"); go("doc-capture"); }} onClose={handleClose} />;
      case "selfie-intro":
        return <SelfieIntroScreen onStart={() => go("selfie")} onBack={() => go("doc-capture", "backward")} onClose={handleClose} />;
      case "selfie":
        return <SelfieScreen onCapture={handleSelfieCapture} onBack={() => go("selfie-intro", "backward")} onClose={handleClose} />;
      case "processing": return <ProcessingScreen step={procStep} />;
      case "result":
        return <ResultScreen
          result={result ?? { success: false, error: "Verification was unsuccessful." }}
          onRetry={() => { setDocPhase("front-cam"); setFrontImg(null); setBackImg(null); go("doc-type"); }}
          onClose={() => window.close()}
        />;
      default: return null;
    }
  };

  return (
    <>
      <div key={step} className={animClass} style={{ minHeight: "100dvh" }}>
        {renderStep()}
      </div>
      {showExit && (
        <ExitDialog
          onContinue={() => setShowExit(false)}
          onExit={() => { setShowExit(false); window.close(); }}
        />
      )}
    </>
  );
}
