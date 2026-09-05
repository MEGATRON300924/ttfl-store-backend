import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { generateOpaqueToken, hashOpaqueToken } from "@/lib/tokens";
import { sendEmail, vendorStaffInvitationEmail } from "@/lib/email";
import { AppError } from "@/utils/app-error";
import { recordAudit } from "@/lib/audit";
import { STAFF_ROLE_PERMISSIONS, type VendorStaffRole, requireVendorOwner } from "@/lib/vendor-access";
import { env } from "@/config/env";
import { hashPassword } from "@/lib/password";

const ROLES: VendorStaffRole[] = ["MANAGER", "ORDERS", "PRODUCTS", "SUPPORT", "FINANCE"];
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRole(role: string): VendorStaffRole {
  if (!ROLES.includes(role as VendorStaffRole)) throw AppError.badRequest("Invalid staff role");
  return role as VendorStaffRole;
}

function permissionsForRole(role: VendorStaffRole) {
  return STAFF_ROLE_PERMISSIONS[role];
}

function publicStaff(staff: any) {
  return {
    id: staff.id,
    email: staff.user?.email ?? staff.email,
    firstName: staff.user?.firstName ?? "",
    lastName: staff.user?.lastName ?? "",
    avatarUrl: staff.user?.avatarUrl ?? null,
    role: staff.role,
    permissions: staff.permissions,
    active: staff.active,
    invitedAt: staff.invitedAt,
    acceptedAt: staff.acceptedAt,
    createdAt: staff.createdAt,
  };
}

export async function listStaff(ownerId: string) {
  const membership = await requireVendorOwner(ownerId);
  const rows = await prisma.vendorStaff.findMany({ where: { vendorId: membership.vendorId }, orderBy: { createdAt: "desc" } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((row) => row.userId) } }, select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } });
  const userMap = new Map(users.map((user) => [user.id, user]));
  return rows.map((row) => publicStaff({ ...row, user: userMap.get(row.userId) }));
}

export async function inviteStaff(ownerId: string, input: { email: string; role: string }) {
  const membership = await requireVendorOwner(ownerId);
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw AppError.badRequest("Enter a valid email address");
  const role = validateRole(input.role);
  const permissions = permissionsForRole(role);
  const vendor = await prisma.vendorProfile.findUnique({ where: { id: membership.vendorId }, select: { storeName: true } });
  if (!vendor) throw AppError.notFound("Vendor profile not found");

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    const existingStaff = await prisma.vendorStaff.findUnique({ where: { vendorId_userId: { vendorId: membership.vendorId, userId: existingUser.id } } });
    if (existingStaff?.active) throw AppError.conflict("This user is already a member of your store");
  }

  await prisma.vendorStaffInvitation.updateMany({ where: { vendorId: membership.vendorId, email, acceptedAt: null }, data: { expiresAt: new Date() } });
  const { raw, hash } = generateOpaqueToken();
  const invitation = await prisma.vendorStaffInvitation.create({ data: { id: randomUUID(), vendorId: membership.vendorId, email, role, permissions, tokenHash: hash, expiresAt: new Date(Date.now() + INVITE_TTL_MS), invitedBy: ownerId } });
  const inviteUrl = `${env.appUrl}/vendor/invite/${raw}`;
  void sendEmail({ to: email, ...vendorStaffInvitationEmail(vendor.storeName, role, inviteUrl) });
  await recordAudit({ actorId: ownerId, action: "VENDOR_STAFF_INVITED", targetType: "VendorStaffInvitation", targetId: invitation.id, metadata: { email, role, vendorId: membership.vendorId } });
  return { id: invitation.id, email, role, permissions, expiresAt: invitation.expiresAt };
}

