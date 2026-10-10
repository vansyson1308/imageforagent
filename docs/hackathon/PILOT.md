# Real-user pilot: 「ひだまり人生劇場」 (Hidamari)

_Status (2026-10-10): **stories approved, narration line list exported, waiting for the owner's WAVs** (BLOCKERS B7 / O4). No episode made yet. This file contains real data only; nothing below is filled in until it happens._

| | |
|---|---|
| User | The owner's Japanese YouTube channel 「ひだまり人生劇場」: daily narrated stories (朗読) for senior viewers, hosted by the recurring character Haru-san in the tea room 茶房ひだまり |
| Need | The same host and set in every daily episode |
| Mechanism | Series mode (SPEC v2 WP5): a run's Cast & Set Bible + accepted symbols saved as a reusable series; new episodes reuse them pixel-identically |

## Before / after (owner's own words): _pending_

## Episodes: _none yet_

| # | Story | Wall time | USD | Owner edits | What the owner had to fix | Published |
|---|---|---|---|---|---|---|

## Limitations: _to be written from the episodes_

## Voice and licence rule (owner QC, 2026-10-10)

The Japanese Piper voice (`ja_JP-hi_fi_captain-medium`) is CC BY-NC-SA 4.0, **non-commercial**. It may appear in demos and tests. It is **never** used for a published Hidamari episode. Published narration is owner-supplied WAV (one file per line, through the existing per-line WAV path), unless the owner names another voice whose licence allows monetised YouTube use. The pilot production script refuses to finalise an episode that still uses a non-commercial voice.

## Narration (owner QC, 2026-10-10)

Narration = the story's own sentences, read aloud (朗読), **one line per shot**: the Director plans exactly as many shots as lines and each shot's narration is fixed to its line (`narration` request option). The owner renders the WAVs in his own pipeline from **[the line list](eval/pilot-lines.md)** ([JSON](eval/pilot-lines.json)): line id = WAV name (`ep1-L01.wav` …), text, target duration (5 characters a second + pauses; a guide, the engine times each shot to the real WAV). `scripts/director/pilot.ts --owner-wavs <dir>` attaches them; an episode whose shot count doesn't match its line count stays a draft.

## Stories

The 3 stories were **approved by the owner on 2026-10-10** and are in `docs/hackathon/eval/pilot-prompts.json` (6, 5 and 5 lines; about 33.6 s, 34.4 s and 32.5 s of narration).
