/**
 * GET /api/health
 *
 * Two jobs, both tied to running this app on free infrastructure:
 *
 * 1. Keepalive. Supabase pauses a free project after 7 days with no database
 *    activity, and un-pausing is a manual click in their dashboard — so a
 *    quiet week means unattended downtime. One query a day resets that clock.
 *    Deliberately NOT the same endpoint the uptime pinger hits every few
 *    minutes to keep the Render instance warm: that one must stay on `/`,
 *    which is static and touches nothing.
 *
 * 2. Retention. Free Postgres tiers cap at 0.5–1 GB and the message log
 *    tables grow without bound, so something has to prune them. There are no
 *    cron jobs on Render's free tier, which makes this daily ping the only
 *    scheduler available.
 *
 * Point a daily cron (cron-job.org, BetterStack) at this URL.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Module-level, so it resets whenever the instance restarts or wakes from a
// spin-down. That only costs an extra pruning pass on a mostly-empty range,
// which is cheaper than persisting a schedule just to avoid it.
let lastPrunedAt = 0;

function retentionDays(): number {
  const configured = Number(process.env.LOG_RETENTION_DAYS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS;
}

interface PruneResult {
  messageLogs: number;
  phoneMessageLogs: number;
}

async function pruneOldLogs(days: number): Promise<PruneResult> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [messageLogs, phoneMessageLogs] = await Promise.all([
    prisma.messageLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.phoneMessageLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);

  return { messageLogs: messageLogs.count, phoneMessageLogs: phoneMessageLogs.count };
}

export async function GET(): Promise<NextResponse> {
  const days = retentionDays();

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error("[Health] Database check failed:", error);
    return NextResponse.json({ ok: false, database: "down" }, { status: 503 });
  }

  let pruned: PruneResult | undefined;
  if (Date.now() - lastPrunedAt >= PRUNE_INTERVAL_MS) {
    try {
      pruned = await pruneOldLogs(days);
      lastPrunedAt = Date.now();
      if (pruned.messageLogs > 0 || pruned.phoneMessageLogs > 0) {
        console.log(
          `[Health] Pruned ${pruned.messageLogs} message logs and ` +
            `${pruned.phoneMessageLogs} phone message logs older than ${days} days.`,
        );
      }
    } catch (error) {
      // Pruning is housekeeping — a failure here must not make the health
      // check itself report unhealthy and trip an alert.
      console.error("[Health] Log pruning failed (continuing):", error);
    }
  }

  return NextResponse.json({
    ok: true,
    database: "up",
    retentionDays: days,
    ...(pruned ? { pruned } : {}),
  });
}
