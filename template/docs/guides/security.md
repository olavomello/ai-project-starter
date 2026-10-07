# Security checklist

Read before touching auth, data access, uploads, payments, or anything reachable from the network.

## Before every commit

- No secrets in code, tests, fixtures, logs, or error messages. Secrets come from env vars or a secret manager, and required ones are validated at startup.
- Every external input validated at the boundary with a schema. Fail fast with a clear message; never trust client data, webhooks, or third-party responses.
- Database access parameterized. No string-built SQL, no raw interpolation into queries.
- Output escaped for its sink (HTML, shell, SQL, logs). No `dangerouslySetInnerHTML` / `eval` on user data.
- Authentication and authorization checked on every non-public route, including the ownership check ("is this *their* record?"), not just "is someone logged in".
- CSRF protection on state-changing form routes; CORS allowlist explicit, never `*` with credentials.
- Rate limiting on auth, write, and expensive endpoints.
- Errors return a generic message to the client; stack traces and internals only in server logs.
- Dependencies: no new dependency without asking; audit output reviewed when one is added.
- Secrets on disk: `.claude/settings.json` denies Claude Code's file tools `.env` files (not `.env.example`), `secrets/**`, private keys and certificates. A `.claudeignore` file does nothing; see `docs/guides/claude-code.md`, "Keeping files out of Claude's reach".
- The `starter-hud` mod's **AI Dash** button calls `$.http.fetch` (to `127.0.0.1` only, to see whether the dashboard runs), `$.process.spawn` (`node scripts/ai-dash.mjs`) and `$.process.run` (the OS's own URL opener). `claude plugin validate mods/starter-hud` lists these in its `calls:` line; read it, as for any mod.
- Third-party mods (Claude Code plugins with JavaScript hooks): a mod runs with your permissions, and one with a `tool.check` hook can approve a call this project's own `PreToolUse` hooks blocked. Before installing any mod — including this starter's own `starter-hud` — run `claude plugin validate <dir>` and read its `hooks:` and `calls:` lines.

## If something is found

1. Stop the current work.
2. Report severity and blast radius to the Administrator before pushing anything.
3. Fix CRITICAL and HIGH before the commit lands.
4. A leaked secret is treated as compromised: rotate first, then remove from code, then check history and logs for other copies.
5. Search the codebase for the same pattern elsewhere — a class of bug is rarely a single instance.

## Not an agent decision

Disabling a security control, weakening auth for convenience, storing PII in a new place, or changing data retention — all go to the Administrator first.
