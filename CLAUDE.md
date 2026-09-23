# CLAUDE.md

Guide for Claude Code in this repository.

## What this repository is

MailFind turns a list of companies into verified professional email addresses, grouped by company. A CSV import (company names, domains, websites or careers pages) triggers the pipeline: identify the company and its official domain, crawl a few targeted public pages, call enrichment providers through their official APIs, generate likely role addresses, verify every address, keep its source. Results export to CSV, XLSX and JSON, or go to Campaign Mailer as a draft campaign.

Proprietary. Copyright holder: Daniel Nagoloum Talla. See `LICENSE`.

## State of the repository

Scoping done on 22 September 2026: `docs/cahier-des-charges.md` (and its PDF) is the specification, `ROADMAP.md` the plan of record. Phase 0 closed on 23 September 2026. Phase 1 is built and waiting on the owner's browser check of the Google round trip.

What runs today: Express with pino, helmet, problem+json errors and `/health`; migrations for `users` and `audit_events`; Google sign-in on Redis-backed sessions with CSRF; versioned acceptance of the terms; and a React shell with the login, terms, dashboard and account pages. No import, no crawler, no provider yet.

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
| `npm run dev:backend` | API in watch mode, port 3000 |
| `npm run dev:frontend` | Web app, port 5173, `/api` proxied to the backend |
| `npm run lint:fix` | ESLint with fixes |
| `npm run format` | Prettier over the repository |
| `npm test` | Vitest, backend only for now |

A pre-commit hook runs lint-staged. It only sees staged files, so `npm run verify` stays the real gate.

## Conventions

- **Type-aware linting is on.** `no-floating-promises` and `no-misused-promises` are errors. In a product made of queues and network calls, a forgotten `await` is a job that fails without a trace.
- **Strict beyond `strict`.** `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on: the pipeline reads untrusted pages and provider payloads, where a missing field is the normal case, not the exception.
- **Prettier ignores Markdown.** It repaginates tables to the width of their longest cell, which turns a one-line correction to the specification into a diff of several hundred lines.
- **Comments say why, not what.** They are in French, without accents on the code side to stay readable in every terminal.
- **`.env` is never committed.** Only `.env.example`. Nothing prefixed `VITE_` is a secret: it ships to the browser.
