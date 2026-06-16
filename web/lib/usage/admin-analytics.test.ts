import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, arenaMock, catalogMock } = vi.hoisted(() => ({
  prismaMock: {
    usageBucket: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    usageSession: { findMany: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    device: { count: vi.fn() },
  },
  arenaMock: vi.fn(),
  catalogMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/achievements/queries", () => ({
  getAchievementArenaSummary: arenaMock,
}));
vi.mock("@/lib/pricing/catalog", () => ({
  getPricingCatalog: catalogMock,
}));

import { getAdminUsageAnalytics } from "./admin-analytics.server";

const fixedRange = {
  from: new Date("2026-06-03T00:00:00Z"),
  to: new Date("2026-06-10T00:00:00Z"),
  preset: "7d" as const,
  granularity: "day" as const,
  timezone: "Asia/Shanghai",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => vi.restoreAllMocks());

describe("getAdminUsageAnalytics", () => {
  it("aggregates buckets/sessions into per-day metrics and P50 platform", async () => {
    // 1. current range buckets (5 days, 1000 total tokens)
    prismaMock.usageBucket.findMany.mockResolvedValueOnce([
      {
        bucketStart: new Date("2026-06-04T00:00:00Z"),
        totalTokens: 200,
        inputTokens: 100,
        outputTokens: 80,
        reasoningTokens: 20,
        cachedTokens: 40,
        source: "s1",
        model: "gpt-4",
        projectKey: "p1",
        projectLabel: "P1",
      },
      {
        bucketStart: new Date("2026-06-05T00:00:00Z"),
        totalTokens: 200,
        inputTokens: 100,
        outputTokens: 80,
        reasoningTokens: 20,
        cachedTokens: 40,
        source: "s1",
        model: "gpt-4",
        projectKey: "p1",
        projectLabel: "P1",
      },
      {
        bucketStart: new Date("2026-06-06T00:00:00Z"),
        totalTokens: 200,
        inputTokens: 100,
        outputTokens: 80,
        reasoningTokens: 20,
        cachedTokens: 40,
        source: "s1",
        model: "gpt-4",
        projectKey: "p1",
        projectLabel: "P1",
      },
      {
        bucketStart: new Date("2026-06-08T00:00:00Z"),
        totalTokens: 200,
        inputTokens: 100,
        outputTokens: 80,
        reasoningTokens: 20,
        cachedTokens: 40,
        source: "s1",
        model: "gpt-4",
        projectKey: "p2",
        projectLabel: "P2",
      },
      {
        bucketStart: new Date("2026-06-09T00:00:00Z"),
        totalTokens: 200,
        inputTokens: 100,
        outputTokens: 80,
        reasoningTokens: 20,
        cachedTokens: 40,
        source: "s1",
        model: "gpt-4",
        projectKey: "p2",
        projectLabel: "P2",
      },
    ]);
    // 2. current range sessions
    prismaMock.usageSession.findMany.mockResolvedValueOnce([
      {
        firstMessageAt: new Date("2026-06-04T01:00:00Z"),
        activeSeconds: 60,
        projectKey: "p1",
        projectLabel: "P1",
      },
      {
        firstMessageAt: new Date("2026-06-05T01:00:00Z"),
        activeSeconds: 60,
        projectKey: "p1",
        projectLabel: "P1",
      },
      {
        firstMessageAt: new Date("2026-06-06T01:00:00Z"),
        activeSeconds: 60,
        projectKey: "p1",
        projectLabel: "P1",
      },
      {
        firstMessageAt: new Date("2026-06-08T01:00:00Z"),
        activeSeconds: 60,
        projectKey: "p2",
        projectLabel: "P2",
      },
      {
        firstMessageAt: new Date("2026-06-09T01:00:00Z"),
        activeSeconds: 60,
        projectKey: "p2",
        projectLabel: "P2",
      },
    ]);
    // 3. prev range buckets
    prismaMock.usageBucket.findMany.mockResolvedValueOnce([]);
    // 4. prev range sessions
    prismaMock.usageSession.findMany.mockResolvedValueOnce([]);
    // 5. arena summary
    arenaMock.mockResolvedValueOnce({
      totalTokens: 50000,
      totalEstimatedCostUsd: 200,
      totalActiveSeconds: 60000,
      totalSessions: 100,
      totalActiveDays: 7,
      activeDayKeys: [
        "2026-05-01",
        "2026-05-02",
        "2026-05-03",
        "2026-05-04",
        "2026-05-05",
        "2026-05-06",
        "2026-05-07",
      ],
    });
    // 6. lifetime aggregates (cached + reasoning)
    prismaMock.usageBucket.aggregate.mockResolvedValueOnce({
      _sum: {
        totalTokens: 50000,
        cachedTokens: 10000,
        reasoningTokens: 5000,
      },
    });
    // 7. device count current
    prismaMock.device.count.mockResolvedValueOnce(2);
    // 8. device count prev
    prismaMock.device.count.mockResolvedValueOnce(1);
    // 9. platform tokens by user
    prismaMock.usageBucket.groupBy.mockResolvedValueOnce([
      {
        userId: "u1",
        _sum: { totalTokens: 1000, cachedTokens: 200, reasoningTokens: 100 },
      },
      {
        userId: "u2",
        _sum: { totalTokens: 500, cachedTokens: 100, reasoningTokens: 50 },
      },
      {
        userId: "u3",
        _sum: { totalTokens: 2000, cachedTokens: 400, reasoningTokens: 200 },
      },
    ]);
    // 10. platform sessions by user
    prismaMock.usageSession.groupBy.mockResolvedValueOnce([
      { userId: "u1", _sum: { activeSeconds: 300 }, _count: { _all: 5 } },
      { userId: "u2", _sum: { activeSeconds: 100 }, _count: { _all: 2 } },
      { userId: "u3", _sum: { activeSeconds: 600 }, _count: { _all: 10 } },
    ]);
    // 11. platform cost buckets (with userId now)
    prismaMock.usageBucket.findMany.mockResolvedValueOnce([]);
    // 12. catalog
    catalogMock.mockResolvedValueOnce(null);

    const result = await getAdminUsageAnalytics({
      userId: "u1",
      range: fixedRange,
      timezone: "Asia/Shanghai",
    });
    expect(result.dailyAverages.activeDays).toBe(5);
    expect(result.dailyAverages.tokens).toBe(200); // 1000 / 5
    expect(result.dailyAverages.cost).toBe(0);
    expect(result.dailyCosts).toEqual([]);
    expect(result.costAvailable).toBe(false);
    expect(result.prevPeriodAvailable).toBe(false);
    expect(result.habits.deviceCount).toBe(2);
    expect(result.projectDrilldown).toHaveLength(2);
    // 5 metrics returned
    expect(result.metrics).toHaveLength(5);
    const tokensMetric = result.metrics.find((m) => m.key === "tokens");
    expect(tokensMetric).toBeDefined();
    expect(tokensMetric?.current).toBe(200); // 1000/5
    // P50 of [1000, 500, 2000] = 1000, periodDays = 7
    expect(tokensMetric?.vsPlatform).toBeCloseTo(1000 / 7, 5);
    const cacheMetric = result.metrics.find((m) => m.key === "cacheHitRate");
    expect(cacheMetric).toBeDefined();
    // current: 5 * 40 / 1000 = 0.2
    expect(cacheMetric?.current).toBeCloseTo(0.2, 5);
  });
});
