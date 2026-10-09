# Hosted demo health (through judging, 2026-12-01 → 2026-12-15)

- **Endpoint:** `GET https://studio-production-049c.up.railway.app/api/health` (public, no passcode). Returns `200` + `"ok": true` when every check passes, `503` otherwise.
- **Checks:** `database` (SQLite query), `storage` (write + delete a probe file on the volume), `ffmpeg`, `tts` (local engines), `tokenFactory` (`GET /v1/models`: free, checks that the crew's Nemotron ids are still listed), `tavily` (key **presence** only, no paid call; `off` when not set), `demoBudget` (today's share of `DEMO_DAILY_TOKEN_BUDGET`), `passcode` (set or not, never the value). Plus `version`, `commit` (Railway's `RAILWAY_GIT_COMMIT_SHA`) and the public model catalog.
- Status `off` means an optional feature isn't configured. It doesn't fail the report.
- **No secrets:** `tests/health.test.ts` asserts that the key, the passcode and the Tavily key never appear in the output.

## Daily check
`.github/workflows/health.yml` runs every day at 00:17 UTC (07:17 ICT) and on demand (**Actions → Hosted demo health → Run workflow**). It retries 3 times, 30 s apart, then fails if the report isn't green or `/showcase` doesn't load. After 2026-12-31 it does nothing.

Scheduled workflows run only from the default branch, so the check starts once this file is on `main`.

## How the owner gets an email on failure
GitHub emails a failed **scheduled** run to the user who last changed the workflow's `cron` line. That user is the committer on `main`, which is the owner's account when the owner merges the PR. To make sure:
1. GitHub → avatar → **Settings** → **Notifications** → **System** → **Actions**: tick **Email**, and keep **Only notify for failed workflows** on.
2. After merging, open **Actions → Hosted demo health → Run workflow** once to confirm it is green.

GitHub disables scheduled workflows in a repo with no activity for 60 days. That's after the judging window, but re-enable it from the Actions tab if it ever happens.
