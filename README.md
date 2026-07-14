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

## Geometric construction API (3D & complex vector art)

Hand-writing every `<path>` is the hard way. `POST /api/construct` gives you the **geometric construction method** human vector artists use: decompose into primitive shapes, **combine** (boolean union/difference/intersection/exclusion), **transform** (affine, 3D rotation, extrusion), then shade — compiled deterministically to SVG paths.

```bash
curl -s -X POST $BASE/api/construct -H "Content-Type: application/json" -d '{
  "spec": {
    "version": 1,
    "shapes": [
      {"id": "disc",  "type": "circle", "r": 220},
      {"id": "teeth", "type": "star", "points": 12, "rOuter": 262, "rInner": 214},
      {"id": "body",  "type": "boolean", "op": "union", "of": ["disc", "teeth"]},
      {"id": "hub",   "type": "circle", "r": 80},
      {"id": "gear",  "type": "boolean", "op": "difference", "of": ["body", "hub"], "fill": "#F4B23C"}
    ]
  },
  "preview": {"background": "#1a1a2e"}
}'
# → { "svg": "<g …>", "stats": {…}, "warnings": [], "previewPng": "data:image/png;base64,…" }
```

**Stateless by design**: nothing is stored — look at `previewPng`, iterate on the spec (~20ms/compile), then paste `svg` into `artworkDefs` (as part of a `<symbol>`) or a frame body. The SVG you save stays the single source of truth.

The spec vocabulary:

