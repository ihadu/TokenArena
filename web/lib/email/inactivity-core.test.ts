import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, sendMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findMany: vi.fn() },
    usageBucket: { findFirst: vi.fn(), findMany: vi.fn() },
    usageSession: { findFirst: vi.fn() },
    inactivityReminder: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  sendMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./smtp", () => ({ sendInactivityReminder: sendMock }));

import { runInactivitySweep } from "./inactivity-core";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runInactivitySweep", () => {
  it("returns zeros when there are no users", async () => {
    const result = await runInactivitySweep();
    expect(result).toEqual({ sent: 0, skipped: 0, resolved: 0, failed: 0 });
  });

  it("skips users whose local hour is not 9", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z")); // Asia/Shanghai 20:00
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: "u1",
        email: "u@x.com",
        username: "u1",
        usagePreference: { timezone: "Asia/Shanghai", locale: "en" },
      },
    ]);
    const result = await runInactivitySweep();
    expect(result).toEqual({ sent: 0, skipped: 0, resolved: 0, failed: 0 });
  });

  it("isolates failures — one user's error does not abort the sweep", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T01:00:00Z")); // Asia/Shanghai 09:00
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: "u1",
        email: "u1@x.com",
        username: "u1",
        usagePreference: { timezone: "Asia/Shanghai", locale: "en" },
      },
      {
        id: "u2",
        email: "u2@x.com",
        username: "u2",
        usagePreference: { timezone: "Asia/Shanghai", locale: "en" },
      },
    ]);
    // u1: no last active
    prismaMock.usageBucket.findFirst.mockResolvedValueOnce(null);
    prismaMock.usageSession.findFirst.mockResolvedValueOnce(null);
    prismaMock.inactivityReminder.findFirst.mockResolvedValueOnce(null);
    // u2: 4 business days inactive
    prismaMock.usageBucket.findFirst.mockResolvedValueOnce({
      bucketStart: new Date("2026-06-04T00:00:00Z"),
    });
    prismaMock.inactivityReminder.findFirst.mockResolvedValueOnce(null);
    prismaMock.inactivityReminder.create.mockResolvedValueOnce({ id: "r1" });

    sendMock
      .mockRejectedValueOnce(new Error("SMTP down"))
      .mockResolvedValueOnce({});

    const result = await runInactivitySweep();
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
  });

  it("does not hang on DST spring-forward day for America/New_York", async () => {
    vi.useFakeTimers();
    // 2026-03-10 13:00 UTC = 09:00 EDT on 2026-03-10 in NY (DST started 2026-03-08)
    vi.setSystemTime(new Date("2026-03-10T13:00:00Z"));
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: "u_dst",
        email: "dst@x.com",
        username: "dst_user",
        usagePreference: { timezone: "America/New_York", locale: "en" },
      },
    ]);
    // Last active: 2026-03-04 (5 calendar days before). Inactive biz days
    // from 2026-03-05 through 2026-03-09 (exclusive of 03-10): Thu, Fri, Mon = 3.
    prismaMock.usageBucket.findFirst.mockResolvedValueOnce({
      bucketStart: new Date("2026-03-04T05:00:00Z"),
    });
    prismaMock.usageSession.findFirst.mockResolvedValueOnce(null);
    prismaMock.inactivityReminder.findFirst.mockResolvedValueOnce(null);
    prismaMock.inactivityReminder.create.mockResolvedValueOnce({ id: "r_dst" });
    sendMock.mockResolvedValueOnce({});

    // The original bug caused an infinite loop here. Vitest's per-test timeout
    // (5s below) would fail the test if the loop never advanced.
    const start = Date.now();
    const result = await runInactivitySweep();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(result.failed).toBe(0);
    // 3 inactive biz days meets the >= 3 threshold and is the first send.
    expect(result.sent).toBe(1);
  }, 5000);
});
