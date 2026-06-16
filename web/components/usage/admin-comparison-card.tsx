import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTokenCount, formatUsdAmount } from "@/lib/usage/format";
import type { AdminAnalyticsMetric } from "@/lib/usage/insights";

type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

type Props = {
  t: Translator;
  locale: string;
  metrics: AdminAnalyticsMetric[];
  prevActiveDays: number;
  costAvailable: boolean;
  prevPeriodAvailable: boolean;
};

function formatMetricValue(
  format: AdminAnalyticsMetric["format"],
  value: number,
  locale: string,
): string {
  if (format === "tokens") return formatTokenCount(value, locale);
  if (format === "cost") return formatUsdAmount(value, locale);
  if (format === "percent") return `${(value * 100).toFixed(1)}%`;
  return formatTokenCount(value, locale);
}

function ratioDelta(user: number, baseline: number): number | null {
  if (baseline === 0) {
    if (user === 0) return 1;
    return null;
  }
  return user / baseline;
}

function formatRatio(delta: number | null): string {
  if (delta === null) return "—";
  return `${delta.toFixed(2)}×`;
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <Minus className="size-3.5 text-muted-foreground" />;
  }
  if (Math.abs(delta - 1) < 0.05) {
    return <Minus className="size-3.5 text-muted-foreground" />;
  }
  return delta > 1 ? (
    <ArrowUp className="size-3.5 text-emerald-500" />
  ) : (
    <ArrowDown className="size-3.5 text-rose-500" />
  );
}

function naLabel(t: Translator, kind: "cost" | "noPrev"): string {
  if (kind === "cost") return t("costNotIntegrated");
  return t("noPrevPeriod");
}

function MetricCard({
  t,
  locale,
  metric,
  costAvailable,
  prevPeriodAvailable,
  prevActiveDays,
}: {
  t: Translator;
  locale: string;
  metric: AdminAnalyticsMetric;
  costAvailable: boolean;
  prevPeriodAvailable: boolean;
  prevActiveDays: number;
}) {
  const isCost = metric.key === "cost";
  const showCost = !isCost || costAvailable;
  const showPrev = prevPeriodAvailable;

  const dLifetime = ratioDelta(metric.current, metric.lifetime);
  const dPlatform = ratioDelta(metric.current, metric.vsPlatform);
  const dPrev = ratioDelta(metric.current, metric.vsPrev);

  function renderValue(value: number, show: boolean) {
    if (!show) {
      return (
        <span className="text-muted-foreground italic">
          {naLabel(t, isCost ? "cost" : "noPrev")}
        </span>
      );
    }
    return (
      <span className="tabular-nums">
        {formatMetricValue(metric.format, value, locale)}
      </span>
    );
  }

  function renderDelta(delta: number | null, show: boolean) {
    if (!show) {
      return (
        <span className="text-muted-foreground italic">
          {naLabel(t, isCost ? "cost" : "noPrev")}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 tabular-nums">
        {formatRatio(delta)}
        <DeltaBadge delta={delta} />
      </span>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="text-xs text-muted-foreground mb-1">
        {t(`metric_${metric.key}`)}
      </div>
      <div className="text-xl font-semibold tabular-nums">
        {renderValue(metric.current, showCost)}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">{t("lifetimeShort")}</div>
          <div className="text-muted-foreground">
            {renderValue(metric.lifetime, showCost)}
          </div>
          <div className="text-muted-foreground">
            {renderDelta(dLifetime, showCost)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">{t("platformShort")}</div>
          <div className="text-muted-foreground">
            {renderValue(metric.vsPlatform, showCost)}
          </div>
          <div className="text-muted-foreground">
            {renderDelta(dPlatform, showCost)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">
            {t("prevShort")}
            {showPrev ? ` · n=${prevActiveDays}` : ""}
          </div>
          <div className="text-muted-foreground">
            {renderValue(metric.vsPrev, showCost && showPrev)}
          </div>
          <div className="text-muted-foreground">
            {renderDelta(dPrev, showCost && showPrev)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminComparisonCard({
  t,
  locale,
  metrics,
  prevActiveDays,
  costAvailable,
  prevPeriodAvailable,
}: Props) {
  return (
    <Card className="bg-card shadow-sm ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("comparison")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => (
            <MetricCard
              key={m.key}
              t={t}
              locale={locale}
              metric={m}
              costAvailable={costAvailable}
              prevPeriodAvailable={prevPeriodAvailable}
              prevActiveDays={prevActiveDays}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
