# 管理员一键导出全员周度 token 统计 (CSV)

Date: 2026-06-15
Status: Approved (pending implementation)

## Goal

管理员通过 `/[locale]/admin` 页面一键下载全员本周 token 使用统计，CSV 格式，含 0 用量用户。

## Decisions

| Topic | Choice |
|-------|--------|
| Week window | ISO 周（周一 00:00 → 下周一 00:00，按管理员时区） |
| File format | CSV (UTF-8 BOM) |
| Member scope | 所有用户（含 0 用量） |
| Row granularity | 1 行 = 1 成员 |
| Columns | 13 列：成员信息 3 + token 5 + cost 1 + 活跃指标 4 |
| Entry point | 新建 `/[locale]/admin` 页面 |
| Implementation | 同步内存查询（团队 10+，1 周 1 次） |
| Streaming | 不做（流式过度工程） |
| New dependencies | 无 |
| DB migration | 无 |
| Rate limit | 内存 LRU 30s 1 次（单进程假设） |

---

## Architecture

```
GET /api/admin/weekly-export       Route Handler
  ├─ isCurrentUserAdmin()         401 / 404
  ├─ rate limit check             429
  ├─ resolveIsoWeek(tz)           { from, to, label }
  ├─ prisma.user.findMany         成员清单 (id, username, email, tz)
  ├─ prisma.usageBucket.findMany  token/cost/activeDays 聚合
  ├─ prisma.usageSession.findMany sessionCount/first/last 聚合
  ├─ merge by userId → CSV rows
  └─ Response text/csv; charset=utf-8
       Content-Disposition: attachment; filename="tokenarena-weekly-2026-W25.csv"
```

```
GET /[locale]/admin                server component
  ├─ isCurrentUserAdmin()         false → notFound()
  ├─ 显示 ISO 周标签
  ├─ 成员数 + 预估文件大小
  └─ <a href="/api/admin/weekly-export" download>导出 CSV</a>
```

---

## Data layer

### ISO 周窗口

复用 `web/lib/usage/date-range.ts`：

```ts
import { toZonedParts } from "@/lib/usage/date-range";

export function resolveIsoWeek(now: Date, timezone: string): {
  from: Date;   // 本周一 00:00:00 UTC
  to: Date;     // 下周一 00:00:00 UTC (开区间)
  label: string; // "2026-W25"
  fromIso: string; // "2026-06-16"
  toIso: string;   // "2026-06-23"
} {
  // 1. 取得 now 在 timezone 下的 ymd
  const z = toZonedParts(now, timezone);
  // 2. 该 ymd 是星期几（0=Sun..6=Sat）
  //    用 Date.UTC(z.year, z.month-1, z.day) 取 getUTCDay() 当作 tz 下的 weekday
  //    （在 tz 偏移边界附近会差 1，必要时减 1）
  const utcDow = new Date(Date.UTC(z.year, z.month - 1, z.day)).getUTCDay();
  const dow = (utcDow + 6) % 7; // 0=Mon..6=Sun，ISO 周视角
  // 3. 该 ymd 减 dow 天，得到本周一的 ymd
  const mondayUtc = new Date(Date.UTC(z.year, z.month - 1, z.day - dow));
  // 4. mondayUtc 是 tz 下"今天"的 UTC 午夜；该 UTC 时刻即 tz 下的 Monday 00:00
  //    （day 减法已对齐 tz 视角下的 Monday）
  // 5. to = from + 7 days
  const from = mondayUtc;
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  // 6. label: "YYYY-Www"，取 from 所在 ISO 周
  const labelFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    week: "numeric", // ISO 8601 week of year
  });
  const parts = Object.fromEntries(labelFormatter.formatToParts(from).map(p => [p.type, p.value]));
  const label = `${parts.weekYear ?? z.year}-W${parts.week?.padStart(2, "0") ?? "01"}`;
  // 7. fromIso / toIso: tz 下的 YYYY-MM-DD
  const isoFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  return {
    from,
    to,
    label,
    fromIso: isoFormatter.format(from),
    toIso: isoFormatter.format(to),
  };
}
```

**边界说明**：tz 偏移边界附近（dow 差 1）由测试 `resolveIsoWeek 跨月` 与 `resolveIsoWeek UTC 周日` 覆盖。如发现漂移，固定 3 次迭代修正（参考 `date-range.ts` `zonedDateTimeToUtc` 模式）。

### 成员查询

