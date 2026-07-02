# Storyboard Studio

Hệ thống tạo chuỗi ảnh storyboard với **mascot nhất quán 100%** cho video animation.

Flow: nhập kịch bản (Google Sheet / dán TSV) → bảng phân cảnh chỉnh sửa được → AI sửa kịch bản hàng loạt → upload ảnh reference (mascot / style / watermark) → generate ảnh bằng Gemini (Nano Banana) → đóng watermark tự động → preview slideshow → xuất ZIP (ảnh + storyboard.json + captions.srt).

> Blueprint gốc: [blueprint-storyboard-generator.md](blueprint-storyboard-generator.md) · Quyết định kiến trúc: [docs/ADR.md](docs/ADR.md)

## Chạy dự án

```bash
npm install            # tự chạy prisma generate (postinstall)
npx prisma migrate dev # tạo DB SQLite lần đầu
npm run dev            # http://localhost:3000
```

Yêu cầu: Node.js 20+. Kiểm tra nhanh: `npm run build && npm test`.

## Biến môi trường (.env)

Copy `.env.example` → `.env` rồi điền:

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `DATABASE_URL` | ✅ | Mặc định `file:./prisma/dev.db`. Nếu thư mục Documents bị OneDrive sync gây lỗi `SQLITE_BUSY`, chuyển sang đường dẫn ngoài Documents, VD `file:C:/data/storyboard.db` |
| `GEMINI_API_KEY` | Cho ảnh thật | Lấy tại [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Bỏ trống → app chạy MockImageProvider (ảnh placeholder, không tốn tiền) |
| `GEMINI_IMAGE_MODEL` | — | Mặc định `gemini-3.1-flash-image` (Nano Banana 2). Đổi sang `gemini-3-pro-image` nếu cần chất lượng cao nhất (~$0.134/ảnh) |
| `GEMINI_TEXT_MODEL` | — | Mặc định `gemini-flash-latest` — dùng cho AI sửa kịch bản |
| `IMAGE_PROVIDER` | — | Ép `mock` hoặc `gemini`. Bỏ trống = tự chọn theo key |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Cho Google Sheet | JSON credentials một dòng — xem mục Google Sheets |
| `DAILY_GEN_LIMIT` | — | Cost guard: số ảnh thật tối đa/ngày (mặc định 40). Mock không tính |
| `STORAGE_ROOT` | — | Thư mục lưu ảnh (mặc định `./storage`) |

## Google Sheets (tùy chọn)

Đường dán TSV hoạt động không cần cấu hình gì. Để đọc trực tiếp từ link Google Sheet:

1. Vào [Google Cloud Console](https://console.cloud.google.com) → tạo project → bật **Google Sheets API**.
2. IAM & Admin → Service Accounts → **Create Service Account** (không cần role gì).
3. Tab Keys → Add Key → **JSON** → tải file về.
4. Nén JSON thành 1 dòng, dán vào `GOOGLE_SERVICE_ACCOUNT_JSON` trong `.env`.
5. Mở Google Sheet → **Share** → thêm email service account (dạng `xxx@yyy.iam.gserviceaccount.com`) quyền **Viewer**. Email này hiển thị sẵn trong UI tab "Link Google Sheet" kèm nút copy.

**Định dạng sheet chuẩn** (3 cột, dòng 1 header): `STT | Shot Type | Description`. Chấp nhận header tiếng Việt (`STT/Frame`, `Loại cảnh`, `Mô tả`); cột STT có thể bỏ trống — hệ thống tự đánh số.

## Đổi ImageProvider (thêm model ảnh khác)

Mọi call model ảnh đi qua interface `ImageProvider` ([src/lib/providers/types.ts](src/lib/providers/types.ts)):

```ts
interface ImageProvider {
  readonly name: string;
  generate(request: ImageRequest): Promise<GeneratedImage>;
}
```

Để thêm OpenAI gpt-image / Flux / Midjourney: tạo class mới implement interface này (tham khảo [geminiImageProvider.ts](src/lib/providers/geminiImageProvider.ts)), đăng ký trong factory [src/lib/providers/index.ts](src/lib/providers/index.ts). Không cần đụng UI hay JobRunner.

## Kiến trúc & thư mục

```
src/app/api/          Route handlers (REST, error envelope {error:{code,message,hint}})
src/components/       UI components (1 file/1 component)
src/lib/providers/    ImageProvider/TextProvider adapters (mock + gemini)
src/lib/services/     tsvParser, promptComposer (pure), jobRunner, watermarker, sheetReader…
src/lib/config/       shot-types.ts (map shot → camera instruction), limits.ts
prisma/               schema.prisma — nguồn chân lý data model
storage/              Ảnh gốc + output (gitignore)
tests/                Vitest unit tests (KHÔNG bao giờ gọi API ảnh thật)
scripts/              smoke-gemini.mjs — test API thật thủ công
```

Điểm thiết kế chính:

- **PromptComposer** ([promptComposer.ts](src/lib/services/promptComposer.ts)) là pure function quyết định tính nhất quán nhân vật: CHARACTER LOCK + reference images (mascot trước, style sau) + shot-type mapping + NEGATIVE block. Có snapshot test — sửa prompt phải cập nhật snapshot có chủ đích.
- **JobRunner** chạy in-process tuần tự, retry 2 lần (backoff 2s/8s), lỗi safety **không** retry. Server restart giữa chừng → frame kẹt được đánh dấu `failed` để regenerate chọn lọc.
- **Watermark** đóng sau khi generate; ảnh gốc (`*.raw.png`) luôn được giữ — đổi vị trí/scale/opacity rồi "Áp dụng lại" không tốn API.
- **Cost guard**: đếm mọi call provider thật trong ngày (bảng `GenerationLog`), chặn khi vượt `DAILY_GEN_LIMIT`.

## Smoke test Gemini thật

```bash
node scripts/smoke-gemini.mjs          # chỉ test text structured output (rẻ)
node scripts/smoke-gemini.mjs --image  # thêm test tạo 1 ảnh 16:9 1K
```

## Deploy

App là 1 Next.js instance duy nhất (single-user/nội bộ, chưa có auth):

- **VPS/máy nội bộ**: `npm run build && npm start`. Cần disk ghi được cho `storage/` + file SQLite.
- **Vercel**: không khuyến nghị ở MVP — SQLite + filesystem storage cần disk bền vững. Nếu muốn deploy serverless, đổi sang Postgres (sửa `datasource` trong schema.prisma) và S3/GCS cho storage trước.

## Vận hành

- **Dọn file mồ côi**: `curl -X POST http://localhost:3000/api/maintenance/cleanup`
- **Xem DB**: `npm run db:studio`
- **Log**: pino JSON ra stdout — set `LOG_LEVEL=debug` khi cần chi tiết.
