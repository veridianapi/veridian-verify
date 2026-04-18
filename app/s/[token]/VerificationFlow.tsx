"use client";

import { useState, useRef, useEffect } from "react";
import { submitVerification, type VerificationResult } from "./actions";

// ─── Types & Constants ────────────────────────────────────────────────────────

type FlowStep = "welcome" | "doc-select" | "doc-method" | "doc-front" | "doc-back" | "selfie" | "processing";
type Direction = "forward" | "backward";
type DocType = "passport" | "national_id" | "driving_licence" | "residence_permit";
type SelfieMode = "method" | "camera" | "preview";

interface Country { code: string; name: string; flag: string }

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

const DOC_TYPES: { value: DocType; label: string; hasBack: boolean }[] = [
  { value: "passport",         label: "Passport",         hasBack: false },
  { value: "national_id",      label: "National ID",      hasBack: true  },
  { value: "driving_licence",  label: "Driving licence",  hasBack: true  },
  { value: "residence_permit", label: "Residence permit", hasBack: false },
];

const PROC_STEPS = ["Uploading securely...", "Reading document...", "Checking sanctions...", "Matching faces..."];

// ─── Utilities ────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stripPrefix = (s: string) => (s.includes(",") ? s.split(",")[1] : s);

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function checkQuality(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.min(img.width, 100), h = Math.min(img.height, 100);
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const brightness = sum / (d.length / 4);
        resolve(brightness < 45 ? "Image appears too dark — try better lighting." : null);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ─── Small Icons ──────────────────────────────────────────────────────────────

function ShieldMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M18 3L5 9v10c0 7.7 5.6 14.9 13 17 7.4-2.1 13-9.3 13-17V9L18 3z" fill="rgba(15,110,86,0.15)" stroke="#0f6e56" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 18l4.5 4.5 8-9" stroke="#0f6e56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldLarge() {
  return (
    <div className="relative flex items-center justify-center" style={{ width: 80, height: 80 }}>
      <span className="animate-ring-pulse absolute rounded-full" style={{ width: 52, height: 52, background: "#0f6e56", opacity: 0.12 }} />
      <span className="animate-ring-pulse-2 absolute rounded-full" style={{ width: 52, height: 52, background: "#0f6e56", opacity: 0.08 }} />
      <div className="relative flex items-center justify-center rounded-2xl" style={{ width: 60, height: 60, background: "rgba(15,110,86,0.1)", border: "1.5px solid rgba(15,110,86,0.25)" }}>
        <svg width="32" height="32" viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <path d="M18 3L5 9v10c0 7.7 5.6 14.9 13 17 7.4-2.1 13-9.3 13-17V9L18 3z" fill="#0f6e56" fillOpacity="0.2" stroke="#0f6e56" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M12 18l4.5 4.5 8-9" stroke="#0f6e56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function DocPassportIcon({ active }: { active: boolean }) {
  const c = active ? "#0f6e56" : "#9ca3af";
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <rect x="4" y="2" width="22" height="26" rx="3.5" stroke={c} strokeWidth="1.8" />
      <circle cx="15" cy="13" r="4" stroke={c} strokeWidth="1.6" />
      <path d="M7 21h16M7 25h11" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DocIdIcon({ active }: { active: boolean }) {
  const c = active ? "#0f6e56" : "#9ca3af";
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="26" height="18" rx="3" stroke={c} strokeWidth="1.8" />
      <path d="M10 20c0-2.5 2-4.5 4.5-4.5S19 17.5 19 20" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14.5" cy="12" r="2.5" stroke={c} strokeWidth="1.5" />
    </svg>
  );
}

function DocLicenceIcon({ active }: { active: boolean }) {
  const c = active ? "#0f6e56" : "#9ca3af";
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="26" height="18" rx="3" stroke={c} strokeWidth="1.8" />
      <circle cx="10" cy="16" r="3.5" stroke={c} strokeWidth="1.5" />
      <path d="M7.5 16h5M16 13h8M16 17h6M16 21h4" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function DocPermitIcon({ active }: { active: boolean }) {
  const c = active ? "#0f6e56" : "#9ca3af";
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="26" height="18" rx="3" stroke={c} strokeWidth="1.8" />
      <path d="M10 24v-6h10v6" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 18l7-6 7 6" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IcnCamera({ color = "white" }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 9a2 2 0 0 1 2-2h1.5l1.5-2.5h10L18.5 7H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="14" r="3.5" stroke={color} strokeWidth="1.7" />
    </svg>
  );
}

function IcnGallery({ color = "#0f6e56" }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3.5" stroke={color} strokeWidth="1.7" />
      <circle cx="8.5" cy="8.5" r="1.5" stroke={color} strokeWidth="1.4" />
      <path d="M3 15l5-5 4 4 3-3 6 6" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IcnQR({ color = "#0f6e56" }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" stroke={color} strokeWidth="1.7" />
      <rect x="5" y="5" width="3" height="3" fill={color} />
      <rect x="14" y="3" width="7" height="7" rx="1" stroke={color} strokeWidth="1.7" />
      <rect x="16" y="5" width="3" height="3" fill={color} />
      <rect x="3" y="14" width="7" height="7" rx="1" stroke={color} strokeWidth="1.7" />
      <rect x="5" y="16" width="3" height="3" fill={color} />
      <path d="M14 14h2v2h-2zM18 14h3v2h-3zM14 18h2M18 18h3M18 16v2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IcnChevronDown() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 7l5 5 5-5" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AnimatedCheck() {
  return (
    <div className="animate-scale-in" style={{ width: 88, height: 88 }}>
      <svg width="88" height="88" viewBox="0 0 88 88" fill="none" aria-label="Success">
        <circle cx="44" cy="44" r="40" fill="rgba(15,110,86,0.1)" />
        <circle cx="44" cy="44" r="36" stroke="#0f6e56" strokeWidth="2.5" />
        <path className="animate-check-draw" d="M28 44l11 11 21-23" stroke="#0f6e56" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="56" strokeDashoffset="56" />
      </svg>
    </div>
  );
}

function AnimatedError() {
  return (
    <div className="animate-scale-in" style={{ width: 80, height: 80 }}>
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-label="Error">
        <circle cx="40" cy="40" r="36" fill="rgba(239,68,68,0.08)" />
        <circle cx="40" cy="40" r="32" stroke="#ef4444" strokeWidth="2.5" />
        <path d="M28 28l24 24M52 28L28 52" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

const PROGRESS_LABELS = ["Document", "Upload", "Selfie", "Complete"];

function ProgressBar({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div className="flex items-center w-full mb-7">
      {PROGRESS_LABELS.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <div key={n} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="flex items-center justify-center rounded-full font-bold text-sm transition-all duration-300"
                style={{
                  width: 34, height: 34,
                  background: done ? "#0f6e56" : active ? "#fff" : "rgba(255,255,255,0.07)",
                  border: active ? "2px solid #0f6e56" : done ? "none" : "2px solid rgba(255,255,255,0.1)",
                  color: done ? "#fff" : active ? "#0f6e56" : "rgba(255,255,255,0.25)",
                }}
              >
                {done
                  ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7l3 3 6-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : n}
              </div>
              <span className="text-xs font-medium hidden sm:block" style={{ color: active ? "rgba(255,255,255,0.75)" : done ? "#0f6e56" : "rgba(255,255,255,0.18)" }}>
                {label}
              </span>
            </div>
            {i < 3 && (
              <div className="flex-1 h-0.5 mx-2 rounded-full transition-all duration-500"
                style={{ background: step > n ? "#0f6e56" : "rgba(255,255,255,0.07)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Card({ children, noPad = false, className = "" }: { children: React.ReactNode; noPad?: boolean; className?: string }) {
  return (
    <div className={`w-full rounded-3xl overflow-hidden ${noPad ? "" : "p-6"} ${className}`}
      style={{ background: "#fff", boxShadow: "0 4px 48px rgba(0,0,0,0.48), 0 1px 6px rgba(0,0,0,0.22)" }}>
      {children}
    </div>
  );
}

function Btn({ onClick, disabled, loading, children, variant = "primary" }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean; children?: React.ReactNode; variant?: "primary" | "ghost" | "outline";
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: disabled ? "#e5e7eb" : "#0f6e56", color: disabled ? "#9ca3af" : "#fff", boxShadow: disabled ? "none" : "0 4px 16px rgba(15,110,86,0.32)" },
    ghost:   { background: "#f3f4f6", color: "#374151" },
    outline: { background: "transparent", color: "#0f6e56", border: "1.5px solid #0f6e56" },
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled || loading}
      className="w-full rounded-2xl font-semibold text-base flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]"
      style={{ minHeight: 56, cursor: disabled ? "not-allowed" : "pointer", ...styles[variant] }}>
      {loading
        ? <svg className="animate-spin" width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" /><path d="M10 2a8 8 0 0 1 8 8" stroke="white" strokeWidth="2.5" strokeLinecap="round" /></svg>
        : children}
    </button>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1.5 text-sm font-semibold mb-5 -ml-1 group transition-all duration-150"
      style={{ color: "rgba(255,255,255,0.4)" }} aria-label="Go back">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="group-hover:-translate-x-0.5 transition-transform duration-150" aria-hidden="true">
        <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Back
    </button>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "#f3f4f6", margin: "20px 0 0" }} />;
}

function QualityWarn({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl px-4 py-3" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-0.5 flex-shrink-0" aria-hidden="true">
        <path d="M8 2L1 14h14L8 2z" stroke="#d97706" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M8 7v3M8 11.5v.5" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <p className="text-xs leading-relaxed" style={{ color: "#78350f" }}>{msg}</p>
    </div>
  );
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl px-4 py-3" style={{ background: "#f0fdf4", border: "1px solid rgba(15,110,86,0.18)" }}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="mt-0.5 flex-shrink-0" aria-hidden="true">
        <circle cx="8" cy="8" r="7" stroke="#0f6e56" strokeWidth="1.3" />
        <path d="M8 7v4M8 5.5v.5" stroke="#0f6e56" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <p className="text-xs leading-relaxed" style={{ color: "#14532d" }}>{children}</p>
    </div>
  );
}

// ─── Country Selector ─────────────────────────────────────────────────────────

function CountrySelector({ value, onChange }: { value: Country | null; onChange: (c: Country) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = q ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : COUNTRIES;

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between rounded-2xl px-4 transition-all duration-150"
        style={{ minHeight: 56, background: "#f9fafb", border: `1.5px solid ${open ? "#0f6e56" : "#e5e7eb"}` }}>
        <span className="text-base font-medium" style={{ color: value ? "#111827" : "#9ca3af" }}>
          {value ? `${value.flag}  ${value.name}` : "Select your country"}
        </span>
        <IcnChevronDown />
      </button>

      {open && (
        <div className="mt-2 rounded-2xl overflow-hidden" style={{ border: "1px solid #e5e7eb", background: "#fff", boxShadow: "0 4px 24px rgba(0,0,0,0.1)" }}>
          <div className="p-3" style={{ borderBottom: "1px solid #f3f4f6" }}>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search countries…"
              className="w-full text-sm outline-none rounded-xl px-3 py-2"
              style={{ background: "#f9fafb", border: "1px solid #e5e7eb" }} />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 216 }}>
            {filtered.length === 0 && <p className="text-sm text-center py-4" style={{ color: "#9ca3af" }}>No results</p>}
            {filtered.map((c) => (
              <button key={c.code} type="button"
                onClick={() => { onChange(c); setOpen(false); setQ(""); }}
                className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left"
                style={{ background: value?.code === c.code ? "rgba(15,110,86,0.06)" : "transparent" }}>
                <span className="text-xl leading-none">{c.flag}</span>
                <span className="text-sm font-medium" style={{ color: "#111827" }}>{c.name}</span>
                {value?.code === c.code && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="ml-auto" aria-hidden="true">
                    <path d="M2 7l3.5 3.5 6.5-7" stroke="#0f6e56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

// ─── Fake QR Code + QR Screen ─────────────────────────────────────────────────

function FakeQRCode({ size = 160 }: { size?: number }) {
  const N = 21;
  const c = size / N;

  const inFinder = (x: number, y: number, ox: number, oy: number) => {
    const lx = x - ox, ly = y - oy;
    if (lx < 0 || lx > 6 || ly < 0 || ly > 6) return false;
    return lx === 0 || lx === 6 || ly === 0 || ly === 6 || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
  };
  const inFinderZone = (x: number, y: number) =>
    (x <= 7 && y <= 7) || (x >= 13 && y <= 7) || (x <= 7 && y >= 13);

  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let fill = false;
      if (inFinder(x, y, 0, 0) || inFinder(x, y, 14, 0) || inFinder(x, y, 0, 14)) fill = true;
      else if (!inFinderZone(x, y)) {
        if (x === 6 || y === 6) fill = (x + y) % 2 === 0;
        else fill = (x * 7 + y * 11 + x * y * 3) % 5 < 2;
      }
      if (fill) cells.push({ x, y });
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius: 8 }}>
      <rect width={size} height={size} fill="white" />
      {cells.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x * c} y={y * c} width={c - 0.4} height={c - 0.4} fill="#111827" />
      ))}
    </svg>
  );
}

function QRScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const url = `https://verify.veridianapi.com/s/${token}`;
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }).catch(() => {});
  };

  return (
    <div className="animate-slide-fwd flex flex-col gap-4">
      <BackBtn onClick={onBack} />
      <Card>
        <div className="flex flex-col items-center gap-5 text-center">
          <div>
            <h2 className="text-xl font-bold" style={{ color: "#111827" }}>Continue on your phone</h2>
            <p className="mt-1 text-sm" style={{ color: "#6b7280" }}>Scan this code with your phone camera</p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: "#f9fafb", border: "1px solid #e5e7eb" }}>
            <FakeQRCode size={160} />
          </div>
          <div className="w-full rounded-xl px-4 py-3 flex items-center gap-2" style={{ background: "#f3f4f6" }}>
            <p className="text-xs flex-1 text-left truncate font-mono" style={{ color: "#6b7280" }}>{url}</p>
          </div>
          <Divider />
          <Btn onClick={copy} variant={copied ? "ghost" : "primary"}>
            {copied ? "✓  Copied!" : "Copy link"}
          </Btn>
        </div>
      </Card>
    </div>
  );
}

