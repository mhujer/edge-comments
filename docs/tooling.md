# Local tooling

## Cloudflare API token

Wrangler uses an API token instead of the browser-based `wrangler login`.
`./deploy.sh` asks for it and writes the git-ignored `.env` in the project root:

```dotenv
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
```

The file is optional; without it, only local development works (no deploys).

## Commands

Use Node 24 and `npm ci`. Run `npm run dev` to apply migrations and seed the
Development Site in local D1, compile the widget, then start its watcher,
Wrangler on port 8787 and the host page at <http://localhost:8788>. It uses
`wrangler.jsonc` when present and otherwise the committed example. Copy
`.dev.vars.example` to `.dev.vars` for local settings. No Cloudflare account is
needed for local development or tests.

`npm run check` runs strict TypeScript, type-aware ESLint, ShellCheck, Prettier,
Node unit tests, workerd HTTP tests, Node importer tests and the 20 KB gzip asset
budget. Install `shellcheck` locally; the CI runners include it.
`scripts/lib/wizard.sh` is a verbatim copy of the `/wizard` skill's library, so
it's never hand-edited and ShellCheck skips its one false positive, SC1087.
`npm run test:e2e` starts a separate Wrangler on port 8790 with a fresh local D1
database and a host page on port 8791. Install Chromium with
`npx playwright install chromium`. `npm run test:perf` measures median CPU time
for building and serializing an export of 3,000 Comments from the synthetic
deployment. It asserts a 5 ms budget and runs as a CI job.

`npm run screenshots` regenerates the README images in `docs/screenshots/`. It
starts the E2E servers with `dev/screenshot-seed.sql` instead of the
development seed and captures them in Chromium.

Vitest has two main projects: `unit` and `worker`. Importer tests have a separate
Node configuration so the main projects stay focused. Worker tests reset all
bindings before each test and apply D1 migrations again. Tests must not run
concurrently within a Worker suite because they share bindings.

## Migration compatibility

Drizzle Kit is pinned to 0.31.11. `npm run db:generate` produces numbered SQL
files directly in `migrations/` plus metadata under `migrations/meta/`. Wrangler
4.164.0 reads these flat SQL files using `migrations_dir: "migrations"`; no
flattening step is required. The development history was squashed into one
generated `0000_initial_schema.sql` before the first production deploy. It is
verified using `npm run db:migrate` (`wrangler d1 migrations apply DB --local`)
and both `applyD1Migrations` in workerd and Node's SQLite. Keep the metadata
committed for subsequent schema diffs.

A local D1 database created before the squash has the old migrations recorded
and won't match. Delete `.wrangler/state/v3/d1` and run `npm run dev` again to
recreate and seed it.

Cloudflare's renamed Vitest integration is pinned to
`@cloudflare/vitest-plugin@1.8.4`, paired with Vitest 4.1.12. Its `reset()` API
clears binding storage explicitly between tests.

Every table, including `site_origin`, has a UUIDv7 TEXT primary key generated
in the application; `origin` also has a deployment-wide unique index. Enum and length validation belongs in application code, with no SQL
CHECK constraints.
