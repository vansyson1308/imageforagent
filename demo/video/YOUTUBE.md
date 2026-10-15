# YouTube upload: Storyboard Studio Director v2 (DRAFT 2, 2026-10-15)

_The owner uploads. Every `{{PENDING}}` is filled only after QC approves the number (bench table first, then the film totals of D92). The chapters follow `narration.v2.json`; re-check them against the final cut. No passcode anywhere: not in the video, the description or the comments._

**File:** `demo/video/out/director_demo_v2.mp4` (1920×1080, ≤ 2:55, built by `sh demo/video/build-v2.sh`) · **Subtitles:** upload `demo/video/out/director_demo_v2.en.srt` as English · **Thumbnail:** `demo/video/out/thumbnail_v2.png` (1280×720, a frame of the kite film)

## Title (≤ 100 chars)
Typed, not drawn: NVIDIA Nemotron writes a film as code (Storyboard Studio Director)

## Description
Type a story in any language and get a short film: characters who act, voices, and an original score. There's no image generator. A crew of NVIDIA Nemotron models on Nebius Token Factory writes every frame as code, and a deterministic engine renders and measures it.

The video opens on "The Mended Kite", one of three published films, then replays the real run that made it, step by step, from its stored trace (no live run, no tokens spent for the video).

- Ultra (Director) plans the shots, the coverage and a cast & set bible
- Super (Cast/Artist) designs the characters as engine kits and draws each frame as SVG
- The engine measures every render; a vision model looks and Nemotron Nano scores; Nano edits
- A shot that still misses is redone on its own; every published film passed the measured checks and a check by eye

Real results: {{PENDING: one line from EVAL_RESULTS.md, after QC}}

▶ Try it: https://studio-production-049c.up.railway.app (the showcase and the replays need no passcode: https://studio-production-049c.up.railway.app/showcase)
▶ The kite's run, replayed: https://studio-production-049c.up.railway.app/showcase/replay/v2-kite
💻 Code (MIT): https://github.com/vansyson1308/imageforagent

Chapters
0:00 The Mended Kite: a typed film
0:24 The real run, replayed: Ultra plans
0:40 Super draws, the engine measures
0:57 The critic looks and scores
1:09 Redoing only the shots that miss
1:21 Two more films: bánh chưng and a Hidamari story
1:38 Under the hood: Token Factory tiers
2:00 Real results
2:26 Try it

Voice-over: Piper `en_US-john-medium` (public domain, LibriVox). The films' music: the engine's own synth. Japanese narration in the Hidamari film: AivisSpeech / morioki (ACML 1.0), as credited at the end of that film. Built for the Nebius × NVIDIA hackathon.

## Tags
nvidia nemotron, nebius, token factory, ai agents, ai film, storyboard, svg, generative video, text to film, llm, open models, hackathon
