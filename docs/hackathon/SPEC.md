# SPEC 02 (v2) — "Storyboard Studio Director": a Nemotron film crew that turns a story into an animated film

| | |
|---|---|
| Hackathon | Nebius x NVIDIA Global AI Hackathon — https://nebiusglobalaihackathon.devpost.com/ (owner already registered) |
| Track | **Best Apps and Agents** ("any app or agent someone would actually use… Nemotron 3 Ultra for serious reasoning, Nano or Super for fast everyday calls") |
| Prizes in reach | Overall $20,000 / $10,000 / $6,000 · Track winner: NVIDIA Jetson Orin Nano · **Best Use of Tavily $3,000** · Most Valuable Feedback $100 (×10) |
| Base repo | https://github.com/vansyson1308/imageforagent (package `storyboard-studio`; Next.js 16, React 19, Prisma 7 + SQLite, sharp/librsvg, vitest; MIT) |
| Submission deadline | **Oct 31, 2026 00:00 Vietnam time** (Devpost: Oct 31 01:00 GMT+8). Code freeze Oct 27, submit Oct 29 |
| Demo video | **REQUIRED** — ≤ 3 minutes, public YouTube, audio must explain how Nebius Token Factory + NVIDIA Nemotron are used (§9) |
| Hard requirements | Runs on **Nebius Token Factory**, uses **≥ 1 NVIDIA open model**; **working demo URL**; **public repo with OSI license visible** (MIT ✔); feedback on Token Factory/Nemotron; explanation of what changed during the submission period |

---

## 0. Owner actions (Việc anh Sơn phải tự làm)

1. Nhận mã $25 Nebius qua email → tự tạo tài khoản Token Factory → nhập mã → tạo `NEBIUS_API_KEY`. (Tuỳ chọn) Tham gia Nebius Builders Program để có thêm credits + credits Tavily → tạo `TAVILY_API_KEY`.
2. Đưa key cho agent qua biến môi trường / biến trên nền tảng hosting — không dán vào code.
3. Chọn nơi host demo (mặc định: **Railway + volume**, anh đã có tài khoản Railway). Đặt một mật khẩu demo cho giám khảo (`DEMO_PASSCODE`).
4. (Tuỳ chọn, giúp điểm Impact) Cho phép dùng kênh YouTube kể chuyện của anh làm "người dùng thật đầu tiên" trong phần mô tả — nếu không muốn nêu tên kênh thì agent viết chung chung "a daily storytelling YouTube channel".
5. Upload video lên YouTube (public), nộp bài trên Devpost.

---

## 1. What exists today (verified in the repo)

- **Storyboard Studio** is a *zero-API-key* engine for AI agents: an external agent writes each frame as a sanitized **SVG fragment** or a JSON **construct spec** / **motion spec**; the engine renders synchronously (sharp/librsvg), adds a watermark, previews, and exports a film package (PNGs, WebP clips, `storyboard.json`, SRT, `mix.wav`, EDL/OTIO, `assemble.sh` → `film.mp4`, glTF, DCP via CLI).
- Proof: *"Đèn Ông Sao"*, a 20-minute animated film (105 shots) — but it was **hand-authored as code by an external coding agent** (`examples/film/*.ts`, `produce.ts` driving the public API). **There is no in-app AI today.** Earlier Gemini providers were removed (commit `2dfb861`, ADR-010 "zero-key pivot"); the old interfaces are recoverable via `git show 2dfb861^:src/lib/providers/types.ts`.
- Key services to reuse (call directly, not over HTTP):
  - `src/lib/services/svgRenderer.ts` — `sanitizeSvg(fragment, "defs"|"frame")` (reject-not-strip, returns hints), `renderArtwork(...)`. **Security-critical: do not modify.**
  - `src/lib/services/artworkService.ts` — `renderFrameArtwork(project, frame)`.
  - `src/lib/services/clipService.ts` — `renderFrameMotion` (motion spec → PNG sequence/WebP/poster); `motionRenderer.ts` `encodeContactSheet`.
  - `src/lib/services/construct/compile.ts` `compileConstruction(spec)` and `src/lib/services/motion/*` (`compileMotion.ts`, `evaluate.ts`) with their LLM-ergonomic zod schemas (`src/lib/validation/constructSchema.ts` `constructSpecSchema`, `src/lib/validation/motionSchema.ts` `motionSpecSchema`).
  - `src/lib/services/tsvParser.ts` `parseTsv`; `storyboard/apply-edit` logic for bulk script writes.
  - `src/lib/services/storyboardLint.ts` `lintStoryboard`; `timeline.ts` `buildTimeline` (only timing source).
  - `src/lib/services/voiceService.ts` `resolveVoice`, `tts.ts` (espeak-ng, offline).
