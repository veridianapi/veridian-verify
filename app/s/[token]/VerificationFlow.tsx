"use client";

import { useState, useRef, useEffect } from "react";
import { submitVerification, type VerificationResult } from "./actions";

// ─── Design tokens (matching screens.jsx) ────────────────────────────────────
const TEAL       = "#0f6e56";
const TEAL_DEEP  = "#0a4d3c";
const TEAL_SOFT  = "rgba(15,110,86,0.10)";
const TEAL_TINT  = "#e8f3ef";
const TEAL_GLOW  = "rgba(15,110,86,0.35)";
const INK        = "#0f1615";
const INK_2      = "#4a5553";
const INK_3      = "#8a938f";
const LINE       = "rgba(15,22,21,0.08)";
const PAPER      = "#faf8f3";
const PAPER_SHADE = "#f1ede3";
const CORAL      = "#d97757";

const SERIF = 'var(--font-serif,"Instrument Serif","Playfair Display",Georgia,serif)';
const MONO  = 'var(--font-mono,"JetBrains Mono","SF Mono",ui-monospace,monospace)';

// ─── Types ───────────────────────────────────────────────────────────────────
type FlowStep = "doc-select" | "doc-method" | "doc-front" | "doc-back" | "selfie" | "processing";
type Direction = "forward" | "backward";
type DocType   = "passport" | "national_id" | "driving_licence" | "residence_permit";

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

const DOC_TYPES: { value: DocType; label: string; meta: string; hasBack: boolean }[] = [
  { value: "passport",         label: "Passport",         meta: "Fastest · photo page only", hasBack: false },
  { value: "driving_licence",  label: "Driving licence",  meta: "Front and back",             hasBack: true  },
  { value: "national_id",      label: "National ID",      meta: "Front and back",             hasBack: true  },
  { value: "residence_permit", label: "Residence permit", meta: "Front only",                 hasBack: false },
];

// ─── Utilities ───────────────────────────────────────────────────────────────
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
        resolve(sum / (d.length / 4) < 45 ? "Image appears too dark — try in better lighting." : null);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ─── Brand mark ──────────────────────────────────────────────────────────────
function VeridianMark({ size = 20, color = TEAL }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={Math.round(size * 1.1)} viewBox="0 0 28 31" fill="none" aria-hidden="true">
      <path d="M14 1 L26 5 V15 C26 22.5 20.7 27.7 14 30 C7.3 27.7 2 22.5 2 15 V5 L14 1 Z" fill={color} />
      <path d="M8 12 L14 22 L20 12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// ─── TopBar ──────────────────────────────────────────────────────────────────
function TopBar({ onBack, dark = false }: { onBack?: () => void; dark?: boolean }) {
  const btnBg = dark ? "rgba(255,255,255,0.12)" : "rgba(15,22,21,0.04)";
  const stroke = dark ? "#fff" : INK;
  const textColor = dark ? "#fff" : INK;
  return (
    <div style={{ padding: "8px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Go back" style={{
          all: "unset", cursor: "pointer",
          width: 40, height: 40, borderRadius: 999,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: btnBg,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8 2L3 7L8 12" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : <div style={{ width: 40 }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <VeridianMark size={18} color={dark ? "#fff" : TEAL} />
        <span style={{ fontWeight: 600, fontSize: 14, color: textColor, letterSpacing: -0.1 }}>Veridian</span>
      </div>
      <div style={{ width: 40 }} />
    </div>
  );
}

// ─── Progress Rail ────────────────────────────────────────────────────────────
const RAIL_LABELS = ["Document", "Capture", "Selfie", "Review"];

function ProgressRail({ step }: { step: 0 | 1 | 2 | 3 }) {
  return (
    <div style={{ padding: "0 20px 4px" }}>
      <div style={{ display: "flex", gap: 6 }}>
        {RAIL_LABELS.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= step ? TEAL : "rgba(15,22,21,0.08)",
          }} />
        ))}
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 10,
        fontFamily: MONO, fontSize: 9, letterSpacing: 0.6,
        textTransform: "uppercase",
      }}>
        {RAIL_LABELS.map((l, i) => (
          <span key={i} style={{
            color: i === step ? TEAL : i < step ? INK_2 : INK_3,
            fontWeight: i === step ? 600 : 400,
          }}>{l}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Document type icons ─────────────────────────────────────────────────────
function DocIcon({ kind }: { kind: DocType }) {
  const sw = 1.7;
  if (kind === "passport") return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <rect x="5" y="2" width="14" height="20" rx="1.5" stroke={TEAL_DEEP} strokeWidth={sw} />
      <circle cx="12" cy="10" r="3" stroke={TEAL_DEEP} strokeWidth={sw} />
      <line x1="8" y1="16" x2="16" y2="16" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinecap="round" />
      <line x1="9" y1="19" x2="15" y2="19" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinecap="round" />
    </svg>
  );
  if (kind === "driving_licence") return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="5" width="20" height="14" rx="2" stroke={TEAL_DEEP} strokeWidth={sw} />
      <circle cx="7" cy="11" r="2" stroke={TEAL_DEEP} strokeWidth={sw} />
      <line x1="11" y1="10" x2="19" y2="10" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinecap="round" />
      <line x1="11" y1="13" x2="17" y2="13" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinecap="round" />
      <line x1="5" y1="16" x2="19" y2="16" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinecap="round" />
    </svg>
  );
  if (kind === "national_id") return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="4" width="20" height="16" rx="2" stroke={TEAL_DEEP} strokeWidth={sw} />
      <rect x="5" y="8" width="5" height="5" rx="0.6" stroke={TEAL_DEEP} strokeWidth={sw} />
      <line x1="12" y1="9" x2="19" y2="9" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinecap="round" />
      <line x1="12" y1="12" x2="17" y2="12" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinecap="round" />
      <line x1="5" y1="17" x2="19" y2="17" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinecap="round" />
    </svg>
  );
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <path d="M4 3H15L20 8V21H4Z" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M15 3V8H20" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinejoin="round" />
      <line x1="7" y1="13" x2="17" y2="13" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinecap="round" />
      <line x1="7" y1="16" x2="17" y2="16" stroke={TEAL_DEEP} strokeWidth={sw} strokeLinecap="round" />
    </svg>
  );
}

