import { enqueueEmail } from "@/lib/email-queue";
import { renderEmailLayout, escapeHtml } from "@/lib/email-layout";

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

export function adminAccessGrantedEmail(name: string, email: string, adminUrl: string) {
  const displayName = name.trim() || "there";
  const safeEmail = escapeHtml(email);
  const safeAdminUrl = escapeHtml(adminUrl);

  return {
    subject: "You now have admin access to TTFL Store",
    html: renderEmailLayout({
      heading: "You're now a TTFL Store administrator",
      previewText: "Your TTFL Store account has been granted administrator access.",
      bodyHtml: `<p>Hi ${escapeHtml(displayName)},</p><p>Your existing TTFL Store account (<strong>${safeEmail}</strong>) has been granted <strong>Administrator</strong> access.</p><p><strong>Quick guide</strong></p><ol><li>Open the Admin Portal using the button below.</li><li>Sign in with your existing TTFL Store account.</li><li>Use the dashboard to manage vendors, products, orders, payouts, coupons, featured listings, support, broadcasts, analytics, and audit logs.</li><li>Only perform actions you are authorized to make, and always protect your account credentials.</li></ol><p>If you did not expect this change, contact the TTFL Store owner or platform administrator immediately.</p><p style="font-size:12px;color:#5B6472;word-break:break-all;">Admin Portal: ${safeAdminUrl}</p>`,
      ctaText: "Open Admin Portal",
      ctaUrl: adminUrl,
    }),
    event: "admin_access_granted",
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
