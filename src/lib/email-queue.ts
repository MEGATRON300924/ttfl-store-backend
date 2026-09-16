import { prisma } from "@/lib/prisma";
import { deliverEmail } from "@/lib/email-adapter";
import { logger } from "@/lib/logger";

const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000];
const STALE_CLAIM_MS = 2 * 60 * 1000;

let workerStarted = false;
const retryTimers = new Set<string>();

export async function enqueueEmail(params: { to: string; subject: string; html: string; event: string }) {
  try {
    const log = await prisma.emailLog.create({
      data: { to: params.to, subject: params.subject, body: params.html, event: params.event, status: "PENDING" },
    });
    void attemptDelivery(log.id);
    return log;
  } catch (err) {
    logger.error("Failed to enqueue email — will not be sent", {
      to: params.to,
      event: params.event,
      error: err instanceof Error ? err.message : err,
    });
    return null;
  }
}

/**
 * Claiming is an atomic update. A recent RETRYING row is only claimable by
 * the in-process retry timer that owns it; other instances must wait for
 * the stale-claim window. This prevents concurrent workers from sending the
 * same email while still preserving the existing short retry backoff.
 */
async function claimEmail(emailLogId: string, allowRecentRetry = false) {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  const retryCondition = allowRecentRetry
    ? { status: "RETRYING" as const }
    : { status: "RETRYING" as const, updatedAt: { lt: staleBefore } };
  const claimed = await prisma.emailLog.updateMany({
    where: {
      id: emailLogId,
      OR: [
        { status: "PENDING" },
        retryCondition,
      ],
    },
    data: { status: "RETRYING", attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return null;
  return prisma.emailLog.findUnique({ where: { id: emailLogId } });
}

async function attemptDelivery(emailLogId: string, allowRecentRetry = false) {
  try {
    const log = await claimEmail(emailLogId, allowRecentRetry);
    if (!log) return;

    const result = await deliverEmail({ to: log.to, subject: log.subject, html: log.body });

    if (result.ok) {
      await prisma.emailLog.update({
        where: { id: emailLogId },
        data: { status: "SENT", sentAt: new Date(), lastError: null },
      });
      return;
    }

    if (log.attempts >= MAX_ATTEMPTS) {
      await prisma.emailLog.update({
        where: { id: emailLogId },
        data: { status: "FAILED", lastError: result.error },
      });
      logger.error(`Email ${emailLogId} permanently failed after ${log.attempts} attempts: ${result.error}`);
      return;
    }

    await prisma.emailLog.update({
      where: { id: emailLogId },
      data: { status: "RETRYING", lastError: result.error },
    });
    scheduleRetry(emailLogId, log.attempts);
  } catch (err) {
    logger.error(`Email ${emailLogId} delivery attempt threw unexpectedly`, {
      error: err instanceof Error ? err.message : err,
    });
    scheduleRetry(emailLogId, 1);
  }
}

function scheduleRetry(emailLogId: string, attempts: number) {
  if (retryTimers.has(emailLogId)) return;
  retryTimers.add(emailLogId);
  const delay = RETRY_BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), RETRY_BACKOFF_MS.length - 1)];
  setTimeout(() => {
    retryTimers.delete(emailLogId);
    void attemptDelivery(emailLogId, true);
  }, delay);
}

async function sweepStuckEmails() {
  try {
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
    const stuck = await prisma.emailLog.findMany({
      where: {
        OR: [
          { status: "PENDING" },
          { status: "RETRYING", updatedAt: { lt: staleBefore } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true },
    });
    for (const log of stuck) {
      if (!retryTimers.has(log.id)) {
        // eslint-disable-next-line no-await-in-loop
        await attemptDelivery(log.id);
      }
    }
  } catch (err) {
    logger.error("Email queue sweep failed — will retry on the next interval", {
      error: err instanceof Error ? err.message : err,
    });
  }
}

export function startEmailWorker() {
  if (workerStarted) return;
  workerStarted = true;
  setTimeout(() => void sweepStuckEmails(), 10_000);
  setInterval(() => void sweepStuckEmails(), 60_000);
}