// ─── Country selector (bottom-border style) ──────────────────────────────────
function CountryPicker({ value, onChange }: { value: Country | null; onChange: (c: Country) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = q ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : COUNTRIES;
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: INK_3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
        Issuing country
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{
        all: "unset", cursor: "pointer", boxSizing: "border-box",
        width: "100%", padding: "10px 0",
        display: "flex", alignItems: "center", gap: 12,
        borderBottom: `1px solid ${open ? TEAL : INK}`,
      }}>
        {value ? (
          <span style={{ fontSize: 22, lineHeight: 1 }}>{value.flag}</span>
        ) : null}
        <span style={{ fontSize: 16, fontWeight: 500, color: value ? INK : INK_3, flex: 1 }}>
          {value ? value.name : "Select your country"}
        </span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 5L7 9L11 5" stroke={INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{ marginTop: 8, borderRadius: 16, overflow: "hidden", border: `1px solid ${LINE}`, background: "#fff", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}>
          <div style={{ padding: 12, borderBottom: `1px solid ${LINE}` }}>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search countries…"
              style={{ width: "100%", outline: "none", border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 12px", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", background: PAPER }} />
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {filtered.length === 0 && <p style={{ textAlign: "center", padding: "16px 0", fontSize: 13, color: INK_3 }}>No results</p>}
            {filtered.map((c) => (
              <button key={c.code} type="button"
                onClick={() => { onChange(c); setOpen(false); setQ(""); }}
                style={{
                  all: "unset", cursor: "pointer", boxSizing: "border-box",
                  width: "100%", padding: "12px 16px",
                  display: "flex", alignItems: "center", gap: 12,
                  background: value?.code === c.code ? TEAL_SOFT : "transparent",
                }}>
                <span style={{ fontSize: 20 }}>{c.flag}</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: INK, flex: 1 }}>{c.name}</span>
                {value?.code === c.code && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7l3.5 3.5L12 3" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

// ─── Doc Row (vertical list style) ───────────────────────────────────────────
function DocRow({ kind, label, meta, badge, selected, onClick }: {
  kind: DocType; label: string; meta: string; badge?: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={{
      all: "unset", cursor: "pointer", boxSizing: "border-box",
      width: "100%", padding: "16px 0",
      display: "flex", alignItems: "center", gap: 14,
      borderBottom: `1px solid ${LINE}`,
      background: selected ? TEAL_SOFT : "transparent",
      borderRadius: selected ? 12 : 0,
      paddingLeft: selected ? 8 : 0,
      paddingRight: selected ? 8 : 0,
      transition: "all 0.15s ease",
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: selected ? TEAL_TINT : TEAL_TINT,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        border: selected ? `1.5px solid ${TEAL}` : "1.5px solid transparent",
      }}>
        <DocIcon kind={kind} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 500, color: INK, letterSpacing: -0.2 }}>{label}</span>
          {badge && (
            <span style={{
              fontFamily: MONO, fontSize: 9, fontWeight: 500,
              color: TEAL, background: TEAL_SOFT,
              padding: "2px 6px", borderRadius: 4, letterSpacing: 0.4,
              textTransform: "uppercase",
            }}>{badge}</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: INK_3, marginTop: 2 }}>{meta}</div>
      </div>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
        <path d="M4 2L8 6L4 10" stroke={selected ? TEAL : INK_3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ─── Primary action button (dark pill) ───────────────────────────────────────
function PrimaryBtn({ onClick, disabled, loading, children }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean; children?: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || loading} style={{
      all: "unset", cursor: disabled || loading ? "not-allowed" : "pointer",
      boxSizing: "border-box", width: "100%", height: 54, borderRadius: 999,
      background: disabled ? "rgba(15,22,21,0.12)" : INK,
      color: disabled ? INK_3 : "#fff",
      fontWeight: 600, fontSize: 15, letterSpacing: -0.1,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      boxShadow: disabled ? "none" : "0 8px 20px rgba(15,22,21,0.16)",
      transition: "opacity 0.15s",
      opacity: loading ? 0.7 : 1,
    }}>
      {loading ? (
        <svg style={{ animation: "spin 1s linear infinite" }} width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" />
          <path d="M10 2a8 8 0 0 1 8 8" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : (
        <>
          {children}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7H12M12 7L8 3M12 7L8 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </>
      )}
    </button>
  );
}

function GhostBtn({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{
      all: "unset", cursor: "pointer",
      boxSizing: "border-box", width: "100%", height: 48, borderRadius: 999,
      border: `1px solid ${INK}`,
      color: INK,
      fontWeight: 500, fontSize: 14,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {children}
    </button>
  );
}

// ─── Method Row (pill-shaped, Persona style) ──────────────────────────────────
function MethodRow({ kind, label, sub, primary, onClick }: {
  kind: "camera" | "library" | "qr"; label: string; sub: string; primary?: boolean; onClick: () => void;
}) {
  const iconStroke = primary ? "#fff" : TEAL_DEEP;
  return (
    <button type="button" onClick={onClick} style={{
      all: "unset", cursor: "pointer", boxSizing: "border-box",
      width: "100%", padding: "14px 18px",
      display: "flex", alignItems: "center", gap: 14,
      background: primary ? INK : PAPER,
      borderRadius: 999,
      border: primary ? "none" : `1px solid ${INK}`,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 999,
        background: primary ? "rgba(255,255,255,0.10)" : TEAL_TINT,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        {kind === "camera" && (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 5H5L6 3.5H10L11 5H14V13H2Z" stroke={iconStroke} strokeWidth="1.4" strokeLinejoin="round" fill="none" />
            <circle cx="8" cy="9" r="2.5" stroke={iconStroke} strokeWidth="1.4" />
          </svg>
        )}
        {kind === "library" && (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="10" rx="1.5" stroke={iconStroke} strokeWidth="1.4" />
            <circle cx="6" cy="7" r="1.2" stroke={iconStroke} strokeWidth="1.4" />
            <path d="M2 11L6 8L10 11L12 9L14 11" stroke={iconStroke} strokeWidth="1.4" strokeLinejoin="round" fill="none" />
          </svg>
        )}
        {kind === "qr" && (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="5" height="5" rx="0.5" stroke={iconStroke} strokeWidth="1.4" />
            <rect x="9" y="2" width="5" height="5" rx="0.5" stroke={iconStroke} strokeWidth="1.4" />
            <rect x="2" y="9" width="5" height="5" rx="0.5" stroke={iconStroke} strokeWidth="1.4" />
            <rect x="11" y="11" width="3" height="3" fill={iconStroke} />
          </svg>
        )}
      </div>
      <div style={{ flex: 1, textAlign: "left" }}>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.1, color: primary ? "#fff" : INK }}>{label}</div>
        <div style={{ fontSize: 12, opacity: 0.65, marginTop: 1, color: primary ? "#fff" : INK }}>{sub}</div>
      </div>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M4 2L8 6L4 10" stroke={primary ? "rgba(255,255,255,0.5)" : INK_3} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ─── Document illustration (scanning frame + passport card) ──────────────────
function DocIllustration({ docType }: { docType: DocType }) {
  const isPassport = docType === "passport";
  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center", position: "relative" }}>
      {isPassport ? (
        <svg width="180" height="130" viewBox="0 0 180 130" fill="none">
          {/* Scanning frame corners */}
          {["M0 14 V0 H14", "M166 0 H180 V14", "M180 116 V130 H166", "M14 130 H0 V116"].map((d, i) => (
            <path key={i} d={d} stroke={TEAL} strokeWidth="2" strokeLinecap="round" fill="none" />
          ))}
          {/* Passport booklet */}
          <rect x="22" y="18" width="136" height="94" rx="6" fill={PAPER} stroke={INK} strokeWidth="1.5" />
          <rect x="38" y="30" width="42" height="56" rx="3" fill={CORAL} />
          <circle cx="59" cy="49" r="9" fill={PAPER} fillOpacity="0.5" stroke={PAPER} strokeWidth="1.5" />
          <path d="M46 62 Q59 54 72 62" fill={PAPER} fillOpacity="0.5" />
          <line x1="90" y1="38" x2="144" y2="38" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
          <line x1="90" y1="48" x2="130" y2="48" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
          <line x1="38" y1="74" x2="144" y2="74" stroke={TEAL} strokeWidth="1.2" strokeLinecap="round" />
          <line x1="38" y1="80" x2="144" y2="80" stroke={TEAL} strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="220" height="130" viewBox="0 0 220 130" fill="none">
          {/* Scanning frame corners */}
          {["M0 14 V0 H14", "M206 0 H220 V14", "M220 116 V130 H206", "M14 130 H0 V116"].map((d, i) => (
            <path key={i} d={d} stroke={TEAL} strokeWidth="2" strokeLinecap="round" fill="none" />
          ))}
          {/* ID card */}
          <rect x="18" y="22" width="184" height="86" rx="8" fill={PAPER} stroke={INK} strokeWidth="1.5" />
          <rect x="34" y="36" width="34" height="42" rx="3" fill={CORAL} />
          <circle cx="51" cy="49" r="7" fill={PAPER} fillOpacity="0.5" stroke={PAPER} strokeWidth="1.5" />
          <path d="M40 68 Q51 62 62 68" fill={PAPER} fillOpacity="0.5" />
          <line x1="80" y1="40" x2="180" y2="40" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
          <line x1="80" y1="50" x2="155" y2="50" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
          <line x1="80" y1="62" x2="164" y2="62" stroke={TEAL} strokeWidth="1.2" strokeLinecap="round" />
          <line x1="80" y1="70" x2="144" y2="70" stroke={TEAL} strokeWidth="1.2" strokeLinecap="round" />
          <line x1="34" y1="90" x2="186" y2="90" stroke={LINE} strokeWidth="1" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}

// ─── Fake QR Code ─────────────────────────────────────────────────────────────
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
        <rect key={`${x}-${y}`} x={x * c} y={y * c} width={c - 0.4} height={c - 0.4} fill={INK} />
      ))}
    </svg>
  );
}

// ─── QR Device Screen ─────────────────────────────────────────────────────────
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
    <div style={{ padding: "28px 24px 0" }}>
      <button type="button" onClick={onBack} style={{
        all: "unset", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 6,
        color: INK_2, fontSize: 14, fontWeight: 500, marginBottom: 24,
      }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M8 2L3 7L8 12" stroke={INK_2} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </button>
      <h2 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, color: INK, letterSpacing: -0.4, margin: 0 }}>
        Continue on<br /><span style={{ fontStyle: "italic", color: TEAL_DEEP }}>another device.</span>
      </h2>
      <p style={{ marginTop: 12, fontSize: 14, color: INK_2, lineHeight: 1.5 }}>
        Scan this code with your phone camera to open verification there.
      </p>
      <div style={{
        marginTop: 24, padding: 20, borderRadius: 20,
        background: PAPER_SHADE, display: "flex", justifyContent: "center",
      }}>
        <div style={{ padding: 16, background: "#fff", borderRadius: 12 }}>
          <FakeQRCode size={160} />
        </div>
      </div>
      <div style={{
        marginTop: 16, padding: "10px 14px", borderRadius: 12, background: PAPER_SHADE,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: INK_3, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</span>
      </div>
      <div style={{ marginTop: 12 }}>
        <PrimaryBtn onClick={copy}>{copied ? "Copied!" : "Copy link"}</PrimaryBtn>
      </div>
    </div>
  );
}

// ─── Live Camera (circular frame) ────────────────────────────────────────────
function CircularCamera({ onCapture }: { onCapture: (dataUrl: string) => void }) {
  const [state, setState] = useState<"starting" | "live" | "denied">("starting");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);

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
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCapture(cv.toDataURL("image/jpeg", 0.88));
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    onCapture(await fileToDataUrl(file)); e.target.value = "";
  };

  const total = 60;

  if (state === "denied") {
    return (
      <div style={{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 20, textAlign: "center" }}>
        <div style={{
          width: 64, height: 64, borderRadius: 999,
          background: "#fef3c7",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M3 5l22 22M11 6h10a2 2 0 0 1 2 2v8M6 8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h13" stroke="#d97706" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <p style={{ fontWeight: 600, fontSize: 16, color: INK }}>Camera unavailable</p>
          <p style={{ fontSize: 13, color: INK_2, marginTop: 4 }}>Upload a photo instead</p>
        </div>
        <input ref={fallbackRef} type="file" accept="image/*" capture="user" onChange={handleFile} style={{ display: "none" }} />
        <input ref={libRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
          <PrimaryBtn onClick={() => fallbackRef.current?.click()}>Take photo</PrimaryBtn>
          <GhostBtn onClick={() => libRef.current?.click()}>Choose from library</GhostBtn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", flex: 1, minHeight: 520,
      background: "radial-gradient(ellipse at 50% 35%, #2b3734 0%, #0d1413 70%, #050a09 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28,
      paddingBottom: 60,
    }}>
      {/* Faint scan lines texture */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.08,
        background: "repeating-linear-gradient(180deg, transparent 0 20px, rgba(255,255,255,0.05) 20px 21px)",
      }} />

      {/* Circular frame with rotating tick marks */}
      <div style={{ position: "relative", width: 260, height: 260 }}>
        {/* Rotating tick marks SVG */}
        {state === "live" && (
          <svg width="300" height="300" viewBox="0 0 300 300" style={{
            position: "absolute", top: -20, left: -20,
            animation: "veridian-rotate 24s linear infinite",
          }}>
            {Array.from({ length: total }).map((_, i) => {
              const angle = (i / total) * Math.PI * 2;
              const done = i < 20;
              const r1 = 140, r2 = done ? 150 : 146;
              const x1 = 150 + Math.cos(angle) * r1;
              const y1 = 150 + Math.sin(angle) * r1;
              const x2 = 150 + Math.cos(angle) * r2;
              const y2 = 150 + Math.sin(angle) * r2;
              return (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={done ? TEAL : "rgba(255,255,255,0.25)"}
                  strokeWidth={done ? 2 : 1.3}
                  strokeLinecap="round" />
              );
            })}
          </svg>
        )}

        {/* Inner circular video */}
        <div style={{
          position: "absolute", inset: 12,
          borderRadius: "50%", overflow: "hidden",
          background: "radial-gradient(circle at 50% 40%, #3d4a47 0%, #1a2322 80%)",
          boxShadow: "inset 0 0 60px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {state === "live" ? (
            <video ref={videoRef} autoPlay muted playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
              aria-label="Camera preview" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <svg style={{ animation: "spin 1s linear infinite" }} width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="12" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
                <path d="M16 4a12 12 0 0 1 12 12" stroke={TEAL} strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
          )}

          {/* Face guide outline */}
          {state === "live" && (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
              viewBox="0 0 236 236" preserveAspectRatio="xMidYMid slice">
              <ellipse cx="118" cy="115" rx="72" ry="88" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" fill="none" />
              <circle cx="102" cy="100" r="3" fill="rgba(255,255,255,0.5)" />
              <circle cx="134" cy="100" r="3" fill="rgba(255,255,255,0.5)" />
              <path d="M104 140 Q118 150 132 140" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" strokeLinecap="round" fill="none" />
            </svg>
          )}

          {/* Scan line */}
          {state === "live" && (
            <div style={{
              position: "absolute", left: 0, right: 0,
              height: 2,
              background: `linear-gradient(90deg, transparent, ${TEAL}, transparent)`,
              boxShadow: `0 0 10px ${TEAL}`,
              animation: "veridian-scan 3s ease-in-out infinite",
            }} />
          )}
        </div>
      </div>

      {/* Instruction card */}
      <div style={{
        padding: "12px 18px", borderRadius: 16,
        background: "rgba(15,22,21,0.55)", backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.08)",
        maxWidth: 280, textAlign: "center",
      }}>
        <div style={{ fontFamily: SERIF, fontSize: 20, color: "#fff", letterSpacing: -0.3, lineHeight: 1.2 }}>
          Look straight<br />
          <span style={{ fontStyle: "italic", color: "#9de5cf" }}>at the camera.</span>
        </div>
        <div style={{
          marginTop: 6, fontFamily: MONO, fontSize: 10,
          color: "rgba(255,255,255,0.55)", letterSpacing: 0.6, textTransform: "uppercase",
        }}>Good light · No glasses · Neutral expression</div>
      </div>

      {/* Capture button */}
      {state === "live" && (
        <button type="button" onClick={capture} aria-label="Capture selfie" style={{
          all: "unset", cursor: "pointer",
          width: 76, height: 76, borderRadius: 999,
          background: "rgba(255,255,255,0.10)",
          border: "3px solid rgba(255,255,255,0.9)",
          padding: 5, boxSizing: "border-box",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: "100%", height: "100%", borderRadius: 999,
            background: TEAL,
            boxShadow: `0 0 20px ${TEAL_GLOW}`,
          }} />
        </button>
      )}

      <canvas ref={canvasRef} style={{ display: "none" }} aria-hidden="true" />
    </div>
  );
}

