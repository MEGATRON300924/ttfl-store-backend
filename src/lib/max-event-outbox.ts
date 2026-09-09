import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

export async function queueMaxEvent(event: string, payload: Record<string, unknown>) {
  const jsonPayload = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
  const row = await prisma.maxEventOutbox.create({ data: { id: randomUUID(), event, payload: jsonPayload } });
  void flushMaxEventOutbox();
  return row.id;
}

async function deliver(row: { id: string; event: string; payload: unknown; attempts: number }) {
  if (!env.maxAi.eventWebhookUrl) return false;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.maxAi.eventWebhookSecret) headers.Authorization = `Bearer ${env.maxAi.eventWebhookSecret}`;
    const response = await fetch(env.maxAi.eventWebhookUrl, { method: "POST", headers, body: JSON.stringify({ ...(row.payload as Record<string, unknown>), event: row.event, source: "ttfl-store", emittedAt: new Date().toISOString() }) });
    if (!response.ok) throw new Error(`MAX webhook returned ${response.status}`);
    await prisma.maxEventOutbox.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: null } });
    return true;
  } catch (error) {
    const attempts = row.attempts + 1;
    const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 5));
    await prisma.maxEventOutbox.update({ where: { id: row.id }, data: { status: attempts >= 10 ? "FAILED" : "PENDING", attempts, lastError: error instanceof Error ? error.message : "MAX webhook failed", availableAt: new Date(Date.now() + delayMinutes * 60_000) } });
    logger.error("MAX event delivery failed", { event: row.event, attempts });
    return false;
  }
}

export async function flushMaxEventOutbox(limit = 25) {
  if (!env.maxAi.eventWebhookUrl) return;
  const rows = await prisma.maxEventOutbox.findMany({ where: { status: "PENDING", availableAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: limit });
  for (const row of rows) await deliver(row);
}

export function startMaxEventOutboxWorker() {
  if (!env.maxAi.eventWebhookUrl) return;
  void flushMaxEventOutbox();
  setInterval(() => void flushMaxEventOutbox(), 60_000).unref();
}
