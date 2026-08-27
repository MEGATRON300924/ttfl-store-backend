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
 *
 * CRASH SAFETY: every exported/scheduled function here is called
 * fire-and-forget (`void sendEmail(...)`, `void sweepStuckEmails()`, a
 * bare `setTimeout`) from all over the app — registration, checkout,
 * vendor approval, payouts, everywhere. Because of that, an unhandled
 * rejection ANYWHERE in this file doesn't just fail one email — it
 * crashes the entire Node process, taking the whole API down with it.
 * That's not hypothetical: it's exactly what happened in production when
 * the startup sweep hit a database that was still waking up (a
 * serverless Postgres cold start) and had no try/catch around it — one
 * slow database took the whole backend down, and because it crashed
 * again on every restart, it looked like a permanent outage. Every
 * function below is wrapped so that a database or delivery failure is
 * logged and absorbed here, never allowed to propagate up and kill the
 * server.
 */

const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000]; // 5s, 30s, 2m, 10m, 30m

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
    // Every caller of sendEmail() uses `void sendEmail(...)` — fire and
    // forget. If this throws, there is no one downstream to catch it;
    // it becomes an unhandled rejection and crashes the process. Logging
    // and returning null keeps a database hiccup from ever taking down
    // whatever user action (registration, checkout, etc.) triggered this
    // email in the first place.
    logger.error("Failed to enqueue email — will not be sent", {
      to: params.to,
      event: params.event,
      error: err instanceof Error ? err.message : err,
    });
    return null;
  }
}

async function attemptDelivery(emailLogId: string) {
  try {
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
    scheduleRetry(emailLogId, attempts);
  } catch (err) {
    // Same reasoning as enqueueEmail's catch: this function is always
    // called as `void attemptDelivery(...)`, so an unhandled rejection
    // here crashes the whole server, not just this one email. A
    // transient DB error mid-delivery (e.g. the connection blips between
    // the findUnique and the update) should not do that — log it and let
    // the next scheduled retry pick this email back up instead.
    logger.error(`Email ${emailLogId} delivery attempt threw unexpectedly`, {
      error: err instanceof Error ? err.message : err,
    });
    scheduleRetry(emailLogId, 1); // conservative: retry soon rather than lose the email
  }
}

function scheduleRetry(emailLogId: string, attempts: number) {
  if (retryTimers.has(emailLogId)) return;
  retryTimers.add(emailLogId);
  const delay = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
  setTimeout(() => {
    retryTimers.delete(emailLogId);
    void attemptDelivery(emailLogId);
  }, delay);
}

/**
 * Sweeps any PENDING/RETRYING rows left over from before a restart (their
 * in-memory setTimeout died with the old process, but the row itself is
 * still there with everything needed to resend). Call once at startup and
 * on an interval as a safety net.
 */
async function sweepStuckEmails() {
  try {
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
  } catch (err) {
    // A database hiccup here (a cold-starting serverless Postgres like
    // Neon waking from idle, a brief network blip, a deploy-time restart
    // race) must NEVER take down the whole server — this is a background
    // maintenance sweep, not a request handler. Logging and moving on
    // lets the next scheduled sweep succeed once the database is
    // actually reachable, instead of crashing the entire process over
    // one slow query.
    logger.error("Email queue sweep failed — will retry on the next interval", {
      error: err instanceof Error ? err.message : err,
    });
  }
}

export function startEmailWorker() {
  if (workerStarted) return;
  workerStarted = true;
  // Delay the first sweep instead of firing immediately at boot — gives
  // the database (and Prisma's own connection pool) a few seconds to be
  // fully ready, which matters most for serverless Postgres providers
  // that need a moment to wake from idle. The try/catch inside
  // sweepStuckEmails is the real safety net either way; this delay just
  // avoids the *predictable* first-attempt failure on a cold database.
  setTimeout(() => void sweepStuckEmails(), 10_000);
  setInterval(() => void sweepStuckEmails(), 60_000);
}
