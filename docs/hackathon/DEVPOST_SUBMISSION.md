# Devpost submission: ready to paste

> Fields marked **⚠ OWNER** need one action before submitting. Never paste the demo passcode into this (public) file; paste it only into Devpost's private *Testing instructions* field.

## Project name
Storyboard Studio Director

## Elevator pitch (≤ 200 chars)
Type a story in any language and get an animated film. A crew of NVIDIA Nemotron models on Nebius Token Factory writes every frame as code; the engine measures each render and the crew fixes it.

## Track
**Best Apps and Agents** (+ Best Use of Tavily bonus)

## Built with
NVIDIA Nemotron 3 (Ultra, Super, Nano) · Nebius Token Factory · Tavily · Next.js 16 · React 19 · TypeScript · Prisma 7 + SQLite · sharp/librsvg · ffmpeg · espeak-ng · Docker · Railway

## Links
- **Demo:** https://studio-production-049c.up.railway.app (passcode: see Testing instructions)
- **Showcase (no passcode):** https://studio-production-049c.up.railway.app/showcase
- **Code (MIT):** https://github.com/vansyson1308/imageforagent
- **Video:** ⚠ OWNER: paste the public YouTube URL after uploading it (Devpost requires YouTube/Vimeo). Direct copy: https://studio-production-049c.up.railway.app/showcase/demo-video.mp4

## Description

### Inspiration
Daily storytelling creators, teachers and small NGOs need short animated films in their own language every day. Image generators give inconsistent characters, unclear rights and uneditable output. We asked: what if the model didn't paint pixels at all, but **wrote the film as code** into a deterministic engine, and then **checked the rendered result** like a human director?

