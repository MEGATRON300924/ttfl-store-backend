const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function createProductId() {
  return `TTFL-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
}

async function backfillProductIds() {
  const products = await prisma.product.findMany({
    where: { publicProductId: null },
    select: { id: true },
  });

  if (products.length === 0) {
    console.log("Product ID backfill: all products already have TTFL Product IDs.");
    return;
  }

  let updated = 0;

  for (const product of products) {
    let productId = createProductId();

    while (await prisma.product.findUnique({ where: { publicProductId: productId } })) {
      productId = createProductId();
    }

    await prisma.product.update({
      where: { id: product.id },
      data: { publicProductId: productId },
    });

    updated += 1;
    console.log(`Assigned ${productId} to product ${product.id}.`);
  }

  console.log(`Product ID backfill complete: ${updated} product(s) updated.`);
}

backfillProductIds()
  .catch((error) => {
    console.error("Product ID backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
