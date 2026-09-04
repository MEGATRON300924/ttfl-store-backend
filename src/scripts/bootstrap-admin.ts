import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { adminAccessGrantedEmail, sendEmail } from "@/lib/email";

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
      firstName: true,
      lastName: true,
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

  const adminUrl = `${env.appUrl.replace(/\/$/, "")}/admin`;
  const email = adminAccessGrantedEmail(
    [user.firstName, user.lastName].filter(Boolean).join(" "),
    user.email,
    adminUrl
  );

  try {
    await sendEmail({
      to: user.email,
      subject: email.subject,
      html: email.html,
      event: email.event,
    });
    console.log(`Admin access notification queued for ${user.email}.`);
  } catch (error) {
    console.error("Failed to queue admin access notification:", error);
  }

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
