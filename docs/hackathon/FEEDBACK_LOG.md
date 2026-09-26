# Feedback log — Nebius Token Factory, Nemotron, Tavily

Concrete, reproducible notes gathered while building. Feeds the Devpost "feedback" field.
Each entry: date · component · observation · how to reproduce · severity/suggestion.

## Token Factory API

- 2026-09-25 · docs · The public docs host (`docs.tokenfactory.nebius.com`) is the only place the vision message format and the per-model thinking toggle are documented. Sandboxed agent environments that allowlist GitHub but not arbitrary domains can't read them. Suggestion: mirror the API reference (OpenAPI spec + model capability table: image input yes/no, thinking control key, JSON-schema support) in a public GitHub repo. We had to rely on Nebius's `nebius-physical-ai` repo for the `image_url` format and `chat_template_kwargs.enable_thinking`.
- 2026-09-25 · models endpoint · Model-list membership doesn't tell you a model's capabilities. Nebius's own verification report notes that a listed multimodal model rejected images with HTTP 400. Suggestion: add `capabilities: {vision, json_schema, reasoning_toggle}` to `GET /v1/models` entries.

- 2026-09-26 · models endpoint · Confirmed live: `GET /v1/models` lists `nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (and `nvidia/Nemotron-3_5-Lightning`), but **no Nemotron Omni / vision Nemotron**. Casing is inconsistent across the family (`Nemotron-3-Ultra…` vs `nemotron-3-super…` vs `NVIDIA-Nemotron-3-Nano…`), so exact-match configs break easily. We match case-insensitively. Suggestion: consistent ids plus a capability field.
- 2026-09-26 · errors · Sending an image to a text-only model returns a clear `400 {"detail":"This model does not support image input"}` in ~1.2 s. It is easy to detect and fall back on. 👍 (`evidence/vision-probe-2026-09-26.json`)
- 2026-09-26 · structured output · `response_format: json_schema` worked on the first attempt on all three Nemotron tiers (smoke: 0.40–0.69 s for a tiny call). The json_object fallback was never needed.

## Nemotron models (per role)

Measured over 6 real 4-shot films (2026-09-26, ~$0.03–0.07 each, $0.28 total by our price table):

- 2026-09-26 · Ultra (Director) · The plan is 1.8–2.3 k output tokens in 7–8 s. Shot lists are coherent, respect the 180° rule and duration caps, and give dialogue that fits the reading-speed lint on the first attempt. After we asked for it, every shot description includes time of day and light.
- 2026-09-26 · Super (Cast/Artist) · Writes valid, sanitizer-clean SVG fragments almost always. Its failure modes are compositional, not syntactic: characters placed at 15–25 % of the frame, "sets" drawn at 1920×300, flat/bright night scenes, and 4-shape "stick figure" symbols. Prose rules alone did not fix this. **Measured feedback does**: when the repair hint states the *measured* size ("only 23 % of the frame height as rendered; a Medium shot needs 45 %, use height=486"), the next attempt usually complies. Latency swings: 20–60 s per 3–5 k-token drawing. We saw one degenerate 16 k-token reply that hit max_tokens.
- 2026-09-26 · Super (motion JSON) · Recurring small schema slips in ambient tracks: `#rrggbbaa` colours and `ease` at track level instead of per key. We now normalise both deterministically. Occasionally it emits trailing-comma JSON. The repair loop fixes that in one turn.
- 2026-09-26 · Nano (text critic) · Fast (1–3 s) and cheap (<$0.0002/critique), but it **misapplies numeric rules stated in prose** ("character is 70 %, exceeding the 30 % limit" → 6/10, triggering a harmful revision). The fix was to compute the checks in the engine and give Nano their results as authoritative facts. Nano then critiques what numbers can't measure (story match, composition, missing props).
- 2026-09-26 · Nano (Editor) · Continuity checks return `Continuity OK` in ~14 tokens. Lint fixes weren't exercised in these runs (0 findings, because dialogue is recorded before drawing).

## Tavily

- 2026-09-25 · docs · The official Python client source was enough to derive exact request/response shapes for a no-SDK `fetch` integration. Good.
