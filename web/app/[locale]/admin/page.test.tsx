import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { count: vi.fn().mockResolvedValue(42) },
  },
}));

vi.mock("@/lib/admin", () => ({
  isCurrentUserAdmin: vi.fn(),
  logAdminAccess: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(),
  getLocale: vi.fn().mockResolvedValue("zh"),
}));

import { getTranslations } from "next-intl/server";

import { isCurrentUserAdmin } from "@/lib/admin";

import Page from "./page";

describe("/[locale]/admin page", () => {
  it("renders the admin console for admins", async () => {
    vi.mocked(isCurrentUserAdmin).mockResolvedValue(true);
    const translations: Record<string, string> = {
      "admin.weeklyExport.title": "管理员控制台",
      "admin.weeklyExport.subtitle": "周度用量导出",
      "admin.weeklyExport.isoWeekLabel": "本周 ISO 周：{label}",
      "admin.weeklyExport.timezoneLabel": "管理员时区：{tz}",
      "admin.weeklyExport.memberCount": "成员数：{count}",
      "admin.weeklyExport.downloadButton": "导出本周 CSV",
      "admin.weeklyExport.downloadHint": "包含 0 用量用户",
    };
    vi.mocked(getTranslations).mockImplementation((async (
      opts: { namespace?: string } | string,
    ) => {
      const prefix = typeof opts === "string" ? opts : (opts?.namespace ?? "");
      return (key: string, vars?: Record<string, string | number>) => {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        let template = translations[fullKey] ?? key;
        if (vars) {
          for (const [k, v] of Object.entries(vars)) {
            template = template.replace(`{${k}}`, String(v));
          }
        }
        return template;
      };
    }) as never);

    const element = await Page({ params: Promise.resolve({ locale: "zh" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("管理员控制台");
    expect(html).toContain("导出本周 CSV");
    expect(html).toContain('href="/api/admin/weekly-export"');
    expect(html).toMatch(/本周 ISO 周：\d{4}-W\d{2}/);
  });

  it("calls notFound() when user is not admin", async () => {
    vi.mocked(isCurrentUserAdmin).mockResolvedValue(false);
    vi.mocked(getTranslations).mockImplementation(
      (async () => (key: string) => key) as never,
    );
    await expect(
      Page({ params: Promise.resolve({ locale: "zh" }) }),
    ).rejects.toBeDefined();
  });
});
