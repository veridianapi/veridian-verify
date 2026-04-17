"use client";

import { useState, useRef, useCallback } from "react";
import { submitVerification, type VerificationResult } from "./actions";

type Step = 1 | 2 | 3 | 4;
type DocType = "passport" | "driving_licence" | "national_id";

const PROCESSING_STEPS = [
  "Uploading documents...",
  "Verifying identity...",
  "Checking sanctions...",
  "Complete",
];

// ─── Shield Logo ────────────────────────────────────────────────────────────

function ShieldLogo({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M32 4L8 14v18c0 13.3 10.3 25.7 24 29 13.7-3.3 24-15.7 24-29V14L32 4z"
        fill="#1d9e75"
        fillOpacity="0.15"
        stroke="#1d9e75"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M22 32l7 7 13-14"
        stroke="#1d9e75"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Progress Bar ────────────────────────────────────────────────────────────

function ProgressBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-0 mb-8 w-full" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={3}>
      {[1, 2, 3].map((s, i) => (
        <div key={s} className="flex items-center flex-1">
          <div
            className="flex-1 h-1 rounded-full transition-all duration-500"
            style={{
              background: current > s ? "#1d9e75" : current === s ? "#1d9e75" : "#152620",
              opacity: current === s ? 1 : current > s ? 1 : 0.4,
            }}
          />
          {i < 2 && (
            <div
              className="w-2 h-2 rounded-full mx-0.5 transition-all duration-500 flex-shrink-0"
              style={{
                background: current > s ? "#1d9e75" : "#152620",
                opacity: current > s ? 1 : 0.3,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Upload Area ─────────────────────────────────────────────────────────────

function UploadArea({
  capture,
  preview,
  inputRef,
  onChange,
  label,
}: {
  capture: "environment" | "user";
  preview: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label: string;
}) {
  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, [inputRef]);

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture={capture}
        onChange={onChange}
        className="hidden"
        aria-label={label}
      />
      <button
        type="button"
        onClick={handleClick}
        className="w-full rounded-2xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center overflow-hidden"
        style={{
          borderColor: preview ? "#1d9e75" : "#152620",
          background: preview ? "transparent" : "#0d1a16",
          minHeight: "200px",
        }}
        aria-label={label}
      >
        {preview ? (
          <img
            src={preview}
            alt="Preview"
            className="w-full h-full object-cover rounded-2xl"
            style={{ maxHeight: "260px" }}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 py-10 px-6">
            <CameraIcon />
            <span className="text-sm font-medium" style={{ color: "#6b8f82" }}>
              Tap to {capture === "user" ? "take a selfie" : "take a photo"}
            </span>
            <span className="text-xs" style={{ color: "#6b8f82", opacity: 0.7 }}>
              or choose from library
            </span>
          </div>
        )}
      </button>
      {preview && (
        <button
          type="button"
          onClick={handleClick}
          className="mt-2 w-full text-sm py-2 rounded-xl transition-colors"
          style={{ color: "#1d9e75" }}
        >
          Retake photo
        </button>
      )}
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function CameraIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect width="40" height="40" rx="12" fill="#1d9e75" fillOpacity="0.1" />
      <path
        d="M15 17a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1.5l-1-2h-5l-1 2H15z"
        stroke="#1d9e75"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="22" r="2.5" stroke="#1d9e75" strokeWidth="1.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="#1d9e75" fillOpacity="0.15" />
      <circle cx="32" cy="32" r="24" stroke="#1d9e75" strokeWidth="2" />
      <path
        d="M21 32l8 8 14-16"
        stroke="#1d9e75"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="#e53e3e" fillOpacity="0.1" />
      <circle cx="32" cy="32" r="24" stroke="#e53e3e" strokeWidth="2" />
      <path
        d="M24 24l16 16M40 24L24 40"
        stroke="#e53e3e"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      aria-label="Loading"
    >
      <circle cx="24" cy="24" r="20" stroke="#152620" strokeWidth="4" />
      <path
        d="M24 4a20 20 0 0 1 20 20"
        stroke="#1d9e75"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Primary Button ───────────────────────────────────────────────────────────

function PrimaryButton({
  onClick,
  disabled,
  loading,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full rounded-2xl font-semibold text-base transition-all duration-200 flex items-center justify-center gap-2"
      style={{
        background: disabled ? "#152620" : "#1d9e75",
        color: disabled ? "#6b8f82" : "#ffffff",
        minHeight: "56px",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {loading ? (
        <svg className="animate-spin" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" />
          <path d="M10 2a8 8 0 0 1 8 8" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ) : (
        children
      )}
    </button>
  );
}

// ─── Step 1: Welcome ─────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="animate-fade-in-up flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 pt-4">
        <ShieldLogo size={72} />
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#f0f4f3" }}>
            Verify your identity
          </h1>
          <p className="mt-2 text-sm" style={{ color: "#6b8f82" }}>
            This process takes about 2 minutes
          </p>
        </div>
      </div>

      <div
        className="rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: "#0d1a16" }}
      >
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#1d9e75" }}>
          What you&apos;ll need
        </p>
        <div className="flex flex-col gap-3">
          <RequirementItem
            icon={
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="2" y="5" width="16" height="11" rx="2" stroke="#1d9e75" strokeWidth="1.5" />
                <circle cx="7" cy="10.5" r="2" stroke="#1d9e75" strokeWidth="1.5" />
                <path d="M12 9h4M12 12h3" stroke="#1d9e75" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            }
            text="A valid passport, driving licence, or national ID"
          />
          <RequirementItem
            icon={
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="8" r="3" stroke="#1d9e75" strokeWidth="1.5" />
                <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="#1d9e75" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            }
            text="Your face (selfie)"
          />
        </div>
      </div>

      <div
        className="rounded-xl px-4 py-3 flex items-start gap-3"
        style={{ background: "#0d1a16", border: "1px solid #152620" }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-0.5 flex-shrink-0" aria-hidden="true">
          <circle cx="8" cy="8" r="7" stroke="#6b8f82" strokeWidth="1.2" />
          <path d="M8 7v4M8 5.5v.5" stroke="#6b8f82" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <p className="text-xs leading-relaxed" style={{ color: "#6b8f82" }}>
          Your data is encrypted and processed securely. We never store your documents beyond verification.
        </p>
      </div>

      <PrimaryButton onClick={onNext}>
        Start verification
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </PrimaryButton>
    </div>
  );
}

function RequirementItem({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <span className="text-sm leading-relaxed" style={{ color: "#b8d4cc" }}>
        {text}
      </span>
    </div>
  );
}

// ─── Step 2: Document Upload ──────────────────────────────────────────────────

const DOC_TYPE_OPTIONS: { value: DocType; label: string }[] = [
  { value: "passport", label: "Passport" },
  { value: "driving_licence", label: "Driving licence" },
  { value: "national_id", label: "National ID" },
];

function DocumentStep({
  docType,
  onDocTypeChange,
  image,
  inputRef,
  onFileChange,
  onNext,
}: {
  docType: DocType;
  onDocTypeChange: (v: DocType) => void;
  image: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onNext: () => void;
}) {
  return (
    <div className="animate-fade-in-up flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight" style={{ color: "#f0f4f3" }}>
          Upload your document
        </h2>
        <p className="mt-1 text-sm" style={{ color: "#6b8f82" }}>
          Take a clear photo of your passport, driving licence, or national ID
        </p>
      </div>

      <div className="flex rounded-xl overflow-hidden" style={{ background: "#0d1a16" }}>
        {DOC_TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onDocTypeChange(opt.value)}
            className="flex-1 py-3 text-xs font-medium transition-all duration-200"
            style={{
              background: docType === opt.value ? "#1d9e75" : "transparent",
              color: docType === opt.value ? "#ffffff" : "#6b8f82",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <UploadArea
        capture="environment"
        preview={image}
        inputRef={inputRef}
        onChange={onFileChange}
        label="Upload document photo"
      />

      <div className="flex flex-col gap-2 text-xs" style={{ color: "#6b8f82" }}>
        <TipItem text="Ensure all four corners are visible" />
        <TipItem text="Avoid glare and shadows" />
        <TipItem text="Text must be clearly legible" />
      </div>

      <PrimaryButton onClick={onNext} disabled={!image}>
        Continue
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </PrimaryButton>
    </div>
  );
}

function TipItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: "#1d9e75" }} />
      {text}
    </div>
  );
}

// ─── Step 3: Selfie ───────────────────────────────────────────────────────────

function SelfieStep({
  image,
  inputRef,
  onFileChange,
  onSubmit,
  submitting,
}: {
  image: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <div className="animate-fade-in-up flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight" style={{ color: "#f0f4f3" }}>
          Take a selfie
        </h2>
        <p className="mt-1 text-sm" style={{ color: "#6b8f82" }}>
          Look directly at the camera in good lighting
        </p>
      </div>

      <UploadArea
        capture="user"
        preview={image}
        inputRef={inputRef}
        onChange={onFileChange}
        label="Take selfie"
      />

      <div className="flex flex-col gap-2 text-xs" style={{ color: "#6b8f82" }}>
        <TipItem text="Face the camera directly" />
        <TipItem text="Remove glasses if possible" />
        <TipItem text="Ensure your face is well-lit" />
      </div>

      <PrimaryButton onClick={onSubmit} disabled={!image} loading={submitting}>
        Submit verification
      </PrimaryButton>
    </div>
  );
}

// ─── Step 4: Processing / Result ─────────────────────────────────────────────

function ProcessingStep({
  currentStep,
  result,
}: {
  currentStep: number;
  result: VerificationResult | null;
}) {
  if (result) {
    return (
      <div className="animate-fade-in-up flex flex-col items-center gap-6 pt-8 text-center">
        {result.success ? (
          <>
            <CheckIcon />
            <div>
              <h2 className="text-xl font-bold" style={{ color: "#f0f4f3" }}>
                Verification submitted
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "#6b8f82" }}>
                You can close this window.
                <br />
                We&apos;ll notify the business once your identity is confirmed.
              </p>
            </div>
            <div
              className="rounded-2xl px-6 py-4 w-full"
              style={{ background: "#0d1a16", border: "1px solid rgba(29,158,117,0.3)" }}
            >
              <p className="text-xs" style={{ color: "#6b8f82" }}>
                Reference: your verification is being processed. This usually takes under 60 seconds.
              </p>
            </div>
          </>
        ) : (
          <>
            <ErrorIcon />
            <div>
              <h2 className="text-xl font-bold" style={{ color: "#f0f4f3" }}>
                Verification failed
              </h2>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "#6b8f82" }}>
                {result.error ?? "Something went wrong. Please try again."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-2xl font-semibold text-base py-4 transition-all duration-200"
              style={{ background: "#0d1a16", color: "#1d9e75", border: "1.5px solid #1d9e75" }}
            >
              Try again
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up flex flex-col items-center gap-8 pt-8">
      <div className="flex flex-col items-center gap-4">
        <Spinner />
        <h2 className="text-lg font-semibold" style={{ color: "#f0f4f3" }}>
          Processing your verification
        </h2>
      </div>

      <div className="w-full flex flex-col gap-3">
        {PROCESSING_STEPS.map((label, i) => {
          const isDone = i < currentStep;
          const isActive = i === currentStep;
          return (
            <div
              key={label}
              className="flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-500"
              style={{
                background: isActive ? "#0d1a16" : "transparent",
                border: isActive ? "1px solid #152620" : "1px solid transparent",
                opacity: i > currentStep ? 0.3 : 1,
              }}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: isDone ? "#1d9e75" : isActive ? "#152620" : "#0d1a16" }}
              >
                {isDone ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2.5 6l2.5 2.5 4.5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : isActive ? (
                  <div className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: "#1d9e75" }} />
                ) : (
                  <div className="w-2 h-2 rounded-full" style={{ background: "#152620" }} />
                )}
              </div>
              <span
                className="text-sm font-medium"
                style={{ color: isDone || isActive ? "#f0f4f3" : "#6b8f82" }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Root Export ──────────────────────────────────────────────────────────────

export function VerificationFlow({ token }: { token: string }) {
  const [step, setStep] = useState<Step>(1);
  const [docType, setDocType] = useState<DocType>("passport");
  const [docImage, setDocImage] = useState<string | null>(null);
  const [selfieImage, setSelfieImage] = useState<string | null>(null);
  const [processingStep, setProcessingStep] = useState(0);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const docInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);

  const toBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result as string;
        resolve(data.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleDocFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const base64 = await toBase64(file);
    setDocImage(`data:${file.type};base64,${base64}`);
  };

  const handleSelfieFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const base64 = await toBase64(file);
    setSelfieImage(`data:${file.type};base64,${base64}`);
  };

  const handleSubmit = async () => {
    if (!docImage || !selfieImage || submitting) return;
    setSubmitting(true);
    setStep(4);
    setProcessingStep(0);

    await new Promise((r) => setTimeout(r, 1000));
    setProcessingStep(1);
    await new Promise((r) => setTimeout(r, 1200));
    setProcessingStep(2);

    try {
      const docBase64 = docImage.split(",")[1];
      const selfieBase64 = selfieImage.split(",")[1];
      const res = await submitVerification(token, {
        document_front: docBase64,
        selfie: selfieBase64,
        document_type: docType,
      });

      await new Promise((r) => setTimeout(r, 800));
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
    <div
      className="min-h-screen flex flex-col items-center justify-start px-4 pt-6 pb-10"
      style={{ background: "#050a09" }}
    >
      <div className="w-full max-w-[480px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <ShieldLogo size={28} />
            <span className="text-sm font-semibold tracking-wide" style={{ color: "#6b8f82" }}>
              Veridian
            </span>
          </div>
          <span className="text-xs" style={{ color: "#152620" }}>
            {step < 4 ? `Step ${step} of 3` : ""}
          </span>
        </div>

        {/* Progress */}
        {step < 4 && <ProgressBar current={step} />}

        {/* Steps */}
        {step === 1 && <WelcomeStep onNext={() => setStep(2)} />}
        {step === 2 && (
          <DocumentStep
            docType={docType}
            onDocTypeChange={setDocType}
            image={docImage}
            inputRef={docInputRef}
            onFileChange={handleDocFile}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <SelfieStep
            image={selfieImage}
            inputRef={selfieInputRef}
            onFileChange={handleSelfieFile}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        )}
        {step === 4 && (
          <ProcessingStep currentStep={processingStep} result={result} />
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs" style={{ color: "#152620" }}>
            Secured by Veridian · End-to-end encrypted
          </p>
        </div>
      </div>
    </div>
  );
}
