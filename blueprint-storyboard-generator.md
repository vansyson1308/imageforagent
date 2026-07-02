# BLUEPRINT & SPEC: Hệ thống Storyboard Image Generator cho Video Animation

> **Phiên bản:** 1.0 — 02/07/2026
> **Mục đích tài liệu:** Đây là bản thiết kế (blueprint) + đặc tả (spec) chia theo từng giai đoạn (phase), để coding agent thực thi **từng phase một**. Mỗi phase có mục tiêu, task, acceptance criteria, cách verify và checkpoint. **Không code vượt phase. Không sang phase mới khi checkpoint chưa pass.**
> **Sản phẩm tham chiếu:** Giao diện kiểu "AuraVideo AI" — nhập kịch bản từ Google Sheet/Clipboard → bảng phân cảnh chỉnh sửa được → generate chuỗi ảnh storyboard có nhân vật mascot nhất quán → preview dạng slideshow → xuất ảnh làm nguyên liệu dựng video animation.

---

## 0. GIẢ ĐỊNH & CÂU HỎI MỞ (Assumptions — cần anh Sơn xác nhận trước khi agent code)

**Giả định đang dùng (nếu sai, sửa TẠI ĐÂY trước, mọi phase phía dưới kế thừa):**

1. **A1 — Ứng dụng web, single-user/nội bộ**, chưa cần auth đa người dùng ở MVP. Deploy 1 instance (Vercel/VPS).
2. **A2 — Tech stack:** Next.js 14+ (App Router) + TypeScript + TailwindCSS, backend dùng luôn Route Handlers của Next (không tách service riêng ở MVP). State client dùng Zustand.
3. **A3 — Model tạo ảnh:** Google **Gemini image model** (họ `gemini-*-image`, tên thương mại "Nano Banana") vì: (a) nhận **nhiều ảnh reference** trong 1 request → giữ nhân vật nhất quán tốt; (b) cùng hệ sinh thái Google với Google Sheets service account đã có. Thiết kế lớp `ImageProvider` dạng adapter để sau này thay bằng OpenAI gpt-image / Flux / Midjourney API mà không đụng code khác.
4. **A4 — Model sửa kịch bản (AI bulk edit):** LLM text (Gemini Flash hoặc Claude API) trả về **JSON có schema**, không trả văn bản tự do.
5. **A5 — Lưu trữ MVP:** SQLite + Prisma cho metadata; ảnh lưu filesystem `./storage/` (hoặc S3/GCS ở phase sau). Không cần Redis/queue service — hàng đợi generate chạy in-process, tuần tự có giới hạn concurrency.
6. **A6 — Google Sheet:** đọc qua **Service Account** (user share quyền Viewer cho email service account — đúng flow trong ảnh tham chiếu). Sheet có cấu trúc cột chuẩn (định nghĩa ở Phase 1).
7. **A7 — Ngôn ngữ UI:** tiếng Việt; prompt gửi model ảnh bằng tiếng Anh.
8. **A8 — Bản quyền:** hệ thống chỉ generate **nhân vật/mascot gốc do user cung cấp reference**, không nhắm tái tạo nhân vật có bản quyền của bên thứ ba (Doraemon, Disney...). Đưa cảnh báo này vào UI upload reference.

**Câu hỏi mở (Open Questions):**
- Q1: Có cần chức năng image-to-video (Veo/Kling/Runway) ngay trong hệ thống, hay chỉ dừng ở xuất ảnh? → Blueprint này để ở **Phase 9 (tùy chọn)**.
- Q2: Giới hạn chi phí/ngày cho API tạo ảnh là bao nhiêu? (Phase 8 có cost guard, cần con số cụ thể.)
- Q3: Resolution tối đa cần hỗ trợ? (Mặc định 1K, có tùy chọn 2K.)

---

## 1. MỤC TIÊU & TIÊU CHÍ THÀNH CÔNG

