"use client";

import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
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

const PAGE_SIZE = 5;

function buildPageRange(
  current: number,
  total: number,
): ({ type: "ellipsis"; key: string } | { type: "page"; value: number })[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => ({
      type: "page" as const,
      value: i + 1,
    }));
  }
  const pages: (
    | { type: "ellipsis"; key: string }
    | { type: "page"; value: number }
  )[] = [{ type: "page", value: 1 }];
  if (current > 3) {
    pages.push({ type: "ellipsis", key: "start" });
  }
  for (
    let i = Math.max(2, current - 1);
    i <= Math.min(total - 1, current + 1);
    i++
  ) {
    pages.push({ type: "page", value: i });
  }
  if (current < total - 2) {
    pages.push({ type: "ellipsis", key: "end" });
  }
  pages.push({ type: "page", value: total });
  return pages;
}

export function AdminProjectDrilldownCard({ projects }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const t = useTranslations("admin");
  const locale = useLocale();

  const totalPages = Math.max(1, Math.ceil(projects.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset page to 1 when the project list length changes (range switch)
  useEffect(() => {
    setPage(1);
  }, [projects.length]);

  const visible = useMemo(
    () =>
      projects.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE),
    [projects, clampedPage],
  );

  const pages = useMemo(
    () => buildPageRange(clampedPage, totalPages),
    [clampedPage, totalPages],
  );

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
          {visible.map((p) => (
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
        {totalPages > 1 && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    text={t("paginationPrev")}
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      if (clampedPage > 1) setPage(clampedPage - 1);
                    }}
                    className={
                      clampedPage <= 1
                        ? "pointer-events-none opacity-50"
                        : "cursor-pointer"
                    }
                  />
                </PaginationItem>
                {pages.map((p) =>
                  p.type === "ellipsis" ? (
                    <PaginationItem key={p.key}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={p.value}>
                      <PaginationLink
                        href="#"
                        isActive={p.value === clampedPage}
                        onClick={(e: React.MouseEvent) => {
                          e.preventDefault();
                          if (p.value !== clampedPage) setPage(p.value);
                        }}
                        className="cursor-pointer"
                      >
                        {p.value}
                      </PaginationLink>
                    </PaginationItem>
                  ),
                )}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    text={t("paginationNext")}
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      if (clampedPage < totalPages) setPage(clampedPage + 1);
                    }}
                    className={
                      clampedPage >= totalPages
                        ? "pointer-events-none opacity-50"
                        : "cursor-pointer"
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
            <div className="text-xs text-muted-foreground tabular-nums">
              {t("pageOf", { page: clampedPage, total: totalPages })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
