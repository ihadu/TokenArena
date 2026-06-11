import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminComparisonCard } from "./admin-comparison-card";

const fakeT = (key: string) => {
  const map: Record<string, string> = {
    comparison: "Comparison",
    metric: "Metric",
    current: "Current",
    vsPlatform: "vs platform avg",
    deltaPlatform: "Δ platform",
    vsPrevPeriod: "vs prev period",
    deltaPrevPeriod: "Δ prev",
    metricTokens: "Tokens",
    metricCost: "Cost",
    metricSessions: "Sessions",
    metricActiveSeconds: "Active time",
  };
  return map[key] ?? key;
};

const base = {
  user: { tokens: 1_200_000, cost: 0.0523, sessions: 124, activeSeconds: 9000 },
  vsPlatform: {
    tokens: 800_000,
    cost: 0.04,
    sessions: 87,
    activeSeconds: 6300,
  },
  vsPrevPeriod: {
    tokens: 900_000,
    cost: 0.045,
    sessions: 98,
    activeSeconds: 7800,
  },
};

describe("AdminComparisonCard", () => {
  it("renders metric labels and uses formatted values", () => {
    const html = renderToStaticMarkup(
      <AdminComparisonCard t={fakeT} locale="en" {...base} />,
    );
    expect(html).toContain("Tokens");
    expect(html).toContain("vs platform avg");
    expect(html).toContain("vs prev period");
    // 1.2M tokens formatted with K/M suffix
    expect(html).toContain("1.2M");
    // 9000s formatted as duration (compact form omits the space)
    expect(html).toContain("2h30m");
  });

  it("shows two-decimal delta percentages", () => {
    const html = renderToStaticMarkup(
      <AdminComparisonCard t={fakeT} locale="en" {...base} />,
    );
    // 1.2M / 0.8M = 1.5 -> +50.00%
    expect(html).toContain("+50.00%");
    // 1.2M / 0.9M = 1.333... -> +33.33%
    expect(html).toContain("+33.33%");
  });

  it("shows em-dash for zero baseline when user value is positive", () => {
    const html = renderToStaticMarkup(
      <AdminComparisonCard
        t={fakeT}
        locale="en"
        user={base.user}
        vsPlatform={{
          tokens: 0,
          cost: 0,
          sessions: 0,
          activeSeconds: 0,
        }}
        vsPrevPeriod={base.vsPrevPeriod}
      />,
    );
    // em-dash placeholder
    expect(html).toContain("—");
  });

  it("shows zero delta when both user and baseline are zero", () => {
    const zero = {
      user: { tokens: 0, cost: 0, sessions: 0, activeSeconds: 0 },
      vsPlatform: { tokens: 0, cost: 0, sessions: 0, activeSeconds: 0 },
      vsPrevPeriod: { tokens: 0, cost: 0, sessions: 0, activeSeconds: 0 },
    };
    const html = renderToStaticMarkup(
      <AdminComparisonCard t={fakeT} locale="en" {...zero} />,
    );
    expect(html).toContain("0.00%");
  });
});