// ─── Live Camera + Face Overlay ───────────────────────────────────────────────

function FaceOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <mask id="oval-mask">
          <rect width="300" height="400" fill="white" />
          <ellipse cx="150" cy="190" rx="108" ry="138" fill="black" />
        </mask>
      </defs>
      <rect width="300" height="400" fill="rgba(0,0,0,0.52)" mask="url(#oval-mask)" />
      <ellipse cx="150" cy="190" rx="108" ry="138" fill="none" stroke="#0f6e56" strokeWidth="2.5" strokeDasharray="9 5" />
      <path d="M68 52 L42 52 L42 78"  stroke="#0f6e56" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M232 52 L258 52 L258 78" stroke="#0f6e56" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M68 328 L42 328 L42 302" stroke="#0f6e56" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M232 328 L258 328 L258 302" stroke="#0f6e56" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LiveCameraView({ onCapture }: { onCapture: (dataUrl: string) => void }) {
  const [state, setState] = useState<"starting" | "live" | "denied">("starting");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!navigator?.mediaDevices?.getUserMedia) { setState("denied"); return; }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) { v.srcObject = stream; v.play().catch(() => { if (!cancelled) setState("denied"); }); }
        setState("live");
      })
      .catch(() => { if (!cancelled) setState("denied"); });
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const capture = () => {
    const v = videoRef.current, cv = canvasRef.current;
    if (!v || !cv) return;
    cv.width = v.videoWidth || 640; cv.height = v.videoHeight || 480;
    cv.getContext("2d")?.drawImage(v, 0, 0, cv.width, cv.height);
    const dataUrl = cv.toDataURL("image/jpeg", 0.88);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCapture(dataUrl);
  };

  const handleFallbackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    onCapture(await fileToDataUrl(file)); e.target.value = "";
  };

  if (state === "starting") {
    return (
      <div className="flex flex-col items-center justify-center gap-3" style={{ aspectRatio: "3/4", background: "#0a0a0a" }}>
        <svg className="animate-spin" width="36" height="36" viewBox="0 0 36 36" fill="none">
          <circle cx="18" cy="18" r="14" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
          <path d="M18 4a14 14 0 0 1 14 14" stroke="#0f6e56" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>Starting camera…</p>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <div className="flex items-center justify-center rounded-2xl" style={{ width: 60, height: 60, background: "#fef3c7" }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <path d="M3 5l22 22M11 6h10a2 2 0 0 1 2 2v8M6 8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h13" stroke="#d97706" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <p className="font-bold" style={{ color: "#111827" }}>Camera unavailable</p>
          <p className="text-sm mt-1" style={{ color: "#6b7280" }}>Upload a photo instead</p>
        </div>
        <input ref={fallbackRef} type="file" accept="image/*" capture="user" onChange={handleFallbackFile} className="hidden" aria-label="Upload selfie" />
        <input type="file" accept="image/*" onChange={handleFallbackFile} className="hidden" id="cam-fb-lib" aria-label="Library" />
        <Btn onClick={() => fallbackRef.current?.click()}>Take photo</Btn>
        <label htmlFor="cam-fb-lib" className="w-full rounded-2xl font-semibold text-base flex items-center justify-center cursor-pointer"
          style={{ minHeight: 52, color: "#0f6e56", border: "1.5px solid #0f6e56" }}>
          Choose from library
        </label>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-xl font-bold" style={{ color: "#111827" }}>Take a selfie</h2>
        <p className="text-sm mt-0.5" style={{ color: "#6b7280" }}>Look directly at the camera in good lighting</p>
      </div>
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: "3/4", background: "#000" }}>
        <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }} aria-label="Camera preview" />
        <FaceOverlay />
        <div className="absolute top-4 inset-x-0 flex justify-center pointer-events-none">
          <span className="text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.92)", backdropFilter: "blur(4px)" }}>
            Position your face here
          </span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2 py-6">
        <button type="button" onClick={capture} aria-label="Capture photo"
          className="flex items-center justify-center transition-all duration-150 active:scale-95"
          style={{ width: 72, height: 72, borderRadius: "50%", background: "#0f6e56", border: "4px solid rgba(255,255,255,0.9)", boxShadow: "0 0 0 3px #0f6e56, 0 8px 24px rgba(15,110,86,0.5)" }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,0.85)" }} />
        </button>
        <p className="text-xs" style={{ color: "#9ca3af" }}>Tap to capture</p>
      </div>
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </div>
  );
}

