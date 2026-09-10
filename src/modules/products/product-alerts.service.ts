import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

export async function getWaitlistCount(productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, comingSoon: true } });
  if (!product) throw AppError.notFound("Product not found");
  if (!product.comingSoon) return { productId, count: 0, open: false };
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `SELECT COUNT(*)::bigint AS count FROM product_alerts WHERE product_id=$1 AND type='WAITLIST'`,
    productId,
  );
  return { productId, count: Number(rows[0]?.count ?? 0), open: true };
}

export async function joinWaitlist(productId: string, input: { email?: string; whatsapp?: string }, userId?: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, comingSoon: true } });
  if (!product) throw AppError.notFound("Product not found");
  if (!product.comingSoon) throw AppError.badRequest("This product is no longer on the Coming Soon waitlist");
  if (!input.email && !input.whatsapp) throw AppError.badRequest("Provide an email or WhatsApp number");

  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM product_alerts WHERE product_id=$1 AND type='WAITLIST' AND COALESCE(email,'')=COALESCE($2,'') AND COALESCE(whatsapp,'')=COALESCE($3,'') LIMIT 1`,
    productId,
    input.email ?? null,
    input.whatsapp ?? null,
  );
  if (existing[0]) return { ok: true, id: existing[0].id, alreadySubscribed: true, ...(await getWaitlistCount(productId)) };

  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO product_alerts (id, product_id, user_id, email, whatsapp, type) VALUES ($1,$2,$3,$4,$5,'WAITLIST')`,
    id,
    productId,
    userId ?? null,
    input.email ?? null,
    input.whatsapp ?? null,
  );
  return { ok: true, id, alreadySubscribed: false, ...(await getWaitlistCount(productId)) };
}

export async function createAlert(productId: string, input: { type: "BACK_IN_STOCK" | "PRICE_DROP"; email?: string; whatsapp?: string; targetPrice?: number }, userId?: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, stock: true } });
  if (!product) throw AppError.notFound("Product not found");
  if (!input.email && !input.whatsapp) throw AppError.badRequest("Provide an email or WhatsApp number");
  if (input.type === "PRICE_DROP" && (input.targetPrice == null || input.targetPrice <= 0)) throw AppError.badRequest("A target price is required for a price-drop alert");
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM product_alerts WHERE product_id=$1 AND type=$2 AND COALESCE(email,'')=COALESCE($3,'') AND COALESCE(whatsapp,'')=COALESCE($4,'') LIMIT 1`, productId, input.type, input.email ?? null, input.whatsapp ?? null);
  if (existing[0]) return { ok: true, id: existing[0].id, alreadySubscribed: true };
  const id = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO product_alerts (id, product_id, user_id, email, whatsapp, type, target_price) VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, productId, userId ?? null, input.email ?? null, input.whatsapp ?? null, input.type, input.targetPrice ?? null);
  return { ok: true, id, alreadySubscribed: false };
}

export async function removeAlert(id: string, userId?: string) {
  const result = await prisma.$executeRawUnsafe(`DELETE FROM product_alerts WHERE id=$1 AND ($2::text IS NULL OR user_id=$2)`, id, userId ?? null);
  if (!result) throw AppError.notFound("Alert not found");
  return { ok: true };
}
