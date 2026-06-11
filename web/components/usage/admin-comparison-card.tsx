import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatDuration,
  formatTokenCount,
  formatUsdAmount,
} from "@/lib/usage/format";

type Row = {
  tokens: number;
  cost: number;
  sessions: number;
  activeSeconds: number;
};

type MetricKey = keyof Row;

type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

type Props = {
  t: Translator;
  locale: string;
  user: Row;
  vsPlatform: Row;
  vsPrevPeriod: Row;
};

function formatMetric(key: MetricKey, value: number, locale: string): string {
  if (key === "tokens") return formatTokenCount(value, locale);
  if (key === "cost") return formatUsdAmount(value, locale);
  if (key === "sessions") return value.toLocaleString(locale);
  return formatDuration(value, { compact: true });
}

function pctDelta(user: number, baseline: number): number | null {
  if (baseline === 0) {
    if (user === 0) return 0;
    return null;
  }
  return ((user - baseline) / baseline) * 100;
}

function formatDelta(delta: number | null): string {
  if (delta === null) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "";
  return `${sign}${delta.toFixed(2)}%`;
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <Minus className="size-3.5 text-muted-foreground" />;
  }
  if (Math.abs(delta) < 1) {
    return <Minus className="size-3.5 text-muted-foreground" />;
  }
  return delta > 0 ? (
    <ArrowUp className="size-3.5 text-emerald-500" />
  ) : (
    <ArrowDown className="size-3.5 text-rose-500" />
  );
}

export function AdminComparisonCard({
  t,
  locale,
  user,
  vsPlatform,
  vsPrevPeriod,
}: Props) {
  const rows: Array<{ key: MetricKey; label: string }> = [
    { key: "tokens", label: t("metricTokens") },
    { key: "cost", label: t("metricCost") },
    { key: "sessions", label: t("metricSessions") },
    { key: "activeSeconds", label: t("metricActiveSeconds") },
  ];

  return (
    <Card className="bg-card shadow-sm ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("comparison")}</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="text-left font-normal pb-2">{t("metric")}</th>
              <th className="text-right font-normal pb-2">{t("current")}</th>
              <th className="text-right font-normal pb-2">{t("vsPlatform")}</th>
              <th className="text-right font-normal pb-2">
                {t("deltaPlatform")}
              </th>
              <th className="text-right font-normal pb-2">
                {t("vsPrevPeriod")}
              </th>
              <th className="text-right font-normal pb-2">
                {t("deltaPrevPeriod")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label }) => {
              const dPlatform = pctDelta(user[key], vsPlatform[key]);
              const dPrev = pctDelta(user[key], vsPrevPeriod[key]);
              return (
                <tr key={key} className="border-t border-border/50">
                  <td className="py-2 text-muted-foreground">{label}</td>
                  <td className="text-right tabular-nums">
                    {formatMetric(key, user[key], locale)}
                  </td>
                  <td className="text-right text-muted-foreground tabular-nums">
                    {formatMetric(key, vsPlatform[key], locale)}
                  </td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      {formatDelta(dPlatform)}
                      <DeltaBadge delta={dPlatform} />
                    </span>
                  </td>
                  <td className="text-right text-muted-foreground tabular-nums">
                    {formatMetric(key, vsPrevPeriod[key], locale)}
                  </td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      {formatDelta(dPrev)}
                      <DeltaBadge delta={dPrev} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
