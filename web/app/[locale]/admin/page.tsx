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
import { getOptionalSession } from "@/lib/session";
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

  const session = await getOptionalSession();
  const adminPref = session
    ? await prisma.usagePreference.findUnique({
        where: { userId: session.user.id },
        select: { timezone: true },
      })
    : null;
  const tz = adminPref?.timezone ?? DEFAULT_TIMEZONE;

  const t = await getTranslations("admin.weeklyExport");
  const week = resolveIsoWeek(new Date(), tz);
  const memberCount = await prisma.user.count();
  const downloadHref = `/api/admin/weekly-export?tz=${encodeURIComponent(tz)}`;

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
            {t("timezoneLabel", { tz })}
            {" · "}
            {t("memberCount", { count: memberCount })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <a
            href={downloadHref}
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
