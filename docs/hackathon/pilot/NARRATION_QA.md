# Owner narration: AivisSpeech / morioki (QA report, 2026-10-10)

Rendered on the owner's machine with his Hidamari pipeline (`kana_preflight.py` → `produce_voice.py` → `run_voice_qa_ep.py`), from the packages in this folder.

- **Voice:** AivisSpeech Engine 1.2.0, model *morioki* (speaker uuid `396a746d-…`, style id `497929760`, the same id the preflight and QA scripts use). Licence ACML 1.0: commercial use allowed, credit optional. Credit text: `qa/voice_credit.txt`.
- **Format:** mono, 16-bit, 24 kHz WAV, one file per line (`audio/<line id>.wav`), plus `audio/timings.json` (line and scene start/end, `pause_after` included). Every peak is −1.4 dBFS. Integrated loudness per line ranges from −15.9 to −21.6 LUFS, so normalise each line (e.g. to −18 LUFS) before the mix.
- **Reading fixes (kana preflight):** two misreadings by OpenJTalk were caught by eye and fixed before synthesis (`qa/reading_fixes.json`):
  - `SHOWCASE_furin` S09_L01: 夜風 was read ヨルカゼ → ヨカゼ.
  - `PILOT03_tsukimi` S05_L01: まあるい was split マア、ルイ → マアルイ.
- **Whisper large-v3 QA:** up to 5 takes per flagged line; the best take is kept (`qa/reading_flags.txt` lists the remaining differences).
  - False positives (the audio is right; Whisper's spelling differs): tsukimi S05_L01 (丸い), furin S09_L01 (夜風 → OpenJTalk re-reads it ヨルカゼ), umeboshi S03_L02 (Whisper's text has 梅干し).
  - **Owner to listen once (about 5 s each):** tegami S02_L01 (Whisper hears 脳心子 for 老紳士), furin S08_L01 (Whisper hears 小ばあちゃん for おばあちゃん, after the opening 「). If either sounds wrong, the line is re-rendered with a reading fix.
- **Signal QA:** 0 flags (no clipping, nothing below −45 dBFS RMS, no line under 0.4 s).

| Package | Lines | Narration (s, incl. pauses) |
|---|---|---|
| PILOT01_tegami | 8 | 43.4 |
| PILOT02_umeboshi | 9 | 48.5 |
| PILOT03_tsukimi | 7 | 38.5 |
| SHOWCASE_furin | 11 | 65.4 |

All three pilots fit a ≤ 60 s Short; fūrin fits the 45–90 s showcase window.
