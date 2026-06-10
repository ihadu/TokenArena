# 管理面板个人档案式分析 + 低活跃邮件提醒

Date: 2026-06-10
Status: Approved (pending implementation)

## Goal

Two features targeting admin-facing per-user analytics and proactive engagement:

1. Extend the admin dashboard at `/u/{username}` with 4 new analysis sections (habits / project drilldown / comparison / insights) plus daily-average KPIs.
2. Add a separate worker service that scans users daily, sends SMTP email reminders to anyone inactive for 3+ business days (excluding CN holidays + weekends), first + weekly cadence.

Audience for the dashboard cards: admin only. Reminder recipients: the user themselves.

## Decisions

| Topic | Choice |
|-------|--------|
| Layout | Inline in `AdminDashboardBlock` |
| Comparison baseline | vs platform average + vs previous period |
| Insights source | Rule-based (no AI) |
| Email transport | SMTP |
| Non-working days | CN statutory holidays + weekends |
| Reminder cadence | First reminder + weekly |
| Scheduler | Independent worker Docker service |

---

## Part 1: Admin per-user analytics

### 1.1 Data layer — `web/lib/usage/admin-analytics.server.ts`

New aggregator `getAdminUsageAnalytics({ userId, range, timezone })`. Reuses:
- `getUsageDashboardData` for already-computed fields
- `prisma.usageBucket` / `prisma.usageSession` / `prisma.usageDevice`
- `getAchievementArenaSummary` (`web/lib/achievements/queries.ts`) for platform average
- `resolveDashboardRange` / `getPreviousRange` (`web/lib/usage/date-range.ts`)

Return shape:
```ts
{
  dailyAverages: { tokens, cost, sessions, activeSeconds, activeDays },
  habits: {
    hourHistogram: number[24],
    weekdayHistogram: number[7],
    longestStreak: number,
    currentStreak: number,
    deviceCount: number,
  },
  projectDrilldown: Array<{
    projectKey, projectLabel, totalTokens, sessions,
    activeDays, topModels: Array<{ model, totalTokens }>,
  }>,
  comparison: {
    vsPlatform: { tokens, cost, sessions, activeSeconds },    // 同期全员均值
    vsPrevPeriod: { tokens, cost, sessions, activeSeconds },   // 同长度上周期
  },
  insights: Array<{ id, kind, severity, title, body, hint }>,
}
```

### 1.2 UI — 4 new card components

| Card | File | Contents |
|------|------|----------|
| `HabitsCard` | `web/components/usage/admin-habits-card.tsx` | 24h histogram + weekday distribution + streak + device count |
| `ProjectDrilldownCard` | `web/components/usage/admin-project-drilldown-card.tsx` | Project card grid; click expands session table |
| `ComparisonCard` | `web/components/usage/admin-comparison-card.tsx` | vs platform avg / vs prev period dual column |
| `InsightsCard` | `web/components/usage/admin-insights-card.tsx` | Rule items with icon + severity color |

Position: append after `SessionsSection` in `web/app/[locale]/u/[username]/admin-dashboard-block.tsx`.

### 1.3 Rule engine — `web/lib/usage/insights.ts`

```ts
type Rule = (analytics: AdminAnalytics) => Insight[];
```

| Rule | Trigger |
|------|---------|
| `streakRule` | current streak ≥ 7 |
| `inactiveRule` | current streak == 0 AND ≤ 3 active days in past 14 |
| `costSpikeRule` | single-day cost > mean + 3σ |
| `projectShiftRule` | project share week-over-week delta > 30pp |
| `modelShiftRule` | dominant model changes week-over-week |
| `deviceGrowthRule` | device count week-over-week ≥ +50% |

Returns `{ id, kind, severity: info|warn|critical, title, body, hint }`.

### 1.4 KPI daily-average extension

Extend `KpiGrid` with 4 sub-cards: daily-avg tokens / cost / sessions / activeSeconds.
Formula: `metric / count(distinct days where metric > 0)`.

### 1.5 Files (Part 1)

