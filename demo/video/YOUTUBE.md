# YouTube upload: Storyboard Studio Director v2 (PUBLISHED 2026-10-19: https://youtu.be/aNHZgw2Jo80)

_Published by the owner on 2026-10-19: https://youtu.be/aNHZgw2Jo80. This file is the text as uploaded. The results line is the owner + QC approved text (2026-10-19 accuracy rebuild: the Super-alone comparison is out of the video). The chapters follow the scenes in `narration.v2.json` (154 s cut, rebuilt 2026-10-19 after the owner + QC video QC; no model calls). No passcode anywhere: not in the video, the description or the comments. A web copy of the video: https://studio-production-049c.up.railway.app/showcase/demo-video-v2.mp4_

**File:** `demo/video/out/director_demo_v2.mp4` (1920×1080, ≤ 2:55, built by `sh demo/video/build-v2.sh`) · **Subtitles:** upload `demo/video/out/director_demo_v2.en.srt` as English · **Thumbnail:** `demo/video/out/thumbnail_v2.png` (1280×720, a frame of the kite film)

## Title (≤ 100 chars)
Typed, not drawn: NVIDIA Nemotron writes a film as code (Storyboard Studio Director)

## Description
Type a story in any language and get a short film: characters who act, voices, and an original score. There's no image generator. A crew of NVIDIA Nemotron models on Nebius Token Factory writes every frame as code, and a deterministic engine renders and measures it.

The video opens on "The Mended Kite", one of three published films, then replays the real run that made it, step by step, from its stored trace (no live run, no tokens spent for the video).

- Ultra (Director) plans the shots, the coverage and a cast & set bible
- Super (Cast/Artist) designs the characters as engine kits and draws each frame as SVG
- The engine measures every render; a vision model looks and Nemotron Nano scores; Nano edits
- Only the shots that still miss are redrawn, in a redo run; every published film passed the measured checks and a check by eye

Real results (10 fixed prompts, blind independent judges, frozen commit 394a797): crew v2 scored 6.22/10 vs v1's 5.49 on the v1 judge (gemma-3-27b-it, n=9, SD 0.54), better than v1 on 6 of 9 prompts (paired). A second judge (Kimi-K3) scores harsher (4.38). Full report, missed targets included: https://github.com/vansyson1308/imageforagent/blob/main/docs/hackathon/EVAL_RESULTS.md

▶ Try it: https://studio-production-049c.up.railway.app (the showcase and the replays need no passcode: https://studio-production-049c.up.railway.app/showcase)
▶ The kite's run, replayed: https://studio-production-049c.up.railway.app/showcase/replay/v2-kite
💻 Code (MIT): https://github.com/vansyson1308/imageforagent

Chapters
0:00 The Mended Kite: a typed film
0:24 The real run, replayed: Ultra plans
0:40 Super draws, the engine measures
0:57 The critic looks and scores
1:08 Redrawing only the shots that miss
1:19 Two more films: bánh chưng and a Hidamari story
1:39 Under the hood: Token Factory tiers
2:01 Real results and try it

Voice-over: Piper `en_US-john-medium`; its model card lists the training dataset as LibriVox recordings, "License: public domain" (fine-tuned from Piper's `kristin` voice, also LibriVox, public domain). Vietnamese narration: Piper vi_VN-vais1000-medium (VAIS-1000 dataset, CC BY 4.0; fine-tuned from Piper's en_US-lessac voice, whose training data is under the Blizzard 2013 licence), used for this non-commercial demo. Japanese narration in the Hidamari film: AivisSpeech / morioki (ACML 1.0), as credited at the end of that film. The films' music: the engine's own synth. Built for the Nebius × NVIDIA hackathon.

## Tags
nvidia nemotron, nebius, token factory, ai agents, ai film, storyboard, svg, generative video, text to film, llm, open models, hackathon