// ─── Image preview card ───────────────────────────────────────────────────────
function PreviewCard({ src, quality, onRetake }: { src: string; quality: string | null; onRetake: () => void }) {
  return (
    <>
      {quality && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "12px 16px", borderRadius: 14,
          background: "#fffbeb", border: "1px solid #fde68a",
          marginBottom: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginTop: 1, flexShrink: 0 }}>
            <path d="M8 2L1 14h14L8 2z" stroke="#d97706" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M8 7v3M8 11.5v.5" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <p style={{ fontSize: 12, color: "#78350f", lineHeight: 1.5 }}>{quality}</p>
        </div>
      )}
      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", background: PAPER_SHADE }}>
        <img src={src} alt="Preview" style={{ width: "100%", objectFit: "cover", maxHeight: 280, minHeight: 160, display: "block" }} />
        <div style={{
          position: "absolute", top: 12, right: 12,
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 10px", borderRadius: 999,
          background: "rgba(15,110,86,0.88)", color: "#fff",
          fontSize: 11, fontWeight: 600,
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5l2 2 5-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Captured
        </div>
      </div>
    </>
  );
}

// ─── Checklist row (processing screen) ───────────────────────────────────────
function ChecklistRow({ state, label, meta }: {
  state: "done" | "active" | "pending"; label: string; meta?: string;
}) {
  const leading = state === "done" ? (
    <div style={{
      width: 24, height: 24, borderRadius: 999, background: TEAL,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  ) : state === "active" ? (
    <div style={{ width: 24, height: 24, flexShrink: 0 }}>
      <svg viewBox="0 0 24 24" style={{ width: 24, height: 24, animation: "spin 1.1s linear infinite" }}>
        <circle cx="12" cy="12" r="10" stroke={TEAL_SOFT} strokeWidth="2.5" fill="none" />
        <circle cx="12" cy="12" r="10" stroke={TEAL} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeDasharray="14 80" />
      </svg>
    </div>
  ) : (
    <div style={{
      width: 24, height: 24, borderRadius: 999,
      border: `1.5px solid ${LINE}`, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <circle cx="5" cy="5" r="4" stroke={INK_3} strokeWidth="1" fill="none" opacity="0.4" />
        <line x1="5" y1="5" x2="5" y2="2.5" stroke={INK_3} strokeWidth="1" strokeLinecap="round" />
        <line x1="5" y1="5" x2="6.8" y2="5" stroke={INK_3} strokeWidth="1" strokeLinecap="round" />
      </svg>
    </div>
  );

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "14px 0", borderBottom: `1px solid ${LINE}`,
    }}>
      {leading}
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 14, fontWeight: state === "active" ? 600 : 500,
          color: state === "pending" ? INK_3 : INK, letterSpacing: -0.1,
        }}>{label}</div>
        {meta && <div style={{ fontFamily: MONO, fontSize: 10, color: INK_3, marginTop: 2, letterSpacing: 0.3 }}>{meta}</div>}
      </div>
      {state === "done" && (
        <span style={{ fontFamily: MONO, fontSize: 10, color: TEAL, letterSpacing: 0.6, textTransform: "uppercase" }}>Done</span>
      )}
      {state === "active" && (
        <span style={{ fontFamily: MONO, fontSize: 10, color: TEAL, letterSpacing: 0.6, textTransform: "uppercase" }}>Running</span>
      )}
    </div>
  );
}

