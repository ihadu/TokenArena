import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Row = {
  tokens: number;
  cost: number;
  sessions: number;
  activeSeconds: number;
};

const METRIC_LABELS: Record<keyof Row, string> = {
  tokens: "Tokens",
  cost: "费用",
  sessions: "会话数",
  activeSeconds: "活跃时长",
};

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
  if (Math.abs(delta) < 1)
    return <Minus className="size-3.5 text-muted-foreground" />;
  return delta > 0 ? (
    <ArrowUp className="size-3.5 text-emerald-500" />
  ) : (
    <ArrowDown className="size-3.5 text-rose-500" />
  );
}

export function AdminComparisonCard({ user, vsPlatform, vsPrevPeriod }: Props) {
  return (
    <Card className="bg-card shadow-sm ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">对比</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="text-left font-normal pb-2">指标</th>
              <th className="text-right font-normal pb-2">当前</th>
              <th className="text-right font-normal pb-2">vs 平台平均</th>
              <th className="text-right font-normal pb-2">Δ 平台</th>
              <th className="text-right font-normal pb-2">vs 上周期</th>
              <th className="text-right font-normal pb-2">Δ 上周期</th>
            </tr>
          </thead>
          <tbody>
            {(["tokens", "cost", "sessions", "activeSeconds"] as const).map(
              (key) => {
                const dPlatform = pctDelta(user[key], vsPlatform[key]);
                const dPrev = pctDelta(user[key], vsPrevPeriod[key]);
                return (
                  <tr key={key} className="border-t border-border/50">
                    <td className="py-2 text-muted-foreground">
                      {METRIC_LABELS[key]}
                    </td>
                    <td className="text-right tabular-nums">{user[key]}</td>
                    <td className="text-right text-muted-foreground tabular-nums">
                      {vsPlatform[key]}
                    </td>
                    <td className="text-right">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        {dPlatform.toFixed(0)}%
                        <DeltaBadge delta={dPlatform} />
                      </span>
                    </td>
                    <td className="text-right text-muted-foreground tabular-nums">
                      {vsPrevPeriod[key]}
                    </td>
                    <td className="text-right">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        {dPrev.toFixed(0)}%
                        <DeltaBadge delta={dPrev} />
                      </span>
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
