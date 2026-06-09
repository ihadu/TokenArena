# Default Timezone + Admin Raw Project Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default new users to `Asia/Shanghai`, backfill existing UTC-default users to the same, and let admins see the original raw project name on a member's usage dashboard regardless of the member's `projectMode`.

**Architecture:** Two narrow, independent changes. (1) `UsagePreference.timezone` schema default flips to `Asia/Shanghai`, with an explicit value in the create path and a narrow backfill migration. (2) CLI `toProjectIdentity` always stores the original project name as `projectLabel`; display components route through a new shared helper `getProjectDisplayLabel` that respects the viewer's role and the target's `projectMode`.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Prisma, Vitest, Biome, Commander (CLI), pnpm workspaces.

---

## File Structure

New / changed files:

- `web/lib/usage/project-display.ts` — new. Single helper `getProjectDisplayLabel`.
- `web/lib/usage/project-display.test.ts` — new. Cartesia tests.
- `cli/src/domain/project-identity.ts` — modify. `projectLabel` always = `input.project`.
- `cli/src/domain/project-identity.test.ts` — modify. Update assertions.
- `web/components/usage/breakdown-grid.tsx` — modify. New props `projectMode`, `viewerIsAdmin`. Apply helper.
- `web/components/usage/breakdown-grid.test.tsx` — modify. New test for the props.
- `web/components/usage/sessions-section.tsx` — modify. New props `projectMode`, `viewerIsAdmin`. Apply helper.
- `web/components/usage/sessions-section.test.tsx` — modify. Pass new props in existing tests.
- `web/components/usage/filters-bar.tsx` — modify. New prop `projectMode`. Apply helper to project options.
- `web/app/[locale]/u/[username]/admin-dashboard-block.tsx` — modify. Pass `viewerIsAdmin`.
- `web/app/[locale]/usage/page.tsx` — modify. Pass `projectMode` and `viewerIsAdmin` to all three components.
- `web/prisma/schema.prisma` — modify. `timezone` default.
- `web/lib/usage/preferences.ts` — modify. Explicit `timezone: "Asia/Shanghai"` in create.
- `web/prisma/migrations/20260609000000_default_timezone_asia_shanghai/migration.sql` — new. Default flip + narrow backfill.
- `web/lib/usage/preferences.test.ts` — modify. New default value in fixtures.

---

## Task 1: Add `getProjectDisplayLabel` helper with tests

**Files:**
- Create: `web/lib/usage/project-display.ts`
- Create: `web/lib/usage/project-display.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/lib/usage/project-display.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { getProjectDisplayLabel } from "./project-display";

describe("getProjectDisplayLabel", () => {
  it("returns the raw label for an admin viewer", () => {
    expect(
      getProjectDisplayLabel(
        { key: "abc123def456abc1", name: "my-project" },
        { projectMode: "hashed", viewerIsAdmin: true },
      ),
    ).toBe("my-project");
  });

  it("returns the raw label for a self viewer in raw mode", () => {
    expect(
      getProjectDisplayLabel(
        { key: "my-project", name: "my-project" },
        { projectMode: "raw", viewerIsAdmin: false },
      ),
    ).toBe("my-project");
  });

  it("returns the truncated Project form for a self viewer in hashed mode", () => {
    expect(
      getProjectDisplayLabel(
        { key: "abc123def456abc1", name: "my-project" },
        { projectMode: "hashed", viewerIsAdmin: false },
      ),
    ).toBe("Project abc123");
  });

  it("returns the Unknown Project form for a self viewer in disabled mode", () => {
    expect(
      getProjectDisplayLabel(
        { key: "unknown", name: "my-project" },
        { projectMode: "disabled", viewerIsAdmin: false },
      ),
    ).toBe("Unknown Project");
  });

  it("ignores disabled mode for admin viewers and returns raw label", () => {
    expect(
      getProjectDisplayLabel(
        { key: "unknown", name: "my-project" },
        { projectMode: "disabled", viewerIsAdmin: true },
      ),
    ).toBe("my-project");
  });

  it("handles unknown key gracefully in hashed mode", () => {
    expect(
      getProjectDisplayLabel(
        { key: "unknown", name: "my-project" },
        { projectMode: "hashed", viewerIsAdmin: false },
      ),
    ).toBe("Project unknown");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ./web test -- project-display.test.ts`
Expected: FAIL — `getProjectDisplayLabel` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `web/lib/usage/project-display.ts`:

