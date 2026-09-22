# CLAUDE.md

Guide for Claude Code in this repository.

## What this repository is

MailFind turns a list of companies into verified professional email addresses, grouped by company. A CSV import (company names, domains, websites or careers pages) triggers the pipeline: identify the company and its official domain, crawl a few targeted public pages, call enrichment providers through their official APIs, generate likely role addresses, verify every address, keep its source. Results export to CSV, XLSX and JSON, or go to Campaign Mailer as a draft campaign.

Proprietary. Copyright holder: Daniel Nagoloum Talla. See `LICENSE`.

## State of the repository

Scoping done on 22 September 2026: `docs/cahier-des-charges.md` (and its PDF) is the specification, `ROADMAP.md` the plan of record. No code yet; Phase 0 is next.

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
