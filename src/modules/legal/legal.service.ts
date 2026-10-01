import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export const CURRENT_TERMS_VERSION = "2026-10-01-v1";
export const CURRENT_TERMS_UPDATED_AT = "2026-10-01";

export function getCurrentTerms() {
  return {
    version: CURRENT_TERMS_VERSION,
    updatedAt: CURRENT_TERMS_UPDATED_AT,
    path: "/legal/terms",
  };
}

export async function acceptCurrentTerms(userId: string, ipAddress?: string | null) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      termsAcceptedVersion: CURRENT_TERMS_VERSION,
      termsAcceptedAt: new Date(),
      termsAcceptedIp: ipAddress || null,
    },
  });
  return { accepted: true, ...getCurrentTerms() };
}

export async function requireCurrentTerms(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { termsAcceptedVersion: true },
  });
  if (!user) throw AppError.notFound("User not found");
  return user.termsAcceptedVersion === CURRENT_TERMS_VERSION;
}