### What it does
You type a story in any language, pick a style, and press **Make my film**. A crew of NVIDIA Nemotron agents on Nebius Token Factory does the work, live on screen:
- **Director (Nemotron 3 Ultra):** plans the shots and writes a Cast & Set Bible (characters, palette, props) as strict JSON.
- **Artist (Nemotron 3 Super):** builds the cast once as reusable vector symbols, so characters are pixel-identical in every shot. For people, it specifies them for the engine's parametric character kit (age, build, hair, clothes, accessories), which gives consistent, well-proportioned figures by construction. Animals, creatures, sets and props it draws itself as SVG. It then draws each frame as SVG, plus a small animated layer for shots with motion. Symbols are accepted one by one, and shots are drawn three at a time. If the engine rejects a frame, or a render measurement fails (the hero is too small for the shot type, a night scene isn't dark, a set doesn't fill the frame), the exact error and a measured fix go back to the Artist (up to 3 repairs).
- **Critic (Nemotron Nano + the engine's render measurements):** Token Factory serves no image-input Nemotron today (we probed it: Nano and Super return `400 does not support image input`). So the engine measures every render in pixels, and Nano reads those measurements plus the drawing, scores it 0–10 against the shot, and lists concrete fixes. The Artist revises (up to 2 rounds), and a revision is kept only if it scores higher. When a vision Nemotron ships, one env var switches the same loop to sending the image.
- **Editor (Nemotron Nano):** fixes subtitle reading speed, jump cuts and voice timing flagged by the storyboard linter, then checks continuity.
- **Researcher (Nano + Tavily, optional):** finds real-world visual references (period costumes, festival objects, architecture) and adds cited notes to the Bible.

The result plays in the browser: an animated film with camera moves, local text-to-speech voices, subtitles and transitions, assembled server-side with ffmpeg. You can download the MP4 or the whole production package: PNG frames, clips, storyboard.json, SRT, EDL/OTIO for Resolve/Premiere, glTF for Blender, and an `assemble.sh`.

### How we built it
- **Provider layer on Token Factory:** OpenAI-compatible `chat/completions` over plain `fetch` (no SDK). It handles strict `json_schema` output (generated from our zod schemas) with a `json_object` fallback, image input as `image_url` data URIs, the `enable_thinking` toggle for direct-output calls, retries with backoff, timeouts and cancel. Every call is accounted in tokens and USD.
- **Tier choice:** Ultra reasons once per film (planning is the hardest step). Super handles the many long structured drawing calls. Nano handles the fast, cheap critique and editorial calls. Crew model ids are checked against `GET /v1/models` at run start. The model ids were verified live: `nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`.
- **Safety by construction:** LLM output never touches the renderer directly. Everything passes zod, then the engine's security-critical SVG sanitizer (unchanged), then the construct/motion validators. Stories and web snippets are quoted as data (prompt-injection guard). Hard server-side budgets cover shots, tokens, USD and wall time.
- **Animation without changing the engine:** each painting becomes a defs pattern, and camera tracks move it. That gives real dolly/pan/tilt on vector art, deterministic and rendered at full resolution.
- **Live UX:** progress streams over Server-Sent Events from the Director loop (no job queue). Every step is persisted (`DirectorRun`/`DirectorStep`), so traces are auditable and shown in the UI and the showcase.
- **Public demo:** Docker (Ubuntu + ffmpeg + espeak-ng) on Railway with a persistent volume, a passcode gate, per-session caps, 24 h cleanup and a daily token budget. CI runs lint, typecheck, 554 tests and the build.

### Results (real runs, `docs/hackathon/EVAL_RESULTS.md`)
- 10 stories (EN/VI/JA) × {Super-alone, full crew}, 20 real runs. An **independent vision judge** (`google/gemma-3-27b-it` on Token Factory, not part of the crew, blind to config) scores every final frame.
- The crew wins on **6 of 10** stories, loses on 2 and ties on 2 (mean **5.49 vs 5.08**). It costs **1.8×** more: **$0.23 vs $0.12 per finished minute** of film.
- Showcase: three finished films with full traces (8/8, 7/7 and 7/7 shots, $0.06–0.13 each).

### Challenges
- LLMs writing SVG make real mistakes: dangling `#id` references render as nothing, and `<svg>` wrappers get rejected by the sanitizer. We turned every engine error into a repair hint and added checks for silent failures (dangling references, blank renders).
- Keeping motion deterministic without touching the frozen engine led to the pattern-and-camera trick.
- Budget control: every model call passes a budget gate first, and the demo has a global daily token cap.

### Accomplishments
- The loop is closed: a model writes code, a deterministic engine renders and **measures** it, and the numbers drive repairs and critique. Real runs showed prose rules don't fix composition, but measured feedback does ("the hero is 23 % of the frame; a medium shot needs 45 %, use height=486").
- Character consistency comes by construction, not by prompt luck.
- The zero-key engine still works with no key at all. The Director is an optional layer (ADR-017).

### What we learned
- **Measure, don't tell.** Super writes valid, sanitizer-clean SVG almost every time. Its mistakes are compositional: tiny heroes, "night" scenes lit like noon, sets drawn 1920×300. Prose rules barely moved that. Feedback measured on the render did: "the hero is 23 % of the frame; a medium shot needs 45 %, use height=486". The next attempt usually complies.
- **Small models misread numbers in prose.** Nano scored a correct frame 6/10 because "70 % exceeds the 30 % limit". Computing checks in the engine and handing Nano the results as facts fixed that, and it now critiques what numbers can't capture (story fit, missing props).
- **Let the model write specs where it's weak.** Drawn people fell apart (heads floating off bodies). Nemotron now *specifies* human characters for a parametric kit, and the engine draws them. That is consistent by construction and ~10× fewer tokens.
- **Tier economics are real.** Ultra plans a whole film for about $0.01. Super does the heavy drawing. Nano critiques for under $0.0002 a call. A finished 8-shot film costs about $0.07–0.11 at our price table.
- **Parallelism matters more than model speed.** Drawing 3 shots at a time cut a 4-shot film from 407 s to 98 s at identical cost.

### What's next
Edit-by-chat ("give grandma a red scarf in scenes 2–4" patches only the affected symbols), articulated character acting via the engine's figure rig, uploaded voice recordings per line, batch evals on Nebius serverless jobs.

### Real users (Potential impact)
The first user is a daily storytelling YouTube channel that needs a new short illustrated story every day in Vietnamese and English. ⚠ OWNER: replace with the channel's name if you want to name it (default wording is generic, per SPEC §0.4).

## Testing instructions (private field)
1. Open https://studio-production-049c.up.railway.app. You are redirected to the passcode page. Passcode: **⚠ OWNER: paste `DEMO_PASSCODE` from `.env.local` / Railway variables**.
2. In **AI Director**, paste a short story (any language; examples are in `scripts/director/showcase.ts`), choose a film language and style, keep the *Critic* on, then click **Make my film**. A 6–8 shot film takes about 3–8 minutes. The crew timeline shows each model call with tokens and cost.
3. When it finishes, play the film or download the MP4 / ZIP package. The **Showcase** page (no passcode) has three finished films in English, Vietnamese and Japanese, each with its full trace.
4. Demo limits: ≤ 12 shots, 1K, 12 fps, 3 projects per session, projects deleted after 24 h, global daily token budget.

## Feedback on Token Factory / Nemotron / Tavily
(Full log with reproduction notes: `docs/hackathon/FEEDBACK_LOG.md`.)
- **No image-input Nemotron is served.** `GET /v1/models` lists Ultra, Super, Nano and Nemotron-3.5 Lightning, but no Nano Omni / VL model. Nano and Super answer `400 {"detail":"This model does not support image input"}` (clear and fast, thank you). A served Nemotron VLM would close the critic loop on pixels.
- **Capabilities in `/v1/models`:** list membership doesn't tell you whether a model accepts images, supports `json_schema`, or how to turn reasoning off. Adding `capabilities: {vision, json_schema, reasoning_toggle}` would let agents pick tiers safely.
- **Id casing:** the family mixes `Nemotron-3-Ultra…`, `nemotron-3-super…` and `NVIDIA-Nemotron-3-Nano…`, so exact-match configs break easily.
- **Structured output works:** `response_format: json_schema` succeeded on the first attempt on all three tiers. The json_object fallback was never needed.
- **Docs reachability:** the vision message format and the thinking toggle are documented only on docs.tokenfactory.nebius.com, which sandboxed coding agents often can't reach. A mirror of the OpenAPI spec on GitHub would help.
- **Tavily:** the official Python client source was enough to derive exact request/response shapes for a no-SDK `fetch` integration. Clean API.

## What was significantly updated during the Submission Period
Everything after commit `c9093a3` (2026-07-15, tag `pre-hackathon-baseline`). `git diff --shortstat c9093a3..HEAD`: **233 files changed, 39767 insertions(+), 507 deletions(-)** (as of 2026-09-26, before the final docs commit).

**Human summary.** Before the period, the repo was a zero-key *still-storyboard* engine for external coding agents. During the period we added:
1. **Motion** (keyframe tracks, procedural rigs, no-slip walk, camera language), **glTF 2.0** export with skinned figures, **IK**, faces and lip-sync.
2. **Film pipeline:** control passes for AI video, dialogue TTS + broadcast-grade mix, scenes/transitions, EDL/OTIO, storyboard lint, and **SMPTE DCP mastering**. Plus a 20-minute film made with the engine.
3. **The whole Director layer (this submission):** Nemotron provider layer on Token Factory, the crew loop (plan → cast with the parametric human/animal kit → draw/repair with measured render gates → critic/revise → editor), Tavily researcher, SSE API, DirectorPanel UI (VI/EN), server-side MP4, demo mode, Docker + Railway deploy, CI, showcase gallery, eval bench, video pipeline.

**Commits** (`git log --reverse --date=short c9093a3..HEAD`):
```
2026-09-24 a0d7ea8 feat: M1-M3 motion engine — keyframe tracks, procedural rigs, POST /api/motion
2026-09-24 806c0ec feat: M4 motion in projects — PUT /api/frames/:id/motion, clip export, film assembly
2026-09-24 c8fa059 feat: M5 glTF 2.0 export — bridge from the vector engine to real 3D renderers
2026-09-24 2366b9a feat: motion-bounce example (squash & stretch, on twos) + verified Blender bridge
2026-09-24 d2efc71 docs: motion + glTF docs (README EN/VI, AGENTS, ADR-014/015) + film roadmap; fix: face cap on glTF export
2026-09-24 5f721e0 test: make finish-premium PERF test load-invariant; refactor: figure exposes joints + optional face
2026-09-24 6d5680b feat: N1a analytic 2-bone IK rig, figure face, decalOf surface features
2026-09-24 b4844e5 feat: N1b glTF skins — every figure exports as a real Armature
2026-09-24 f25f9b1 feat: N2 control passes for AI video — depth, segmentation, normal, OpenPose
2026-09-24 ee4c717 feat: N3 audio — dialogue (local TTS or WAV), lip-sync, soundtrack, broadcast-grade mix
2026-09-24 a977b02 feat: N4 sequence & editorial — scenes, transitions, EDL/OTIO, storyboard lint
2026-09-24 d2e74ea feat: N5 DCP mastering — SMPTE DCP from any export (J2K X'Y'Z', MXF, CPL/PKL)
2026-09-24 323f975 docs: film pipeline N1–N5 (README EN/VI, AGENTS, ADR-016, roadmap status)
2026-09-24 dd4c99c Merge PR #1: from storyboard to theatrical DCP
2026-09-24 47a2b7b feat: solid attach to figure joints + feature-length limits
2026-09-24 9e55ee9 feat: "Đèn Ông Sao" — a 20-minute animated film made entirely with this engine
2026-09-24 59e1907 docs: film README — synopsis, chapters, how to reproduce, honest notes
2026-09-24 2c5a732 fix: a dissolve after a cut broke film assembly (concat/xfade timebase)
2026-09-24 54c3834 fix: export silently dropped the mix for films over 15 minutes
2026-09-24 9f922bd docs: the finished film — poster, 1-minute trailer, contact sheet, production record
2026-09-24 96a21c6 docs: film production numbers from the log (15,108 frames, 69.5 min); drop unverified byte-for-byte claim
2026-09-24 85c37f1 feat(dcp): --mbps for 2K masters below the 250 Mbit/s cap
2026-09-24 081cec3 docs: the film's DCP — mastered, validated (ClairMeta, asdcplib, SMPTE XSDs, PKL hashes)
2026-09-24 141d71b docs: put the film at the top of the README — autoplaying highlights + the full 20-minute film
2026-09-25 09f3590 Merge pull request #2 from vansyson1308/claude/modest-faraday-yqz2ds
2026-09-25 43bc610 feat(providers): Nemotron provider layer on Token Factory + mock, hackathon docs
2026-09-25 9eb89ef feat(director): Nemotron crew loop — plan, cast, artist+repair, vision critic, editor, research
2026-09-25 673894b feat(director): SSE API, DirectorPanel (VI/EN), film.mp4 assembler, demo gate
2026-09-25 c9f686d feat(deploy): Dockerfile (Ubuntu 24.04 + Node 22, ffmpeg, espeak-ng, migrate on boot), CI, showcase gallery
2026-09-25 54c0fa1 fix(deploy): drop VOLUME from Dockerfile (Railway rejects it); showcase generator + HTTP client
2026-09-25 27c84f3 feat(eval): director_bench — 10 fixed prompts × super-only / crew / crew+tavily
2026-09-25 a4b8bfb docs: README Director section + architecture diagram, ADR-017, video pipeline, Devpost draft, status
2026-09-26 3b0efc8 docs(hackathon): B3 re-check 2026-09-26 — egress to Nebius and Railway still 403
2026-09-26 fc8d059 feat(director): measured quality gates, per-symbol cast library, parallel shots
2026-09-26 6a297d8 feat(director): parametric character kit, connected-shape gate, honest critic wording
2026-09-26 39ffa7a fix(director): sets must be full-frame backgrounds; clearer feet-position stat for the critic
2026-09-26 494e91b feat(showcase): first real film on the hosted demo (tea-house, EN) + wording fixes
2026-09-26 5295e90 feat(director): animal kit, head-cut gate, recorder fixes, README GIF
2026-09-26 d8c6def fix(director): animals must use the kit, swarm-aware gates, tolerant ambient JSON
2026-09-26 5423e27 feat(showcase): three real films (EN on the hosted demo, VI + JA locally)
```
(Full list including docs/fix commits: `git log c9093a3..HEAD`. Regenerate before submitting.)

## City
Leave empty (no in-person event attended).
