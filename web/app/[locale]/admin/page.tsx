import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isCurrentUserAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { resolveIsoWeek } from "@/lib/usage/weekly-export";

const DEFAULT_TIMEZONE = "UTC";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export default async function AdminConsolePage({ params }: PageProps) {
  await params; // satisfy signature
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) {
    notFound();
  }

  const t = await getTranslations("admin.weeklyExport");
  const week = resolveIsoWeek(new Date(), DEFAULT_TIMEZONE);
  const memberCount = await prisma.user.count();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("isoWeekLabel", { label: week.label })}</CardTitle>
          <CardDescription>
            {t("timezoneLabel", { tz: DEFAULT_TIMEZONE })}
            {" · "}
            {t("memberCount", { count: memberCount })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <a
            href="/api/admin/weekly-export"
            download
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Download className="mr-2 h-4 w-4" />
            {t("downloadButton")}
          </a>
          <p className="text-xs text-muted-foreground">{t("downloadHint")}</p>
        </CardContent>
      </Card>
    </main>
  );
}
