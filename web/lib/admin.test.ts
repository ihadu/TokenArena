import { describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({
  prisma: {
    adminAccessLog: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock("./session", () => ({
  getOptionalSession: vi.fn(),
}));

import {
  isAdminUsernameIn,
  logAdminAccess,
  parseAdminAllowlist,
} from "./admin";

describe("parseAdminAllowlist", () => {
  it("returns an empty set for undefined", () => {
    expect(parseAdminAllowlist(undefined).size).toBe(0);
  });

  it("returns an empty set for an empty string", () => {
    expect(parseAdminAllowlist("").size).toBe(0);
  });

  it("parses a single username", () => {
    expect([...parseAdminAllowlist("alice")]).toEqual(["alice"]);
  });

  it("parses comma-separated usernames", () => {
    expect([...parseAdminAllowlist("alice,bob,carol")]).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("trims whitespace around each username", () => {
    expect([...parseAdminAllowlist(" alice , bob , carol ")]).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("lowercases usernames", () => {
    expect([...parseAdminAllowlist("Alice,BOB")]).toEqual(["alice", "bob"]);
  });

  it("drops empty entries from trailing/leading/duplicate commas", () => {
    expect([...parseAdminAllowlist(",,,alice, , ,bob,,")]).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("drops whitespace-only entries", () => {
    expect([...parseAdminAllowlist("alice,   ,bob")]).toEqual(["alice", "bob"]);
  });
});

describe("isAdminUsernameIn", () => {
  const set = new Set(["alice", "bob"]);

  it("returns true for an exact match", () => {
    expect(isAdminUsernameIn(set, "alice")).toBe(true);
  });

  it("returns true case-insensitively", () => {
    expect(isAdminUsernameIn(set, "Alice")).toBe(true);
    expect(isAdminUsernameIn(set, "BOB")).toBe(true);
  });

  it("returns true after trimming whitespace", () => {
    expect(isAdminUsernameIn(set, "  alice  ")).toBe(true);
  });

  it("returns false for a non-member", () => {
    expect(isAdminUsernameIn(set, "carol")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAdminUsernameIn(set, null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAdminUsernameIn(set, undefined)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isAdminUsernameIn(set, "")).toBe(false);
  });

  it("returns false against an empty allowlist", () => {
    expect(isAdminUsernameIn(new Set(), "alice")).toBe(false);
  });
});

describe("logAdminAccess", () => {
  it("skips writing when viewer and target are the same user", async () => {
    const { prisma } = await import("./prisma");
    const createSpy = prisma.adminAccessLog.create as ReturnType<typeof vi.fn>;
    createSpy.mockClear();

    await logAdminAccess({
      viewerId: "user-1",
      targetUserId: "user-1",
      action: "view_usage_dashboard",
    });

    expect(createSpy).not.toHaveBeenCalled();
  });

  it("writes a row when viewer and target differ", async () => {
    const { prisma } = await import("./prisma");
    const createSpy = prisma.adminAccessLog.create as ReturnType<typeof vi.fn>;
    createSpy.mockClear();

    await logAdminAccess({
      viewerId: "viewer-1",
      targetUserId: "target-2",
      action: "view_usage_dashboard",
    });

    expect(createSpy).toHaveBeenCalledWith({
      data: {
        viewerId: "viewer-1",
        targetUserId: "target-2",
        action: "view_usage_dashboard",
      },
    });
  });

  it("swallows prisma errors and does not throw", async () => {
    const { prisma } = await import("./prisma");
    const createSpy = prisma.adminAccessLog.create as ReturnType<typeof vi.fn>;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createSpy.mockClear();
    createSpy.mockRejectedValueOnce(new Error("db down"));

    await expect(
      logAdminAccess({
        viewerId: "viewer-1",
        targetUserId: "target-2",
        action: "view_usage_dashboard",
      }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