New:
- `web/lib/usage/admin-analytics.server.ts`
- `web/lib/usage/admin-analytics.test.ts`
- `web/lib/usage/insights.ts`
- `web/lib/usage/insights.test.ts`
- `web/components/usage/admin-habits-card.tsx`
- `web/components/usage/admin-habits-card.test.tsx`
- `web/components/usage/admin-project-drilldown-card.tsx`
- `web/components/usage/admin-comparison-card.tsx`
- `web/components/usage/admin-insights-card.tsx`

Modified:
- `web/app/[locale]/u/[username]/admin-dashboard-block.tsx` — append 4 cards + call `getAdminUsageAnalytics`
- `web/components/usage/kpi-grid.tsx` — add daily-avg sub-cards
- `web/messages/zh.json` / `web/messages/en.json` — new i18n keys

---

## Part 2: Inactivity email reminder

### 2.1 Database

New `InactivityReminder` model in `web/prisma/schema.prisma`:

```prisma
model InactivityReminder {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  firstSentAt   DateTime
  lastSentAt    DateTime
  sendCount     Int      @default(1)
  lastCheckAt   DateTime
  resolvedAt    DateTime?
  @@index([userId, resolvedAt])
  @@index([lastCheckAt])
}
```

### 2.2 Holiday data — `web/lib/holidays/cn.ts`

```ts
export const CN_HOLIDAYS_2025_2026: Set<string> = new Set([
  "2025-01-01", "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31",
  // ... Spring Festival / Qingming / Labor / Dragon Boat / Mid-Autumn / National Day
  "2026-...", // 持续追加
]);

export function isNonWorkingDay(date: Date, timezone: string): boolean {
  const ymd = formatDateInput(date, timezone);
  if (CN_HOLIDAYS_2025_2026.has(ymd)) return true;
  const weekday = getZonedWeekday(date, timezone);
  return weekday === 0 || weekday === 6;  // 周末
}
```

### 2.3 Email send — `web/lib/email/smtp.ts`

```ts
import nodemailer from "nodemailer";

export function createSmtpTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
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
  const html = renderInactivityEmailTemplate(...);
  return createSmtpTransport().sendMail({ from: ..., to: opts.to, subject, html });
}
```

New dep: `nodemailer`.

### 2.4 Reminder logic — `web/lib/email/inactivity-core.ts`

> "3 个非节假日无活动" = 从最后一次活跃日期到今天，去掉周末和 CN_HOLIDAYS，剩余天数 ≥ 3 才触发。`countInactiveBusinessDays(lastActive, now, tz)` 实现此逻辑。

非 server-only，worker 直接引用；`inactivity.server.ts` 仅 re-export 加 `"server-only"` 屏障。

```ts
export async function runInactivitySweep(): Promise<{ sent: number; skipped: number; resolved: number }> {
  const users = await prisma.user.findMany({
    where: { usagePreference: { timezone: { not: null } } },
    select: { id: true, email: true, username: true, usagePreference: { select: { timezone: true, locale: true } } },
  });

  const now = new Date();
  let sent = 0, skipped = 0, resolved = 0;

  for (const user of users) {
    const tz = user.usagePreference?.timezone ?? "UTC";
    const zonedNow = toZonedParts(now, tz);
    if (zonedNow.hour !== 9) continue;  // 仅 9:00 触发

    const lastActive = await getLastActiveDay(user.id, tz);
    const inactiveBizDays = countInactiveBusinessDays(lastActive, now, tz);

    const existing = await prisma.inactivityReminder.findFirst({
      where: { userId: user.id, resolvedAt: null },
      orderBy: { firstSentAt: "desc" },
    });

    if (inactiveBizDays < 3) {
      // 已恢复活跃：标记 resolved
      if (existing) {
        await prisma.inactivityReminder.update({
          where: { id: existing.id },
          data: { resolvedAt: now },
        });
        resolved++;
      }
      continue;
    }

    const isFirst = !existing;
    const isWeeklyDue = existing
      && now.getTime() - existing.lastSentAt.getTime() >= 7 * 24 * 60 * 60 * 1000;

    if (!isFirst && !isWeeklyDue) { skipped++; continue; }

    await sendInactivityReminder({...});
    if (existing) {
      await prisma.inactivityReminder.update({
        where: { id: existing.id },
        data: { lastSentAt: now, sendCount: existing.sendCount + 1 },
      });
    } else {
      await prisma.inactivityReminder.create({
        data: { userId: user.id, firstSentAt: now, lastSentAt: now, sendCount: 1, lastCheckAt: now },
      });
    }
    sent++;
  }

  return { sent, skipped, resolved };
}
```

