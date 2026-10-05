import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function bootstrapLaunchCoupon() {
  const code = "TTFLSTOREISBACK";
  const existing = await prisma.coupon.findUnique({ where: { code } });

  if (existing) {
    console.log(`Launch coupon already exists: ${code}`);
    return;
  }

  await prisma.coupon.create({
    data: {
      code,
      type: "PERCENTAGE",
      value: 25,
      usageLimitPerUser: 1,
      active: true,
    },
  });

  console.log(`Created launch coupon: ${code} (25% off, once per customer)`);
}

bootstrapLaunchCoupon()
  .catch((error) => {
    console.error("Launch coupon bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
