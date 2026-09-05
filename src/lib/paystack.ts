import crypto from "crypto";
import { AppError } from "@/utils/app-error";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw AppError.internal("Payments are not configured", "PAYSTACK_NOT_CONFIGURED");
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
    amount: number;
    currency: string;
    channel: string;
    paid_at: string | null;
    gateway_response: string;
    metadata: Record<string, unknown>;
  };
};

export type PaystackSplit = {
  type: "flat" | "percentage";
  bearer_type: "account" | "all" | "all-proportional" | "subaccount";
  subaccounts: { subaccount: string; share: number }[];
  bearer_subaccount?: string;
  reference?: string;
};

async function paystackRequest<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json = (await res.json()) as T & { status?: boolean; message?: string };
  if (!res.ok || json.status === false) {
    throw AppError.internal(json.message || "Paystack request failed", "PAYSTACK_REQUEST_FAILED");
  }
  return json;
}

export async function initializeTransaction(params: {
  email: string;
  amountNaira: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
  split?: PaystackSplit;
}): Promise<PaystackInitResponse["data"]> {
  const payload: Record<string, unknown> = {
    email: params.email,
    amount: Math.round(params.amountNaira * 100),
    reference: params.reference,
    callback_url: params.callbackUrl,
    metadata: params.metadata,
  };
  if (params.split?.subaccounts.length) payload.split = params.split;

  const json = await paystackRequest<PaystackInitResponse>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!json.status) throw AppError.internal(json.message || "Could not start payment", "PAYSTACK_INIT_FAILED");
  return json.data;
}

export async function createSubaccount(params: {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  percentageCharge: number;
  email?: string;
  contactName?: string;
  phone?: string;
}) {
  const json = await paystackRequest<any>("/subaccount", {
    method: "POST",
    body: JSON.stringify({
      business_name: params.businessName,
      settlement_bank: params.bankCode,
      account_number: params.accountNumber,
      percentage_charge: params.percentageCharge,
      primary_contact_email: params.email,
      primary_contact_name: params.contactName,
      primary_contact_phone: params.phone,
      settlement_schedule: "auto",
    }),
  });
  return json.data;
}

export async function updateSubaccount(code: string, params: {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  percentageCharge: number;
  email?: string;
  contactName?: string;
  phone?: string;
}) {
  const json = await paystackRequest<any>(`/subaccount/${encodeURIComponent(code)}`, {
    method: "PUT",
    body: JSON.stringify({
      business_name: params.businessName,
      settlement_bank: params.bankCode,
      account_number: params.accountNumber,
      percentage_charge: params.percentageCharge,
      primary_contact_email: params.email,
      primary_contact_name: params.contactName,
      primary_contact_phone: params.phone,
      settlement_schedule: "auto",
      active: true,
    }),
  });
  return json.data;
}

export async function getSubaccount(code: string) {
  const json = await paystackRequest<any>(`/subaccount/${encodeURIComponent(code)}`, { method: "GET" });
  return json.data;
}

export async function listBanks() {
  const json = await paystackRequest<any>("/bank?country=nigeria&perPage=100", { method: "GET" });
  return json.data as Array<{ id: number; name: string; code: string; active: boolean }>;
}

export async function verifyTransaction(reference: string): Promise<PaystackVerifyResponse["data"]> {
  const json = await paystackRequest<PaystackVerifyResponse>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" });
  if (!json.status) throw AppError.internal(json.message || "Could not verify payment", "PAYSTACK_VERIFY_FAILED");
  return json.data;
}

type PaystackRefundResponse = {
  status: boolean;
  message: string;
  data: { status: string; amount: number; transaction: { reference: string } };
};

export async function refundTransaction(reference: string, amountNaira?: number): Promise<PaystackRefundResponse["data"]> {
  const json = await paystackRequest<PaystackRefundResponse>("/refund", {
    method: "POST",
    body: JSON.stringify({ transaction: reference, ...(amountNaira ? { amount: Math.round(amountNaira * 100) } : {}) }),
  });
  if (!json.status) throw AppError.internal(json.message || "Could not process refund", "PAYSTACK_REFUND_FAILED");
  return json.data;
}

export function isValidPaystackSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha512", secretKey()).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
