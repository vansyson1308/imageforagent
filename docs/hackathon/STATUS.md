# STATUS: Storyboard Studio Director

_Last updated: 2026-09-26 (live session: keys + full network)_

## Checklist

- [x] **Phase 0**: tags (local; push refused, B4), docs/hackathon/*, SPEC.md
- [x] **Phase 1**: provider layer (Nemotron + mock; json_schema → json_object fallback; image input; retries/backoff/timeouts/abort; token & USD accounting) · `director:models` / `director:smoke` · **live smoke PASSED** (3 tiers, `json_schema` first try; no image-input Nemotron in the catalog → text critic, D15)
- [x] **Phase 2**: Director core: plan (Ultra) → script via parseTsv/replaceScript → dialogue → cast library (Super; human/animal **kit**, D22/D24) → per-shot draw/validate/repair ≤ 3, **3 shots in parallel** (D20) → animated clip
- [x] **Phase 3**: Critic (vision path + text mode fed by **render-measured gates**, D17) ≤ 2 rounds, keeps the better version · Editor (lint → edits → re-lint, continuity)
- [x] **Phase 4**: SSE API (`POST /api/projects/:id/director`, runs, cancel) · DirectorPanel (VI/EN, live crew timeline, critic before→after, tokens/cost, film player, MP4 + ZIP)
- [x] **Phase 5**: `filmAssembler.ts` · `GET /api/projects/:id/film.mp4`
- [x] **Phase 6**: demo mode (passcode, caps, 24 h cleanup, daily token budget) · Dockerfile · CI · **Railway: deployed and verified end to end** (unlock → SSE → real Nemotron → film; the tea-house showcase film was made there)
- [x] **Phase 7**: showcase gallery + 3 real films (EN on Railway; VI + JA on the same code locally, see "Where things ran") · Tavily researcher tested against a fake server only (no key, B2)
- [x] **Phase 8**: bench 10 prompts × {super-only, crew}, 20 real runs, **independent VLM judge**: crew 5.49 vs 5.08 (wins 6, losses 2), 1.8× cost. See [EVAL_RESULTS.md](EVAL_RESULTS.md). Config C (Tavily) needs a key (B2)
- [x] **Phase 9**: README top (Token Factory + Nemotron roles, architecture, real-film GIF), ADR-017 (updated with live findings), AGENTS.md
- [x] **Phase 10**: demo video built: **172 s, 1920×1080, 30 fps**, Piper neural narration + `director_demo.en.srt`. It has a frame-stepped smooth capture of a real run (local app, real models), the film re-rendered at 30 fps by the engine, eased card zooms and crossfades. Public copy: https://studio-production-049c.up.railway.app/showcase/demo-video.mp4. The owner uploads it to YouTube
- [~] **Phase 11**: DEVPOST_SUBMISSION.md (owner fields marked ⚠) · PR #3 (draft)

## Where things ran (honest)
- **Hosted (Railway)**: smoke of the gate/unlock/SSE path, and the **tea-house** showcase film (8 shots, $0.111, 7 min with a parallel bench).
- **Local (same commit, same env, `next start`)**: the VI and JA showcase films, the bench, and the demo-video recording. Long SSE streams from this cloud sandbox to Railway were cut by the sandbox's egress tunnel after a few minutes ("other side closed", twice at the same second). A disconnect cancels a run by design (D9), so the long runs moved next to the server. No Railway issue was observed. Both paths use the same code and the same Nemotron models.

## Numbers (real, this session)
- Tests: **554 passed / 4 skipped** (46 files); baseline was 487/6. lint, tsc and build are clean.
- Latest 4-shot local film: 98 s, $0.031 (sequential was 407 s).
- Showcase: tea-house 8/8 shots $0.111 · den-long 7/7 $0.058 · kitsune 7/7 $0.125.
- Bench: 20 runs, $1.34 of crew/Super spend + $0.01 judge.
- **Spend: $3.23 total** (`evidence/spend-ledger.jsonl`: every paid call, dropped runs included, estimates labelled). Well under the $15 stop line.

## What changed after the first live runs (quality)
D17 measured render gates · D18 per-symbol library · D19 track normalisation · D20 parallel shots · D21 pattern-opacity fix · D22 human kit · D23 retry on dropped streams · D24 animal kit + head-cut gate · D25 bench-driven gate fixes. Each came from a real failure in a real run (evidence in `evidence/showcase-v1/`, `bench-*-pregate*.jsonl`).

## Blockers / owner actions
See BLOCKERS.md: B2 (Tavily key, optional) and B4 (push tags). Other owner actions are in DEVPOST_SUBMISSION.md (⚠ fields) and the hand-off report.
