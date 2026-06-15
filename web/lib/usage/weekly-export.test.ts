import { describe, expect, it } from "vitest";

import { buildCsv, csvEscape, type WeeklyExportRow } from "./weekly-export";

describe("csvEscape", () => {
  it("returns plain text unchanged", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  it("wraps commas in quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
  });

  it("escapes embedded double quotes", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps newlines in quotes", () => {
    expect(csvEscape("a\nb")).toBe('"a\nb"');
  });

  it("wraps carriage returns in quotes", () => {
    expect(csvEscape("a\rb")).toBe('"a\rb"');
  });

  it("returns empty string unchanged", () => {
    expect(csvEscape("")).toBe("");
  });

  it("does not quote email-like strings", () => {
    expect(csvEscape("a@b.c")).toBe("a@b.c");
  });
});

const baseRow: WeeklyExportRow = {
  username: "alice",
  email: "alice@example.com",
  timezone: "Asia/Shanghai",
  inputTokens: 1000n,
  outputTokens: 2000n,
  reasoningTokens: 0n,
  cachedTokens: 500n,
  totalTokens: 3500n,
  estimatedCostUsd: 0.012345,
  activeDays: 3,
  sessionCount: 5,
  firstActiveAt: new Date("2026-06-15T01:23:45.000Z"),
  lastActiveAt: new Date("2026-06-19T10:00:00.000Z"),
};

describe("buildCsv", () => {
  it("starts with U+FEFF BOM", () => {
    const out = buildCsv([baseRow]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
  });

  it("emits header in fixed column order", () => {
    const out = buildCsv([baseRow]);
    const body = out.slice(1);
    const expectedHeader =
      "username,email,timezone,input_tokens,output_tokens,reasoning_tokens,cached_tokens,total_tokens,estimated_cost_usd,active_days,session_count,first_active_at,last_active_at";
    expect(body.startsWith(`${expectedHeader}\n`)).toBe(true);
  });

  it("formats BigInt as plain string without thousands separator", () => {
    const out = buildCsv([baseRow]);
    expect(out).toContain("1000,2000,0,500,3500");
  });

  it("preserves BigInt beyond Number.MAX_SAFE_INTEGER", () => {
    const huge: WeeklyExportRow = {
      ...baseRow,
      totalTokens: 9007199254740993n,
    };
    const out = buildCsv([huge]);
    expect(out).toContain("9007199254740993");
  });

  it("formats cost with 6 decimal places", () => {
    const out = buildCsv([baseRow]);
    expect(out).toContain("0.012345");
  });

  it("emits ISO 8601 UTC for active timestamps", () => {
    const out = buildCsv([baseRow]);
    expect(out).toContain("2026-06-15T01:23:45.000Z");
    expect(out).toContain("2026-06-19T10:00:00.000Z");
  });

  it("emits empty string for null first/last active timestamps", () => {
    const zero: WeeklyExportRow = {
      ...baseRow,
      firstActiveAt: null,
      lastActiveAt: null,
      activeDays: 0,
      sessionCount: 0,
    };
    const out = buildCsv([zero]);
    expect(out).toMatch(/,0,0,,\n$/);
  });

  it("escapes email with comma and embedded quote", () => {
    const weird: WeeklyExportRow = { ...baseRow, email: 'a,b"c@d.com' };
    const out = buildCsv([weird]);
    // csvEscape('a,b"c@d.com') wraps in quotes and doubles the embedded quote
    // → "\"a,b\"\"c@d.com\""
    expect(out).toContain('"a,b""c@d.com"');
  });

  it("returns header only when rows is empty", () => {
    const out = buildCsv([]);
    const lines = out.slice(1).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].split(",")).toHaveLength(13);
    expect(lines[1]).toBe("");
  });
});
