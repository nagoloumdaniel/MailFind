# CLAUDE.md

Guide for Claude Code in this repository.

## What this repository is

MailFind turns a list of companies into verified professional email addresses, grouped by company. A CSV import (company names, domains, websites or careers pages) triggers the pipeline: identify the company and its official domain, crawl a few targeted public pages, call enrichment providers through their official APIs, generate likely role addresses, verify every address, keep its source. Results export to CSV, XLSX and JSON, or go to Campaign Mailer as a draft campaign.

Proprietary. Copyright holder: Daniel Nagoloum Talla. See `LICENSE`.

## State of the repository

Scoping done on 22 September 2026: `docs/cahier-des-charges.md` (and its PDF) is the specification, `ROADMAP.md` the plan of record. Phase 0 closed on 23 September 2026, Phase 1 on 25 September 2026 after the owner walked the Google round trip in a browser, Phase 2 on 26 September 2026. Phase 3 was built on 28 September 2026 and closed on 29 September 2026, when `npm run crawl:check -- docs/recette/phase-3-domaines.txt` held on 50 real companies from the owner's machine (see its "Bilan" in the roadmap). Phase 4 closed on 28 September 2026, started in parallel at the owner's request, Phase 5 (verification and score) the same day, and Phase 6 (library, Contacts page, exports) on 29 September 2026; Phase 7 (public API) closed on 29 September 2026 without the Campaign Mailer integration, which waits for Campaign Mailer's own `v1` API (D-23); Phase 8 (security, compliance, quotas) is next. The public API lives in `backend/src/api/`: `router.ts` mounts `/v1` before the session and CSRF, with key authentication (`backend/src/api-keys/`), a Redis rate limit, idempotency and cursor pages; the endpoints are in `api/v1/`, and `api/openapi/` builds the OpenAPI 3.1 document from the zod schemas and holds the contract tests, which fail when a route and the document disagree. Webhooks are in `backend/src/webhooks/`, sent through `postJson` of the SSRF-guarded fetcher, never following a redirect.

What runs today: Express with pino, helmet, problem+json errors and `/health`; Google sign-in on Redis-backed sessions with CSRF; versioned terms; the account page with a full export and deletion. The CSV import works end to end and hands over to a pipeline on two BullMQ queues: `import.plan` normalizes and deduplicates, then `company.identify` (Recherche d'entreprises for the siren, Brave for the official site, counted, cached and capped in `provider_calls`) and `company.crawl` (the engine in `backend/src/crawler/`: robots.txt per RFC 9309, one request at a time per domain through a Redis gate, the SSRF guard in `backend/src/net/`, page selection by depth, extraction, false-positive filter) write `emails` and `email_sources`, then `company.enrich` fills the wanted types the site did not give: providers in `PROVIDER_ORDER` (Hunter, encrypted cache), then role candidates on a domain with MX, and named addresses only from a name the user gave and a format a provider observed. Every paid call goes through `paidCall` in `backend/src/providers/credits.ts`: cache, reservation, call, settlement, caps per provider and operation. Last, `company.verify` runs the local checks (`backend/src/verification/local.ts`, levels 1 to 7, no SMTP from our servers), the provider mailbox check when the import asks for it (`mailboxCheck`, through `paidCall`), keeps each check in `verifications`, sets the status and writes the score with its detail (`backend/src/emails/score.ts`, D-18: the lines always add up to the score). The suppression list (`suppressions`, hashes only) is checked at crawl, enrichment and verification. The database refuses an address without a source. The import page follows each step, lists the companies that need a look and the addresses with their score detail on hover; `/verifier` checks a pasted list without storing anything (F-705). Classification is by prefix, refined by the page an address was seen on (`backend/src/emails/roles.ts`). The library has a Contacts page (`backend/src/contacts/`: list with closed-list sort and filters, create, edit, delete, bulk actions), an Entreprises view and company page (`backend/src/companies/`: list, detail, domain fix through a one-line import, merge), exports (`backend/src/exports/`: CSV, XLSX, JSON, Campaign Mailer; over 2,000 rows built by the worker into R2 for seven days) and a dashboard. `excluded` means out of exports only; the F-503 rule is `SHOWN_EMAIL` in `backend/src/emails/visibility.ts` (D-20). Integration tests inject `verify`, `enqueue`, `exportStorage` and `enqueueExport` into `createApp` rather than touching DNS, BullMQ or R2.

Neon, Redis Cloud, R2 and the Google credentials answer from the owner's machine; `npm run check:services` proves it in one command. Brave and Hunter keys are still empty and only matter from Phase 3.

Read before changing anything: `docs/decisions.md` for what is already settled and why, `docs/provisioning.md` for the state of the external services.

## Working agreement with the owner

Same as Campaign Mailer:

- One phase at a time. Finish every ticket of the current phase, report, and stop for review before the next.
- One ticket, one commit, one push. Conventional Commits; the body says why.
- Update the progress list in `README.md` in the commit that advances it.
- No Phase 11 item before Phase 10 is signed off.
- The owner writes French. User-facing text and project documents are in French, without em dashes or en dashes.

## Rules that are not negotiable

- **Every address has a source.** URL, method, date or provider. An address without one is not stored.
- **Verification is a status, never a promise.** `accept_all`, `unknown` and `unverified` are never presented or exported as verified.
- **The crawler respects the sites.** `robots.txt`, one request per second per domain, an identified user agent, no login, no attempt to decode an address a site masked on purpose, no CAPTCHA or rate-limit evasion.
- **Server-side request forgery.** The crawler and the webhooks refuse private, loopback, link-local and cloud metadata addresses, after DNS resolution and after every redirect.
- **Paid calls are counted, cached and capped.** Reserve credit before a call, confirm after; a replayed job never pays twice.
- **No mailbox probing from our servers.** SMTP verification goes through a provider: Railway blocks outbound port 25 on entry plans, and probing from the app's IP would get it blocklisted.
- **Campaign Mailer is reached only through its versioned API**, never through its database. A campaign MailFind creates stays a draft; only the user launches it.

## Stack

Same as Campaign Mailer on purpose, to reuse its practices and hosted services: TypeScript strict, React 19 + Vite + Tailwind, Express 5, PostgreSQL on Neon, BullMQ on Redis, Cloudflare R2, Passport (Google, identity scopes only), pino, Sentry, Vercel and Railway in US East. Read Campaign Mailer's `CLAUDE.md` for the pitfalls already met on this stack (node-redis for sessions and ioredis for BullMQ, `sslmode=verify-full`, pooled versus direct Neon hosts, PowerShell quirks on the owner's machine).