- Repo rules (`AGENTS.md`): fragments only (never `<svg>`, not even in comments); only `#id` / `data:image/png|jpeg|webp` references; rendering is **synchronous, no job queues/polling**; `construct/` and `motion/` stay pure & deterministic; `timeline.ts` is the only timing source; Next 16 route `params` is a Promise; UI strings Vietnamese, agent-facing errors English; conventional commits; no image-generation/LLM network calls in automated tests.
- Gaps: no auth (README: "don't deploy publicly as-is"), no Dockerfile/hosting, no CI, no server-side MP4, SQLite + storage dir need a persistent volume.
- Git: last commit before the submission period is **`c9093a3` (2026-07-15)**. Everything after Aug 27 (motion engine, audio/TTS/lip-sync, editorial, lint, DCP, the film) is already "during the period"; this spec's work adds on top.

## 2. Product one-liner

**Storyboard Studio Director**: type a story in any language → a crew of NVIDIA Nemotron agents on Nebius Token Factory plans the shots, designs consistent characters, **draws every frame as code (SVG / construct / motion specs)**, **looks at its own rendered frames with a vision model and fixes them**, adds dialogue and timing, and delivers a playable animated film (MP4 + full production package). No image-generation model, no copyrighted training-data risk, fully editable and deterministic output.

Why it is non-obvious (Quality of the Idea): LLMs don't paint pixels here — they **write the film as code** into a safe, deterministic engine, and a multimodal Nemotron closes the loop by *seeing* the render.

