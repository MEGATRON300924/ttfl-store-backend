import { prisma } from "@/lib/prisma";

export async function addToWishlist(userId: string, productId: string) {
  return prisma.wishlistItem.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId },
    update: {},
  });
}

export async function removeFromWishlist(userId: string, productId: string) {
  await prisma.wishlistItem.deleteMany({ where: { userId, productId } });
}

export async function getWishlist(userId: string) {
  return prisma.wishlistItem.findMany({
    where: { userId },
    include: {
      product: {
        include: {
          images: { orderBy: { position: "asc" } },
          vendor: { select: { storeName: true, storeSlug: true, verified: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