Two departures from Campaign Mailer, both explained in `docs/decisions.md`: Redis is Redis Cloud, not Upstash, because the Upstash free plan allows one database per account and Campaign Mailer holds it (D-05); TypeScript stays on 5.9 rather than the 7.0 native port, because typescript-eslint 8 requires `<6.1.0` and moving would silently disable every type-aware lint rule (D-03).

## Layout

```text
backend/     Express API and BullMQ workers. Entry point src/index.ts.
frontend/    React 19 + Vite + Tailwind 4. Entry point src/main.tsx.
docs/        Specification, frozen decisions, provisioning.
.github/     verify workflow.
```

Two npm workspaces, one lockfile at the root, no shared package yet.

## Commands

Run from the root.

| Command | What it does |
| --- | --- |
| `npm run verify` | format check, lint, typecheck, test, build. The gate before every commit. |
| `npm run check:services` | proves Neon, Redis, R2 and the Google credentials answer, using `backend/.env` |
| `npm run migrate -- status` | lists migrations; `up` applies the pending ones, `down` reverts the last |
| `npm run test:integration` | backend tests against a real PostgreSQL 18 named in `TEST_DATABASE_URL`; drops its schema, so the database name must contain `test`. `TEST_REDIS_URL` adds the Redis politeness gate tests |
| `npm run crawl:check -- domaines.txt` | crawls real domains with the real rules and checks each address is on the page it cites: the Phase 3 acceptance test |
| `npm run dev:backend` | API in watch mode, port 3000 |
| `npm run dev:worker` | the queue worker in watch mode; imports stay `pending` without it |
| `npm run dev:frontend` | Web app, port 5173, `/api` proxied to the backend |
| `npm run lint:fix` | ESLint with fixes |
| `npm run format` | Prettier over the repository |
| `npm test` | Vitest unit tests, backend and frontend, no database |

A pre-commit hook runs lint-staged. It only sees staged files, so `npm run verify` stays the real gate.

Integration tests (`*.integration.test.ts`) stay out of `verify`, which must run without a database. Before a commit that touches SQL, a repository, a job or a route, run them too: a disposable `postgres:18` in Docker with a database named `mailfind_test` (`?sslmode=disable` on localhost), or a Neon database whose name contains `test`. PostgreSQL 18 is required, `uuidv7()` does not exist before it. CI runs them in its `integration` job.

The crawler is tested on local sites, never on the Internet: `backend/src/test/sites/` holds one folder per host (`boulangerie.test`, ...), served by `startTestSites`, and a fetcher built with `testRouting` reaches them while every other host still goes through the SSRF guard. `testRouting` throws in production. Add a fixture site rather than a network call when a crawler behaviour needs a test.

## Conventions

- **Type-aware linting is on.** `no-floating-promises` and `no-misused-promises` are errors. In a product made of queues and network calls, a forgotten `await` is a job that fails without a trace.
- **Strict beyond `strict`.** `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on: the pipeline reads untrusted pages and provider payloads, where a missing field is the normal case, not the exception.
- **Prettier ignores Markdown.** It repaginates tables to the width of their longest cell, which turns a one-line correction to the specification into a diff of several hundred lines.
- **Comments say why, not what.** They are in French, without accents on the code side to stay readable in every terminal.
- **`.env` is never committed.** Only `.env.example`. Nothing prefixed `VITE_` is a secret: it ships to the browser.
