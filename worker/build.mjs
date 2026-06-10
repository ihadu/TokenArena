import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..", "web");

// `server-only` is a Next.js helper that throws when imported outside of a
// React Server Component. The worker is a plain Node process so we stub it
// out as an empty module.
const stubDir = resolve(here, ".build-stubs");
mkdirSync(stubDir, { recursive: true });
const serverOnlyStub = resolve(stubDir, "server-only.mjs");
writeFileSync(serverOnlyStub, "export {};\n");

// Bundle the worker into a single self-contained ESM file. This handles:
//   - TypeScript syntax in the worker's own src
//   - TypeScript syntax in the web workspace (loaded via the workspace
//     symlink) since the worker imports token-arena-web/lib/email/inactivity-core
//   - The web's `@/*` path alias (resolved via the explicit alias below)
await build({
  entryPoints: [resolve(here, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: resolve(here, "dist", "index.js"),
  // Keep these packages external so Node loads their actual CJS/ESM
  // distribution and resolves any internal `__dirname`/`require` usage
  // correctly. Everything else (including the web's TS sources) is bundled.
  external: [
    "node:*",
    "node-cron",
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "pg-cloudflare",
    "ws",
  ],
  alias: {
    "@": webRoot,
    "server-only": serverOnlyStub,
  },
  // Provide CommonJS interop for the bundled output (defines `require` and
  // `__dirname` for any transitive code that still uses them).
  banner: {
    js: [
      "import { createRequire as __cR } from 'node:module';",
      "import { fileURLToPath as __fU } from 'node:url';",
      "import { dirname as __dN } from 'node:path';",
      "const require = __cR(import.meta.url);",
      "const __filename = __fU(import.meta.url);",
      "const __dirname = __dN(__filename);",
    ].join("\n"),
  },
  logLevel: "info",
});
