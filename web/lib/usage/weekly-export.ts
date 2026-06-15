import { addToParts, toZonedParts, zonedDateTimeToUtc } from "./date-range";

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

export type IsoWeek = {
  from: Date; // 本周一 00:00:00 UTC
  to: Date; // 下周一 00:00:00 UTC (开区间)
  label: string; // "2026-W25"
  fromIso: string; // tz 下的 "YYYY-MM-DD"
  toIso: string; // tz 下的 "YYYY-MM-DD"
};

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

const BOM = String.fromCharCode(0xfeff);

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
        formatCell(
          r.firstActiveAt === null ? null : r.firstActiveAt.toISOString(),
        ),
        formatCell(
          r.lastActiveAt === null ? null : r.lastActiveAt.toISOString(),
        ),
      ].join(","),
    );
  }
  return `${BOM}${lines.join("\n")}\n`;
}

function isoDateInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function ymdInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isoWeekParts(
  y: number,
  m: number,
  d: number,
): {
  year: number;
  week: number;
} {
  // ISO 8601: weeks start Monday; week 1 is the week containing Jan 4.
  const date = new Date(Date.UTC(y, m - 1, d));
  // ISO weekday: Mon=1, ..., Sun=7
  const dayNum = ((date.getUTCDay() + 6) % 7) + 1;
  // Move to the Thursday of this ISO week
  const thursday = new Date(
    date.getTime() + (4 - dayNum) * 24 * 60 * 60 * 1000,
  );
  const isoYear = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const week =
    Math.floor(
      (thursday.getTime() - jan1.getTime()) / (7 * 24 * 60 * 60 * 1000),
    ) + 1;
  return { year: isoYear, week };
}

function isoWeekLabel(monday: Date, timezone: string): string {
  const z = toZonedParts(monday, timezone);
  const { year, week } = isoWeekParts(z.year, z.month, z.day);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function resolveIsoWeek(now: Date, timezone: string): IsoWeek {
  const z = toZonedParts(now, timezone);
  const todayUtc = new Date(Date.UTC(z.year, z.month - 1, z.day));
  const utcDow = todayUtc.getUTCDay();
  const dowIso = (utcDow + 6) % 7; // Mon=0, ..., Sun=6
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

export function aggregateWeeklyUsage(
  input: WeeklyExportInput,
): WeeklyExportRow[] {
  const bucketAgg = new Map<
    string,
    {
      inputTokens: bigint;
      outputTokens: bigint;
      reasoningTokens: bigint;
      cachedTokens: bigint;
      totalTokens: bigint;
      cost: number;
      days: Set<string>;
    }
  >();
  const sessionAgg = new Map<
    string,
    { count: number; first: Date | null; last: Date | null }
  >();

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
    if (agg.first === null || s.firstMessageAt < agg.first)
      agg.first = s.firstMessageAt;
    if (agg.last === null || s.lastMessageAt > agg.last)
      agg.last = s.lastMessageAt;
  }

  const emptyBucket = {
    inputTokens: 0n,
    outputTokens: 0n,
    reasoningTokens: 0n,
    cachedTokens: 0n,
    totalTokens: 0n,
    cost: 0,
    days: new Set<string>(),
  };
  const emptySession = { count: 0, first: null, last: null };

  return input.users.map((u) => {
    const b = bucketAgg.get(u.id) ?? emptyBucket;
    const s = sessionAgg.get(u.id) ?? emptySession;
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
