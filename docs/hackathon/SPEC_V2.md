# SPEC v2: Storyboard Studio Director, final push for the Nebius x NVIDIA Global AI Hackathon

**Repo:** `vansyson1308/imageforagent` (MIT) · **Hosted demo:** https://studio-production-049c.up.railway.app (Railway project `storyboard-studio-director`, service `studio`, volume `/data`)
**Track:** Best Apps and Agents · **Devpost status:** submitted 2026-09-27, editable until **2026-10-30 10:00 PDT (= 2026-10-31 00:00 ICT)**
**Judging:** 2026-12-01 → 2026-12-15. The hosted demo must work during that whole window.
**Goal:** move from "valid, technically strong entry" to a Grand Prize contender. The four criteria carry equal weight: Technological Implementation, Design, Potential Impact, Quality of the Idea. Ties are broken on Technological Implementation first.

Save this file as `docs/hackathon/SPEC_V2.md` in your first commit. Where it conflicts with `SPEC.md`, v2 wins. Keep `STATUS.md`, `DECISIONS.md` (continue at D26) and `BLOCKERS.md` (continue at B5) up to date the way v1 did.

---

## 0. Where we stand (audit of 2026-10-09)

### Hard rules from the official rules (do not break)
- Each runtime model call goes to Nebius Token Factory and uses at least one NVIDIA open model. Nemotron must stay the core of the crew.
- The video is public on YouTube, **under 3:00**, shows the project running, and contains **no copyrighted music or third-party trademarks**.
- The repo stays public, MIT shows in the About sidebar, and the README explains Nemotron, Token Factory and other Nebius tools.
- The project existed before 2026-08-26, so all v2 work strengthens the "significantly updated during the period" story. Never rewrite git history.
- **Best Use of Tavily** needs a *functional runtime call* to the Tavily API inside the solution.
- Judges must be able to **test the project free**. A private site needs credentials given to judges.

### Baseline (v1, real numbers, `docs/hackathon/EVAL_RESULTS.md`)
| | super-only | crew v1 |
|---|---|---|
| Independent judge (gemma-3-27b-it, 0–10) | 5.08 | **5.49** |
| First-pass render % | 72.0 | 56.8 |
| Critic before → after (self-score) | — | 6.92 → 7.07 (revisions add only ~+0.15) |
| USD / finished minute | 0.118 | 0.234 |
| Wall s / film | 156 | 213 |
Tests: 554 pass / 4 skip. Total spend so far: about $3.23 of the $25 Token Factory credit.

### Findings this spec must fix (ranked)
1. **Judges cannot enter the demo.** README says the passcode is in the "testing instructions", but this hackathon's Devpost form has no such field. The passcode is nowhere on the submission. *(Owner + Claude fix the Devpost side. You fix the product side, WP1.)*
2. **Tavily claimed but not live.** The architecture SVG, README, video end card and the "Built on … Tavily" line all mention it. Devpost says "No", there's no key on Railway, and the researcher has only been tested against a fake server. Bench config C was never run.
3. **Design is the weakest criterion.** The films look like flat clip-art. Characters stand still in every shot, consecutive shots reuse the same composition, and broken frames get through. Example: `tea-house` shot 3 is abstract blocks with no character, and shot 8 is a close-up pasted over a brown rectangle. Film voices come from **espeak-ng**, which sounds robotic.
4. **Impact is generic.** The only "user" is "a daily storytelling YouTube channel", with no evidence.
5. **The critic barely moves quality** (+0.15). Text-only critique can't see the picture.
6. **Fragile judge UX.** A film takes 3–8 min, and closing or sleeping the tab cancels the run (D9). The UI is dense, dark and developer-styled.
7. **Identity drift.** The repo is named `imageforagent`. `package.json` has name `storyboard-studio`, a description about the old engine, and `repository.url` pointing at a non-existent repo. The app `<meta description>` is still the old Vietnamese "storyboard image sequences" sentence. The README's first big block is the 20-min film "made entirely by an agent", which was made by an external coding agent with the zero-key engine, not by the Nemotron crew. A judge can misread what Nemotron did.
8. **The video undersells the product.** About 15 s static title, about 75 s of a dark UI with tiny text, about 12 s of the finished film, more than 30 s of the architecture slide. It was recorded on a local server, not the hosted demo. The YouTube title is "My product demo video".
9. **Only Token Factory is used** of Nebius' stack. The track explicitly encourages Nebius Serverless.

---

## 1. Ground rules for you (the coding agent)

