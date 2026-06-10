import "server-only";

import { getAchievementArenaSummary } from "@/lib/achievements/queries";
import { prisma } from "@/lib/prisma";
import { getPreviousRange, getZonedWeekdayHour } from "@/lib/usage/date-range";
import { formatDateInput } from "@/lib/usage/format";
import {
  type AdminAnalyticsFixture,
  detectInsights,
} from "@/lib/usage/insights";
import type { DashboardRange } from "@/lib/usage/types";

export type AdminProjectDrilldown = {
  projectKey: string;
  projectLabel: string;
  totalTokens: number;
  sessions: number;
  activeDays: number;
  topModels: Array<{ model: string; totalTokens: number }>;
};

export type AdminAnalytics = AdminAnalyticsFixture & {
  comparison: AdminAnalyticsFixture["comparison"] & {
    vsPlatform: {
      tokens: number;
      cost: number;
      sessions: number;
      activeSeconds: number;
    };
  };
  insights: ReturnType<typeof detectInsights>;
  projectDrilldown: AdminProjectDrilldown[];
  hourHistogram: number[];
  weekdayHistogram: number[];
};

export async function getAdminUsageAnalytics(input: {
  userId: string;
  range: DashboardRange;
  timezone: string;
}): Promise<AdminAnalytics> {
  const prev = getPreviousRange(input.range);

  const [buckets, sessionsPrev, bucketsPrev, platform, devicesCount] =
    await Promise.all([
      prisma.usageBucket.findMany({
        where: {
          userId: input.userId,
          bucketStart: { gte: input.range.from, lte: input.range.to },
        },
        select: {
          bucketStart: true,
          totalTokens: true,
          source: true,
          model: true,
          projectKey: true,
          projectLabel: true,
        },
      }),
      prisma.usageSession.findMany({
        where: {
          userId: input.userId,
          firstMessageAt: { gte: input.range.from, lte: input.range.to },
        },
        select: {
          firstMessageAt: true,
          activeSeconds: true,
          projectKey: true,
          projectLabel: true,
        },
      }),
      prisma.usageBucket.findMany({
        where: {
          userId: input.userId,
          bucketStart: { gte: prev.from, lte: prev.to },
        },
        select: {
          bucketStart: true,
          totalTokens: true,
          model: true,
          projectKey: true,
          projectLabel: true,
        },
      }),
      getAchievementArenaSummary(input.userId),
      prisma.usageDevice.count({ where: { userId: input.userId } }),
    ]);

  // 日均：分母 = 活跃天数
  const activeDays = new Set(
    buckets.map((b) => formatDateInput(b.bucketStart, input.timezone)),
  ).size;
  const totalTokens = buckets.reduce((s, b) => s + Number(b.totalTokens), 0);
  const totalSessions = sessionsPrev.length;
  const totalActiveSeconds = sessionsPrev.reduce(
    (s, x) => s + x.activeSeconds,
    0,
  );
  const totalCost = 0;

  const dailyCosts = aggregateDailyCost(buckets);

  // 习惯
  const hourHistogram = new Array(24).fill(0);
  const weekdayHistogram = new Array(7).fill(0);
  for (const s of sessionsPrev) {
    const p = getZonedWeekdayHour(s.firstMessageAt, input.timezone);
    hourHistogram[p.hour] += 1;
    weekdayHistogram[p.weekday] += 1;
  }
  const { currentStreak, longestStreak } = computeStreaks(
    new Set(buckets.map((b) => formatDateInput(b.bucketStart, input.timezone))),
  );

  // 项目 drilldown
  const byProject = new Map<
    string,
    {
      label: string;
      tokens: number;
      sessions: number;
      days: Set<string>;
      models: Map<string, number>;
    }
  >();
  for (const b of buckets) {
    const entry = byProject.get(b.projectKey) ?? {
      label: b.projectLabel,
      tokens: 0,
      sessions: 0,
      days: new Set(),
      models: new Map(),
    };
    entry.tokens += Number(b.totalTokens);
    entry.days.add(formatDateInput(b.bucketStart, input.timezone));
    entry.models.set(
      b.model,
      (entry.models.get(b.model) ?? 0) + Number(b.totalTokens),
    );
    byProject.set(b.projectKey, entry);
  }
  for (const s of sessionsPrev) {
    if (!s.projectKey) continue;
    const entry = byProject.get(s.projectKey);
    if (entry) entry.sessions += 1;
  }
  const projectDrilldown: AdminProjectDrilldown[] = Array.from(
    byProject.entries(),
  )
    .map(([k, v]) => ({
      projectKey: k,
      projectLabel: v.label,
      totalTokens: v.tokens,
      sessions: v.sessions,
      activeDays: v.days.size,
      topModels: Array.from(v.models.entries())
        .map(([model, totalTokens]) => ({ model, totalTokens }))
        .sort((a, b) => b.totalTokens - a.totalTokens)
        .slice(0, 3),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  // 对比
  const prevTokens = bucketsPrev.reduce((s, b) => s + Number(b.totalTokens), 0);
  const platformTokens = Number(platform.totalTokens);
  const denom = activeDays || 1;
  const fixture: AdminAnalyticsFixture = {
    dailyAverages: {
      activeDays,
      tokens: totalTokens / denom,
      cost: totalCost / denom,
      sessions: totalSessions / denom,
      activeSeconds: totalActiveSeconds / denom,
    },
    habits: { currentStreak, longestStreak, deviceCount: devicesCount },
    comparison: {
      vsPrevPeriod: {
        tokens: prevTokens,
        cost: 0,
        sessions: 0,
        activeSeconds: 0,
      },
    },
    dailyCosts,
    projectShareShift: computeTopProjectShift(buckets, bucketsPrev),
    topModel: mostCommonModel(buckets),
    topModelPrev: mostCommonModel(bucketsPrev),
    deviceCountPrev: devicesCount,
  };

  const insights = detectInsights(fixture);

  return {
    ...fixture,
    comparison: {
      ...fixture.comparison,
      vsPlatform: {
        tokens: platformTokens,
        cost: platform.totalEstimatedCostUsd,
        sessions: platform.totalSessions,
        activeSeconds: platform.totalActiveSeconds,
      },
    },
    insights,
    projectDrilldown,
    hourHistogram,
    weekdayHistogram,
  };
}

function aggregateDailyCost(buckets: Array<{ bucketStart: Date }>): number[] {
  const map = new Map<string, number>();
  for (const b of buckets) {
    const k = b.bucketStart.toISOString().slice(0, 10);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.values());
}

function computeStreaks(activeDates: Set<string>): {
  currentStreak: number;
  longestStreak: number;
} {
  if (activeDates.size === 0) return { currentStreak: 0, longestStreak: 0 };
  const sorted = Array.from(activeDates).sort();
  let longest = 1,
    run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prevDateStr = sorted[i - 1];
    const curDateStr = sorted[i];
    if (!prevDateStr || !curDateStr) continue;
    const prev = new Date(prevDateStr);
    const cur = new Date(curDateStr);
    if (cur.getTime() - prev.getTime() === 86400000) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }
  return { currentStreak: 0, longestStreak: longest };
}

function mostCommonModel(
  buckets: Array<{ model: string; totalTokens: number | bigint }>,
): string {
  const counts = new Map<string, number>();
  for (const b of buckets)
    counts.set(b.model, (counts.get(b.model) ?? 0) + Number(b.totalTokens));
  let best = "",
    bestN = -1;
  for (const [m, n] of counts)
    if (n > bestN) {
      best = m;
      bestN = n;
    }
  return best;
}

function computeTopProjectShift(
  current: Array<{ projectKey: string; totalTokens: number | bigint }>,
  prev: Array<{ projectKey: string; totalTokens: number | bigint }>,
): number {
  const sum = (xs: typeof current) =>
    xs.reduce((s, x) => s + Number(x.totalTokens), 0) || 1;
  const cTotal = sum(current);
  const pTotal = sum(prev);
  const cTop =
    current.reduce((m, x) => Math.max(m, Number(x.totalTokens)), 0) / cTotal;
  const pTop =
    prev.length > 0
      ? prev.reduce((m, x) => Math.max(m, Number(x.totalTokens)), 0) / pTotal
      : 0;
  return Math.abs(cTop - pTop);
}
