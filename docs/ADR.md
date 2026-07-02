# Architecture Decision Records

Các quyết định nằm ngoài/chi tiết hoá blueprint gốc ([blueprint-storyboard-generator.md](../blueprint-storyboard-generator.md)). Blueprint mục 8 yêu cầu "Ask first" cho schema/dependency/API contract — tất cả mục dưới đây đã được duyệt trong plan build MVP (02/07/2026).

## ADR-001: Next.js 16 + Prisma 7 (thay vì Next 14 như blueprint gợi ý)

Blueprint ghi "Next.js 14+"; scaffold dùng bản mới nhất (Next 16, React 19, Tailwind v4, Prisma 7).
Hệ quả: route handler `params` là Promise (`await ctx.params`); design tokens trong `globals.css @theme`; Prisma 7 dùng generator `prisma-client` (output `src/generated/prisma`) + driver adapter `@prisma/adapter-better-sqlite3` (Rust-free client).

## ADR-002: Model ảnh — Gemini Interactions API

Xác minh docs chính thức 07/2026: model hiện hành là `gemini-3.1-flash-image` (Nano Banana 2, mặc định) và `gemini-3-pro-image` (premium). SDK `@google/genai` v2 gọi qua `ai.interactions.create({model, input, response_format})`; ảnh trả về ở `interaction.output_image.data` (base64). `image_size` nhận `"1K"|"2K"` (chữ K hoa), `aspect_ratio` hỗ trợ đủ 4 ratio của blueprint.
**Seed không được API hỗ trợ** → cột `Frame.seed` giữ nullable, không dùng; tính nhất quán dựa hoàn toàn vào reference images + CHARACTER LOCK prompt.

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
