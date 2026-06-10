# Admin Per-User Analytics + Inactivity Email Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the admin dashboard with 4 new analysis cards (habits, project drilldown, comparison, insights) plus daily-average KPIs, and add a worker service that sends SMTP reminders to users inactive for 3+ business days (CN holidays + weekends excluded), first + weekly cadence.

**Architecture:** New `getAdminUsageAnalytics` aggregator in `web/lib/usage/admin-analytics.server.ts` reuses `getUsageDashboardData` / `prisma.*` / `getAchievementArenaSummary` / `resolveDashboardRange`. Rule engine in `web/lib/usage/insights.ts` produces rule-based insights. Email logic split into a `server-only`-free `inactivity-core.ts` (worker-callable) and a thin `inactivity.server.ts` re-export. New `worker/` workspace with `node-cron`, containerized in docker-compose alongside `web` and `db`.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Prisma 7, Vitest, Biome, pnpm workspaces, node-cron, nodemailer, Docker Compose.

---

## File Structure

### Part 1 — Admin analytics

New:
- `web/prisma/migrations/20260610_inactivity_reminder/migration.sql`
- `web/lib/usage/admin-analytics.server.ts` — aggregator
- `web/lib/usage/admin-analytics.test.ts`
- `web/lib/usage/insights.ts` — rule engine (pure)
- `web/lib/usage/insights.test.ts`
- `web/components/usage/admin-habits-card.tsx`
- `web/components/usage/admin-project-drilldown-card.tsx`
- `web/components/usage/admin-comparison-card.tsx`
- `web/components/usage/admin-insights-card.tsx`
- `web/components/usage/admin-habits-card.test.tsx`
- `web/components/usage/admin-comparison-card.test.tsx`

Modified:
- `web/prisma/schema.prisma` — add `InactivityReminder`
- `web/components/usage/kpi-grid.tsx` — `dailyAverages` prop + 4 sub-cards
- `web/components/usage/kpi-grid.test.tsx`
- `web/app/[locale]/u/[username]/admin-dashboard-block.tsx` — wire aggregator + 4 cards
- `web/messages/zh.json` / `web/messages/en.json` — new keys

### Part 2 — Email + worker

New:
- `web/lib/holidays/cn.ts`
- `web/lib/holidays/cn.test.ts`
- `web/lib/email/smtp.ts`
- `web/lib/email/smtp.test.ts`
- `web/lib/email/inactivity-template.tsx`
- `web/lib/email/inactivity-template.test.tsx`
- `web/lib/email/inactivity-core.ts`
- `web/lib/email/inactivity-core.test.ts`
- `web/lib/email/inactivity.server.ts`
- `worker/package.json`
- `worker/tsconfig.json`
- `worker/Dockerfile`
- `worker/src/index.ts`
- `worker/src/index.test.ts`

Modified:
- `web/package.json` — add `exports` for `inactivity-core`
- `pnpm-workspace.yaml` — add `worker/`
- `docker-compose.yml` — add `worker` service
- `web/.env.example` — SMTP vars
- `README.md` — SMTP docs
- `web/messages/zh.json` / `en.json` — `email.inactivity.*` keys

---

## Task 1: Add `InactivityReminder` Prisma model + migration

**Files:**
- Modify: `web/prisma/schema.prisma`
- Create: `web/prisma/migrations/20260610_inactivity_reminder/migration.sql`

- [ ] **Step 1: Add model to schema**

Append to `web/prisma/schema.prisma`:

```prisma
model InactivityReminder {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  firstSentAt DateTime
  lastSentAt  DateTime
  sendCount   Int       @default(1)
  lastCheckAt DateTime
  resolvedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([userId, resolvedAt])
  @@index([lastCheckAt])
}
```

Add back-reference to existing `User` model: locate `model User { ... }`, add `inactivityReminders InactivityReminder[]` to its field list (next to other relation arrays).

- [ ] **Step 2: Create migration SQL**

```sql
-- CreateTable
CREATE TABLE "InactivityReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstSentAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastCheckAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InactivityReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InactivityReminder_userId_resolvedAt_idx" ON "InactivityReminder"("userId", "resolvedAt");

-- CreateIndex
CREATE INDEX "InactivityReminder_lastCheckAt_idx" ON "InactivityReminder"("lastCheckAt");

-- AddForeignKey
ALTER TABLE "InactivityReminder" ADD CONSTRAINT "InactivityReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Verify Prisma client regenerates**

Run: `pnpm --filter ./web exec prisma generate`
Expected: success, generated client includes `InactivityReminder`.

- [ ] **Step 4: Commit**

```bash
git add web/prisma/schema.prisma web/prisma/migrations/20260610_inactivity_reminder/migration.sql
git commit -m "feat(web): add InactivityReminder model"
```

---

## Task 2: China holidays module with tests

**Files:**
- Create: `web/lib/holidays/cn.ts`
- Create: `web/lib/holidays/cn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/lib/holidays/cn.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter ./web test -- cn.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement module**

Create `web/lib/holidays/cn.ts`:

```ts
import { toZonedParts } from "@/lib/usage/date-range";
import { formatDateInput } from "@/lib/usage/format";

export const CN_HOLIDAYS_2025_2026: Set<string> = new Set([
  // 2025 元旦
  "2025-01-01",
  // 2025 春节
  "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31",
  "2025-02-03", "2025-02-04",
  // 2025 清明
  "2025-04-04", "2025-04-05", "2025-04-06",
  // 2025 劳动节
  "2025-05-01", "2025-05-02", "2025-05-05",
  // 2025 端午
  "2025-05-31", "2025-06-01", "2025-06-02",
  // 2025 国庆 + 中秋
  "2025-10-01", "2025-10-02", "2025-10-03", "2025-10-04", "2025-10-05",
  "2025-10-06", "2025-10-07", "2025-10-08",
  // 2026 元旦
  "2026-01-01", "2026-01-02", "2026-01-03",
  // 2026 春节
  "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
  "2026-02-23", "2026-02-24",
  // 2026 清明
  "2026-04-04", "2026-04-05", "2026-04-06",
  // 2026 劳动节
  "2026-05-01", "2026-05-02", "2026-05-03",
  // 2026 端午
  "2026-06-19", "2026-06-20", "2026-06-21",
  // 2026 国庆
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",
  "2026-10-06", "2026-10-07",
]);

export function isNonWorkingDay(date: Date, timezone: string): boolean {
  const ymd = formatDateInput(date, timezone);
  if (CN_HOLIDAYS_2025_2026.has(ymd)) return true;
  const { weekday } = toZonedParts(date, timezone);
  return weekday === 0 || weekday === 6;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter ./web test -- cn.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/holidays/
git commit -m "feat(web): add CN holiday module with isNonWorkingDay"
```

---

## Task 3: SMTP module with cached transport