// ─── Hourglass (processing illustration) ─────────────────────────────────────
function HourglassMark() {
  return (
    <div style={{
      width: 84, height: 84, borderRadius: 999, background: INK,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <svg width="36" height="44" viewBox="0 0 36 44" fill="none" style={{ animation: "veridian-hourglass 2.4s ease-in-out infinite" }}>
        <path d="M4 2H32M4 42H32" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M6 2V8Q6 14 18 22Q30 30 30 36V42" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M30 2V8Q30 14 18 22Q6 30 6 36V42" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M12 6Q12 10 18 14Q24 18 24 22L24 6Z" fill={TEAL} />
        <circle cx="18" cy="26" r="1.5" fill={TEAL} />
        <circle cx="18" cy="30" r="1" fill={TEAL} opacity="0.6" />
      </svg>
    </div>
  );
}

// ─── AnimatedCheck / AnimatedError ───────────────────────────────────────────
function AnimatedCheck() {
  return (
    <div style={{ animation: "scale-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both", width: 88, height: 88 }}>
      <svg width="88" height="88" viewBox="0 0 88 88" fill="none">
        <circle cx="44" cy="44" r="40" fill={TEAL_SOFT} />
        <circle cx="44" cy="44" r="36" stroke={TEAL} strokeWidth="2.5" />
        <path d="M28 44l11 11 21-23" stroke={TEAL} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray="56" strokeDashoffset="56"
          style={{ animation: "check-draw 0.5s cubic-bezier(0.22,1,0.36,1) 0.15s both" }} />
      </svg>
    </div>
  );
}

function AnimatedError() {
  return (
    <div style={{ animation: "scale-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both", width: 80, height: 80 }}>
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <circle cx="40" cy="40" r="36" fill="rgba(239,68,68,0.08)" />
        <circle cx="40" cy="40" r="32" stroke="#ef4444" strokeWidth="2.5" />
        <path d="M28 28l24 24M52 28L28 52" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ─── Screen 1: Document Select ────────────────────────────────────────────────
function DocSelectScreen({ country, docType, onCountryChange, onDocTypeChange, onNext }: {
  country: Country | null; docType: DocType | null;
  onCountryChange: (c: Country) => void; onDocTypeChange: (d: DocType) => void;
  onNext: () => void;
}) {
  return (
    <div style={{ padding: "28px 24px 0" }}>
      <h1 style={{
        margin: 0, fontFamily: SERIF, fontSize: 36, fontWeight: 400,
        letterSpacing: -0.5, lineHeight: 1.05, color: INK,
      }}>
        Let&apos;s verify<br />
        <span style={{ fontStyle: "italic", color: TEAL_DEEP }}>who you are.</span>
      </h1>
      <p style={{ margin: "14px 0 0", fontSize: 14, color: INK_2, lineHeight: 1.55, maxWidth: 300 }}>
        We&apos;ll need a government-issued document and a quick selfie. Takes about two minutes.
      </p>

      <div style={{ marginTop: 28 }}>
        <CountryPicker value={country} onChange={(c) => { onCountryChange(c); onDocTypeChange(null as unknown as DocType); }} />
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: INK_3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
          Choose one
        </div>
        {DOC_TYPES.map(({ value, label, meta }) => (
          <DocRow
            key={value}
            kind={value}
            label={label}
            meta={meta}
            badge={value === "passport" ? "Recommended" : undefined}
            selected={docType === value}
            onClick={() => onDocTypeChange(value)}
          />
        ))}
      </div>

      <div style={{ marginTop: 24, paddingBottom: 40 }}>
        <PrimaryBtn onClick={onNext} disabled={!country || !docType}>Continue</PrimaryBtn>
        <div style={{
          marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          fontFamily: MONO, fontSize: 10, color: INK_3, letterSpacing: 0.5,
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="2" y="4.5" width="6" height="4.5" rx="0.5" stroke={INK_3} strokeWidth="1" />
            <path d="M3.5 4.5V3C3.5 1.9 4.1 1 5 1C5.9 1 6.5 1.9 6.5 3V4.5" stroke={INK_3} strokeWidth="1" fill="none" />
          </svg>
          End-to-end encrypted · Powered by Veridian
        </div>
      </div>
    </div>
  );
}

// ─── Screen 2: Upload Method ──────────────────────────────────────────────────
function DocMethodScreen({ docLabel, country, isFront, onCapture, onBack, token }: {
  docLabel: string; country: Country | null; isFront: boolean;
  onCapture: (dataUrl: string) => void; onBack: () => void; token: string;
}) {
  const [showQR, setShowQR] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const docType = DOC_TYPES.find((d) => d.label === docLabel)?.value ?? "passport";

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    onCapture(await fileToDataUrl(file)); e.target.value = "";
  };

  if (showQR) return <QRScreen token={token} onBack={() => setShowQR(false)} />;

  const countryName = country?.name ?? "your country";
  const side = isFront ? "front of your" : "back of your";

  return (
    <div style={{ padding: "28px 24px 0" }}>
      <h1 style={{
        margin: 0, fontFamily: SERIF, fontSize: 34, fontWeight: 400,
        letterSpacing: -0.5, lineHeight: 1.05, color: INK,
      }}>
        Capture your<br />
        <span style={{ fontStyle: "italic", color: TEAL_DEEP }}>
          {countryName} {docLabel.toLowerCase()}.
        </span>
      </h1>
      <p style={{ margin: "12px 0 0", fontSize: 14, color: INK_2, lineHeight: 1.5, maxWidth: 300 }}>
        {isFront
          ? "Place it on a flat surface in good light."
          : `Now flip it over — we need the ${side} ${docLabel.toLowerCase()}.`
        }
      </p>

      {/* Illustration */}
      <div style={{
        margin: "20px 0 0",
        background: PAPER_SHADE, borderRadius: 20,
        padding: "24px 16px",
      }}>
        <DocIllustration docType={docType} />
      </div>

      {/* Do / don't chips */}
      <div style={{ marginTop: 14, display: "flex", gap: 16, justifyContent: "center" }}>
        {([["do", "Good light"], ["do", "All corners"], ["dont", "No glare"]] as const).map(([t, l], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 16, height: 16, borderRadius: 999,
              background: t === "do" ? TEAL : CORAL,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {t === "do" ? (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1 4L3 6L7 2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M2 2L6 6M6 2L2 6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              )}
            </div>
            <span style={{ fontSize: 12, color: INK_2, fontWeight: 500 }}>{l}</span>
          </div>
        ))}
      </div>

      {/* Method buttons */}
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10, paddingBottom: 40 }}>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />
        <input ref={libraryRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        <MethodRow kind="camera" label="Take a photo" sub="Use this device&apos;s camera" primary onClick={() => cameraRef.current?.click()} />
        <MethodRow kind="library" label="Choose from library" sub="Pick a saved photo" onClick={() => libraryRef.current?.click()} />
        <MethodRow kind="qr" label="Use another device" sub="Scan a QR code" onClick={() => setShowQR(true)} />
      </div>
    </div>
  );
}

// ─── Document preview screen ──────────────────────────────────────────────────
function DocPreviewScreen({ title, subtitle, image, quality, continueLabel, onRetake, onContinue }: {
  title: string; subtitle: string; image: string; quality: string | null;
  continueLabel?: string; onRetake: () => void; onContinue: () => void;
}) {
  return (
    <div style={{ padding: "28px 24px 0" }}>
      <h1 style={{
        margin: 0, fontFamily: SERIF, fontSize: 28, fontWeight: 400,
        letterSpacing: -0.4, lineHeight: 1.1, color: INK,
      }}>
        {title}
      </h1>
      <p style={{ margin: "10px 0 0", fontSize: 14, color: INK_2, lineHeight: 1.5 }}>{subtitle}</p>

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <PreviewCard src={image} quality={quality} onRetake={onRetake} />
      </div>

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10, paddingBottom: 40 }}>
        <PrimaryBtn onClick={onContinue}>{continueLabel ?? "Continue"}</PrimaryBtn>
        <GhostBtn onClick={onRetake}>Retake photo</GhostBtn>
      </div>
    </div>
  );
}

// ─── Screen 3: Selfie ─────────────────────────────────────────────────────────
type SelfieMode = "camera" | "preview";

function SelfieScreen({ image, onCapture, onClear, onSubmit, submitting }: {
  image: string | null; onCapture: (d: string) => void; onClear: () => void;
  onSubmit: () => void; submitting: boolean;
}) {
  const [mode, setMode] = useState<SelfieMode>(image ? "preview" : "camera");
  const [quality, setQuality] = useState<string | null>(null);
  const [camKey, setCamKey] = useState(0);

  const handleCapture = async (dataUrl: string) => {
    const warn = await checkQuality(dataUrl);
    setQuality(warn);
    onCapture(dataUrl);
    setMode("preview");
  };

  const retake = () => { setMode("camera"); setQuality(null); onClear(); setCamKey((k) => k + 1); };

  if (mode === "preview" && image) {
    return (
      <div style={{ padding: "28px 24px 0" }}>
        <h1 style={{
          margin: 0, fontFamily: SERIF, fontSize: 30, fontWeight: 400,
          letterSpacing: -0.4, lineHeight: 1.1, color: INK,
        }}>
          Looking<br />
          <span style={{ fontStyle: "italic", color: TEAL_DEEP }}>good.</span>
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: 14, color: INK_2, lineHeight: 1.5 }}>
          Ready to submit your verification.
        </p>
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <PreviewCard src={image} quality={quality} onRetake={retake} />
        </div>
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10, paddingBottom: 40 }}>
          <PrimaryBtn onClick={onSubmit} loading={submitting}>
            {!submitting && "Submit verification"}
          </PrimaryBtn>
          <GhostBtn onClick={retake}>Retake selfie</GhostBtn>
        </div>
      </div>
    );
  }

  return <CircularCamera key={camKey} onCapture={handleCapture} />;
}