**Bài toán:** Sản xuất video animation cần chuỗi ảnh storyboard (5–30 frame/video) trong đó **mascot phải đồng nhất 100% về tạo hình** qua mọi frame, bối cảnh/phong cách đồng nhất, có watermark bản quyền, và quy trình phải đủ nhanh để làm nhiều video mỗi ngày.

**Người dùng:** Creator/marketer (chính là anh Sơn và team), làm việc theo quy trình: viết kịch bản trên Google Sheet → đổ vào hệ thống → tinh chỉnh → generate → duyệt bằng preview → tải ảnh về dựng video (CapCut/Premiere/AE hoặc image-to-video).

**Success criteria tổng thể (đo được):**
- SC1: Từ 1 link Google Sheet hợp lệ → có bảng phân cảnh hiển thị đúng 100% số dòng, ≤ 5 giây.
- SC2: Generate trọn bộ 7 frame 16:9/1K ≤ 3 phút (tuần tự), tỷ lệ frame lỗi phải retry ≤ 20%.
- SC3: Nhân vật mascot nhận diện được là "cùng một nhân vật" trên ≥ 95% frame (đánh giá thủ công theo checklist: màu lông, tỷ lệ đầu-thân, phụ kiện, logo ngực).
- SC4: Mọi ảnh xuất ra đều có watermark đúng vị trí/độ mờ đã cấu hình.
- SC5: Preview slideshow chạy mượt, chỉnh được tốc độ 0.5–5 s/frame.
- SC6: Regenerate 1 frame đơn lẻ không ảnh hưởng các frame khác.

---

## 2. KIẾN TRÚC HỆ THỐNG

```
┌────────────────────────────  Next.js App (1 deploy)  ───────────────────────────┐
│                                                                                  │
│  FRONTEND (React/App Router)                BACKEND (Route Handlers)             │
│  ┌──────────────────────────┐               ┌──────────────────────────────┐    │
│  │ 1. ScriptImportPanel      │──POST /api──▶│ /api/script/import            │    │
│  │    (Sheet link | TSV tab) │               │   ├─ SheetReader (Sheets API)│    │
│  │ 2. AssetPanel             │               │   └─ TsvParser               │    │
│  │    (mascot/style/logo up) │──POST /api──▶│ /api/assets/upload            │    │
│  │ 3. StoryboardTable        │◀──JSON──────│ /api/storyboard/* (CRUD)      │    │
│  │    (edit, copy, expand)   │               │ /api/storyboard/ai-edit ─────┼──▶ LLM API
│  │ 4. GenerationSettings     │──POST /api──▶│ /api/generate (job)           │    │
│  │    (ratio, resolution)    │               │   ├─ PromptComposer           │    │
│  │ 5. FrameGrid (kết quả)    │◀──SSE poll──│   ├─ JobRunner (queue in-proc)│──▶ Image API
│  │ 6. PreviewPlayer          │               │   ├─ ImageProvider (adapter) │    │
│  │    (slideshow, speed)     │               │   └─ Watermarker (sharp)     │    │
│  │ 7. ExportBar (zip, json)  │──GET /api──▶ │ /api/export/*                 │    │
│  └──────────────────────────┘               └──────────────────────────────┘    │
│                                                                                  │
│  DATA:  SQLite (Prisma) ── metadata │ ./storage/{projectId}/ ── ảnh gốc + output │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Nguyên tắc kiến trúc (agent phải tuân thủ):**
1. **Adapter pattern cho AI:** mọi call model ảnh đi qua interface `ImageProvider` (`generate(request): Promise<GeneratedImage>`); mọi call LLM text đi qua `TextProvider`. Không gọi SDK trực tiếp từ UI hay route handler.
2. **PromptComposer là module thuần (pure function),** có unit test, không side effect — đây là "trái tim" của tính nhất quán nhân vật.
3. **Job generate là async:** client tạo job → poll/SSE trạng thái từng frame (`pending → generating → watermarking → done | failed`). Không giữ HTTP request mở suốt quá trình generate.
4. **Mọi state kịch bản sống ở server (DB),** client chỉ là view + optimistic update. F5 không mất dữ liệu.
5. **Không hardcode secret** — tất cả qua `.env` (`GOOGLE_SERVICE_ACCOUNT_JSON`, `GEMINI_API_KEY`, ...).

---

## 3. DATA MODEL (Prisma schema — nguồn chân lý duy nhất)

```prisma
model Project {
  id            String   @id @default(cuid())
  name          String
  characterDesc String?          // Mô tả nhân vật/mascot (textarea trong UI)
  aspectRatio   String   @default("16:9")   // "16:9" | "9:16" | "1:1" | "4:5"
  resolution    String   @default("1K")     // "1K" | "2K"
  playbackSpeed Float    @default(1.5)      // giây/frame cho preview
  sheetUrl      String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  frames        Frame[]
  assets        Asset[]
}

