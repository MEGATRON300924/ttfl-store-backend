const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "variationConfig" JSONB`);
    const existing = await prisma.category.findUnique({ where: { slug: "sound" } });
    if (!existing) {
      const category = await prisma.category.create({ data: { name: "Sound", slug: "sound", icon: "Volume2" } });
      await prisma.$executeRawUnsafe('UPDATE "categories" SET "variationConfig" = $1::jsonb WHERE "id" = $2', JSON.stringify({ enabled: false, variations: [] }), category.id);
      console.log("Sound category created.");
    } else {
      console.log("Sound category already exists.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Sound category check failed:", error);
  process.exitCode = 1;
});
