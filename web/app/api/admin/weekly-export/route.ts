import { NextResponse } from "next/server";

import { isCurrentUserAdmin, logAdminAccess } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getOptionalSession } from "@/lib/session";
import {
  aggregateWeeklyUsage,
  buildCsv,
  resolveIsoWeek,
} from "@/lib/usage/weekly-export";
import { checkAndRecord } from "@/lib/usage/weekly-export-rate-limit";

const DEFAULT_TIMEZONE = "UTC";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function fetchUsers() {
  return prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      usagePreference: { select: { timezone: true } },
    },
    orderBy: { username: "asc" },
  });
}

function fetchBuckets(from: Date, to: Date) {
  return prisma.usageBucket.findMany({
    where: { bucketStart: { gte: from, lt: to } },
    select: {
      userId: true,
      inputTokens: true,
      outputTokens: true,
      reasoningTokens: true,
      cachedTokens: true,
      totalTokens: true,
      estimatedCostUsd: true,
      bucketStart: true,
    },
  });
}

function fetchSessions(from: Date, to: Date) {
  return prisma.usageSession.findMany({
    where: { firstMessageAt: { gte: from, lt: to } },
    select: {
      userId: true,
      firstMessageAt: true,
      lastMessageAt: true,
    },
  });
}

export async function GET(_request: Request) {
  const session = await getOptionalSession();
  if (!session) {
    return jsonError("UNAUTHORIZED", 401);
  }

  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    return jsonError("NOT_FOUND", 404);
  }

  if (!checkAndRecord(session.user.id)) {
    return jsonError("RATE_LIMITED", 429);
  }

  const week = resolveIsoWeek(new Date(), DEFAULT_TIMEZONE);

  let users: Awaited<ReturnType<typeof fetchUsers>>;
  let buckets: Awaited<ReturnType<typeof fetchBuckets>>;
  let sessions: Awaited<ReturnType<typeof fetchSessions>>;
  try {
    [users, buckets, sessions] = await Promise.all([
      fetchUsers(),
      fetchBuckets(week.from, week.to),
      fetchSessions(week.from, week.to),
    ]);
  } catch (err) {
    console.error("[admin/weekly-export] DB error", err);
    return jsonError("INTERNAL", 500);
  }

  const rows = aggregateWeeklyUsage({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      timezone: u.usagePreference?.timezone ?? DEFAULT_TIMEZONE,
    })),
    buckets: buckets.map((b) => ({
      userId: b.userId,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      reasoningTokens: b.reasoningTokens,
      cachedTokens: b.cachedTokens,
      totalTokens: b.totalTokens,
      estimatedCostUsd: b.estimatedCostUsd,
      bucketStart: b.bucketStart,
    })),
    sessions: sessions.map((s) => ({
      userId: s.userId,
      firstMessageAt: s.firstMessageAt,
      lastMessageAt: s.lastMessageAt,
    })),
  });

  const csv = buildCsv(rows);
  const filename = `tokenarena-weekly-${week.label}.csv`;

  logAdminAccess({
    viewerId: session.user.id,
    targetUserId: session.user.id,
    action: "weekly_export",
  }).catch((err) =>
    console.error("[admin/weekly-export] logAdminAccess failed", err),
  );

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