### 2.5 Worker service — `worker/`

New monorepo workspace (modify root `pnpm-workspace.yaml` to add `worker/`):

```
worker/
├── package.json
├── Dockerfile
├── src/
│   └── index.ts    # node-cron + runInactivitySweep 每分钟跑一次
├── tsconfig.json
```

`docker-compose.yml` appends:
```yaml
  worker:
    build:
      context: ./worker
    environment:
      - DATABASE_URL=...
      - SMTP_HOST=...
      - SMTP_PORT=...
      - SMTP_USER=...
      - SMTP_PASSWORD=...
      - SMTP_FROM=...
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
```

`worker/src/index.ts`:
```ts
import cron from "node-cron";
import { runInactivitySweep } from "@tokenarena/web/lib/email/inactivity-core";

cron.schedule("* * * * *", async () => {
  try {
    const result = await runInactivitySweep();
    console.log("[inactivity] sweep", result);
  } catch (err) {
    console.error("[inactivity] sweep failed", err);
  }
});
```

cron runs every minute; sweep internally filters users whose local hour is 9.

New dep: `node-cron`.

### 2.6 Env vars

Add to `web/.env.example` / `docker-compose.yml` / `README.md`:
```
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM="Token Arena <noreply@tokenarena.example>"
```

### 2.7 Files (Part 2)

New:
- `worker/package.json`
- `worker/Dockerfile`
- `worker/tsconfig.json`
- `worker/src/index.ts`
- `web/lib/holidays/cn.ts`
- `web/lib/holidays/cn.test.ts`
- `web/lib/email/smtp.ts`
- `web/lib/email/inactivity-core.ts`
- `web/lib/email/inactivity.server.ts`
- `web/lib/email/inactivity-core.test.ts`
- `web/prisma/migrations/20260610_inactivity_reminder/migration.sql`
- `web/components/email/inactivity-template.tsx`

Modified:
- `web/prisma/schema.prisma` — add `InactivityReminder` model
- `pnpm-workspace.yaml` — add `worker/` workspace
- `docker-compose.yml` — add `worker` service
- `web/.env.example`, `README.md` — add SMTP vars
- `web/messages/zh.json` / `web/messages/en.json` — add `email.inactivity.*` namespace

New deps: `nodemailer` (web), `node-cron` (worker)

---

## Reuse

| Existing | Use |
|----------|-----|
| `resolveDashboardRange` / `getPreviousRange` | Part 1 prev-period comparison |
| `getAchievementArenaSummary` | Part 1 platform average |
| `getUsageDashboardData` | Part 1 partial pre-computation |
| `dashboardQuerySchema` | Part 1 range params |
| `FiltersBar` | Part 1 shared date filter |
| `canRenderAdminBlock` | Part 1 visibility gate |
| `formatDateInput` | Part 2 holiday date key |

## Verification

1. `pnpm install` — install new deps
2. `pnpm prisma migrate dev --name inactivity_reminder` — migration
3. `pnpm check` / `pnpm build:web` / `pnpm test:web` pass
4. `pnpm --filter ./worker build` / `pnpm --filter ./worker test`
5. Deploy:
   - Server `git pull` + `docker compose up -d --build`
   - New containers: `tokenarena-web-1`, `tokenarena-worker-1`
6. Manual:
   - `/u/{username}` (admin viewer) → 4 new cards render
   - Change date range → analytics refresh
   - Insert 3-day-old last-active record for a test user → wait until 9:00 user-tz → email arrives

## Risks / Open Items

- **SMTP creds**: user must provide (QQ / NetEase / corporate)
- **Holiday list maintenance**: hand-curated; will need 2027/2028+ appends. Could swap to `cn-calendar` pkg later.
- **Worker resource**: independent container, node-cron runs every minute, query load negligible
- **Mail send failure**: catch + log, do not update `lastSentAt`, retry next sweep
- **i18n**: email template bilingual, new `email.inactivity.*` namespace