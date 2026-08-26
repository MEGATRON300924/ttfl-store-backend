import { enqueueEmail } from "@/lib/email-queue";
import { renderEmailLayout, escapeHtml } from "@/lib/email-layout";

/**
 * Every email in the app goes through here -> the queue (email-queue.ts)
 * -> the adapter (email-adapter.ts, Resend in production). Callers never
 * touch the adapter or queue directly, and never await delivery —
 * enqueueEmail returns as soon as the EmailLog row is written, so a
 * slow/down email provider can never block an order, checkout, or auth
 * request (spec §18).
 *
 * Every template function below builds its bodyHtml with escapeHtml()
 * around any value that ultimately traces back to something a user typed
 * (their own name, a store name, a rejection reason) — see email-layout.ts
 * for why. System-generated values (order numbers, amounts) are escaped
 * too, cheaply, as defense in depth even though they can't realistically
 * carry markup.
 */
export async function sendEmail(opts: { to: string; subject: string; html: string; event?: string }) {
  return enqueueEmail({
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    event: opts.event ?? "generic",
  });
}

export function verificationEmail(name: string, verifyUrl: string) {
  return {
    subject: "Verify your TTFL Store email",
    html: renderEmailLayout({
      heading: "Confirm your email",
      previewText: "One click to finish setting up your TTFL Store account.",
      bodyHtml: `<p>Hi ${escapeHtml(name)},</p><p>Confirm your email to finish setting up your TTFL Store account.</p>`,
      ctaText: "Verify email",
      ctaUrl: verifyUrl,
    }),
    event: "email_verification",
  };
}

export function passwordResetEmail(name: string, resetUrl: string) {
  return {
    subject: "Reset your TTFL Store password",
    html: renderEmailLayout({
      heading: "Reset your password",
      previewText: "Reset your TTFL Store password.",
      bodyHtml: `<p>Hi ${escapeHtml(name)},</p><p>Use the button below to reset your password. If you didn't request this, you can safely ignore this email.</p>`,
      ctaText: "Reset password",
      ctaUrl: resetUrl,
    }),
    event: "password_reset",
  };
}

export function vendorApplicationReceivedEmail(storeName: string) {
  return {
    subject: "We've received your vendor application",
    html: renderEmailLayout({
      heading: "Application received",
      bodyHtml: `<p>Thanks for applying to sell as <strong>${escapeHtml(storeName)}</strong> on TTFL Store. Our team will review your application shortly — you'll get an email as soon as there's a decision.</p>`,
    }),
    event: "vendor_application_received",
  };
}

export function orderConfirmationEmail(orderNumber: string) {
  return {
    subject: `Order ${orderNumber} confirmed`,
    html: renderEmailLayout({
      heading: "Order confirmed",
      previewText: `We've received your payment for ${orderNumber}.`,
      bodyHtml: `<p>Thanks for your order! We've received your payment for <strong>${escapeHtml(orderNumber)}</strong>. The vendor(s) have been notified and will begin processing shortly.</p>`,
    }),
    event: "order_confirmation",
  };
}

export function vendorNewOrderEmail(orderNumber: string, itemCount: number) {
  return {
    subject: `New order — ${orderNumber}`,
    html: renderEmailLayout({
      heading: "New order",
      bodyHtml: `<p>You have a new order (<strong>${escapeHtml(orderNumber)}</strong>) with ${itemCount} item(s). Log in to your vendor dashboard to process it.</p>`,
    }),
    event: "vendor_new_order",
  };
}

export function vendorApprovedEmail(storeName: string) {
  return {
    subject: "Your TTFL Store vendor application was approved",
    html: renderEmailLayout({
      heading: "You're approved!",
      bodyHtml: `<p>Good news — <strong>${escapeHtml(storeName)}</strong> is now live on TTFL Store. You can start listing products right away.</p>`,
    }),
    event: "vendor_approved",
  };
}

export function vendorRejectedEmail(storeName: string, reason: string) {
  return {
    subject: "Update on your TTFL Store vendor application",
    html: renderEmailLayout({
      heading: "Application update",
      bodyHtml: `<p>Your application for <strong>${escapeHtml(storeName)}</strong> wasn't approved this time.</p><p><strong>Reason:</strong> ${escapeHtml(reason)}</p>`,
    }),
    event: "vendor_rejected",
  };
}

export function adminNewVendorEmail(storeName: string) {
  return {
    subject: `New vendor application: ${storeName}`,
    html: renderEmailLayout({
      heading: "New vendor application",
      bodyHtml: `<p><strong>${escapeHtml(storeName)}</strong> has applied to sell on TTFL Store. Review it in the admin dashboard.</p>`,
    }),
    event: "admin_new_vendor",
  };
}

export function adminNewOrderEmail(orderNumber: string, totalAmount: number) {
  return {
    subject: `New order: ${orderNumber}`,
    html: renderEmailLayout({
      heading: "New order placed",
      bodyHtml: `<p>A new order (<strong>${escapeHtml(orderNumber)}</strong>) was placed for ₦${totalAmount.toLocaleString()}.</p>`,
    }),
    event: "admin_new_order",
  };
}

export function payoutApprovedEmail(amount: number) {
  return {
    subject: "Your payout request was approved",
    html: renderEmailLayout({
      heading: "Payout approved",
      bodyHtml: `<p>Your payout of ₦${amount.toLocaleString()} was approved and will be transferred shortly.</p>`,
    }),
    event: "vendor_payout_approved",
  };
}

export function orderRefundedEmail(orderNumber: string) {
  return {
    subject: `Order ${orderNumber} refunded`,
    html: renderEmailLayout({
      heading: "Order refunded",
      bodyHtml: `<p>Your order <strong>${escapeHtml(orderNumber)}</strong> has been refunded. The funds should reflect in 5-10 business days, depending on your bank.</p>`,
    }),
    event: "order_refunded",
  };
}
