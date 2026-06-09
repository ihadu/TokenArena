# Default Timezone + Admin Raw Project Names

Date: 2026-06-09
Status: Approved (pending user review of this doc)

## Goal

Two independent changes to the usage data product:

1. New users signing up should get a sensible default timezone (`Asia/Shanghai`) without manual configuration. Existing users still on the `UTC` default get the same backfill.
2. When an admin views a member's usage dashboard, project identifiers in the breakdown and sessions should display the **original raw project name** that the member used, regardless of the member's `projectMode` setting. The member's own view is unchanged.

## Context

### Timezone

`UsagePreference.timezone` defaults to `"UTC"` in `web/prisma/schema.prisma:144`. `ensureUsagePreferenceWithDb` in `web/lib/usage/preferences.ts` does not set `timezone` explicitly, so first-time user creation inherits the schema default. New users currently land on UTC and have to discover the timezone selector in settings. The team's primary user base is in `Asia/Shanghai`.

### Project Mode

Members can pick `projectMode ∈ {hashed, raw, disabled}`. The CLI's `toProjectIdentity` (`cli/src/domain/project-identity.ts`) produces both `projectKey` and `projectLabel` from the raw project string using the member's salt + mode:

- `hashed` → `projectKey = HMAC_SHA256(salt, project).slice(0, 16)`, `projectLabel = "Project " + projectKey.slice(0, 6)`
- `raw` → `projectKey = projectLabel = project`
- `disabled` → `projectKey = "unknown"`, `projectLabel = "Unknown Project"`

The hash is one-way; once a member has uploaded in `hashed` mode the original project name is not recoverable. The admin block added in commit `7fcced9` (admin dashboard) currently renders the same `projectLabel` the member would see.

The user wants admins to see the original name. The data model must change to always carry the original name on the server side. The display layer picks: members apply their own `projectMode` transform, admins skip it.

## Design

### Change 1 — Default timezone `Asia/Shanghai`

Files:

- `web/prisma/schema.prisma:144` — change `@default("UTC")` to `@default("Asia/Shanghai")`.
- `web/lib/usage/preferences.ts` — in `ensureUsagePreferenceWithDb`, add `timezone: "Asia/Shanghai"` to the `usagePreference.create` data so the default is explicit (not reliant on schema default after future migrations).
- New migration `web/prisma/migrations/20260609000000_default_timezone_asia_shanghai/migration.sql`:
  - `ALTER TABLE "UsagePreference" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Shanghai';`
  - `UPDATE "UsagePreference" SET "timezone" = 'Asia/Shanghai' WHERE "timezone" = 'UTC';` (narrow backfill — only rows still on the default, not users who actively chose another zone)
- Tests that assume `UTC` default:
  - `web/lib/usage/preferences.test.ts` (or wherever) — update to `Asia/Shanghai`
  - Grep for any test fixture using `UTC` to verify intent before flipping
- No frontend change: the existing timezone selector in `settings-preferences.tsx` already shows the field on load; nothing else references the default value.

### Change 2 — Admin sees raw project names

#### Data flow

1. CLI `toProjectIdentity` always populates `projectLabel = input.project` (the original). For `disabled` mode `projectKey` stays `"unknown"`. This means the server always has the raw name on hand.
2. Server-side `queries.ts` is unchanged. The `projectKey` is still the stable identity for filtering and grouping.
3. Display layer (`breakdown-grid.tsx`, `sessions-section.tsx`) accepts `viewerIsAdmin` and `projectMode` props, then routes through a shared helper.

#### Helper

New helper `getProjectDisplayLabel(row, { viewerIsAdmin, projectMode })` in `web/lib/usage/format.ts` (or a new `web/lib/usage/project-display.ts` if a separate file is cleaner). Logic:

- If `viewerIsAdmin` → return `row.name` (the raw `projectLabel`).
- Else apply `projectMode`:
  - `hashed` → `Project ${row.key.slice(0, 6)}` (when `row.key === "unknown"`, this still renders `Project unknown` — acceptable, matches the current behavior for that edge case and keeps the helper single-purpose)
  - `raw` → `row.name`
  - `disabled` → `Unknown Project`

Note: even with the new data model, an existing bucket ingested under `hashed` mode will have `projectLabel = "Project abc123"` because old CLI versions wrote that string. Admin viewing such a row will see `Project abc123`, not the actual original. **Accepted limitation** — covered by tests, documented in the migration message.

#### Wiring

- `BreakdownGrid` and `SessionsSection` accept `viewerIsAdmin: boolean` and `projectMode: ProjectMode`. Default to `false` / `"hashed"` (safest non-revealing default for any current call site).
- `app/[locale]/u/[username]/admin-dashboard-block.tsx` passes `viewerIsAdmin`.
- `app/[locale]/usage/page.tsx` passes `viewerIsAdmin={false}` and `projectMode={preference.projectMode}`.
- `FiltersBar` only renders on the self-view (`app/[locale]/usage/page.tsx`), so it stays member-mode-only. No admin filter UI to adjust.

#### Tests

- `cli/src/domain/project-identity.test.ts` — update the hashed/disabled assertions: `projectLabel` should now be the original input string, not the synthetic `"Project xxx"` / `"Unknown Project"`. `projectKey` assertions stay.
- New unit test for `getProjectDisplayLabel` covering the cartesian: `(admin | self) × (hashed | raw | disabled)`. Plus one for the `key === "unknown"` edge.
- Snapshot/visual review of `breakdown-grid.test.tsx` and `sessions-section.test.tsx` if those tests assert the label string.

## Architecture

Two narrow changes, kept isolated:

- `preferences.ts` (timezone): server-only default + backfill migration.
- `project-identity.ts` (CLI) + display helper (web): one CLI producer change, one shared helper, two React component prop additions, two call-site updates.

No schema additions, no new tables. The data shape on disk grows only in semantic content: `projectLabel` now means "raw" instead of "displayed form". `projectKey` semantics are unchanged.

## Error Handling

- Timezone backfill is idempotent (only touches `timezone = 'UTC'` rows). Re-running is safe.
- `getProjectDisplayLabel` never throws: each branch returns a string. Inputs are typed.
- CLI `toProjectIdentity` keeps the same return type; only the strings differ. No API breakage in the upload manifest.

## Testing

Required gates (per `web/AGENTS.md`): `pnpm test:web`, `pnpm check`, `pnpm build`.

Coverage targets stay as set in `vitest.config.ts` (75/70/75/75).

- CLI: run `pnpm test:cli` and the smoke check `pnpm --filter ./cli dev -- --help` (no behavior change in CLI surface, but the change touches a domain primitive).
- Manual: re-ingest a small sample under `hashed` mode with the new CLI, confirm `projectLabel` is raw; view the same member in admin mode and confirm display; view the same member in self mode with `projectMode: "hashed"` and confirm display still shows `Project {key.slice(0,6)}`.
- Migration: run `pnpm migrate` against a dev DB seeded with a row at `timezone='UTC'`, confirm the row updates; confirm a row at `timezone='America/New_York'` is untouched.

## Out of Scope

- Re-ingesting existing data to recover lost raw names.
- Adding a UI toggle for admins to view in member-mode (i.e. respect the member's `projectMode` even when admin). Easy follow-up if needed.
- Changing the public profile (non-admin) view of someone else's data — that path already returns only safe fields via `getPublicProfilePageData`.
- Changing the public profile settings UI to surface the timezone default. Members can still change it in their own settings.
