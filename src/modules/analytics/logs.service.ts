import { prisma } from "@/lib/prisma";

export async function listAuditLogs(page: number, limit: number, action?: string) {
  const where = action ? { action: action as never } : {};
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function listEmailLogs(page: number, limit: number, status?: string) {
  const where = status ? { status: status as never } : {};
  const [items, total] = await prisma.$transaction([
    prisma.emailLog.findMany({
      where,
      select: { id: true, to: true, subject: true, event: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.emailLog.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}
