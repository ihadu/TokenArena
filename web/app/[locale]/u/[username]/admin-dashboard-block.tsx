import "server-only";

import { getTranslations } from "next-intl/server";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { BreakdownGrid } from "@/components/usage/breakdown-grid";
import { KpiGrid } from "@/components/usage/kpi-grid";
import { SessionsSection } from "@/components/usage/sessions-section";
import { UsageVisualizationCard } from "@/components/usage/usage-visualization-card";
import type { dashboardQuerySchema } from "@/lib/usage/contracts";
import { getUsageDashboardData } from "@/lib/usage/dashboard.server";

type Props = {
  locale: string;
  targetUserId: string;
  query: z.infer<typeof dashboardQuerySchema>;
};

export async function AdminDashboardBlock({
  locale,
  targetUserId,
  query,
}: Props) {
  const [t, { dashboard, preference }] = await Promise.all([
    getTranslations({ locale, namespace: "admin" }),
    getUsageDashboardData({ userId: targetUserId, query }),
  ]);

  return (
    <Card className="gap-0 overflow-hidden p-0 shadow-sm ring-1 ring-amber-500/40">
      <header className="flex flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-50/60 px-4 py-2.5 dark:bg-amber-950/25">
        <div className="flex items-center gap-2 min-w-0">
          <CardTitle className="text-base leading-tight">
            {t("dashboardTitle")}
          </CardTitle>
          <Badge
            variant="outline"
            className="border-amber-500/60 text-amber-700 dark:text-amber-300"
          >
            {t("badge")}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">{t("notice")}</div>
      </header>
      <CardContent className="space-y-4 px-4 pb-4 pt-4">
        <UsageVisualizationCard
          trendData={dashboard.tokenTrend}
          heatmapData={dashboard.hourlyActivityHeatmap}
        />
        <KpiGrid
          overview={dashboard.overview}
          pricingSummary={dashboard.pricingSummary}
          modelPricingRows={dashboard.modelPricingRows}
        />
        <BreakdownGrid
          breakdowns={dashboard.breakdowns}
          viewerIsAdmin
          projectMode={preference.projectMode}
        />
        <SessionsSection
          sessions={dashboard.sessions}
          timezone={preference.timezone}
          viewerIsAdmin
          projectMode={preference.projectMode}
        />
      </CardContent>
    </Card>
  );
}
