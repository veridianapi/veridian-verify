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
    const res = await fetch(`${API_BASE}/verifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({
        session_token: token,
        document_front: payload.document_front,
        selfie: payload.selfie,
        document_type: payload.document_type,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        success: false,
        error: body.message ?? "Verification failed. Please try again.",
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
