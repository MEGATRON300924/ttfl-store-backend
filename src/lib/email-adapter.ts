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
 */
export async function deliverEmail(params: { to: string; subject: string; html: string }): Promise<EmailAdapterResult> {
  switch (env.email.provider) {
    case "smtp":
      return deliverViaSmtp(params);
    case "console":
    default:
      logger.info(`[email:console] to=${params.to} subject="${params.subject}"`);
      return { ok: true };
  }
}

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
