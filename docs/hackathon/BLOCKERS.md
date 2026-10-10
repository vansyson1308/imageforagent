# Blockers

| # | Opened | Blocker | Impact | Owner action | Status |
|---|---|---|---|---|---|
| B1 | 2026-09-25 | `NEBIUS_API_KEY` was not set in this session. | — | Provided by the owner on 2026-09-25 in `.env.local` (git-ignored, mode 600, never printed). | **resolved** |
| B2 | 2026-09-25 | `TAVILY_API_KEY` is not set. | The researcher is tested against a fake server only. | (Optional) create the key and set it as an env var. | open |
| B3 | 2026-09-25 | The session egress policy blocked `api.tokenfactory.nebius.com`, `api.tavily.com` and Railway. | — | The owner switched the environment to full network access (2026-09-26). curl works directly; Node `fetch` needs `NODE_USE_ENV_PROXY=1` in this sandbox (D16). | **resolved** |
| B4 | 2026-09-25 (retried 2026-09-26: `send-pack: unexpected disconnect`) | Pushing git tags is refused by the session's git proxy. | The baseline tags exist only locally. | `git push origin pre-hackathon-baseline director-spec-baseline` | open |

## v2 (SPEC_V2, from 2026-10-09)

B2 is re-opened as **O1** below (it now decides the Tavily prize and whether WP3 ships "live" or as the fallback).

| # | Opened | Blocker | Impact | Owner action (click by click) | Needed by | Status |
|---|---|---|---|---|---|---|
| B2 / O1 | 2026-09-25 (re-opened 2026-10-09) | `TAVILY_API_KEY` on Railway. | — | **Resolved 2026-10-10:** the owner set the key on Railway (deploy b2215297 at commit 1d78517); `/api/health` shows tavily "key present". Next (agent): one hosted trace with real Tavily citations as evidence, research in the showcase re-shoots, bench config C on the culture-heavy prompts; README/Devpost wording switches to live only after that trace. | — | resolved |
| B5 / O2 | 2026-10-09 | Token Factory credit and expiry. | — | **Resolved 2026-10-10:** balance **$23.06** (AI Builder Program $25 + trial $3.12; September consumption $3.19, October so far $1.87); no expiry date shown; no top-up needed. | — | resolved |
| B6 / O3 | 2026-10-09 | Railway plan through 2026-12-15. | — | **Resolved 2026-10-10:** Hobby plan with a card on file; the compute hard limit was raised from $20 to $40 (email alert at $25), because AgentNet in the same workspace uses most of the budget. | — | resolved |
| B7 / O4 | 2026-10-09 | Hidamari pilot (WP5): the narration WAVs. | — | **Delivered 2026-10-10 (PR #23, merged):** 35 lines for the 4 packages, AivisSpeech / morioki, with QA. The owner is listening to 2 lines (tegami S02_L01, fūrin S08_L01) and will send a replacement WAV if one needs a retake. | — | resolved (retakes possible) |
| B8 / O5 | 2026-10-09 | (Optional) Nebius AI Cloud access for WP10 (Serverless batch). | WP10 is skipped and stays in "What's next". | Only if you want it: create a Nebius AI Cloud project, then tell me; I will write the exact service-account steps. | M2 | open (optional) |
| O7 | 2026-10-09 | GitHub repo About (description, website, topics, social preview), per OWNER_GITHUB_ABOUT.md. | First impression on GitHub. | **Partly done 2026-10-10:** description, website and topics are set. Remaining: the social preview image, after the re-shot hero film passes a by-eye check (the agent will post the image file). | M3 | partial |
| O8 | 2026-10-10 | The Japanese voice for published films. | — | **Resolved 2026-10-10:** (c), rendered with the owner's AivisSpeech pipeline (voice morioki, ACML 1.0). Credited in the end credits, README and Devpost. Piper JA stays only in the live demo for judges' own runs, labelled "non-commercial demo voice". | — | resolved |
| O9 | 2026-10-10 | Look approval: the Haru-san + kissaten still. | — | **Approved 2026-10-10** with four non-blocking polish notes (sit legs, hold sleeves, kissaten seating, veranda shrubs), all applied (D61). | — | resolved |
| B9 | 2026-10-10 | (Info, no action needed now) The agent set `DEMO_OPERATOR_PASSCODE` on Railway on 2026-10-10, after the owner approved B10 Option A, for automated hosted verification (D29). It also set `DEMO_FLOOR_REDRAW=off` (D37, owner rule). | None. | After judging ends (2026-12-15), or any time you want: Railway → studio → **Variables** → `DEMO_OPERATOR_PASSCODE` → ⋮ → **Delete** → **Deploy**. The judges' passcode is unaffected. | 2026-12-16 | info |
| B10 | 2026-10-09 | Live runs from this session: the operator passcode was blocked by the session's permission guard until the owner approved it. | — | **Resolved 2026-10-10:** owner replied "Approved: create the operator passcode on Railway". The agent created it (32 random characters), set it on Railway and keeps it only in the session scratchpad. Hosted unlock verified (200). See B9 for deleting it after judging. | — | resolved |
