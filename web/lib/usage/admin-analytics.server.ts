import "server-only";

import { getAchievementArenaSummary } from "@/lib/achievements/queries";
import { getPricingCatalog } from "@/lib/pricing/catalog";
import {
  estimateCostUsd,
  resolveOfficialPricingMatch,
} from "@/lib/pricing/resolve";
import { prisma } from "@/lib/prisma";
import { tokenCountToNumber } from "@/lib/token-counts";
import { getPreviousRange, getZonedWeekdayHour } from "@/lib/usage/date-range";
import { formatDateInput } from "@/lib/usage/format";
import {
  type AdminAnalyticsFixture,
  type AdminAnalyticsMetric,
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
  const periodMs = Math.max(
    1,
    input.range.to.getTime() - input.range.from.getTime(),
  );
  const periodDays = Math.max(1, Math.round(periodMs / 86_400_000));

  const [
    buckets,
    sessions,
    bucketsPrev,
    sessionsPrev,
    lifetime,
    lifetimeAggregates,
    devicesCount,
    devicesCountPrev,
    platformTokensByUser,
    platformSessionsByUser,
    platformCostBuckets,
    catalog,
  ] = await Promise.all([
    prisma.usageBucket.findMany({
      where: {
        userId: input.userId,
        bucketStart: { gte: input.range.from, lte: input.range.to },
      },
      select: {
        bucketStart: true,
        totalTokens: true,
        inputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        cachedTokens: true,
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
        inputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        cachedTokens: true,
        model: true,
        projectKey: true,
        projectLabel: true,
      },
    }),
    prisma.usageSession.findMany({
      where: {
        userId: input.userId,
        firstMessageAt: { gte: prev.from, lte: prev.to },
      },
      select: {
        firstMessageAt: true,
        activeSeconds: true,
      },
    }),
    getAchievementArenaSummary(input.userId),
    prisma.usageBucket.aggregate({
      where: { userId: input.userId },
      _sum: {
        totalTokens: true,
        cachedTokens: true,
        reasoningTokens: true,
      },
    }),
    prisma.device.count({ where: { userId: input.userId } }),
    prisma.device.count({
      where: {
        userId: input.userId,
        lastSeenAt: { gte: prev.from, lte: prev.to },
      },
    }),
    prisma.usageBucket.groupBy({
      by: ["userId"],
      where: { bucketStart: { gte: input.range.from, lte: input.range.to } },
      _sum: {
        totalTokens: true,
        cachedTokens: true,
        reasoningTokens: true,
      },
    }),
    prisma.usageSession.groupBy({
      by: ["userId"],
      where: {
        firstMessageAt: { gte: input.range.from, lte: input.range.to },
      },
      _sum: { activeSeconds: true },
      _count: { _all: true },
    }),
    prisma.usageBucket.findMany({
      where: { bucketStart: { gte: input.range.from, lte: input.range.to } },
      select: {
        userId: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        cachedTokens: true,
      },
    }),
    getPricingCatalog(),
  ]);

  // 当前周期聚合
  const activeDays = new Set(
    buckets.map((b) => formatDateInput(b.bucketStart, input.timezone)),
  ).size;
  const totalTokens = buckets.reduce((s, b) => s + Number(b.totalTokens), 0);
  const totalCached = buckets.reduce(
    (s, b) => s + Number(b.cachedTokens ?? 0),
    0,
  );
  const totalReasoning = buckets.reduce(
    (s, b) => s + Number(b.reasoningTokens ?? 0),
    0,
  );
  const totalSessions = sessions.length;
  const totalActiveSeconds = sessions.reduce((s, x) => s + x.activeSeconds, 0);

  const costByDate = new Map<string, number>();
  let totalCost = 0;
  for (const b of buckets) {
    const usd = estimateBucketCostUsd(b, catalog);
    if (usd <= 0) continue;
    totalCost += usd;
    const key = formatDateInput(b.bucketStart, input.timezone);
    costByDate.set(key, (costByDate.get(key) ?? 0) + usd);
  }
  const dailyCosts: number[] = Array.from(costByDate.values());

  // 当前周期的 ratio metric
  const currentCacheHitRate = totalTokens > 0 ? totalCached / totalTokens : 0;
  const currentReasoningShare =
    totalTokens > 0 ? totalReasoning / totalTokens : 0;
  const currentAvgTokensPerSession =
    totalSessions > 0 ? totalTokens / totalSessions : 0;

  // 习惯
  const hourHistogram = new Array(24).fill(0);
  const weekdayHistogram = new Array(7).fill(0);
  for (const s of sessions) {
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
  for (const s of sessions) {
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

  // 上周期聚合
  const prevTokens = bucketsPrev.reduce((s, b) => s + Number(b.totalTokens), 0);
  const prevCached = bucketsPrev.reduce(
    (s, b) => s + Number(b.cachedTokens ?? 0),
    0,
  );
  const prevReasoning = bucketsPrev.reduce(
    (s, b) => s + Number(b.reasoningTokens ?? 0),
    0,
  );
  const prevCost = bucketsPrev.reduce(
    (s, b) => s + estimateBucketCostUsd(b, catalog),
    0,
  );
  const prevSessions = sessionsPrev.length;
  const _prevActiveSeconds = sessionsPrev.reduce(
    (s, x) => s + x.activeSeconds,
    0,
  );
  const prevActiveDays = new Set(
    bucketsPrev.map((b) => formatDateInput(b.bucketStart, input.timezone)),
  ).size;
  const prevCacheHitRate = prevTokens > 0 ? prevCached / prevTokens : 0;
  const prevReasoningShare = prevTokens > 0 ? prevReasoning / prevTokens : 0;
  const prevAvgTokensPerSession =
    prevSessions > 0 ? prevTokens / prevSessions : 0;

  // 终身聚合（ratios 需要单独查询）
  const lifetimeActiveDays = lifetime.totalActiveDays;
  const lifetimeTotalTokens = Number(lifetimeAggregates._sum.totalTokens ?? 0);
  const lifetimeCached = Number(lifetimeAggregates._sum.cachedTokens ?? 0);
  const lifetimeReasoning = Number(
    lifetimeAggregates._sum.reasoningTokens ?? 0,
  );
  const lifetimeCacheHitRate =
    lifetimeTotalTokens > 0 ? lifetimeCached / lifetimeTotalTokens : 0;
  const lifetimeReasoningShare =
    lifetimeTotalTokens > 0 ? lifetimeReasoning / lifetimeTotalTokens : 0;
  const lifetimeAvgTokensPerSession =
    (lifetime.totalSessions ?? 0) > 0
      ? lifetimeTotalTokens / (lifetime.totalSessions ?? 0)
      : 0;

  // 平台 P50：per-user 总量 → P50 → / periodDays
  const perUserTokens = platformTokensByUser.map((r) =>
    Number(r._sum.totalTokens ?? 0),
  );
  const perUserSessions = new Map(
    platformSessionsByUser.map((r) => [r.userId, r._count._all ?? 0]),
  );
  const perUserAvgTokensPerSession: number[] = [];
  for (const r of platformTokensByUser) {
    const sessions = perUserSessions.get(r.userId) ?? 0;
    const tokens = Number(r._sum.totalTokens ?? 0);
    if (sessions > 0) perUserAvgTokensPerSession.push(tokens / sessions);
  }
  const perUserCacheHitRate: number[] = [];
  for (const r of platformTokensByUser) {
    const total = Number(r._sum.totalTokens ?? 0);
    const cached = Number(r._sum.cachedTokens ?? 0);
    if (total > 0) perUserCacheHitRate.push(cached / total);
  }
  const perUserReasoningShare: number[] = [];
  for (const r of platformTokensByUser) {
    const total = Number(r._sum.totalTokens ?? 0);
    const reasoning = Number(r._sum.reasoningTokens ?? 0);
    if (total > 0) perUserReasoningShare.push(reasoning / total);
  }
  const perUserCost: number[] = [];
  const perUserCostMap = new Map<string, number>();
  for (const b of platformCostBuckets) {
    const usd = estimateBucketCostUsd(b, catalog);
    if (usd <= 0) continue;
    perUserCostMap.set(b.userId, (perUserCostMap.get(b.userId) ?? 0) + usd);
  }
  for (const v of perUserCostMap.values()) perUserCost.push(v);

  const p50Tokens = percentile(perUserTokens, 0.5) / periodDays;
  const p50Cost = percentile(perUserCost, 0.5) / periodDays;
  const p50CacheHitRate = percentile(perUserCacheHitRate, 0.5);
  const p50ReasoningShare = percentile(perUserReasoningShare, 0.5);
  const p50AvgTokensPerSession = percentile(perUserAvgTokensPerSession, 0.5);

  // 当前 user 的 per-day 归一化
  const userDenom = Math.max(1, activeDays);
  const currentTokensPerDay = totalTokens / userDenom;
  const currentCostPerDay = totalCost / userDenom;
  const prevDenom = Math.max(1, prevActiveDays);
  const prevTokensPerDay = prevTokens / prevDenom;
  const prevCostPerDay = prevCost / prevDenom;
  const lifetimeDenom = Math.max(1, lifetimeActiveDays);
  const lifetimeTokensPerDay = Number(lifetime.totalTokens) / lifetimeDenom;
  const lifetimeCostPerDay = lifetime.totalEstimatedCostUsd / lifetimeDenom;

  const metrics: AdminAnalyticsMetric[] = [
    {
      key: "tokens",
      format: "tokens",
      current: currentTokensPerDay,
      lifetime: lifetimeTokensPerDay,
      vsPlatform: p50Tokens,
      vsPrev: prevTokensPerDay,
    },
    {
      key: "cost",
      format: "cost",
      current: currentCostPerDay,
      lifetime: lifetimeCostPerDay,
      vsPlatform: p50Cost,
      vsPrev: prevCostPerDay,
    },
    {
      key: "cacheHitRate",
      format: "percent",
      current: currentCacheHitRate,
      lifetime: lifetimeCacheHitRate,
      vsPlatform: p50CacheHitRate,
      vsPrev: prevCacheHitRate,
    },
    {
      key: "reasoningShare",
      format: "percent",
      current: currentReasoningShare,
      lifetime: lifetimeReasoningShare,
      vsPlatform: p50ReasoningShare,
      vsPrev: prevReasoningShare,
    },
    {
      key: "avgTokensPerSession",
      format: "ratio",
      current: currentAvgTokensPerSession,
      lifetime: lifetimeAvgTokensPerSession,
      vsPlatform: p50AvgTokensPerSession,
      vsPrev: prevAvgTokensPerSession,
    },
  ];

  const fixture: AdminAnalyticsFixture = {
    dailyAverages: {
      activeDays,
      tokens: currentTokensPerDay,
      cost: currentCostPerDay,
      sessions: totalSessions / userDenom,
      activeSeconds: totalActiveSeconds / userDenom,
    },
    habits: { currentStreak, longestStreak, deviceCount: devicesCount },
    metrics,
    prevActiveDays,
    costAvailable: catalog !== null,
    prevPeriodAvailable: prevActiveDays > 0,
    dailyCosts,
    projectShareShift: computeTopProjectShift(buckets, bucketsPrev),
    topModel: mostCommonModel(buckets),
    topModelPrev: mostCommonModel(bucketsPrev),
    deviceCountPrev: devicesCountPrev,
  };

  const insights = detectInsights(fixture);

  return {
    ...fixture,
    insights,
    projectDrilldown,
    hourHistogram,
    weekdayHistogram,
  };
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
  let current = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    const newerStr = sorted[i];
    const olderStr = sorted[i - 1];
    if (!newerStr || !olderStr) break;
    const newer = new Date(newerStr);
    const older = new Date(olderStr);
    if (newer.getTime() - older.getTime() === 86400000) {
      current++;
    } else {
      break;
    }
  }
  return { currentStreak: current, longestStreak: longest };
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

function estimateBucketCostUsd(
  bucket: {
    model: string;
    inputTokens: number | bigint | null;
    outputTokens: number | bigint | null;
    reasoningTokens: number | bigint | null;
    cachedTokens: number | bigint | null;
  },
  catalog: Awaited<ReturnType<typeof getPricingCatalog>>,
): number {
  const match = resolveOfficialPricingMatch(catalog, bucket.model);
  if (!match) return 0;
  const estimate = estimateCostUsd(
    {
      inputTokens: tokenCountToNumber(bucket.inputTokens),
      outputTokens: tokenCountToNumber(bucket.outputTokens),
      reasoningTokens: tokenCountToNumber(bucket.reasoningTokens),
      cachedTokens: tokenCountToNumber(bucket.cachedTokens),
    },
    match.cost,
  );
  return estimate?.totalUsd ?? 0;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}
