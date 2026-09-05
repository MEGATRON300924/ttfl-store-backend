import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export type VendorStaffRole = "MANAGER" | "ORDERS" | "PRODUCTS" | "SUPPORT" | "FINANCE";
export type VendorPermission = "MANAGER" | "ORDERS" | "PRODUCTS" | "SUPPORT" | "FINANCE";

export const STAFF_ROLE_PERMISSIONS: Record<VendorStaffRole, VendorPermission[]> = {
  MANAGER: ["MANAGER", "ORDERS", "PRODUCTS", "SUPPORT", "FINANCE"],
  ORDERS: ["ORDERS"],
  PRODUCTS: ["PRODUCTS"],
  SUPPORT: ["SUPPORT"],
  FINANCE: ["FINANCE"],
};

export async function getVendorProfileForUser(userId: string) {
  const owner = await prisma.vendorProfile.findUnique({ where: { userId } });
  if (owner) return owner;

  const staff = await prisma.vendorStaff.findFirst({
    where: { userId, active: true },
    select: { vendorId: true },
  });
  if (!staff) throw AppError.notFound("Vendor profile not found");

  const vendor = await prisma.vendorProfile.findUnique({ where: { id: staff.vendorId } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");
  return vendor;
}

export async function getVendorMembership(userId: string) {
  const owner = await prisma.vendorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (owner) {
    return { vendorId: owner.id, isOwner: true, role: "OWNER" as const, permissions: STAFF_ROLE_PERMISSIONS.MANAGER };
  }

  const staff = await prisma.vendorStaff.findFirst({
    where: { userId, active: true },
    select: { id: true, vendorId: true, role: true, permissions: true },
  });
  if (!staff) return null;

  const permissions = Array.isArray(staff.permissions)
    ? staff.permissions.filter((value): value is VendorPermission => typeof value === "string")
    : STAFF_ROLE_PERMISSIONS[staff.role as VendorStaffRole] ?? [];

  return { ...staff, isOwner: false, permissions };
}

export function hasVendorPermission(membership: { isOwner: boolean; permissions: VendorPermission[] }, permission: VendorPermission) {
  return membership.isOwner || membership.permissions.includes(permission);
}

export async function requireVendorMembership(userId: string, permission?: VendorPermission) {
  const membership = await getVendorMembership(userId);
  if (!membership) throw AppError.forbidden("You are not a member of a vendor store");
  if (permission && !hasVendorPermission(membership, permission)) {
    throw AppError.forbidden("You do not have permission to perform this action");
  }
  return membership;
}

export async function requireVendorOwner(userId: string) {
  const membership = await getVendorMembership(userId);
  if (!membership?.isOwner) throw AppError.forbidden("Only the store owner can perform this action");
  return membership;
}
