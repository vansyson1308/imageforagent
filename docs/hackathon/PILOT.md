# Real-user pilot: 「ひだまり人生劇場」 (Hidamari)

_Status (2026-10-10): **narration packages written, waiting for the owner's AivisSpeech WAVs** (BLOCKERS O4). The Haru-san / kissaten look is waiting for the owner's approval before any episode is made. No episode made yet. This file holds real data only; nothing below is filled in until it happens._

## What this is (and isn't)

The Director makes **animated companion Shorts for a real daily channel, with the same host every episode**. It does **not** replace the channel's watercolor main episodes. Each pilot episode is a YouTube Short: 9:16, at most 60 s, narrated (朗読) by the channel's own narrator voice.

| | |
|---|---|
| User | The owner's Japanese YouTube channel 「ひだまり人生劇場」: daily narrated stories (朗読) for senior viewers, hosted by Haru-san in the Showa-era kissaten 「ひだまり」 |
| Need | The same host and set in every daily Short, in the channel's look (warm amber / cream / muted sage, adult proportions, no chibi) |
| Mechanism | Series mode (SPEC v2 WP5): episode 1's Cast & Set Bible and accepted symbols become a series; later episodes reuse them pixel-identically |
| Narration | Fixed before the run: the owner's AivisSpeech pipeline renders every line from the package below; the Director times each shot to the real WAVs and never rewrites a line |

## Before / after (owner's own words): _pending_

## Episodes: _none yet_

| # | Story | Wall time | USD | Owner edits | What the owner had to fix | Published (URL, date) |
|---|---|---|---|---|---|---|

## Limitations: _to be written from the episodes_

## Narration pipeline (owner decision, 2026-10-10)

1. The Studio writes one package per film in `docs/hackathon/pilot/<slug>/`, made by `npx tsx scripts/director/owner-packages.ts`:
   - `production.json`: the owner's EP013 schema. It has one scene per shot. Each line is `{id "S01_L01", speaker "narrator", text, tts_text, sub_text, sub_pages, pause_after 0.5}`. The voice block reads `engine "aivisspeech"`, `speaker "<NARRATOR_MODEL_ID>"`, speedScale 0.9, pauseLengthScale 1.3, intonationScale 1.0, `use_field "tts_text"`.
   - `reading_check.txt`: the expected katakana of each `tts_text`, from pyopenjtalk.
   - `director.json`: what the Director needs on top of the owner's schema (the setting of each shot, the aspect ratio, an estimated length).
2. The owner runs his pipeline (kana preflight → produce_voice → run_voice_qa_ep, Whisper large-v3 per line, signal QA) and returns `audio/<line id>.wav` (24 kHz mono 16-bit) + `audio/timings.json`.
3. The Director runs in fixed-narration mode. The lines are the dialogue, and neither Ultra nor the Editor rewrites them. Each shot holds its lines' real WAVs plus `pause_after`. The film is re-linted (zero VOICE_OVERRUN) and assembled.

| Package | Format | Shots | Lines | Estimated narration |
|---|---|---|---|---|
| `PILOT01_tegami` 出せなかった手紙 | 9:16 Short | 7 | 8 | ≈ 48 s |
| `PILOT02_umeboshi` 梅しごと | 9:16 Short | 6 | 9 | ≈ 53 s |
| `PILOT03_tsukimi` 同じ月 | 9:16 Short | 5 | 7 | ≈ 42 s |
| `SHOWCASE_furin` 風鈴のおくりもの (showcase film) | 16:9 | 11 | 11 | ≈ 72 s |

The estimate is 6 morae a second, plus 0.35 s for each 、 and the 0.5 s pause after each line. It is only a planning guide.

## Voice and licence

- **Published narration:** AivisSpeech, voice **morioki** (ACML 1.0, commercial use allowed). It is credited in the film end credits, the README and Devpost: 「音声合成：AivisSpeech / morioki（ボイス提供：もりおき、モデル制作：yuki、ACML 1.0）」.
- **Piper JA (`ja_JP-hi_fi_captain-medium`):** CC BY-NC-SA 4.0, non-commercial. It stays only in the live demo, for judges' own runs, labelled "non-commercial demo voice". It is never used in a published episode, a showcase film or the demo video. The pilot production script refuses to finalise an episode that still has a line in a non-commercial voice.

## Stories

The 3 stories were **approved by the owner on 2026-10-10**. Their setting moved from the tea room 茶房 to the Showa-era kissaten 「ひだまり」 on the owner's request, with the plots kept; in Tsukimi the 縁側 is the kissaten's back veranda. The source is `docs/hackathon/eval/pilot-prompts.json`: one scene per shot, narration in the channel's 朗読 style (short clauses separated by 、).
