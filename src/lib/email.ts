import { enqueueEmail } from "@/lib/email-queue";

/**
 * Every email in the app goes through here -> the queue (email-queue.ts)
 * -> the adapter (email-adapter.ts). Callers never touch the adapter or
 * queue directly, and never await delivery — enqueueEmail returns as soon
 * as the EmailLog row is written, so a slow/down email provider can never
 * block an order, checkout, or auth request (spec §18).
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
    html: `<p>Hi ${name},</p><p>Confirm your email to finish setting up your TTFL Store account:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
    event: "email_verification",
  };
}

export function passwordResetEmail(name: string, resetUrl: string) {
  return {
    subject: "Reset your TTFL Store password",
    html: `<p>Hi ${name},</p><p>Reset your password using the link below. If you didn't request this, you can ignore this email.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    event: "password_reset",
  };
}

export function vendorApplicationReceivedEmail(storeName: string) {
  return {
    subject: "We've received your vendor application",
    html: `<p>Thanks for applying to sell as <strong>${storeName}</strong> on TTFL Store. Our team will review your application shortly.</p>`,
    event: "vendor_application_received",
  };
}

export function orderConfirmationEmail(orderNumber: string) {
  return {
    subject: `Order ${orderNumber} confirmed`,
    html: `<p>Thanks for your order! We've received your payment for ${orderNumber}.</p>`,
    event: "order_confirmation",
  };
}

export function vendorNewOrderEmail(orderNumber: string, itemCount: number) {
  return {
    subject: `New order — ${orderNumber}`,
    html: `<p>You have a new order with ${itemCount} item(s). Log in to your vendor dashboard to process it.</p>`,
    event: "vendor_new_order",
  };
}

export function vendorApprovedEmail(storeName: string) {
  return {
    subject: "Your TTFL Store vendor application was approved",
    html: `<p>Good news — <strong>${storeName}</strong> is now live on TTFL Store. You can start listing products.</p>`,
    event: "vendor_approved",
  };
}

export function vendorRejectedEmail(storeName: string, reason: string) {
  return {
    subject: "Update on your TTFL Store vendor application",
    html: `<p>Your application for <strong>${storeName}</strong> wasn't approved this time.</p><p>Reason: ${reason}</p>`,
    event: "vendor_rejected",
  };
}

export function adminNewVendorEmail(storeName: string) {
  return {
    subject: `New vendor application: ${storeName}`,
    html: `<p><strong>${storeName}</strong> has applied to sell on TTFL Store. Review it in the admin dashboard.</p>`,
    event: "admin_new_vendor",
  };
}

export function adminNewOrderEmail(orderNumber: string, totalAmount: number) {
  return {
    subject: `New order: ${orderNumber}`,
    html: `<p>A new order (${orderNumber}) was placed for ₦${totalAmount.toLocaleString()}.</p>`,
    event: "admin_new_order",
  };
}

export function payoutApprovedEmail(amount: number) {
  return {
    subject: "Your payout request was approved",
    html: `<p>Your payout of ₦${amount.toLocaleString()} was approved and will be transferred shortly.</p>`,
    event: "vendor_payout_approved",
  };
}
