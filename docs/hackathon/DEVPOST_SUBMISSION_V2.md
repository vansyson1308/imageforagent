# Devpost submission v2: paste-ready (DRAFT)

_Status 2026-10-09: draft. The **feedback answers** are complete and drawn only from [FEEDBACK_LOG.md](FEEDBACK_LOG.md), the eval files and DECISIONS. Every number that needs a live v2 run is a visible `{{PENDING: …}}` slot. Nothing gets pasted while a slot is open. The final pass is at M3 (2026-10-23). The v1 text stays in [DEVPOST_SUBMISSION.md](DEVPOST_SUBMISSION.md). Ratings are **proposed** from the evidence; the owner confirms them before pasting._

## Project name
Storyboard Studio Director

## Elevator pitch (≤ 200 chars)
Nemotron writes the film as code; a deterministic engine renders it and *measures* it. Type a story in any language, get an acting, voiced, scored short film. No image generator.

## Track
_(unchanged from v1; changing the track needs the owner, SPEC §1.7)_

## Built with
nemotron, nebius-token-factory, next.js, react, typescript, prisma, sqlite, sharp, librsvg, ffmpeg, piper, espeak-ng, docker, railway, tavily

## Links
- Demo: https://studio-production-049c.up.railway.app (judges: passcode in the Judge Access PDF)
- Health: https://studio-production-049c.up.railway.app/api/health
- Showcase + replays (no passcode): https://studio-production-049c.up.railway.app/showcase
- Code: https://github.com/vansyson1308/imageforagent
- Video: {{PENDING: YouTube URL (WP8)}}

## Description

### Inspiration
{{PENDING: v1 text + the Hidamari pilot (only real data from PILOT.md)}}

### What it does
{{PENDING: final at M3. Content: story → Ultra plans shots with coverage → Super designs the cast as engine kits and draws every frame as SVG → the engine renders, measures (render gates, near-duplicates) and repairs → a VLM looks, Nano scores, revise/floor → characters act (poses, blinks, lip-sync, walks) → Piper voices, score bed, dissolves → MP4 + full trace. Series mode keeps a host pixel-identical across episodes.}}

### How we built it
{{PENDING}}

### Results (real runs, `docs/hackathon/EVAL_RESULTS.md`)
{{PENDING: from the bench v2 only: judge means (both judges), paired wins vs super-only v2, independently judged critic uplift, USD per finished minute, gate failures; crew v1 → v2 on the same judge. A missed target is stated as missed.}}

### Challenges / Accomplishments / What we learned / What's next
{{PENDING}}

### Real users (Potential impact)
{{PENDING: PILOT.md facts only (episodes made, wall time, USD, owner edits). Publication URL/date only if the owner published. No views or testimonials.}}

## Existing project: how we significantly updated it
{{PENDING: regenerate at the end. `git log --oneline 28d07d0^..HEAD | wc -l` and `git diff --stat <v1-submission-commit>..HEAD | tail -1`, then a concise list: detached runs + replay + health (WP1), acting/voices/vision critic/coverage/score (WP4), series mode (WP5), eval v2 (WP7).}}

---

## Feedback answers (Most Valuable Feedback)

### 1. Which model(s) did you use, and why that size or variant?
Three Nemotron 3 tiers on Nebius Token Factory, sized by what a mistake costs in each role. **Ultra (`Nemotron-3-Ultra-550b-a55b`) is the Director.** It turns a story into a shot list plus a Cast & Set Bible. A bad plan poisons every later call, and the plan is one call per film, so we pay for the biggest model there. In our runs it wrote 1.8–2.3 k-token plans in 7–8 s that respected the 180° rule, duration caps and reading speed on the first try. **Super (`nemotron-3-super-120b-a12b`) is the Cast and the Artist.** It writes every frame as SVG code (3–5 k tokens, 20–60 s) and fills the JSON kit specs for people and animals. That's the volume role: good enough code at a mid price. **Nano (`NVIDIA-Nemotron-3-Nano-30B-A3B`) is the Critic, the Editor and the research detector.** These are many short calls (1–3 s, under $0.0002 per critique by our price table). Our v1 benchmark checked the split. Against "Super does everything", the crew won on 6 of 10 prompts with an independent judge (+0.41 / 10) at 1.81× the cost. {{PENDING: the v2 crew vs super-only line from EVAL_RESULTS.md}}. No Nemotron vision model is served, so in v2 an open VLM (MiniCPM-V 4.5) only *describes* a frame, and Nano still gives the score.