```ts
const users = await prisma.user.findMany({
  select: {
    id: true,
    username: true,
    email: true,
    usagePreference: { select: { timezone: true } },
  },
  orderBy: { username: "asc" },
});
```

管理员时区：`session.user.usagePreference?.timezone ?? "UTC"`。

### Token / cost / activeDays 聚合（来自 usageBucket）

```ts
const buckets = await prisma.usageBucket.findMany({
  where: { bucketStart: { gte: from, lt: to } },
  select: {
    userId: true,
    inputTokens: true,        // BigInt
    outputTokens: true,
    reasoningTokens: true,
    cachedTokens: true,
    totalTokens: true,
    estimatedCostUsd: true,   // Float | null
    bucketStart: true,
  },
});
// JS reduce 按 userId 聚合
```

**为什么不用 `groupBy`**：Prisma `groupBy` 不支持 BigInt 聚合，10+ 用户 JS reduce 完全够用。

### Session / 时间聚合（来自 usageSession）

```ts
const sessions = await prisma.usageSession.findMany({
  where: { firstMessageAt: { gte: from, lt: to } },
  select: {
    userId: true,
    firstMessageAt: true,
    lastMessageAt: true,
  },
});
// reduce 算 sessionCount / firstActiveAt / lastActiveAt
```

### 合并

```ts
type Row = {
  username: string;
  email: string;
  timezone: string;
  inputTokens: bigint;
  outputTokens: bigint;
  reasoningTokens: bigint;
  cachedTokens: bigint;
  totalTokens: bigint;
  estimatedCostUsd: number;   // 0 if null
  activeDays: number;          // distinct bucketStart 日期数
  sessionCount: number;
  firstActiveAt: Date | null;
  lastActiveAt: Date | null;
};
```

遍历 `users`，bucket/session 命中累加，未命中 0 值。

---

## CSV format

UTF-8 BOM (`\xEF\xBB\xBF`) + 13 列表头 + N 行数据。

| 列 | 来源 | 格式 |
|---|---|---|
| username | User | 原样 |
| email | User | CSV escape |
| timezone | usagePreference.timezone | 原样；缺省 `UTC` |
| input_tokens | sum(BigInt) | 字符串（无千分位） |
| output_tokens | sum(BigInt) | 字符串 |
| reasoning_tokens | sum(BigInt) | 字符串 |
| cached_tokens | sum(BigInt) | 字符串 |
| total_tokens | sum(BigInt) | 字符串 |
| estimated_cost_usd | sum(Float, 0 if null) | 数字（保留 6 位小数） |
| active_days | distinct `YYYY-MM-DD` (管理员时区下，源自 bucketStart) | 整数 |
| session_count | count | 整数 |
| first_active_at | min(firstMessageAt) | ISO 8601 UTC `2026-06-15T10:23:45.000Z`；空字符串表示无数据 |
| last_active_at | max(lastMessageAt) | 同上 |

### CSV escape

```ts
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
```

`email` 含 `@` 不触发 escape，但为安全统一过函数。

---

## Files

新建：
- `web/lib/usage/weekly-export.ts` — `resolveIsoWeek` / `aggregateWeeklyUsage` / `buildCsv` / `csvEscape`
- `web/lib/usage/weekly-export.test.ts` — 单元测试
- `web/app/api/admin/weekly-export/route.ts` — Route Handler
- `web/app/api/admin/weekly-export/route.test.ts` — 集成测试
- `web/app/[locale]/admin/page.tsx` — 管理员首页
- `web/app/[locale]/admin/page.test.tsx` — admin gate 渲染测试

修改：
- `web/messages/zh.json` — 新增 `admin.weeklyExport.*`
- `web/messages/en.json` — 同上

无新依赖。无 DB 迁移。无 worker 改动。

---

## i18n keys

```jsonc
"admin": {
  "weeklyExport": {
    "title": "管理员控制台",
    "subtitle": "周度用量导出",
    "isoWeekLabel": "本周 ISO 周：{label}",
    "timezoneLabel": "管理员时区：{tz}",
    "memberCount": "成员数：{count}",
    "downloadButton": "导出本周 CSV",
    "downloadHint": "包含 0 用量用户，浏览器直接保存",
    "errors": {
      "noAccess": "无权访问"
    }
  }
}
```

en.json 同构。

---

## Rate limit

进程内 `Map<adminId, number>`，记录上次**允许放行**的时间戳。30 秒内重复请求 → 429。

