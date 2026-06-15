import { afterEach, describe, expect, it } from "vitest";

import {
  __resetRateLimitForTest,
  checkAndRecord,
  RATE_LIMIT_MS,
} from "./weekly-export-rate-limit";

describe("checkAndRecord", () => {
  afterEach(() => {
    __resetRateLimitForTest();
  });

  it("allows the first request for an admin", () => {
    expect(checkAndRecord("admin1", () => 1000)).toBe(true);
  });

  it("blocks a second request within the window", () => {
    let now = 1000;
    expect(checkAndRecord("admin1", () => now)).toBe(true);
    now += RATE_LIMIT_MS - 1;
    expect(checkAndRecord("admin1", () => now)).toBe(false);
  });

  it("allows a request after the window elapses", () => {
    let now = 1000;
    expect(checkAndRecord("admin1", () => now)).toBe(true);
    now += RATE_LIMIT_MS;
    expect(checkAndRecord("admin1", () => now)).toBe(true);
  });

  it("tracks each admin independently", () => {
    let now = 1000;
    expect(checkAndRecord("admin1", () => now)).toBe(true);
    expect(checkAndRecord("admin2", () => now)).toBe(true);
    now += 10;
    expect(checkAndRecord("admin1", () => now)).toBe(false);
    expect(checkAndRecord("admin2", () => now)).toBe(false);
  });
});
