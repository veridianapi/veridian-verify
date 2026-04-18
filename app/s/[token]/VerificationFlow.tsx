"use client";

import { useState, useRef, useEffect } from "react";
import { submitVerification, type VerificationResult } from "./actions";

type Step = 1 | 2 | 3 | 4;
type DocType = "passport" | "driving_licence" | "national_id";
type CamState = "starting" | "live" | "denied";

// ─── Icons ────────────────────────────────────────────────────────────────────

function ShieldLogo() {
  return (
    <div className="relative flex items-center justify-center" style={{ width: 88, height: 88 }}>
      <span className="animate-ring-pulse absolute rounded-full" style={{ width: 56, height: 56, background: "#1d9e75", opacity: 0.15 }} />
      <span className="animate-ring-pulse-2 absolute rounded-full" style={{ width: 56, height: 56, background: "#1d9e75", opacity: 0.1 }} />
      <div className="relative flex items-center justify-center rounded-2xl" style={{ width: 64, height: 64, background: "rgba(29,158,117,0.1)", border: "1.5px solid rgba(29,158,117,0.3)" }}>
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <path d="M18 3L5 9v10c0 7.7 5.6 14.9 13 17 7.4-2.1 13-9.3 13-17V9L18 3z" fill="#1d9e75" fillOpacity="0.2" stroke="#1d9e75" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M12 18l4.5 4.5 8-9" stroke="#1d9e75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function SmallShield() {
  return (
    <svg width="22" height="22" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M18 3L5 9v10c0 7.7 5.6 14.9 13 17 7.4-2.1 13-9.3 13-17V9L18 3z" fill="#1d9e75" fillOpacity="0.15" stroke="#1d9e75" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 18l4.5 4.5 8-9" stroke="#1d9e75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PassportIcon({ active }: { active: boolean }) {
  const c = active ? "#1d9e75" : "#9ca3af";
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="4" y="2" width="20" height="24" rx="3" stroke={c} strokeWidth="1.8" />
      <circle cx="14" cy="12" r="3.5" stroke={c} strokeWidth="1.6" />
      <path d="M7 19h14M7 22h10" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LicenceIcon({ active }: { active: boolean }) {
  const c = active ? "#1d9e75" : "#9ca3af";
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="24" height="16" rx="3" stroke={c} strokeWidth="1.8" />
      <circle cx="9" cy="14" r="3" stroke={c} strokeWidth="1.6" />
      <path d="M15 12h7M15 16h5" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function NationalIdIcon({ active }: { active: boolean }) {
  const c = active ? "#1d9e75" : "#9ca3af";
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="2" y="5" width="24" height="18" rx="3" stroke={c} strokeWidth="1.8" />
      <path d="M9 18c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="13" cy="11" r="2.5" stroke={c} strokeWidth="1.5" />
    </svg>
  );
}

function GalleryIcon({ color = "#1d9e75" }: { color?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="16" height="16" rx="3" stroke={color} strokeWidth="1.6" />
      <circle cx="7" cy="7" r="1.5" stroke={color} strokeWidth="1.4" />
      <path d="M2 13l4-4 3 3 3-3 4 4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AnimatedCheck() {
  return (
    <div className="animate-scale-in flex items-center justify-center" style={{ width: 88, height: 88 }}>
      <svg width="88" height="88" viewBox="0 0 88 88" fill="none" aria-label="Success">
        <circle cx="44" cy="44" r="40" fill="rgba(29,158,117,0.1)" />
        <circle cx="44" cy="44" r="36" stroke="#1d9e75" strokeWidth="2.5" />
        <path className="animate-check-draw" d="M28 44l11 11 21-23" stroke="#1d9e75" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="56" strokeDashoffset="56" />
      </svg>
    </div>
  );
}

function AnimatedError() {
  return (
    <div className="animate-scale-in flex items-center justify-center" style={{ width: 80, height: 80 }}>
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-label="Error">
        <circle cx="40" cy="40" r="36" fill="rgba(239,68,68,0.08)" />
        <circle cx="40" cy="40" r="32" stroke="#ef4444" strokeWidth="2.5" />
        <path d="M28 28l24 24M52 28L28 52" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ─── Progress Stepper ─────────────────────────────────────────────────────────

const STEP_LABELS = ["Welcome", "Document", "Selfie"];

function ProgressStepper({ current }: { current: Step }) {
  return (
    <div className="flex items-center w-full mb-7" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={3}>
      {STEP_LABELS.map((label, i) => {
        const num = i + 1;
        const done = current > num;
        const active = current === num;
        return (
          <div key={num} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className="flex items-center justify-center rounded-full transition-all duration-300 font-bold text-sm"
                style={{
                  width: 36, height: 36,
                  background: done ? "#1d9e75" : active ? "#ffffff" : "rgba(255,255,255,0.08)",
                  border: active ? "2px solid #1d9e75" : done ? "none" : "2px solid rgba(255,255,255,0.12)",
                  color: done ? "#ffffff" : active ? "#1d9e75" : "rgba(255,255,255,0.3)",
                }}
              >
                {done ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 8l3.5 3.5 6.5-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : num}
              </div>
              <span className="text-xs font-medium hidden sm:block" style={{ color: active ? "rgba(255,255,255,0.8)" : done ? "#1d9e75" : "rgba(255,255,255,0.2)" }}>
                {label}
              </span>
            </div>
            {i < 2 && (
              <div className="flex-1 h-0.5 mx-2 rounded-full transition-all duration-500" style={{ background: current > num ? "#1d9e75" : "rgba(255,255,255,0.08)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Back Button ─────────────────────────────────────────────────────────────

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 text-sm font-medium transition-all duration-200 mb-5 -ml-1 group" style={{ color: "rgba(255,255,255,0.45)" }} aria-label="Go back">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden="true">
        <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Back
    </button>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function Card({ children, className = "", noPad = false }: { children: React.ReactNode; className?: string; noPad?: boolean }) {
  return (
    <div
      className={`w-full rounded-3xl overflow-hidden ${noPad ? "" : "p-6"} ${className}`}
      style={{ background: "#ffffff", boxShadow: "0 4px 40px rgba(0,0,0,0.45), 0 1px 6px rgba(0,0,0,0.25)" }}
    >
      {children}
    </div>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

function PrimaryButton({ onClick, disabled, loading, children }: { onClick?: () => void; disabled?: boolean; loading?: boolean; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full rounded-2xl font-semibold text-base transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.98]"
      style={{
        background: disabled ? "#e5e7eb" : "#1d9e75",
        color: disabled ? "#9ca3af" : "#ffffff",
        minHeight: 56,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : "0 4px 16px rgba(29,158,117,0.35)",
      }}
    >
      {loading ? (
        <svg className="animate-spin" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" />
          <path d="M10 2a8 8 0 0 1 8 8" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : children}
    </button>
  );
}

function GhostButton({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl font-semibold text-base transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.98]"
      style={{ background: "#f3f4f6", color: "#374151", minHeight: 52 }}
    >
      {children}
    </button>
  );
}

// ─── Tips Box ─────────────────────────────────────────────────────────────────

function TipsBox({ tips }: { tips: string[] }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
      <div className="flex items-center gap-2 mb-0.5">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="#f59e0b" fillOpacity="0.15" stroke="#f59e0b" strokeWidth="1.2" />
          <path d="M8 5v4M8 10.5v.5" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-semibold" style={{ color: "#92400e" }}>Tips for a good photo</span>
      </div>
      {tips.map((t) => (
        <div key={t} className="flex items-start gap-2">
          <div className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: "#d97706" }} />
          <span className="text-xs leading-relaxed" style={{ color: "#78350f" }}>{t}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Face Overlay SVG ─────────────────────────────────────────────────────────
// viewBox 300×400, ellipse at cx=150 cy=190 rx=108 ry=138
// bounding box: left=42 right=258 top=52 bottom=328

function FaceOverlay() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 300 400"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <mask id="face-oval-mask">
          <rect x="0" y="0" width="300" height="400" fill="white" />
          <ellipse cx="150" cy="190" rx="108" ry="138" fill="black" />
        </mask>
      </defs>
      {/* Dark surround */}
      <rect x="0" y="0" width="300" height="400" fill="rgba(0,0,0,0.55)" mask="url(#face-oval-mask)" />
      {/* Dashed oval border */}
      <ellipse cx="150" cy="190" rx="108" ry="138" fill="none" stroke="#1d9e75" strokeWidth="2.5" strokeDasharray="9 5" />
      {/* Corner brackets — TL */}
      <path d="M68 52 L42 52 L42 78" stroke="#1d9e75" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {/* TR */}
      <path d="M232 52 L258 52 L258 78" stroke="#1d9e75" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {/* BL */}
      <path d="M68 328 L42 328 L42 302" stroke="#1d9e75" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {/* BR */}
      <path d="M232 328 L258 328 L258 302" stroke="#1d9e75" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Live Camera View ─────────────────────────────────────────────────────────

function LiveCameraView({ onCapture }: { onCapture: (dataUrl: string) => void }) {
  const [camState, setCamState] = useState<CamState>("starting");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCamState("denied");
      return;
    }

    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.play().catch(() => { if (!cancelled) setCamState("denied"); });
        }
        setCamState("live");
      })
      .catch(() => { if (!cancelled) setCamState("denied"); });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCapture(dataUrl);
  };

  const handleFallbackFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onCapture(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  if (camState === "starting") {
    return (
      <div className="flex flex-col items-center justify-center gap-3" style={{ aspectRatio: "3/4", background: "#0a0a0a" }}>
        <svg className="animate-spin" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-label="Starting camera">
          <circle cx="18" cy="18" r="14" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
          <path d="M18 4a14 14 0 0 1 14 14" stroke="#1d9e75" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>Starting camera…</p>
      </div>
    );
  }

  if (camState === "denied") {
    return (
      <div className="flex flex-col items-center gap-5 p-6 text-center">
        <div className="flex items-center justify-center rounded-2xl" style={{ width: 64, height: 64, background: "#fef3c7" }}>
          <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
            <path d="M3 5l24 24M12 6h11a2 2 0 0 1 2 2v9M6 8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="15" cy="15" r="3" stroke="#d97706" strokeWidth="1.6" />
          </svg>
        </div>
        <div>
          <p className="font-bold text-base" style={{ color: "#111827" }}>Camera not available</p>
          <p className="text-sm mt-1" style={{ color: "#6b7280" }}>Upload a photo instead</p>
        </div>
        <input ref={fallbackRef} type="file" accept="image/*" capture="user" onChange={handleFallbackFile} className="hidden" aria-label="Upload selfie" />
        <input type="file" accept="image/*" onChange={handleFallbackFile} className="hidden" id="fallback-library" aria-label="Choose from library" />
        <div className="w-full flex flex-col gap-3">
          <button
            type="button"
            onClick={() => fallbackRef.current?.click()}
            className="w-full rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 sm:hidden"
            style={{ background: "#1d9e75", color: "#fff", minHeight: 52, boxShadow: "0 4px 16px rgba(29,158,117,0.3)" }}
          >
            Take photo
          </button>
          <label
            htmlFor="fallback-library"
            className="w-full rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
            style={{ background: "transparent", color: "#1d9e75", minHeight: 52, border: "1.5px solid #1d9e75" }}
          >
            <GalleryIcon />
            Choose from library
          </label>
        </div>
      </div>
    );
  }

  // live
  return (
    <div className="flex flex-col">
      {/* Instruction */}
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-xl font-bold" style={{ color: "#111827" }}>Take a selfie</h2>
        <p className="text-sm mt-0.5" style={{ color: "#6b7280" }}>Focus on your face in good lighting</p>
      </div>

      {/* Video + overlay */}
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: "3/4", background: "#000" }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
          aria-label="Camera preview"
        />
        <FaceOverlay />

        {/* Instruction badge */}
        <div className="absolute top-4 inset-x-0 flex justify-center pointer-events-none">
          <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.9)", backdropFilter: "blur(4px)" }}>
            Align your face with the oval
          </span>
        </div>
      </div>

      {/* Capture button */}
      <div className="flex flex-col items-center gap-2 py-6">
        <button
          type="button"
          onClick={handleCapture}
          className="flex items-center justify-center transition-all duration-150 active:scale-95"
          style={{
            width: 72, height: 72,
            borderRadius: "50%",
            background: "#1d9e75",
            border: "4px solid rgba(255,255,255,0.9)",
            boxShadow: "0 0 0 3px #1d9e75, 0 8px 24px rgba(29,158,117,0.5)",
          }}
          aria-label="Capture photo"
        >
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,0.85)" }} />
        </button>
        <p className="text-xs" style={{ color: "#9ca3af" }}>Tap to capture</p>
      </div>

      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </div>
  );
}

// ─── Captured Selfie Preview ──────────────────────────────────────────────────

function CapturedSelfiePreview({
  src,
  onRetake,
  onSubmit,
  submitting,
}: {
  src: string;
  onRetake: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <div className="flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-xl font-bold" style={{ color: "#111827" }}>Selfie captured</h2>
        <p className="text-sm mt-0.5" style={{ color: "#6b7280" }}>Looking good — ready to submit?</p>
      </div>

      <div className="relative rounded-2xl overflow-hidden" style={{ background: "#f3f4f6" }}>
        <img src={src} alt="Selfie preview" className="w-full object-cover" style={{ maxHeight: 320, minHeight: 200 }} />
        <div className="absolute top-3 right-3 rounded-full px-3 py-1 text-xs font-semibold flex items-center gap-1.5" style={{ background: "rgba(29,158,117,0.9)", color: "white" }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 6l2.5 2.5 5.5-5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Captured
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-1" style={{ borderTop: "1px solid #f3f4f6" }}>
        <PrimaryButton onClick={onSubmit} loading={submitting}>
          {!submitting && "Submit verification"}
        </PrimaryButton>
        <GhostButton onClick={onRetake}>Retake selfie</GhostButton>
      </div>
    </div>
  );
}

// ─── Step 1: Welcome ─────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const steps = [
    { n: "1", title: "Upload your ID", desc: "Passport, driving licence, or national ID" },
    { n: "2", title: "Take a selfie", desc: "A live photo to match your face" },
    { n: "3", title: "Get verified", desc: "Results processed in seconds" },
  ];

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      <Card>
        <div className="flex flex-col items-center gap-6 text-center">
          <ShieldLogo />
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#111827" }}>Identity verification</h1>
            <p className="mt-1.5 text-sm" style={{ color: "#6b7280" }}>This process takes about 2 minutes</p>
          </div>

          <div className="w-full flex flex-col gap-4 text-left">
            {steps.map((s) => (
              <div key={s.n} className="flex items-start gap-4">
                <div className="flex items-center justify-center rounded-full font-bold text-sm flex-shrink-0 mt-0.5" style={{ width: 32, height: 32, background: "rgba(29,158,117,0.1)", color: "#1d9e75" }}>
                  {s.n}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#111827" }}>{s.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="w-full rounded-2xl p-4 flex items-start gap-3" style={{ background: "#f0fdf4", border: "1px solid rgba(29,158,117,0.2)" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-0.5 flex-shrink-0" aria-hidden="true">
              <path d="M8 1L2 4v5c0 4 2.7 7.7 6 9 3.3-1.3 6-5 6-9V4L8 1z" fill="rgba(29,158,117,0.15)" stroke="#1d9e75" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <p className="text-xs leading-relaxed text-left" style={{ color: "#166534" }}>
              Your data is encrypted end-to-end. We never store your documents beyond verification.
            </p>
          </div>

          <div className="w-full" style={{ borderTop: "1px solid #f3f4f6", paddingTop: 20 }}>
            <PrimaryButton onClick={onNext}>
              Begin verification
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </PrimaryButton>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Step 2: Document Upload ──────────────────────────────────────────────────

const DOC_OPTIONS: { value: DocType; label: string; Icon: React.ComponentType<{ active: boolean }> }[] = [
  { value: "passport",        label: "Passport",        Icon: PassportIcon },
  { value: "driving_licence", label: "Driving licence", Icon: LicenceIcon },
  { value: "national_id",     label: "National ID",     Icon: NationalIdIcon },
];

function DocumentStep({
  docType, onDocTypeChange, image, onFileChange, onNext, onBack,
}: {
  docType: DocType;
  onDocTypeChange: (v: DocType) => void;
  image: string | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const retakeRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLInputElement>(null);

  const isPassport = docType === "passport";

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      <BackButton onClick={onBack} />
      <Card>
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight" style={{ color: "#111827" }}>Upload your document</h2>
            <p className="mt-1 text-sm" style={{ color: "#6b7280" }}>Take a clear photo of the front</p>
          </div>

          {/* Doc type selector */}
          <div className="flex gap-2">
            {DOC_OPTIONS.map(({ value, label, Icon }) => {
              const active = docType === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onDocTypeChange(value)}
                  className="flex-1 flex flex-col items-center gap-2 rounded-2xl py-4 px-2 transition-all duration-200 active:scale-[0.97]"
                  style={{ border: active ? "2px solid #1d9e75" : "2px solid #e5e7eb", background: active ? "rgba(29,158,117,0.05)" : "#fafafa" }}
                  aria-pressed={active}
                >
                  <Icon active={active} />
                  <span className="text-xs font-medium text-center leading-tight" style={{ color: active ? "#1d9e75" : "#6b7280" }}>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Upload / preview */}
          {image ? (
            <div className="flex flex-col gap-3">
              <div className="relative rounded-2xl overflow-hidden" style={{ background: "#f3f4f6" }}>
                <img src={image} alt="Document preview" className="w-full object-cover" style={{ maxHeight: 240, minHeight: 140 }} />
                <div className="absolute top-3 right-3 rounded-full px-3 py-1 text-xs font-semibold flex items-center gap-1.5" style={{ background: "rgba(29,158,117,0.9)", color: "white" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2 6l2.5 2.5 5.5-5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Captured
                </div>
              </div>
              <div className="flex gap-2">
                <input ref={retakeRef} type="file" accept="image/*" capture="environment" onChange={onFileChange} className="hidden" aria-label="Retake" />
                <input ref={changeRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" aria-label="Change photo" />
                <button type="button" onClick={() => retakeRef.current?.click()} className="flex-1 rounded-xl font-medium text-sm py-3 sm:hidden" style={{ color: "#6b7280", background: "#f3f4f6" }}>Retake</button>
                <button type="button" onClick={() => changeRef.current?.click()} className="flex-1 rounded-xl font-medium text-sm py-3" style={{ color: "#6b7280", background: "#f3f4f6" }}>Change photo</button>
              </div>
            </div>
          ) : (
            <>
              {/* Guide + upload */}
              <div
                className="w-full rounded-2xl flex flex-col items-center justify-center gap-3"
                style={{ background: "#f9fafb", border: "2px dashed #1d9e75", minHeight: 168, padding: "20px 16px" }}
              >
                <svg width={isPassport ? 80 : 120} height={isPassport ? 100 : 68} viewBox={isPassport ? "0 0 80 100" : "0 0 120 68"} fill="none" aria-hidden="true">
                  {isPassport ? (
                    <>
                      <rect x="4" y="4" width="72" height="92" rx="8" stroke="#1d9e75" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.45" />
                      <circle cx="40" cy="38" r="13" stroke="#1d9e75" strokeWidth="1.2" opacity="0.3" />
                      <path d="M14 62h52M14 72h38" stroke="#1d9e75" strokeWidth="1.5" strokeLinecap="round" opacity="0.25" />
                    </>
                  ) : (
                    <>
                      <rect x="4" y="4" width="112" height="60" rx="8" stroke="#1d9e75" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.45" />
                      <circle cx="28" cy="34" r="11" stroke="#1d9e75" strokeWidth="1.2" opacity="0.3" />
                      <path d="M50 24h54M50 34h44M50 44h34" stroke="#1d9e75" strokeWidth="1.5" strokeLinecap="round" opacity="0.25" />
                    </>
                  )}
                </svg>
                <p className="text-sm font-medium text-center" style={{ color: "#9ca3af" }}>
                  {docType === "passport" ? "Passport" : docType === "driving_licence" ? "Driving licence" : "National ID"}
                </p>
              </div>

              {/* Upload buttons */}
              <div className="flex flex-col gap-3">
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onFileChange} className="hidden" aria-label="Take photo" />
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="w-full rounded-2xl font-semibold text-base flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.98] sm:hidden"
                  style={{ background: "#1d9e75", color: "#fff", minHeight: 56, boxShadow: "0 4px 16px rgba(29,158,117,0.35)" }}
                >
                  <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                    <path d="M2 8a2 2 0 0 1 2-2h1.5l1.5-2h8l1.5 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8z" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
                    <circle cx="11" cy="13" r="3" stroke="white" strokeWidth="1.6" />
                  </svg>
                  Take photo
                </button>
                <input ref={libraryRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" aria-label="Choose from library" />
                <button
                  type="button"
                  onClick={() => libraryRef.current?.click()}
                  className="w-full rounded-2xl font-semibold text-base flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.98]"
                  style={{ background: "transparent", color: "#1d9e75", minHeight: 56, border: "1.5px solid #1d9e75" }}
                >
                  <GalleryIcon />
                  <span className="sm:hidden">Choose from library</span>
                  <span className="hidden sm:inline">Choose file</span>
                </button>
              </div>
            </>
          )}

          {/* Continue button — anchored bottom of card */}
          <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 20 }}>
            <PrimaryButton onClick={onNext} disabled={!image}>
              Continue
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </PrimaryButton>
          </div>
        </div>
      </Card>

      <TipsBox tips={["All four corners must be visible", "Avoid glare and shadows on the document", "Text must be clearly legible"]} />
    </div>
  );
}

// ─── Step 3: Selfie ───────────────────────────────────────────────────────────

function SelfieStep({
  image,
  onCapture,
  onClear,
  onSubmit,
  onBack,
  submitting,
}: {
  image: string | null;
  onCapture: (dataUrl: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
}) {
  const [cameraKey, setCameraKey] = useState(0);

  const handleRetake = () => {
    onClear();
    setCameraKey((k) => k + 1);
  };

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      <BackButton onClick={onBack} />

      {image ? (
        <Card>
          <CapturedSelfiePreview src={image} onRetake={handleRetake} onSubmit={onSubmit} submitting={submitting} />
        </Card>
      ) : (
        <>
          <Card noPad>
            <LiveCameraView key={cameraKey} onCapture={onCapture} />
          </Card>
          <TipsBox tips={["Face the camera directly with eyes open", "Remove sunglasses or hats", "Find a well-lit area"]} />
        </>
      )}
    </div>
  );
}

// ─── Step 4: Processing / Result ─────────────────────────────────────────────

const PROC_STEPS = ["Uploading documents...", "Verifying identity...", "Checking sanctions...", "Complete"];

function ProcessingStep({ currentStep, result }: { currentStep: number; result: VerificationResult | null }) {
  if (result) {
    return (
      <div className="animate-fade-up">
        <Card>
          <div className="flex flex-col items-center gap-5 py-4 text-center">
            {result.success ? (
              <>
                <AnimatedCheck />
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: "#111827" }}>Verification submitted</h2>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: "#6b7280" }}>
                    You can close this window.<br />
                    We&apos;ll notify the business once your identity is confirmed.
                  </p>
                </div>
                <div className="w-full rounded-2xl p-4" style={{ background: "#f0fdf4", border: "1px solid rgba(29,158,117,0.2)" }}>
                  <p className="text-xs" style={{ color: "#166534" }}>Verification is processing — this usually takes under 60 seconds.</p>
                </div>
              </>
            ) : (
              <>
                <AnimatedError />
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: "#111827" }}>Verification failed</h2>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: "#6b7280" }}>{result.error ?? "Something went wrong. Please try again."}</p>
                </div>
                <button type="button" onClick={() => window.location.reload()} className="w-full rounded-2xl font-semibold text-base py-4 transition-all duration-200" style={{ background: "#1d9e75", color: "#fff", minHeight: 56 }}>
                  Try again
                </button>
              </>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <Card>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <svg className="animate-spin" width="44" height="44" viewBox="0 0 44 44" fill="none" aria-label="Processing">
              <circle cx="22" cy="22" r="18" stroke="#e5e7eb" strokeWidth="4" />
              <path d="M22 4a18 18 0 0 1 18 18" stroke="#1d9e75" strokeWidth="4" strokeLinecap="round" />
            </svg>
            <h2 className="text-lg font-bold" style={{ color: "#111827" }}>Processing your verification</h2>
            <p className="text-sm" style={{ color: "#6b7280" }}>Please keep this window open</p>
          </div>
          <div className="flex flex-col gap-1">
            {PROC_STEPS.map((label, i) => {
              const done = i < currentStep;
              const active = i === currentStep;
              return (
                <div key={label} className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-400" style={{ background: active ? "rgba(29,158,117,0.06)" : "transparent", opacity: i > currentStep ? 0.35 : 1 }}>
                  <div className="flex items-center justify-center rounded-full flex-shrink-0 transition-all duration-400" style={{ width: 28, height: 28, background: done ? "#1d9e75" : active ? "rgba(29,158,117,0.12)" : "#f3f4f6" }}>
                    {done ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                        <path d="M3 7l2.5 2.5 5.5-5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : active ? (
                      <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: "#1d9e75" }} />
                    ) : (
                      <div className="w-2 h-2 rounded-full" style={{ background: "#d1d5db" }} />
                    )}
                  </div>
                  <span className="text-sm font-medium" style={{ color: done || active ? "#111827" : "#9ca3af" }}>{label}</span>
                  {done && <span className="ml-auto text-xs font-medium" style={{ color: "#1d9e75" }}>Done</span>}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function VerificationFlow({ token }: { token: string }) {
  const [step, setStep] = useState<Step>(1);
  const [docType, setDocType] = useState<DocType>("passport");
  const [docImage, setDocImage] = useState<string | null>(null);
  const [selfieImage, setSelfieImage] = useState<string | null>(null);
  const [processingStep, setProcessingStep] = useState(0);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleDocFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await toBase64(file);
    setDocImage(`data:${file.type};base64,${b64}`);
    e.target.value = "";
  };

  const handleSubmit = async () => {
    if (!docImage || !selfieImage || submitting) return;
    setSubmitting(true);
    setStep(4);
    setProcessingStep(0);

    await new Promise((r) => setTimeout(r, 900));
    setProcessingStep(1);
    await new Promise((r) => setTimeout(r, 1100));
    setProcessingStep(2);

    try {
      const res = await submitVerification(token, {
        document_front: docImage.split(",")[1],
        selfie: selfieImage.split(",")[1],
        document_type: docType,
      });
      await new Promise((r) => setTimeout(r, 900));
      setProcessingStep(3);
      await new Promise((r) => setTimeout(r, 500));
      setResult(res);
    } catch {
      setProcessingStep(3);
      setResult({ success: false, error: "Verification failed. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center" style={{ background: "#050a09" }}>
      <div className="w-full max-w-[480px] flex flex-col px-4 pt-6 pb-12">
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-7">
          <SmallShield />
          <span className="text-sm font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.55)" }}>Veridian</span>
        </div>

        {step < 4 && <ProgressStepper current={step} />}

        {step === 1 && <WelcomeStep onNext={() => setStep(2)} />}

        {step === 2 && (
          <DocumentStep
            docType={docType}
            onDocTypeChange={setDocType}
            image={docImage}
            onFileChange={handleDocFile}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}

        {step === 3 && (
          <SelfieStep
            image={selfieImage}
            onCapture={(dataUrl) => setSelfieImage(dataUrl)}
            onClear={() => setSelfieImage(null)}
            onSubmit={handleSubmit}
            onBack={() => setStep(2)}
            submitting={submitting}
          />
        )}

        {step === 4 && <ProcessingStep currentStep={processingStep} result={result} />}

        <p className="text-center text-xs mt-8" style={{ color: "rgba(255,255,255,0.1)" }}>
          Secured by Veridian · End-to-end encrypted
        </p>
      </div>
    </div>
  );
}