model Frame {
  id           String  @id @default(cuid())
  projectId    String
  project      Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  index        Int                    // 1-based → hiển thị F01, F02...
  shotType     String                 // "Static shot", "Wide static shot", "Slow zoom-in"...
  description  String                 // mô tả cảnh (editable)
  status       String  @default("draft") // draft|pending|generating|watermarking|done|failed
  imagePath    String?                // ảnh đã watermark (hiển thị)
  rawImagePath String?                // ảnh gốc chưa watermark
  seed         Int?                   // nếu provider hỗ trợ
  errorMsg     String?
  generatedAt  DateTime?
  @@unique([projectId, index])
}

model Asset {
  id        String  @id @default(cuid())
  projectId String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  kind      String                    // "mascot_ref" (≤3) | "style_ref" (≤3) | "watermark" (=1)
  filePath  String
  mimeType  String
  order     Int     @default(0)
  createdAt DateTime @default(now())
}
```

**Ràng buộc nghiệp vụ (enforce ở service layer, có test):**
- `mascot_ref` tối đa 3, `style_ref` tối đa 3, `watermark` đúng 1 (upload mới thì thay thế).
- `Frame.index` liên tục 1..N; xoá/di chuyển frame phải reindex trong transaction.
- Ảnh upload: chỉ nhận `image/png|jpeg|webp`, ≤ 8MB/file, đổi tên theo `cuid` (không dùng tên gốc — tránh path traversal).

---

## 4. HỢP ĐỒNG API (API Contract — cố định từ Phase 1, thay đổi phải cập nhật spec trước)

| Method | Endpoint | Body/Query | Trả về | Ghi chú |
|---|---|---|---|---|
| POST | `/api/projects` | `{name}` | `Project` | Tạo project |
| GET | `/api/projects/:id` | — | `Project + frames + assets` | Hydrate toàn bộ UI |
| PATCH | `/api/projects/:id` | partial Project | `Project` | Đổi ratio/resolution/desc/speed |
| POST | `/api/script/import` | `{projectId, source:"sheet"\|"tsv", sheetUrl?, tsvText?}` | `{frames: Frame[]}` | Parse & thay toàn bộ frame |
| PATCH | `/api/frames/:id` | `{shotType?, description?}` | `Frame` | Sửa 1 ô |
| POST | `/api/frames` / DELETE `/api/frames/:id` / POST `/api/frames/reorder` | ... | ... | CRUD + kéo thả |
| POST | `/api/storyboard/ai-edit` | `{projectId, instruction}` | `{frames: Frame[]}` | LLM sửa toàn kịch bản, trả JSON schema |
| POST | `/api/assets/upload` | multipart `{projectId, kind, files[]}` | `Asset[]` | Validate số lượng/loại |
| DELETE | `/api/assets/:id` | — | `{ok}` | Hover-xoá từng ảnh ref |
| POST | `/api/generate` | `{projectId, frameIds?}` | `{jobId}` | frameIds rỗng = tất cả; có = regenerate chọn lọc |
| GET | `/api/generate/:jobId/status` | — | `{frames:[{id,status,imageUrl?,errorMsg?}], done}` | Poll 2s hoặc SSE |
| GET | `/api/export/zip?projectId=` | — | file zip | Ảnh final + `storyboard.json` |

**Chuẩn lỗi:** mọi lỗi trả `{error: {code, message, hint?}}`, HTTP status đúng ngữ nghĩa. Code enum: `SHEET_NOT_SHARED`, `SHEET_BAD_FORMAT`, `ASSET_LIMIT`, `PROVIDER_RATE_LIMIT`, `PROVIDER_SAFETY_BLOCK`, `INTERNAL`.

---

## 5. SPEC PROMPT ENGINEERING (module `PromptComposer` — quyết định 80% chất lượng)

**Đầu vào:** `characterDesc`, danh sách `mascot_ref` + `style_ref` (ảnh), `frame.shotType`, `frame.description`, `aspectRatio`, ngữ cảnh chuỗi (frame trước đó nếu cần continuity).

**Cấu trúc prompt gửi ImageProvider (thứ tự cố định):**

```
[ẢNH ĐÍNH KÈM]  mascot_ref[0..2]  →  style_ref[0..2]   (theo đúng thứ tự này)