// ─── Method Cards ─────────────────────────────────────────────────────────────

function MethodCard({ primary = false, onClick, icon, title, subtitle }: {
  primary?: boolean; onClick: () => void; icon: React.ReactNode; title: string; subtitle: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-4 rounded-2xl px-5 text-left transition-all duration-150 active:scale-[0.98]"
      style={{
        minHeight: 80,
        background: primary ? "#0f6e56" : "#f9fafb",
        border: primary ? "none" : "1.5px solid #e5e7eb",
        boxShadow: primary ? "0 4px 16px rgba(15,110,86,0.3)" : "none",
      }}>
      <div className="flex items-center justify-center rounded-xl flex-shrink-0"
        style={{ width: 48, height: 48, background: primary ? "rgba(255,255,255,0.15)" : "rgba(15,110,86,0.08)" }}>
        {icon}
      </div>
      <div>
        <p className="text-base font-semibold" style={{ color: primary ? "#fff" : "#111827" }}>{title}</p>
        <p className="text-sm mt-0.5" style={{ color: primary ? "rgba(255,255,255,0.7)" : "#6b7280" }}>{subtitle}</p>
      </div>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="ml-auto flex-shrink-0" aria-hidden="true">
        <path d="M6 12l4-4-4-4" stroke={primary ? "rgba(255,255,255,0.6)" : "#d1d5db"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ─── Document Upload Area ─────────────────────────────────────────────────────

function DocUploadArea({ docType }: { docType: DocType }) {
  const isPassport = docType === "passport";
  return (
    <div className="w-full rounded-2xl flex flex-col items-center justify-center gap-3"
      style={{ minHeight: 180, background: "#f9fafb", border: "2px dashed #0f6e56", padding: "20px 16px", opacity: 0.9 }}>
      <svg width={isPassport ? 80 : 120} height={isPassport ? 96 : 66}
        viewBox={isPassport ? "0 0 80 96" : "0 0 120 66"} fill="none" aria-hidden="true">
        {isPassport ? (
          <>
            <rect x="4" y="4" width="72" height="88" rx="8" stroke="#0f6e56" strokeWidth="1.5" strokeDasharray="6 3" opacity="0.45" />
            <circle cx="40" cy="36" r="12" stroke="#0f6e56" strokeWidth="1.2" opacity="0.3" />
            <path d="M14 60h52M14 70h38" stroke="#0f6e56" strokeWidth="1.5" strokeLinecap="round" opacity="0.25" />
          </>
        ) : (
          <>
            <rect x="4" y="4" width="112" height="58" rx="8" stroke="#0f6e56" strokeWidth="1.5" strokeDasharray="6 3" opacity="0.45" />
            <circle cx="28" cy="33" r="10" stroke="#0f6e56" strokeWidth="1.2" opacity="0.3" />
            <path d="M48 22h56M48 33h44M48 44h34" stroke="#0f6e56" strokeWidth="1.4" strokeLinecap="round" opacity="0.25" />
          </>
        )}
      </svg>
      <p className="text-sm font-medium text-center" style={{ color: "#9ca3af" }}>
        Place document in frame
      </p>
      <p className="text-xs text-center" style={{ color: "#c4c4c4" }}>
        All corners visible · No glare · Text readable
      </p>
    </div>
  );
}

// ─── Image Preview ────────────────────────────────────────────────────────────

function ImagePreview({ src, onRetake, captureAttr }: {
  src: string; onRetake: () => void; captureAttr?: "environment" | "user";
}) {
  const retakeRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="relative rounded-2xl overflow-hidden" style={{ background: "#f3f4f6" }}>
        <img src={src} alt="Preview" className="w-full object-cover" style={{ maxHeight: 260, minHeight: 150 }} />
        <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: "rgba(15,110,86,0.88)", color: "#fff" }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M1.5 5.5l2.5 2.5 5.5-6" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Looks good
        </div>
      </div>
      {captureAttr && (
        <>
          <input ref={retakeRef} type="file" accept="image/*" capture={captureAttr} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; e.target.value = ""; }} className="hidden" aria-label="Retake" />
        </>
      )}
    </div>
  );
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="animate-slide-fwd flex flex-col gap-4">
      <Card>
        <div className="flex flex-col items-center gap-6 text-center">
          <ShieldLarge />
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#111827" }}>Verify your identity</h1>
            <p className="mt-1.5 text-sm" style={{ color: "#6b7280" }}>Quick, secure, takes about 2 minutes</p>
          </div>
          {[
            { n: "1", t: "Select your document", d: "Passport, driving licence or national ID" },
            { n: "2", t: "Upload a photo",        d: "Clear photo of the front (and back if needed)" },
            { n: "3", t: "Take a selfie",          d: "Live photo to match your face" },
          ].map((s) => (
            <div key={s.n} className="flex items-start gap-4 text-left w-full">
              <div className="flex items-center justify-center rounded-full font-bold text-sm flex-shrink-0 mt-0.5"
                style={{ width: 30, height: 30, background: "rgba(15,110,86,0.1)", color: "#0f6e56" }}>{s.n}</div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "#111827" }}>{s.t}</p>
                <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>{s.d}</p>
              </div>
            </div>
          ))}
          <InfoNote>Your data is encrypted end-to-end. We never store documents beyond verification.</InfoNote>
          <Divider />
          <Btn onClick={onNext}>
            Get started
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Btn>
        </div>
      </Card>
    </div>
  );
}

