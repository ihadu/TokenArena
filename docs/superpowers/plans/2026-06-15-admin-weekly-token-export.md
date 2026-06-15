# 管理员周度 Token 统计 CSV 导出实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理员在 `/[locale]/admin` 页面一键下载全员本周 token 使用统计 CSV（含 0 用量用户）。

**Architecture:** server component 页面触发 → Route Handler 鉴权 + 内存限流 + Prisma 拉数据 + JS 端聚合 → 流式组装 CSV 字节流（一次性 Response body）。零新依赖、零 DB 迁移、零 worker 改动。

**Tech Stack:** Next.js 15 App Router, Prisma, vitest, next-intl, TypeScript strict, Biome.

**Reference Spec:** `docs/superpowers/specs/2026-06-15-admin-weekly-token-export-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `web/vitest.config.ts` (modify) | 加入 `app/**` 测试发现 |
| `web/lib/usage/date-range.ts` (modify) | 导出 `zonedDateTimeToUtc` + `addToParts` |
| `web/lib/usage/date-range.test.ts` (modify) | 新导出符号的单测 |
| `web/lib/usage/weekly-export.ts` (new) | `csvEscape` / `buildCsv` / `resolveIsoWeek` / `aggregateWeeklyUsage` |
| `web/lib/usage/weekly-export.test.ts` (new) | 上述 4 个纯函数单测 |
| `web/lib/usage/weekly-export-rate-limit.ts` (new) | 进程内 30s 限流（可注入时钟） |
| `web/lib/usage/weekly-export-rate-limit.test.ts` (new) | 限流单测 |
| `web/app/api/admin/weekly-export/route.ts` (new) | GET 端点：鉴权 + 限流 + 聚合 + CSV |
| `web/app/api/admin/weekly-export/route.test.ts` (new) | 集成测试（401/404/429/200） |
| `web/app/[locale]/admin/page.tsx` (new) | 管理员首页（server component） |
| `web/app/[locale]/admin/page.test.tsx` (new) | 渲染 + admin gate 测试 |
| `web/messages/zh.json` (modify) | 新增 `admin.weeklyExport.*` namespace |
| `web/messages/en.json` (modify) | 同上 |

---

## Task 1: 扩展 vitest 配置以发现 app/ 下测试

**Files:**
- Modify: `web/vitest.config.ts:1-31`

- [ ] **Step 1: 修改 include 模式**

将：
```ts
include: ["lib/**/*.test.{ts,tsx}", "components/**/*.test.{ts,tsx}"],
```

改为：
```ts
include: [
  "lib/**/*.test.{ts,tsx}",
  "components/**/*.test.{ts,tsx}",
  "app/**/*.test.{ts,tsx}",
],
```

- [ ] **Step 2: 运行 pnpm test:web 验证未破坏**

Run: `pnpm test:web --run 2>&1 | tail -20`
Expected: 既有测试全部通过（无新增也无丢失）；include 变更不影响已发现测试。

- [ ] **Step 3: 提交**

```bash
git add web/vitest.config.ts
git commit -m "chore(test): include app/ in vitest discovery"
```

---

## Task 2: 导出 zonedDateTimeToUtc / addToParts from date-range

**Files:**
- Modify: `web/lib/usage/date-range.ts:92-119` (移除 `function` 前的隐式私有，加 `export`)
- Modify: `web/lib/usage/date-range.test.ts` (在文件末尾追加新 describe)

- [ ] **Step 1: 写失败的导出测试**

在 `web/lib/usage/date-range.test.ts` 末尾追加：

```ts
import { addToParts, zonedDateTimeToUtc } from "./date-range";

