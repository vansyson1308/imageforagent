# Storyboard Studio

**A zero-API-key storyboard engine for AI agents** — the [Remotion](https://www.remotion.dev/) model applied to storyboard images. Your coding agent (Claude Code, Codex, …) **writes each frame's artwork as SVG code**; this engine sanitizes, renders (via [sharp](https://sharp.pixelplumbing.com/)/librsvg), watermarks, previews, and packages everything for video assembly. No image-generation API. No keys. No credits. Deterministic output.

**Character consistency is guaranteed by construction**: the agent defines the mascot ONCE as an SVG `<symbol>` in the project's artwork library — every frame reuses it with `<use href="#id">`, so the character is pixel-identical across the entire storyboard.

> 🇻🇳 Có phần **Tóm tắt tiếng Việt** ở cuối file.

## How it works

```
script (TSV / Google Sheet)          agent writes SVG          engine renders
┌─────────────────────────┐   ┌───────────────────────┐   ┌──────────────────┐
│ 1  Wide shot   Pip waves│ → │ defs: <symbol id=pip> │ → │ F01.png … FNN.png│ → Remotion
│ 2  Close-up    Pip smile│   │ frame: <use href=#pip>│   │ + storyboard.json│   (agent-built
│ 3  Wide shot   Night    │   │        + scenery      │   │ + captions.srt   │    video, $0)
└─────────────────────────┘   └───────────────────────┘   └──────────────────┘
```

Everything is a REST API (a full web UI is included for humans). The whole loop runs locally and free — the only optional external service is Google Sheets as a script source.

## Quickstart

Requires Node.js 20+.

```bash
npm install                # runs prisma generate via postinstall
cp .env.example .env       # defaults work out of the box — nothing to fill in
npx prisma migrate deploy  # create the SQLite database
npm run dev                # http://localhost:3000
```

Checks: `npm test` · `npm run build` · `npm run lint`.

## Agent workflow

A complete run, start to finish ([examples/](examples/) contains the working sample below):

```bash
BASE=http://localhost:3000

# 1. Project
PID=$(curl -s -X POST $BASE/api/projects -H "Content-Type: application/json" \
  -d '{"name":"My spot"}' | jq -r .id)

# 2. Script — TSV rows: STT | Shot Type | Description (header optional)
curl -s -X POST $BASE/api/script/import -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PID\",\"source\":\"tsv\",\"tsvText\":\"1\tWide shot\tPip waves hello\n2\tClose-up\tPip smiles\"}"

# 3. Artwork library — define your character ONCE (symbols, gradients, props)
jq -Rs "{artworkDefs: .}" examples/defs.svg | \
  curl -s -X PATCH $BASE/api/projects/$PID -H "Content-Type: application/json" -d @-

# 4. Per-frame artwork — scene body referencing the library (sync render, ~50ms)
jq -Rs "{svg: .}" examples/frame-01.svg | \
  curl -s -X PUT $BASE/api/frames/<frameId>/artwork -H "Content-Type: application/json" -d @-

# 5. Iterate — tweak the library, re-render every frame in one call
curl -s -X POST $BASE/api/render -H "Content-Type: application/json" -d "{\"projectId\":\"$PID\"}"

# 6. Export: F01.png…FNN.png + storyboard.json + captions.srt
curl -s "$BASE/api/export/zip?projectId=$PID" -o storyboard.zip
```

### The artwork contract

- **Logical canvas** (`viewBox` you draw in) is fixed per aspect ratio; output PNG long edge = 1024 (1K) / 2048 (2K):

  | Ratio | Logical canvas | 1K output | 2K output |
  |---|---|---|---|
  | 16:9 | 1920×1080 | 1024×576 | 2048×1152 |
  | 9:16 | 1080×1920 | 576×1024 | 1152×2048 |
  | 1:1 | 1080×1080 | 1024×1024 | 2048×2048 |
  | 4:5 | 1080×1350 | 819×1024 | 1638×2048 |

- Submit **SVG fragments** — the engine owns the `<svg>` wrapper. `artworkDefs` is the inner content of `<defs>`; frame SVG is the scene body.
- Allowed references: `href="#id"`, `fill="url(#id)"`, `data:image/png|jpeg|webp` data-URIs. Everything external (http, file, relative paths) is rejected with `422 ARTWORK_INVALID` + a hint. Also rejected: DOCTYPE/entities, `<script>`, `<foreignObject>`, event handlers, `@import`, `xml:base`, processing instructions, nested `<svg>` roots (even inside comments — the sanitizer rejects over-broadly by design), fragments over 500KB (UTF-8 bytes).
- **Prefer paths/shapes over `<text>`** — text renders but font metrics differ across operating systems; paths are pixel-identical everywhere.
- A failed render still saves your SVG (`status: "failed"` + `errorMsg`) — agent work is never lost.

<details>
<summary><b>Full API reference</b></summary>

| Method | Endpoint | Body / Query | Purpose |
|---|---|---|---|
| POST | `/api/projects` | `{name}` | Create project |
| GET | `/api/projects` | — | List projects (+frame counts) |
| GET | `/api/projects/:id` | — | Hydrate project + frames + assets |
| PATCH | `/api/projects/:id` | partial project | Update name/**artworkDefs**/aspectRatio/resolution/watermark settings/playbackSpeed |
| DELETE | `/api/projects/:id` | — | Delete project + files |
| POST | `/api/projects/:id/duplicate` | — | Clone script + artwork + assets (series workflow: one `/api/render` rebuilds all images) |
| POST | `/api/script/import` | `{projectId, source:"tsv"\|"sheet", tsvText?, sheetUrl?, confirmOverwrite?}` | Replace all frames; `409 CONFIRM_REQUIRED` if frames exist |
| POST | `/api/frames` | `{projectId, afterIndex?}` | Insert a frame |
| PATCH | `/api/frames/:id` | `{shotType?, description?}` | Edit script fields |
| **PUT** | **`/api/frames/:id/artwork`** | `{svg}` | **Set artwork + render synchronously** → returns frame with `imageUrl` |
| DELETE | `/api/frames/:id` | — | Delete + reindex |
| POST | `/api/frames/reorder` | `{projectId, frameId, targetIndex}` | Move a frame |
| POST | `/api/storyboard/apply-edit` | `{projectId, frames:[{index,shotType,description}]}` | Bulk-replace the whole script (agents editing scripts) |
| **POST** | **`/api/render`** | `{projectId, frameIds?}` | **Re-render all frames with artwork** (after changing defs/ratio/resolution) |
| POST | `/api/assets/upload` | multipart `projectId, kind:"watermark", files[]` | Upload watermark logo (PNG/JPEG/WebP ≤8MB, magic-byte verified) |
| DELETE | `/api/assets/:id` | — | Remove watermark |
| POST | `/api/watermark/reapply` | `{projectId}` | Re-composite watermark on all rendered frames |
| GET | `/api/export/zip?projectId=` | — | ZIP: `FNN.png` + `storyboard.json` (incl. all SVG sources) + `captions.srt` |
| GET | `/api/files/{path}` | — | Serve rendered images (HTTP Range supported) |
| GET | `/api/meta` | — | `{serviceAccountEmail}` (Google Sheets, optional) |
| POST | `/api/maintenance/cleanup` | — | Remove orphaned files |

Errors: `{"error":{"code","message","hint?"}}`. Codes: `ARTWORK_INVALID, SHEET_NOT_SHARED, SHEET_NOT_FOUND, SHEET_BAD_FORMAT, ASSET_LIMIT, ASSET_BAD_TYPE, ASSET_TOO_LARGE, CONFIRM_REQUIRED, VALIDATION, NOT_FOUND, RATE_LIMITED, INTERNAL`.
Frame `status`: `draft → done | failed`.

</details>

## Video assembly hand-off (Remotion)

The engine deliberately stops at images. The ZIP export is designed as Remotion input:

- `storyboard.json` — project settings, `playbackSpeed` (seconds/frame), per-frame `shotType` + `description` + **full SVG sources** (`artworkDefs` + `artworkSvg`, so artwork is versionable and re-renderable anywhere).
- `captions.srt` — subtitle timing derived from `playbackSpeed`.
- `shotType` tells the agent which camera move to synthesize per frame (Ken Burns zoom for `Slow zoom-in`, pan for `Pan`, static hold for `Static shot`, …).

## Environment (`.env`)

Everything is optional except the database path:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `file:./prisma/dev.db` | SQLite database |
| `STORAGE_ROOT` | `./storage` | Rendered image storage |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | — | Only for reading scripts from Google Sheets (one-line service-account JSON; share the sheet with the service-account email shown in the UI) |

## Architecture

```
src/lib/services/svgRenderer.ts   sanitize (reject-list) + compose + render — the core
src/lib/services/artworkService.ts render→watermark→persist pipeline per frame
src/app/api/                      REST routes (Zod, rate-limited, error envelope)
src/components/                   Web UI (Next.js App Router + Zustand)
src/lib/services/                 tsvParser, sheetReader, watermarker (sharp), storage…
prisma/                           Project / Frame / Asset (SQLite, single migration)
tests/                            Vitest — includes the sanitizer's bypass-vector suite
```

- **Rendering is synchronous and local** (~20–50ms per frame warm; first render per process ~1–2s while libvips initializes) — no job queues, no polling.
- **Sanitizer soundness** (see `docs/ADR.md` ADR-010): banning `<!DOCTYPE` closes XML's only markup-construction channel, making pattern screening sound; rejected-not-stripped; librsvg itself executes no scripts and performs no I/O for buffer input; only rendered PNGs are ever served to browsers.
- **Raw renders are kept** — watermark position/scale/opacity can be re-applied any time without re-rendering.

## Security notes

- No authentication — a **local/internal tool by design**. Don't deploy to a public URL as-is.
- User-supplied SVG is sanitized (strict reject-list) and only ever rasterized server-side; uploads are magic-byte verified and UUID-renamed; file serving is traversal-guarded; all inputs Zod-validated; mutating routes rate-limited.

## License

[MIT](LICENSE)

---

## 🇻🇳 Tóm tắt tiếng Việt

**Storyboard Studio** — engine tạo ảnh storyboard **không cần API key** theo mô hình Remotion: AI agent (Claude Code, Codex…) tự **viết artwork từng frame bằng code SVG**, engine sanitize + render (sharp/librsvg) + watermark + preview + đóng gói. Không tốn một xu credit, output deterministic.

**Nhất quán nhân vật tuyệt đối theo kiến trúc**: mascot định nghĩa MỘT LẦN là `<symbol>` trong thư viện defs của project, mọi frame `<use href="#id">` → giống hệt từng pixel. Đổi thiết kế một chỗ, gọi `POST /api/render` một phát — toàn bộ storyboard cập nhật.

**Quy trình agent:** tạo project → import kịch bản TSV/Google Sheet → `PATCH artworkDefs` (thư viện nhân vật) → `PUT /api/frames/:id/artwork` từng frame (render sync ~50ms) → chỉnh sửa & re-render → export ZIP (ảnh + storyboard.json chứa cả source SVG + captions.srt) → agent tự dựng video bằng **Remotion** với timing từ `playbackSpeed` và chuyển động camera từ `shotType`.

**Chạy:** `npm install` → `cp .env.example .env` (không cần điền gì) → `npx prisma migrate deploy` → `npm run dev`. Xem [examples/](examples/) — bộ mẫu mascot "Pip" hoàn chỉnh. Lưu ý: app không có đăng nhập — chỉ dùng local/nội bộ.
