import { describe, expect, it } from "vitest";
import { type AdminAnalyticsFixture, detectInsights } from "./insights";

const base: AdminAnalyticsFixture = {
  dailyAverages: {
    activeDays: 7,
    tokens: 1000,
    cost: 5,
    sessions: 3,
    activeSeconds: 600,
  },
  habits: { currentStreak: 0, longestStreak: 5, deviceCount: 2 },
  comparison: {
    vsPrevPeriod: { tokens: 1000, cost: 5, sessions: 3, activeSeconds: 600 },
  },
  dailyCosts: [3, 4, 5, 4, 5, 6, 5, 4, 5, 4, 5, 4, 5, 4],
  projectShareShift: 0.1,
  topModel: "gpt-4",
  topModelPrev: "gpt-4",
  deviceCountPrev: 2,
};

describe("detectInsights", () => {
  it("returns empty when nothing notable", () => {
    expect(detectInsights(base)).toEqual([]);
  });

  it("emits streakRule when currentStreak >= 7", () => {
    const r = detectInsights({
      ...base,
      habits: { ...base.habits, currentStreak: 10 },
    });
    expect(r.some((i) => i.kind === "streak")).toBe(true);
  });

  it("emits inactiveRule when currentStreak=0 and activeDays<=3 in 14d", () => {
    const r = detectInsights({
      ...base,
      dailyAverages: { ...base.dailyAverages, activeDays: 2 },
    });
    expect(r.some((i) => i.kind === "inactive")).toBe(true);
  });

  it("suppresses costSpike when sample days < 7", () => {
    const r = detectInsights({
      ...base,
      dailyAverages: { ...base.dailyAverages, activeDays: 5 },
      dailyCosts: [1, 1, 1, 1, 1, 100],
    });
    expect(r.some((i) => i.kind === "costSpike")).toBe(false);
  });

  it("emits costSpike when sample >= 7 and max > 2x mean", () => {
    const r = detectInsights({
      ...base,
      dailyCosts: [3, 3, 3, 3, 3, 3, 3, 100],
    });
    expect(r.some((i) => i.kind === "costSpike")).toBe(true);
  });

  it("emits projectShift when share delta > 0.3", () => {
    const r = detectInsights({ ...base, projectShareShift: 0.4 });
    expect(r.some((i) => i.kind === "projectShift")).toBe(true);
  });

  it("emits modelShift when top model changes", () => {
    const r = detectInsights({
      ...base,
      topModel: "claude-3",
      topModelPrev: "gpt-4",
    });
    expect(r.some((i) => i.kind === "modelShift")).toBe(true);
  });

  it("suppresses deviceGrowth when current count < 4", () => {
    const r = detectInsights({
      ...base,
      habits: { ...base.habits, deviceCount: 3 },
      deviceCountPrev: 1,
    });
    expect(r.some((i) => i.kind === "deviceGrowth")).toBe(false);
  });

  it("emits deviceGrowth when current>=4 and week-over-week >=50%", () => {
    const r = detectInsights({
      ...base,
      habits: { ...base.habits, deviceCount: 6 },
      deviceCountPrev: 2,
    });
    expect(r.some((i) => i.kind === "deviceGrowth")).toBe(true);
  });
});
