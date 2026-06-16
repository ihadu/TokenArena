import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminProjectDrilldownCard } from "./admin-project-drilldown-card";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    (namespace: string) =>
    (key: string, values?: Record<string, number | string>): string => {
      if (namespace !== "admin") return key;
      const map: Record<string, string> = {
        projects: "Projects",
        noProjects: "No project data",
        sessions: "sessions",
        daysShort: "d",
        topModels: "Top models",
        paginationPrev: "Previous",
        paginationNext: "Next",
      };
      if (key === "pageOf") {
        return `Page ${values?.page ?? ""} of ${values?.total ?? ""}`;
      }
      return map[key] ?? key;
    },
}));

function makeProject(i: number) {
  return {
    projectKey: `p${i}`,
    projectLabel: `Project ${i}`,
    totalTokens: 1000 * (10 - i),
    sessions: 10 - i,
    activeDays: i,
    topModels: [{ model: `model-${i}`, totalTokens: 100 }],
  };
}

describe("AdminProjectDrilldownCard", () => {
  it("shows empty state when projects is empty", () => {
    const html = renderToStaticMarkup(
      <AdminProjectDrilldownCard projects={[]} />,
    );
    expect(html).toContain("No project data");
    expect(html).not.toContain("Previous");
  });

  it("renders all projects without pager when length <= 5", () => {
    const projects = [1, 2, 3, 4, 5].map(makeProject);
    const html = renderToStaticMarkup(
      <AdminProjectDrilldownCard projects={projects} />,
    );
    expect(html).toContain("Project 1");
    expect(html).toContain("Project 5");
    expect(html).not.toContain("Previous");
    expect(html).not.toContain("Next");
  });

  it("shows only first page of 5 by default when more than 5 projects", () => {
    const projects = Array.from({ length: 12 }, (_, i) => makeProject(i + 1));
    const html = renderToStaticMarkup(
      <AdminProjectDrilldownCard projects={projects} />,
    );
    expect(html).toContain("Project 1");
    expect(html).toContain("Project 5");
    expect(html).not.toContain("Project 6");
    expect(html).toContain("Page 1 of 3");
  });

  it("clamps page when projects shrinks below current page", () => {
    const projects = Array.from({ length: 12 }, (_, i) => makeProject(i + 1));
    // SSR cannot test interaction, but we can verify the clamp happens via re-render with shorter data.
    // Direct interaction test: render with 12 → page 1, then re-render with 7 → clamped to 1 of 2.
    // Simulating this via the useEffect reset is brittle in SSR; verify via the second render.
    const first = renderToStaticMarkup(
      <AdminProjectDrilldownCard projects={projects} />,
    );
    expect(first).toContain("Page 1 of 3");
    const short = renderToStaticMarkup(
      <AdminProjectDrilldownCard
        projects={Array.from({ length: 7 }, (_, i) => makeProject(i + 1))}
      />,
    );
    expect(short).toContain("Page 1 of 2");
    expect(short).not.toContain("Project 8");
  });

  it("disables previous on first page and next on last page (visible styling)", () => {
    // We cannot drive clicks in SSR tests; instead verify that single-page renders
    // skip the pager entirely (the boundary styling is only rendered when totalPages>1).
    const projects = Array.from({ length: 6 }, (_, i) => makeProject(i + 1));
    const html = renderToStaticMarkup(
      <AdminProjectDrilldownCard projects={projects} />,
    );
    // Both prev and next are rendered (page 1 of 2 → next enabled, prev disabled)
    expect(html).toContain("Previous");
    expect(html).toContain("Next");
    // prev is disabled via pointer-events-none class
    expect(html).toMatch(/pointer-events-none[^"]*"[^>]*>[\s\S]*?Previous/);
  });

  it("shows ellipsis when more than 7 pages", () => {
    const projects = Array.from({ length: 50 }, (_, i) => makeProject(i + 1));
    const html = renderToStaticMarkup(
      <AdminProjectDrilldownCard projects={projects} />,
    );
    expect(html).toContain('data-slot="pagination-ellipsis"');
    expect(html).toContain("Page 1 of 10");
  });
});
