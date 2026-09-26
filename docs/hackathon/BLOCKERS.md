# Blockers

| # | Opened | Blocker | Impact | Owner action | Status |
|---|---|---|---|---|---|
| B1 | 2026-09-25 | `NEBIUS_API_KEY` was not set in this session. | — | Provided by the owner on 2026-09-25 in `.env.local` (git-ignored, mode 600, never printed). | **resolved** |
| B2 | 2026-09-25 | `TAVILY_API_KEY` is not set. | The researcher is tested against a fake server only. | (Optional) create the key and set it as an env var. | open |
| B3 | 2026-09-25 (re-checked 14:09 UTC with the key in place: still 403 on CONNECT; re-checked again 2026-09-26 00:06 UTC in a new session after the owner reported opening network access — the proxy still answers 403 to CONNECT for `api.tokenfactory.nebius.com` and `studio-production-049c.up.railway.app`, while npm registry works) | The session's egress policy blocks `api.tokenfactory.nebius.com`, `docs.tokenfactory.nebius.com`, `api.tavily.com`, `docs.tavily.com` and `railway.com` (proxy returns 403 on CONNECT). | Even with keys, live smoke tests, showcase films, eval runs and the Railway deploy **cannot run from this cloud session**. | Either allow these hosts in the session environment's network settings, or run the live steps locally: `npm run director:smoke`, `npm run director:showcase`, `npm run director:bench` (see STATUS.md). | open |
| B4 | 2026-09-25 (retried 2026-09-26: `send-pack: unexpected disconnect`) | Pushing git tags is refused by the session's git proxy. | The baseline tags exist only locally. | `git push origin pre-hackathon-baseline director-spec-baseline` | open |
