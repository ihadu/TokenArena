import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  isCurrentUserAdmin: vi.fn(),
  logAdminAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    usageBucket: { findMany: vi.fn() },
    usageSession: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/usage/weekly-export-rate-limit", () => ({
  __resetRateLimitForTest: vi.fn(),
  checkAndRecord: vi.fn(),
  RATE_LIMIT_MS: 30_000,
}));

import { isCurrentUserAdmin, logAdminAccess } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getOptionalSession } from "@/lib/session";
import { checkAndRecord } from "@/lib/usage/weekly-export-rate-limit";

import { GET } from "./route";

const mockSession = (username: string | null) => {
  vi.mocked(getOptionalSession).mockResolvedValue(
    username
      ? ({
          user: { id: "u1", username, email: "a@b.com" },
        } as never)
      : null,
  );
};

const mockIsAdmin = (v: boolean) => {
  vi.mocked(isCurrentUserAdmin).mockResolvedValue(v);
};

const mockPrisma = (
  users: unknown[],
  buckets: unknown[] = [],
  sessions: unknown[] = [],
) => {
  vi.mocked(prisma.user.findMany).mockResolvedValue(users as never);
  vi.mocked(prisma.usageBucket.findMany).mockResolvedValue(buckets as never);
  vi.mocked(prisma.usageSession.findMany).mockResolvedValue(sessions as never);
};

const sampleUser = {
  id: "u1",
  username: "alice",
  email: "alice@example.com",
  usagePreference: { timezone: "Asia/Shanghai" },
};

describe("GET /api/admin/weekly-export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAndRecord).mockReturnValue(true);
  });

  it("returns 401 when not signed in", async () => {
    mockSession(null);
    const res = await GET(
      new Request("http://localhost/api/admin/weekly-export"),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("UNAUTHORIZED");
  });

  it("returns 404 when signed in but not admin", async () => {
    mockSession("alice");
    mockIsAdmin(false);
    const res = await GET(
      new Request("http://localhost/api/admin/weekly-export"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 429 when rate-limited", async () => {
    mockSession("admin");
    mockIsAdmin(true);
    vi.mocked(checkAndRecord).mockReturnValue(false);
    const res = await GET(
      new Request("http://localhost/api/admin/weekly-export"),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("RATE_LIMITED");
  });

  it("returns CSV with BOM and proper headers on success", async () => {
    mockSession("admin");
    mockIsAdmin(true);
    mockPrisma([sampleUser], [], []);

    const res = await GET(
      new Request("http://localhost/api/admin/weekly-export"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(
      /^attachment; filename="tokenarena-weekly-\d{4}-W\d{2}\.csv"$/,
    );

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const body = new TextDecoder("utf-8").decode(bytes);
    expect(body.startsWith("username,email,timezone,")).toBe(true);
    expect(body).toContain("alice,alice@example.com,Asia/Shanghai");
    expect(body).toMatch(/,0,0,0,0,0,0,0,0,,\n$/);

    expect(logAdminAccess).toHaveBeenCalledWith({
      viewerId: "u1",
      targetUserId: "u1",
      action: "weekly_export",
    });
  });

  it("returns 500 when prisma throws", async () => {
    mockSession("admin");
    mockIsAdmin(true);
    vi.mocked(prisma.user.findMany).mockRejectedValue(new Error("db down"));
    const res = await GET(
      new Request("http://localhost/api/admin/weekly-export"),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("INTERNAL");
  });
});
