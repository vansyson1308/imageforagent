# Demo video: script (≤ 3:00, target 2:52)

The narration must explain how **Nebius Token Factory** and **NVIDIA Nemotron** are used (Devpost rule).
Source of truth for timing and words: [`narration.json`](narration.json). `build.sh` generates the voice-over, the English `.srt` and the cut from it.

| Time | Scene | On screen | Narration (summary) |
|---|---|---|---|
| 0:00–0:15 | title | Title card + architecture preview | Hook: "Type a story. Get a film. No image generator: Nemotron writes the film as code." |
| 0:15–1:30 | live | Screen recording of the hosted demo (time-lapsed): story pasted → Ultra's shot list → Super's frames pop in → **render gates + Nano critic flag a frame, revision fixes it (before/after)** → Editor lint fixes | Roles, the repair loop, the vision critic loop, live tokens and cost |
| 1:30–1:42 | film | The finished film playing in the panel | Server-side assembly, downloads |
| 1:42–2:15 | arch | Architecture diagram (`docs/media/director-architecture.svg`), slow push-in | Token Factory endpoint, JSON schema, image input, why each tier, Tavily, sandbox + budgets |
| 2:15–2:30 | eval | Eval chart (`docs/hackathon/eval/chart.png`) | 10 stories × 3 configs: first-pass %, critic uplift, USD per finished minute |
| 2:30–2:40 | showcase | Showcase gallery recording (3 languages) | Films made end to end by the crew |
| 2:40–2:52 | end | End card: repo, demo URL, MIT | Call to action |

No music by default (nothing copyrighted). To add the engine's own synth score, see `VIDEO_RUNBOOK.md`.