Real audience (Potential Impact): daily storytelling creators (e.g. the owner's own daily story channel), teachers, indie game/animation pre-production, NGOs making explainer videos in local languages — cheap, consistent characters, editable, no GPU needed.

Judging criteria (equal weight): Technological Implementation (depth of Token Factory + Nemotron use) · Design (complete product) · Potential Impact · Quality of the Idea.

## 3. The Nemotron crew (verify exact model IDs with `GET https://api.tokenfactory.nebius.com/v1/models`)

| Role | Model (tier) | Job |
|---|---|---|
| **Director / Screenwriter** | Nemotron 3 **Ultra** (STRONG) | Story → scene list + shot list (shotType, description, duration, dialogue, transitions) + **Cast & Set Bible** (characters, palette, props) as strict JSON |
| **Artist** | Nemotron 3 **Super** (MID) | Bible → reusable `<symbol>` defs (cast/props); each shot → SVG frame fragment or construct/motion spec; repairs using sanitizer/validator hints |
| **Visual Critic** | Nemotron 3 **Nano Omni** (VISION; image input) | Looks at rendered PNG / motion contact sheet + shot description → score 0–10 + concrete fix list; triggers ≤ 2 revision rounds |
| **Editor** | Nemotron 3 **Nano** (FAST) | Fixes lint findings (reading speed, too-short shots, voice overrun), subtitles, trims dialogue, final continuity check |
| **Researcher** (Tavily) | Nano + Tavily | Optional: fetches real-world visual references (period costumes, architecture, festival objects) → cited notes in the Bible; shown in UI |

If Nano Omni is unavailable on Token Factory, fall back to a text critic over SVG + render stats + warnings, and document it in DECISIONS.md (do not silently switch).

## 4. Scope

### MVP (must ship)
1. **LLM provider layer** — `src/lib/providers/{types,index,nemotronProvider,mockLlmProvider}.ts`: `LlmProvider.chat(messages, {model, responseFormat?, images?, temperature, maxTokens})`, plain `fetch` to `${NEBIUS_BASE_URL}/chat/completions` (no new SDK dependency), JSON-schema output with json_object fallback, retries with backoff, per-call token/cost accounting. Mock provider for all tests.
2. **Director pipeline** — `src/lib/services/director/`: `prompts.ts`, `schemas.ts` (zod for every LLM JSON), `plan.ts`, `cast.ts`, `artist.ts`, `critic.ts`, `editor.ts`, `research.ts`, `loop.ts`. Loop per project: plan → write script (reuse `parseTsv`/apply-edit logic) → cast defs (`sanitizeSvg(…,"defs")`) → per shot: draw → `sanitizeSvg`/schema validate → render (`renderFrameArtwork` / `renderFrameMotion`) → critic → revise (≤ 2) → dialogue (`resolveVoice`) → `lintStoryboard` → editor fixes → done. Hard budgets: max shots (demo 12), max tokens/USD per run, max repair attempts per shot (3), wall-time cap.
3. **Persistence of runs** — new Prisma model `DirectorRun` (id, projectId, story, language, status, models used, tokens, costUsd, startedAt, finishedAt) and `DirectorStep` (runId, shotIndex, role, model, promptHash, outputSummary, critiqueScore, attempt, latencyMs, tokens, error) + migration. Steps are queryable (for UI + eval).
4. **API** — `POST /api/projects/:id/director` streams progress as **Server-Sent Events** from the loop (no job queue — respects the repo rule); `GET /api/projects/:id/director/runs/:runId` returns the persisted trace; `POST …/director/runs/:runId/cancel`.
5. **UI** — `DirectorPanel.tsx` in `Workspace`: story box + language + style presets + "Make my film"; live crew timeline (role avatar, model name, step, thumbnail as frames render, critic score before→after, token/cost counter); final Preview Player + "Download MP4" + "Download package". UI strings Vietnamese per repo rule **plus an English toggle** (judges are international).
6. **Server-side MP4** — `src/lib/services/filmAssembler.ts` runs the same steps as `assemble.sh` with ffmpeg (spawn without shell) at 1K/12 fps for demo; route `GET /api/projects/:id/film.mp4`.
7. **Public demo mode** — `DEMO_MODE=true`: passcode gate (`DEMO_PASSCODE`), per-session project cap, 1K resolution, ≤ 12 shots, ≤ 12 fps, delete demo projects after 24 h, global daily token budget. Pre-baked **showcase gallery** of 3 finished films generated by the Director (so judges see results even without waiting).
8. **Hosting** — `Dockerfile` (Node 20+, ffmpeg, espeak-ng, `prisma migrate deploy` on boot) + persistent volume for `prisma/dev.db` and `STORAGE_ROOT`; deploy to Railway (default) — working public URL.
9. **Evaluation** (`scripts/eval/director_bench.ts`) — 10 fixed story prompts (EN ×4, VI ×3, JA ×3; lengths 4–12 shots). Configs: (a) Super-only (no critic), (b) full crew, (c) full crew + Tavily. Metrics: first-pass render success %, repairs per shot, critic score before/after revision, lint errors at end, wall time, tokens, USD per finished minute. Output `docs/hackathon/EVAL_RESULTS.md` + CSV + chart. Real numbers only.
10. Docs, feedback log, video pipeline, Devpost texts.

### Stretch
- **Tavily researcher** (promote to MVP if ahead by Oct 12 — $3,000 bonus requires a functional runtime call).
- "Edit by chat": after the film is done, user says "make the grandmother wear a red scarf in scenes 2–4" → Director patches only affected symbols/frames (reuse `apply-edit` diff logic).
- Nebius Serverless Endpoint/Job for the eval batch.
- Better voices: allow a user-uploaded WAV per line (already supported by `resolveVoice`).

### Out of scope
- Changes to `svgRenderer.ts` security rules, DCP pipeline, Blender path.

## 5. Safety and robustness
- **Every** LLM output goes through zod schemas and `sanitizeSvg` / construct / motion validators. Never bypass, never loosen.
- Prompt-injection: story text and Tavily content are data; system prompts forbid tool/role changes; Tavily snippets are quoted and length-capped.
- No secrets in client bundles; keys only server-side; `.env.example` + README Environment table updated.
- Tests never hit the network (mock provider + fixtures), per repo rule.
- Budgets enforced server-side; cancel works mid-run.

## 6. Quality gates (Definition of Done)
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` all green; new tests for provider (schema fallback, retries, cost), each director stage (mock), budgets, cancel, SSE route, demo-mode gate, film assembler (skips if ffmpeg missing, like existing tests).
- [ ] Live run with real Nemotron models produced ≥ 3 showcase films (logs + trace JSON in `docs/hackathon/evidence/`).
- [ ] Hosted demo URL works end to end (passcode) and serves the showcase gallery.
- [ ] `EVAL_RESULTS.md` from real runs.
- [ ] README top section: what it is, 30-second GIF, architecture diagram, **"How we use Nebius Token Factory + NVIDIA Nemotron"** (roles, models, why each tier, vision critic loop, token/cost numbers), setup, demo URL + passcode instructions. MIT visible.
- [ ] Add a minimal CI workflow (`.github/workflows/ci.yml`: install, lint, typecheck, test, build).

## 7. Tavily (bonus)
- `director/research.ts`: search + extract, budget-capped; results → "Reference notes" in the Bible with source URLs; visible in the UI timeline ("Researcher found 3 references for 1960s Tokyo tea house").
- Mock-server tests + one live-gated test.

## 8. Feedback (required field + prize chance)
Keep `docs/hackathon/FEEDBACK_LOG.md` while building: Token Factory API (latency, JSON reliability, errors), each Nemotron model per role (SVG quality, instruction following, vision critique usefulness), Tavily. Concrete and reproducible.

## 9. Demo video — REQUIRED

Rules: **≤ 3:00**, **public YouTube**, **narration must explain how Nebius Token Factory + Nemotron are used**. No copyrighted music (the engine's own synth score from `examples/film/score.ts` style is fine).

Agent builds: `demo/video/script.md`, `demo/video/record.ts` (Playwright `recordVideo` on the hosted app: type story → live crew timeline → critic before/after → play result), TTS narration + English `.srt`, `demo/video/build.sh` (ffmpeg) → `demo/video/director_demo.mp4` 1080p.

Storyboard (target 2:50):
| Time | Shot |
|---|---|
| 0:00–0:15 | Hook: "Type a story. Get a film. No image generator — Nemotron draws it as code." |
| 0:15–1:30 | Live: paste a short story → Ultra's shot list appears → Super draws frames (thumbnails pop in) → **Nano Omni critic flags a frame, revision fixes it (before/after)** → Editor fixes lint → film plays |
| 1:30–2:05 | Architecture narration: Token Factory endpoint, four Nemotron roles & why each tier, Tavily references, safe SVG sandbox |
| 2:05–2:35 | Results: eval table (success %, critic uplift, cost per minute of film); showcase gallery in 3 languages |
| 2:35–2:50 | End card: repo, demo URL, MIT |

## 10. Devpost submission checklist (`docs/hackathon/DEVPOST_SUBMISSION.md`)
- [ ] Track: Best Apps and Agents.
- [ ] Description (what / why / how), working demo URL (+ passcode in the "testing instructions" field), public YouTube video, public repo with MIT.
- [ ] Feedback on Token Factory, Nemotron models, Tavily.
- [ ] "What was significantly updated during the Submission Period": everything since `c9093a3` — motion, audio/TTS/lip-sync, editorial, lint, DCP, the film (Sep 24) **and** the whole Director/Nemotron layer (this spec). Generate from `git log c9093a3..HEAD` + human summary.
- [ ] City: leave empty (owner did not attend an in-person event) unless owner says otherwise.

## 11. Git
- Tag `c9093a3` as `pre-hackathon-baseline`; tag current HEAD as `director-spec-baseline`; push tags.
- Branch `feat/nemotron-director`; PR to `main` at the end.

## 12. Milestones

| Date (2026) | Deliverable |
|---|---|
| Sep 26–29 | Tags, provider layer + mock, live Nemotron smoke per tier (incl. Omni image input) |
| Sep 30–Oct 6 | Director plan + cast + artist loop with repair; DirectorRun/Step schema; SSE route |
| Oct 7–12 | Visual critic loop; editor/lint; film assembler MP4; DirectorPanel UI |
| Oct 13–18 | Dockerfile + Railway deploy + demo mode; showcase films; Tavily |
| Oct 19–25 | Eval bench + results; README; CI; feedback log |
| Oct 26–27 | Code freeze; render video |
| Oct 28–29 | Owner uploads video, submits |
