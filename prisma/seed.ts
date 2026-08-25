/**
 * Bootstraps the first admin account. Run once after migrating:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=SomeStrongPass1 npx tsx prisma/seed.ts
 */
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD env vars before seeding.");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists — skipping.`);
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "ADMIN",
      firstName: "TTFL",
      lastName: "Admin",
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  console.log(`Admin account created: ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
