"use server";

const API_BASE = "https://api.veridianapi.com/v1";

function authHeader() {
  return { Authorization: `Bearer ${process.env.VERIDIAN_API_KEY}` };
}

export type SessionData = {
  token: string;
  status: string;
  business_name?: string;
};

export type VerificationPayload = {
  document_front: string;
  selfie: string;
  document_type: "passport" | "driving_licence" | "national_id";
};

export type VerificationResult = {
  success: boolean;
  error?: string;
};

export async function getSession(token: string): Promise<SessionData | null> {
  try {
    const res = await fetch(`${API_BASE}/sessions/${token}`, {
      headers: { ...authHeader() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function submitVerification(
  token: string,
  payload: VerificationPayload
): Promise<VerificationResult> {
  try {
    const stripPrefix = (b64: string) =>
      b64.includes(",") ? b64.split(",")[1] : b64;

    const res = await fetch(`${API_BASE}/verifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({
        document_type: payload.document_type,
        document_front: stripPrefix(payload.document_front),
        selfie: stripPrefix(payload.selfie),
      }),
    });

    if (!res.ok) {
      const rawBody = await res.text().catch(() => "");
      console.error(
        `[veridian] POST /v1/verifications failed — status ${res.status}\n${rawBody}`
      );
      let message: string | undefined;
      try {
        message = (JSON.parse(rawBody) as { message?: string }).message;
      } catch {
        // non-JSON error body
      }
      return {
        success: false,
        error: message ?? "Verification failed. Please try again.",
      };
    }

    return { success: true };
  } catch {
    return {
      success: false,
      error: "Network error. Please check your connection and try again.",
    };
  }
}
