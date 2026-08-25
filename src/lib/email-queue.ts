import { prisma } from "@/lib/prisma";
import { deliverEmail } from "@/lib/email-adapter";
import { logger } from "@/lib/logger";

/**
 * Application Event -> enqueueEmail() -> EmailLog row (PENDING, full HTML
 * stored) -> worker loop -> Adapter -> Provider.
 *
 * This is a real queue with retry and durable logging, but it's IN-PROCESS
 * (an interval loop), not a separate worker backed by Redis/BullMQ. That's
 * a deliberate scope call: a proper job queue needs a Redis instance,
 * which is one more external account this project doesn't have
 * credentials for. This version genuinely survives a process restart
 * (PENDING/RETRYING rows are self-contained — the full HTML is stored, so
 * the next server boot can resend without any in-memory state) but does
 * NOT scale across multiple backend instances without rows getting
 * double-picked-up. Swap this file's internals for BullMQ+Redis when
 * you're running more than one instance.
 */

const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000]; // 5s, 30s, 2m, 10m, 30m

let workerStarted = false;
const retryTimers = new Set<string>();

export async function enqueueEmail(params: { to: string; subject: string; html: string; event: string }) {
  const log = await prisma.emailLog.create({
    data: { to: params.to, subject: params.subject, body: params.html, event: params.event, status: "PENDING" },
  });
  void attemptDelivery(log.id);
  return log;
}

async function attemptDelivery(emailLogId: string) {
  const log = await prisma.emailLog.findUnique({ where: { id: emailLogId } });
  if (!log || log.status === "SENT") return;

  const result = await deliverEmail({ to: log.to, subject: log.subject, html: log.body });
  const attempts = log.attempts + 1;

  if (result.ok) {
    await prisma.emailLog.update({
      where: { id: emailLogId },
      data: { status: "SENT", attempts, sentAt: new Date(), lastError: null },
    });
    return;
  }

  if (attempts >= MAX_ATTEMPTS) {
    await prisma.emailLog.update({
      where: { id: emailLogId },
      data: { status: "FAILED", attempts, lastError: result.error },
    });
    logger.error(`Email ${emailLogId} permanently failed after ${attempts} attempts: ${result.error}`);
    return;
  }

  await prisma.emailLog.update({
    where: { id: emailLogId },
    data: { status: "RETRYING", attempts, lastError: result.error },
  });

  if (!retryTimers.has(emailLogId)) {
    retryTimers.add(emailLogId);
    const delay = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
    setTimeout(() => {
      retryTimers.delete(emailLogId);
      void attemptDelivery(emailLogId);
    }, delay);
  }
}

/**
 * Sweeps any PENDING/RETRYING rows left over from before a restart (their
 * in-memory setTimeout died with the old process, but the row itself is
 * still there with everything needed to resend). Call once at startup and
 * on an interval as a safety net.
 */
async function sweepStuckEmails() {
  const stuck = await prisma.emailLog.findMany({
    where: { status: { in: ["PENDING", "RETRYING"] } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const log of stuck) {
    if (!retryTimers.has(log.id)) {
      // eslint-disable-next-line no-await-in-loop
      await attemptDelivery(log.id);
    }
  }
}

export function startEmailWorker() {
  if (workerStarted) return;
  workerStarted = true;
  void sweepStuckEmails();
  setInterval(() => void sweepStuckEmails(), 60_000);
}
