import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/app-error";

const DEFAULT_RATE = 5;

export async function ensureAffiliateTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS affiliates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      commission_rate NUMERIC(5,2) NOT NULL DEFAULT 5,
      clicks INTEGER NOT NULL DEFAULT 0,
      conversions INTEGER NOT NULL DEFAULT 0,
      pending_earnings NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_earnings NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS affiliate_clicks (
      id TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      session_id TEXT,
      landing_path TEXT,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS affiliate_clicks_affiliate_idx ON affiliate_clicks(affiliate_id);
    CREATE INDEX IF NOT EXISTS affiliate_clicks_created_idx ON affiliate_clicks(created_at);
    CREATE TABLE IF NOT EXISTS affiliate_attributions (
      id TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      commission_rate NUMERIC(5,2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS affiliate_attributions_affiliate_idx ON affiliate_attributions(affiliate_id);
    CREATE TABLE IF NOT EXISTS affiliate_commissions (
      id TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      order_amount NUMERIC(12,2) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS affiliate_commissions_affiliate_idx ON affiliate_commissions(affiliate_id);
    CREATE INDEX IF NOT EXISTS affiliate_commissions_status_idx ON affiliate_commissions(status);
  `);
}

function makeCode(firstName: string, lastName: string) {
  const base = `${firstName}${lastName}`.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10) || "TTFL";
  return `${base}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function getProgram() {
  await ensureAffiliateTables();
  return { commissionRate: DEFAULT_RATE, cookieDays: 30, minimumPayout: 10000 };
}

export async function join(userId: string) {
  await ensureAffiliateTables();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.notFound("User not found");
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string; code: string; status: string; commission_rate: string }>>(
    `SELECT id, code, status, commission_rate::text FROM affiliates WHERE user_id = $1 LIMIT 1`, userId
  );
  if (existing[0]) return existing[0];
  let code = makeCode(user.firstName, user.lastName);
  for (;;) {
    const found = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM affiliates WHERE code = $1 LIMIT 1`, code);
    if (!found[0]) break;
    code = makeCode(user.firstName, user.lastName);
  }
  const id = randomBytes(16).toString("hex");
  await prisma.$executeRawUnsafe(
    `INSERT INTO affiliates (id, user_id, code, commission_rate) VALUES ($1, $2, $3, $4)`,
    id, userId, code, DEFAULT_RATE
  );
  return { id, code, status: "ACTIVE", commission_rate: String(DEFAULT_RATE) };
}

export async function getDashboard(userId: string) {
  await ensureAffiliateTables();
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; code: string; status: string; commission_rate: string; clicks: number; conversions: number;
    pending_earnings: string; paid_earnings: string; created_at: Date;
  }>>(
    `SELECT id, code, status, commission_rate::text, clicks, conversions, pending_earnings::text, paid_earnings::text, created_at
     FROM affiliates WHERE user_id = $1 LIMIT 1`, userId
  );
  const affiliate = rows[0];
  if (!affiliate) return null;
  const commissions = await prisma.$queryRawUnsafe<Array<{
    id: string; order_id: string; order_number: string; order_amount: string; amount: string;
    status: string; created_at: Date; paid_at: Date | null;
  }>>(
    `SELECT c.id, c.order_id, o.order_number, c.order_amount::text, c.amount::text, c.status, c.created_at, c.paid_at
     FROM affiliate_commissions c JOIN orders o ON o.id = c.order_id
     WHERE c.affiliate_id = $1 ORDER BY c.created_at DESC LIMIT 50`, affiliate.id
  );
  return {
    affiliate: {
      id: affiliate.id, code: affiliate.code, status: affiliate.status,
      commissionRate: Number(affiliate.commission_rate), clicks: affiliate.clicks, conversions: affiliate.conversions,
      pendingEarnings: Number(affiliate.pending_earnings), paidEarnings: Number(affiliate.paid_earnings), createdAt: affiliate.created_at,
    },
    commissions: commissions.map((c) => ({
      id: c.id, orderId: c.order_id, orderNumber: c.order_number, orderAmount: Number(c.order_amount),
      amount: Number(c.amount), status: c.status, createdAt: c.created_at, paidAt: c.paid_at,
    })),
  };
}

export async function recordClick(code: string, input: { sessionId?: string; landingPath?: string; source?: string }) {
  await ensureAffiliateTables();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM affiliates WHERE code = $1 AND status = 'ACTIVE' LIMIT 1`, code.trim().toUpperCase()
  );
  if (!rows[0]) return { tracked: false };
  const id = randomBytes(16).toString("hex");
  await prisma.$executeRawUnsafe(
    `INSERT INTO affiliate_clicks (id, affiliate_id, session_id, landing_path, source) VALUES ($1, $2, $3, $4, $5)`,
    id, rows[0].id, input.sessionId ?? null, input.landingPath ?? null, input.source ?? null
  );
  await prisma.$executeRawUnsafe(`UPDATE affiliates SET clicks = clicks + 1, updated_at = NOW() WHERE id = $1`, rows[0].id);
  return { tracked: true };
}

export async function resolveAttribution(code: string | undefined, customerId: string) {
  if (!code) return null;
  await ensureAffiliateTables();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; user_id: string; commission_rate: string }>>(
    `SELECT id, user_id, commission_rate::text FROM affiliates WHERE code = $1 AND status = 'ACTIVE' LIMIT 1`,
    code.trim().toUpperCase()
  );
  if (!rows[0] || rows[0].user_id === customerId) return null;
  return { id: rows[0].id, commissionRate: Number(rows[0].commission_rate) };
}

export async function attachOrder(orderId: string, affiliateId: string, commissionRate: number) {
  await ensureAffiliateTables();
  await prisma.$executeRawUnsafe(
    `INSERT INTO affiliate_attributions (id, affiliate_id, order_id, commission_rate) VALUES ($1, $2, $3, $4) ON CONFLICT (order_id) DO NOTHING`,
    randomBytes(16).toString("hex"), affiliateId, orderId, commissionRate
  );
}

export async function recordPaidOrder(tx: any, orderId: string, orderAmount: number) {
  const attribution = await tx.$queryRawUnsafe<Array<{ affiliate_id: string; commission_rate: string }>>(
    `SELECT affiliate_id, commission_rate::text FROM affiliate_attributions WHERE order_id = $1 LIMIT 1`, orderId
  );
  if (!attribution[0]) return;
  const rate = Number(attribution[0].commission_rate);
  const amount = Math.round(orderAmount * rate) / 100;
  await tx.$queryRawUnsafe(
    `WITH inserted AS (
       INSERT INTO affiliate_commissions (id, affiliate_id, order_id, order_amount, amount, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING') ON CONFLICT (order_id) DO NOTHING
       RETURNING affiliate_id, amount
     )
     UPDATE affiliates a SET conversions = conversions + 1,
       pending_earnings = pending_earnings + inserted.amount, updated_at = NOW()
     FROM inserted WHERE a.id = inserted.affiliate_id`,
    randomBytes(16).toString("hex"), attribution[0].affiliate_id, orderId, orderAmount, amount
  );
}