### 2. How would you rate Nemotron's output quality for your use case (1–10)?
**Proposed: 7/10.** What earns it: structured output is excellent. `response_format: json_schema` worked on the first attempt on all three tiers, and Super's SVG was sanitizer-clean almost every time. The syntax is solved. Super also filled our parametric character kits correctly on the first try in every run we saw (valid enums, Bible-matching colours, elders given grey hair). That cut library tokens from about 7–15 k to 3–5 k per film. Ultra's plans were coherent and film-literate. What costs points is composition, not code. Super placed characters at 15–25 % of the frame, drew "sets" as 1920×300 strips and lit night scenes bright. Prose rules didn't fix this; *measured* feedback did ("only 23 % of the frame height as rendered; a Medium shot needs 45 %, use height=486"). In v1, 57–72 % of shots rendered on the first pass. Nano also misapplied numeric rules stated in prose ("70 % exceeds the 30 % limit" → a harmful revision) until the engine computed the checks and handed Nano the results as facts. {{PENDING: v2 first-pass % and judge mean}}. So: a strong code writer that needs a measuring partner for spatial judgement.

### 3. Did you fine-tune, prompt-engineer or use Nemotron out of the box? What was your approach?
Out of the box, with no fine-tuning. The approach is **"the model writes, the engine measures"**. Every model output goes through deterministic validators before it can touch the film: zod schemas, then an SVG sanitizer, then the engine's construct/motion schemas. Then the render itself is measured: subject size, framing, flat-block sets, empty frames and near-duplicate shots. Each failure goes back to the model as a *measured* repair hint with the exact numbers and a concrete fix. One repair turn usually lands. Prompting carries roles and craft rules (coverage, acting cues, mood), but numbers are never left to the model's arithmetic. We also turned free-form drawing into **specs where it matters**. People and animals are small JSON kit specs that the engine builds, so identity, posing and blinking are exact by construction and Super only chooses. Thinking is turned off per call where latency matters, using `chat_template_kwargs.enable_thinking`. Plans that fail a measured coverage check get one Ultra retry with the measured problems, and the plan with fewer problems wins. All prompts and the full step trace of every run are public in the repo.

### 4. How did Nemotron compare to other models you've used for similar tasks?
The comparison we can back with data is **within the family**. A mixed crew (Ultra plans, Super draws, Nano critiques) beat "Super for every role" on 6 of 10 prompts in v1, judged blind by an independent VLM (`google/gemma-3-27b-it`, not part of the crew). {{PENDING: v2 paired result, two judges}}. Across vendors, two observations. First, the project began with a hosted *image-generation* model (Gemini, removed in ADR-010) and moved to "an LLM writes the picture as code" (ADR-010). With generated images, keeping a character the same across shots was a matter of prompt luck, and every iteration cost credits. With SVG, `<use href="#symbol">` makes the character pixel-identical by construction, and series mode now proves it with a hash of the host's symbol across episodes. Second, for *seeing* pixels we had to use non-NVIDIA models, because no Nemotron VLM is served: MiniCPM-V 4.5 as the critic's eyes, and gemma-3-27b plus a second VLM as eval judges. We deliberately kept judges and critic different models. We have not run a head-to-head of other vendors' LLMs as the Artist, so we make no claim there.

### 5. Which Nebius platform capabilities were most valuable, and how?
1. **One OpenAI-compatible endpoint for the whole crew.** Ultra, Super, Nano, the VLM and the eval judges all sit behind one key and one client (about 230 lines, no SDK). Swapping a role's model is configuration.
2. **`GET /v1/models` at runtime.** The server resolves each role against the live catalog (case-insensitive, because ids mix `Nemotron-…`, `nemotron-…` and `NVIDIA-Nemotron-…`) and the public health endpoint reports whether every crew model is still listed. A daily GitHub Action checks that endpoint, so the hosted demo's model access is verified every day without a key in CI.
3. **Reliable `json_schema` structured output** on all tiers, which kept every model reply machine-checkable.
4. **Fast, clear errors.** An image sent to a text-only model returns `400 "This model does not support image input"` in about 1.2 s, which made the vision fallback trivial.
5. **Headroom.** We saw no rate-limit errors at 3–6 concurrent drawing calls, so a film draws shots in parallel.
6. **Open models next to Nemotron** (gemma, MiniCPM, Qwen) on the same bill, which is what made an *independent* judge possible without a second provider.

