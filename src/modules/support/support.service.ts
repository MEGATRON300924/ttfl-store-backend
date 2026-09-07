import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export async function startConversation(customerId: string, initialMessage: string, orderNumber?: string) {
  return prisma.supportConversation.create({ data: { customerId, orderNumber, messages: { create: { senderId: customerId, senderType: "CUSTOMER", body: initialMessage } } }, include: { messages: true } });
}

export async function getMyConversations(customerId: string) {
  return prisma.supportConversation.findMany({ where: { customerId }, include: { messages: { orderBy: { createdAt: "asc" }, take: 1 } }, orderBy: { updatedAt: "desc" } });
}

export async function getConversation(conversationId: string, requesterId: string, requesterRole: string) {
  const conversation = await prisma.supportConversation.findUnique({ where: { id: conversationId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!conversation) throw AppError.notFound("Conversation not found");
  if (requesterRole !== "ADMIN" && conversation.customerId !== requesterId) throw AppError.forbidden("You don't have access to this conversation");
  return conversation;
}

export async function postMessage(conversationId: string, senderId: string | null, senderType: "CUSTOMER" | "AGENT" | "SYSTEM", body: string) {
  const [message] = await prisma.$transaction([prisma.supportMessage.create({ data: { conversationId, senderId, senderType, body } }), prisma.supportConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })]);
  return message;
}

export async function adminListConversations(status?: "OPEN" | "ASSIGNED" | "RESOLVED" | "CLOSED") {
  return prisma.supportConversation.findMany({ where: status ? { status } : undefined, include: { customer: { select: { firstName: true, lastName: true, email: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } });
}

export async function adminListReports() {
  return prisma.supportConversation.findMany({ where: { messages: { some: { senderType: "CUSTOMER", body: { startsWith: "Subject:" } } } }, include: { customer: { select: { firstName: true, lastName: true, email: true } }, messages: { orderBy: { createdAt: "asc" } } }, orderBy: { updatedAt: "desc" } });
}

export async function adminAssignConversation(conversationId: string, adminId: string) { return prisma.supportConversation.update({ where: { id: conversationId }, data: { assignedAdminId: adminId, status: "ASSIGNED" } }); }
export async function adminSetStatus(conversationId: string, status: "RESOLVED" | "CLOSED" | "OPEN") { return prisma.supportConversation.update({ where: { id: conversationId }, data: { status } }); }