1. **Branch & PRs:** work on a feature branch and open PRs to `main`. Keep `main` deployable at all times. Small, reviewable commits with conventional messages.
2. **Secrets:** never commit or print keys or the demo passcode. `.env.local` and Railway variables only. The passcode must never appear in the repo, logs, screenshots or the video.
3. **Honesty is a feature.** Every number in README, Devpost text or the video must trace to a file in `docs/hackathon/evidence/` or `eval/`. Never invent users, views, testimonials or quotes. Label mock runs as mock. If a v2 change makes something worse, report it.
4. **Spend:** append every paid call to `evidence/spend-ledger.jsonl` as in v1. **New spend cap for v2: $10** (stop line in scripts `SPEND_ALERT_USD` = previous total + 10). Ask the owner before exceeding it. Before the first live run, record the remaining Token Factory balance the owner reports in `STATUS.md`.
5. **Don't break the zero-key engine.** All existing tests stay green, and CI (lint, tsc, test, build) passes on every PR. New logic gets unit tests. Mock-provider e2e covers every new flow.
6. **Owner-only actions** (accounts, keys, billing, YouTube upload, Devpost fields, GitHub About) go into `BLOCKERS.md` with exact steps. Keep working on everything else, never wait idle.
7. **Stop and ask the owner** before:
   - deleting data on the Railway volume
   - changing the track
   - any change to model roles that removes Nemotron from a role it holds today
   - spending past the cap
   - anything irreversible on hosted infrastructure
8. **Language:** code, docs, UI copy for judges in English. The UI keeps its VI/EN toggle. Add JA strings where WP5 needs them.

---

## 2. Work packages

Priority: **P0** must ship (cheap, removes disqualification or 0-score risk) → **P1** wins points → **P2** only if time and owner access allow.

