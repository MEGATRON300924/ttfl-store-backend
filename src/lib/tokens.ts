import crypto from "crypto";

/**
 * Opaque, single-use tokens (email verification, password reset, refresh
 * tokens) are generated as random bytes, sent to the user as the raw value,
 * and stored in the DB only as a SHA-256 hash — so a database leak alone
 * can never be replayed as a valid token.
 */
export function generateOpaqueToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashOpaqueToken(raw);
  return { raw, hash };
}

export function hashOpaqueToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