// ─── Screen 4: Processing ─────────────────────────────────────────────────────
const PROC_STEPS: { label: string; meta: string }[] = [
  { label: "Document uploaded",   meta: "Secure transfer complete" },
  { label: "Reading document",    meta: "MRZ + visual zone parsed" },
  { label: "Checking sanctions",  meta: "134 global watchlists" },
  { label: "Matching faces",      meta: "Biometric comparison" },
];

function ProcessingScreen({ currentStep, result }: { currentStep: number; result: VerificationResult | null }) {
  if (result) {
    return (
      <div style={{ padding: "40px 24px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, textAlign: "center" }}>
          {result.success ? (
            <>
              <AnimatedCheck />
              <h1 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 400, color: INK, letterSpacing: -0.4, lineHeight: 1.1, margin: 0 }}>
                Verification<br /><span style={{ fontStyle: "italic", color: TEAL_DEEP }}>submitted.</span>
              </h1>
              <p style={{ fontSize: 14, color: INK_2, lineHeight: 1.55, maxWidth: 280, margin: 0 }}>
                You can close this window. We&apos;ll notify the business once confirmed.
              </p>
              <div style={{
                padding: "12px 16px", borderRadius: 14, background: PAPER_SHADE,
                display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box",
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10, background: INK,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="3" y="6" width="8" height="6" rx="1" stroke="#fff" strokeWidth="1.4" />
                    <path d="M5 6V4.5C5 3.1 6 2 7 2C8 2 9 3.1 9 4.5V6" stroke="#fff" strokeWidth="1.4" fill="none" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>Your data is encrypted</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: INK_3, marginTop: 2, letterSpacing: 0.3 }}>
                    AES-256 · ISO 27001 · SOC 2 Type II
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <AnimatedError />
              <h1 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, color: INK, letterSpacing: -0.4, lineHeight: 1.1, margin: 0 }}>
                Something<br /><span style={{ fontStyle: "italic", color: "#b91c1c" }}>went wrong.</span>
              </h1>
              <p style={{ fontSize: 14, color: INK_2, lineHeight: 1.5, maxWidth: 280, margin: 0 }}>
                {result.error ?? "Verification failed. Please try again."}
              </p>
              <div style={{ width: "100%" }}>
                <PrimaryBtn onClick={() => window.location.reload()}>Try again</PrimaryBtn>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const getState = (i: number): "done" | "active" | "pending" =>
    i < currentStep ? "done" : i === currentStep ? "active" : "pending";

  return (
    <div style={{ padding: "40px 24px 0" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <HourglassMark />
        <h1 style={{
          margin: "22px 0 0", fontFamily: SERIF, fontSize: 30, fontWeight: 400,
          letterSpacing: -0.4, lineHeight: 1.1, color: INK,
        }}>
          Checking your<br />
          <span style={{ fontStyle: "italic", color: TEAL_DEEP }}>details now.</span>
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: 13, color: INK_2, lineHeight: 1.5, maxWidth: 280 }}>
          This usually takes 8–15 seconds. Please keep this window open.
        </p>
      </div>

      {/* Checklist card */}
      <div style={{
        marginTop: 28,
        background: PAPER,
        borderRadius: 18, border: `1px solid ${LINE}`,
        padding: "4px 16px",
      }}>
        {PROC_STEPS.map((s, i) => (
          <ChecklistRow key={s.label} state={getState(i)} label={s.label} meta={s.meta} />
        ))}
      </div>

      {/* Encryption footer */}
      <div style={{
        marginTop: 16, paddingBottom: 40,
        padding: "14px 16px", borderRadius: 14, background: PAPER_SHADE,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10, background: INK,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="3" y="6" width="8" height="6" rx="1" stroke="#fff" strokeWidth="1.4" />
            <path d="M5 6V4.5C5 3.1 6 2 7 2C8 2 9 3.1 9 4.5V6" stroke="#fff" strokeWidth="1.4" fill="none" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>Your data is encrypted</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: INK_3, marginTop: 2, letterSpacing: 0.3 }}>
            AES-256 · ISO 27001 · SOC 2 Type II
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export function VerificationFlow({ token }: { token: string }) {
  const [flowStep, setFlowStep] = useState<FlowStep>("doc-select");
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

  const railStep = (): 0 | 1 | 2 | 3 => {
    if (flowStep === "doc-select") return 0;
    if (["doc-method", "doc-front", "doc-back"].includes(flowStep)) return 1;
    if (flowStep === "selfie") return 2;
    return 3;
  };

  const isSelfieCamera = flowStep === "selfie" && !selfie;
  const anim = dir === "forward" ? "animate-slide-fwd" : "animate-slide-bwd";

  const renderStep = () => {
    switch (flowStep) {
      case "doc-select":
        return (
          <DocSelectScreen
            country={country} docType={docType}
            onCountryChange={(c) => { setCountry(c); setDocType(null); setDocFront(null); setDocBack(null); }}
            onDocTypeChange={(d) => { setDocType(d); setDocFront(null); setDocBack(null); }}
            onNext={() => go("doc-method")}
          />
        );

      case "doc-method":
        return (
          <DocMethodScreen
            docLabel={docLabel} country={country} isFront={true}
            onCapture={captureDocFront}
            onBack={() => go("doc-select", "backward")}
            token={token}
          />
        );

      case "doc-front":
        return docFront ? (
          <DocPreviewScreen
            title="Check the front"
            subtitle="Ensure all corners are visible and text is legible."
            image={docFront} quality={docFrontQ}
            continueLabel={needsBack ? "Continue to back" : "Continue to selfie"}
            onRetake={() => { setDocFront(null); setDocFrontQ(null); go("doc-method", "backward"); }}
            onContinue={() => go(needsBack ? "doc-back" : "selfie")}
          />
        ) : null;

      case "doc-back":
        return docBack ? (
          <DocPreviewScreen
            title="Check the back"
            subtitle="Ensure the back is clear and all corners are visible."
            image={docBack} quality={docBackQ}
            continueLabel="Continue to selfie"
            onRetake={() => { setDocBack(null); setDocBackQ(null); }}
            onContinue={() => go("selfie")}
          />
        ) : (
          <DocMethodScreen
            docLabel={docLabel} country={country} isFront={false}
            onCapture={captureDocBack}
            onBack={() => go("doc-front", "backward")}
            token={token}
          />
        );

      case "selfie":
        return (
          <SelfieScreen
            image={selfie}
            onCapture={setSelfie}
            onClear={() => setSelfie(null)}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        );

      case "processing":
        return <ProcessingScreen currentStep={procStep} result={result} />;
    }
  };

  const backAction = (): (() => void) | undefined => {
    if (flowStep === "doc-select" || flowStep === "processing") return undefined;
    if (flowStep === "doc-method") return () => go("doc-select", "backward");
    if (flowStep === "doc-front") return () => { setDocFront(null); setDocFrontQ(null); go("doc-method", "backward"); };
    if (flowStep === "doc-back") return () => go("doc-front", "backward");
    if (flowStep === "selfie" && selfie) return () => setSelfie(null); // go back to preview
    if (flowStep === "selfie") return () => go(needsBack ? "doc-back" : "doc-front", "backward");
    return undefined;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#050a09", display: "flex", justifyContent: "center" }}>
      <div style={{
        width: "100%", maxWidth: 430, minHeight: "100vh",
        background: PAPER, display: "flex", flexDirection: "column",
        position: "relative",
      }}>
        {/* Status bar spacer (mobile) */}
        <div style={{ height: 44, flexShrink: 0 }} />

        {/* TopBar */}
        <TopBar onBack={backAction()} dark={isSelfieCamera} />

        {/* Progress Rail */}
        {flowStep !== "processing" && <ProgressRail step={railStep()} />}

        {/* Main content */}
        <div key={flowStep} className={anim} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {renderStep()}
        </div>
      </div>
    </div>
  );
}
