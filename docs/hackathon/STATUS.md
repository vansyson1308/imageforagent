# STATUS: Storyboard Studio Director

## v2 (SPEC_V2.md): execution plan

_Started 2026-10-09 (ICT). Branch `claude/gifted-cannon-1nhl2s` → small PRs to `main`. v1 status is kept below, unchanged._

**Order** (P0 first, then P1 in the spec's slip order):

| # | WP | What | Target |
|---|---|---|---|
| 1 | WP2 | Identity: `package.json`, app metadata + OG image, README restructure (prior work clearly separated), honest Tavily wording, `OWNER_GITHUB_ABOUT.md` | M1 |
| 2 | WP1 | Runs survive the browser (detached run + `GET …/runs/:runId/events` replay-then-tail SSE + client reconnect, wall-time watchdog, D26) · unlock copy + showcase link + contact · 3 one-click sample stories (EN/VI/JA) · showcase "Replay the real run" (10×) · `GET /api/health` + daily GitHub Actions health cron · capacity review | M1 |
| 3 | WP3 | Researcher: Nano yes/no detection with a reason, cited visual notes that flow into the Bible, Research card + per-shot citation chips. **Without a key by M1: every user-facing claim says "optional, not enabled in the demo"** | M1 |
| 4 | WP9 (tooling only) | `JUDGE_ACCESS.md` + `scripts/judge-access-pdf.ts` (passcode from env at export, git-ignored output) | M1 (the judge path depends on it) |
| 5 | WP4 | Gates (readable set, close-up framing, empty frame, near-duplicate) → acting (poses, expressions, blinks, lip-sync) → Piper voices → vision critic (+ floor) → shot variety → score bed | M2 |
| 6 | WP5 | `Series` model, save/pick, host identity hash tests; Hidamari pilot (needs O4) | M2 |
| 7 | WP6 | Landing (hero film, 2 buttons, samples), run view, finished view, JA strings, a11y | M2 |
| 8 | WP7 | Bench v2 (super-only v2, crew v2, crew v2 + Tavily if live), two judges ≠ critic | M2 |
| 9 | WP8/WP9 | Video v2 + YOUTUBE.md + thumbnail; DEVPOST_SUBMISSION_V2.md (9 long feedback answers); HANDOFF_V2.md | M3 |
| 10 | WP10 | Nebius Serverless bench, only with O5 | P2 |

**Risks**
- **Live access from this session.** This cloud session has no `NEBIUS_API_KEY`/`TAVILY_API_KEY`/passcode, and environment secrets added now only reach a *new* session. The hosted service has the Nebius key. Plan: run live work (hosted verification, bench, showcase) **against the hosted demo**; WP1's detached runs make the sandbox's stream cuts (v1 D9/D23) harmless. The judge/probe calls need a server-side path or a key here (see B5).
- **Tavily key** (B2/O1): if it doesn't arrive by M1, the fallback ships (claims removed, code kept).
- **Vision critic**: no Nemotron VLM on Token Factory (D15). SPEC v2 §WP4.4 allows a labelled non-NVIDIA open VLM as critic; the Nemotron crew keeps every role it holds today. The eval judges must then differ from the critic.
- **Scope vs. 2 weeks**: WP4 is large. If M2 slips: gates → acting → voices → critic → variety, then series, then UI. Video + Devpost (M3) never slip.
- **Railway deploy source** is still the v1 branch `claude/gracious-ritchie-a739ft`. Deploys switch it to `main` after each merged milestone PR (reversible).

**What I need from the owner** (details and click-by-click steps in BLOCKERS.md): O1 Tavily key (B2) · O2 remaining Token Factory credit + expiry · O3 Railway plan through 2026-12-15 · B5 live access for this session · O4 Hidamari look + 3 stories · O6/O7 later.

**Spend (v2)**: v1 total **$3.23** (ledger). v2 stop line `SPEND_ALERT_USD` = 3.23 + 10 = **13.23**. Token Factory balance reported by the owner: _pending (O2)_.

### v2 log
- 2026-10-09: SPEC_V2 saved, plan written. Local baseline after `cp .env.example .env` + `prisma migrate deploy` + espeak-ng: **554 passed / 4 skipped** (same as v1).
- 2026-10-09: **M1 code merged** ([PR #4](https://github.com/vansyson1308/imageforagent/pull/4), merge `28d07d0`; 572 passed / 4 skipped, CI green) and **deployed**: Railway `studio` now builds from `main` (it was the v1 branch), with D28 capacity variables set. **Hosted verification:** `/api/health` → 200, `ok: true`, version 2.0.0, commit `28d07d0`. database, storage, ffmpeg, tts and tokenFactory (25 models, crew listed) are ok; tavily is `off` (truthful); demoBudget and passcode are ok ([evidence](evidence/hosted-health-2026-10-09.json)). `/unlock`, `/showcase`, `/showcase/replay/tea-house`, `/og.jpg` and the replay stills all return 200; `/` redirects to unlock. **Not yet verified on the hosted URL:** a full film run and a tab-close/reopen there. Both need the passcode or an operator passcode (B10). The same flows pass in a headless browser against a local production build with the mock crew.
- 2026-10-09: catalog re-probe through the hosted health check (no key here): still **no NVIDIA vision model**; one new entry, `Qwen/Qwen3.8-27B` ([evidence](evidence/models-2026-10-09.json)).
- 2026-10-09: WP4 started on the branch: measured broken-frame + near-duplicate gates calibrated on exact replays of the v1 failures (D30); poses + expressions in the character kits.

---

# v1 status (2026-09-26)

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
