import crypto from "crypto";
import { AppError } from "@/utils/app-error";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw AppError.internal("Payments are not configured", "PAYSTACK_NOT_CONFIGURED");
  return key;
}

type PaystackInitResponse = { status: boolean; message: string; data: { authorization_url: string; access_code: string; reference: string } };
type PaystackVerifyResponse = { status: boolean; message: string; data: { status: "success" | "failed" | "abandoned" | "ongoing" | "pending" | "processing" | "queued" | "reversed"; reference: string; amount: number; requested_amount?: number | null; fees?: number | null; currency: string; channel: string; paid_at: string | null; gateway_response: string; metadata: Record<string, unknown>; plan?: unknown; plan_object?: unknown; subscription?: { status?: string; subscription_code?: string; email_token?: string; next_payment_date?: string } | null; customer?: { email?: string; customer_code?: string } | null } };
type PaystackSplitResponse = { status: boolean; message: string; data: { id: number; split_code: string; active: boolean } };
type PaystackRefundResponse = { status: boolean; message: string; data: { status: string; amount: number; transaction: { reference: string } } };
type PaystackPlan = { id: number; name: string; amount: number; interval: string; currency: string; plan_code: string };
type PaystackPlanListResponse = { status: boolean; message: string; data: PaystackPlan[] };
type PaystackPlanCreateResponse = { status: boolean; message: string; data: PaystackPlan };
type PaystackCustomerResponse = { status: boolean; message: string; data: { email: string; customer_code: string; subscriptions?: Array<{ status?: string; subscription_code?: string; email_token?: string; amount?: number; plan?: number | { id?: number; plan_code?: string; amount?: number } }> } };
type PaystackSubscriptionActionResponse = { status: boolean; message: string; data?: unknown };

export type PaystackPaymentChannel = "card" | "bank" | "bank_transfer" | "ussd" | "qr" | "mobile_money" | "eft" | "apple_pay" | "payattitude" | "opay" | "pay_with_transfer";
export type PaystackTransactionSplit = { type: "flat" | "percentage"; currency: "NGN"; bearer_type: "account" | "all" | "all-proportional" | "subaccount"; bearer_subaccount?: string; subaccounts: { subaccount: string; share: number }[] };

async function paystackRequest<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, { ...init, headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  let json: T & { status?: boolean; message?: string };
  try { json = (await res.json()) as T & { status?: boolean; message?: string }; } catch { throw AppError.internal(`Paystack returned an invalid response (${res.status})`, "PAYSTACK_INVALID_RESPONSE"); }
  if (!res.ok || json.status === false) throw AppError.internal(json.message || `Paystack request failed (${res.status})`, "PAYSTACK_REQUEST_FAILED");
  return json;
}

export async function createPlan(params: { name: string; amountNaira: number; interval?: "monthly" | "annually"; description?: string }): Promise<PaystackPlan> {
  const amount = Math.round(params.amountNaira * 100);
  if (!Number.isFinite(amount) || amount < 10000) throw AppError.badRequest("A recurring plan must be at least ₦100", "PAYSTACK_PLAN_AMOUNT_INVALID");
  const json = await paystackRequest<PaystackPlanCreateResponse>("/plan", { method: "POST", body: JSON.stringify({ name: params.name.slice(0, 100), amount, interval: params.interval ?? "monthly", currency: "NGN", description: params.description?.slice(0, 200), send_invoices: true, send_sms: false }) });
  return json.data;
}

export async function getOrCreateMonthlyPlan(params: { tier: string; amountNaira: number }): Promise<PaystackPlan> {
  const amount = Math.round(params.amountNaira * 100);
  const name = `TTFL Store ${params.tier} Monthly`;
  const json = await paystackRequest<PaystackPlanListResponse>(`/plan?perPage=100&interval=monthly&amount=${amount}`, { method: "GET" });
  const existing = json.data?.find((plan) => plan.name === name && plan.amount === amount && plan.currency === "NGN");
  if (existing) return existing;
  return createPlan({ name, amountNaira: params.amountNaira, interval: "monthly", description: `TTFL Store ${params.tier} vendor plan` });
}

export async function getCustomer(emailOrCode: string) {
  const json = await paystackRequest<PaystackCustomerResponse>(`/customer/${encodeURIComponent(emailOrCode)}`, { method: "GET" });
  return json.data;
}

export async function disableSubscription(code: string, token: string) {
  const json = await paystackRequest<PaystackSubscriptionActionResponse>("/subscription/disable", { method: "POST", body: JSON.stringify({ code, token }) });
  return json.data;
}

export async function enableSubscription(code: string, token: string) {
  const json = await paystackRequest<PaystackSubscriptionActionResponse>("/subscription/enable", { method: "POST", body: JSON.stringify({ code, token }) });
  return json.data;
}

