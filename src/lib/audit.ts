import { prisma } from "@/lib/prisma";
import type { AuditAction, Prisma } from "@prisma/client";

export async function recordAudit(params: {
  actorId?: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata,
      ipAddress: params.ipAddress,
    },
  });
}