// ─── Step 2: Country & Document Selection ────────────────────────────────────

const DOC_ICONS: Record<DocType, React.ComponentType<{ active: boolean }>> = {
  passport:         DocPassportIcon,
  national_id:      DocIdIcon,
  driving_licence:  DocLicenceIcon,
  residence_permit: DocPermitIcon,
};

function DocSelectStep({ country, docType, onCountryChange, onDocTypeChange, onNext, onBack }: {
  country: Country | null; docType: DocType | null;
  onCountryChange: (c: Country) => void; onDocTypeChange: (d: DocType) => void;
  onNext: () => void; onBack: () => void;
}) {
  return (
    <div className="animate-slide-fwd flex flex-col gap-4">
      <BackBtn onClick={onBack} />
      <Card>
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight" style={{ color: "#111827" }}>Select your document</h2>
            <p className="mt-1 text-sm" style={{ color: "#6b7280" }}>Choose the country that issued it</p>
          </div>

          <CountrySelector value={country} onChange={onCountryChange} />

          {country && (
            <>
              <div>
                <p className="text-sm font-semibold mb-3" style={{ color: "#374151" }}>Document type</p>
                <div className="grid grid-cols-2 gap-3">
                  {DOC_TYPES.map(({ value, label }) => {
                    const active = docType === value;
                    const Icon = DOC_ICONS[value];
                    return (
                      <button key={value} type="button" onClick={() => onDocTypeChange(value)}
                        className="flex flex-col items-start gap-3 rounded-2xl p-4 text-left transition-all duration-150 active:scale-[0.97]"
                        style={{ border: `2px solid ${active ? "#0f6e56" : "#e5e7eb"}`, background: active ? "rgba(15,110,86,0.05)" : "#fafafa", minHeight: 100 }}
                        aria-pressed={active}>
                        <Icon active={active} />
                        <div>
                          <p className="text-sm font-semibold leading-tight" style={{ color: active ? "#0f6e56" : "#111827" }}>{label}</p>
                          <span className="inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{ background: "rgba(15,110,86,0.1)", color: "#0f6e56" }}>
                            Supported
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <InfoNote>This document must be valid and not expired.</InfoNote>
            </>
          )}

          {country && docType && (
            <>
              <Divider />
              <Btn onClick={onNext}>
                Continue
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Btn>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Step 3: Upload Method ────────────────────────────────────────────────────

function DocMethodStep({ docTypeName, isFront, onCapture, onBack, token }: {
  docTypeName: string; isFront: boolean; onCapture: (dataUrl: string) => void; onBack: () => void; token: string;
}) {
  const [showQR, setShowQR] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    onCapture(await fileToDataUrl(file)); e.target.value = "";
  };

  if (showQR) return <QRScreen token={token} onBack={() => setShowQR(false)} />;

  const sideLabel = isFront ? "front of your" : "back of your";

  return (
    <div className="animate-slide-fwd flex flex-col gap-3">
      <BackBtn onClick={onBack} />
      <div className="mb-1">
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: "#fff" }}>Upload document</h2>
        <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
          Photo of the {sideLabel} {docTypeName.toLowerCase()}
        </p>
      </div>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" aria-label="Camera" />
      <input ref={libraryRef} type="file" accept="image/*" onChange={handleFile} className="hidden" aria-label="Library" />

      <MethodCard primary onClick={() => cameraRef.current?.click()} icon={<IcnCamera />} title="Take a photo" subtitle="Use your device camera" />
      <MethodCard onClick={() => libraryRef.current?.click()} icon={<IcnGallery />} title="Upload from library" subtitle="Choose an existing photo" />
      <MethodCard onClick={() => setShowQR(true)} icon={<IcnQR />} title="Use another device" subtitle="Scan QR code on your phone" />
    </div>
  );
}

// ─── Step 4/5: Document Preview (front & back) ───────────────────────────────

function DocumentPreviewStep({ title, subtitle, docType, image, quality, onRetake, onContinue, continueLabel = "Continue" }: {
  title: string; subtitle: string; docType: DocType; image: string | null;
  quality: string | null; onRetake: () => void; onContinue: () => void; continueLabel?: string;
}) {
  return (
    <div className="animate-slide-fwd flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-xl font-bold" style={{ color: "#111827" }}>{title}</h2>
            <p className="mt-1 text-sm" style={{ color: "#6b7280" }}>{subtitle}</p>
          </div>

          {image ? (
            <>
              {quality && <QualityWarn msg={quality} />}
              <ImagePreview src={image} onRetake={onRetake} captureAttr="environment" />
            </>
          ) : (
            <DocUploadArea docType={docType} />
          )}

          <Divider />
          <div className="flex flex-col gap-3">
            <Btn onClick={onContinue} disabled={!image}>{continueLabel}</Btn>
            {image && <Btn variant="ghost" onClick={onRetake}>Retake photo</Btn>}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Step 6: Selfie ───────────────────────────────────────────────────────────

function SelfieStep({ image, onCapture, onClear, onSubmit, onBack, submitting, token }: {
  image: string | null; onCapture: (d: string) => void; onClear: () => void;
  onSubmit: () => void; onBack: () => void; submitting: boolean; token: string;
}) {
  const [mode, setMode] = useState<SelfieMode>(image ? "preview" : "method");
  const [showQR, setShowQR] = useState(false);
  const [quality, setQuality] = useState<string | null>(null);
  const [camKey, setCamKey] = useState(0);
  const libraryRef = useRef<HTMLInputElement>(null);

  const handleCapture = async (dataUrl: string) => {
    const warn = await checkQuality(dataUrl);
    setQuality(warn);
    onCapture(dataUrl);
    setMode("preview");
  };

  const handleLibFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    await handleCapture(await fileToDataUrl(f)); e.target.value = "";
  };

  const retake = () => { setMode("method"); setQuality(null); onClear(); setCamKey((k) => k + 1); };

  if (showQR) return <QRScreen token={token} onBack={() => setShowQR(false)} />;

  if (mode === "camera") {
    return (
      <div className="animate-slide-fwd flex flex-col gap-4">
        <BackBtn onClick={() => setMode("method")} />
        <Card noPad>
          <LiveCameraView key={camKey} onCapture={handleCapture} />
        </Card>
        <InfoNote>Face directly at camera · Good lighting · No glasses</InfoNote>
      </div>
    );
  }

  if (mode === "preview" && image) {
    return (
      <div className="animate-slide-fwd flex flex-col gap-4">
        <BackBtn onClick={onBack} />
        <Card>
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-bold" style={{ color: "#111827" }}>Selfie captured</h2>
              <p className="mt-1 text-sm" style={{ color: "#6b7280" }}>Ready to submit your verification</p>
            </div>
            {quality && <QualityWarn msg={quality} />}
            <ImagePreview src={image} onRetake={retake} captureAttr="user" />
            <Divider />
            <div className="flex flex-col gap-3">
              <Btn onClick={onSubmit} loading={submitting}>{!submitting && "Submit verification"}</Btn>
              <Btn variant="ghost" onClick={retake}>Retake selfie</Btn>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // method select
  return (
    <div className="animate-slide-fwd flex flex-col gap-3">
      <BackBtn onClick={onBack} />
      <div className="mb-1">
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: "#fff" }}>Take a selfie</h2>
        <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>Look directly at the camera</p>
      </div>
      <input ref={libraryRef} type="file" accept="image/*" onChange={handleLibFile} className="hidden" aria-label="Library" />
      <MethodCard primary onClick={() => setMode("camera")} icon={<IcnCamera />} title="Take a selfie" subtitle="Use your front camera" />
      <MethodCard onClick={() => libraryRef.current?.click()} icon={<IcnGallery />} title="Upload from library" subtitle="Choose an existing photo" />
      <MethodCard onClick={() => setShowQR(true)} icon={<IcnQR />} title="Use another device" subtitle="Scan QR code on your phone" />
    </div>
  );
}

// ─── Step 7: Processing & Result ─────────────────────────────────────────────

function ProcessingStep({ currentStep, result }: { currentStep: number; result: VerificationResult | null }) {
  if (result) {
    return (
      <div className="animate-scale-in">
        <Card>
          <div className="flex flex-col items-center gap-5 py-4 text-center">
            {result.success ? (
              <>
                <AnimatedCheck />
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: "#111827" }}>Verification submitted</h2>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: "#6b7280" }}>
                    You can close this window.<br />We&apos;ll notify the business once confirmed.
                  </p>
                </div>
                <InfoNote>Processing typically takes under 60 seconds.</InfoNote>
              </>
            ) : (
              <>
                <AnimatedError />
                <div>
                  <h2 className="text-2xl font-bold" style={{ color: "#111827" }}>Verification failed</h2>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: "#6b7280" }}>{result.error ?? "Something went wrong."}</p>
                </div>
                <Btn onClick={() => window.location.reload()}>Try again</Btn>
              </>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-3 pt-2 pb-1 text-center">
          <svg className="animate-spin" width="44" height="44" viewBox="0 0 44 44" fill="none" aria-label="Processing">
            <circle cx="22" cy="22" r="18" stroke="#e5e7eb" strokeWidth="4" />
            <path d="M22 4a18 18 0 0 1 18 18" stroke="#0f6e56" strokeWidth="4" strokeLinecap="round" />
          </svg>
          <h2 className="text-lg font-bold" style={{ color: "#111827" }}>Processing your verification</h2>
          <p className="text-sm" style={{ color: "#6b7280" }}>Please keep this window open</p>
        </div>
        <div className="flex flex-col gap-1">
          {PROC_STEPS.map((label, i) => {
            const done = i < currentStep, active = i === currentStep;
            return (
              <div key={label} className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-400"
                style={{ background: active ? "rgba(15,110,86,0.06)" : "transparent", opacity: i > currentStep ? 0.3 : 1 }}>
                <div className="flex items-center justify-center rounded-full flex-shrink-0 transition-all duration-300"
                  style={{ width: 28, height: 28, background: done ? "#0f6e56" : active ? "rgba(15,110,86,0.12)" : "#f3f4f6" }}>
                  {done
                    ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 7l2.5 2.5 5.5-5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    : active
                      ? <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: "#0f6e56" }} />
                      : <div className="w-2 h-2 rounded-full" style={{ background: "#d1d5db" }} />}
                </div>
                <span className="text-sm font-medium" style={{ color: done || active ? "#111827" : "#9ca3af" }}>{label}</span>
                {done && <span className="ml-auto text-xs font-semibold" style={{ color: "#0f6e56" }}>Done</span>}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function VerificationFlow({ token }: { token: string }) {
  const [flowStep, setFlowStep] = useState<FlowStep>("welcome");
  const [dir, setDir] = useState<Direction>("forward");
  const [country, setCountry] = useState<Country | null>(null);
  const [docType, setDocType] = useState<DocType | null>(null);
  const [docFront, setDocFront] = useState<string | null>(null);
  const [docFrontQ, setDocFrontQ] = useState<string | null>(null);
  const [docBack, setDocBack] = useState<string | null>(null);
  const [docBackQ, setDocBackQ] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [procStep, setProcStep] = useState(0);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const go = (to: FlowStep, d: Direction = "forward") => { setDir(d); setFlowStep(to); };

  const needsBack = docType === "driving_licence" || docType === "national_id";
  const docLabel = DOC_TYPES.find((d) => d.value === docType)?.label ?? "document";

  const captureDocFront = async (dataUrl: string) => {
    setDocFront(dataUrl);
    setDocFrontQ(await checkQuality(dataUrl));
    go("doc-front");
  };

  const captureDocBack = async (dataUrl: string) => {
    setDocBack(dataUrl);
    setDocBackQ(await checkQuality(dataUrl));
    go("doc-back");
  };

  const handleSubmit = async () => {
    if (!docFront || !selfie || !docType || submitting) return;
    setSubmitting(true);
    go("processing");
    setProcStep(0);

    await delay(850); setProcStep(1);
    await delay(1050); setProcStep(2);

    const [res] = await Promise.all([
      submitVerification(token, {
        document_front: stripPrefix(docFront),
        ...(docBack ? { document_back: stripPrefix(docBack) } : {}),
        selfie: stripPrefix(selfie),
        document_type: docType,
      }),
      delay(950),
    ]);

    setProcStep(3);
    await delay(800);
    setProcStep(4);
    await delay(400);
    setResult(res);
    setSubmitting(false);
  };

  const progressStep = (): 1 | 2 | 3 | 4 => {
    if (flowStep === "doc-select") return 1;
    if (["doc-method", "doc-front", "doc-back"].includes(flowStep)) return 2;
    if (flowStep === "selfie") return 3;
    return 4;
  };

  const anim = dir === "forward" ? "animate-slide-fwd" : "animate-slide-bwd";

  const renderStep = () => {
    switch (flowStep) {
      case "welcome":
        return <WelcomeStep onNext={() => go("doc-select")} />;

      case "doc-select":
        return (
          <DocSelectStep
            country={country} docType={docType}
            onCountryChange={(c) => { setCountry(c); setDocType(null); setDocFront(null); setDocBack(null); }}
            onDocTypeChange={(d) => { setDocType(d); setDocFront(null); setDocBack(null); }}
            onNext={() => go("doc-method")}
            onBack={() => go("welcome", "backward")}
          />
        );

      case "doc-method":
        return (
          <DocMethodStep
            docTypeName={docLabel} isFront={true}
            onCapture={captureDocFront}
            onBack={() => go("doc-select", "backward")}
            token={token}
          />
        );

      case "doc-front":
        return (
          <DocumentPreviewStep
            title={`Front of your ${docLabel.toLowerCase()}`}
            subtitle="Check the photo is clear and all corners are visible"
            docType={docType ?? "passport"}
            image={docFront} quality={docFrontQ}
            onRetake={() => { setDocFront(null); setDocFrontQ(null); go("doc-method", "backward"); }}
            onContinue={() => go(needsBack ? "doc-back" : "selfie")}
            continueLabel={needsBack ? "Continue to back" : "Continue to selfie"}
          />
        );

      case "doc-back":
        return docBack ? (
          <DocumentPreviewStep
            title={`Back of your ${docLabel.toLowerCase()}`}
            subtitle="Ensure the back is clear and all corners visible"
            docType={docType ?? "national_id"}
            image={docBack} quality={docBackQ}
            onRetake={() => { setDocBack(null); setDocBackQ(null); }}
            onContinue={() => go("selfie")}
          />
        ) : (
          <div className={anim}>
            <DocMethodStep
              docTypeName={docLabel} isFront={false}
              onCapture={captureDocBack}
              onBack={() => go("doc-front", "backward")}
              token={token}
            />
          </div>
        );

      case "selfie":
        return (
          <SelfieStep
            image={selfie}
            onCapture={setSelfie}
            onClear={() => setSelfie(null)}
            onSubmit={handleSubmit}
            onBack={() => go(needsBack ? "doc-back" : "doc-front", "backward")}
            submitting={submitting}
            token={token}
          />
        );

      case "processing":
        return <ProcessingStep currentStep={procStep} result={result} />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center" style={{ background: "#050a09" }}>
      <div className="w-full max-w-[480px] flex flex-col px-4 pt-6 pb-12">
        <div className="flex items-center gap-2.5 mb-7">
          <ShieldMark />
          <span className="text-sm font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.45)" }}>Veridian</span>
        </div>

        {flowStep !== "welcome" && flowStep !== "processing" && (
          <ProgressBar step={progressStep()} />
        )}
        {flowStep === "processing" && (
          <ProgressBar step={4} />
        )}

        <div key={flowStep} className={anim}>
          {renderStep()}
        </div>

        <p className="text-center text-xs mt-10" style={{ color: "rgba(255,255,255,0.08)" }}>
          Secured by Veridian · End-to-end encrypted
        </p>
      </div>
    </div>
  );
}
