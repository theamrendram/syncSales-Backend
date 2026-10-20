# CLAUDE.md

Backend for SyncSales, a lead-management SaaS for media buyers. Express 4 + Prisma 6 + PostgreSQL 17, Node 22, ESM (`"type": "module"`, always use `.js` extensions in imports), npm.

## Commands
- `npm run dev`: nodemon `server.js`, port 8000
- `npm test`: vitest. One file: `npx vitest run tests/unit/utils/foo.test.js`
- `npm run test:coverage`: v8 coverage
- `npx prisma migrate dev --name <name>`: new migration (local only)
- `npm run db:generate`: prisma generate (also runs on postinstall)
- `docker compose up -d postgres`: local DB on `localhost:5434/syncsales_dev`
- There are no lint, format or build scripts.

## Layout
- `server.js`: validates env, registers process guards, starts listening
- `src/app.js`: middleware order, CORS, route mounting, global error handler
- `src/routes/*.route.js`: thin; wires permission middleware to controllers
- `src/controllers/*.controller.js`: request handling and business logic (there is no services layer)
- `src/utils/`: shared logic, grouped by area. New utils go in the matching folder, not the `utils/` root:
  - `core/`: `prismaClient.js` singleton, `logger.js`, `log-serializers.js`, `process-guards.js`
  - `http/`: client IP, request timing middleware
  - `auth/`: API-key principal, `checkUserPlan` middleware, key generation
  - `access/`: row scope (`scope.js`, `lead-scope.js`), resource grants, role permissions schema, default org roles
  - `leads/`: duplicate check, statuses, public lead ids, lead outcome logging
  - `analytics/`: chart functions, lead insights
  - `webhooks/`: outbound webhook delivery
  - `legacy/`: unused or one-off code (`organization-utils`, `migration-helper`, `util-for-json-to-csv`). Don't import from here in new code
- `src/lib/auth.js`: Better Auth instance (org plugin, Google OAuth, email hooks). `lib/org-roles.js`, `lib/email/`
- `src/middlewares/`: `require-auth` (session), `authentication-context` (org context + `requireOrgPermission`), `rate-limiter`
- `src/config/env.js`: `config` object + `validateEnv()`
- `prisma/schema.prisma`, `prisma/migrations/`
- `tests/` and `scripts/` are gitignored (local only)

## Auth
- Better Auth, mounted at `/api/auth/*` and backed by session cookies. We are migrating off Clerk on branch `feat/remove-clerk`. Clerk deps, the webhook route and the env vars stay until the migration's cleanup phase. Don't add new Clerk usage.
- `requireAuth()` sets `req.auth = { userId }`, `req.user`, `req.session` and `req.activeOrganizationId`. `optionalAuth()` does the same but lets unauthenticated requests through.
- `authenticationContext()` / `authenticationContext({ requireOrganization: false })` sets `req.authContext` (`userId`, `organizationId`, `isWebmaster`, …) and `req.organizationId`.
- Routes gate access with `requireOrgPermission("canViewAllData" | "canEditAllData" | "canDeleteData")`.
- Public routes (CORS `*`, authenticated by API key): `/api/v1/leads`, `/api/v1/postback`, `/webhook`. `/api/v1/subscription` is mounted without session auth. All other `/api/v1/*` routes use `requireAuth()`.
- Webmasters only see campaigns assigned to them (`getCampaignIdsForWebmaster`). Always scope queries by `organizationId` from the auth context. Never scope by a client-supplied id.

## Conventions
- Controllers: `async (req, res)` wrapped in try/catch, returning `res.status(n).json(...)`. The global handler returns 500 `{ message }`.
- Response shape: success is `{ success: true, data, meta? }`. Errors are `{ error: "msg" }`. Match this in new code.
- Validation: mostly manual field checks. zod is available and used in `utils/access/role-permissions-schema.js`.
- Logging: pino. Use `req.log` inside requests and `import logger from "utils/core/logger.js"` elsewhere, with structured objects first: `logger.info({ id }, "msg")`. No `console.log` in new code. Redaction is configured in `logger.js`. Don't log credentials.
- Prisma: import the singleton from `utils/core/prismaClient.js` and never call `new PrismaClient()`. Use explicit `select` objects and cap list sizes (e.g. `limit` ≤ 500).
- Files: kebab-case with a `.controller.js` / `.route.js` / `.middleware.js` suffix. Code uses camelCase.
- Env vars: SCREAMING_SNAKE, documented in `.env.example`. Required vars go in `validateEnv()`.

## Database
- Prisma models are PascalCase, fields are camelCase (with legacy exceptions such as `lead_period`), and there is no `@map`. New models get `createdAt`/`updatedAt`.
- Never edit committed migrations; create a new one. Prod runs `prisma migrate deploy` (in `start:prod`).
- Prod DB is Supabase, with a nightly encrypted backup via `.github/workflows`.

## Testing
- Vitest with globals (Jest-style `describe/it/expect`, `vi`). `tests/setup.js` mocks `@prisma/client`, Clerk and axios. Tests run in a single fork.
- Test layout: `tests/{unit,integration,e2e}/**/*.test.js`. Use supertest for HTTP.
- Add or update tests for changed controllers and middleware.

## Git
- Conventional commits: `feat(scope): …`, `fix(…)`, `refactor`, `perf`. Branch names like `feat/<name>`. PRs target `main`.
- Never push to `main`, never run migrations against prod, never commit `.env` or `users.js` (it contains user PII).

## Avoid
- Adding dependencies without asking.
- Putting business logic in routes.
- Trusting query/body ids for authorization.
- Adding floating promises (always await).
- Running any command which requires db write, before confirming.
