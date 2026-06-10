import { describe, expect, it } from "vitest";
import { CN_HOLIDAYS_2025_2026, isNonWorkingDay } from "./cn";

describe("CN_HOLIDAYS_2025_2026", () => {
  it("includes 2025-01-01 (New Year)", () => {
    expect(CN_HOLIDAYS_2025_2026.has("2025-01-01")).toBe(true);
  });
});

describe("isNonWorkingDay", () => {
  it("returns true for a CN holiday", () => {
    const d = new Date("2025-10-01T12:00:00Z");
    expect(isNonWorkingDay(d, "Asia/Shanghai")).toBe(true);
  });
  it("returns true for Saturday in Asia/Shanghai", () => {
    const d = new Date("2026-06-13T12:00:00Z"); // 2026-06-13 is Sat
    expect(isNonWorkingDay(d, "Asia/Shanghai")).toBe(true);
  });
  it("returns true for Sunday in Asia/Shanghai", () => {
    const d = new Date("2026-06-14T12:00:00Z"); // 2026-06-14 is Sun
    expect(isNonWorkingDay(d, "Asia/Shanghai")).toBe(true);
  });
  it("returns false for a normal weekday", () => {
    const d = new Date("2026-06-10T01:00:00Z"); // 2026-06-10 is Wed in Asia/Shanghai
    expect(isNonWorkingDay(d, "Asia/Shanghai")).toBe(false);
  });
});
