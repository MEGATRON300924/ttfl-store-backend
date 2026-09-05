import { prisma } from "@/lib/prisma";

export async function getCurrentUserWithVendorStaff(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { vendorProfile: true } });
  if (!user) return null;
  if (user.vendorProfile) return user;
  const staff = await prisma.vendorStaff.findFirst({ where: { userId, active: true }, select: { vendorId: true, role: true, permissions: true } });
  if (!staff) return user;
  const vendorProfile = await prisma.vendorProfile.findUnique({ where: { id: staff.vendorId } });
  return { ...user, role: "VENDOR" as const, vendorProfile, vendorStaff: { role: staff.role, permissions: staff.permissions } };
}
