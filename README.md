# Storyboard Studio

**An agent-first storyboard image engine.** Generate sequences of storyboard frames with a **100%-consistent mascot/character** using Google Gemini image models (Nano Banana), through a REST API designed to be driven by AI coding agents (Claude Code, Codex, …) — with a full web UI included for humans.

The intended pipeline: **an agent generates the storyboard frames here, then builds the final video itself with [Remotion](https://www.remotion.dev/)** (or any editor) from the exported images + machine-readable metadata. No expensive video-generation credits needed.

> 🇻🇳 Có phần **Tóm tắt tiếng Việt** ở cuối file.

---

## What it does

- **Script ingestion** — paste TSV (or read a Google Sheet) with `STT | Shot Type | Description` rows → editable storyboard table.
- **Character-locked image generation** — every frame is generated with a composed prompt (CHARACTER LOCK block + reference images + shot-type camera mapping + negative prompt) so the mascot stays on-model across all frames. Verified: same character across full batches with reference images *or* a text `characterDesc` alone.
- **AI bulk script editing** — one instruction rewrites the whole script (returns a reviewable diff, never overwrites silently).
- **Automatic watermarking** — your logo composited onto every output (position/scale/opacity configurable, re-apply without re-generating).
- **Slideshow preview** and **ZIP export**: `F01.png…FNN.png` + `storyboard.json` + `captions.srt` — everything an agent needs to assemble a video.
- **Cost guard** — daily generation limit, mock provider for free development.

## Quickstart

Requirements: Node.js 20+.

```bash
npm install                # runs prisma generate via postinstall
cp .env.example .env       # then put your GEMINI_API_KEY in .env
npx prisma migrate deploy  # create the SQLite database
npm run dev                # http://localhost:3000
```

No `GEMINI_API_KEY`? The app runs with a **mock image provider** (placeholder frames) — the entire workflow is testable for free.

Checks: `npm test` (unit tests, never call paid APIs) · `npm run build` · `npm run lint`.

## Environment variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Default `file:./prisma/dev.db` (SQLite) |
| `GEMINI_API_KEY` | for real generation | Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Empty → mock provider |
| `GEMINI_IMAGE_MODEL` | — | Default `gemini-3.1-flash-image` (Nano Banana 2) |
| `GEMINI_TEXT_MODEL` | — | Default `gemini-flash-latest` — used by AI script editing |
| `IMAGE_PROVIDER` | — | Force `mock` or `gemini`; empty = auto by key presence |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | for Sheets | One-line service-account JSON; see [Google Sheets](#google-sheets-optional) |
| `DAILY_GEN_LIMIT` | — | Cost guard: max real images/day (default 40) |
| `STORAGE_ROOT` | — | Image storage directory (default `./storage`) |

## Agent workflow (API recipes)

Everything the UI does is plain REST with a consistent error envelope `{"error":{"code","message","hint?"}}`. A complete agent run:

```bash
BASE=http://localhost:3000

# 1. Create a project
PID=$(curl -s -X POST $BASE/api/projects -H "Content-Type: application/json" \
  -d '{"name":"My spot"}' | jq -r .id)

# 2. Import the script (TSV, tab-separated; header row optional)
curl -s -X POST $BASE/api/script/import -H "Content-Type: application/json" -d @- <<EOF
{"projectId":"$PID","source":"tsv","tsvText":"STT\tShot Type\tDescription\n1\tStatic shot\tThe mascot waves hello\n2\tClose-up\tThe mascot winks"}
EOF

# 3. Describe the character (drives the CHARACTER LOCK prompt block)
curl -s -X PATCH $BASE/api/projects/$PID -H "Content-Type: application/json" \
  -d '{"characterDesc":"A cheerful orange fox mascot with a red neckerchief","aspectRatio":"16:9","resolution":"1K"}'

# 4. (Optional but recommended) upload reference images / watermark logo
curl -s -X POST $BASE/api/assets/upload -F "projectId=$PID" \
  -F "kind=mascot_ref" -F "files=@mascot.png"          # kinds: mascot_ref (≤3), style_ref (≤3), watermark (1)

# 5. Generate all frames (async job) and poll
JOB=$(curl -s -X POST $BASE/api/generate -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PID\"}" | jq -r .jobId)
curl -s $BASE/api/generate/$JOB/status        # poll every 2s until .done == true
# Regenerate selectively: pass {"frameIds":["..."]} to /api/generate

# 6. Export everything
curl -s "$BASE/api/export/zip?projectId=$PID" -o storyboard.zip
```

<details>
<summary><b>Full API reference</b></summary>

| Method | Endpoint | Body / Query | Purpose |
|---|---|---|---|
| POST | `/api/projects` | `{name}` | Create project |
| GET | `/api/projects` | — | List projects (+frame counts) |
| GET | `/api/projects/:id` | — | Hydrate project + frames + assets |
| PATCH | `/api/projects/:id` | partial project | Update name/ratio/resolution/characterDesc/watermark settings/playbackSpeed |
| DELETE | `/api/projects/:id` | — | Delete project + files |
| POST | `/api/projects/:id/duplicate` | — | Clone script + assets (for series) |
| POST | `/api/script/import` | `{projectId, source:"tsv"\|"sheet", tsvText?, sheetUrl?, confirmOverwrite?}` | Replace all frames; returns `409 CONFIRM_REQUIRED` if frames exist and no confirm flag |
| POST | `/api/frames` | `{projectId, afterIndex?}` | Insert a frame |
| PATCH | `/api/frames/:id` | `{shotType?, description?}` | Edit a frame |
| DELETE | `/api/frames/:id` | — | Delete + reindex |
| POST | `/api/frames/reorder` | `{projectId, frameId, targetIndex}` | Move a frame (server reindexes 1..N) |
| POST | `/api/storyboard/ai-edit` | `{projectId, instruction}` | AI rewrite → returns a **proposal** (not saved) |
| POST | `/api/storyboard/apply-edit` | `{projectId, frames:[{index,shotType,description}]}` | Persist an accepted proposal |
| POST | `/api/assets/upload` | multipart `projectId, kind, files[]` | Upload refs/watermark (PNG/JPEG/WebP ≤8MB, magic-byte verified) |
| DELETE | `/api/assets/:id` | — | Remove an asset |
| POST | `/api/generate` | `{projectId, frameIds?}` | Start generation job (`202 {jobId}`) |
| GET | `/api/generate/:jobId/status` | — | `{frames:[{id,index,status,imageUrl,errorMsg}], done}` |
| POST | `/api/generate/:jobId/cancel` | — | Stop job (pending frames → draft) |
| POST | `/api/watermark/reapply` | `{projectId}` | Re-composite watermark from raw images (no API cost) |
| GET | `/api/export/zip?projectId=` | — | ZIP: `FNN.png` + `storyboard.json` + `captions.srt` |
| GET | `/api/files/{path}` | — | Serve stored images (HTTP Range supported) |
| GET | `/api/meta` | — | `{serviceAccountEmail, imageProvider, dailyUsed, dailyLimit}` |
| POST | `/api/maintenance/cleanup` | — | Remove orphaned files from storage |

Frame `status` machine: `draft → pending → generating → watermarking → done | failed`.
Error codes: `SHEET_NOT_SHARED, SHEET_NOT_FOUND, SHEET_BAD_FORMAT, ASSET_LIMIT, ASSET_BAD_TYPE, ASSET_TOO_LARGE, PROVIDER_RATE_LIMIT, PROVIDER_SAFETY_BLOCK, DAILY_LIMIT, CONFIRM_REQUIRED, VALIDATION, NOT_FOUND, RATE_LIMITED, INTERNAL`.

</details>

## Video assembly hand-off (Remotion)

This engine deliberately stops at images — video generation APIs are expensive, and an agent with [Remotion](https://www.remotion.dev/) does the job for free. The ZIP export is designed as Remotion input:

```jsonc
// storyboard.json
{
  "project": { "name", "characterDesc", "aspectRatio", "resolution", "playbackSpeed" },
  "frames": [
    { "index": 1, "file": "F01.png", "shotType": "Static shot",
      "description": "The mascot waves hello", "status": "done", "generatedAt": "…" }
  ]
}
```

- `playbackSpeed` (seconds per frame) + `captions.srt` give you the intended timing.
- `shotType` tells the agent which camera move to fake per frame (Ken Burns zoom-in for `Slow zoom-in`, static hold for `Static shot`, horizontal pan for `Pan`, …).
- Images are already watermarked; raw un-watermarked versions stay on the server if you need them (`rawImagePath`).

## Google Sheets (optional)

The TSV paste path needs zero setup. To read scripts directly from a Google Sheet:

1. [Google Cloud Console](https://console.cloud.google.com) → create a project → enable **Google Sheets API**.
2. IAM & Admin → Service Accounts → Create (no roles needed) → Keys → Add key → JSON.
3. Flatten the JSON to one line into `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env`.
4. Share your sheet (Viewer) with the service-account email — the UI shows it with a copy button.

## Architecture

```
src/app/api/          REST route handlers (Zod-validated, rate-limited, error envelope)
src/components/       Web UI (Next.js App Router + Zustand)
src/lib/providers/    ImageProvider / TextProvider adapters (mock + Gemini) — swap models here
src/lib/services/     promptComposer (pure, snapshot-tested), jobRunner (in-process queue),
                      watermarker (sharp), tsvParser, sheetReader, costGuard, storage…
prisma/               Schema: Project / Frame / Asset / GenerationLog (SQLite)
storage/              Generated images (gitignored)
tests/                Vitest — pure units; NEVER calls paid APIs
```

Key design points:

- **`promptComposer` is a pure function** and the heart of character consistency: CHARACTER LOCK + ordered reference images (mascot before style) + shot-type camera mapping + NEGATIVE block. Snapshot-tested — prompt changes are deliberate.
- **Adapter pattern**: to add OpenAI gpt-image / Flux / anything, implement `ImageProvider` (`src/lib/providers/types.ts`) and register it in the factory. Nothing else changes.
- **Jobs are async & restart-safe**: in-process sequential queue, status persisted per transition, orphaned frames swept to `failed` on boot, per-frame retry with backoff (safety blocks never retried).
- **Raw images are never overwritten** — watermark settings can be re-applied at any time for free.

## Security notes

- No authentication — this is a **local / internal tool by design**. Do not deploy it to a public URL as-is: anyone could trigger paid generations or delete projects. Put it behind auth/a private network first.
- Uploads are magic-byte verified, renamed to UUIDs, and size/type limited. File serving is traversal-guarded. All inputs Zod-validated, mutating routes rate-limited. Production error responses don't leak internals.

## License

[MIT](LICENSE)

---

## 🇻🇳 Tóm tắt tiếng Việt

**Storyboard Studio** là công cụ tạo chuỗi ảnh storyboard với **nhân vật/mascot đồng nhất 100%** bằng Gemini (Nano Banana), thiết kế **cho AI agent dùng qua REST API** (Claude Code, Codex…) — kèm web UI đầy đủ cho người dùng.

**Quy trình:** dán kịch bản TSV (hoặc đọc Google Sheet) → bảng phân cảnh chỉnh sửa được → AI sửa kịch bản hàng loạt (có diff review) → upload ảnh mascot/style/logo → generate ảnh (job async, retry, cost guard) → watermark tự động → preview slideshow → **export ZIP** (ảnh + `storyboard.json` + `captions.srt`).

**Phần video:** engine này chủ đích dừng ở ảnh. Agent tự dựng video bằng **Remotion** từ gói export — `playbackSpeed` + SRT cho timing, `shotType` cho chuyển động camera từng cảnh (zoom/pan/tĩnh). Không tốn credit video AI.

**Chạy nhanh:** `npm install` → copy `.env.example` thành `.env` + điền `GEMINI_API_KEY` → `npx prisma migrate deploy` → `npm run dev`. Không có key vẫn chạy được với mock provider (miễn phí). Lưu ý: app không có đăng nhập — chỉ chạy local/nội bộ, không deploy công khai khi chưa thêm auth.