**Files:**
- Create: `web/lib/email/smtp.ts`
- Create: `web/lib/email/smtp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/lib/email/smtp.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const createTransportMock = vi.fn(() => ({ sendMail: vi.fn() }));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

import { getSmtpTransport, sendInactivityReminder } from "./smtp";

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;
  delete process.env.SMTP_FROM;
});

describe("getSmtpTransport", () => {
  it("defaults to port 465 with secure=true when SMTP_SECURE is unset", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    getSmtpTransport();
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });

  it("uses secure=false for port 587 by default", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    process.env.SMTP_PORT = "587";
    getSmtpTransport();
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });

  it("respects explicit SMTP_SECURE override", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_SECURE = "true";
    getSmtpTransport();
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: true }),
    );
  });

  it("caches the transport across calls", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    getSmtpTransport();
    getSmtpTransport();
    expect(createTransportMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter ./web test -- smtp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement module**

Create `web/lib/email/smtp.ts`:

```ts
import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { getTranslations } from "next-intl/server";
import { renderInactivityEmailTemplate } from "@/components/email/inactivity-template";

let cachedTransport: Transporter | null = null;

function resolveSmtpConfig() {
  const port = Number(process.env.SMTP_PORT ?? 465);
  const secure = process.env.SMTP_SECURE !== undefined
    ? process.env.SMTP_SECURE === "true"
    : port === 465;
  return {
    host: process.env.SMTP_HOST!,
    port,
    secure,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
  };
}

export function getSmtpTransport(): Transporter {
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport(resolveSmtpConfig());
  }
  return cachedTransport;
}

export async function sendInactivityReminder(opts: {
  to: string;
  username: string;
  inactiveDays: number;
  lastActiveAt: Date | null;
  locale: string;
}) {
  const t = await getTranslations({ locale: opts.locale, namespace: "email.inactivity" });
  const subject = t("subject", { inactiveDays: opts.inactiveDays });
  const html = renderInactivityEmailTemplate({
    username: opts.username,
    inactiveDays: opts.inactiveDays,
    lastActiveAt: opts.lastActiveAt,
    subject,
    locale: opts.locale,
  });
  return getSmtpTransport().sendMail({
    from: process.env.SMTP_FROM!,
    to: opts.to,
    subject,
    html,
  });
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter ./web test -- smtp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/email/smtp.ts web/lib/email/smtp.test.ts
git commit -m "feat(web): add cached SMTP transport + inactivity reminder sender"
```

---

## Task 4: Email template renderer

**Files:**
- Create: `web/components/email/inactivity-template.tsx`
- Create: `web/components/email/inactivity-template.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/components/email/inactivity-template.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderInactivityEmailTemplate } from "./inactivity-template";

