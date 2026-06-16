import "server-only";

import { Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { AdminComparisonCard } from "@/components/usage/admin-comparison-card";
import { AdminHabitsCard } from "@/components/usage/admin-habits-card";
import { AdminInsightsCard } from "@/components/usage/admin-insights-card";
import { AdminProjectDrilldownCard } from "@/components/usage/admin-project-drilldown-card";
import { BreakdownGrid } from "@/components/usage/breakdown-grid";
import { FiltersBar } from "@/components/usage/filters-bar";
import { KpiGrid } from "@/components/usage/kpi-grid";
import { SessionsSection } from "@/components/usage/sessions-section";
import { UsageVisualizationCard } from "@/components/usage/usage-visualization-card";
import { getAdminUsageAnalytics } from "@/lib/usage/admin-analytics.server";
import type { dashboardQuerySchema } from "@/lib/usage/contracts";
import { getUsageDashboardData } from "@/lib/usage/dashboard.server";
import { getFilterOptions } from "@/lib/usage/queries";

type Props = {
  locale: string;
  targetUserId: string;
  query: z.infer<typeof dashboardQuerySchema>;
  basePath: string;
  viewerIsAdmin: boolean;
  badgesSlot?: ReactNode;
};

export async function AdminDashboardBlock({
  locale,
  targetUserId,
  query,
  basePath,
  viewerIsAdmin,
  badgesSlot,
}: Props) {
  const { dashboard, preference } = await getUsageDashboardData({
    userId: targetUserId,
    query,
  });
  const [t, options, analytics] = await Promise.all([
    getTranslations({ locale, namespace: "admin" }),
    getFilterOptions(targetUserId),
    getAdminUsageAnalytics({
      userId: targetUserId,
      range: dashboard.range,
      timezone: dashboard.range.timezone,
    }),
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
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">{t("notice")}</div>
          {viewerIsAdmin ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="border-amber-500/60 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
            >
              <a href="/api/admin/weekly-export" download>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {t("weeklyExport.downloadButton")}
              </a>
            </Button>
          ) : null}
        </div>
      </header>
      <CardContent className="space-y-4 px-4 pb-4 pt-4">
        <FiltersBar
          preset={dashboard.range.preset}
          range={{
            from: dashboard.range.from.toISOString(),
            to: dashboard.range.to.toISOString(),
            timezone: dashboard.range.timezone,
          }}
          filters={dashboard.filters}
          options={options}
          projectMode={preference.projectMode}
          basePath={basePath}
          badgesSlot={badgesSlot}
        />
        <UsageVisualizationCard
          trendData={dashboard.tokenTrend}
          heatmapData={dashboard.hourlyActivityHeatmap}
        />
        <KpiGrid
          overview={dashboard.overview}
          pricingSummary={dashboard.pricingSummary}
          modelPricingRows={dashboard.modelPricingRows}
          locale={locale}
          dailyAverages={{
            tokens: analytics.dailyAverages.tokens,
            cost: analytics.dailyAverages.cost,
            sessions: analytics.dailyAverages.sessions,
            activeSeconds: analytics.dailyAverages.activeSeconds,
            activeDays: analytics.dailyAverages.activeDays,
          }}
        />
        <BreakdownGrid
          breakdowns={dashboard.breakdowns}
          viewerIsAdmin={viewerIsAdmin}
          projectMode={preference.projectMode}
        />
        <SessionsSection
          sessions={dashboard.sessions}
          timezone={preference.timezone}
          viewerIsAdmin={viewerIsAdmin}
          projectMode={preference.projectMode}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <AdminHabitsCard
            t={t}
            habits={{
              hourHistogram: analytics.hourHistogram,
              weekdayHistogram: analytics.weekdayHistogram,
              currentStreak: analytics.habits.currentStreak,
              longestStreak: analytics.habits.longestStreak,
              deviceCount: analytics.habits.deviceCount,
            }}
          />
          <AdminInsightsCard t={t} insights={analytics.insights} />
        </div>
        <AdminComparisonCard
          t={t}
          locale={locale}
          metrics={analytics.metrics}
          prevActiveDays={analytics.prevActiveDays}
          costAvailable={analytics.costAvailable}
          prevPeriodAvailable={analytics.prevPeriodAvailable}
        />
        <AdminProjectDrilldownCard projects={analytics.projectDrilldown} />
      </CardContent>
    </Card>
  );
}
