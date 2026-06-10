import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdminHabitsCard } from "./admin-habits-card";

describe("AdminHabitsCard", () => {
  it("renders streak and device count", () => {
    const markup = renderToStaticMarkup(
      <AdminHabitsCard
        habits={{
          hourHistogram: new Array(24).fill(0),
          weekdayHistogram: new Array(7).fill(0),
          currentStreak: 7,
          longestStreak: 12,
          deviceCount: 3,
        }}
      />,
    );

    expect(markup).toContain("7");
    expect(markup).toContain("3");
  });
});
