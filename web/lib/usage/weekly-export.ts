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
