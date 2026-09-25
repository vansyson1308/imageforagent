# STATUS: Storyboard Studio Director

_Last updated: 2026-09-25 (end of build session 1)_

## Checklist

- [x] **Phase 0**: tags (local; push refused, B4), docs/hackathon/*, SPEC.md
- [x] **Phase 1**: provider layer (Nemotron + mock; json_schema → json_object fallback; image input; retries/backoff/timeouts/abort; token & USD accounting) · `director:models` / `director:smoke` scripts · **live smoke NOT RUN** (B3)
- [x] **Phase 2**: Director core: plan (Ultra) → script via parseTsv/replaceScript → dialogue → cast library (Super) → per-shot draw/validate/repair ≤ 3 → animated clip · `DirectorRun`/`DirectorStep` + migration
- [x] **Phase 3**: Visual critic (vision + explicit text fallback, ≤ 2 rounds, keeps the better version, before/after images stored) · Editor (lint → edits → re-lint, dialogue via resolveVoice, continuity)
- [x] **Phase 4**: `POST /api/projects/:id/director` (SSE), `GET …/director`, `GET …/runs/:runId`, `POST …/cancel` · DirectorPanel (story, language, style presets, live crew timeline, critic before→after, tokens/cost, film player, MP4 + ZIP) · VI/EN toggle
- [x] **Phase 5**: `filmAssembler.ts` (assemble.sh steps, argv spawn, 12 fps, mix) · `GET /api/projects/:id/film.mp4`
- [x] **Phase 6**: demo mode (passcode proxy, per-session cap, 24 h cleanup, daily token budget, concurrency cap) · Dockerfile (built + booted locally) · CI workflow · **Railway deployed** (build + migrations + boot OK per Railway logs) · **public URL end-to-end NOT verified from this session** (B3)
- [~] **Phase 7**: showcase gallery page + `director:showcase` generator (refuses the mock crew) · Tavily researcher + fake-server tests · **showcase films NOT generated**, **live Tavily test NOT run** (no TAVILY_API_KEY, B2)
- [~] **Phase 8**: `director:bench` (10 prompts × 3 configs, CSV/JSONL/chart/EVAL_RESULTS.md), dry-run verified on mock · **real results NOT produced** (B3)
- [x] **Phase 9**: README top section (how we use Token Factory + Nemotron, architecture diagram, setup, demo), ADR-017, AGENTS.md, Security notes, MIT visible · 30-second GIF pending real footage
- [~] **Phase 10**: script.md, narration.json, record.ts, prepare.ts, build.sh, VIDEO_RUNBOOK.md · full pipeline **dry-run rendered: 172.0 s, 1920×1080** (mock, not for upload) · final video needs a real recording
- [~] **Phase 11**: DEVPOST_SUBMISSION.md drafted (owner fields marked) · PR open (draft)

## Numbers (real, this session)
- Tests: **537 passed / 4 skipped** (46 files); baseline was 487/6. The skips are asdcplib/ClairMeta-gated.
- `npm run lint`: clean · `npx tsc --noEmit`: clean · `npm run build`: clean.
- Docker image: built and booted; mock end to end inside the container produced an 8.5 s MP4.
- **Live Nemotron spend so far: $0.00** (no live call possible from this session).

## Blockers
See BLOCKERS.md. The critical one is **B3**: this session's egress policy blocks `api.tokenfactory.nebius.com`, `api.tavily.com` **and** the Railway URL. Everything that needs a real model call is scripted to run in one command from any machine with internet:
```bash
npm run director:models                                  # 1. verify + pin model ids (writes evidence)
npm run director:smoke                                   # 2. one call per tier + one PNG to Nano Omni
npm run director:showcase -- --base https://studio-production-049c.up.railway.app --passcode "$DEMO_PASSCODE"
npm run director:bench    -- --base https://studio-production-049c.up.railway.app --passcode "$DEMO_PASSCODE" --limit 4 --configs A,B
npx tsx demo/video/record.ts --base https://studio-production-049c.up.railway.app --passcode "$DEMO_PASSCODE" && sh demo/video/build.sh
```
All live scripts write evidence to `docs/hackathon/evidence/` and stop at the $15 spend line.

## Unverified (no live evidence yet)
- Model ids `nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (third-party catalog listings) and the id and image support of a **Nemotron Nano Omni** on Token Factory. At run start the app auto-resolves ids from `GET /v1/models` and records any substitution in the trace. `.env.local`/Railway leave `NEMOTRON_*_MODEL` empty until `director:models` confirms them.
- `json_schema` support and `chat_template_kwargs.enable_thinking` per tier.
- Family price estimates (`src/lib/providers/pricing.ts`): reconcile with the Token Factory billing page.
- The hosted demo end to end (unlock → run → film) with real models.

## Next
Owner (or a session with network access): run the five commands above in order, commit the evidence + showcase + EVAL_RESULTS, then update the README numbers and DEVPOST fields marked ⚠ OWNER.
