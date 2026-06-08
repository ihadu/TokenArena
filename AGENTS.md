# Repository Guidelines

## Project Structure & Module Organization

`tokenarena` is a pnpm monorepo with two workspaces. `cli/` contains the TypeScript Commander CLI: keep command entry points in `cli/src/commands`, sync and aggregation logic in `cli/src/services` and `cli/src/domain`, tool-specific ingestion in `cli/src/parsers`, and config/API/filesystem code in `cli/src/infrastructure`. Built files land in `cli/dist/`. `web/` is a Next.js App Router app: routes live in `web/app`, shared UI in `web/components/ui`, hooks in `web/hooks`, helpers in `web/lib`, and static assets in `web/public`. Do not edit generated output such as `.next/` or `dist/`.

## Build, Test, and Development Commands

- `pnpm install` — install all workspace dependencies; use Node 20+.
- `pnpm dev:cli` — run the CLI via `tsx`; for explicit args, use `pnpm --filter ./cli dev -- --help`.
- `pnpm dev:web` — start the Next.js dev server.
- `pnpm build` — build both workspaces; use `pnpm build:cli` or `pnpm build:web` for one workspace.
- `pnpm lint:cli` / `pnpm lint:web` — run Biome checks.
- `pnpm format:cli` / `pnpm format:web` — apply Biome formatting.
- `pnpm format:check:cli` / `pnpm format:check:web` — verify Biome formatting without writing changes.
- `pnpm check` — run the same lint + format steps enforced by the Husky pre-commit hook.
- `pnpm test:cli` / `pnpm test:web` — run Vitest coverage for the CLI or Web workspace.
- `pnpm migrate` — deploy Prisma migrations for the Web workspace.
- `pnpm db:seed` — seed the Web database with development data.

## Coding Style & Naming Conventions

Use TypeScript + ESM throughout. Biome enforces 2-space indentation, double quotes, semicolons, and import organization. Keep CLI filenames kebab-case (`session-extractor.ts`, `claude-code.ts`); export React components in PascalCase. In `web/`, prefer the `@/` path alias for local imports. All web components should use shadcn/ui patterns. Add new UI components with `pnpm dlx shadcn@latest add [component]` from the repo root instead of hand-rolling base primitives in `web/components/ui`. Keep parsing and business logic in `domain/`, `services/`, or `parsers/`; keep terminal/UI rendering in command handlers or React components.

## Testing Guidelines

Vitest is available in both workspaces. Treat `pnpm check`, `pnpm build`, and the relevant `pnpm test:cli` or `pnpm test:web` command as required gates. For CLI changes, include a manual smoke test such as `pnpm --filter ./cli dev -- status` or `pnpm --filter ./cli dev -- --help`. Place `*.test.ts` or `*.test.tsx` beside the code they cover.

If there are any new imported environment variables, add them to the `.env.example`, `docker-compose.yml` and `README.md` files.

## Commit & Pull Request Guidelines

Follow the Conventional Commit style used in history: `feat: ...`, `feat(cli): ...`, `chore(web): ...`. Keep scopes tied to the workspace you changed. PRs should include a short summary, touched areas (`cli`, `web`, or both), validation commands, linked issues, and screenshots for UI updates.

## Security & Configuration Tips

Never commit API keys, `.env*`, or user config. The CLI stores local config in `~/.tokenarena/`; set `TOKEN_ARENA_DEV=1` for a separate dev config. Read `web/AGENTS.md` before making significant Next.js changes.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **TokenArena** (5096 symbols, 10159 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/TokenArena/context` | Codebase overview, check index freshness |
| `gitnexus://repo/TokenArena/clusters` | All functional areas |
| `gitnexus://repo/TokenArena/processes` | All execution flows |
| `gitnexus://repo/TokenArena/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
