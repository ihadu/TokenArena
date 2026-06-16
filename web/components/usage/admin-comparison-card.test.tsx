import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminAnalyticsMetric } from "@/lib/usage/insights";
import { AdminComparisonCard } from "./admin-comparison-card";

const fakeT = (key: string) => {
  const map: Record<string, string> = {
    comparison: "Comparison",
    lifetimeShort: "Lifetime",
    platformShort: "Platform P50",
    prevShort: "Prior",
    metric_tokens: "Tokens/day",
    metric_cost: "Cost/day",
    metric_cacheHitRate: "Cache hit rate",
    metric_reasoningShare: "Reasoning share",
    metric_avgTokensPerSession: "Avg tokens/session",
    costNotIntegrated: "N/A",
    noPrevPeriod: "No prior",
  };
  return map[key] ?? key;
};

const baseMetrics: AdminAnalyticsMetric[] = [
  {
    key: "tokens",
    format: "tokens",
    current: 1_200_000,
    lifetime: 65_800,
    vsPlatform: 142_857,
    vsPrev: 180_000,
  },
  {
    key: "cost",
    format: "cost",
    current: 0.78,
    lifetime: 0.026,
    vsPlatform: 0.0457,
    vsPrev: 0.07,
  },
  {
    key: "cacheHitRate",
    format: "percent",
    current: 0.2,
    lifetime: 0.2,
    vsPlatform: 0.15,
    vsPrev: 0.18,
  },
  {
    key: "reasoningShare",
    format: "percent",
    current: 0.1,
    lifetime: 0.1,
    vsPlatform: 0.12,
    vsPrev: 0.08,
  },
  {
    key: "avgTokensPerSession",
    format: "ratio",
    current: 240_000,
    lifetime: 8_225,
    vsPlatform: 25_000,
    vsPrev: 180_000,
  },
];

describe("AdminComparisonCard", () => {
  it("renders all 5 metric cards", () => {
    const html = renderToStaticMarkup(
      <AdminComparisonCard
        t={fakeT}
        locale="en"
        metrics={baseMetrics}
        prevActiveDays={7}
        costAvailable
        prevPeriodAvailable
      />,
    );
    expect(html).toContain("Tokens/day");
    expect(html).toContain("Cost/day");
    expect(html).toContain("Cache hit rate");
    expect(html).toContain("Reasoning share");
    expect(html).toContain("Avg tokens/session");
  });

  it("shows × multiplier deltas", () => {
    const html = renderToStaticMarkup(
      <AdminComparisonCard
        t={fakeT}
        locale="en"
        metrics={baseMetrics}
        prevActiveDays={7}
        costAvailable
        prevPeriodAvailable
      />,
    );
    // 1.2M / 142.857K ≈ 8.4×
    expect(html).toMatch(/8\.4\d*×/);
  });

  it("labels cost row as N/A when cost not available", () => {
    const html = renderToStaticMarkup(
      <AdminComparisonCard
        t={fakeT}
        locale="en"
        metrics={baseMetrics}
        prevActiveDays={7}
        costAvailable={false}
        prevPeriodAvailable
      />,
    );
    const matches = html.match(/N\/A/g) ?? [];
    // cost metric: 1 current value + 3 baselines + 3 deltas = 7 N/A
    expect(matches.length).toBeGreaterThanOrEqual(7);
  });

  it("labels prev period as No prior with n= annotation when prev unavailable", () => {
    const html = renderToStaticMarkup(
      <AdminComparisonCard
        t={fakeT}
        locale="en"
        metrics={baseMetrics}
        prevActiveDays={0}
        costAvailable
        prevPeriodAvailable={false}
      />,
    );
    expect(html).toContain("No prior");
  });

  it("shows em-dash for zero baseline when user value is positive", () => {
    const metrics: AdminAnalyticsMetric[] = [
      {
        key: "tokens",
        format: "tokens",
        current: 1000,
        lifetime: 0,
        vsPlatform: 0,
        vsPrev: 0,
      },
      ...baseMetrics.slice(1),
    ];
    const html = renderToStaticMarkup(
      <AdminComparisonCard
        t={fakeT}
        locale="en"
        metrics={metrics}
        prevActiveDays={7}
        costAvailable
        prevPeriodAvailable
      />,
    );
    expect(html).toContain("—");
  });
});
