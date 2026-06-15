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

const BOM = "þÿ";

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
