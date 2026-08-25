import crypto from "crypto";
import { AppError } from "@/utils/app-error";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw AppError.internal("Payments are not configured", "PAYSTACK_NOT_CONFIGURED");
  }
  return key;
}

type PaystackInitResponse = {
  status: boolean;
  message: string;
  data: { authorization_url: string; access_code: string; reference: string };
};

type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data: {
    status: "success" | "failed" | "abandoned";
    reference: string;
    amount: number; // kobo
    currency: string;
    channel: string;
    paid_at: string | null;
    gateway_response: string;
    metadata: Record<string, unknown>;
  };
};

/**
 * Initializes a Paystack transaction. Amount is passed in Naira and
 * converted to kobo here (Paystack's API unit) so callers never have to
 * remember the *100 themselves.
 */
export async function initializeTransaction(params: {
  email: string;
  amountNaira: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<PaystackInitResponse["data"]> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      amount: Math.round(params.amountNaira * 100),
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    }),
  });

  const json = (await res.json()) as PaystackInitResponse;
  if (!res.ok || !json.status) {
    throw AppError.internal(json.message || "Could not start payment", "PAYSTACK_INIT_FAILED");
  }
  return json.data;
}

/**
 * Never trust the frontend's "payment succeeded" claim (spec §20) — always
 * re-verify server-side against Paystack directly, whether triggered by
 * the webhook or by the customer's browser hitting the callback URL.
 */
export async function verifyTransaction(reference: string): Promise<PaystackVerifyResponse["data"]> {
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secretKey()}` } }
  );

  const json = (await res.json()) as PaystackVerifyResponse;
  if (!res.ok || !json.status) {
    throw AppError.internal(json.message || "Could not verify payment", "PAYSTACK_VERIFY_FAILED");
  }
  return json.data;
}

type PaystackRefundResponse = {
  status: boolean;
  message: string;
  data: { status: string; amount: number; transaction: { reference: string } };
};

/** Initiates a refund through Paystack for a previously successful transaction. */
export async function refundTransaction(reference: string, amountNaira?: number): Promise<PaystackRefundResponse["data"]> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction: reference,
      ...(amountNaira ? { amount: Math.round(amountNaira * 100) } : {}),
    }),
  });

  const json = (await res.json()) as PaystackRefundResponse;
  if (!res.ok || !json.status) {
    throw AppError.internal(json.message || "Could not process refund", "PAYSTACK_REFUND_FAILED");
  }
  return json.data;
}

/** Validates the `x-paystack-signature` header on incoming webhooks. */
export function isValidPaystackSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha512", secretKey()).update(rawBody).digest("hex");
  // timing-safe comparison
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
