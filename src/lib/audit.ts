import { prisma } from "@/lib/prisma";
import type { AuditAction, Prisma } from "@prisma/client";

export async function recordAudit(params: {
  actorId?: string;
  actorUserId?: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId ?? params.actorUserId,
      action: params.action,
      targetType: params.targetType ?? params.entityType,
      targetId: params.targetId ?? params.entityId,
      metadata: params.metadata,
      ipAddress: params.ipAddress,
    },
  });
}
