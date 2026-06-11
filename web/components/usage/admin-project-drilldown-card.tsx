"use client";

import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatTokenCount } from "@/lib/usage/format";

type ProjectRow = {
  projectKey: string;
  projectLabel: string;
  totalTokens: number;
  sessions: number;
  activeDays: number;
  topModels: Array<{ model: string; totalTokens: number }>;
};

type Props = { projects: ProjectRow[] };

export function AdminProjectDrilldownCard({ projects }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const t = useTranslations("admin");
  const locale = useLocale();

  if (projects.length === 0) {
    return (
      <Card className="bg-card shadow-sm ring-1 ring-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("projects")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t("noProjects")}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card shadow-sm ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("projects")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/50">
          {projects.map((p) => (
            <Collapsible
              key={p.projectKey}
              open={openKey === p.projectKey}
              onOpenChange={(o) => setOpenKey(o ? p.projectKey : null)}
            >
              <CollapsibleTrigger className="w-full flex items-center justify-between py-2.5 hover:bg-muted/30 px-1 rounded">
                <div className="flex items-center gap-2 min-w-0">
                  <ChevronRight
                    className={`size-4 transition-transform ${openKey === p.projectKey ? "rotate-90" : ""}`}
                  />
                  <span className="font-medium truncate">{p.projectLabel}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground tabular-nums">
                  <span>
                    {p.sessions.toLocaleString(locale)} {t("sessions")}
                  </span>
                  <span>
                    {p.activeDays.toLocaleString(locale)} {t("daysShort")}
                  </span>
                  <span className="font-semibold text-foreground">
                    {formatTokenCount(p.totalTokens, locale)}
                  </span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="pb-3 px-6 text-sm space-y-1">
                <div className="text-xs text-muted-foreground mb-1">
                  {t("topModels")}
                </div>
                {p.topModels.map((m) => (
                  <div key={m.model} className="flex justify-between">
                    <span className="text-muted-foreground">{m.model}</span>
                    <span className="tabular-nums">
                      {formatTokenCount(m.totalTokens, locale)}
                    </span>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
