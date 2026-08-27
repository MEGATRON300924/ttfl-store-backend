import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function bootstrapAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const enabled = process.env.ADMIN_BOOTSTRAP_ENABLED === "true";

  if (!enabled) {
    console.log("Admin bootstrap is disabled.");
    return;
  }

  if (!adminEmail) {
    throw new Error("ADMIN_EMAIL is required when admin bootstrap is enabled.");
  }

  const user = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: {
      id: true,
      email: true,
      role: true,
    },
  });

  if (!user) {
    console.log(
      `Admin bootstrap skipped: no user exists yet for ${adminEmail}.`
    );
    return;
  }

  if (user.role === "ADMIN") {
    console.log(`Admin already configured: ${user.email}`);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      role: "ADMIN",
    },
  });

  console.log(`Successfully promoted ${user.email} to ADMIN.`);
}

bootstrapAdmin()
  .catch((error) => {
    console.error("Admin bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
