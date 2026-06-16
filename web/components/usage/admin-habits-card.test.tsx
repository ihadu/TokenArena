import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdminHabitsCard } from "./admin-habits-card";

const fakeT = (key: string, values?: Record<string, string | number>) => {
  const map: Record<string, string> = {
    habits: "Habits",
    currentStreak: "Current streak",
    longestStreak: "Longest streak",
    deviceCount: "Devices",
    hourHistogram: "Active hours (24h)",
    weekdayDistribution: "Weekday distribution",
    peakHour: "Peak {hour}",
    noActivity: "No activity yet",
    weekdayShortSun: "Sun",
    weekdayShortMon: "Mon",
    weekdayShortTue: "Tue",
    weekdayShortWed: "Wed",
    weekdayShortThu: "Thu",
    weekdayShortFri: "Fri",
    weekdayShortSat: "Sat",
  };
  let str = map[key] ?? key;
  if (values) {
    for (const [k, v] of Object.entries(values)) {
      str = str.replace(`{${k}}`, String(v));
    }
  }
  return str;
};

describe("AdminHabitsCard", () => {
  it("renders streak, device count, and empty state when histograms are zero", () => {
    const markup = renderToStaticMarkup(
      <AdminHabitsCard
        t={fakeT}
        habits={{
          hourHistogram: new Array(24).fill(0),
          weekdayHistogram: new Array(7).fill(0),
          currentStreak: 7,
          longestStreak: 12,
          deviceCount: 3,
        }}
      />,
    );

    expect(markup).toContain("Current streak");
    expect(markup).toContain("Habits");
    expect(markup).toContain("No activity yet");
  });

  it("renders bars with min-height baseline and peak highlight when data exists", () => {
    const hour = new Array(24).fill(0);
    hour[17] = 19;
    hour[18] = 10;
    const weekday = new Array(7).fill(0);
    weekday[1] = 32;
    const markup = renderToStaticMarkup(
      <AdminHabitsCard
        t={fakeT}
        habits={{
          hourHistogram: hour,
          weekdayHistogram: weekday,
          currentStreak: 0,
          longestStreak: 0,
          deviceCount: 0,
        }}
      />,
    );

    expect(markup).toContain("Active hours (24h)");
    expect(markup).toContain("Peak 17:00");
    expect(markup).toContain("Weekday distribution");
    expect(markup).toContain("Mon");
    // Inline count above the bar
    expect(markup).toContain(">32<");
    expect(markup).not.toContain("No activity yet");
  });

  it("highlights the weekday peak bar with solid amber and ring; non-peak gets /60", () => {
    const hour = new Array(24).fill(0);
    hour[17] = 19;
    const weekday = new Array(7).fill(0);
    weekday[3] = 126;
    const markup = renderToStaticMarkup(
      <AdminHabitsCard
        t={fakeT}
        habits={{
          hourHistogram: hour,
          weekdayHistogram: weekday,
          currentStreak: 0,
          longestStreak: 0,
          deviceCount: 0,
        }}
      />,
    );

    expect(markup).toContain("ring-amber-600");
    expect(markup).toContain("bg-amber-500/60");
    // Peak value inline above bar
    expect(markup).toContain(">126<");
  });

  it("uses h-20 container for weekday chart (taller than hour chart for readability)", () => {
    const weekday = new Array(7).fill(0);
    weekday[1] = 10;
    const markup = renderToStaticMarkup(
      <AdminHabitsCard
        t={fakeT}
        habits={{
          hourHistogram: new Array(24).fill(0),
          weekdayHistogram: weekday,
          currentStreak: 0,
          longestStreak: 0,
          deviceCount: 0,
        }}
      />,
    );

    expect(markup).toContain("h-20 items-end gap-1");
  });

  it("does not render weekday peak number when weekday data is zero", () => {
    const markup = renderToStaticMarkup(
      <AdminHabitsCard
        t={fakeT}
        habits={{
          hourHistogram: new Array(24).fill(0),
          weekdayHistogram: new Array(7).fill(0),
          currentStreak: 0,
          longestStreak: 0,
          deviceCount: 0,
        }}
      />,
    );

    // Empty weekday shows the placeholder
    expect(markup).toContain("No activity yet");
  });

  it("renders all non-zero counts inline above their weekday bars", () => {
    const weekday = new Array(7).fill(0);
    weekday[0] = 3;
    weekday[3] = 126;
    weekday[5] = 8;
    const markup = renderToStaticMarkup(
      <AdminHabitsCard
        t={fakeT}
        habits={{
          hourHistogram: new Array(24).fill(0),
          weekdayHistogram: weekday,
          currentStreak: 0,
          longestStreak: 0,
          deviceCount: 0,
        }}
      />,
    );

    expect(markup).toContain(">3<");
    expect(markup).toContain(">126<");
    expect(markup).toContain(">8<");
  });
});
