import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, arenaMock } = vi.hoisted(() => ({
  prismaMock: {
    usageBucket: { findMany: vi.fn(), findFirst: vi.fn() },
    usageSession: { findMany: vi.fn() },
    usageDevice: { count: vi.fn() },
  },
  arenaMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/achievements/queries", () => ({
  getAchievementArenaSummary: arenaMock,
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
  it("aggregates buckets/sessions into daily averages using active-day denominator", async () => {
    prismaMock.usageBucket.findMany.mockResolvedValueOnce([
      // 5 active days, 1000 total tokens
      {
        bucketStart: new Date("2026-06-04T00:00:00Z"),
        totalTokens: 200,
        source: "s1",
        model: "gpt-4",
        projectKey: "p1",
        projectLabel: "P1",
      },
      {
        bucketStart: new Date("2026-06-05T00:00:00Z"),
        totalTokens: 200,
        source: "s1",
        model: "gpt-4",
        projectKey: "p1",
        projectLabel: "P1",
      },
      {
        bucketStart: new Date("2026-06-06T00:00:00Z"),
        totalTokens: 200,
        source: "s1",
        model: "gpt-4",
        projectKey: "p1",
        projectLabel: "P1",
      },
      {
        bucketStart: new Date("2026-06-08T00:00:00Z"),
        totalTokens: 200,
        source: "s1",
        model: "gpt-4",
        projectKey: "p2",
        projectLabel: "P2",
      },
      {
        bucketStart: new Date("2026-06-09T00:00:00Z"),
        totalTokens: 200,
        source: "s1",
        model: "gpt-4",
        projectKey: "p2",
        projectLabel: "P2",
      },
    ]);
    prismaMock.usageBucket.findMany.mockResolvedValueOnce([]); // 之前周期
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
    prismaMock.usageDevice.count.mockResolvedValueOnce(2);
    arenaMock.mockResolvedValueOnce({
      totalTokens: 50000,
      totalEstimatedCostUsd: 200,
      totalActiveSeconds: 60000,
      totalSessions: 100,
      totalActiveDays: 7,
    });

    const result = await getAdminUsageAnalytics({
      userId: "u1",
      range: fixedRange,
      timezone: "Asia/Shanghai",
    });
    expect(result.dailyAverages.activeDays).toBe(5);
    expect(result.dailyAverages.tokens).toBe(200); // 1000 / 5
    expect(result.habits.deviceCount).toBe(2);
    expect(result.projectDrilldown).toHaveLength(2);
  });
});