**单进程假设**：Next.js standalone 部署下 admin 实例通常 1 个；多副本时各副本独立计时，最坏 30s×replicas。10+ 用户场景可接受。注释里写明。

```ts
const lastExportAt = new Map<string, number>();
const RATE_LIMIT_MS = 30_000;

function checkRateLimit(adminId: string): boolean {
  const now = Date.now();
  const last = lastExportAt.get(adminId) ?? 0;
  if (now - last < RATE_LIMIT_MS) return false;
  lastExportAt.set(adminId, now);
  return true;
}
```

---

## Admin gate 双层

- **page**：`isCurrentUserAdmin() === false` → `notFound()`，避免暴露端点
- **route handler**：`getOptionalSession() === null` → 401；`isCurrentUserAdmin() === false` → 404

---

## Error handling

| 场景 | 行为 |
|---|---|
| 未登录 | route 401 JSON `{ error: "UNAUTHORIZED" }` |
| 非 admin | route 404 JSON `{ error: "NOT_FOUND" }` |
| 管理员时区解析失败 | route 400 JSON `{ error: "INVALID_TIMEZONE" }` |
| 30s 内重复 | route 429 JSON `{ error: "RATE_LIMITED" }` |
| DB 查询失败 | route 500 JSON `{ error: "INTERNAL" }` + console.error |
| 全员 0 用量 | route 200 + 只表头 CSV |
| 部分字段缺失 | row 字段为空字符串 / 0 |

---

## Testing

### 单元测试 `weekly-export.test.ts`

| Case | 输入 | 断言 |
|---|---|---|
| `resolveIsoWeek` 跨月 | 2026-06-15 周一 Asia/Shanghai | from=2026-06-15, to=2026-06-22, label="2026-W25" |
| `resolveIsoWeek` UTC 周日 | 2026-06-15 UTC 周一 | label="2026-W25" |
| `csvEscape` 普通 | `"hello"` | `"hello"` |
| `csvEscape` 含逗号 | `"a,b"` | `"a,b"`（带引号） |
| `csvEscape` 含引号 | `say "hi"` | `"say ""hi"""` |
| `csvEscape` 含换行 | `"a\nb"` | `"a\nb"`（带引号） |
| `csvEscape` 空 | `""` | `""` |
| `aggregateWeeklyUsage` 零用量 | 空 buckets + 空 sessions | rows 全 0，first/last 为 null |
| `aggregateWeeklyUsage` 部分用量 | 1 用户 3 buckets | tokens/cost/activeDays=3，sessionCount 来自 sessions |
| `aggregateWeeklyUsage` BigInt 字段 | 单 bucket totalTokens=9007199254740993 | 输出字符串原值不溢出 |
| `buildCsv` BOM | `buildCsv([])` | 输出开头 3 字节 `\xEF\xBB\xBF` |
| `buildCsv` 表头顺序 | `buildCsv([row])` | 第一行逗号分隔与 13 列名严格一致 |
| `buildCsv` 零值用户 | `[{ username:"u", ...all zeros }]` | 数字字段为 `0`；first/last 为空字符串 |

### 集成测试 `weekly-export/route.test.ts`

| Case | Mock | 断言 |
|---|---|---|
| 未登录 | session = null | 401 |
| 非 admin | session.user.username 不在 allowlist | 404 |
| rate limit | 同 admin 第二次请求 < 30s | 429 |
| admin 成功 | mock findMany 返回 1 user + 0 buckets | 200, Content-Type: text/csv; charset=utf-8, Content-Disposition 含 `attachment; filename="tokenarena-weekly-2026-W25.csv"`, body 起始 3 字节为 BOM |

### Page 测试 `admin/page.test.tsx`

| Case | Mock | 断言 |
|---|---|---|
| 非 admin | session.isAdmin = false | 渲染 notFound |
| admin | session.isAdmin = true | 渲染标题 + ISO 周标签 + 下载按钮 |

覆盖率门槛走 `web/AGENTS.md` 既定阈值（statements 75% / branches 70% / functions 75% / lines 75%）。

---

## Out of scope (YAGNI)

- XLSX 格式（用户已选 CSV）
- 流式 cursor（团队 10+ 不需要）
- 异步任务 + 下载链接（团队 10+ 不需要）
- 上周期对比列
- 项目/设备级粒度
- 多语言文件名
- 邮件发送导出
- 多管理员时区偏好
