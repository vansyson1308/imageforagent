# Architecture Decision Records

Các quyết định nằm ngoài/chi tiết hoá blueprint gốc ([blueprint-storyboard-generator.md](../blueprint-storyboard-generator.md)). Blueprint mục 8 yêu cầu "Ask first" cho schema/dependency/API contract — tất cả mục dưới đây đã được duyệt trong plan build MVP (02/07/2026).

## ADR-001: Next.js 16 + Prisma 7 (thay vì Next 14 như blueprint gợi ý)

Blueprint ghi "Next.js 14+"; scaffold dùng bản mới nhất (Next 16, React 19, Tailwind v4, Prisma 7).
Hệ quả: route handler `params` là Promise (`await ctx.params`); design tokens trong `globals.css @theme`; Prisma 7 dùng generator `prisma-client` (output `src/generated/prisma`) + driver adapter `@prisma/adapter-better-sqlite3` (Rust-free client).

## ADR-002: Model ảnh — Gemini Interactions API

Xác minh docs chính thức 07/2026: model hiện hành là `gemini-3.1-flash-image` (Nano Banana 2, mặc định) và `gemini-3-pro-image` (premium). SDK `@google/genai` v2 gọi qua `ai.interactions.create({model, input, response_format})`; ảnh trả về ở `interaction.output_image.data` (base64). `image_size` nhận `"1K"|"2K"` (chữ K hoa), `aspect_ratio` hỗ trợ đủ 4 ratio của blueprint.
**Seed không được API hỗ trợ** → cột `Frame.seed` giữ nullable, không dùng; tính nhất quán dựa hoàn toàn vào reference images + CHARACTER LOCK prompt.

**Phát hiện khi smoke test thật (02/07/2026):** `response_format.mime_type` chỉ chấp nhận `image/jpeg` (gửi `image/png` → 400). Provider request JPEG rồi convert sang PNG bằng sharp để pipeline raw/watermark/export giữ nguyên PNG.

## ADR-003: Mở rộng Prisma schema so với blueprint mục 3

- `Project.wmPosition/wmScale/wmOpacity` — T6.3 yêu cầu settings watermark persist nhưng schema gốc không có chỗ chứa.
- Bảng `GenerationLog` (1 row/call provider) — cost guard T8.3 đếm theo `Frame.generatedAt` sẽ đếm thiếu regenerate; log riêng đếm đúng. Mock provider không tính vào quota.

## ADR-004: API contract bổ sung (không đổi contract gốc)

- `POST /api/storyboard/apply-edit` — AI edit trả proposal (T3.2), cần endpoint riêng để ghi bản đã duyệt.
- `POST /api/generate/:jobId/cancel` — nút Dừng (T5.6).
- `POST /api/watermark/reapply` — re-watermark không tốn API (T6.3).
- `GET /api/files/[...path]` — serve ảnh từ `storage/` (Next không serve ngoài `public/`); traversal guard trong `resolveStoragePath`.
- `GET /api/meta` — email service account + quota ngày + provider cho UI.
- `POST /api/maintenance/cleanup` — dọn file mồ côi (T8.4).
- `DELETE /api/projects/:id` — trang danh sách project cần xoá.
- Lỗi import khi project đã có frame: code `CONFIRM_REQUIRED` (409) — FE hiện confirm ghi đè (T1.3).

## ADR-005: Job status qua polling 2s (không SSE)

Contract mục 4 cho phép "Poll 2s hoặc SSE". Chọn polling: sống sót qua F5/HMR, đơn giản, đủ nhanh cho batch 5–30 frame. Job state ở `globalThis` (sống qua HMR); mọi transition persist DB. Server restart → job mất khỏi memory → status trả `lost:true`, FE hydrate lại; frame kẹt trạng thái trung gian được **boot sweep** đánh `failed` kèm hint regenerate (đơn giản hoá T5.3 — không resume job qua restart, vì regenerate chọn lọc đã rẻ).

## ADR-006: Đường dẫn file trong DB là relative POSIX

