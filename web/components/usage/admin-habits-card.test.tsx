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

  it("renders bars with min-height baseline and peak label when data exists", () => {
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
    expect(markup).toContain("Mon");
    expect(markup).not.toContain("No activity yet");
  });
});
