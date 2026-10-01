import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export const REPORT_REASONS = ["SCAM_FRAUD","COUNTERFEIT","MISLEADING_LISTING","PAYMENT_OFF_PLATFORM","NON_DELIVERY","HARASSMENT_ABUSE","SUSPICIOUS_ACTIVITY","OTHER"] as const;
export const REPORT_STATUSES = ["OPEN","UNDER_REVIEW","RESOLVED","DISMISSED"] as const;

type Reason = typeof REPORT_REASONS[number];

function normalizeEvidence(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === "string" && /^https?:\/\//i.test(value.trim())).map(v => v.trim()).slice(0, 10);
}

export async function createStoreReport(reporterId: string, vendorId: string, reason: Reason, description: string, evidenceLinks: unknown, orderNumber?: string) {
  if (description.trim().length < 20) throw AppError.badRequest("Please provide at least 20 characters explaining the issue.", "REPORT_DESCRIPTION_TOO_SHORT");
  const vendor = await prisma.vendorProfile.findUnique({ where: { id: vendorId }, select: { id: true, storeName: true, status: true } });
  if (!vendor) throw AppError.notFound("Store not found", "STORE_NOT_FOUND");
  if (vendor.status === "REJECTED") throw AppError.badRequest("This store is not available for reporting.", "STORE_UNAVAILABLE");
  const evidence = normalizeEvidence(evidenceLinks);
  if (evidence.length === 0) throw AppError.badRequest("Please provide at least one evidence link, such as a screenshot, receipt, chat, or payment proof.", "REPORT_EVIDENCE_REQUIRED");
  const recent = await prisma.storeReport.findFirst({ where: { reporterId, vendorId, status: { in: ["OPEN","UNDER_REVIEW"] } }, select: { id: true } });
  if (recent) throw AppError.conflict("You already have an active report for this store.", "REPORT_ALREADY_OPEN");
  return prisma.storeReport.create({ data: { reporterId, vendorId, reason, description: description.trim(), evidenceLinks: evidence, orderNumber: orderNumber?.trim() || undefined } });
}

export async function getMyReports(reporterId: string) {
  return prisma.storeReport.findMany({ where: { reporterId }, include: { vendor: { select: { id: true, storeName: true, storeSlug: true } } }, orderBy: { createdAt: "desc" } });
}

export async function adminListReports(status?: typeof REPORT_STATUSES[number]) {
  return prisma.storeReport.findMany({ where: status ? { status } : undefined, include: { vendor: { select: { id: true, storeName: true, storeSlug: true } }, reporter: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "desc" } });
}

export async function adminSetReportStatus(id: string, status: typeof REPORT_STATUSES[number], adminNotes?: string, adminId?: string) {
  const report = await prisma.storeReport.findUnique({ where: { id }, select: { id: true } });
  if (!report) throw AppError.notFound("Report not found", "REPORT_NOT_FOUND");
  return prisma.storeReport.update({ where: { id }, data: { status, adminNotes: adminNotes?.trim() || undefined, resolvedAt: ["RESOLVED","DISMISSED"].includes(status) ? new Date() : null, resolvedById: ["RESOLVED","DISMISSED"].includes(status) ? adminId : null } });
}
