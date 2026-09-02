import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";
import { ensureAffiliateTables } from "./affiliates.service";

export async function convertOrder(userId: string, orderNumber: string, code: string) {
  await ensureAffiliateTables();
  const order = await prisma.order.findUnique({ where: { orderNumber } });
  if (!order || order.customerId !== userId) throw AppError.notFound("Order not found");
  if (order.paymentStatus !== "PAID") return { converted: false };

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; user_id: string; commission_rate: string }>>(
    `SELECT id, user_id, commission_rate::text FROM affiliates WHERE code = $1 AND status = 'ACTIVE' LIMIT 1`,
    code.trim().toUpperCase()
  );
  const affiliate = rows[0];
  if (!affiliate || affiliate.user_id === userId) return { converted: false };

  const recentClick = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM affiliate_clicks WHERE affiliate_id = $1 AND created_at >= NOW() - INTERVAL '30 days' ORDER BY created_at DESC LIMIT 1`,
    affiliate.id
  );
  if (!recentClick[0]) return { converted: false };

  const rate = Number(affiliate.commission_rate);
  const amount = Math.round(Number(order.totalAmount) * rate) / 100;

  return prisma.$transaction(async (tx) => {
    const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO affiliate_commissions (id, affiliate_id, order_id, order_amount, amount, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING') ON CONFLICT (order_id) DO NOTHING RETURNING id`,
      randomBytes(16).toString("hex"), affiliate.id, order.id, Number(order.totalAmount), amount
    );
    if (!inserted[0]) return { converted: true, alreadyRecorded: true };

    await tx.$executeRawUnsafe(
      `INSERT INTO affiliate_attributions (id, affiliate_id, order_id, commission_rate)
       VALUES ($1, $2, $3, $4) ON CONFLICT (order_id) DO NOTHING`,
      randomBytes(16).toString("hex"), affiliate.id, order.id, rate
    );
    await tx.$executeRawUnsafe(
      `UPDATE affiliates SET conversions = conversions + 1, pending_earnings = pending_earnings + $2, updated_at = NOW() WHERE id = $1`,
      affiliate.id, amount
    );
    return { converted: true, alreadyRecorded: false };
  });
}