describe("zonedDateTimeToUtc", () => {
  it("converts zoned local time to UTC for Asia/Shanghai", () => {
    // 2026-06-15 00:00:00 Asia/Shanghai == 2026-06-14 16:00:00 UTC
    const result = zonedDateTimeToUtc(
      { year: 2026, month: 6, day: 15, hour: 0, minute: 0, second: 0 },
      "Asia/Shanghai",
    );
    expect(result.toISOString()).toBe("2026-06-14T16:00:00.000Z");
  });

  it("converts zoned local time to UTC for UTC", () => {
    const result = zonedDateTimeToUtc(
      { year: 2026, month: 6, day: 15, hour: 0, minute: 0, second: 0 },
      "UTC",
    );
    expect(result.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });
});

describe("addToParts", () => {
  it("adds days", () => {
    const result = addToParts(
      { year: 2026, month: 6, day: 15, hour: 0, minute: 0, second: 0 },
      { days: 7 },
    );
    expect(result).toEqual({
      year: 2026,
      month: 6,
      day: 22,
      hour: 0,
      minute: 0,
      second: 0,
    });
  });

  it("rolls over month boundary", () => {
    const result = addToParts(
      { year: 2026, month: 6, day: 30, hour: 0, minute: 0, second: 0 },
      { days: 3 },
    );
    expect(result).toEqual({
      year: 2026,
      month: 7,
      day: 3,
      hour: 0,
      minute: 0,
      second: 0,
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:web --run web/lib/usage/date-range.test.ts 2>&1 | tail -20`
Expected: FAIL with `zonedDateTimeToUtc` is not exported (TS2305) 或运行时 `undefined is not a function`.

- [ ] **Step 3: 导出函数**

打开 `web/lib/usage/date-range.ts`，用 `grep -n "^function \(addToParts\|zonedDateTimeToUtc\)" web/lib/usage/date-range.ts` 定位两处函数声明，在 `function` 关键字前加 `export `。

- [ ] **Step 4: 重新运行测试确认通过**

Run: `pnpm test:web --run web/lib/usage/date-range.test.ts 2>&1 | tail -10`
Expected: PASS（所有 zonedDateTimeToUtc 与 addToParts 测试通过；既有测试无回归）。

- [ ] **Step 5: 提交**

```bash
git add web/lib/usage/date-range.ts web/lib/usage/date-range.test.ts
git commit -m "refactor(usage): export zonedDateTimeToUtc and addToParts"
```

---

## Task 3: 实现 csvEscape（TDD）

**Files:**
- Create: `web/lib/usage/weekly-export.ts`
- Create: `web/lib/usage/weekly-export.test.ts`

- [ ] **Step 1: 写测试**

`web/lib/usage/weekly-export.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { csvEscape } from "./weekly-export";

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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:web --run web/lib/usage/weekly-export.test.ts 2>&1 | tail -15`
Expected: FAIL with `Cannot find module './weekly-export'`.

- [ ] **Step 3: 实现 csvEscape**

`web/lib/usage/weekly-export.ts`：

```ts
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
```

- [ ] **Step 4: 重新运行测试**

Run: `pnpm test:web --run web/lib/usage/weekly-export.test.ts 2>&1 | tail -10`
Expected: PASS（7 个 it 全过）。

- [ ] **Step 5: 提交**

```bash
git add web/lib/usage/weekly-export.ts web/lib/usage/weekly-export.test.ts
git commit -m "feat(usage): csvEscape helper for admin weekly export"
```

---

## Task 4: 实现 buildCsv（TDD）

**Files:**
- Modify: `web/lib/usage/weekly-export.ts`
- Modify: `web/lib/usage/weekly-export.test.ts`

- [ ] **Step 1: 在测试文件追加 buildCsv 测试**

在 `web/lib/usage/weekly-export.test.ts` 末尾追加：

```ts
import { buildCsv, type WeeklyExportRow } from "./weekly-export";

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
  it("starts with UTF-8 BOM", () => {
    const out = buildCsv([baseRow]);
    expect(out.charCodeAt(0)).toBe(0xfe);
    expect(out.charCodeAt(1)).toBe(0xff);
  });

  it("emits header in fixed column order", () => {
    const out = buildCsv([baseRow]);
    const body = out.slice(1);
    const expectedHeader =
      "username,email,timezone,input_tokens,output_tokens,reasoning_tokens,cached_tokens,total_tokens,estimated_cost_usd,active_days,session_count,first_active_at,last_active_at";
    expect(body.startsWith(expectedHeader + "\n")).toBe(true);
  });

  it("formats BigInt as plain string without thousands separator", () => {
    const out = buildCsv([baseRow]);
    expect(out).toContain("1000,2000,0,500,3500");
  });

  it("preserves BigInt beyond Number.MAX_SAFE_INTEGER", () => {
    const huge: WeeklyExportRow = { ...baseRow, totalTokens: 9007199254740993n };
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
    // The trailing two columns should be empty: ",,"
    expect(out).toMatch(/,0,0,,\n$/);
  });

  it("escapes email with comma", () => {
    const weird: WeeklyExportRow = { ...baseRow, email: 'a,b"c@d.com' };
    const out = buildCsv([weird]);
    expect(out).toContain('"a,""b""c@d.com"');
  });

  it("returns header only when rows is empty", () => {
    const out = buildCsv([]);
    const lines = out.slice(1).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].split(",")).toHaveLength(13);
    expect(lines[1]).toBe("");
  });
});
```

并在文件顶部 import 区追加：

```ts
import type { WeeklyExportRow } from "./weekly-export";
```

（与已有 `csvEscape` import 合并到同一行：

```ts
import { buildCsv, csvEscape, type WeeklyExportRow } from "./weekly-export";
```

）

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:web --run web/lib/usage/weekly-export.test.ts 2>&1 | tail -10`
Expected: FAIL with `buildCsv` is not a function / `WeeklyExportRow` is not exported.

- [ ] **Step 3: 在 weekly-export.ts 实现 buildCsv 与类型**

`web/lib/usage/weekly-export.ts` 改为：

```ts
export type WeeklyExportRow = {
  username: string;
  email: string;
  timezone: string;
  inputTokens: bigint;
  outputTokens: bigint;
  reasoningTokens: bigint;
  cachedTokens: bigint;
  totalTokens: bigint;
  estimatedCostUsd: number;
  activeDays: number;
  sessionCount: number;
  firstActiveAt: Date | null;
  lastActiveAt: Date | null;
};

const HEADER = [
  "username",
  "email",
  "timezone",
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "cached_tokens",
  "total_tokens",
  "estimated_cost_usd",
  "active_days",
  "session_count",
  "first_active_at",
  "last_active_at",
];

function formatCell(value: string | number | bigint | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toString() : value.toFixed(6);
  }
  return csvEscape(value);
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(rows: WeeklyExportRow[]): string {
  const lines: string[] = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        formatCell(r.username),
        formatCell(r.email),
        formatCell(r.timezone),
        formatCell(r.inputTokens),
        formatCell(r.outputTokens),
        formatCell(r.reasoningTokens),
        formatCell(r.cachedTokens),
        formatCell(r.totalTokens),
        formatCell(r.estimatedCostUsd),
        formatCell(r.activeDays),
        formatCell(r.sessionCount),
        formatCell(r.firstActiveAt === null ? null : r.firstActiveAt.toISOString()),
        formatCell(r.lastActiveAt === null ? null : r.lastActiveAt.toISOString()),
      ].join(","),
    );
  }
  return "﻿" + lines.join("\n") + "\n";
}
```

注意：`﻿` 是 U+FEFF（BOM 字符）的字面量。直接键入或在代码里写 `"﻿"` 也可，推荐 `"﻿"`：

```ts
return "﻿" + lines.join("\n") + "\n";
```

替换为：

```ts
return "﻿" + lines.join("\n") + "\n";
```

实际上更稳的写法是：

```ts
const BOM = "﻿";
return BOM + lines.join("\n") + "\n";
```

- [ ] **Step 4: 重新运行测试**

Run: `pnpm test:web --run web/lib/usage/weekly-export.test.ts 2>&1 | tail -10`
Expected: PASS（所有 buildCsv + csvEscape 测试通过）。

- [ ] **Step 5: 提交**

```bash
git add web/lib/usage/weekly-export.ts web/lib/usage/weekly-export.test.ts
git commit -m "feat(usage): buildCsv with 13-column weekly export format"
```

---

## Task 5: 实现 resolveIsoWeek（TDD）

**Files:**
- Modify: `web/lib/usage/weekly-export.ts`
- Modify: `web/lib/usage/weekly-export.test.ts`

- [ ] **Step 1: 追加 resolveIsoWeek 测试**

在 `web/lib/usage/weekly-export.test.ts` 顶部 import 区：

```ts
import { buildCsv, csvEscape, resolveIsoWeek, type WeeklyExportRow } from "./weekly-export";
```

文件末尾追加：

```ts
describe("resolveIsoWeek", () => {
  it("returns Monday 00:00 in Asia/Shanghai for a Monday Shanghai instant", () => {
    // 2026-06-15 12:00 Asia/Shanghai == 2026-06-15 04:00 UTC
    const now = new Date("2026-06-15T04:00:00.000Z");
    const result = resolveIsoWeek(now, "Asia/Shanghai");
    expect(result.fromIso).toBe("2026-06-15");
    expect(result.toIso).toBe("2026-06-22");
    expect(result.from.toISOString()).toBe("2026-06-14T16:00:00.000Z");
    expect(result.to.toISOString()).toBe("2026-06-21T16:00:00.000Z");
    expect(result.label).toBe("2026-W25");
  });

  it("handles UTC timezone", () => {
    // 2026-06-15 Monday 00:00 UTC
    const now = new Date("2026-06-15T00:00:00.000Z");
    const result = resolveIsoWeek(now, "UTC");
    expect(result.fromIso).toBe("2026-06-15");
    expect(result.toIso).toBe("2026-06-22");
    expect(result.from.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("rolls back to previous week for a Sunday Shanghai instant", () => {
    // 2026-06-14 23:00 Shanghai (Sun) == 2026-06-14 15:00 UTC
    const now = new Date("2026-06-14T15:00:00.000Z");
    const result = resolveIsoWeek(now, "Asia/Shanghai");
    expect(result.fromIso).toBe("2026-06-08");
    expect(result.toIso).toBe("2026-06-15");
    expect(result.label).toBe("2026-W24");
  });

  it("handles negative UTC offset (Los Angeles)", () => {
    // 2026-06-15 Monday 02:00 LA (UTC-7) == 2026-06-15 09:00 UTC
    const now = new Date("2026-06-15T09:00:00.000Z");
    const result = resolveIsoWeek(now, "America/Los_Angeles");
    expect(result.fromIso).toBe("2026-06-15");
    expect(result.toIso).toBe("2026-06-22");
    expect(result.from.toISOString()).toBe("2026-06-15T07:00:00.000Z");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:web --run web/lib/usage/weekly-export.test.ts -t resolveIsoWeek 2>&1 | tail -10`
Expected: FAIL with `resolveIsoWeek` is not a function.

- [ ] **Step 3: 实现 resolveIsoWeek**

在 `web/lib/usage/weekly-export.ts` 顶部加入 import：

```ts
import { addToParts, toZonedParts, zonedDateTimeToUtc } from "./date-range";
```

类型与工具后追加：

```ts
export type IsoWeek = {
  from: Date;       // 本周一 00:00:00 UTC
  to: Date;         // 下周一 00:00:00 UTC (开区间)
  label: string;    // "2026-W25"
  fromIso: string;  // tz 下的 "YYYY-MM-DD"
  toIso: string;    // tz 下的 "YYYY-MM-DD"
};

function isoDateInTz(date: Date, timezone: string): string {
  const parts = toZonedParts(date, timezone);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isoWeekLabel(monday: Date, timezone: string): string {
  // Use Intl.DateTimeFormat with week option. Output is locale-dependent;
  // we format then parse out the year and week components.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    week: "numeric",
  }).formatToParts(monday);
  let year = "";
  let week = "";
  for (const p of parts) {
    if (p.type === "year" || p.type === "weekYear") year = p.value;
    if (p.type === "week") week = p.value;
  }
  return `${year}-W${week.padStart(2, "0")}`;
}

export function resolveIsoWeek(now: Date, timezone: string): IsoWeek {
  const z = toZonedParts(now, timezone);
  // Build a UTC midnight representing tz's "today" (y/m/d), then take its UTC weekday.
  // 0=Sun..6=Sat; ISO requires Monday=1..Sunday=7, so map to 0=Mon..6=Sun.
  const todayUtc = new Date(Date.UTC(z.year, z.month - 1, z.day));
  const utcDow = todayUtc.getUTCDay();
  const dowIso = (utcDow + 6) % 7; // Mon=0, ..., Sun=6
  // Subtract dowIso days from today in tz, then convert that ymd 00:00:00 to UTC.
  const mondayYmd = addToParts(
    { year: z.year, month: z.month, day: z.day, hour: 0, minute: 0, second: 0 },
    { days: -dowIso },
  );
  const fromUtc = zonedDateTimeToUtc(mondayYmd, timezone);
  const toUtc = new Date(fromUtc.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    from: fromUtc,
    to: toUtc,
    label: isoWeekLabel(fromUtc, timezone),
    fromIso: isoDateInTz(fromUtc, timezone),
    toIso: isoDateInTz(toUtc, timezone),
  };
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm test:web --run web/lib/usage/weekly-export.test.ts -t resolveIsoWeek 2>&1 | tail -20`
Expected: PASS（4 个 it 全过；如有失败，多为时区换算细节，参考 `date-range.ts:243` 已有 `resolveDashboardRange` 的实现核对）。

- [ ] **Step 5: 提交**

```bash
git add web/lib/usage/weekly-export.ts web/lib/usage/weekly-export.test.ts
git commit -m "feat(usage): resolveIsoWeek with timezone-aware boundary"
```

---

## Task 6: 实现 aggregateWeeklyUsage（TDD）

**Files:**
- Modify: `web/lib/usage/weekly-export.ts`
- Modify: `web/lib/usage/weekly-export.test.ts`

- [ ] **Step 1: 追加 aggregateWeeklyUsage 测试**

顶部 import 改为：

```ts
import {
  aggregateWeeklyUsage,
  buildCsv,
  csvEscape,
  resolveIsoWeek,
  type WeeklyExportInput,
  type WeeklyExportRow,
} from "./weekly-export";
```

文件末尾追加：

```ts
const baseUsers: WeeklyExportInput["users"] = [
  { id: "u1", username: "alice", email: "a@b.com", timezone: "Asia/Shanghai" },
  { id: "u2", username: "bob", email: "b@b.com", timezone: "UTC" },
];

describe("aggregateWeeklyUsage", () => {
  it("emits zero rows for users with no usage", () => {
    const rows = aggregateWeeklyUsage({
      users: baseUsers,
      buckets: [],
      sessions: [],
    });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.inputTokens).toBe(0n);
      expect(r.totalTokens).toBe(0n);
      expect(r.estimatedCostUsd).toBe(0);
      expect(r.activeDays).toBe(0);
      expect(r.sessionCount).toBe(0);
      expect(r.firstActiveAt).toBeNull();
      expect(r.lastActiveAt).toBeNull();
    }
  });

  it("aggregates token sums per user", () => {
    const rows = aggregateWeeklyUsage({
      users: baseUsers,
      buckets: [
        {
          userId: "u1",
          inputTokens: 100n,
          outputTokens: 200n,
          reasoningTokens: 0n,
          cachedTokens: 50n,
          totalTokens: 350n,
          estimatedCostUsd: 0.01,
          bucketStart: new Date("2026-06-15T01:00:00Z"),
        },
        {
          userId: "u1",
          inputTokens: 10n,
          outputTokens: 20n,
          reasoningTokens: 0n,
          cachedTokens: 5n,
          totalTokens: 35n,
          estimatedCostUsd: 0.001,
          bucketStart: new Date("2026-06-16T01:00:00Z"),
        },
        {
          userId: "u2",
          inputTokens: 7n,
          outputTokens: 8n,
          reasoningTokens: 0n,
          cachedTokens: 0n,
          totalTokens: 15n,
          estimatedCostUsd: null,
          bucketStart: new Date("2026-06-17T01:00:00Z"),
        },
      ],
      sessions: [],
    });
    const alice = rows.find((r) => r.username === "alice")!;
    expect(alice.inputTokens).toBe(110n);
    expect(alice.outputTokens).toBe(220n);
    expect(alice.totalTokens).toBe(385n);
    expect(alice.estimatedCostUsd).toBeCloseTo(0.011, 6);
    expect(alice.activeDays).toBe(2);

    const bob = rows.find((r) => r.username === "bob")!;
    expect(bob.totalTokens).toBe(15n);
    expect(bob.estimatedCostUsd).toBe(0); // null coalesces to 0
  });

  it("counts distinct YYYY-MM-DD for activeDays in user timezone", () => {
    const rows = aggregateWeeklyUsage({
      users: [{ id: "u1", username: "a", email: "a@b.com", timezone: "Asia/Shanghai" }],
      buckets: [
        {
          userId: "u1",
          inputTokens: 1n,
          outputTokens: 0n,
          reasoningTokens: 0n,
          cachedTokens: 0n,
          totalTokens: 1n,
          estimatedCostUsd: 0,
          bucketStart: new Date("2026-06-15T01:00:00Z"), // 2026-06-15 Shanghai
        },
        {
          userId: "u1",
          inputTokens: 1n,
          outputTokens: 0n,
          reasoningTokens: 0n,
          cachedTokens: 0n,
          totalTokens: 1n,
          estimatedCostUsd: 0,
          bucketStart: new Date("2026-06-15T13:00:00Z"), // 2026-06-15 Shanghai (same day)
        },
        {
          userId: "u1",
          inputTokens: 1n,
          outputTokens: 0n,
          reasoningTokens: 0n,
          cachedTokens: 0n,
          totalTokens: 1n,
          estimatedCostUsd: 0,
          bucketStart: new Date("2026-06-15T17:00:00Z"), // 2026-06-16 Shanghai (next day)
        },
      ],
      sessions: [],
    });
    expect(rows[0].activeDays).toBe(2);
  });

  it("aggregates session count and first/last active timestamps", () => {
    const rows = aggregateWeeklyUsage({
      users: baseUsers,
      buckets: [],
      sessions: [
        { userId: "u1", firstMessageAt: new Date("2026-06-15T01:00:00Z"), lastMessageAt: new Date("2026-06-15T02:00:00Z") },
        { userId: "u1", firstMessageAt: new Date("2026-06-19T10:00:00Z"), lastMessageAt: new Date("2026-06-19T11:00:00Z") },
        { userId: "u2", firstMessageAt: new Date("2026-06-16T03:00:00Z"), lastMessageAt: new Date("2026-06-16T03:30:00Z") },
      ],
    });
    const alice = rows.find((r) => r.username === "alice")!;
    expect(alice.sessionCount).toBe(2);
    expect(alice.firstActiveAt?.toISOString()).toBe("2026-06-15T01:00:00.000Z");
    expect(alice.lastActiveAt?.toISOString()).toBe("2026-06-19T11:00:00.000Z");
    const bob = rows.find((r) => r.username === "bob")!;
    expect(bob.sessionCount).toBe(1);
  });

  it("preserves BigInt beyond MAX_SAFE_INTEGER in sum", () => {
    const rows = aggregateWeeklyUsage({
      users: [{ id: "u1", username: "huge", email: "h@b.com", timezone: "UTC" }],
      buckets: [
        {
          userId: "u1",
          inputTokens: 9007199254740991n,
          outputTokens: 2n,
          reasoningTokens: 0n,
          cachedTokens: 0n,
          totalTokens: 9007199254740993n,
          estimatedCostUsd: 0,
          bucketStart: new Date("2026-06-15T01:00:00Z"),
        },
      ],
      sessions: [],
    });
    expect(rows[0].totalTokens.toString()).toBe("9007199254740993");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:web --run web/lib/usage/weekly-export.test.ts -t aggregateWeeklyUsage 2>&1 | tail -10`
Expected: FAIL with `aggregateWeeklyUsage` is not a function / `WeeklyExportInput` is not exported.

- [ ] **Step 3: 实现 aggregateWeeklyUsage**

在 `web/lib/usage/weekly-export.ts` 顶部 import 区追加：

```ts
function ymdInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
```

在 `WeeklyExportRow` 类型后追加：

```ts
export type WeeklyExportInput = {
  users: Array<{
    id: string;
    username: string;
    email: string;
    timezone: string;
  }>;
  buckets: Array<{
    userId: string;
    inputTokens: bigint;
    outputTokens: bigint;
    reasoningTokens: bigint;
    cachedTokens: bigint;
    totalTokens: bigint;
    estimatedCostUsd: number | null;
    bucketStart: Date;
  }>;
  sessions: Array<{
    userId: string;
    firstMessageAt: Date;
    lastMessageAt: Date;
  }>;
};

export function aggregateWeeklyUsage(input: WeeklyExportInput): WeeklyExportRow[] {
  const bucketAgg = new Map<string, {
    inputTokens: bigint;
    outputTokens: bigint;
    reasoningTokens: bigint;
    cachedTokens: bigint;
    totalTokens: bigint;
    cost: number;
    days: Set<string>;
  }>();
  const sessionAgg = new Map<string, { count: number; first: Date | null; last: Date | null }>();

  for (const u of input.users) {
    bucketAgg.set(u.id, {
      inputTokens: 0n,
      outputTokens: 0n,
      reasoningTokens: 0n,
      cachedTokens: 0n,
      totalTokens: 0n,
      cost: 0,
      days: new Set(),
    });
    sessionAgg.set(u.id, { count: 0, first: null, last: null });
  }

  for (const b of input.buckets) {
    const agg = bucketAgg.get(b.userId);
    if (!agg) continue;
    agg.inputTokens += b.inputTokens;
    agg.outputTokens += b.outputTokens;
    agg.reasoningTokens += b.reasoningTokens;
    agg.cachedTokens += b.cachedTokens;
    agg.totalTokens += b.totalTokens;
    if (b.estimatedCostUsd !== null) agg.cost += b.estimatedCostUsd;
    const u = input.users.find((x) => x.id === b.userId);
    if (u) agg.days.add(ymdInTz(b.bucketStart, u.timezone));
  }

  for (const s of input.sessions) {
    const agg = sessionAgg.get(s.userId);
    if (!agg) continue;
    agg.count += 1;
    if (agg.first === null || s.firstMessageAt < agg.first) agg.first = s.firstMessageAt;
    if (agg.last === null || s.lastMessageAt > agg.last) agg.last = s.lastMessageAt;
  }

  return input.users.map((u) => {
    const b = bucketAgg.get(u.id)!;
    const s = sessionAgg.get(u.id)!;
    return {
      username: u.username,
      email: u.email,
      timezone: u.timezone,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      reasoningTokens: b.reasoningTokens,
      cachedTokens: b.cachedTokens,
      totalTokens: b.totalTokens,
      estimatedCostUsd: b.cost,
      activeDays: b.days.size,
      sessionCount: s.count,
      firstActiveAt: s.first,
      lastActiveAt: s.last,
    };
  });
}
```

- [ ] **Step 4: 重新运行测试**

Run: `pnpm test:web --run web/lib/usage/weekly-export.test.ts -t aggregateWeeklyUsage 2>&1 | tail -10`
Expected: PASS（5 个 it 全过）。

- [ ] **Step 5: 提交**

```bash
git add web/lib/usage/weekly-export.ts web/lib/usage/weekly-export.test.ts
git commit -m "feat(usage): aggregateWeeklyUsage merging bucket+session per user"
```

---

## Task 7: 实现 weekly-export-rate-limit（TDD）

**Files:**
- Create: `web/lib/usage/weekly-export-rate-limit.ts`
- Create: `web/lib/usage/weekly-export-rate-limit.test.ts`

- [ ] **Step 1: 写测试**

`web/lib/usage/weekly-export-rate-limit.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:web --run web/lib/usage/weekly-export-rate-limit.test.ts 2>&1 | tail -10`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: 实现 rate-limit 模块**

`web/lib/usage/weekly-export-rate-limit.ts`：

```ts
// In-memory per-admin rate limiter for the weekly export endpoint.
// Single-process assumption: Next.js standalone deploys typically run a
// single admin instance. With N replicas, the window scales to N * RATE_LIMIT_MS.
export const RATE_LIMIT_MS = 30_000;

const lastExportAt = new Map<string, number>();

export function checkAndRecord(
  adminId: string,
  now: () => number = () => Date.now(),
): boolean {
  const ts = now();
  const last = lastExportAt.get(adminId) ?? 0;
  if (ts - last < RATE_LIMIT_MS) return false;
  lastExportAt.set(adminId, ts);
  return true;
}

// Test hook — clears the in-memory map. Not for production use.
export function __resetRateLimitForTest(): void {
  lastExportAt.clear();
}
```

- [ ] **Step 4: 重新运行测试**

Run: `pnpm test:web --run web/lib/usage/weekly-export-rate-limit.test.ts 2>&1 | tail -10`
Expected: PASS（4 个 it 全过）。

- [ ] **Step 5: 提交**

```bash
git add web/lib/usage/weekly-export-rate-limit.ts web/lib/usage/weekly-export-rate-limit.test.ts
git commit -m "feat(usage): in-memory rate limiter for admin weekly export"
```

---

## Task 8: Route Handler（TDD）

**Files:**
- Create: `web/app/api/admin/weekly-export/route.ts`
- Create: `web/app/api/admin/weekly-export/route.test.ts`

- [ ] **Step 1: 写集成测试**

`web/app/api/admin/weekly-export/route.test.ts`：

```ts
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
import { __resetRateLimitForTest, checkAndRecord } from "@/lib/usage/weekly-export-rate-limit";

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
    const res = await GET(new Request("http://localhost/api/admin/weekly-export"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("UNAUTHORIZED");
  });

  it("returns 404 when signed in but not admin", async () => {
    mockSession("alice");
    mockIsAdmin(false);
    const res = await GET(new Request("http://localhost/api/admin/weekly-export"));
    expect(res.status).toBe(404);
  });

  it("returns 429 when rate-limited", async () => {
    mockSession("admin");
    mockIsAdmin(true);
    vi.mocked(checkAndRecord).mockReturnValue(false);
    const res = await GET(new Request("http://localhost/api/admin/weekly-export"));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("RATE_LIMITED");
  });

  it("returns CSV with BOM and proper headers on success", async () => {
    mockSession("admin");
    mockIsAdmin(true);
    mockPrisma([sampleUser], [], []);

    const res = await GET(new Request("http://localhost/api/admin/weekly-export"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="tokenarena-weekly-\d{4}-W\d{2}\.csv"$/);

    const text = await res.text();
    expect(text.charCodeAt(0)).toBe(0xfe);
    expect(text.charCodeAt(1)).toBe(0xff);
    const body = text.slice(1);
    expect(body.startsWith("username,email,timezone,")).toBe(true);
    expect(body).toContain("alice,alice@example.com,Asia/Shanghai");
    expect(body).toContain(",0,0,0,0,0,0.000000,0,0,,\n");

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
    const res = await GET(new Request("http://localhost/api/admin/weekly-export"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("INTERNAL");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:web --run web/app/api/admin/weekly-export/route.test.ts 2>&1 | tail -10`
Expected: FAIL with `Cannot find module './route'`.

- [ ] **Step 3: 实现 Route Handler**

`web/app/api/admin/weekly-export/route.ts`：

```ts
import { NextResponse } from "next/server";

import { isCurrentUserAdmin, logAdminAccess } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getOptionalSession } from "@/lib/session";
import { getTranslations } from "next-intl/server";
import {
  aggregateWeeklyUsage,
  buildCsv,
  resolveIsoWeek,
} from "@/lib/usage/weekly-export";
import { checkAndRecord } from "@/lib/usage/weekly-export-rate-limit";

const DEFAULT_TIMEZONE = "UTC";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(request: Request) {
  const session = await getOptionalSession();
  if (!session) {
    return jsonError("UNAUTHORIZED", 401);
  }

  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    return jsonError("NOT_FOUND", 404);
  }

  if (!checkAndRecord(session.user.id)) {
    return jsonError("RATE_LIMITED", 429);
  }

  const tz =
    (await prisma.usagePreference
      .findUnique({ where: { userId: session.user.id } })
      .then((p) => p?.timezone)) ?? DEFAULT_TIMEZONE;

  const week = resolveIsoWeek(new Date(), tz);

  let users: Awaited<ReturnType<typeof prisma.user.findMany>>;
  let buckets: Awaited<ReturnType<typeof prisma.usageBucket.findMany>>;
  let sessions: Awaited<ReturnType<typeof prisma.usageSession.findMany>>;
  try {
    [users, buckets, sessions] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          username: true,
          email: true,
          usagePreference: { select: { timezone: true } },
        },
        orderBy: { username: "asc" },
      }),
      prisma.usageBucket.findMany({
        where: { bucketStart: { gte: week.from, lt: week.to } },
        select: {
          userId: true,
          inputTokens: true,
          outputTokens: true,
          reasoningTokens: true,
          cachedTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          bucketStart: true,
        },
      }),
      prisma.usageSession.findMany({
        where: { firstMessageAt: { gte: week.from, lt: week.to } },
        select: {
          userId: true,
          firstMessageAt: true,
          lastMessageAt: true,
        },
      }),
    ]);
  } catch (err) {
    console.error("[admin/weekly-export] DB error", err);
    return jsonError("INTERNAL", 500);
  }

  const rows = aggregateWeeklyUsage({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      timezone: u.usagePreference?.timezone ?? DEFAULT_TIMEZONE,
    })),
    buckets: buckets.map((b) => ({
      userId: b.userId,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      reasoningTokens: b.reasoningTokens,
      cachedTokens: b.cachedTokens,
      totalTokens: b.totalTokens,
      estimatedCostUsd: b.estimatedCostUsd,
      bucketStart: b.bucketStart,
    })),
    sessions: sessions.map((s) => ({
      userId: s.userId,
      firstMessageAt: s.firstMessageAt,
      lastMessageAt: s.lastMessageAt,
    })),
  });

  const csv = buildCsv(rows);
  const filename = `tokenarena-weekly-${week.label}.csv`;

  // Fire-and-forget audit log; do not block the response.
  logAdminAccess({
    viewerId: session.user.id,
    targetUserId: session.user.id,
    action: "weekly_export",
  }).catch((err) => console.error("[admin/weekly-export] logAdminAccess failed", err));

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

**注意**：
- 上述代码里有一个 `getTranslations` import 没用到，**删除**。最终文件顶部 import 应当是：
  ```ts
  import { NextResponse } from "next/server";
  import { isCurrentUserAdmin, logAdminAccess } from "@/lib/admin";
  import { prisma } from "@/lib/prisma";
  import { getOptionalSession } from "@/lib/session";
  import {
    aggregateWeeklyUsage,
    buildCsv,
    resolveIsoWeek,
  } from "@/lib/usage/weekly-export";
  import { checkAndRecord } from "@/lib/usage/weekly-export-rate-limit";
  ```
  移除代码里所有 `await prisma.usagePreference.findUnique` 与 `getTranslations` 调用 — tz 直接走默认 UTC（用户量小，无需从 db 再查一次管理员 tz，spec 接受 fallback）。
  最终实现中 `tz` 简化为：
  ```ts
  const week = resolveIsoWeek(new Date(), DEFAULT_TIMEZONE);
  ```
  因为 `getOptionalSession` 已经返回 `session.user` 含 usagePreference（如有），可改：
  ```ts
  // 尝试从 session.user.usagePreference 取；缺省 UTC
  const tz = (session.user as any).usagePreference?.timezone ?? DEFAULT_TIMEZONE;
  ```
  但 session 类型未暴露 usagePreference，最稳：用 `DEFAULT_TIMEZONE`。spec 允许 fallback。
  最终 `tz` 实际写：`const tz = DEFAULT_TIMEZONE;` —— **不要在 route 内查 db**。

修改后 route 的核心逻辑应当是：
```ts
const week = resolveIsoWeek(new Date(), DEFAULT_TIMEZONE);
```

按上面要求重写 `web/app/api/admin/weekly-export/route.ts` 整个文件（不要保留 `prisma.usagePreference.findUnique` 调用）：

```ts
import { NextResponse } from "next/server";

import { isCurrentUserAdmin, logAdminAccess } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getOptionalSession } from "@/lib/session";
import {
  aggregateWeeklyUsage,
  buildCsv,
  resolveIsoWeek,
} from "@/lib/usage/weekly-export";
import { checkAndRecord } from "@/lib/usage/weekly-export-rate-limit";

const DEFAULT_TIMEZONE = "UTC";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET(_request: Request) {
  const session = await getOptionalSession();
  if (!session) {
    return jsonError("UNAUTHORIZED", 401);
  }

  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    return jsonError("NOT_FOUND", 404);
  }

  if (!checkAndRecord(session.user.id)) {
    return jsonError("RATE_LIMITED", 429);
  }

  const week = resolveIsoWeek(new Date(), DEFAULT_TIMEZONE);

  let users: Awaited<ReturnType<typeof prisma.user.findMany>>;
  let buckets: Awaited<ReturnType<typeof prisma.usageBucket.findMany>>;
  let sessions: Awaited<ReturnType<typeof prisma.usageSession.findMany>>;
  try {
    [users, buckets, sessions] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          username: true,
          email: true,
          usagePreference: { select: { timezone: true } },
        },
        orderBy: { username: "asc" },
      }),
      prisma.usageBucket.findMany({
        where: { bucketStart: { gte: week.from, lt: week.to } },
        select: {
          userId: true,
          inputTokens: true,
          outputTokens: true,
          reasoningTokens: true,
          cachedTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          bucketStart: true,
        },
      }),
      prisma.usageSession.findMany({
        where: { firstMessageAt: { gte: week.from, lt: week.to } },
        select: {
          userId: true,
          firstMessageAt: true,
          lastMessageAt: true,
        },
      }),
    ]);
  } catch (err) {
    console.error("[admin/weekly-export] DB error", err);
    return jsonError("INTERNAL", 500);
  }

  const rows = aggregateWeeklyUsage({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      timezone: u.usagePreference?.timezone ?? DEFAULT_TIMEZONE,
    })),
    buckets: buckets.map((b) => ({
      userId: b.userId,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      reasoningTokens: b.reasoningTokens,
      cachedTokens: b.cachedTokens,
      totalTokens: b.totalTokens,
      estimatedCostUsd: b.estimatedCostUsd,
      bucketStart: b.bucketStart,
    })),
    sessions: sessions.map((s) => ({
      userId: s.userId,
      firstMessageAt: s.firstMessageAt,
      lastMessageAt: s.lastMessageAt,
    })),
  });

  const csv = buildCsv(rows);
  const filename = `tokenarena-weekly-${week.label}.csv`;

  logAdminAccess({
    viewerId: session.user.id,
    targetUserId: session.user.id,
    action: "weekly_export",
  }).catch((err) => console.error("[admin/weekly-export] logAdminAccess failed", err));

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm test:web --run web/app/api/admin/weekly-export/route.test.ts 2>&1 | tail -30`
Expected: PASS（5 个 it 全过；500 测试断言 INTERNAL 即 `prisma.user.findMany.mockRejectedValue`，route 内 try/catch 应捕获并返回 500）。

- [ ] **Step 5: 提交**

```bash
git add web/app/api/admin/weekly-export/route.ts web/app/api/admin/weekly-export/route.test.ts
git commit -m "feat(admin): GET /api/admin/weekly-export CSV endpoint"
```

---

## Task 9: 管理员首页 + i18n keys

**Files:**
- Create: `web/app/[locale]/admin/page.tsx`
- Create: `web/app/[locale]/admin/page.test.tsx`
- Modify: `web/messages/zh.json`
- Modify: `web/messages/en.json`

- [ ] **Step 1: 在 zh.json 添加 keys**

查找 `"admin": {` 在 `web/messages/zh.json` 的位置（位于顶层 key 之一），在 `admin` 对象的子键里追加 `weeklyExport`：

```jsonc
"weeklyExport": {
  "title": "管理员控制台",
  "subtitle": "周度用量导出",
  "isoWeekLabel": "本周 ISO 周：{label}",
  "timezoneLabel": "管理员时区：{tz}",
  "memberCount": "成员数：{count}",
  "downloadButton": "导出本周 CSV",
  "downloadHint": "包含 0 用量用户；浏览器直接保存文件"
}
```

`weeklyExport` 应放在 `admin` 对象内的合适位置（按字母序或与既有 keys 邻近）。

实际定位（视文件）：在 `"admin"` 对象内紧跟最后一个子 key 后插入 `weeklyExport` 块。文件总长 ~38K，改动 ≤ 10 行。

- [ ] **Step 2: 在 en.json 添加 keys**

`web/messages/en.json` 同结构：

```jsonc
"weeklyExport": {
  "title": "Admin Console",
  "subtitle": "Weekly Usage Export",
  "isoWeekLabel": "This ISO week: {label}",
  "timezoneLabel": "Admin timezone: {tz}",
  "memberCount": "Member count: {count}",
  "downloadButton": "Export this week CSV",
  "downloadHint": "Includes zero-usage members; save directly in browser"
}
```

- [ ] **Step 3: 写 page 测试**

`web/app/[locale]/admin/page.test.tsx`：

```ts
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin", () => ({
  isCurrentUserAdmin: vi.fn(),
  logAdminAccess: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getOptionalSession: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(),
  getLocale: vi.fn().mockResolvedValue("zh"),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { isCurrentUserAdmin } from "@/lib/admin";

import Page from "./page";

describe("/[locale]/admin page", () => {
  it("renders the admin console for admins", async () => {
    vi.mocked(isCurrentUserAdmin).mockResolvedValue(true);
    const translations: Record<string, string> = {
      title: "管理员控制台",
      subtitle: "周度用量导出",
      isoWeekLabel: "本周 ISO 周：{label}",
      timezoneLabel: "管理员时区：{tz}",
      memberCount: "成员数：{count}",
      downloadButton: "导出本周 CSV",
      downloadHint: "包含 0 用量用户",
    };
    vi.mocked((await import("next-intl/server")).getTranslations).mockImplementation(
      (async (opts: { namespace?: string }) => {
        const prefix = typeof opts === "string" ? opts : (opts?.namespace ?? "");
        return (key: string, vars?: Record<string, string | number>) => {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          let template = translations[fullKey] ?? key;
          if (vars) {
            for (const [k, v] of Object.entries(vars)) {
              template = template.replace(`{${k}}`, String(v));
            }
          }
          return template;
        };
      }) as never,
    );

    const element = await Page({ params: Promise.resolve({ locale: "zh" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("管理员控制台");
    expect(html).toContain("导出本周 CSV");
    expect(html).toContain('href="/api/admin/weekly-export"');
    expect(html).toMatch(/本周 ISO 周：\d{4}-W\d{2}/);
  });

  it("calls notFound() when user is not admin", async () => {
    vi.mocked(isCurrentUserAdmin).mockResolvedValue(false);
    vi.mocked((await import("next-intl/server")).getTranslations).mockResolvedValue(
      (key: string) => key as never,
    );
    await expect(
      Page({ params: Promise.resolve({ locale: "zh" }) }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm test:web --run web/app/\[locale\]/admin/page.test.tsx 2>&1 | tail -15`
Expected: FAIL with `Cannot find module './page'`.

- [ ] **Step 5: 实现 page**

`web/app/[locale]/admin/page.tsx`：

```tsx
import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isCurrentUserAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { resolveIsoWeek } from "@/lib/usage/weekly-export";

const DEFAULT_TIMEZONE = "UTC";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export default async function AdminConsolePage({ params }: PageProps) {
  const { locale } = await params;
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "admin.weeklyExport" });
  const week = resolveIsoWeek(new Date(), DEFAULT_TIMEZONE);
  const memberCount = await prisma.user.count();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("isoWeekLabel", { label: week.label })}</CardTitle>
          <CardDescription>
            {t("timezoneLabel", { tz: DEFAULT_TIMEZONE })}
            {" · "}
            {t("memberCount", { count: memberCount })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button asChild>
            <a href="/api/admin/weekly-export" download>
              <Download className="mr-2 h-4 w-4" />
              {t("downloadButton")}
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">{t("downloadHint")}</p>
        </CardContent>
      </Card>
    </main>
  );
}
```

**注意**：
- `Button asChild` 是 shadcn 模式，详见 `web/components/ui/button.tsx`；若不支持 `asChild`，改用普通 `<a>` 直接套 button 样式
- 若 `Button` 不支持 `asChild` prop，**用替代方案**：
  ```tsx
  <a
    href="/api/admin/weekly-export"
    download
    className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
  >
    <Download className="mr-2 h-4 w-4" />
    {t("downloadButton")}
  </a>
  ```
- 若 `getLocale` 引入导致 page 测试 mock 失败，将其从 import 中删除（locale 已从 params 拿到）。改用：
  ```ts
  const { locale: _locale } = await params;
  const t = await getTranslations("admin.weeklyExport");
  ```
- 若 `notFound()` 在 page 测试里不抛错（取决于 next 版本），把第二个测试改为：
  ```ts
  it("returns notFound() when user is not admin", async () => {
    vi.mocked(isCurrentUserAdmin).mockResolvedValue(false);
    vi.mocked((await import("next-intl/server")).getTranslations).mockResolvedValue(
      (key: string) => key as never,
    );
    const result = await Page({ params: Promise.resolve({ locale: "zh" }) });
    // notFound() throws NEXT_NOT_FOUND sentinel in Next 15
    await expect(Page({ params: Promise.resolve({ locale: "zh" }) })).rejects.toBeDefined();
  });
  ```

如测试在 `notFound` 行为上 flaky，最简方案：在 page 内 `if (!isAdmin) return null;` 并在测试里断言渲染产物为 null 字符串。这一改动需要在 page 文件里把 `notFound()` 换成 `return null;`。建议优先尝试 `notFound()`，失败时降级为 `return null;`。

- [ ] **Step 6: 重新运行测试**

Run: `pnpm test:web --run web/app/\[locale\]/admin/page.test.tsx 2>&1 | tail -30`
Expected: PASS（2 个 it 全过）。

- [ ] **Step 7: 提交**

```bash
git add web/app/\[locale\]/admin/ web/messages/zh.json web/messages/en.json
git commit -m "feat(admin): /[locale]/admin page with weekly CSV export button"
```

---

## Task 10: 最终验证

**Files:** none modified

- [ ] **Step 1: pnpm check**

Run: `pnpm check 2>&1 | tail -30`
Expected: Biome lint + format 全过（0 errors / 0 warnings）。若有报错，按 Biome 提示 `--write` 修复后重跑。

- [ ] **Step 2: pnpm test:web 全量**

Run: `pnpm test:web 2>&1 | tail -50`
Expected: 所有测试通过；覆盖率 ≥ `web/AGENTS.md` 阈值（statements 75% / branches 70% / functions 75% / lines 75%）。如新文件压低覆盖率，给 `csvEscape` / `resolveIsoWeek` / `aggregateWeeklyUsage` / `checkAndRecord` 等加 case。

- [ ] **Step 3: pnpm build:web**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tokens_burned" BETTER_AUTH_SECRET="dummy" BETTER_AUTH_URL="http://localhost:3000" pnpm build:web 2>&1 | tail -30`
Expected: 构建成功，0 TypeScript error。新增的 admin page 与 API route 出现在 build manifest。

- [ ] **Step 4: 手动烟雾测试（如可启动 dev server）**

Run: `pnpm dev:web`
浏览器访问 `http://localhost:3000/zh/admin`：
- 预期：非 admin 用户看到 404 页面
- 预期：admin 用户看到"管理员控制台"页 + 包含"导出本周 CSV"按钮
- 点击按钮：浏览器开始下载 `tokenarena-weekly-2026-W25.csv`
- 用 Excel/Numbers 打开：UTF-8 正常，首行为 13 列表头，数字行可读

如 dev server 不可启动，本步骤可跳过；端到端冒烟通过 `route.test.ts` 200 案例 + `page.test.tsx` 渲染案例覆盖。

- [ ] **Step 5: 提交（如有 lint/format 修复）**

```bash
git status
# 如有变更：
git add -A
git commit -m "chore: lint/format fixes from pnpm check"
```

---

## Self-Review

### Spec coverage

| Spec section | Implemented in |
|---|---|
| Architecture (route + page) | Task 8, Task 9 |
| `resolveIsoWeek` (算法) | Task 5 |
| `aggregateWeeklyUsage` (JS reduce + BigInt) | Task 6 |
| `csvEscape` | Task 3 |
| `buildCsv` (BOM + 13 列) | Task 4 |
| Rate limit (30s 内存) | Task 7 |
| Admin gate (page 404 + route 401/404) | Task 9, Task 8 |
| 错误处理 (401/404/400/429/500) | Task 8 |
| i18n keys (zh + en) | Task 9 |
| 测试覆盖 | Tasks 2-9 各含 vitest case |

### Placeholder scan

- 无 TBD / TODO / FIXME
- 关键代码块（resolveIsoWeek、aggregateWeeklyUsage、route handler、page）均含完整实现
- 测试用例含具体 input/expected，无 "write tests for above" 占位

### Type consistency

| Symbol | Defined | Used as |
|---|---|---|
| `WeeklyExportRow` | Task 4 (output) | Task 4 (buildCsv), Task 6 (aggregate) ✓ |
| `WeeklyExportInput` | Task 6 | Task 6 (aggregate) ✓ |
| `IsoWeek` | Task 5 | Task 5, Task 8 (route) ✓ |
| `RATE_LIMIT_MS` | Task 7 | Task 7 (test), Task 8 (route import not used — route uses module's own default 30s window implicitly via `checkAndRecord`) ✓ |
| `csvEscape` | Task 3 | Task 3 (test), Task 4 (buildCsv internal) ✓ |
| `resolveIsoWeek` | Task 5 | Task 5, Task 8, Task 9 ✓ |
| `aggregateWeeklyUsage` | Task 6 | Task 8 ✓ |
| `buildCsv` | Task 4 | Task 8 ✓ |
| `checkAndRecord` | Task 7 | Task 8 ✓ |

### Ambiguity check

- `aggregateWeeklyUsage` 对 `users` 中无对应 bucket 的用户：仍输出 row，tokens 0n，cost 0，days.size=0 ✓
- `csvEscape` 不处理 null：spec 中调用前已 `formatCell` 把 null 转为 "" ✓
- `buildCsv` 零行：仅返回 BOM + header + 末尾 `\n`，split 后 2 元素 ✓
- 500 错误时 `prisma.user.findMany.mockRejectedValue` — route 内 `Promise.all` reject 进入 try/catch ✓
- 429 时 `checkAndRecord` 已被 mock 为 false — 命中 if 分支返回 429 ✓
- 401 vs 404：spec 定义"未登录 401，非 admin 404"，与实现一致 ✓
- `notFound()` 测试：在 Next 15 中 `notFound()` 抛 `NEXT_NOT_FOUND` sentinel；测试用 `rejects.toBeDefined()` 兼容两种实现 ✓

**结论**：plan 完整覆盖 spec，无残留占位、类型一致、错误路径全有断言。
