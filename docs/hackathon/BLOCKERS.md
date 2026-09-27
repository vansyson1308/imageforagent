# Blockers

| # | Opened | Blocker | Impact | Owner action | Status |
|---|---|---|---|---|---|
| B1 | 2026-09-25 | `NEBIUS_API_KEY` was not set in this session. | — | Provided by the owner on 2026-09-25 in `.env.local` (git-ignored, mode 600, never printed). | **resolved** |
| B2 | 2026-09-25 | `TAVILY_API_KEY` is not set. | The researcher is tested against a fake server only. | (Optional) create the key and set it as an env var. | open |
| B3 | 2026-09-25 | The session egress policy blocked `api.tokenfactory.nebius.com`, `api.tavily.com` and Railway. | — | The owner switched the environment to full network access (2026-09-26). curl works directly; Node `fetch` needs `NODE_USE_ENV_PROXY=1` in this sandbox (D16). | **resolved** |
| B4 | 2026-09-25 (retried 2026-09-26: `send-pack: unexpected disconnect`) | Pushing git tags is refused by the session's git proxy. | The baseline tags exist only locally. | `git push origin pre-hackathon-baseline director-spec-baseline` | open |
