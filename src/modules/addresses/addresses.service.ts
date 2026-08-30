import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export async function listAddresses(userId: string) {
  return prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

export async function createAddress(
  userId: string,
  input: {
    label: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    country?: string;
    isDefault?: boolean;
  }
) {
  if (input.isDefault) {
    await prisma.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
  }

  return prisma.address.create({
    data: { userId, ...input },
  });
}

async function assertOwnsAddress(userId: string, addressId: string) {
  const address = await prisma.address.findUnique({ where: { id: addressId } });
  if (!address || address.userId !== userId) {
    throw AppError.notFound("Address not found");
  }
  return address;
}

export async function updateAddress(
  userId: string,
  addressId: string,
  input: Partial<{
    label: string;
    line1: string;
    line2: string;
    city: string;
    state: string;
    country: string;
    isDefault: boolean;
  }>
) {
  await assertOwnsAddress(userId, addressId);

  if (input.isDefault) {
    await prisma.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
  }

  return prisma.address.update({ where: { id: addressId }, data: input });
}

export async function deleteAddress(userId: string, addressId: string) {
  await assertOwnsAddress(userId, addressId);
  await prisma.address.delete({ where: { id: addressId } });
}
