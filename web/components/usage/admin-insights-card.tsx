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
                    {i.hint ? (
                      <div className="text-xs text-muted-foreground mt-1">
                        💡 {i.hint}
                      </div>
                    ) : null}
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
