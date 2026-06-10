import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminComparisonCard } from "./admin-comparison-card";

const base = {
  user: { tokens: 1000, cost: 5, sessions: 10, activeSeconds: 600 },
  vsPlatform: { tokens: 800, cost: 4, sessions: 8, activeSeconds: 500 },
  vsPrevPeriod: { tokens: 900, cost: 4.5, sessions: 9, activeSeconds: 550 },
};

describe("AdminComparisonCard", () => {
  it("renders all three rows", () => {
    const html = renderToStaticMarkup(<AdminComparisonCard {...base} />);
    expect(html).toContain("平台平均");
    expect(html).toContain("上周期");
  });
});