export async function createTransactionSplit(params: { name: string; type: "flat" | "percentage"; subaccounts: { subaccount: string; share: number }[]; bearerType?: PaystackTransactionSplit["bearer_type"]; bearerSubaccount?: string }): Promise<string> {
  if (!params.subaccounts.length) throw AppError.badRequest("A payment split needs at least one vendor", "PAYSTACK_SPLIT_EMPTY");
  if (params.subaccounts.some((item) => !item.subaccount || !Number.isFinite(item.share) || item.share <= 0)) throw AppError.badRequest("The payment split contains an invalid vendor share", "PAYSTACK_SPLIT_INVALID");
  const json = await paystackRequest<PaystackSplitResponse>("/split", { method: "POST", body: JSON.stringify({ name: params.name.slice(0, 100), type: params.type, currency: "NGN", subaccounts: params.subaccounts, bearer_type: params.bearerType ?? "account", ...(params.bearerSubaccount ? { bearer_subaccount: params.bearerSubaccount } : {}) }) });
  if (!json.status || !json.data?.split_code) throw AppError.internal(json.message || "Paystack did not return a split code", "PAYSTACK_SPLIT_CREATE_FAILED");
  return json.data.split_code;
}

export async function initializeTransaction(params: { email: string; amountNaira: number; reference: string; callbackUrl: string; metadata?: Record<string, unknown>; channels?: PaystackPaymentChannel[]; subaccount?: string; splitCode?: string; plan?: string; invoiceLimit?: number }): Promise<PaystackInitResponse["data"]> {
  const amountKobo = Math.round(params.amountNaira * 100);
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) throw AppError.badRequest("Payment amount must be greater than zero", "INVALID_PAYMENT_AMOUNT");
  if (params.subaccount && params.splitCode) throw AppError.badRequest("A Paystack transaction cannot use both a subaccount and a split code", "PAYSTACK_SPLIT_CONFLICT");
  const payload: Record<string, unknown> = { email: params.email, amount: amountKobo, currency: "NGN", reference: params.reference, callback_url: params.callbackUrl, metadata: params.metadata };
  if (params.channels?.length) payload.channels = params.channels;
  if (params.subaccount) payload.subaccount = params.subaccount;
  if (params.splitCode) payload.split_code = params.splitCode;
  if (params.plan) payload.plan = params.plan;
  if (params.invoiceLimit != null) payload.invoice_limit = params.invoiceLimit;
  const json = await paystackRequest<PaystackInitResponse>("/transaction/initialize", { method: "POST", body: JSON.stringify(payload) });
  if (!json.status) throw AppError.internal(json.message || "Could not start payment", "PAYSTACK_INIT_FAILED");
  return json.data;
}

export async function createSubaccount(params: { businessName: string; bankCode: string; accountNumber: string; percentageCharge: number; email?: string; contactName?: string; phone?: string }) {
  const json = await paystackRequest<any>("/subaccount", { method: "POST", body: JSON.stringify({ business_name: params.businessName, settlement_bank: params.bankCode, account_number: params.accountNumber, percentage_charge: params.percentageCharge, primary_contact_email: params.email, primary_contact_name: params.contactName, primary_contact_phone: params.phone, settlement_schedule: "auto" }) });
  return json.data;
}

export async function updateSubaccount(code: string, params: { businessName: string; bankCode: string; accountNumber: string; percentageCharge: number; email?: string; contactName?: string; phone?: string }) {
  const json = await paystackRequest<any>(`/subaccount/${encodeURIComponent(code)}`, { method: "PUT", body: JSON.stringify({ business_name: params.businessName, settlement_bank: params.bankCode, account_number: params.accountNumber, percentage_charge: params.percentageCharge, primary_contact_email: params.email, primary_contact_name: params.contactName, primary_contact_phone: params.phone, settlement_schedule: "auto", active: true }) });
  return json.data;
}

export async function getSubaccount(code: string) { const json = await paystackRequest<any>(`/subaccount/${encodeURIComponent(code)}`, { method: "GET" }); return json.data; }
export async function listBanks() { const json = await paystackRequest<any>("/bank?country=nigeria&perPage=100", { method: "GET" }); return json.data as Array<{ id: number; name: string; code: string; active: boolean }>; }
export async function chargeTransaction<T = any>(payload: Record<string, unknown>): Promise<T> { return paystackRequest<T>("/charge", { method: "POST", body: JSON.stringify(payload) }); }
export async function verifyTransaction(reference: string): Promise<PaystackVerifyResponse["data"]> { const json = await paystackRequest<PaystackVerifyResponse>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" }); if (!json.status) throw AppError.internal(json.message || "Could not verify payment", "PAYSTACK_VERIFY_FAILED"); return json.data; }
export async function refundTransaction(reference: string, amountNaira?: number): Promise<PaystackRefundResponse["data"]> { const json = await paystackRequest<PaystackRefundResponse>("/refund", { method: "POST", body: JSON.stringify({ transaction: reference, ...(amountNaira ? { amount: Math.round(amountNaira * 100) } : {}) }) }); if (!json.status) throw AppError.internal(json.message || "Could not process refund", "PAYSTACK_REFUND_FAILED"); return json.data; }
export function isValidPaystackSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean { if (!signatureHeader) return false; const expected = crypto.createHmac("sha512", secretKey()).update(rawBody).digest("hex"); const a = Buffer.from(expected); const b = Buffer.from(signatureHeader); if (a.length !== b.length) return false; return crypto.timingSafeEqual(a, b); }