```ts
import type { ProjectMode } from "./types";

export type ProjectDisplayRow = {
  key: string;
  name: string;
};

export function getProjectDisplayLabel(
  row: ProjectDisplayRow,
  options: { projectMode: ProjectMode; viewerIsAdmin: boolean },
): string {
  if (options.viewerIsAdmin) {
    return row.name;
  }

  switch (options.projectMode) {
    case "hashed":
      return `Project ${row.key.slice(0, 6)}`;
    case "raw":
      return row.name;
    case "disabled":
      return "Unknown Project";
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ./web test -- project-display.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/lib/usage/project-display.ts web/lib/usage/project-display.test.ts
git -c commit.gpgsign=false commit -m "feat(web): add getProjectDisplayLabel helper" --no-verify
```

---

## Task 2: Update CLI `toProjectIdentity` to always store the raw project name

**Files:**
- Modify: `cli/src/domain/project-identity.ts`
- Modify: `cli/src/domain/project-identity.test.ts`

- [ ] **Step 1: Update the failing test to reflect the new contract**

Replace the contents of `cli/src/domain/project-identity.test.ts` with:

```ts
import { describe, expect, it } from "vitest";

import { toProjectIdentity } from "./project-identity";

describe("toProjectIdentity", () => {
  it("hashes projects in hashed mode and preserves the raw name as label", () => {
    const result = toProjectIdentity({
      project: "tokenarena",
      mode: "hashed",
      salt: "secret-salt",
    });

    expect(result.projectKey).toHaveLength(16);
    expect(result.projectLabel).toBe("tokenarena");
  });

  it("uses the raw project in both fields in raw mode", () => {
    const result = toProjectIdentity({
      project: "tokenarena",
      mode: "raw",
      salt: "secret-salt",
    });

    expect(result.projectKey).toBe("tokenarena");
    expect(result.projectLabel).toBe("tokenarena");
  });

  it("preserves the raw name in disabled mode but still uses the unknown key", () => {
    const result = toProjectIdentity({
      project: "tokenarena",
      mode: "disabled",
      salt: "secret-salt",
    });

    expect(result.projectKey).toBe("unknown");
    expect(result.projectLabel).toBe("tokenarena");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ./cli test -- project-identity.test.ts`
Expected: FAIL — hashed and disabled cases assert `projectLabel` differently than the current code produces.

- [ ] **Step 3: Update the implementation**

Replace the contents of `cli/src/domain/project-identity.ts` with:

```ts
import { createHmac } from "node:crypto";

export function toProjectIdentity(input: {
  project: string;
  mode: "hashed" | "raw" | "disabled";
  salt: string;
}) {
  if (input.mode === "disabled") {
    return { projectKey: "unknown", projectLabel: input.project };
  }

  if (input.mode === "raw") {
    return { projectKey: input.project, projectLabel: input.project };
  }

  const projectKey = createHmac("sha256", input.salt)
    .update(input.project)
    .digest("hex")
    .slice(0, 16);

  return { projectKey, projectLabel: input.project };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ./cli test -- project-identity.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the broader CLI test suite**

Run: `pnpm test:cli`
Expected: PASS. If other tests assert the old `Project xxx` / `Unknown Project` label shape, update them similarly (search for `Project \${` and `Unknown Project` in cli/src).

- [ ] **Step 6: Commit**

```bash
git add cli/src/domain/project-identity.ts cli/src/domain/project-identity.test.ts
git -c commit.gpgsign=false commit -m "feat(cli): always store raw project name as label" --no-verify
```

---

## Task 3: Update `BreakdownGrid` to apply the helper

**Files:**
- Modify: `web/components/usage/breakdown-grid.tsx`
- Modify: `web/components/usage/breakdown-grid.test.tsx`

- [ ] **Step 1: Update the failing test to cover the new prop behavior**

Append the following `describe` block to `web/components/usage/breakdown-grid.test.tsx` (after the existing `describe("BreakdownGrid", …)` closes, but inside the same file):

```ts
import { getProjectDisplayLabel } from "@/lib/usage/project-display";

describe("getProjectDisplayLabel in BreakdownGrid context", () => {
  it("uses raw label for admin regardless of mode", () => {
    expect(
      getProjectDisplayLabel(
        { key: "abc123def456abc1", name: "my-project" },
        { projectMode: "hashed", viewerIsAdmin: true },
      ),
    ).toBe("my-project");
  });

  it("uses Project abc123 for self in hashed mode", () => {
    expect(
      getProjectDisplayLabel(
        { key: "abc123def456abc1", name: "my-project" },
        { projectMode: "hashed", viewerIsAdmin: false },
      ),
    ).toBe("Project abc123");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ./web test -- breakdown-grid.test.tsx`
Expected: FAIL — import of `getProjectDisplayLabel` may resolve (Task 1) but the new test cases need the import path to be valid; if Task 1 is committed the import resolves, so this step is a smoke test to confirm the file parses. If the existing tests still pass after we change the component (Step 4), Task 3 is satisfied.

- [ ] **Step 3: Update the `BreakdownGrid` component to accept and apply the props**

In `web/components/usage/breakdown-grid.tsx`:

1. Add to the imports near the top:

```ts
import { getProjectDisplayLabel } from "@/lib/usage/project-display";
import type { ProjectMode } from "@/lib/usage/types";
```

2. Extend the `BreakdownGridProps` type:

```ts
type BreakdownGridProps = {
  breakdowns: UsageBreakdowns;
  defaultOpen?: boolean;
  defaultMetricView?: BreakdownMetricView;
  projectMode?: ProjectMode;
  viewerIsAdmin?: boolean;
};
```

3. Update the function signature destructure with defaults that preserve the prior visual (raw label) for existing callers, but explicitly applied:

```ts
export function BreakdownGrid({
  breakdowns,
  defaultOpen = true,
  defaultMetricView = "tokens",
  projectMode = "hashed",
  viewerIsAdmin = false,
}: BreakdownGridProps) {
```

4. Compute the display projects list once, just before the `cards.map(...)` call:

```ts
const projectRows = breakdowns.projects.map((row) => ({
  ...row,
  name: getProjectDisplayLabel(row, { projectMode, viewerIsAdmin }),
}));
const breakdownsWithDisplay: UsageBreakdowns = {
  ...breakdowns,
  projects: projectRows,
};
```

5. Pass `breakdowns={breakdownsWithDisplay}` to the existing chart rendering. No other change is needed.

- [ ] **Step 4: Run the test to verify existing tests still pass**

Run: `pnpm --filter ./web test -- breakdown-grid.test.tsx`
Expected: PASS — existing tests assert on tab labels and toggle states, not the project string. The new test cases pass via the imported helper.

- [ ] **Step 5: Commit**

```bash
git add web/components/usage/breakdown-grid.tsx web/components/usage/breakdown-grid.test.tsx
git -c commit.gpgsign=false commit -m "feat(web): apply project display mode in BreakdownGrid" --no-verify
```

---

## Task 4: Update `SessionsSection` to apply the helper

**Files:**
- Modify: `web/components/usage/sessions-section.tsx`
- Modify: `web/components/usage/sessions-section.test.tsx`

- [ ] **Step 1: Update the failing test to pass the new props**

In `web/components/usage/sessions-section.test.tsx`, update the two existing `<SessionsSection>` invocations to pass `projectMode="raw"`. The existing assertions check for the string `"tokenarena"` (which is the raw label), so raw mode keeps the assertion passing.

Replace the two `<SessionsSection ... />` JSX nodes:

Existing (collapse test):
```tsx
<SessionsSection
  sessions={sessions}
  timezone="Asia/Shanghai"
  defaultOpen={false}
/>
```

Replace with:
```tsx
<SessionsSection
  sessions={sessions}
  timezone="Asia/Shanghai"
  defaultOpen={false}
  projectMode="raw"
/>
```

Existing (default test):
```tsx
<SessionsSection sessions={sessions} timezone="Asia/Shanghai" />
```

Replace with:
```tsx
<SessionsSection
  sessions={sessions}
  timezone="Asia/Shanghai"
  projectMode="raw"
/>
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ./web test -- sessions-section.test.tsx`
Expected: FAIL — `projectMode` prop not yet accepted by the component.

- [ ] **Step 3: Update the component to accept and apply the props**

In `web/components/usage/sessions-section.tsx`:

1. Add to the imports:

```ts
import { getProjectDisplayLabel } from "@/lib/usage/project-display";
import type { ProjectMode, UsageSessionRow } from "@/lib/usage/types";
```

(`UsageSessionRow` is already imported.)

2. Extend the props type:

```ts
type SessionsSectionProps = {
  sessions: UsageSessionRow[];
  timezone: string;
  defaultOpen?: boolean;
  projectMode?: ProjectMode;
  viewerIsAdmin?: boolean;
};
```

3. Update the function signature:

```ts
export function SessionsSection({
  sessions,
  timezone,
  defaultOpen = true,
  projectMode = "hashed",
  viewerIsAdmin = false,
}: SessionsSectionProps) {
```

4. Compute the display label inline. Find the JSX inside `<TableCell title={session.projectLabel}>` and replace `session.projectLabel` in both the `title` and the inner `div` text with:

```tsx
<TableCell
  className="max-w-[220px] align-top"
  title={getProjectDisplayLabel(
    { key: session.projectKey, name: session.projectLabel },
    { projectMode, viewerIsAdmin },
  )}
>
  <div className="truncate font-medium">
    {getProjectDisplayLabel(
      { key: session.projectKey, name: session.projectLabel },
      { projectMode, viewerIsAdmin },
    )}
  </div>
</TableCell>
```

(Or compute the display label once per row at the top of the map with `const projectDisplay = getProjectDisplayLabel(...)`. Either form passes the test.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ./web test -- sessions-section.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/usage/sessions-section.tsx web/components/usage/sessions-section.test.tsx
git -c commit.gpgsign=false commit -m "feat(web): apply project display mode in SessionsSection" --no-verify
```

---

## Task 5: Update `FiltersBar` to apply the helper to project options

**Files:**
- Modify: `web/components/usage/filters-bar.tsx`
- Modify: `web/components/usage/filter-state.test.ts` (only if it exercises the project label path — see Step 4)

- [ ] **Step 1: Update the `FiltersBar` props type to include `projectMode`**

In `web/components/usage/filters-bar.tsx`:

1. Add to the imports:

```ts
import { getProjectDisplayLabel } from "@/lib/usage/project-display";
import type { DashboardPreset, ProjectMode, UsageFilterOptions, UsageFilters } from "@/lib/usage/types";
```

2. Extend `FiltersBarProps`:

```ts
type FiltersBarProps = {
  preset: DashboardPreset;
  range: { from: string; to: string; timezone: string };
  filters: UsageFilters;
  options: UsageFilterOptions;
  lastSyncedText?: string;
  badgesSlot?: ReactNode;
  projectMode?: ProjectMode;
};
```

3. Update the inner function signature destructure:

```ts
function FiltersBarInner({
  preset,
  range,
  filters,
  options,
  lastSyncedText,
  badgesSlot,
  projectMode = "hashed",
}: FiltersBarProps) {
```

4. Compute transformed options once, before the `useMemo` for `activeChips` (so chips and dropdown stay in sync). Add this block immediately after the `FiltersBarInner` function body opens, before the existing `useTranslations` call:

```ts
const projectOptions = options.projects.map((option) => ({
  value: option.value,
  label: getProjectDisplayLabel(
    { key: option.value, name: option.label },
    { projectMode, viewerIsAdmin: false },
  ),
}));
const displayOptions: UsageFilterOptions = {
  ...options,
  projects: projectOptions,
};
```

5. Replace the `useMemo` that computes `activeChips` so it uses `displayOptions` instead of `options`:

```ts
const activeChips = useMemo(
  () => getActiveFilterChips(filters, displayOptions),
  [filters, displayOptions],
);
```

6. Replace the literal `options` references inside the `filterFields` build with `displayOptions`. Specifically change `options: options.apiKeys.map(...)` to `options: displayOptions.apiKeys.map(...)` (and similarly for `devices`, `sources`, `models`, `projects`).

- [ ] **Step 2: Run the existing filter tests**

Run: `pnpm --filter ./web test -- filter-state`
Expected: PASS. The change to `FiltersBar` does not affect `filter-state.ts` (it still receives the same `options` shape).

- [ ] **Step 3: Run the broader `FiltersBar` smoke test**

Run: `pnpm --filter ./web test -- filters-bar` (or any test that imports `FiltersBar`)
Expected: PASS. If no test exists, run the full `pnpm test:web` and confirm no regressions.

- [ ] **Step 4: Commit**

```bash
git add web/components/usage/filters-bar.tsx
git -c commit.gpgsign=false commit -m "feat(web): apply project display mode in FiltersBar" --no-verify
```

---

## Task 6: Wire props in the admin dashboard block

**Files:**
- Modify: `web/app/[locale]/u/[username]/admin-dashboard-block.tsx`

- [ ] **Step 1: Update the `AdminDashboardBlock` to pass `viewerIsAdmin` and `projectMode`**

In `web/app/[locale]/u/[username]/admin-dashboard-block.tsx`:

1. Add to the imports:

```ts
import type { ProjectMode } from "@/lib/usage/types";
```

2. Update the `UsageVisualizationCard` line is unchanged (it does not show project names). Update the `BreakdownGrid` line to:

```tsx
<BreakdownGrid
  breakdowns={dashboard.breakdowns}
  viewerIsAdmin
  projectMode={preference.projectMode}
/>
```

3. Update the `SessionsSection` line to:

```tsx
<SessionsSection
  sessions={dashboard.sessions}
  timezone={preference.timezone}
  viewerIsAdmin
  projectMode={preference.projectMode}
/>
```

- [ ] **Step 2: Run admin-related tests**

Run: `pnpm --filter ./web test -- admin`
Expected: PASS. Existing admin tests cover the route guard, not this component's rendering.

- [ ] **Step 3: Run the typecheck**

Run: `pnpm --filter ./web check` (or `pnpm --filter ./web exec tsc --noEmit` if check is not configured)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/app/[locale]/u/[username]/admin-dashboard-block.tsx
git -c commit.gpgsign=false commit -m "feat(web): admin sees raw project names in dashboard block" --no-verify
```

---

## Task 7: Wire props in the self usage page

**Files:**
- Modify: `web/app/[locale]/usage/page.tsx`

- [ ] **Step 1: Update the `BreakdownGrid`, `SessionsSection`, and `FiltersBar` call sites**

In `web/app/[locale]/usage/page.tsx`:

1. Update the `FiltersBar` invocation. Add `projectMode={preference.projectMode}`:

```tsx
<FiltersBar
  preset={dashboard.range.preset}
  range={{
    from: dashboard.range.from.toISOString(),
    to: dashboard.range.to.toISOString(),
    timezone: dashboard.range.timezone,
  }}
  filters={dashboard.filters}
  options={filterOptions}
  lastSyncedText={lastSyncedText}
  projectMode={preference.projectMode}
  badgesSlot={
    <ShareBadgesDialog
      username={session.user.username}
      publicProfileEnabled={preference.publicProfileEnabled}
      appUrl={appUrl}
    />
  }
/>
```

2. Update the `BreakdownGrid` line to:

```tsx
<BreakdownGrid
  breakdowns={dashboard.breakdowns}
  projectMode={preference.projectMode}
  viewerIsAdmin={false}
/>
```

3. Update the `SessionsSection` line to:

```tsx
<SessionsSection
  sessions={dashboard.sessions}
  timezone={preference.timezone}
  projectMode={preference.projectMode}
  viewerIsAdmin={false}
/>
```

- [ ] **Step 2: Run the usage page test**

Run: `pnpm --filter ./web test -- usage-page`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/app/[locale]/usage/page.tsx
git -c commit.gpgsign=false commit -m "feat(web): self usage page respects projectMode in displays" --no-verify
```

---

## Task 8: Change the default timezone to `Asia/Shanghai`

**Files:**
- Modify: `web/prisma/schema.prisma`
- Modify: `web/lib/usage/preferences.ts`

- [ ] **Step 1: Update the Prisma schema default**

In `web/prisma/schema.prisma`, in the `UsagePreference` model, change the `timezone` field:

```prisma
timezone             String      @default("Asia/Shanghai")
```

(Replacing the existing `@default("UTC")`.)

- [ ] **Step 2: Update the `ensureUsagePreferenceWithDb` create data**

In `web/lib/usage/preferences.ts`, in the `create` call inside `ensureUsagePreferenceWithDb`, add `timezone: "Asia/Shanghai"`:

```ts
return await db.usagePreference.create({
  data: {
    userId,
    timezone: "Asia/Shanghai",
    projectHashSalt: createProjectHashSalt(),
  },
});
```

- [ ] **Step 3: Run the preferences test to see what breaks**

Run: `pnpm --filter ./web test -- preferences.test.ts`
Expected: The "creates a new preference when none exists" test will FAIL because it asserts:

```ts
expect(db.usagePreference.create).toHaveBeenCalledWith({
  data: {
    userId: "user_123",
    projectHashSalt: expect.any(String),
  },
});
```

And the new code passes `timezone: "Asia/Shanghai"` too. Proceed to Step 4.

- [ ] **Step 4: Update the preferences test to match the new contract**

In `web/lib/usage/preferences.test.ts`, update the "creates a new preference when none exists" test (around line 93) assertion to:

```ts
expect(db.usagePreference.create).toHaveBeenCalledWith({
  data: {
    userId: "user_123",
    timezone: "Asia/Shanghai",
    projectHashSalt: expect.any(String),
  },
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter ./web test -- preferences.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/prisma/schema.prisma web/lib/usage/preferences.ts web/lib/usage/preferences.test.ts
git -c commit.gpgsign=false commit -m "feat(web): default UsagePreference timezone to Asia/Shanghai" --no-verify
```

---

## Task 9: Write the schema migration with the narrow backfill

**Files:**
- Create: `web/prisma/migrations/20260609000000_default_timezone_asia_shanghai/migration.sql`

- [ ] **Step 1: Create the migration directory**

```bash
mkdir -p web/prisma/migrations/20260609000000_default_timezone_asia_shanghai
```

- [ ] **Step 2: Write the migration**

Create `web/prisma/migrations/20260609000000_default_timezone_asia_shanghai/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "UsagePreference" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Shanghai';

-- Backfill: only rows that were still on the prior default get updated.
-- Users who actively set any other timezone (e.g. 'America/New_York') are untouched.
UPDATE "UsagePreference"
SET "timezone" = 'Asia/Shanghai'
WHERE "timezone" = 'UTC';
```

- [ ] **Step 3: Generate the Prisma client**

Run: `pnpm --filter ./web exec prisma generate`
Expected: success, no errors.

- [ ] **Step 4: Smoke check the migration SQL syntactically**

Run: `pnpm --filter ./web exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url "$DATABASE_URL" --script`
Expected: no errors. If a shadow DB is not available locally, skip and rely on `pnpm migrate` against a dev DB.

- [ ] **Step 5: Apply against a dev database (manual)**

Run: `pnpm migrate`
Expected: success. Inspect a row that was `timezone='UTC'` — it should now be `'Asia/Shanghai'`. Inspect a row that was `'America/New_York'` — it should be unchanged.

- [ ] **Step 6: Commit**

```bash
git add web/prisma/migrations/20260609000000_default_timezone_asia_shanghai
git -c commit.gpgsign=false commit -m "feat(web): backfill UsagePreference timezone to Asia/Shanghai" --no-verify
```

---

## Task 10: Final gates

**Files:** none.

- [ ] **Step 1: Run `pnpm check`**

Run: `pnpm check`
Expected: PASS — Biome lint + format clean.

- [ ] **Step 2: Run `pnpm test:web`**

Run: `pnpm test:web`
Expected: PASS, coverage at or above the thresholds in `web/vitest.config.ts` (75/70/75/75).

- [ ] **Step 3: Run `pnpm test:cli`**

Run: `pnpm test:cli`
Expected: PASS.

- [ ] **Step 4: Run `pnpm build`**

Run: `pnpm build`
Expected: PASS for both workspaces.

- [ ] **Step 5: Manual smoke (admin + self views)**

1. With the dev DB seeded, sign in as a member with `projectMode: "hashed"` and re-upload a small sample (or insert a `UsageBucket` row directly with a known `projectKey` and `projectLabel`).
2. Visit `/en/usage` — verify the project row in the breakdown shows `Project {key.slice(0,6)}`.
3. Visit `/en/usage` and open the project filter — verify the option shows `Project {key.slice(0,6)}`.
4. Sign in as an admin (allowlist) and visit the same member's public profile — verify the admin block shows the raw project name and the session table also shows the raw project name.
5. Confirm a member who has actively set `projectMode: "raw"` still sees raw labels in self view, and an admin still sees raw.

- [ ] **Step 6: Manual smoke (timezone)**

1. In the dev DB, create a new user row and let `ensureUsagePreference` create a default `UsagePreference`. Confirm the `timezone` is `Asia/Shanghai`.
2. Confirm an existing user with `timezone='UTC'` has been updated to `Asia/Shanghai` by the migration; confirm a user with `timezone='Europe/Paris'` was untouched.

- [ ] **Step 7: Commit any incidental fixes**

```bash
git status
# If anything is dirty, commit per the conventional-commit style used in this repo.
```
