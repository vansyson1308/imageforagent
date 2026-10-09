# Storyboard Studio Director: Judge Access

**Type a story in any language. Get an animated film. No image generator.**
NVIDIA Nemotron models on Nebius Token Factory write the whole film as code; a deterministic engine renders it, measures every frame, and the crew fixes what the numbers say is wrong.

## Access

| | |
|---|---|
| Demo | **https://studio-production-049c.up.railway.app** |
| Passcode | **{{DEMO_PASSCODE}}** |
| No passcode needed | Showcase films + replays of real runs: https://studio-production-049c.up.railway.app/showcase |
| Health (live status of the demo) | https://studio-production-049c.up.railway.app/api/health |
| Code (MIT) | https://github.com/vansyson1308/imageforagent |

Testing is free: every model call is paid by the team's Token Factory account, inside a daily budget sized for the judging period.

## Test it in 4 steps (≈ 5 minutes)

1. Open the demo and enter the passcode above.
2. On the landing page, click **Make this film** under one of the three sample stories (English, Tiếng Việt, 日本語). One click starts the crew.
3. Watch the run view: the plain-language status line, the latest frame, the filmstrip filling in, the critic's **before → after** when a revision wins, and **The crew** card (which Nemotron model did what, tokens and cost). Open **Crew timeline** to see every model call.
4. When it finishes (about 3–6 minutes), play the film, then download the **MP4** or the **production package** (frames, clips, subtitles, EDL/OTIO, glTF, `assemble.sh`).

You can close the tab at any time: the film keeps rendering on the server, and reopening the studio page continues where it is.

## Sample stories

- **The Kite Mender** (English): a grandfather mends a torn kite on a windy beach in Brighton.
- **Nồi bánh chưng đêm Ba Mươi** (Tiếng Việt): a grandmother and grandson keep watch over the New Year's Eve rice cakes in Hà Nội.
- **風鈴のおくりもの** (日本語): a girl and her grandmother at the Gion festival in Kyoto, and a wind chime that rings again.

Or write your own story in any language (at least 20 characters).

## What to look at

- **Nemotron writes the film as code.** Ultra plans, Super draws every frame as SVG, Nano critiques and edits. Every call is listed with its model, tokens and cost.
- **The engine measures every frame.** When a render fails a measurement (the hero too small for a close-up, a night scene too bright, a head cut off), the exact number goes back to the Artist as a repair hint. Look for repair steps in the timeline.
- **Critic before → after.** A revision replaces a frame only if it scores higher.
- **Consistency by construction.** Each character is drawn once as a reusable symbol, so it is pixel-identical in every shot.
- **No passcode?** The showcase's **Replay the real run** plays a stored real run at 10× through the same view.

## Limits (honest)

- A film takes about 3–6 minutes. Up to {{MAX_CONCURRENT_RUNS}} films render at the same time; if the demo says it is busy, try again in a few minutes.
- Each judge session can keep up to {{MAX_PROJECTS}} films; demo films are deleted after {{RETENTION_HOURS}} hours.
- A daily token budget protects the demo. If it is used up, the demo says so; the showcase and replays always work.
- Films are 1K / 12 fps on the demo (the showcase films are rendered at higher settings).
- Research with Tavily is optional and is shown only when it is enabled on the server.

## Contact

{{CONTACT}}