`Frame.imagePath`/`Asset.filePath` lưu dạng `{projectId}/frames/x.png` (separator `/`), join với `STORAGE_ROOT` lúc đọc. Tránh leak `\` của Windows vào URL và cho phép đổi STORAGE_ROOT không cần migrate data.

## ADR-007: archiver v8 named exports

`archiver@8` đổi API: `new ZipArchive(options)` thay vì `archiver("zip")`, chưa ship types → khai báo cục bộ `src/types/archiver.d.ts`. `@types/archiver` (cho v6) đã gỡ.

## ADR-008: AI edit giữ ảnh frame không đổi

`apply-edit` so sánh shotType+description theo index: frame giữ nguyên nội dung giữ nguyên ảnh đã generate; frame đổi nội dung reset về `draft`. Tránh mất công generate lại toàn bộ sau một lệnh AI chỉ sửa vài frame.

## ADR-009: Pivot agent-first — gỡ toàn bộ phase image-to-video (07/07/2026)

**Quyết định:** loại bỏ hoàn toàn Phase 9 (Veo clips + TTS voiceover + ffmpeg assembly) đã build và verify một phần. Sản phẩm định vị lại là **storyboard image engine cho AI agent** dùng qua REST API; phần video do agent tự dựng bằng Remotion từ gói export (ảnh + storyboard.json + captions.srt).

**Lý do:** chi phí video AI quá cao cho iteration (~$6–22/video 5–7 clip tuỳ tier), trong khi agent + Remotion dựng video từ ảnh tĩnh miễn phí và kiểm soát được 100%. Schema/migrations đã squash về 1 init sạch.

**Finding kỹ thuật đáng giữ (đã verify thực nghiệm, phòng khi build lại video):**
- Veo 3.1 qua Gemini API: `ai.models.generateVideos` + poll `operations.getVideosOperation` (10s), video chỉ lưu server 2 ngày → phải download ngay trong provider.
- **`referenceImages` KHÔNG kết hợp được với `image` (image-to-video) → 400 Unsupported** — refs chỉ cho text-to-video. Nhất quán nhân vật dựa vào first-frame image là đủ (đã verify on-model với Lite 4s).
- Veo Lite (`veo-3.1-lite-generate-preview`) câm hoàn toàn; 1080p bắt buộc durationSeconds=8.
- TTS hoạt động: model `gemini-3.1-flash-tts-preview` qua Interactions API (`speech_config:[{voice:"Kore"}]` + `response_format:{type:"audio"}`), trả PCM s16le 24kHz mono → tự bọc WAV.
- ffmpeg loudnorm trên audio im lặng tuyệt đối (anullsrc) sinh NaN làm aac encoder chết — chỉ loudnorm khi timeline có audio thật.
- Audio-mix hierarchy đã thiết kế và test được: VO 0dB > native −13dB (khi có VO) > BGM −6dB + sidechaincompress duck theo bus thoại → loudnorm I=-16:TP=-1.5.

## ADR-010: Zero-key pivot — artwork là SVG code do agent viết, render bằng sharp (07/07/2026)

**Quyết định:** gỡ hẳn Gemini (cả image generation lẫn text/AI-edit). Artwork từng frame do AI agent VIẾT dưới dạng SVG fragment; project có `artworkDefs` (thư viện `<defs>`: mascot `<symbol>`, gradient, props) — engine wrap + render deterministic bằng sharp/librsvg (dependency có sẵn). Mô hình Remotion: agent viết code, máy render, không key, không credit.

**Lý do:** (1) người dùng đích là agent — agent viết SVG giỏi và miễn phí, trong khi API ảnh tốn credit theo iteration; (2) nhất quán nhân vật trở thành thuộc tính kiến trúc (`<use href="#symbol">` → pixel-identical) thay vì xác suất prompt-engineering; (3) deterministic + round-trip được (storyboard.json chứa cả source SVG).

**Findings librsvg (verify thực nghiệm trên sharp 0.35.3/librsvg 2.62.3):** `<use>`+`<symbol>`+gradient/filter/clipPath/mask hoạt động pixel-perfect; width/height trên root cho đúng kích thước pixel (không cần density); input Buffer → external href (http/file/relative) bị lờ hoàn toàn, KHÔNG có network/file I/O; không có JS engine; XXE bị refuse, billion-laughs bị libxml2 chặn amplification; text render được nhưng font metrics lệch theo OS (docs khuyên dùng path); tốc độ 17–37ms/frame @1080p+ (cold start ~1–2s/process) → render sync, không cần job engine.

**Sanitizer (svgRenderer.ts) — luận cứ soundness:** reject-not-strip qua pattern list. Trong XML, kênh DUY NHẤT có thể tái cấu trúc markup từ text đã escape là internal DTD entity → **cấm `<!DOCTYPE` đóng toàn bộ lớp bypass "giấu tag qua mặt regex"**; match thừa (pattern trong comment/CDATA) chỉ gây từ chối oan — chấp nhận được với gate reject-only. Phòng thủ 3 lớp: sanitizer + librsvg không JS/không I/O + chỉ PNG được serve ra browser (SVG thô không bao giờ được serve). Bài học lúc implement: **allowed-forms phải nằm TRONG lookahead, không được consume trước lookahead** — `["']?` đứng ngoài bị regex backtracking lách qua (đã có regression test).

**Kênh phân phối lỗi cho agent:** render fail vẫn lưu `artworkSvg` + `status failed` + `errorMsg` (không mất WIP); mọi lỗi 422 `ARTWORK_INVALID` kèm hint sửa cụ thể.

## ADR-011: Construct engine — compiler dựng hình kỷ hà cho agent (11/07/2026)

**Quyết định:** thêm `POST /api/construct` — compiler STATELESS biến spec JSON (primitives 2D/3D + boolean + transform + camera + light) thành SVG fragment, theo đúng phương pháp dựng hình kỷ hà của hoạ sĩ vector: phân rã thành hình cơ bản → kết hợp (boolean) → biến đổi (affine/chiếu 3D/extrude) → đổ bóng. Fragment compile ra chảy qua pipeline sanitize→compose→render HIỆN CÓ, không đụng `svgRenderer.ts`; không lưu DB — SVG agent dán vào defs/frame vẫn là nguồn chân lý duy nhất (schema Prisma không đổi, storyboard.json round-trip không đổi).

**Kiến trúc:** module thuần `src/lib/services/construct/` (geometry2d · pathBoolean · pathParse · math3d · camera · geometry3d · painterSort · shading · svgEmitter · compile). Response kèm `stats` (faces/bytes/compileMs) + `warnings` + optional `previewPng` (data URI, render qua `renderArtwork` sẵn có ~30ms) — vòng lặp agent khép kín trong 1 round-trip, không cần đụng project/frame khi thử nghiệm.

**Dependency:** `path-bool@1.0.0` (pure ESM, MIT, dep duy nhất gl-matrix) — boolean TRỰC TIẾP trên bezier, không nắn polygon; thuật toán được Graphite editor port sang Rust dùng production. Đã loại: PathKit-WASM (đóng băng 2022 + Turbopack bundle .wasm trầy trật), paper.js (kéo jsdom, dormant), polygon-clipping/clipper2 (mất độ cong). **Toàn bộ toán 3D tự viết** (`math3d.ts` KHÔNG import gl-matrix): ma trận chiếu isometric chuẩn 35.264° + orbit tự do + perspective, extrude đa contour (phân loại outer/hole bằng containment parity, cap có lỗ = subpath evenodd — lỗ sắc nét vector), painter's sort centroid + tie-break deterministic, lambert lượng tử N tông (default direction [-0.3,-1.7,-1] tinh chỉnh cho cube iso ra đúng 3 tông tách bạch), solid smooth = silhouette convex-hull + gradient (trick zdog).

**Determinism là hợp đồng:** một `fmt()` formatter duy nhất, sort tie-break cố định, id gradient `cg-<solidId>` (prefix reserved, schema chặn agent dùng); test double-compile byte-identical + snapshot 3 spec mẫu; `compile.ts` chạy `sanitizeSvg` trên chính output như runtime assert — sanitizer drift tương lai fail CI thay vì fail agent.

**DoS bounds (compile sync trên event loop):** CONSTRUCT_LIMITS — 256 nodes, depth 16, 32 operand/phép, 64 segments/primitive, 5.000 faces, 2.500 segment input/boolean, output 400KB + 20K lệnh path, |coord|≤1e5, wall-clock guard 2s giữa các stage; rate limit `construct:compile` 20. Mọi lỗi 422 `CONSTRUCTION_INVALID` (mã riêng — phân biệt "spec sai" với "SVG unsafe") + hint nêu đúng knob (`Reduce "segments"…`, `Did you mean "hole"?` qua Levenshtein).

**Giới hạn trung thực (chấp nhận có chủ đích):**
- **KHÔNG có CSG 3D thể tích** (không trừ sphere khỏi box). Hai kênh boolean thực dụng thay thế: (a) boolean 2D trên profile TRƯỚC extrude → đục lỗ xuyên khối; (b) `cutouts` SAU chiếu → khoét mặt phẳng (subtract) hoặc dán decal clip theo mặt (overlay). Overlay lên solid smooth map vào silhouette; subtract lên smooth bị từ chối kèm hint.
- **Painter's algorithm** sort theo centroid — solid xuyên nhau/áp sát mặt ngang có thể sai thứ tự vùng giao (warning AABB-overlap trong response; không BSP v1). Bài học từ example house: mặt ngang kẹp giữa 2 mặt nghiêng là pattern dễ lỗi nhất — thiết kế bằng khối lồi tách rời (thân ngũ giác + 2 tấm mái box nghiêng) thay vì hộp + mái ôm.
- Sphere perspective = xấp xỉ circle theo scale tâm; smooth quantized banding trên mặt cong faceted là cố ý (dùng `shading:"smooth"` cho mượt).

**Examples test-enforced:** `examples/construct-{gear,house,rocket}.{json,svg}` sinh từ fixtures test (`REGEN_EXAMPLES=1`) — docs không bao giờ lệch code.
