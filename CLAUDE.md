# WorkBookmarklets

Browser bookmarklets used by staff inside the Konnect CRM. The two main tools are:

- `SLA-Manager.js` runs on Konnect Manager. It lists SLA and Pending leads, exports them for the Lead Checker and imports its results back onto the lead cards.
- `Konnect-Lead-Checker.js` runs on Konnect Live. It takes the pasted batch, finds each lead, classifies its Initial Notes into six tiers and sends the results back.

## How the tools are released

Each bookmarklet in `Bookmarklets.txt` fetches its script from the `main` branch on every click. **`main` is production**: anything on it is live for every user straight away. Develop on `work` (or the session branch), and change `main` only on a deliberate release.

## Checks before every push

```sh
node tests/run-self-tests.mjs
node --check SLA-Manager.js && node --check Konnect-Lead-Checker.js
```

The runner loads both tools with a minimal DOM stub, runs every built-in self-test and checks that the values shared between the two files still match. Any failure exits non-zero.

## Rules

- Never commit real customer data. Test fixtures use fictional values only: `07700 900xxx` phone numbers, `example.com` emails, `AB12CDE` style registrations and `00Qa200000EXAMPLE` lead IDs.
- Do not log customer data to the console outside the debug flag.
- Keep the TSV handoff headers in step on both sides. The shared-contract check in the test runner fails if they drift.
- Comments explain non-obvious decisions in a line or two. Change history belongs in Git and Notion.
- Plain English, no em dashes, in UI text and comments.
- Commits use the repository owner's identity with no AI attribution lines (framework git policy).

## Collusitech engineering framework

This repository uses the Collusitech Claude Code framework (`collusitech-claude-framework`, plugin `collusitech`). Main sessions run Opus 5.5 at Medium effort; deep review goes to the read-only High-effort specialists (`collusitech:architecture-reviewer`, `collusitech:security-reviewer`, `collusitech:quality-reviewer`). Skills: `/collusitech:sprint`, `/collusitech:acceptance-review`, `/collusitech:security-review`, `/collusitech:release-readiness`, `/collusitech:bootstrap`.

- Delegate before giving a verdict or finishing work: architecture changes (data models, migrations, boundaries, integrations, multi-tenant structure) to the architecture reviewer, security-relevant changes (auth, roles, tenant data, RLS, webhooks, secrets, payments, messages, personal data) to the security reviewer, and completed features or changed journeys to the quality reviewer. Do not raise the session effort instead.
- Branches: develop on `work`; `checkpoint` moves only after Omari has checked the result; `main` only on a separately approved release.
- `.claude/collusitech.json` turns on the framework's guard hook here (production refs and live-service commands). `.claude/settings.json` holds the model, effort and production deny rules.
- Cloud sessions (claude.ai/code) do not load plugins or the parent CLAUDE.md: the specialists, skills and guard hook are unavailable there, while this file and the deny rules still apply. Do production-adjacent work locally.
