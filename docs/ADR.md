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

## ADR-012: Construct v2 — CSG thể tích, depth sort exact, shading layers, parts FK (12/07/2026)

**Quyết định:** vượt cả 4 giới hạn ADR-011 trong một phase, theo triết lý layer: quay về nguyên lý gốc của engine ("polygon soup 3D → danh sách path 2D tô ĐÚNG THỨ TỰ"), bóc thành các layer đơn tuyến, mỗi layer một module thuần, ghép duy nhất tại orchestrator:

```
L0 plane3      "cắt 1 đa giác lồi bằng 1 mặt phẳng" — kernel chung
L1 csg         L0 đệ quy thành BSP (csg.js MIT, viết tay thuần TS)
L2 depthOrder  L0 áp dụng LAZY khi sort gặp xung đột (Newell–Newell–Sancha)
L3 meshRepair  nghịch đảo của L0: weld + gộp mặt đồng phẳng
L4 shadow / faceGradient   mỗi hiệu ứng = hàm thuần "scene → thêm PathItems"
L5 partsExpand / partFigure / partWheel   spec → spec rewrite TRƯỚC compile
```

**L1 CSG:** thuật toán csg.js (Node build/invert/clipTo; subtract=~(~A∪B)) trên kernel plane3; eps TƯƠNG ĐỐI 1e-5·sceneRadius (eps tuyệt đối vỡ với toạ độ canvas nghìn đơn vị); weld first-seen + **insertTVertices** vá T-junction (csg.js issue #13 — grid cell phải THÍCH ỨNG kích thước scene, cell theo eps làm cạnh dài quét nghìn cell: 900ms → 17ms); mặt lõm/có lỗ tam giác hoá trước (ear clipping + bridge-cut Eberly — đỉnh bridge trùng toạ độ phải bỏ qua trong ear test kẻo deadlock); **chuỗi op phải compact (repair + re-triangulate) giữa các phép** — phân mảnh tích luỹ qua fold (xúc xắc 6 pip vượt 2000 mặt input nếu không); fill kế thừa per-face qua SharedTag (CSG đa màu), csg.fill override; fast-path AABB rời nhau.

**L2 depth sort exact (DEFAULT):** NNS chứ không phải visibility-BSP đầy đủ — với ≤5k mặt, NNS đơn giản hơn, deterministic không PRNG, và ZERO split khi cảnh sạch. Chốt thiết kế đắt giá: **khoá sort khởi đầu = đúng khoá painter** (depth centroid, solidIndex, faceIndex) → cảnh không xung đột cho output byte-identical painter; exact là strict extension. 5 phép thử leo thang (extent x/y, P-sau-plane-Q, Q-trước-plane-P, chồng lấn màn hình); bài học: **test giao-cắt-cạnh proper thất bại khi mọi giao điểm rơi đúng đầu mút** (2 hình chữ nhật cùng y-extent) → dùng SAT. Swap-once rồi mới cắt; budget maxDepthSplits 2000 → fallback painter + warning. Smooth solid chèn theo depth (xấp xỉ, ghi rõ). Cutout đổi find→filter (mặt có thể thành nhiều fragment cùng label).

**L4 shading layers:** bóng đổ KHÔNG cần ma trận — trượt đỉnh dọc hướng sáng s=(ground−y)/Ly rồi tái dùng chiếu camera + union path-bool; footprint mặt phẳng qua chiếu affine là CHÍNH ring đã map (không hull) → giữ lỗ (vòng đệm đổ bóng vành khuyên); khối LỒI dùng convex hull fast-path (4 figure: 1174→135ms). Bóng vẽ SAU solid "nền" (mesh trọn ≤ mặt phẳng bóng) TRƯỚC phần nổi — không thì mặt sàn đè mất bóng. Blur = feGaussianBlur opt-in (region -25%/150%, sRGB; SVG bytes deterministic, raster có thể lệch giữa VERSION librsvg — caveat). Gradient mặt: linearGradient userSpaceOnUse dọc trục sáng chiếu lên mặt — né hẳn giới hạn affine của gradientTransform; budget maxGradients 128.

**L5 parts:** groups = khung FK cha-con (world = M(parent)·SRT), solid gắn group qua worldMatrixById override — schema solid không đổi. Figure: 14 khớp, pose theo TÊN KHỚP độ (scalar = gập z; format LLM viết đúng nhất — mô hình Spine), A-pose neutral, tỷ lệ head-unit nội suy chibiness c=(8−headCount)/6 với RESCALE thân để tổng đúng height. Id sinh `partId:segment` — user không thể đặt id chứa ':' nên không thể đụng độ; refId cho phép csg/cutout trỏ nội bộ part.

**Giới hạn trung thực còn lại:** CSG là BSP epsilon-based — operand tiếp tuyến/đồng phẳng sát có thể cần nudge (hint nói rõ); exact quá 2000 split rơi về painter; smooth trong exact là xấp xỉ theo depth; long-shadow dùng sweep hull (mất lỗ — stylized); blur raster lệch theo version librsvg. Backward compat: mọi field mới additive; painter mode giữ nguyên semantics v1; exact default đổi thứ tự vẽ nội bộ nên snapshot/examples regen MỘT lần (quyết định user).

## ADR-013: Construct v3 — Softness layer (nguyên lý làm mềm vector) (14/07/2026)

**Bối cảnh & quyết định:** vector bản chất là mảng cứng — bóng vector là MỘT shape sắc cạnh, còn 3D thật chuyển êm sáng→tối. Mọi illustration vector "mềm" đều giả lập cùng một cách: xếp chồng shape cứng, phủi mép bằng gradient (rẻ) hoặc blur (đắt), để màu gánh phần nặng. v3 compile nguyên lý đó thành spec: agent khai `effects`/`gradients[]`/`atmosphere`/`finish`, engine sinh các lớp — và docs DẠY nguyên lý để agent phối lớp thành tác phẩm (yêu cầu gốc của user).

**One Boolean Rule:** mọi lớp sáng-tối per-solid sinh từ MỘT quy tắc trên silhouette màn hình S + hướng sáng màn hình L + R = ½ cạnh ngắn bbox: `formShadow = S − shift(S, 0.45R về nguồn)` (lưỡi liềm tối phía khuất) · `highlight = S ∩ shift(S, 0.5R)` (nửa sáng) · `rim = S − shift(S, width·R)` (viền ngược mỏng) · `coreAccent = (S − shift(to·R)) ∩ shift(from·R)` (dải tối nhất) · specular = đĩa dịch về nguồn ∩ S · glow = đĩa/bản-blur SAU LƯNG · contact = ellipse gradient trên ground. Kiểm chiều 1D: S=[0,10], sáng đi +x → shift về nguồn = −x: S−[−5,5]=[5,10] tối ✓, S∩=[0,5] sáng ✓. Mép mềm KHÔNG cần filter: fill lưỡi liềm bằng linearGradient userSpaceOnUse dọc L, stop-opacity tắt ở terminator (tái dùng kỹ thuật faceGradient). Silhouette: khối lồi + smooth = convex hull đỉnh chiếu; CSG/extrude = union mặt hướng camera (giữ lỗ, cull y hệt painterSort).

**4 chốt ngữ nghĩa:**
1. **Effect gắn theo solid** — decals vào entry CUỐI của solid trong thứ tự NNS cuối cùng, glow vào preItems entry ĐẦU. Vật bị NNS ép trước/sau solid vẫn che/bị che đúng; sai duy nhất khi XUYÊN NHAU (cùng lớp xấp xỉ smooth-in-exact đã chấp nhận ở ADR-012) → warning khi depthSplits>0 ∧ có effects.
2. **Contact = gradient ellipse, KHÔNG filter** (đúng tiên đề mềm-rẻ; giữ ngân sách filter thực dụng). v1 chỉ contact xuống ground — chưa solid-on-solid.
3. **Blur CHỈ qua `glow.mode:"blur"` + `shadow.blur`** — không có field blur tự do; maxFilters 6, vượt là error kèm hint dùng halo. Blur là công cụ đắt duy nhất; halo/contact/sương đều là gradient miễn phí.
4. **Back-compat tuyệt đối:** mọi default off → spec cũ byte-identical suốt S0–S5 (gate assert; regen duy nhất = file lamp MỚI). `finish` preset CHỈ điền solid chưa khai effects (Zod default xoá dấu vết nên `effects:{}` = opt-out per solid); preset không bao giờ đụng light/shadow; vượt budget bằng preset → degrade mềm theo thứ tự khai báo + warning (effects tay vẫn error cứng).

**Màu (kỷ luật nướng vào default):** bóng KHÔNG BAO GIỜ #000 — `softShadowColor` = lightness −25% + hue xoay 25° về lạnh 230° (xám thuần nhận hue lạnh + s tối thiểu 0.18); highlight ấm #fff1dd / rim lạnh #dcecff / contact tối lạnh #2c3548; multiply/screen tự tính trong TS (không dựa librsvg blend). `gradients[]` tác giả: angle ĐỘ cho linear (LLM không phải đoán hệ toạ độ), focus/radius cho radial; id vào namespace chung, url(#cg-…) bị chặn 2 chiều; ref lạ → WARNING không error (spec dựa defs ngoài của frame vẫn hợp lệ).

**Atmosphere:** depthFade = mix fill về màu trời + desaturate theo depth chuẩn hoá trên entries (t=0 gần nhất giữ nguyên màu; 1 lớp depth = no-op); gradient ENGINE (cg-*) fade stops tại chỗ — mỗi gradient cg đúng 1 entry tham chiếu; gradient TÁC GIẢ (dùng chung) + decals effect (overlay tương đối trên nền đã fade) giữ nguyên. Vignette phủ ĐÚNG canvas dưới mọi place nhờ invertAffine (place = translate·rotate·scale đều → luôn khả nghịch), radial userSpaceOnUse tâm canvas, path CUỐI CÙNG tuyệt đối. Kênh 2D `layer:"foreground"` vẽ TRÊN solid DƯỚI vignette (sương/haze).

**Giới hạn trung thực:** effect là overlay 2D per-solid — không occlusion nội bộ giữa crescents và vật xuyên khối; contact chỉ xuống ground phẳng; depth fade không áp cho decals (kể cả cutout decal trên mặt xa); blur raster có thể lệch giữa version librsvg (bytes SVG mới là hợp đồng determinism); hình quá dẹt theo trục sáng có thể cho crescent rỗng → skip + warning. Hero example: `construct-lamp` (đèn đường đêm) — quầng sáng LỚN cố tình làm bằng circle 2D + gradient tác giả (miễn phí) thay vì blur, blur duy nhất dành cho bóng đèn; bài học đắt nhất khi dựng: pose figure tối giản thắng pose phức tạp (tay chĩa về camera bị foreshortening xấu), và "sương thấy được trên nền tối phải SÁNG hơn nền".

## ADR-014: Construct v4, Motion (trục thời gian) (24/09/2026)

**Bối cảnh & quyết định:** engine dừng ở ảnh tĩnh, nên muốn tiến tới *phim* thì thiếu nguyên một chiều: thời gian. v4 thêm **motion spec = một shot**, gồm scene construct gốc + tracks keyframe + rig thủ tục, được lấy mẫu ở `fps`. **Mỗi frame là một lần compile construct đầy đủ**, nên mọi đảm bảo cũ (deterministic, qua sanitizer, CSG/FK/softness) tự động áp dụng cho chuyển động. Thời gian là **hàm thuần** `evaluate(spec, t) → ConstructSpec`, không có state giữa các frame: frame i luôn render lại giống hệt, và render song song hay giữa chừng đều đúng.

**Thiết kế LLM-ergonomic:**
- Target là **đường dẫn chấm theo id** (`parts.hero.pose.kneeL`, `solids.ball.at.1`), không phải chỉ số mảng. Agent viết đúng ngay lần đầu, lỗi có gợi ý "Did you mean" (Levenshtein).
- Thời gian tính bằng giây, góc tính bằng độ.
- `ease` thuộc về đoạn **đi tới** key (quy ước "incoming" của AE). Default `inOut` = nguyên lý slow-in/slow-out.
- `smooth` là Hermite với tiếp tuyến Catmull-Rom, nên camera đi qua nhiều key mà không khựng.
- Màu nội suy trong linear-light nên pha trộn không bị bẩn.
- Các chỗ được phép broadcast: scale số → vec3; pose scalar → `[0,0,z]`; pose joint vắng = 0; `camera.orbit.*` trên scene dùng preset thì tự hiện thực hoá orbit từ preset.
- Bảo mật: chỉ đi qua own-property, cấm `__proto__/constructor/prototype`, và scene được re-validate bằng `constructSpecSchema` mỗi frame. Track làm bán kính âm sẽ báo lỗi kèm thời điểm (`At t=0.5s …`).

**Thứ tự đánh giá cố định:** generators (`walk`, `shot`) → tracks (`set`/`add`) → dependents (`roll`, `follow`) → noise (`wiggle`). Nhờ vậy key tay của agent luôn thắng hoặc cộng lên chuyển động nền, và dependents đọc trạng thái *sau* tracks (bánh xe lăn theo quãng đường thật của xe).

**Walk không trượt chân (chốt đắt giá nhất):**
- Bản đầu vung hông hình sin, test đo được chân trụ trượt **49%** tốc độ thân. Nguyên nhân: foot offset `∝ sin` nên vận tốc biến thiên, đỉnh gấp π/2 lần tốc độ thân.
- Sửa theo đúng cách animator làm. Pha trụ chiếm 60% chu kỳ (duty 0.6, có pha hai chân cùng trụ). Trong pha trụ, **góc hông được giải bằng bisection** để mắt cá lùi *tuyến tính* từ +X về −X, đúng bằng quãng thân tiến. Gối trụ giữ cố định để tuyến tính chính xác.
- Pha lăng dùng cosine, gối gập cực đại lúc passing. Cổ chân bù để tổng góc chuỗi bằng 0, nên bàn chân phẳng.
- Độ cao hông tính **chính xác** = max tầm với của hai chân, nên chân thấp nhất vừa chạm đất (contact thấp, passing cao).
- Sải chân tự suy từ tốc độ ở nhịp ~2 bước/giây: `X = v·duty/cadence`.
- Kết quả: trượt < 3% (test chặn), đế chân trụ luôn ở y≈0.

**Chi phí & hợp đồng sync:**
- Memo theo nội dung scene (JSON): frame giống hệt (hold, "on twos", shot tĩnh) chỉ compile một lần; WebP gộp frame liên tiếp giống hệt thành một page với delay cộng dồn.
- Trần 240 frame/shot, 30s compile tổng. Renderer nhường event loop giữa các frame, nên vẫn không có job queue (đúng ADR-010).
- Shot 36 frame mất ~3s end-to-end.
- `holdFrames` quantize thời gian cho vật thể/nhân vật, nhưng camera/place vẫn "on ones", nên pan không bị giật (quy ước hoạt hình 2D).

**Agent "nhìn" chuyển động:** animated WebP thì agent không xem được, nên response mặc định trả **contact sheet PNG**: lưới N frame lấy mẫu đều, mỗi ô có thanh tiến độ thời gian (không dùng text, vì font lệch theo OS).

**Tích hợp storyboard:**
- Frame có `motionSpec` (JSON thô agent gửi, round-trip nguyên vẹn) + `clipDir/clipPath/clipFps/clipFrameCount/clipDuration` (migration additive).
- **Poster frame trở thành `artworkSvg`** của frame, nên watermark, grid, F01.png, duplicate, apply-edit đều chạy qua pipeline ảnh tĩnh cũ mà không cần nhánh riêng.
- PUT artwork tĩnh lên frame motion sẽ gỡ motion.
- `timeline.ts` là *một* nguồn timing cho storyboard.json, captions.srt và assemble.sh, nên phụ đề không bao giờ lệch hình.
- Đã kiểm chứng end-to-end bằng ffmpeg thật: 3 frame (still 1.5s + shot 3s + still 1.5s) ra film.mp4 dài 6.000s, 144 frame @24fps.

**Giới hạn trung thực:**
- Chưa có IK (bàn chân được *khớp tốc độ* chứ không *khoá* world-space). Rẽ góc polyline đổi hướng tức thời. Pose trung tính ngoài cửa sổ walk có ramp 0.35s nên hai đầu hơi trượt.
- Chưa có squash-stretch tự động (làm bằng track scale, xem motion-bounce).
- Chưa có audio/lip-sync.
- Effects vẫn là overlay per-solid, nên solid xuyên nhau trong lúc chuyển động có thể cho viền sai trong vài frame (warning).

**Bug phụ đã sửa:** `apply-edit` tạo lại frame không đổi nội dung mà không copy `artworkSvg` (tàn dư thời Gemini), khiến `/api/render` bỏ sót frame. Giờ nó giữ artwork và motion.

## ADR-015: glTF 2.0, cầu nối sang renderer 3D thật + lộ trình phim trung thực (24/09/2026)

**Quyết định:**
- Export construct scene/shot ra **glTF 2.0** (JSON + buffer nhúng base64) qua `POST /api/export/gltf` và `gltf/FNN.gltf` trong ZIP.
- Refactor: tách dựng mesh (primitive + CSG DAG) từ `compile.ts` sang `sceneMeshes.ts` để **một nguồn mesh** phục vụ cả SVG lẫn 3D. Mọi snapshot vẫn byte-identical.
- Mỗi solid (kể cả segment của part, như `pip:shinL`) là một node, với mesh **local** + TRS tách từ ma trận world. Animation vì thế chỉ là sampler TRS (không bake đỉnh), và FK/walk/tracks xuất trọn.
- CSG = mesh kết quả + placement của node csg. Operand chuyển động thì bake ở t=0 kèm warning.

**Chuẩn & kiểm chứng:**
- Y-up right-handed trùng với glTF, nên không cần đổi trục. `unitScale` mặc định 0.01 (figure 170 ≈ người 1.7 m).
- Vật liệu: baseColor sRGB→linear, hoặc `KHR_materials_unlit` cho look phẳng. Đèn là `KHR_lights_punctual` directional theo `spec.light`.
- Camera dựng từ nghịch đảo view `Rz·Rx·Ry(−az)` + offset `place.at`. Test chiếu điểm world bằng camera glTF ra **đúng pixel canvas** của renderer SVG (ortho chính xác; perspective ≤0.1px khi place ở tâm; lens-shift khi lệch tâm là xấp xỉ).
- Test chạy **Khronos glTF-Validator** (devDependency duy nhất thêm vào, chỉ dùng trong test) trên mọi example và shot walk: 0 error.
- Đã render thật bằng **Blender 4.0 Cycles headless** qua `scripts/blender_render.py`: 4s/frame ở 960×540 CPU.
- Bài học khi import vào Blender:
  - Importer chia intensity lux cho 683, nên sun quá tối. Script đặt thẳng năng lượng theo W/m².
  - Bản Ubuntu thiếu OpenImageDenoise, nên script tự tắt denoise.
  - Importer cần numpy.

**Giới hạn trung thực của glTF core:**
- Không animate được thông số lens (zoom/fov): xuất ở giá trị t=0, kèm warning gợi ý dolly camera trong tool 3D. `KHR_animation_pointer` là hướng đi sau.
- Geometry animate (track bán kính) bị bake ở t=0.
- Shape 2D và overlay softness chỉ có ở SVG.
- Chưa có skin/joint hierarchy: figure là các node rời mang TRS world. Muốn chỉnh rig trong Blender thì cần xuất `skins` (bước sau). *(Đã giải quyết ở ADR-016/N1: figure xuất thành Armature skinned.)*

**Lộ trình phim (vì sao glTF là bước đúng):**
- Vector engine render ~30ms/frame, nên 90 phút × 24fps = 129.600 frame ≈ 1–2 giờ CPU. **Điểm nghẽn là nội dung và tay nghề, không phải compute.**
- Con đường khả thi tới chất lượng chiếu rạp là 3D stylized render bằng Blender. *Flow* (Oscar Phim hoạt hình 2025) làm bằng Blender EEVEE, 0.5–10s/frame 4K trên một máy.
- Engine giữ vai trò **layout/previs/animation tất định do agent viết**, còn glTF chuyển sang lighting/render thật.
- Chi tiết, nguồn và các mốc tiếp theo nằm ở [FILM-ROADMAP.md](FILM-ROADMAP.md).

## ADR-016: Tầng phim N1–N5, từ rig tới DCP chiếu rạp (24/09/2026)

**Bối cảnh:** sau v4 (motion + glTF), khoảng cách tới một bộ phim chiếu được còn năm mắt xích: diễn xuất nhân vật, điều kiện cho AI video, âm thanh, dựng, và mastering. Nguyên tắc chung giữ nguyên: **tất định trước, AI sau**. Mỗi mắt xích là code thuần có test, kiểm chứng bằng **implementation tham chiếu của chính chuẩn đó**, không phải bằng test tự viết.

**N1: Rig, IK, mặt, skin**
- Figure có cây khớp tên cố định (`hips → spine → neck`, vai → khuỷu → cổ tay, hông → gối → cổ chân). `partFigure` trả luôn danh sách khớp `{name, parent, local, world}`, để glTF skin, OpenPose và IK dùng chung một nguồn.
- **IK 2 xương giải tích** (`motion/ik.ts`): định lý cos cho góc khớp giữa, `a = −asin(d_z)` và `c = atan2(d_x, −d_y)` cho khớp gốc. Chính xác tới 1e-6. Không dùng solver lặp (CCD/FABRIK) vì nghiệm giải tích tất định và rẻ. Bài học: test IK fail ban đầu vì target nằm ngoài tầm với, không phải lỗi solver; test giờ dùng helper `reachable()`.
- Mặt là `decalOf`: chi tiết bề mặt vẽ ngay sau solid cha, và bị cull khi cha quay lưng. Cách này chữa việc mắt bị silhouette smooth của đầu che mất.
- glTF skin: một mesh skinned mỗi figure, `JOINTS_0` u8, IBM column-major. Test tự viết mini evaluator skinning để so vị trí đỉnh với renderer SVG.

**N2: Control passes**
- Depth/segmentation/normal chạy **cùng pipeline compile**, chỉ thay fill (`CompileOptions.pass`). Hình học, thứ tự vẽ và camera vì thế trùng tuyệt đối với bản beauty.
- Depth là **ramp tuyến tính đúng theo ∇z trên mặt phẳng từng mặt**, không phải một màu phẳng mỗi mặt. Nền đất trước đây ra xám phẳng, giờ đúng gradient.
- OpenPose COCO-18 chiếu từ khớp FK: không ước lượng, là ground truth.

**N3: Âm thanh**
- WAV codec, resampler Lanczos và loudness **BS.1770-4 streaming** viết bằng TS thuần. Kết quả khớp ffmpeg `ebur128` (−16.1 LUFS cả hai).
- Mixer: ducking kiểu sidechain (gain làm mượt 80 ms xuống, 350 ms lên), limiter lookahead, rồi hai pass make-up để về đúng −16 LUFS.
- TTS local espeak-ng: spawn không qua shell, văn bản đi qua stdin.
- Lip-sync lấy RMS + zero-crossing ra viseme mở/rộng. Không có audio thì fallback theo âm tiết văn bản.

**N4: Dựng**
- Timeline **lượng tử theo frame 24 fps** là nguồn thời gian duy nhất cho storyboard.json, SRT, `assemble.sh`, EDL, OTIO và DCP. Trước đây cộng dồn giây thực làm OTIO lệch frame.
- Chuyển cảnh chồng lên shot trước, số frame chẵn, tối đa ½ shot ngắn hơn.
- OTIO kiểm bằng thư viện `opentimelineio` của ASWF. EDL kiểm bằng adapter `cmx_3600` (đọc lại đúng thời lượng).

**N5: Mastering DCP**
- **Canvas DCI là canvas logic**: `1.85:1` = 1998×1080, `2.39:1` = 2048×858. `renderTarget` trả đúng container ở 2K/4K, nên master không cần rescale. Vignette trước đây cố định 1920×1080 và để lại một dải trên canvas khác 16:9; giờ nó theo canvas thật (`CompileOptions.canvas`) mà snapshot cũ vẫn byte-identical.
- Màu: sRGB → tuyến tính → XYZ (ma trận D65, không chromatic adaptation, giống DCP-o-matic mặc định) → ×48/52.37 → γ 1/2.6 → 12-bit. Trắng ra Y′ = 3960. Round-trip qua J2K có sai số tối đa 1.6/255.
- **MXF viết bằng TS thuần** (`dcp/mxf.ts`), không dùng asdcplib, để không phải build C++ và để output tất định:
  - OP-Atom: header 16384 byte kèm KLV fill, body partition, essence, footer, index, RIP.
  - Index của picture là VBR (tách segment mỗi 4000 entry); của sound là CBR.
  - Writer stream: giữ chỗ header, ghi footer, rồi quay lại ghi header. Bộ nhớ O(1) theo độ dài phim.
  - Kiểm chứng bằng asdcplib (đã build từ source): `asdcp-info` đọc được SMPTE 429 JP2K/PCM, `asdcp-unwrap` trả lại từng codestream byte-giống-hệt, và header metadata khớp cấu trúc file tham chiếu do asdcplib tạo.
- J2K dùng `opj_compress -cinema2K/-cinema4K 24` (profile DCI, trần bitrate). Đây là việc duy nhất ta không tự viết: encoder EBCOT tự viết không đem lại gì ngoài rủi ro.
- CPL/PKL/ASSETMAP validate bằng XSD SMPTE 429-7/8/9. ClairMeta: 78 check, 0 warning, 0 info. Tên ISDCF 9.6 đủ 12 trường.
- UUID tất định theo (project, tiêu đề, container, độ phân giải, **ngày phát hành**):
  - Cùng `--date` thì DCP byte-giống-hệt (đã kiểm).
  - Master lại ngày khác thì UUID mới. Nếu tái dùng UUID cho nội dung khác, TMS ở rạp sẽ coi là tài sản đã ingest và bỏ qua; đây là lỗi thật cần tránh.
- Âm thanh đưa về mức rạp: đo `ebur128` bằng ffmpeg (stream), rồi gain tĩnh về −24 LUFS với trần −1 dBTP. Rạp hiệu chuẩn 85 dBC/kênh, nên mix web −16 LUFS phát nguyên sẽ to hơn ~8 dB.
- Mastering là **CLI**, không phải route: chạy ~4 frame/s trên 4 lõi ở 2K, tức một phim 90 phút mất ~9 giờ. Làm thành route sẽ phá hợp đồng render đồng bộ.

**Giới hạn trung thực:**
- Không mã hoá/KDM: đủ cho festival và phát hành độc lập, chưa đủ cho phát hành thương mại có bảo vệ nội dung.
- Một reel.
- Stereo nằm ở L/R của 5.1, không upmix. Một mix 5.1 thật vẫn là việc của phòng dub.
- Chưa có track phụ đề SMPTE 428-7 trong DCP.
- Chưa có metadata CPL ST 429-16 và MCA label (ClairMeta không đòi; một số server mới hiển thị "channel config unknown").
- Và giới hạn lớn nhất không nằm ở kỹ thuật: DCP hợp lệ chỉ là cái hộp đựng. **Chất lượng phim vẫn là nội dung, diễn xuất và tay nghề.** Engine lo phần tất định (layout, timing, chuyển động, đóng gói); phần nhìn đẹp như rạp đi qua glTF → Blender, hoặc qua control passes → AI video.