[TEXT]
ROLE: Professional 2D animation storyboard artist.
CHARACTER LOCK: The main character MUST match the attached reference images exactly —
same proportions, colors, costume, accessories. {characterDesc}.
Do NOT redesign, restyle, or alter the character in any way.
STYLE: Match the attached style references: flat 2D cartoon, bold outlines,
warm izakaya lighting... (tự sinh từ style_ref + preset).
SCENE (Frame {index}/{total}): {frame.description}
SHOT TYPE: {frame.shotType} → dịch sang chỉ dẫn khung hình
   ("Wide static shot" → full scene, character occupies lower third...
    "Slow zoom-in" → tight close-up composition on subject...)
CONTINUITY: Same location, same lighting, same props as previous frames unless stated.
FORMAT: {aspectRatio}, no text/captions/subtitles inside the image, no watermark
(watermark do hệ thống đóng sau), clean composition for video use.
NEGATIVE: extra fingers, deformed anatomy, different character design,
photorealistic style, UI elements, borders.
```

**Quy tắc:**
- `PromptComposer` là pure function `compose(project, frame, assets): ImageRequest` — unit test bắt buộc với snapshot test.
- Bảng map `shotType → camera instruction` để trong 1 file config (`shot-types.ts`), dễ mở rộng.
- Nếu provider hỗ trợ seed: dùng chung 1 seed cho cả batch để tăng nhất quán; lưu seed vào `Frame.seed` phục vụ regenerate.
- Retry policy khi ảnh fail: tối đa 2 retry, backoff 2s/8s; lỗi safety-block thì KHÔNG retry, trả `PROVIDER_SAFETY_BLOCK` kèm hint sửa mô tả.

---

## 6. LỘ TRÌNH THEO PHASE (mỗi phase = 1 phiên làm việc của agent, có checkpoint chặn)

> **Cách dùng với coding agent:** mỗi lần chỉ nạp cho agent: (a) mục 0–5 của tài liệu này, (b) đúng 1 phase đang làm. Agent hoàn thành → chạy checkpoint → anh review → mới sang phase kế tiếp. Task nào ghi "Ask first" thì agent phải hỏi trước khi làm.

---

### PHASE 0 — Nền móng dự án (Foundation)

**Mục tiêu:** repo chạy được, cấu trúc chuẩn, DB sẵn sàng, theme dark giống ảnh tham chiếu.

**Tasks:**
- [ ] **T0.1** Khởi tạo Next.js 14 + TypeScript strict + Tailwind + Prisma(SQLite) + Zustand. ESLint + Prettier.
  - Acceptance: `npm run dev` chạy; `npm run build` sạch; `npx prisma migrate dev` tạo DB theo schema mục 3.
- [ ] **T0.2** Cấu trúc thư mục & convention:
  ```
  src/app/            → routes + route handlers (/api/...)
  src/components/     → UI components (1 file/1 component, PascalCase)
  src/lib/providers/  → ImageProvider, TextProvider (interface + mock)
  src/lib/services/   → sheetReader, tsvParser, promptComposer, jobRunner, watermarker
  src/lib/config/     → shot-types.ts, limits.ts
  prisma/             → schema.prisma
  storage/            → ảnh (gitignore)
  tests/              → vitest unit tests
  docs/               → tài liệu này + ADR
  ```
- [ ] **T0.3** Design tokens dark theme (nền #0d0d0f, card #17171c, accent tím→hồng gradient, radius 16px, font Quicksand/Nunito) + layout khung trang (header logo + 4 section rỗng: Import, Storyboard, Settings+Grid, Preview).
- [ ] **T0.4** `MockImageProvider` trả ảnh placeholder (canvas vẽ số frame) — để mọi phase sau dev không tốn tiền API.
  - Acceptance: gọi `provider.generate()` trả file PNG hợp lệ trong `storage/`.

**Verification:** `npm run build && npm test` pass; mở trang thấy layout 4 section.
**Checkpoint P0:** anh review cấu trúc thư mục + theme trước khi sang P1.

---

### PHASE 1 — Nạp kịch bản (Script Ingestion)

**Mục tiêu:** từ Google Sheet hoặc TSV paste → danh sách Frame trong DB, hiển thị được.

**Định dạng Sheet/TSV chuẩn (3 cột, dòng 1 là header):**
```
STT | Shot Type | Description
1   | Static shot with a dynamic bounce-in effect | The mascot pops in from the bottom...
2   | Wide static shot | A spotlight glows on a large ramen bowl...
```
Chấp nhận header tiếng Việt tương đương (`STT/Frame`, `Loại cảnh`, `Mô tả`); cột STT có thể bỏ trống → tự đánh số.

**Tasks:**
- [ ] **T1.1** `TsvParser` (pure): parse TSV/text → `ParsedFrame[]`; bỏ dòng trống; báo lỗi dòng thiếu Description kèm số dòng. Unit test ≥ 8 case (BOM, tab lẫn nhiều space, xuống dòng trong ô có quote...).
- [ ] **T1.2** `SheetReader`: nhận URL sheet → extract `spreadsheetId` (+ `gid` nếu có) → Google Sheets API `values.get` bằng service account → tái dùng `TsvParser` logic. Map lỗi 403 → `SHEET_NOT_SHARED` (message hiển thị email service account cần share — giống UI tham chiếu), 404 → `SHEET_NOT_FOUND`.
- [ ] **T1.3** Route `/api/script/import`: transaction xoá frame cũ + insert frame mới; nếu project đã có frame thì FE phải confirm trước khi ghi đè.
- [ ] **T1.4** UI `ScriptImportPanel`: 2 tab (Link Google Sheet / Dán từ Clipboard), ô hướng dẫn share quyền hiển thị email service account (đọc từ env, có nút copy), nút "Phân tích kịch bản" với trạng thái loading/lỗi.

**Verification:** import 1 sheet thật 7 dòng → DB có 7 frame đúng thứ tự; sheet chưa share → hiện đúng thông báo kèm email; paste TSV lỗi → chỉ ra dòng lỗi.
**Checkpoint P1:** demo cả 2 đường nhập với dữ liệu thật của anh (kịch bản Tantan Ramen là bộ test lý tưởng).

---

### PHASE 2 — Bảng phân cảnh (Storyboard Editor)

**Mục tiêu:** bảng F01–FNN chỉnh sửa trực tiếp như ảnh tham chiếu số 3.

**Tasks:**
- [ ] **T2.1** `StoryboardTable`: mỗi row = badge số frame (F01) + badge shotType (editable) + description (inline edit, click-to-edit, Enter lưu/Esc huỷ) + nút copy nội dung + chevron expand (xem full text + metadata).
- [ ] **T2.2** CRUD frame: thêm dòng (cuối hoặc chèn giữa), xoá dòng (confirm), kéo-thả đổi thứ tự (dnd-kit) → gọi `/api/frames/reorder`, reindex server-side.
- [ ] **T2.3** Autosave: debounce 800ms khi sửa, optimistic update + rollback nếu API lỗi; indicator "Đã lưu ✓ / Đang lưu…".

**Verification:** sửa – thêm – xoá – kéo thả rồi F5: dữ liệu giữ nguyên; index luôn liên tục.
**Checkpoint P2:** build sạch, test pass, thao tác bảng mượt trên cả mobile viewport.

---

### PHASE 3 — Trợ lý AI sửa kịch bản (AI Bulk Edit)

**Mục tiêu:** ô lệnh "Nhập yêu cầu nhờ AI sửa toàn bộ kịch bản (VD: đổi thời tiết thành ban đêm, chuyển sang trời mưa)".

**Tasks:**
- [ ] **T3.1** `TextProvider` interface + implementation (Gemini Flash hoặc Claude — Ask first: chọn provider nào). System prompt yêu cầu trả về JSON đúng schema `{frames:[{index, shotType, description}]}` — giữ nguyên số frame trừ khi lệnh yêu cầu thêm/bớt; giữ nguyên ngôn ngữ description gốc.
- [ ] **T3.2** Route `/api/storyboard/ai-edit`: gọi LLM → validate bằng Zod → **KHÔNG ghi đè ngay**: trả bản đề xuất.
- [ ] **T3.3** UI diff-review: hiển thị so sánh cũ/mới từng frame (highlight thay đổi), nút "Áp dụng tất cả" / "Áp dụng từng frame" / "Huỷ". Chỉ khi áp dụng mới ghi DB.
  - Lý do: tránh AI phá kịch bản đã chỉnh tay — đây là điểm hơn bản tham chiếu.

**Verification:** lệnh "đổi bối cảnh sang ban đêm trời mưa" → 7 frame đề xuất hợp lệ, số frame không đổi; JSON sai schema → retry 1 lần rồi báo lỗi thân thiện.
**Checkpoint P3:** anh test 5 lệnh thực tế (đổi thời tiết, đổi mascot pose, thêm frame CTA cuối, rút gọn mô tả, dịch sang tiếng Anh).

---

### PHASE 4 — Quản lý tài sản tham chiếu (Reference Assets)

**Mục tiêu:** upload mascot refs (≤3), style refs (≤3), watermark logo (1) + ô mô tả nhân vật — như ảnh tham chiếu số 2.

**Tasks:**
- [ ] **T4.1** Route `/api/assets/upload` (multipart): validate mime/size/số lượng theo `kind` (limits.ts); lưu `storage/{projectId}/assets/`; trả metadata. Watermark upload mới → thay thế cái cũ.
- [ ] **T4.2** UI `AssetPanel`: 3 khu upload, preview thumbnail, **hover hiện nút xoá từng ảnh** (đúng behavior bản tham chiếu), drag-and-drop file, đếm slot còn lại (2/3...).
- [ ] **T4.3** Textarea "Mô tả nhân vật/Mascot" → PATCH `project.characterDesc` (autosave debounce).
- [ ] **T4.4** Ghi chú bản quyền dưới khu upload mascot: chỉ dùng nhân vật gốc/được cấp quyền.

**Verification:** upload 4 ảnh mascot → ảnh thứ 4 bị chặn kèm thông báo; file 12MB bị chặn; xoá từng ảnh hoạt động; F5 giữ nguyên.
**Checkpoint P4:** review UX upload trên mobile.

---

### PHASE 5 — Máy sinh ảnh (Generation Engine) ⭐ phase rủi ro cao nhất — làm sớm ngay sau khi có dữ liệu

**Mục tiêu:** nút "Bắt đầu tạo Storyboard" → job generate tuần tự từng frame với nhân vật nhất quán; grid kết quả cập nhật real-time; regenerate từng frame.

**Tasks:**
- [ ] **T5.1** `PromptComposer` theo spec mục 5 + `shot-types.ts` (map ≥ 8 shot type phổ biến). Unit + snapshot test.
- [ ] **T5.2** `GeminiImageProvider` implement `ImageProvider`: gửi text + reference images, nhận ảnh, lưu `rawImagePath`. Xử lý lỗi phân loại (rate limit / safety / network) theo error codes mục 4. **Ask first:** xác nhận model ID và pricing hiện hành trước khi tích hợp (tra docs mới nhất, không dùng trí nhớ).
- [ ] **T5.3** `JobRunner` in-process: queue tuần tự (concurrency 1, config được), cập nhật `Frame.status` từng bước, retry theo policy mục 5, job tồn tại qua restart (đọc lại frame `pending` khi boot — Ask first nếu muốn đơn giản hoá).
- [ ] **T5.4** Route `/api/generate` + `/api/generate/:jobId/status`; hỗ trợ `frameIds` để regenerate chọn lọc.
- [ ] **T5.5** UI: `GenerationSettings` (dropdown Aspect Ratio 16:9/9:16/1:1/4:5, Resolution 1K/2K) + nút gradient "Bắt đầu tạo Storyboard" + `FrameGrid` (card: badge số, ảnh hoặc skeleton/spinner theo status, caption, nút "Tạo lại frame này", hiện lỗi + hint nếu failed). Poll status 2s.
- [ ] **T5.6** Nút "Dừng" job đang chạy (cancel các frame chưa bắt đầu).

**Verification:** với `MockImageProvider`: 7 frame chuyển trạng thái đúng thứ tự, grid cập nhật không cần F5; với provider thật: bộ Tantan Ramen 7 frame — chấm SC3 (checklist nhất quán nhân vật) đạt ≥ 95%, đo thời gian đạt SC2.
**Checkpoint P5 (quan trọng nhất):** anh duyệt chất lượng ảnh thật; nếu nhân vật drift → quay lại tinh chỉnh PromptComposer/thứ tự reference, KHÔNG sang P6.

---

### PHASE 6 — Watermark & hậu xử lý

**Mục tiêu:** đóng dấu logo bản quyền tự động lên mọi ảnh output.

**Tasks:**
- [ ] **T6.1** `Watermarker` (sharp): overlay logo lên `rawImagePath` → `imagePath`. Config: vị trí (4 góc + giữa, mặc định góc phải-dưới), scale theo % chiều rộng (mặc định 12%), opacity (mặc định 0.85), padding 24px. Giữ ảnh gốc để re-watermark không cần generate lại.
- [ ] **T6.2** Hook vào JobRunner: bước `watermarking` sau khi generate xong; nếu project không có watermark asset → skip, `imagePath = rawImagePath`.
- [ ] **T6.3** UI settings watermark (vị trí/scale/opacity) + nút "Áp dụng lại watermark toàn bộ" (chạy lại T6.1 trên ảnh gốc, không tốn API).

**Verification:** đổi vị trí watermark rồi áp dụng lại → toàn bộ ảnh cập nhật < 10s, không call provider; ảnh PNG trong suốt overlay đúng.
**Checkpoint P6:** soi pixel 3 aspect ratio khác nhau.

---

### PHASE 7 — Trình phát Preview (Live Preview Player)

**Mục tiêu:** player như ảnh tham chiếu số 1 — duyệt storyboard dạng slideshow trước khi tải về dựng video.

**Tasks:**
- [ ] **T7.1** `PreviewPlayer`: vùng chiếu ảnh (đúng aspect ratio project, letterbox nền đen), badge "LIVE PREVIEW", góc phải "Frame i/N", caption = description overlay đáy, progress bar tổng (click để seek), transition crossfade 200ms.
- [ ] **T7.2** Điều khiển: Prev / Play-Pause / Next, phím tắt (Space, ←/→), loop toggle; slider "Tốc độ phát" 0.5–5 s/frame hiển thị "{x}s/f", lưu vào `project.playbackSpeed`.
- [ ] **T7.3** Chỉ đưa vào playlist các frame `done`; frame chưa generate hiện placeholder mờ trong timeline; preload ảnh kế tiếp để không giật.

**Verification:** play 7 frame ở 1.5s/f đúng nhịp (sai số < 100ms/frame); đổi speed áp dụng ngay; seek chính xác.
**Checkpoint P7:** demo end-to-end lần đầu: Sheet → edit → generate → preview.

---

### PHASE 8 — Xuất file & Hardening (bàn giao dùng thật)

**Tasks:**
- [ ] **T8.1** Export ZIP: ảnh final đặt tên `F01.png…FNN.png` + `storyboard.json` (toàn bộ metadata: description, shotType, ratio, resolution — để nạp vào tool dựng video hoặc image-to-video sau này) + `captions.srt` (dùng playbackSpeed làm timing) — món quà cho khâu dựng.
- [ ] **T8.2** Lưu/mở nhiều project: trang danh sách project, duplicate project (tái dùng asset + kịch bản cho video series — rất hợp làm content hàng loạt).
- [ ] **T8.3** Cost guard: đếm số ảnh generate/ngày, chặn khi vượt ngưỡng env `DAILY_GEN_LIMIT`, hiển thị counter trên UI.
- [ ] **T8.4** Hardening: rate limit API route, validate mọi input bằng Zod, dọn file mồ côi trong storage, log có cấu trúc (pino), error boundary UI.
- [ ] **T8.5** README vận hành: env cần thiết, cách tạo service account + share sheet, cách deploy, cách đổi ImageProvider.

**Verification:** checklist security pass (không path traversal, không lộ key ra client, upload bị giới hạn); zip mở đúng trên Windows/Mac.
**Checkpoint P8 = Definition of Done toàn dự án:** chạy lại toàn bộ SC1–SC6 ở mục 1.

---

### PHASE 9 (TÙY CHỌN — chỉ làm khi anh xác nhận Q1) — Cầu nối Image-to-Video

- `VideoProvider` adapter (Veo/Kling/Runway): mỗi frame done + description → job image-to-video 3–5s; ghép playlist thành bản nháp video.
- Xuất "prompt pack" cho từng frame theo format của từng nền tảng video AI (nếu muốn thao tác thủ công).

---

## 7. RỦI RO & GIẢM THIỂU

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Nhân vật drift giữa các frame (rủi ro số 1) | Cao | Reference images bắt buộc trong mọi call; CHARACTER LOCK block trong prompt; seed cố định; checkpoint P5 chặn cứng; cho phép regenerate từng frame |
| Model ảnh đổi API/pricing | Trung | Adapter `ImageProvider`; agent phải tra docs mới nhất trước khi code T5.2 |
| Chi phí generate vượt kiểm soát | Trung | MockProvider cho dev; cost guard T8.3; regenerate chọn lọc thay vì chạy lại cả bộ |
| Safety filter chặn prompt vô hại | Trung | Phân loại lỗi riêng, hiển thị hint sửa mô tả, không auto-retry |
| Sheet cấu trúc lung tung | Thấp | Định dạng chuẩn + parser báo lỗi theo dòng + tab TSV làm đường dự phòng |
| Vi phạm bản quyền nhân vật | Trung | A8: cảnh báo UI; chỉ dùng mascot gốc của mình |

## 8. RANH GIỚI CHO AGENT (Boundaries)

- **Always:** chạy `npm run build && npm test` trước khi kết thúc mỗi task; tuân thủ API contract mục 4; cập nhật tài liệu này khi có quyết định mới (ADR ngắn trong `docs/`); commit theo từng task.
- **Ask first:** thêm dependency mới, đổi Prisma schema, đổi provider/model ID, đổi API contract, mọi thứ liên quan pricing.
- **Never:** commit secret/`.env`; gọi API tạo ảnh trong test tự động; xoá ảnh gốc `rawImagePath`; code vượt phase hiện tại.