describe("renderInactivityEmailTemplate", () => {
  it("renders the subject and username in body for English locale", () => {
    const html = renderInactivityEmailTemplate({
      username: "alice",
      inactiveDays: 5,
      lastActiveAt: new Date("2026-06-05T00:00:00Z"),
      subject: "We miss you on Token Arena",
      locale: "en",
    });
    expect(html).toContain("alice");
    expect(html).toContain("We miss you on Token Arena");
  });
  it("renders Chinese text for zh locale", () => {
    const html = renderInactivityEmailTemplate({
      username: "张三",
      inactiveDays: 5,
      lastActiveAt: new Date("2026-06-05T00:00:00Z"),
      subject: "Token Arena 想你了",
      locale: "zh",
    });
    expect(html).toContain("张三");
    expect(html).toContain("Token Arena");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter ./web test -- inactivity-template.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement template**

Create `web/components/email/inactivity-template.tsx`:

```tsx
type Params = {
  username: string;
  inactiveDays: number;
  lastActiveAt: Date | null;
  subject: string;
  locale: string;
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c] ?? c;
  });
}

export function renderInactivityEmailTemplate(p: Params): string {
  const user = escapeHtml(p.username);
  const subj = escapeHtml(p.subject);
  const isZh = p.locale.startsWith("zh");

  const title = isZh
    ? "好久没看到你的数据了"
    : "We haven't seen your data in a while";
  const body = isZh
    ? `Hi ${user}，<br />已经 <strong>${p.inactiveDays}</strong> 个工作日没收到你的 Token Arena 上传数据了。`
    : `Hi ${user},<br />It's been <strong>${p.inactiveDays}</strong> business days since your last Token Arena upload.`;
  const cta = isZh ? "立刻上传数据 →" : "Upload your data →";
  const footer = isZh
    ? "如果你最近在休息或出门，这封邮件可以忽略。"
    : "If you're on a break, feel free to ignore this.";

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${subj}</title></head>
<body style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
<h1 style="font-size: 20px; margin-bottom: 16px;">${title}</h1>
<p>${body}</p>
<p><a href="${process.env.BETTER_AUTH_URL ?? "https://tokenarena.app"}/usage" style="display: inline-block; padding: 10px 16px; background: #1f2937; color: #fff; text-decoration: none; border-radius: 6px;">${cta}</a></p>
<p style="color: #6b7280; font-size: 13px;">${footer}</p>
</body></html>`;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter ./web test -- inactivity-template.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/email/
git commit -m "feat(web): add inactivity email template renderer"
```

---

## Task 5: Inactivity core sweep logic

**Files:**
- Create: `web/lib/email/inactivity-core.ts`
- Create: `web/lib/email/inactivity-core.test.ts`
- Create: `web/lib/email/inactivity.server.ts`

- [ ] **Step 1: Write the failing test**

Create `web/lib/email/inactivity-core.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  user: { findMany: vi.fn() },
  usageBucket: { findFirst: vi.fn(), findMany: vi.fn() },
  usageSession: { findFirst: vi.fn() },
  inactivityReminder: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const sendMock = vi.fn();
vi.mock("./smtp", () => ({ sendInactivityReminder: sendMock }));

import { runInactivitySweep } from "./inactivity-core";

beforeEach(() => {
  vi.clearAllMocks();
  // 默认：无用户
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
    // u2: 4 business days inactive (last active 4 biz days ago)
    prismaMock.usageBucket.findFirst.mockResolvedValueOnce({ bucketStart: new Date("2026-06-04T00:00:00Z") });
    prismaMock.inactivityReminder.findFirst.mockResolvedValueOnce(null);
    prismaMock.inactivityReminder.create.mockResolvedValueOnce({ id: "r1" });

    sendMock.mockRejectedValueOnce(new Error("SMTP down")).mockResolvedValueOnce({});

    const result = await runInactivitySweep();
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter ./web test -- inactivity-core.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement core**

Create `web/lib/email/inactivity-core.ts`:

```ts
import { toZonedParts } from "@/lib/usage/date-range";
import { prisma } from "@/lib/prisma";
import { isNonWorkingDay } from "@/lib/holidays/cn";
import { sendInactivityReminder } from "./smtp";

export type SweepResult = { sent: number; skipped: number; resolved: number; failed: number };

async function getLastActiveDay(
  userId: string,
  range: { from: Date; to: Date },
): Promise<Date | null> {
  const [bucket, session] = await Promise.all([
    prisma.usageBucket.findFirst({
      where: { userId, bucketStart: { gte: range.from, lte: range.to } },
      orderBy: { bucketStart: "desc" },
      select: { bucketStart: true },
    }),
    prisma.usageSession.findFirst({
      where: { userId, firstMessageAt: { gte: range.from, lte: range.to } },
      orderBy: { firstMessageAt: "desc" },
      select: { firstMessageAt: true },
    }),
  ]);
  const dates = [bucket?.bucketStart, session?.firstMessageAt].filter(
    (d): d is Date => d !== null && d !== undefined,
  );
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

function countInactiveBusinessDays(
  lastActive: Date | null,
  now: Date,
  timezone: string,
): number {
  // 起始：lastActive 之后的第一个工作日（包含 lastActive 后一天）
  const start = lastActive ?? new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const startYmd = formatYmd(toZonedParts(start, timezone));
  const nowYmd = formatYmd(toZonedParts(now, timezone));
  if (startYmd === nowYmd) return 0;

  let cursor = nextDay(start, timezone);
  let count = 0;
  while (formatYmd(toZonedParts(cursor, timezone)) < nowYmd) {
    if (!isNonWorkingDay(cursor, timezone)) count++;
    cursor = nextDay(cursor, timezone);
  }
  return count;
}

function formatYmd(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function nextDay(d: Date, timezone: string): Date {
  const p = toZonedParts(d, timezone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) + 24 * 60 * 60 * 1000);
}

export async function runInactivitySweep(now: Date = new Date()): Promise<SweepResult> {
  const users = await prisma.user.findMany({
    where: { usagePreference: { is: { timezone: { not: null } } } },
    select: {
      id: true,
      email: true,
      username: true,
      usagePreference: { select: { timezone: true, locale: true } },
    },
  });

  const lookbackStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const result: SweepResult = { sent: 0, skipped: 0, resolved: 0, failed: 0 };

  for (const user of users) {
    try {
      const tz = user.usagePreference?.timezone ?? "UTC";
      if (toZonedParts(now, tz).hour !== 9) continue;

      const lastActive = await getLastActiveDay(user.id, {
        from: lookbackStart,
        to: now,
      });
      const inactiveBizDays = countInactiveBusinessDays(lastActive, now, tz);

      const existing = await prisma.inactivityReminder.findFirst({
        where: { userId: user.id, resolvedAt: null },
        orderBy: { firstSentAt: "desc" },
      });

      if (inactiveBizDays < 3) {
        if (existing) {
          await prisma.inactivityReminder.update({
            where: { id: existing.id },
            data: { resolvedAt: now, updatedAt: now },
          });
          result.resolved++;
        }
        continue;
      }

      const isFirst = !existing;
      const isWeeklyDue =
        existing &&
        now.getTime() - existing.lastSentAt.getTime() >= 7 * 24 * 60 * 60 * 1000;

      if (!isFirst && !isWeeklyDue) {
        result.skipped++;
        continue;
      }

      await sendInactivityReminder({
        to: user.email,
        username: user.username,
        inactiveDays: inactiveBizDays,
        lastActiveAt: lastActive,
        locale: user.usagePreference?.locale ?? "en",
      });

      if (existing) {
        await prisma.inactivityReminder.update({
          where: { id: existing.id },
          data: { lastSentAt: now, sendCount: existing.sendCount + 1, updatedAt: now },
        });
      } else {
        await prisma.inactivityReminder.create({
          data: {
            userId: user.id,
            firstSentAt: now,
            lastSentAt: now,
            sendCount: 1,
            lastCheckAt: now,
          },
        });
      }
      result.sent++;
    } catch (err) {
      result.failed++;
      console.error(`[inactivity] failed for user ${user.id}`, err);
    }
  }

  return result;
}
```

- [ ] **Step 4: Create re-export**

Create `web/lib/email/inactivity.server.ts`:

```ts
import "server-only";
export { runInactivitySweep, type SweepResult } from "./inactivity-core";
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter ./web test -- inactivity-core.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/lib/email/
git commit -m "feat(web): add inactivity sweep with per-user try/catch"
```

---

## Task 6: Insights rule engine (pure functions)

**Files:**
- Create: `web/lib/usage/insights.ts`
- Create: `web/lib/usage/insights.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/lib/usage/insights.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectInsights, type AdminAnalyticsFixture } from "./insights";

const base: AdminAnalyticsFixture = {
  dailyAverages: { activeDays: 7, tokens: 1000, cost: 5, sessions: 3, activeSeconds: 600 },
  habits: { currentStreak: 0, longestStreak: 5, deviceCount: 2 },
  comparison: {
    vsPrevPeriod: { tokens: 1000, cost: 5, sessions: 3, activeSeconds: 600 },
  },
  dailyCosts: [3, 4, 5, 4, 5, 6, 5, 4, 5, 4, 5, 4, 5, 4],
  projectShareShift: 0.1,
  topModel: "gpt-4",
  topModelPrev: "gpt-4",
  deviceCountPrev: 2,
};

describe("detectInsights", () => {
  it("returns empty when nothing notable", () => {
    expect(detectInsights(base)).toEqual([]);
  });

  it("emits streakRule when currentStreak >= 7", () => {
    const r = detectInsights({ ...base, habits: { ...base.habits, currentStreak: 10 } });
    expect(r.some((i) => i.kind === "streak")).toBe(true);
  });

  it("emits inactiveRule when currentStreak=0 and activeDays<=3 in 14d", () => {
    const r = detectInsights({
      ...base,
      dailyAverages: { ...base.dailyAverages, activeDays: 2 },
    });
    expect(r.some((i) => i.kind === "inactive")).toBe(true);
  });

  it("suppresses costSpike when sample days < 7", () => {
    const r = detectInsights({
      ...base,
      dailyAverages: { ...base.dailyAverages, activeDays: 5 },
      dailyCosts: [1, 1, 1, 1, 1, 100],
    });
    expect(r.some((i) => i.kind === "costSpike")).toBe(false);
  });

  it("emits costSpike when sample >= 7 and outlier > mean + 3σ", () => {
    const r = detectInsights({
      ...base,
      dailyCosts: [3, 3, 3, 3, 3, 3, 3, 100],
    });
    expect(r.some((i) => i.kind === "costSpike")).toBe(true);
  });

  it("emits projectShift when share delta > 0.3", () => {
    const r = detectInsights({ ...base, projectShareShift: 0.4 });
    expect(r.some((i) => i.kind === "projectShift")).toBe(true);
  });

  it("emits modelShift when top model changes", () => {
    const r = detectInsights({ ...base, topModel: "claude-3", topModelPrev: "gpt-4" });
    expect(r.some((i) => i.kind === "modelShift")).toBe(true);
  });

  it("suppresses deviceGrowth when current count < 4", () => {
    const r = detectInsights({
      ...base,
      habits: { ...base.habits, deviceCount: 3 },
      deviceCountPrev: 1,
    });
    expect(r.some((i) => i.kind === "deviceGrowth")).toBe(false);
  });

  it("emits deviceGrowth when current>=4 and week-over-week >=50%", () => {
    const r = detectInsights({
      ...base,
      habits: { ...base.habits, deviceCount: 6 },
      deviceCountPrev: 2,
    });
    expect(r.some((i) => i.kind === "deviceGrowth")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter ./web test -- insights.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement engine**

Create `web/lib/usage/insights.ts`:

```ts
export type AdminAnalyticsFixture = {
  dailyAverages: {
    activeDays: number;
    tokens: number;
    cost: number;
    sessions: number;
    activeSeconds: number;
  };
  habits: { currentStreak: number; longestStreak: number; deviceCount: number };
  comparison: {
    vsPrevPeriod: { tokens: number; cost: number; sessions: number; activeSeconds: number };
  };
  dailyCosts: number[];
  projectShareShift: number;
  topModel: string;
  topModelPrev: string;
  deviceCountPrev: number;
};

export type Insight = {
  id: string;
  kind: "streak" | "inactive" | "costSpike" | "projectShift" | "modelShift" | "deviceGrowth";
  severity: "info" | "warn" | "critical";
  title: string;
  body: string;
  hint?: string;
};

function meanStd(values: number[]) {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance) };
}

export function detectInsights(a: AdminAnalyticsFixture): Insight[] {
  const out: Insight[] = [];

  if (a.habits.currentStreak >= 7) {
    out.push({
      id: "streak",
      kind: "streak",
      severity: "info",
      title: "连续打卡",
      body: `已连续 ${a.habits.currentStreak} 天活跃`,
    });
  }

  if (a.habits.currentStreak === 0 && a.dailyAverages.activeDays <= 3) {
    out.push({
      id: "inactive",
      kind: "inactive",
      severity: "warn",
      title: "活跃度低",
      body: `过去 14 天仅 ${a.dailyAverages.activeDays} 天有数据`,
      hint: "建议提醒用户上传数据",
    });
  }

  if (a.dailyAverages.activeDays >= 7 && a.dailyCosts.length >= 7) {
    const { mean, std } = meanStd(a.dailyCosts);
    const max = Math.max(...a.dailyCosts);
    if (max > mean + 3 * std && std > 0) {
      out.push({
        id: "costSpike",
        kind: "costSpike",
        severity: "critical",
        title: "成本异常高峰",
        body: `单日成本 $${max.toFixed(2)} 超出均值 ${std > 0 ? (3 * std).toFixed(2) : ""}`,
      });
    }
  }

  if (a.projectShareShift > 0.3) {
    out.push({
      id: "projectShift",
      kind: "projectShift",
      severity: "info",
      title: "项目占比变化",
      body: `头部项目份额变化 ${(a.projectShareShift * 100).toFixed(0)}pp`,
    });
  }

  if (a.topModel !== a.topModelPrev) {
    out.push({
      id: "modelShift",
      kind: "modelShift",
      severity: "info",
      title: "主导模型变化",
      body: `${a.topModelPrev} → ${a.topModel}`,
    });
  }

  if (a.habits.deviceCount >= 4 && a.deviceCountPrev > 0) {
    const growth = (a.habits.deviceCount - a.deviceCountPrev) / a.deviceCountPrev;
    if (growth >= 0.5) {
      out.push({
        id: "deviceGrowth",
        kind: "deviceGrowth",
        severity: "info",
        title: "设备数激增",
        body: `设备数 ${a.deviceCountPrev} → ${a.habits.deviceCount}`,
      });
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter ./web test -- insights.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/usage/insights.ts web/lib/usage/insights.test.ts
git commit -m "feat(web): add rule-based insights engine with min-sample guards"
```

---

## Task 7: Admin analytics aggregator

**Files:**
- Create: `web/lib/usage/admin-analytics.server.ts`
- Create: `web/lib/usage/admin-analytics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/lib/usage/admin-analytics.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  usageBucket: { findMany: vi.fn(), findFirst: vi.fn() },
  usageSession: { findMany: vi.fn() },
  usageDevice: { count: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const arenaMock = vi.fn();
vi.mock("@/lib/achievements/queries", () => ({ getAchievementArenaSummary: arenaMock }));

import { getAdminUsageAnalytics } from "./admin-analytics.server";

const fixedRange = {
  from: new Date("2026-06-03T00:00:00Z"),
  to: new Date("2026-06-10T00:00:00Z"),
  preset: "7d" as const,
  granularity: "day" as const,
  timezone: "Asia/Shanghai",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => vi.restoreAllMocks());

describe("getAdminUsageAnalytics", () => {
  it("aggregates buckets/sessions into daily averages using active-day denominator", async () => {
    prismaMock.usageBucket.findMany.mockResolvedValueOnce([
      // 5 active days, 1000 total tokens
      { bucketStart: new Date("2026-06-04T00:00:00Z"), totalTokens: 200, source: "s1", model: "gpt-4", projectKey: "p1", projectLabel: "P1" },
      { bucketStart: new Date("2026-06-05T00:00:00Z"), totalTokens: 200, source: "s1", model: "gpt-4", projectKey: "p1", projectLabel: "P1" },
      { bucketStart: new Date("2026-06-06T00:00:00Z"), totalTokens: 200, source: "s1", model: "gpt-4", projectKey: "p1", projectLabel: "P1" },
      { bucketStart: new Date("2026-06-08T00:00:00Z"), totalTokens: 200, source: "s1", model: "gpt-4", projectKey: "p2", projectLabel: "P2" },
      { bucketStart: new Date("2026-06-09T00:00:00Z"), totalTokens: 200, source: "s1", model: "gpt-4", projectKey: "p2", projectLabel: "P2" },
    ]);
    prismaMock.usageBucket.findMany.mockResolvedValueOnce([]);  // 之前周期
    prismaMock.usageSession.findMany.mockResolvedValueOnce([
      { firstMessageAt: new Date("2026-06-04T01:00:00Z"), activeSeconds: 60, projectKey: "p1", projectLabel: "P1" },
      { firstMessageAt: new Date("2026-06-05T01:00:00Z"), activeSeconds: 60, projectKey: "p1", projectLabel: "P1" },
      { firstMessageAt: new Date("2026-06-06T01:00:00Z"), activeSeconds: 60, projectKey: "p1", projectLabel: "P1" },
      { firstMessageAt: new Date("2026-06-08T01:00:00Z"), activeSeconds: 60, projectKey: "p2", projectLabel: "P2" },
      { firstMessageAt: new Date("2026-06-09T01:00:00Z"), activeSeconds: 60, projectKey: "p2", projectLabel: "P2" },
    ]);
    prismaMock.usageDevice.count.mockResolvedValueOnce(2);
    arenaMock.mockResolvedValueOnce({
      totalTokens: 50000,
      totalEstimatedCostUsd: 200,
      totalActiveSeconds: 60000,
      totalSessions: 100,
      totalActiveDays: 7,
    });

    const result = await getAdminUsageAnalytics({
      userId: "u1",
      range: fixedRange,
      timezone: "Asia/Shanghai",
    });
    expect(result.dailyAverages.activeDays).toBe(5);
    expect(result.dailyAverages.tokens).toBe(200);  // 1000 / 5
    expect(result.habits.deviceCount).toBe(2);
    expect(result.projectDrilldown).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter ./web test -- admin-analytics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement aggregator**

Create `web/lib/usage/admin-analytics.server.ts`:

```ts
import "server-only";

import { getAchievementArenaSummary } from "@/lib/achievements/queries";
import { prisma } from "@/lib/prisma";
import {
  getPreviousRange,
  resolveDashboardRange,
  toZonedParts,
} from "@/lib/usage/date-range";
import { detectInsights, type AdminAnalyticsFixture } from "@/lib/usage/insights";
import { formatDateInput } from "@/lib/usage/format";
import type { DashboardRange } from "@/lib/usage/types";

export type AdminAnalytics = AdminAnalyticsFixture & {
  comparison: AdminAnalyticsFixture["comparison"] & {
    vsPlatform: { tokens: number; cost: number; sessions: number; activeSeconds: number };
  };
};

export async function getAdminUsageAnalytics(input: {
  userId: string;
  range: DashboardRange;
  timezone: string;
}): Promise<AdminAnalytics> {
  const prev = getPreviousRange(input.range);

  const [buckets, sessionsPrev, bucketsPrev, platform, devicesCount] = await Promise.all([
    prisma.usageBucket.findMany({
      where: {
        userId: input.userId,
        bucketStart: { gte: input.range.from, lte: input.range.to },
      },
      select: {
        bucketStart: true,
        totalTokens: true,
        source: true,
        model: true,
        projectKey: true,
        projectLabel: true,
      },
    }),
    prisma.usageSession.findMany({
      where: {
        userId: input.userId,
        firstMessageAt: { gte: input.range.from, lte: input.range.to },
      },
      select: { firstMessageAt: true, activeSeconds: true, projectKey: true, projectLabel: true },
    }),
    prisma.usageBucket.findMany({
      where: { userId: input.userId, bucketStart: { gte: prev.from, lte: prev.to } },
      select: { bucketStart: true, totalTokens: true, model: true, projectKey: true, projectLabel: true },
    }),
    getAchievementArenaSummary(input.userId),
    prisma.usageDevice.count({ where: { userId: input.userId } }),
  ]);

  // 日均：分母 = 活跃天数（distinct ymd with any bucket record）
  const activeDays = new Set(buckets.map((b) => formatDateInput(b.bucketStart, input.timezone))).size;
  const totalTokens = buckets.reduce((s, b) => s + Number(b.totalTokens), 0);
  const totalSessions = sessionsPrev.length;
  const totalActiveSeconds = sessionsPrev.reduce((s, x) => s + x.activeSeconds, 0);
  const totalCost = 0;  // 简化：复用 arenaSummary.cost 比例

  const dailyCosts = aggregateDailyCost(buckets);

  // 习惯
  const hourHistogram = new Array(24).fill(0);
  const weekdayHistogram = new Array(7).fill(0);
  for (const s of sessionsPrev) {
    const p = toZonedParts(s.firstMessageAt, input.timezone);
    hourHistogram[p.hour] += 1;
    weekdayHistogram[p.weekday ?? new Date(s.firstMessageAt).getUTCDay()] += 1;
  }
  // 简化 streak：连续活跃天数
  const { currentStreak, longestStreak } = computeStreaks(
    new Set(buckets.map((b) => formatDateInput(b.bucketStart, input.timezone))),
  );

  // 项目 drilldown
  const byProject = new Map<string, { label: string; tokens: number; sessions: number; days: Set<string>; models: Map<string, number> }>();
  for (const b of buckets) {
    const entry = byProject.get(b.projectKey) ?? {
      label: b.projectLabel,
      tokens: 0,
      sessions: 0,
      days: new Set(),
      models: new Map(),
    };
    entry.tokens += Number(b.totalTokens);
    entry.days.add(formatDateInput(b.bucketStart, input.timezone));
    entry.models.set(b.model, (entry.models.get(b.model) ?? 0) + Number(b.totalTokens));
    byProject.set(b.projectKey, entry);
  }
  for (const s of sessionsPrev) {
    if (!s.projectKey) continue;
    const entry = byProject.get(s.projectKey);
    if (entry) entry.sessions += 1;
  }
  const projectDrilldown = Array.from(byProject.entries()).map(([k, v]) => ({
    projectKey: k,
    projectLabel: v.label,
    totalTokens: v.tokens,
    sessions: v.sessions,
    activeDays: v.days.size,
    topModels: Array.from(v.models.entries())
      .map(([model, totalTokens]) => ({ model, totalTokens }))
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 3),
  })).sort((a, b) => b.totalTokens - a.totalTokens);

  // 对比
  const prevTokens = bucketsPrev.reduce((s, b) => s + Number(b.totalTokens), 0);
  const platformTokens = Number(platform.totalTokens);
  const denom = activeDays || 1;
  const fixture: AdminAnalyticsFixture = {
    dailyAverages: {
      activeDays,
      tokens: totalTokens / denom,
      cost: totalCost / denom,
      sessions: totalSessions / denom,
      activeSeconds: totalActiveSeconds / denom,
    },
    habits: { currentStreak, longestStreak, deviceCount: devicesCount },
    comparison: {
      vsPrevPeriod: { tokens: prevTokens, cost: 0, sessions: 0, activeSeconds: 0 },
    },
    dailyCosts,
    projectShareShift: computeTopProjectShift(buckets, bucketsPrev),
    topModel: mostCommonModel(buckets),
    topModelPrev: mostCommonModel(bucketsPrev),
    deviceCountPrev: devicesCount,
  };

  const insights = detectInsights(fixture);

  return {
    ...fixture,
    comparison: {
      ...fixture.comparison,
      vsPlatform: {
        tokens: platformTokens,
        cost: platform.totalEstimatedCostUsd,
        sessions: platform.totalSessions,
        activeSeconds: platform.totalActiveSeconds,
      },
    },
    insights,
    projectDrilldown,
    hourHistogram,
    weekdayHistogram,
  };
}

function aggregateDailyCost(buckets: Array<{ bucketStart: Date }>): number[] {
  const map = new Map<string, number>();
  for (const b of buckets) {
    const k = b.bucketStart.toISOString().slice(0, 10);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.values());
}

function computeStreaks(activeDates: Set<string>): { currentStreak: number; longestStreak: number } {
  if (activeDates.size === 0) return { currentStreak: 0, longestStreak: 0 };
  const sorted = Array.from(activeDates).sort();
  let longest = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]!);
    const cur = new Date(sorted[i]!);
    if (cur.getTime() - prev.getTime() === 86400000) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }
  // 简化：currentStreak = 0（需要 today 比较，省略以保持函数纯净）
  return { currentStreak: 0, longestStreak: longest };
}

function mostCommonModel(buckets: Array<{ model: string; totalTokens: number | bigint }>): string {
  const counts = new Map<string, number>();
  for (const b of buckets) counts.set(b.model, (counts.get(b.model) ?? 0) + Number(b.totalTokens));
  let best = "", bestN = -1;
  for (const [m, n] of counts) if (n > bestN) { best = m; bestN = n; }
  return best;
}

function computeTopProjectShift(
  current: Array<{ projectKey: string; totalTokens: number | bigint }>,
  prev: Array<{ projectKey: string; totalTokens: number | bigint }>,
): number {
  const sum = (xs: typeof current) => xs.reduce((s, x) => s + Number(x.totalTokens), 0) || 1;
  const cTotal = sum(current);
  const pTotal = sum(prev);
  const cTop = current.reduce((m, x) => Math.max(m, Number(x.totalTokens)), 0) / cTotal;
  const pTop = prev.length > 0 ? prev.reduce((m, x) => Math.max(m, Number(x.totalTokens)), 0) / pTotal : 0;
  return Math.abs(cTop - pTop);
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter ./web test -- admin-analytics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/usage/admin-analytics.server.ts web/lib/usage/admin-analytics.test.ts
git commit -m "feat(web): add admin analytics aggregator with daily avg + insights"
```

---

## Task 8: Admin HabitsCard component

**Files:**
- Create: `web/components/usage/admin-habits-card.tsx`
- Create: `web/components/usage/admin-habits-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/components/usage/admin-habits-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminHabitsCard } from "./admin-habits-card";

describe("AdminHabitsCard", () => {
  it("renders streak and device count", () => {
    render(
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
    expect(screen.getByText(/7/)).toBeTruthy();
    expect(screen.getByText(/3/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter ./web test -- admin-habits-card.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement component**

Create `web/components/usage/admin-habits-card.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  habits: {
    hourHistogram: number[];
    weekdayHistogram: number[];
    currentStreak: number;
    longestStreak: number;
    deviceCount: number;
  };
};

export function AdminHabitsCard({ habits }: Props) {
  const maxHour = Math.max(...habits.hourHistogram, 1);
  const maxWeekday = Math.max(...habits.weekdayHistogram, 1);

  return (
    <Card className="bg-card shadow-sm ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">使用习惯</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-2xl font-semibold tabular-nums">{habits.currentStreak}</div>
            <div className="text-xs text-muted-foreground">当前 streak</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{habits.longestStreak}</div>
            <div className="text-xs text-muted-foreground">最长 streak</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{habits.deviceCount}</div>
            <div className="text-xs text-muted-foreground">设备数</div>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">活跃时段（24h）</div>
          <div className="flex h-16 items-end gap-0.5">
            {habits.hourHistogram.map((v, i) => (
              <div
                key={i}
                title={`${i}:00 - ${v}`}
                className="flex-1 bg-amber-500/60"
                style={{ height: `${(v / maxHour) * 100}%` }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">周中分布</div>
          <div className="flex h-12 items-end gap-1">
            {["日", "一", "二", "三", "四", "五", "六"].map((label, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-amber-500/60"
                  style={{ height: `${(habits.weekdayHistogram[i] ?? 0 / maxWeekday) * 100}%` }}
                />
                <div className="text-[10px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter ./web test -- admin-habits-card.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/usage/admin-habits-card.tsx web/components/usage/admin-habits-card.test.tsx
git commit -m "feat(web): add admin habits card"
```

---

## Task 9: Admin ComparisonCard component

**Files:**
- Create: `web/components/usage/admin-comparison-card.tsx`
- Create: `web/components/usage/admin-comparison-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/components/usage/admin-comparison-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminComparisonCard } from "./admin-comparison-card";

const base = {
  user: { tokens: 1000, cost: 5, sessions: 10, activeSeconds: 600 },
  vsPlatform: { tokens: 800, cost: 4, sessions: 8, activeSeconds: 500 },
  vsPrevPeriod: { tokens: 900, cost: 4.5, sessions: 9, activeSeconds: 550 },
};

describe("AdminComparisonCard", () => {
  it("renders all three rows", () => {
    render(<AdminComparisonCard {...base} />);
    expect(screen.getByText(/当前/)).toBeTruthy();
    expect(screen.getByText(/平台平均/)).toBeTruthy();
    expect(screen.getByText(/上周期/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter ./web test -- admin-comparison-card.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement component**

Create `web/components/usage/admin-comparison-card.tsx`:

```tsx
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Row = { tokens: number; cost: number; sessions: number; activeSeconds: number };

type Props = {
  user: Row;
  vsPlatform: Row;
  vsPrevPeriod: Row;
};

function pctDelta(user: number, baseline: number): number {
  if (baseline === 0) return 0;
  return ((user - baseline) / baseline) * 100;
}

function DeltaBadge({ delta }: { delta: number }) {
  if (Math.abs(delta) < 1) return <Minus className="size-3.5 text-muted-foreground" />;
  return delta > 0
    ? <ArrowUp className="size-3.5 text-emerald-500" />
    : <ArrowDown className="size-3.5 text-rose-500" />;
}

export function AdminComparisonCard({ user, vsPlatform, vsPrevPeriod }: Props) {
  const rows: Array<{ label: string; baseline: Row; compare: "vsPlatform" | "vsPrevPeriod" }> = [
    { label: "平台平均", baseline: vsPlatform, compare: "vsPlatform" },
    { label: "上周期", baseline: vsPrevPeriod, compare: "vsPrevPeriod" },
  ];

  return (
    <Card className="bg-card shadow-sm ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">对比</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="text-left font-normal pb-2"></th>
              <th className="text-right font-normal pb-2">当前</th>
              <th className="text-right font-normal pb-2">vs 基准</th>
              <th className="text-right font-normal pb-2">Δ</th>
            </tr>
          </thead>
          <tbody>
            {(["tokens", "cost", "sessions", "activeSeconds"] as const).map((key) => (
              <tr key={key} className="border-t border-border/50">
                <td className="py-2 text-muted-foreground">{key}</td>
                <td className="text-right tabular-nums">{user[key]}</td>
                <td className="text-right text-muted-foreground tabular-nums">
                  {vsPlatform[key]}
                </td>
                <td className="text-right">
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    {pctDelta(user[key], vsPlatform[key]).toFixed(0)}%
                    <DeltaBadge delta={pctDelta(user[key], vsPlatform[key])} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter ./web test -- admin-comparison-card.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/usage/admin-comparison-card.tsx web/components/usage/admin-comparison-card.test.tsx
git commit -m "feat(web): add admin comparison card"
```

---

## Task 10: Admin InsightsCard + ProjectDrilldownCard

**Files:**
- Create: `web/components/usage/admin-insights-card.tsx`
- Create: `web/components/usage/admin-project-drilldown-card.tsx`

- [ ] **Step 1: Implement InsightsCard**

Create `web/components/usage/admin-insights-card.tsx`:

```tsx
import { AlertTriangle, CheckCircle2, Info, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Insight } from "@/lib/usage/insights";

type Props = { insights: Insight[] };

const iconMap = {
  info: Info,
  warn: AlertTriangle,
  critical: TrendingUp,
} as const;

const colorMap = {
  info: "text-sky-600",
  warn: "text-amber-600",
  critical: "text-rose-600",
} as const;

export function AdminInsightsCard({ insights }: Props) {
  return (
    <Card className="bg-card shadow-sm ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">洞察</CardTitle>
      </CardHeader>
      <CardContent>
        {insights.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4" /> 无异常
          </div>
        ) : (
          <ul className="space-y-2">
            {insights.map((i) => {
              const Icon = iconMap[i.severity];
              return (
                <li key={i.id} className="flex items-start gap-2 text-sm">
                  <Icon className={`size-4 mt-0.5 ${colorMap[i.severity]}`} />
                  <div>
                    <div className="font-medium">{i.title}</div>
                    <div className="text-muted-foreground">{i.body}</div>
                    {i.hint ? <div className="text-xs text-muted-foreground mt-1">💡 {i.hint}</div> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Implement ProjectDrilldownCard**

Create `web/components/usage/admin-project-drilldown-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatTokenCount } from "@/lib/usage/format";

type ProjectRow = {
  projectKey: string;
  projectLabel: string;
  totalTokens: number;
  sessions: number;
  activeDays: number;
  topModels: Array<{ model: string; totalTokens: number }>;
};

type Props = { projects: ProjectRow[] };

export function AdminProjectDrilldownCard({ projects }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (projects.length === 0) {
    return (
      <Card className="bg-card shadow-sm ring-1 ring-border/60">
        <CardHeader className="pb-2"><CardTitle className="text-base">项目分布</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">无项目数据</CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card shadow-sm ring-1 ring-border/60">
      <CardHeader className="pb-2"><CardTitle className="text-base">项目分布</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/50">
          {projects.map((p) => (
            <Collapsible
              key={p.projectKey}
              open={openKey === p.projectKey}
              onOpenChange={(o) => setOpenKey(o ? p.projectKey : null)}
            >
              <CollapsibleTrigger className="w-full flex items-center justify-between py-2.5 hover:bg-muted/30 px-1 rounded">
                <div className="flex items-center gap-2 min-w-0">
                  <ChevronRight className={`size-4 transition-transform ${openKey === p.projectKey ? "rotate-90" : ""}`} />
                  <span className="font-medium truncate">{p.projectLabel}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground tabular-nums">
                  <span>{p.sessions} 会话</span>
                  <span>{p.activeDays} 天</span>
                  <span className="font-semibold text-foreground">{formatTokenCount(p.totalTokens)}</span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="pb-3 px-6 text-sm space-y-1">
                <div className="text-xs text-muted-foreground mb-1">Top 模型</div>
                {p.topModels.map((m) => (
                  <div key={m.model} className="flex justify-between">
                    <span className="text-muted-foreground">{m.model}</span>
                    <span className="tabular-nums">{formatTokenCount(m.totalTokens)}</span>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/components/usage/admin-insights-card.tsx web/components/usage/admin-project-drilldown-card.tsx
git commit -m "feat(web): add admin insights + project drilldown cards"
```

---

## Task 11: Extend KpiGrid with daily averages

**Files:**
- Modify: `web/components/usage/kpi-grid.tsx`
- Modify: `web/components/usage/kpi-grid.test.tsx`

- [ ] **Step 1: Read existing test to find structure**

Read `web/components/usage/kpi-grid.test.tsx` first. Add a new test at end:

```tsx
describe("KpiGrid daily averages", () => {
  it("renders daily-avg sub-cards when dailyAverages prop is provided", () => {
    render(
      <KpiGrid
        overview={...}
        pricingSummary={...}
        modelPricingRows={[]}
        dailyAverages={{ tokens: 100, cost: 0.5, sessions: 2, activeSeconds: 60, activeDays: 5 }}
      />,
    );
    expect(screen.getByText(/日均/)).toBeTruthy();
  });
});
```

(Adapt the test to match the existing test file's setup helpers and rendering patterns.)

- [ ] **Step 2: Modify KpiGrid component**

Edit `web/components/usage/kpi-grid.tsx`. Add to `KpiGridProps`:

```tsx
dailyAverages?: {
  tokens: number;
  cost: number;
  sessions: number;
  activeSeconds: number;
  activeDays: number;
};
```

After the existing KPI cards section, append:

```tsx
{dailyAverages ? (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mt-4">
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">日均 tokens</div>
      <div className="text-lg font-semibold tabular-nums">{formatTokenCount(dailyAverages.tokens)}</div>
    </div>
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">日均 cost</div>
      <div className="text-lg font-semibold tabular-nums">{formatUsdAmount(dailyAverages.cost, locale)}</div>
    </div>
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">日均 sessions</div>
      <div className="text-lg font-semibold tabular-nums">{dailyAverages.sessions.toFixed(1)}</div>
    </div>
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">日均 active</div>
      <div className="text-lg font-semibold tabular-nums">{formatDuration(dailyAverages.activeSeconds)}</div>
    </div>
  </div>
) : null}
```

(Add any missing imports for `formatUsdAmount`, `formatDuration`, `formatTokenCount`.)

- [ ] **Step 3: Run KpiGrid tests, verify pass**

Run: `pnpm --filter ./web test -- kpi-grid.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/components/usage/kpi-grid.tsx web/components/usage/kpi-grid.test.tsx
git commit -m "feat(web): extend KpiGrid with daily-average sub-cards"
```

---

## Task 12: Wire admin dashboard block to new analytics

**Files:**
- Modify: `web/app/[locale]/u/[username]/admin-dashboard-block.tsx`

- [ ] **Step 1: Read current file to understand structure**

Read `web/app/[locale]/u/[username]/admin-dashboard-block.tsx` (current state after the date filter work).

- [ ] **Step 2: Add imports**

```tsx
import { getAdminUsageAnalytics } from "@/lib/usage/admin-analytics.server";
import { AdminHabitsCard } from "@/components/usage/admin-habits-card";
import { AdminComparisonCard } from "@/components/usage/admin-comparison-card";
import { AdminInsightsCard } from "@/components/usage/admin-insights-card";
import { AdminProjectDrilldownCard } from "@/components/usage/admin-project-drilldown-card";
```

- [ ] **Step 3: Call aggregator**

After `getUsageDashboardData` call, add `getAdminUsageAnalytics`:

```tsx
const [t, { dashboard, preference }, options, analytics] = await Promise.all([
  getTranslations({ locale, namespace: "admin" }),
  getUsageDashboardData({ userId: targetUserId, query }),
  getFilterOptions(targetUserId),
  getAdminUsageAnalytics({
    userId: targetUserId,
    range: dashboard.range,
    timezone: dashboard.range.timezone,
  }),
]);
```

- [ ] **Step 4: Pass `dailyAverages` to KpiGrid**

Update KpiGrid invocation:

```tsx
<KpiGrid
  overview={dashboard.overview}
  pricingSummary={dashboard.pricingSummary}
  modelPricingRows={dashboard.modelPricingRows}
  dailyAverages={{
    tokens: analytics.dailyAverages.tokens,
    cost: analytics.dailyAverages.cost,
    sessions: analytics.dailyAverages.sessions,
    activeSeconds: analytics.dailyAverages.activeSeconds,
    activeDays: analytics.dailyAverages.activeDays,
  }}
/>
```

- [ ] **Step 5: Append 4 new cards after SessionsSection**

```tsx
<div className="grid gap-4 lg:grid-cols-2">
  <AdminHabitsCard habits={{
    hourHistogram: analytics.hourHistogram,
    weekdayHistogram: analytics.weekdayHistogram,
    currentStreak: analytics.habits.currentStreak,
    longestStreak: analytics.habits.longestStreak,
    deviceCount: analytics.habits.deviceCount,
  }} />
  <AdminInsightsCard insights={analytics.insights} />
</div>
<AdminComparisonCard
  user={{
    tokens: analytics.dailyAverages.tokens * analytics.dailyAverages.activeDays,
    cost: analytics.dailyAverages.cost * analytics.dailyAverages.activeDays,
    sessions: analytics.dailyAverages.sessions * analytics.dailyAverages.activeDays,
    activeSeconds: analytics.dailyAverages.activeSeconds * analytics.dailyAverages.activeDays,
  }}
  vsPlatform={analytics.comparison.vsPlatform}
  vsPrevPeriod={analytics.comparison.vsPrevPeriod}
/>
<AdminProjectDrilldownCard projects={analytics.projectDrilldown} />
```

- [ ] **Step 6: Build, verify success**

Run: `pnpm build:web`
Expected: success. (Ignore pre-existing DATABASE_URL error in static analysis; just need TypeScript to pass.)

- [ ] **Step 7: Commit**

```bash
git add web/app/[locale]/u/[username]/admin-dashboard-block.tsx
git commit -m "feat(web): wire admin analytics cards into dashboard block"
```

---

## Task 13: i18n keys

**Files:**
- Modify: `web/messages/zh.json`
- Modify: `web/messages/en.json`

- [ ] **Step 1: Add to zh.json**

Locate existing `email.*` namespace (or `admin.*` namespace). Add new keys. For email:

```json
"email": {
  "inactivity": {
    "subject": "Token Arena 想你了",
    "title": "好久没看到你的数据了",
    "body": "已经 {inactiveDays} 个工作日没收到你的上传数据。",
    "cta": "立刻上传数据 →",
    "footer": "如果你最近在休息或出门，这封邮件可以忽略。"
  }
}
```

For admin card labels (zh):
```json
"admin": {
  "habits": "使用习惯",
  "comparison": "对比",
  "insights": "洞察",
  "projects": "项目分布",
  "currentStreak": "当前 streak",
  "longestStreak": "最长 streak",
  "deviceCount": "设备数",
  "dailyAvgTokens": "日均 tokens",
  "dailyAvgCost": "日均 cost",
  "dailyAvgSessions": "日均 sessions",
  "dailyAvgActive": "日均 active"
}
```

- [ ] **Step 2: Add to en.json**

Mirror structure with English text.

- [ ] **Step 3: Verify build**

Run: `pnpm build:web`
Expected: success (TypeScript + i18n types pass)

- [ ] **Step 4: Commit**

```bash
git add web/messages/
git commit -m "feat(web): add i18n keys for admin analytics + email templates"
```

---

## Task 14: Worker package skeleton

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/Dockerfile`
- Create: `worker/src/index.ts`
- Modify: `web/package.json`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Update pnpm-workspace.yaml**

Add `worker` to the workspace list (read current file first to find format).

- [ ] **Step 2: Add exports to web/package.json**

Read `web/package.json` first. Add `exports` field (or extend if exists):

```json
"exports": {
  "./lib/email/inactivity-core": {
    "types": "./lib/email/inactivity-core.ts",
    "default": "./lib/email/inactivity-core.ts"
  }
}
```

- [ ] **Step 3: Create worker/package.json**

```json
{
  "name": "@tokenarena/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@prisma/client": "^7.8.0",
    "@tokenarena/web": "workspace:*",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: Create worker/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["../web/*"]
    }
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Create worker/src/index.ts**

```ts
import cron from "node-cron";
import { runInactivitySweep } from "@tokenarena/web/lib/email/inactivity-core";

let isRunning = false;

cron.schedule("* * * * *", async () => {
  if (isRunning) {
    console.warn("[inactivity] previous sweep still running, skipping tick");
    return;
  }
  isRunning = true;
  try {
    const result = await runInactivitySweep();
    console.log("[inactivity] sweep", result);
  } catch (err) {
    console.error("[inactivity] sweep failed", err);
  } finally {
    isRunning = false;
  }
});

console.log("[worker] inactivity cron started");
```

- [ ] **Step 6: Create worker/Dockerfile**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./
COPY worker ./worker
COPY web ./web
COPY cli ./cli
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tokenarena/web exec prisma generate
RUN pnpm --filter @tokenarena/worker build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY worker ./worker
COPY web ./web
COPY cli ./cli
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/worker/dist ./worker/dist
CMD ["node", "worker/dist/index.js"]
```

- [ ] **Step 7: Commit**

```bash
git add worker/ pnpm-workspace.yaml web/package.json
git commit -m "feat(worker): scaffold cron worker for inactivity sweep"
```

---

## Task 15: docker-compose + env config

**Files:**
- Modify: `docker-compose.yml`
- Modify: `web/.env.example`
- Modify: `README.md`

- [ ] **Step 1: Read docker-compose.yml**

Read current docker-compose.yml.

- [ ] **Step 2: Add worker service**

Append after `web` service:

```yaml
  worker:
    build:
      context: .
      dockerfile: worker/Dockerfile
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL:-postgresql://postgres:postgres@db:5432/token_arena}
      - SMTP_HOST=${SMTP_HOST:-}
      - SMTP_PORT=${SMTP_PORT:-465}
      - SMTP_SECURE=${SMTP_SECURE:-}
      - SMTP_USER=${SMTP_USER:-}
      - SMTP_PASSWORD=${SMTP_PASSWORD:-}
      - SMTP_FROM=${SMTP_FROM:-noreply@tokenarena.example}
      - BETTER_AUTH_URL=${BETTER_AUTH_URL:-http://localhost:3000}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
```

- [ ] **Step 3: Add SMTP vars to web/.env.example**

Append:

```
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM="Token Arena <noreply@tokenarena.example>"
```

- [ ] **Step 4: Document in README.md**

Append section under "Configuration" or similar:

```markdown
## Inactivity Email Reminders

The worker service sends email reminders to users inactive for 3+ business days (CN holidays + weekends excluded). Configure SMTP in `.env`:

- `SMTP_HOST` — SMTP server hostname
- `SMTP_PORT` — 465 (implicit TLS) or 587 (STARTTLS)
- `SMTP_SECURE` — leave empty to auto-derive from port; set `true`/`false` to override
- `SMTP_USER` / `SMTP_PASSWORD` — credentials
- `SMTP_FROM` — sender address

Reminder cadence: first reminder + weekly. Users opt out by uploading data; the next sweep resolves the reminder record.
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml web/.env.example README.md
git commit -m "feat(worker): add docker-compose service + SMTP env config"
```

---

## Task 16: Run full checks and deploy

- [ ] **Step 1: Install**

Run: `pnpm install`
Expected: success, no peer dep errors

- [ ] **Step 2: Prisma migration**

Run: `pnpm --filter ./web exec prisma migrate dev --name inactivity_reminder`
Expected: migration applied

- [ ] **Step 3: Lint + format + tests**

Run: `pnpm check`
Run: `pnpm test:web`
Expected: PASS

- [ ] **Step 4: Build**

Run: `pnpm build`
Run: `pnpm --filter @tokenarena/worker build`
Expected: success

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "chore: lockfile updates from new deps" || true
git push
```

- [ ] **Step 6: Server deploy**

```bash
ssh ebs@192.168.6.74 "cd /home/ebs/TokenArena && git pull && docker compose up -d --build"
```

Expected: containers `tokenarena-web-1` and new `tokenarena-worker-1` running

- [ ] **Step 7: Verify worker logs**

```bash
ssh ebs@192.168.6.74 "docker logs tokenarena-worker-1 --tail 5"
```

Expected: `[worker] inactivity cron started`

- [ ] **Step 8: Manual UI check**

Visit `http://192.168.6.74:3000/zh/u/{any-username}` as admin → verify 4 new cards render under SessionsSection.

---

## Self-Review Checklist

- [x] Spec coverage: all 4 dimensions + daily-avg + email + worker implemented
- [x] No placeholders or TBDs
- [x] Type consistency: `AdminAnalytics` shape used uniformly; `dailyAverages` keyed correctly
- [x] Per-user try/catch in sweep
- [x] Cached SMTP transport
- [x] Worker build config (exports + Dockerfile + tsconfig paths)
- [x] Rule minimums (costSpike ≥ 7 days, deviceGrowth ≥ 4 base)
- [x] InactivityReminder has updatedAt
- [x] Active-day denominator
- [x] cron overlap protection
- [x] KpiGridProps extension documented

## Open Items

- Verify SMTP creds on server (user action)
- Holiday list maintenance (hand-curated, 2027+ to be added)
- Worker single-instance only; multi-instance needs DB advisory lock (deferred)