| Field | What you get |
|---|---|
| `shapes[]` | 2D: `rect(w,h,rx)` · `circle` · `ellipse` · `polygon` · `regularPolygon` · `star` · `line` · raw `path` · `boolean{op, of:[ids]}` — every shape takes `at/rotate/scale/skew/mirror/fill/stroke`. Booleans run on real bezier curves (via [path-bool](https://github.com/r-flash/PathBool.js)), and nest freely. |
| `solids[]` | 3D: `box` · `cylinder` · `cone(rTop)` · `sphere` · `prism` · `pyramid` · `extrude{profile: 2D-shape-id, depth}` · **`csg{op: union\|difference\|intersection, of:[solid-ids]}`** — real **volumetric CSG**: subtract a sphere from a box, drill a cylinder through anything, nest csg in csg. Cut faces inherit the cutter's color (a drilled hole shows red if the drill was red); `csg.fill` overrides. `shading`: `auto` · `faceted` · `smooth` (silhouette + gradient) · `none`. Per-solid `shadow:false` opts out of the shadow layer, `group` attaches to an FK frame. |
| `groups[]` | **Forward-kinematics frames**: `{id, parent?, at, rotate, scale}` — parent-before-child chains; any solid or part with `group` composes through the chain (rotate a parent, everything attached follows). |
| `parts[]` | **Parametric parts**: `figure` (articulated character — `height`, `headCount` 2-8 from realistic to chibi, `pose` by joint name in degrees: `{"elbowL": -90, "spine": [22,0,0]}`, A-pose neutral) · `wheel` (tire/hub/bore/spokes) · `tree` (blob/cone/layered) · `cloud` · `arrow`. Expand to solids named `partId:segment` — targetable by csg/cutouts. |
| `camera` | Presets `isometric` (true 35.264°) · `isometric-2:1` · `dimetric` · `top/front/side`, or **free orbit** `{azimuth, elevation, roll}`; `orthographic` or `perspective` (auto-fit distance); `zoom`. |
| `light` | One directional light; `mode`: `quantized` (`tones: 2-8`, default 3 — classic flat-design) · `smooth` · **`gradient`** (per-face smooth ramps along the light axis, `userSpaceOnUse`). |
| `shadow` | Ground-shadow layer: `style: silhouette` (exact projected outline — a washer casts a ring) · `blob` (soft radial ellipse) · `long` (stylized 45° sweep); `opacity`, `ground` plane height, optional `blur` (feGaussianBlur). Draws over floor solids, under everything above. |
| `depthSort` | **`exact`** (default): Newell–Newell–Sancha ordering — **interpenetrating solids render correctly** (faces split lazily only at true conflicts; clean scenes are byte-identical to painter). `painter`: legacy centroid sort, faster, may mis-order intersections. |
| `cutouts[]` | Post-projection booleans on a face: `subtract` (punch through a flat face) or `overlay` (decal clipped to the face — doors, windows, labels). |
| `gradients[]` | **Author gradients**: `linear{angle°}` / `radial{focus, radius}`, 2-16 stops with per-stop `opacity` — reference anywhere via `fill:"url(#id)"`, resolved inside the fragment (previews render them). |
| solid `effects` | **Softness layers per solid** (see The Softness Principle below): `formShadow` · `highlight` · `rim` · `coreAccent` · `specular` · `glow{halo\|blur}` · `contact` — each `true` for defaults or an object to tune. Parts accept the same `effects` as a passthrough. |
| `atmosphere` | Scene-wide softness: `depthFade{color,strength,desaturate}` (aerial perspective) + `vignette{color,strength,start,size}` (drawn last, canvas-exact under any `place`). |
| `finish` | One-touch preset: `flat` (default) · `soft` (formShadow+highlight+contact everywhere) · `premium` (+rim, +specular on smooth solids, +light vignette). Only fills solids without their own `effects`; `"effects": {}` opts out. |
| `place` | Position/scale/rotate the result on the logical canvas (default center 16:9). 2D shapes take `layer:"foreground"` to draw over the 3D scene. |

Coordinates: 2D is y-down (SVG convention); the 3D world is y-up right-handed, heights along y. Face labels for cutouts: `top/bottom/front(+z)/back/left/right(+x)` on box/extrude. Figure joints: `spine, neck, shoulderL/R, elbowL/R, wristL/R, hipL/R, kneeL/R, ankleL/R` (scalar pose value = z-axis bend; limbs hang along −y, so e.g. `elbowL: [-90,0,0]` points the forearm forward).

Working examples with their exact compiled output: [construct-gear.json](examples/construct-gear.json) (2D booleans) · [construct-house.json](examples/construct-house.json) (isometric + extrude + cutouts) · [construct-rocket.json](examples/construct-rocket.json) (free camera + smooth shading) · [construct-dice.json](examples/construct-dice.json) (volumetric CSG pips) · [construct-cart.json](examples/construct-cart.json) (**the works**: posed figure pushing a hollowed cart on wheel parts, with shadows) · [construct-shading.json](examples/construct-shading.json) (gradient mode + blob shadows) · [construct-lamp.json](examples/construct-lamp.json) (**softness hero**: night street lamp — glow, halos, rim light, depth fade, mist, vignette).

Every response includes `stats` (`facesGenerated/bytes/compileMs/csgOps/depthSplits/partsExpanded/effectPaths/filters`) so you can tune against the limits (256 nodes post-expansion, 5,000 faces, 8 csg ops × 2,000 input faces, 96 effect paths, 6 blur filters, 400KB output, 2s compile). Spec errors return `422 CONSTRUCTION_INVALID` with an actionable hint (`Did you mean "hole"?`). Honest limitations (ADR-011/012/013): CSG is epsilon-based BSP (near-tangent/coplanar operands may need a small nudge — the hint tells you); `exact` depth-sort falls back to painter order past 2,000 splits (warned); smooth solids in `exact` mode insert by depth (approximation); effects are per-solid screen overlays (interpenetrating solids get a warning). The reserved gradient id prefix is `cg-`.

### The Softness Principle (making vector art feel soft)

Vector art is **hard-edged by nature** — a vector shadow is just another shape with a crisp boundary, while real 3D shading falls off smoothly from light to dark. Every "soft" vector illustration you've admired fakes that softness the same way: **stack hard shapes, feather their edges with gradients (cheap) or blur (expensive), and let color do the heavy lifting**. This engine compiles the whole principle for you — and it's worth understanding, because composing the layers well is what turns primitive blocks into finished artwork.

**One boolean rule generates the core light layers.** Take a solid's screen silhouette `S`, the light's screen direction `L`, and `R` = half the short side of `S`'s bounding box. Shift a copy of `S` toward the light and combine:

| `effects.…` | Geometry | Reads as |
|---|---|---|
| `formShadow` | `S − shift(S, 0.45R)` | soft dark crescent on the side away from the light |
| `highlight` | `S ∩ shift(S, 0.5R)` | gentle bright wash on the lit side |
| `coreAccent` | `(S − shift(to·R)) ∩ shift(from·R)` | darkest band just inside the shadow edge |
| `specular` | disc at centroid − `L`·0.6R, ∩ `S` | glossy hot-spot (spheres, metal, glass) |
| `rim` | `S − shift(S, width·R)` | thin bright back-edge (backlight/moonlight) |
| `glow` | halo disc **behind** the solid, or blurred copy of `S` | the object emits light |
| `contact` | gradient ellipse on the ground under the solid | grounding/ambient occlusion — no filter |

The soft edge needs **no filter at all**: each crescent is filled with a `userSpaceOnUse` linear gradient running along `L` whose stop-opacity fades to 0 at the terminator. That's the whole trick.

**Color discipline is baked into the defaults.** Shadows are never `#000` — the default shadow tint is the base color with lightness −25% and hue rotated ~25° toward cool (230°, night blue). Highlights are warm (`#fff1dd`), rims cool (`#dcecff`), and every parameter (`color/opacity/shift/width`) is overridable per effect. Keep one shadow hue per scene; typical opacities: formShadow 10–20%, highlight 8–15%, contact ~45%.

**Respect the filter budget.** Blur is the *only* expensive tool — max **6 filters per fragment** (`shadow.blur` + `glow.mode:"blur"`). Everything else is gradients, which cost nothing: use `glow.mode:"halo"` for most glows, `contact` instead of blurred drop-shadows, and plain 2D circles filled with your own `gradients[]` for big ambient halos (see how the lamp example fakes its street-light pool of light).

**Declare your own gradients** in `gradients[]` and reference them anywhere with `fill:"url(#id)"` — `linear{angle}` (degrees: 0 = →, 90 = ↓) or `radial{focus, radius}`, 2–16 stops with per-stop opacity. They resolve inside the fragment, so `previewPng` shows them correctly.

**Scene-level softness** lives in `atmosphere`: `depthFade` pushes far solids toward a sky color (+desaturation) for aerial perspective; `vignette` darkens the frame corners (drawn last, always covering the canvas even under `place` rotation). Set `layer:"foreground"` on any 2D shape to draw it **over** the 3D scene (mist bands, haze) — foreground sits above solids, below the vignette.

**One-touch presets**: `finish:"soft"` gives every solid `formShadow + highlight + contact`; `finish:"premium"` adds `rim`, `specular` on smooth solids, and a light vignette. Presets only fill solids that don't declare `effects` themselves — set `"effects": {}` to opt a solid out, or declare your own to take control. Parts (`figure`/`wheel`/`tree`) accept an `effects` passthrough applied to every solid they generate.

Layer order per scene (what the engine draws, back to front): background 2D → ground solids → projected shadows → contact shadows → solids far-to-near (each: glow behind → faces → crescents on top) → foreground 2D → vignette.

The full showcase is [construct-lamp.json](examples/construct-lamp.json) — a night street-lamp scene: author gradients for the sky and two *free* halos, one blur spent on the bulb, a figure rim-lit in moonlight cool, trees receding through `depthFade`, a foreground mist band, and a vignette.

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
| **POST** | **`/api/construct`** | `{spec, preview?}` | **Compile a geometric-construction spec → SVG fragment** (+ optional PNG preview data-URI); stateless |
| **POST** | **`/api/render`** | `{projectId, frameIds?}` | **Re-render all frames with artwork** (after changing defs/ratio/resolution) |
| POST | `/api/assets/upload` | multipart `projectId, kind:"watermark", files[]` | Upload watermark logo (PNG/JPEG/WebP ≤8MB, magic-byte verified) |
| DELETE | `/api/assets/:id` | — | Remove watermark |
| POST | `/api/watermark/reapply` | `{projectId}` | Re-composite watermark on all rendered frames |
| GET | `/api/export/zip?projectId=` | — | ZIP: `FNN.png` + `storyboard.json` (incl. all SVG sources) + `captions.srt` |
| GET | `/api/files/{path}` | — | Serve rendered images (HTTP Range supported) |
| GET | `/api/meta` | — | `{serviceAccountEmail, construct:{version}}` (feature-detect) |
| POST | `/api/maintenance/cleanup` | — | Remove orphaned files |

Errors: `{"error":{"code","message","hint?"}}`. Codes: `ARTWORK_INVALID, CONSTRUCTION_INVALID, SHEET_NOT_SHARED, SHEET_NOT_FOUND, SHEET_BAD_FORMAT, ASSET_LIMIT, ASSET_BAD_TYPE, ASSET_TOO_LARGE, CONFIRM_REQUIRED, VALIDATION, NOT_FOUND, RATE_LIMITED, INTERNAL`.
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
src/lib/services/construct/       geometric-construction compiler (pure, deterministic):
                                  geometry2d · pathBoolean (path-bool) · pathParse ·
                                  math3d · camera · geometry3d · painterSort · shading ·
                                  plane3 · csg · depthOrder · meshRepair · shadow ·
                                  faceGradient · silhouette · effects · atmosphere ·
                                  finish · partsExpand/Figure/Wheel · emitScene ·
                                  svgEmitter · compile (orchestrator)
src/app/api/                      REST routes (Zod, rate-limited, error envelope)
src/components/                   Web UI (Next.js App Router + Zustand)
src/lib/services/                 tsvParser, sheetReader, watermarker (sharp), storage…
prisma/                           Project / Frame / Asset (SQLite, single migration)
tests/                            Vitest — sanitizer bypass-vector suite + construct
                                  golden/determinism/pixel-proof suites
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

**Dựng hình kỷ hà (`POST /api/construct`):** thay vì viết tay từng path, agent mô tả hình theo đúng phương pháp hoạ sĩ vector — phân rã thành **hình kỷ hà cơ bản** (tròn, chữ nhật, đa giác, khối hộp, trụ, cầu…), rồi **kết hợp** (boolean 2D trên bezier thật + **CSG thể tích 3D** — trừ cầu khỏi hộp, khoan trụ xuyên khối, lòng khoét lộ màu dao cắt) và **biến đổi** (affine, chiếu isometric hoặc camera tự do, extrude, **khung xương FK cha-con**). Ánh sáng nhiều tầng: 3 tông lượng tử / gradient mượt theo mặt / **bóng đổ xuống đất** (silhouette chính xác — vòng đệm đổ bóng có lỗ). **Depth sort exact mặc định** — khối xuyên nhau vẫn vẽ đúng. Có sẵn **part tham số hoá**: nhân vật khớp nối (pose theo tên khớp, tỷ lệ 2-8 đầu), bánh xe, cây, mây, mũi tên. Engine compile deterministic + trả preview ngay trong response (~20-400ms/lần). Xem 7 mẫu trong [examples/](examples/) — hero kỷ hà là **người đẩy xe hàng**, hero làm mềm là **đèn đường đêm**.

**Nguyên lý làm mềm (The Softness Principle):** vector bản chất là mảng cứng — bóng của vector chỉ là một shape sắc cạnh, trong khi 3D thật chuyển êm từ sáng sang tối. Muốn vector "mềm" thì phải GIẢ LẬP: **xếp chồng nhiều lớp shape cứng, phủi mép bằng gradient (rẻ) hoặc blur (đắt), và để màu sắc gánh phần nặng**. Engine compile sẵn nguyên lý này: một quy tắc boolean duy nhất trên silhouette sinh ra mọi lớp sáng-tối (`formShadow` lưỡi liềm tối phía khuất · `highlight` nửa sáng phía nguồn · `rim` viền ngược mỏng · `coreAccent` dải tối nhất · `specular` đốm gương · `glow` quầng phát sáng · `contact` bóng tiếp xúc) — mép mềm KHÔNG cần filter, chỉ là gradient tắt dần theo trục sáng. Kỷ luật màu nướng sẵn vào default: **bóng không bao giờ #000** (giảm sáng 25% + xoay hue 25° về lạnh), highlight ấm/bóng lạnh. Ngân sách blur 6 filter/fragment — dành cho nguồn sáng hero, còn lại dùng gradient. Kèm `gradients[]` tác giả tự khai, `atmosphere` (depth fade viễn cận + vignette), kênh 2D `layer:"foreground"` (sương/haze phủ trên khối 3D), và preset một chạm `finish: soft/premium`. Xem hero [construct-lamp.json](examples/construct-lamp.json).

**Chạy:** `npm install` → `cp .env.example .env` (không cần điền gì) → `npx prisma migrate deploy` → `npm run dev`. Xem [examples/](examples/) — bộ mẫu mascot "Pip" hoàn chỉnh. Lưu ý: app không có đăng nhập — chỉ dùng local/nội bộ.