### 6. How likely are you to recommend running Nemotron on Nebius (1–10), and why?
**Proposed: 8/10.** For agentic, code-writing workloads, yes. The three Nemotron tiers on one OpenAI-compatible endpoint let us size every role to its job, structured output just works, and the platform held up under parallel calls without throttling us. A whole film costs cents by our estimates ({{PENDING: v2 USD per finished minute}}), so a daily series is affordable. Two points off are about **discoverability, not inference**. First, `/v1/models` has no capability metadata, so an agent can't know which models accept images, support `json_schema` or allow reasoning to be turned off. We ended up probing models with a red disc. Second, the API reference lives only on a docs host that sandboxed coding agents often can't reach, so we learned the vision message format and the thinking toggle from a Nebius GitHub repo instead. Both are cheap to fix and would make the platform excellent for exactly the users this hackathon targets: AI agents building with AI.

### 7. How does running Nemotron inference on Nebius compare to previous cloud or local environments (1–10)?
**Proposed: 8/10.** Before Token Factory, this project's AI ran on a hosted image-generation API (Gemini), and the engine itself is zero-key (agents write SVG locally). Compared with that, three things are better on Nebius. **Model choice per role**: a 550B planner, a 120B artist and a 30B critic behind one key; locally that would mean three deployments and far more GPU than a hackathon team has. **Predictable structured output**, so the engine's validators, not retries, do the work. **Operations**: nothing to host but our app. Railway runs the web app on CPU, and all inference is a network call that answered fast enough to draw 3 shots in parallel. Points off: no NVIDIA vision or TTS model in the catalog yet ([evidence](evidence/models-2026-10-09.json)), so pixels and voices still need non-NVIDIA pieces (MiniCPM-V for looking, Piper on CPU for voices). And costs we can only *estimate* from a price table, because we have no per-request price to reconcile against.

### 8. What additional features would have made it more effective?
1. **Capabilities in `GET /v1/models`**: `{vision, json_schema, reasoning_toggle, context, price}` per model. Agents would pick models safely instead of probing them with test images (our eval does exactly that, D36).
2. **A per-request cost field** (or a machine-readable price endpoint). Our budgets, spend caps and "$ per finished minute" are estimates from a hand-kept table.
3. **The API reference mirrored on GitHub** (OpenAPI spec plus model table). Coding agents in sandboxes reach GitHub, not arbitrary docs hosts.
4. **Consistent model ids** across the family. `Nemotron-3-Ultra…`, `nemotron-3-super…` and `NVIDIA-Nemotron-3-Nano…` break exact-match configs.
5. **A served Nemotron VLM.** Our critic is split in two ("an open VLM looks, Nano scores") only because none is served. The code adopts one automatically once it appears in the catalog.
6. **An NVIDIA open TTS model on Token Factory.** Voices are the last part of our film that runs outside the crew (Piper on CPU), and an API voice would remove the ~800 MB Piper layer (runtime + voice models) from our image.
7. **Per-key spend limits and alerts** in the dashboard, so a demo key can't exceed a budget even if the app's own guard fails.

### 9. What do you most hope to see from the Nemotron team next?
**A Nemotron vision-language model on Token Factory, tuned for judging synthetic images and diagrams.** Our whole design is "the model writes, the engine measures". The engine can measure geometry, but only a VLM can tell whether a frame *reads*: is that a fox or a cat, does the close-up feel sad, is the lantern actually lit? Today that judgement comes from a non-NVIDIA model, and Nano grades its notes. A Nemotron VLM would put the entire loop (plan, draw, see, score) inside one model family and remove a handoff that loses detail. Second, **better spatial reasoning for code-as-graphics.** Super's syntax is near perfect; its weak spot is layout (subject size, framing, depth). A training signal from rendered output, like our measured repair hints, could raise first-pass success a lot. We'd gladly share our gate data and traces (all public in the repo). Third, **small, fast Nemotron variants for high-volume critic and editor roles** with reliable numeric reasoning. Nano was fast and cheap, but it misread rules stated in prose until we computed them for it.

---

## Credits

音声合成：AivisSpeech / morioki（ボイス提供：もりおき、モデル制作：yuki、ACML 1.0）. Japanese narration of the published films comes from the channel owner's AivisSpeech pipeline. The live demo's Japanese Piper voice is a non-commercial demo voice, used only for judges' own runs.

## Testing instructions (private field)
See the Judge Access PDF (generated by `npm run judge:pdf` from [JUDGE_ACCESS.md](JUDGE_ACCESS.md); the passcode is filled in only at export time, never in the repo).
