export type PaystackVerificationState = "PENDING" | "SUCCESS" | "FAILED";

const PENDING_STATUSES = new Set(["ongoing", "pending", "processing", "queued"]);

export function classifyPaystackStatus(status: unknown): PaystackVerificationState {
  if (typeof status !== "string") return "FAILED";
  const normalized = status.trim().toLowerCase();
  if (normalized === "success") return "SUCCESS";
  if (PENDING_STATUSES.has(normalized)) return "PENDING";
  return "FAILED";
}
