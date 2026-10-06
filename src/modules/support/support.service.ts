import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { env } from "@/config/env";
import { sendEmail } from "@/lib/email";

type SupportMarketplace = "STORE" | "CARS" | "HOMES" | "ACCOUNT";
type StartConversationInput = {
  message: string;
  orderNumber?: string;
  errorReferenceCode?: string;
  marketplace?: SupportMarketplace;
  productId?: string;
  listingName?: string;
  listingUrl?: string;
};

function supportEmailHtml(title: string, body: string, link?: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033"><h2>${title}</h2><div style="white-space:pre-wrap;line-height:1.6">${body}</div>${link ? `<p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#f97316;color:#fff;text-decoration:none;border-radius:8px">Open TTFL Support</a></p>` : ""}<p style="font-size:12px;color:#667085">TTFL Store Support</p></div>`;
}

async function notifyAdminNewReport(conversation: any, initialMessage: string) {
  if (!env.adminNotificationEmail) return;
  const subject = initialMessage.match(/^Subject:\s*(.+)$/m)?.[1]?.trim() || "Customer report";
  await sendEmail({
    to: env.adminNotificationEmail,
    subject: `TTFL Store report: ${subject}`,
    html: supportEmailHtml("New customer report", `Customer: ${conversation.customer?.email ?? conversation.customerId}\n\n${initialMessage}`),
    event: "support_report_created",
  }).catch((error) => console.error("Failed to send support report notification:", error));
}

async function notifyCustomerReply(conversationId: string, body: string) {
  const conversation = await prisma.supportConversation.findUnique({ where: { id: conversationId }, include: { customer: { select: { email: true, firstName: true } } } });
  if (!conversation?.customer?.email) return;
  await sendEmail({
    to: conversation.customer.email,
    subject: "TTFL Store Support replied to your report",
    html: supportEmailHtml(`Hi ${conversation.customer.firstName || "there"}, TTFL Support has replied`, body, `${env.appUrl.replace(/\/$/, "")}/support/reports`),
    event: "support_report_reply",
  }).catch((error) => console.error("Failed to send support reply notification:", error));
}

function buildSupportMessage(input: StartConversationInput) {
  const marketplace = input.marketplace || "STORE";
  const metadata = [
    `Marketplace: ${marketplace}`,
    input.productId ? `Product ID: ${input.productId}` : "",
    input.listingName ? `Listing name: ${input.listingName}` : "",
    input.listingUrl ? `Listing URL: ${input.listingUrl}` : "",
  ].filter(Boolean).join("\n");
  const error = input.errorReferenceCode?.trim() ? `Error code: ${input.errorReferenceCode.trim()}\n\n` : "";
  return `${metadata}\n\n${error}${input.message}`;
}

export function parseSupportContext(body: string) {
  const marketplace = body.match(/^Marketplace:\s*(STORE|CARS|HOMES|ACCOUNT)$/m)?.[1] as SupportMarketplace | undefined;
  const productId = body.match(/^Product ID:\s*(.+)$/m)?.[1]?.trim();
  const listingName = body.match(/^Listing name:\s*(.+)$/m)?.[1]?.trim();
  const listingUrl = body.match(/^Listing URL:\s*(.+)$/m)?.[1]?.trim();
  return { marketplace: marketplace || "STORE", productId, listingName, listingUrl };
}

export async function startConversation(customerId: string, input: StartConversationInput) {
  const body = buildSupportMessage(input);
  const conversation = await prisma.supportConversation.create({
    data: {
      customerId,
      orderNumber: input.orderNumber,
      messages: { create: { senderId: customerId, senderType: "CUSTOMER", body } },
    },
    include: { messages: true, customer: { select: { email: true, firstName: true } } },
  });
  void notifyAdminNewReport(conversation, body);
  return conversation;
}

export async function getMyConversations(customerId: string) {
  return prisma.supportConversation.findMany({ where: { customerId }, include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } });
}

export async function getConversation(conversationId: string, requesterId: string, requesterRole: string) {
  const conversation = await prisma.supportConversation.findUnique({ where: { id: conversationId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!conversation) throw AppError.notFound("Conversation not found");
  if (requesterRole !== "ADMIN" && conversation.customerId !== requesterId) throw AppError.forbidden("You don't have access to this conversation");
  return conversation;
}

export async function postMessage(conversationId: string, senderId: string | null, senderType: "CUSTOMER" | "AGENT" | "SYSTEM", body: string) {
  const [message] = await prisma.$transaction([
    prisma.supportMessage.create({ data: { conversationId, senderId, senderType, body } }),
    prisma.supportConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);
  if (senderType === "AGENT") void notifyCustomerReply(conversationId, body);
  return message;
}

export async function adminListConversations(status?: "OPEN" | "ASSIGNED" | "RESOLVED" | "CLOSED") {
  return prisma.supportConversation.findMany({ where: status ? { status } : undefined, include: { customer: { select: { firstName: true, lastName: true, email: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } });
}

export async function adminListReports() {
  return prisma.supportConversation.findMany({ where: { messages: { some: { senderType: "CUSTOMER", body: { startsWith: "Marketplace:" } } } }, include: { customer: { select: { firstName: true, lastName: true, email: true } }, messages: { orderBy: { createdAt: "asc" } } }, orderBy: { updatedAt: "desc" } });
}

export async function adminAssignConversation(conversationId: string, adminId: string) {
  return prisma.supportConversation.update({ where: { id: conversationId }, data: { assignedAdminId: adminId, status: "ASSIGNED" } });
}
export async function adminSetStatus(conversationId: string, status: "RESOLVED" | "CLOSED" | "OPEN") {
  return prisma.supportConversation.update({ where: { id: conversationId }, data: { status } });
}
