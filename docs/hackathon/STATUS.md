# STATUS — Storyboard Studio Director

_Last updated: 2026-09-25 (Phase 1)_

## Checklist

- [x] Phase 0 — setup & recon (tags created locally, docs/hackathon/*, spec copied to SPEC.md)
- [x] Phase 1 — provider layer (Nemotron + mock, json_schema→json_object fallback, image input, retries/backoff/timeouts, token & cost accounting) · live smoke **pending** (B1/B3)
- [ ] Phase 2 — Director core (plan, cast, artist + repair) + DirectorRun/DirectorStep
- [ ] Phase 3 — Critic (vision) + Editor (lint fixes, dialogue, continuity)
- [ ] Phase 4 — SSE API + DirectorPanel UI (VI/EN)
- [ ] Phase 5 — Film assembler (server-side MP4)
- [ ] Phase 6 — Demo mode, Dockerfile, CI, Railway deploy
- [ ] Phase 7 — Showcase films (live) + Tavily researcher
- [ ] Phase 8 — Eval bench (live)
- [ ] Phase 9 — Docs (README top, ADR-017)
- [ ] Phase 10 — Demo video pipeline
- [ ] Phase 11 — Devpost package + PR

## Done
- Baseline green on arrival: 487 tests passed / 6 skipped, tsc clean, lint clean.
- Installed ffmpeg 6.1.1 + espeak-ng into the session container (needed for the assembler, TTS and the video pipeline).
- `src/lib/providers/{types,pricing,nemotronProvider,mockLlmProvider,index}.ts` + `tests/providers.test.ts` (13 tests, no network).
- `npm run director:models` / `npm run director:smoke` (live, write evidence JSON).

## Next
Phase 2: Prisma models + Director core.

## Blockers
See BLOCKERS.md — no Nebius/Tavily keys, and this session's egress policy blocks both APIs.

## Unverified (no live evidence yet)
- Model ids `nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (from third-party catalog listings), and the existence/id of a Nemotron Nano **Omni** model on Token Factory.
- json_schema support per model, `chat_template_kwargs.enable_thinking` on each Nemotron tier.
- Family price estimates in `src/lib/providers/pricing.ts`.

## Owner checkpoint A (asked once — work continues without waiting)
1. Set `NEBIUS_API_KEY` (and optionally `TAVILY_API_KEY`) as env vars **and** allow `api.tokenfactory.nebius.com` / `api.tavily.com` in the session's network policy, or run the live scripts locally.
2. Confirm Railway as host and choose `DEMO_PASSCODE`.
3. May the owner's storytelling YouTube channel be named in the Devpost text? (Default: generic wording.)
