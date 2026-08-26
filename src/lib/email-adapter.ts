import { Resend } from "resend";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";

export type EmailAdapterResult = { ok: true } | { ok: false; error: string };

/**
 * The only file that knows how emails actually get sent. Everything else
 * in the app calls the queue (lib/email-queue.ts), never this directly.
 * Swapping providers means changing this file (or adding a branch here),
 * nothing else in the codebase.
 *
 * Resend is the production provider. SMTP is kept as a secondary option
 * (some deployments may still want it — removing working code isn't free),
 * but is not the default and Render's env should set EMAIL_PROVIDER=resend.
 * "console" remains for local dev with no provider configured at all.
 */
export async function deliverEmail(params: { to: string; subject: string; html: string }): Promise<EmailAdapterResult> {
  switch (env.email.provider) {
    case "resend":
      return deliverViaResend(params);
    case "smtp":
      return deliverViaSmtp(params);
    case "console":
    default:
      logger.info(`[email:console] to=${params.to} subject="${params.subject}"`);
      return { ok: true };
  }
}

// --- Resend (production) ---------------------------------------------------

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (resendClient) return resendClient;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY to be set");
  }
  // The key never leaves this process — it's read straight from the
  // environment and handed to the SDK, never logged, never returned in
  // any API response, never referenced anywhere else in the codebase.
  resendClient = new Resend(apiKey);
  return resendClient;
}

async function deliverViaResend(params: { to: string; subject: string; html: string }): Promise<EmailAdapterResult> {
  try {
    const client = getResendClient();
    const { error } = await client.emails.send({
      from: env.email.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (error) {
      logger.error("Resend delivery failed", { error: error.message, to: params.to });
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Resend error";
    logger.error("Resend delivery threw", { error: message, to: params.to });
    return { ok: false, error: message };
  }
}

// --- SMTP (secondary/optional) ----------------------------------------------

let smtpTransport: nodemailer.Transporter | null = null;

function getSmtpTransport(): nodemailer.Transporter {
  if (smtpTransport) return smtpTransport;

  const host = process.env.EMAIL_HOST;
  const port = process.env.EMAIL_PORT;
  const user = process.env.EMAIL_USER;
  const password = process.env.EMAIL_PASSWORD;

  if (!host || !port || !user || !password) {
    throw new Error(
      "EMAIL_PROVIDER=smtp requires EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD to be set"
    );
  }

  // nodemailer's TS overloads for createTransport are notoriously fussy
  // about the exact options shape per-transport-type; a plain SMTP config
  // object is valid at runtime but doesn't always satisfy every overload,
  // so this one call is intentionally loosely typed rather than fighting
  // the generic inference.
  smtpTransport = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass: password },
  } as SMTPTransport.Options);
  return smtpTransport;
}

async function deliverViaSmtp(params: { to: string; subject: string; html: string }): Promise<EmailAdapterResult> {
  try {
    const transport = getSmtpTransport();
    await transport.sendMail({
      from: env.email.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown SMTP error";
    logger.error("SMTP delivery failed", { error: message, to: params.to });
    return { ok: false, error: message };
  }
}