export async function updateStaff(ownerId: string, staffId: string, input: { role?: string; active?: boolean }) {
  const membership = await requireVendorOwner(ownerId);
  const staff = await prisma.vendorStaff.findFirst({ where: { id: staffId, vendorId: membership.vendorId } });
  if (!staff) throw AppError.notFound("Staff member not found");
  const role = input.role ? validateRole(input.role) : (staff.role as VendorStaffRole);
  const updated = await prisma.vendorStaff.update({ where: { id: staff.id }, data: { role, permissions: permissionsForRole(role), ...(input.active === undefined ? {} : { active: input.active }) } });
  await recordAudit({ actorId: ownerId, action: "VENDOR_STAFF_UPDATED", targetType: "VendorStaff", targetId: staff.id, metadata: { role, active: updated.active } });
  return updated;
}

export async function removeStaff(ownerId: string, staffId: string) {
  const membership = await requireVendorOwner(ownerId);
  const staff = await prisma.vendorStaff.findFirst({ where: { id: staffId, vendorId: membership.vendorId } });
  if (!staff) throw AppError.notFound("Staff member not found");
  await prisma.vendorStaff.delete({ where: { id: staff.id } });
  await recordAudit({ actorId: ownerId, action: "VENDOR_STAFF_REMOVED", targetType: "VendorStaff", targetId: staff.id, metadata: { userId: staff.userId } });
}

export async function getInvitation(rawToken: string) {
  const invitation = await prisma.vendorStaffInvitation.findUnique({ where: { tokenHash: hashOpaqueToken(rawToken) } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) throw AppError.notFound("This invitation is invalid or has expired");
  const vendor = await prisma.vendorProfile.findUnique({ where: { id: invitation.vendorId }, select: { storeName: true, logoUrl: true } });
  if (!vendor) throw AppError.notFound("Store not found");
  return { id: invitation.id, email: invitation.email, role: invitation.role, permissions: invitation.permissions, expiresAt: invitation.expiresAt, storeName: vendor.storeName, logoUrl: vendor.logoUrl };
}

export async function acceptInvitation(rawToken: string, input: { firstName?: string; lastName?: string; password?: string }, userId?: string) {
  const invitation = await prisma.vendorStaffInvitation.findUnique({ where: { tokenHash: hashOpaqueToken(rawToken) } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) throw AppError.badRequest("This invitation is invalid or has expired");

  let user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  if (user && user.email.toLowerCase() !== invitation.email.toLowerCase()) throw AppError.forbidden("Sign in with the invited email address");
  if (!user) {
    if (!input.firstName?.trim() || !input.lastName?.trim() || !input.password) throw AppError.badRequest("First name, last name, and password are required to create your account");
    const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
    if (existing) throw AppError.conflict("An account with this email already exists. Sign in and accept the invitation again.");
    user = await prisma.user.create({ data: { email: invitation.email, passwordHash: await hashPassword(input.password), role: "CUSTOMER", firstName: input.firstName.trim(), lastName: input.lastName.trim(), emailVerified: true } });
  }

  const existingMembership = await prisma.vendorStaff.findUnique({ where: { vendorId_userId: { vendorId: invitation.vendorId, userId: user.id } } });
  const staff = existingMembership
    ? await prisma.vendorStaff.update({ where: { id: existingMembership.id }, data: { role: invitation.role, permissions: invitation.permissions, active: true, acceptedAt: new Date() } })
    : await prisma.vendorStaff.create({ data: { id: randomUUID(), vendorId: invitation.vendorId, userId: user.id, role: invitation.role, permissions: invitation.permissions, active: true, acceptedAt: new Date(), invitedAt: invitation.createdAt } });
  await prisma.vendorStaffInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
  await recordAudit({ actorId: user.id, action: "VENDOR_STAFF_ACCEPTED", targetType: "VendorStaff", targetId: staff.id, metadata: { vendorId: invitation.vendorId, role: invitation.role } });
  return { user: { id: user.id, email: user.email, role: user.role, status: user.status, firstName: user.firstName, lastName: user.lastName, phone: user.phone, avatarUrl: user.avatarUrl, emailVerified: user.emailVerified }, staff };
}