### WP1 · P0 · Judge access & a demo that survives until 2026-12-15
*Criteria: all four (a judge who can't run it scores from the video only).*

1. **Unlock page:** clear English copy: "Judges: the passcode is in the *Judge Access* PDF attached to the Devpost submission." Add a prominent **"Watch finished films without a passcode → /showcase"** link. Optionally add a "Contact" mailto read from env `DEMO_CONTACT_EMAIL` (unset = hidden).
2. **Runs survive the browser:** replace D9 so a disconnect **no longer cancels** a run.
   - The run executes server-side, detached from the request, and keeps writing `DirectorStep`s.
   - Add `GET /api/projects/:id/director/runs/:runId/events` (SSE). It replays persisted steps, then tails live events.
   - The UI auto-reconnects (exponential backoff) and restores state on reload. "Cancel" is only the explicit button or `POST …/cancel`.
   - Keep all budgets and the daily gate. Add a server-side wall-time watchdog.
   - Record this as D26.
3. **One-click sample stories:** 3 curated stories (EN, VI, JA), each with a "Make this film" button. Show an estimated time and an "you can close this tab, the film keeps rendering" note.
4. **Instant replay:** on `/showcase`, add a "Replay the real run" view that streams a stored trace at 10× speed through the same run UI. Judges then see the crew at work in 30 s without spending tokens.
5. **Health & monitoring:**
   - `GET /api/health` (public, no secrets in the output) checks DB, storage writable, ffmpeg, TTS engine(s), a Token Factory `GET /v1/models` reachability check (free), and Tavily key presence (no paid call). It returns per-check `ok/fail` + version + commit SHA.
   - Add a GitHub Actions workflow (daily cron through 2026-12-31) that calls `/api/health` and fails loudly. Document how the owner gets an email on failure (default GitHub notifications).
6. **Capacity for judging:** review `DEMO_DAILY_TOKEN_BUDGET`, `DEMO_MAX_CONCURRENT_RUNS` and retention. Assume about 30 judge films over 2 weeks, so the daily budget must not lock judges out. Pin the showcase so cleanup never deletes it (it's in `public/`; verify).
7. **Deploy & verify on Railway:**
   - Deploy the new build to the existing service. If you can't deploy, write exact owner steps in BLOCKERS.
   - **Run one full film on the hosted demo**, end-to-end, with the passcode from Railway variables (never print it).
   - Save the trace in `evidence/hosted-run-v2-<date>.json`.

**Acceptance:**
- A fresh browser reaches a finished film on the hosted URL using only what the Judge Access PDF provides.
- Closing the tab mid-run and reopening shows the run continuing.
- `/api/health` is all green on the hosted URL.
- The cron workflow is green.

### WP2 · P0 · One identity, no over-claims
*Criteria: Quality of the Idea, Technological Implementation (clarity).*

1. `package.json`: name `storyboard-studio-director`, a description matching the Devpost tagline, `repository.url` = this repo.
2. `src/app/layout.tsx` metadata:
   - English title and description = the product tagline.
   - Add an Open Graph image (a still from the best v2 film) and an `og:title`.
3. README restructure, top to bottom:
   1. One-line pitch.
   2. A 10–15 s GIF of the best v2 film.
   3. Links: Live demo (with a passcode note), Showcase, Video, Eval, MIT.
   4. "How we use Token Factory + Nemotron" (keep the table).
   5. The measure-and-revise loop.
   6. Results (v1 → v2 table).
   7. Real-user pilot (WP5).
   8. Run it yourself.
   9. Then a clearly titled **"Prior work: the zero-key engine (before 2026-08-26) and what changed during the hackathon"**.
   - Move the 20-min "Đèn Ông Sao" section under that heading.
   - State plainly that it was produced by an external coding agent driving the engine's API, **not** by the Nemotron crew, and that its film-pipeline features were built during the submission period.
4. Make every mention of Tavily truthful (see WP3). That includes the architecture SVG, README, video and Devpost text.
5. Write `docs/hackathon/OWNER_GITHUB_ABOUT.md` with the exact About description, website URL and 6–10 topics for the owner to paste.

**Acceptance:** `grep -ri` finds no stale engine-era description in user-facing metadata. Every claim in the README links to evidence.

### WP3 · P0 · Tavily live (target: Best Use of Tavily, $3,000)
*Owner action first: create a Tavily key and set `TAVILY_API_KEY` locally and on Railway (B2).*

1. Make the Researcher earn its place:
   - It runs automatically when the story mentions real-world places, eras, festivals, costumes or architecture. Detection is done by Nano, with a cheap yes/no and a reason.
   - It produces **cited visual reference notes**.
   - Those notes measurably flow into the Cast & Set Bible (costume, props, palette, set details).
   - The UI shows a "Research" card with sources (title, domain, link) and the facts used.
   - Each shot that used a fact shows a small citation chip.
2. Keep the existing safety: snippets quoted as data, capped calls, and a per-run Tavily budget.
3. Run bench **config C (crew+tavily)** on the culture-heavy prompts (at least the 3 VI + 3 JA ones) and report it honestly in EVAL_RESULTS.
4. Do one hosted run with research on and save its trace as evidence.

**Acceptance:**
- A hosted run's trace shows real Tavily calls and citations.
- EVAL_RESULTS includes config C.
- Devpost "Did you use Tavily" can truthfully be **Yes**.
- If the key never arrives by M1, remove Tavily from every user-facing claim instead (keep the code, label it "optional, not enabled in the demo").

### WP4 · P1 · Film quality v2 (the Design criterion)
The visible output must look like a short film, not a slideshow of clip-art. Keep the "model writes code → engine renders and measures" architecture. That is the idea judges should remember.

1. **Characters that act:** extend `dollKit`/`buildCritter` (or bridge to the engine's existing `figure` + IK/`pose2d` + `walk` rig) so the Cast/Artist can specify per-shot **poses and actions**: stand, walk (with the existing no-slip walk rig), sit, wave, point, hold-object, hug, bow, look-left/right, kneel. Add **expressions**: neutral, smile, laugh, sad, surprised, sleepy. Add **eye blinks** and **mouth movement synced to dialogue** (the engine already has lip-sync data). Characters keep pixel-identical identity across poses: same symbol parts, posed.
2. **Shot variety & cinematography:**
   - The Director must plan varied coverage: establishing wide, medium, close-up, over-the-shoulder, insert/detail, at least 2 distinct set areas or angles in a 6+ shot film, plus a time-of-day arc when the story implies one.
   - Add a measured **near-duplicate gate**: a perceptual hash or SSIM between consecutive shot paintings. Fail when two consecutive shots are too similar unless the plan marks the shot as an intentional repeat.
3. **Broken-frame gates** (measured, like D17):
   - "Readable set": not dominated by a few unexplained flat rectangles. Use a coverage/edge-density/shape-count heuristic and calibrate it on the v1 failures `tea-house` shots 3 and 8.
   - "Close-up framing": the subject's face fills the expected band, and no hard-edged block sits behind the head unless it's a planned set element.
   - "No empty frame".
   - Each failure returns a *measured* repair hint, as D17 does.
4. **A critic that sees:**
   - Re-probe `GET /v1/models` (save evidence). Pick the vision critic in this order:
     1. an NVIDIA open vision-language model if served (any Nemotron VL/Omni)
     2. otherwise another open VLM served on Token Factory, clearly labelled in the UI and trace ("vision critic: <model>; Nemotron crew: Ultra/Super/Nano")
     3. otherwise the current text critic
   - In vision mode, send the render **plus** the engine's measured checks.
   - A revision is still kept only if it scores higher (D11).
   - Add a **floor**: the final frame must score ≥ 7, or get one fresh redraw with a different approach. The run never blocks; report frames below floor.
   - **The eval judge must be a different model from the critic** (WP7).
5. **Voices that don't sound like a robot:**
   - Add a TTS provider interface: `espeak-ng` (fallback) → **Piper** neural voices (local, zero-key; the demo video already used Piper via `demo/video/voice.py`) for EN and VI at least.
   - Bake the needed voice models into the Docker image and keep the image reasonable (document the size).
   - For JA: find a local voice whose **licence allows public YouTube use**, and record the licence in DECISIONS. If none fits in time, the JA pilot uses owner-supplied WAV per line via the existing WAV path.
   - Optionally check whether Token Factory serves an NVIDIA open TTS model. If it does and the quality is better, use it (another NVIDIA model in the loop).
6. **Sound & finish:**
   - A soft score bed from the engine's own synth (no third-party music), ducked under dialogue, at broadcast loudness (the engine has a mix).
   - Gentle transitions.
   - Showcase films rendered at 1080p / 24 fps. The demo can keep its lower caps.
7. **New showcase:** 3 new films that show off v2 (acting, varied shots, research citations, neural voices). Use 3 languages: EN, VI, JA. The best one becomes the README GIF, OG image and video hook. Keep the v1 films under "v1" for comparison.

**Acceptance:**
- WP7 numbers improve over v1 crew on the same 10 prompts. Targets: judge mean **≥ 6.5** (from 5.49), crew wins on **≥ 8/10** prompts vs super-only, critic revision uplift **≥ +0.5** (independently judged, not self-score).
- Cost per finished minute stays **≤ $0.40**.
- No frame in the 3 new showcase films fails a gate.
- If a target is missed, report the real numbers. Don't tune on the eval prompts.

### WP5 · P1 · Series mode + a real-user pilot (the Impact criterion)
Real user: the owner's own Japanese YouTube channel **「ひだまり人生劇場」 (Hidamari)**. It publishes narrated stories (朗読) for senior viewers **daily**, hosted by a recurring character **Haru-san** in a tea room **茶房ひだまり**. A daily channel needs the *same host and set in every episode*. That's exactly what character-consistency-by-construction solves.

1. **Series mode:**
   - Save a run's Cast & Set Bible plus the accepted symbols as a reusable **Series** (`Series` model: name, language, style, bible, library defs, voice map).
   - New films can start "in series X". The Director then must reuse its cast and sets (host stays pixel-identical across episodes) and may add episode-specific guests or sets.
   - UI: "Save as series" after a run, and a "Series" picker on the new-film form.
   - Tests cover reuse and identity: hash of the host symbol across episodes.
2. **Pilot:**
   - Build the Hidamari series (host Haru-san, tea room set, warm `storybook` or `ink` style; the owner confirms the look).
   - Produce **3 episodes** (60–120 s each) from 3 Japanese stories the owner supplies or approves.
   - Log per episode: wall time, USD, number of owner edits, and what the owner had to fix.
   - The owner decides whether to publish. If published, record the URL and date only. **Never invent views or feedback.**
3. **Second audience (optional, cheap):** one Vietnamese explainer-style film for the owner's channel "Hàn Lâm Bình Dân" to show range.
4. Write `docs/hackathon/PILOT.md`: who the user is, the before/after workflow (how an episode was made before vs with the Director, the owner's own estimate in the owner's words), the numbers above, and the limitations.

**Acceptance:** 3 episode MP4s + traces in evidence, host identity provably identical across them, PILOT.md complete with only real data.

### WP6 · P1 · A product a judge enjoys in 60 seconds (Design)
1. Landing at `/` (after unlock):
   - A hero playing the best v2 film muted with captions.
   - Two buttons: **Make a film** / **Watch the showcase**.
   - The 3 sample stories.
   - A one-line "how it works".
2. Run view:
   - A big live preview of the latest accepted frame.
   - A filmstrip that fills in as shots land.
   - Critic before/after shown large when a revision wins.
   - The crew timeline (role, model, tokens, cost) collapsible but visible.
   - Plain-language status lines ("Ultra is planning 7 shots…").
3. Finished view:
   - A large player.
   - Downloads (MP4, package).
   - "Save as series".
   - Run stats (time, cost, models).
   - Research sources.
4. Light polish: readable type sizes at 1080p (the video is recorded from this), consistent spacing, no developer jargon above the fold, mobile-tolerable.
5. Keep VI/EN and add JA for the pilot surfaces.

**Acceptance:** a first-time user goes from landing to watching a film being made in **≤ 2 clicks**. Lighthouse accessibility ≥ 90 on landing and showcase.

### WP7 · P1 · Eval v2 (credible numbers)
1. Same 10 prompts and the same judge prompt as v1. Add the 3 Hidamari pilot prompts as a separate table (not mixed into the comparison).
2. Configs: `super-only v2`, `crew v2`, `crew v2 + tavily` (if WP3 is live). Reuse the v1 rows for "crew v1" (don't re-run v1).
3. **Two independent judges**, both different from the critic model. Use the v1 judge `gemma-3-27b-it` plus one other served VLM. Report both and their mean. Blind to config.
4. Report: judge means, paired wins/losses/ties, first-pass %, repairs/shot, **independently judged** critic uplift (judge the pre-revision vs post-revision frame), USD/min, wall time, gate failure counts.
5. Update `chart.png` and EVAL_RESULTS ("Reading the results (honest)" section included).

**Acceptance:** reproducible with `npm run director:bench`, raw data in `eval/`, and every README/Devpost number matches it.

### WP8 · P1 · Demo video v2 (≤ 2:55)
Reuse the `demo/video/` pipeline (narration.json → voice → srt → cut). **Record on the hosted demo.** If the sandbox cuts long streams, record locally and say so in STATUS. Make the UI zoomed so text is readable at 1080p.

| Time | On screen | Narration (gist) |
|---|---|---|
| 0:00–0:12 | **Hook:** best v2 film playing, with voices and acting. Overlay: "Typed story → this film. No image generator." | "This film was typed, not drawn…" |
| 0:12–0:25 | The user: Hidamari, a daily channel that needs the same host every day | Problem + who |
| 0:25–1:20 | Live hosted run, time-lapsed: story → Ultra plan → Super cast and frames → a gate catches a bad frame and the repair fixes it → vision critic before/after, big → research card with citations | Roles, tiers, the measure-and-revise loop |
| 1:20–1:45 | Finished film (second language) + downloads + "Save as series" → episode 2 with the same host | Consistency across episodes |
| 1:45–2:15 | Simplified animated diagram: Token Factory tiers, measured loop, Tavily | Why each tier; cost per minute |
| 2:15–2:35 | v1 → v2 eval chart, pilot numbers | Real results |
| 2:35–2:52 | End card: demo URL, showcase, repo, MIT, "Built with NVIDIA Nemotron on Nebius Token Factory (+ Tavily)" | Call to action |

- English narration (Piper neural, or the owner's own voice if he records one; ask) and burned-in English subtitles.
- No third-party music. The engine's own synth bed is fine.
- No passcode on screen.
- Output: `demo/video/out/director_demo_v2.mp4` + `.srt` + a thumbnail PNG (1280×720) + `demo/video/YOUTUBE.md` (title ≤ 100 chars, description with links and chapters, tags).
- The owner uploads it to YouTube.

**Acceptance:** duration < 2:55, 1080p, plays the hook within 1 s, every number on screen matches EVAL/PILOT.

### WP9 · P1 · Devpost package v2 (paste-ready)
Write `docs/hackathon/DEVPOST_SUBMISSION_V2.md` with final text for every field. The owner and Claude will paste them.
1. Tagline and full description (update the v1 text with v2: acting, vision critic, series mode, pilot, research, new numbers). Use the Devpost Markdown headings Inspiration / What it does / How we built it / Challenges / Accomplishments / What we learned / What's next.
2. Built-with tags (add `tavily` only if WP3 is live, plus `piper` and any new model).
3. "Existing project: how you significantly updated it": a concise, factual list with the commit range and diffstat regenerated at the end.
4. **The 9 feedback answers**, each 120–250 words, concrete, reproducible, drawn from `FEEDBACK_LOG.md` plus new findings. This competes for *Most Valuable Feedback*. Ratings go in as numbers with reasons. The questions are:
   1. Which model(s) did you use, and why that size or variant?
   2. How would you rate Nemotron's output quality for your use case (1–10)?
   3. Did you fine-tune, prompt-engineer or use Nemotron out of the box? What was your approach?
   4. How did Nemotron compare to other models you've used for similar tasks?
   5. Which Nebius platform capabilities were most valuable, and how?
   6. How likely are you to recommend running Nemotron on Nebius (1–10), and why?
   7. How does running Nemotron inference on Nebius compare to previous cloud or local environments (1–10)?
   8. What additional features would have made it more effective?
   9. What do you most hope to see from the Nemotron team next?
5. **Judge Access PDF** source (`docs/hackathon/JUDGE_ACCESS.md` → PDF via script):
   - Demo URL.
   - The passcode placeholder `{{DEMO_PASSCODE}}`. **Never fill it in the repo.** The owner fills it locally before export.
   - 4-step test path.
   - Sample stories.
   - Expected time.
   - What to look at (crew timeline, critic before/after, research).
   - Health URL.
   - Limits.
   - A contact.
   - Provide `scripts/judge-access-pdf.ts` that renders it with the passcode read from env at export time and writes to a git-ignored path.

### WP10 · P2 · Nebius Serverless (only with owner-provided Nebius AI Cloud access)
Run the eval bench (and optionally batch showcase rendering) as a **Nebius Serverless Job** using the Dockerfile image. Persist results back to the repo's `eval/`. Add a "Batch on Nebius Serverless" section to the README with the real job ID and logs as evidence. If access isn't granted by M2, skip it and leave it in "What's next".

---

## 3. Milestones (ICT)
| Milestone | Date | Must be done |
|---|---|---|
| M1 | **Mon 2026-10-12** | WP1, WP2, WP3 (or the Tavily removal fallback) merged + deployed + verified on the hosted URL |
| M2 | **Tue 2026-10-20** | WP4, WP5, WP6 merged and deployed; pilot episodes produced; WP7 bench done |
| M3 | **Fri 2026-10-23** | WP8 video rendered and handed to the owner; WP9 package complete |
| Freeze | **Tue 2026-10-27** | Only fixes after this. Devpost edits are done by the owner + Claude by 2026-10-29 |

If M2 slips, ship in this order: WP4 items 3 → 1 → 5 → 4 → 2, then WP5 series mode, then WP6. Never let the video or Devpost package (M3) slip.

---

## 4. Definition of done
- [ ] Hosted demo: a fresh browser reaches a finished film with only the Judge Access PDF; runs survive tab close; `/api/health` green; daily health cron green.
- [ ] Tavily is either live with a hosted trace + bench config C, or removed from every claim.
- [ ] v2 eval published with two independent judges; README/Devpost/video numbers match it.
- [ ] 3 new v2 showcase films (EN/VI/JA) at 1080p, neural voices, no gate failures.
- [ ] Series mode works; 3 Hidamari pilot episodes + PILOT.md with only real data.
- [ ] Video v2 < 2:55 + YOUTUBE.md + thumbnail.
- [ ] DEVPOST_SUBMISSION_V2.md (all fields, 9 long feedback answers) + Judge Access PDF tooling.
- [ ] README restructured, identity fixed, OWNER_GITHUB_ABOUT.md written.
- [ ] CI green; tests ≥ v1 count; STATUS/DECISIONS/BLOCKERS current; spend ledger within cap.
- [ ] Final hand-off report in `docs/hackathon/HANDOFF_V2.md`: what shipped, what didn't, the owner's exact remaining steps.

## 5. Owner actions (track in BLOCKERS.md)
| # | Action | Needed by |
|---|---|---|
| O1 | Create a Tavily API key and set `TAVILY_API_KEY` locally and on Railway | M1 |
| O2 | Confirm the remaining Token Factory credit and its expiry; top up if it could run out before 2026-12-15 | M1 |
| O3 | Check the Railway plan/billing keeps the service and volume up through 2026-12-15 | M1 |
| O4 | Approve the Hidamari series look; supply or approve 3 Japanese stories; decide whether to publish | M2 |
| O5 | (Optional) Nebius AI Cloud access for WP10 | M2 |
| O6 | Record his own narration (optional); upload video v2 to YouTube (public) | M3 |
| O7 | Fill the passcode in the Judge Access PDF locally; with Claude: upload the PDF, update the Devpost fields and video URL, set GitHub About, YouTube title/description | before 2026-10-29 |
