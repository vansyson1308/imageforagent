# Lộ trình: từ storyboard engine tới phim 3D chiếu rạp

> Bản nghiên cứu chiến lược (24/09/2026). Mục tiêu: agent AI tự làm được **phim hoạt hình 3D chiếu rạp**. Tài liệu này nói thẳng cái gì làm được ngay, cái gì cần thêm, và vì sao đi theo thứ tự này.

## 1. Câu trả lời thẳng

- **Repo này giờ tự giao được một DCP chiếu rạp** (N5, xem ADR-016). Chuỗi kịch bản → storyboard → shot có chuyển động và diễn xuất (IK, mặt, lip-sync) → thoại + nhạc + mix → dựng (chuyển cảnh, EDL/OTIO) → `npm run master:dcp` → DCP SMPTE chạy hoàn toàn tất định, bằng công cụ mã nguồn mở. Đã kiểm chứng bằng asdcplib, XSD SMPTE, ClairMeta (0 cảnh báo) và ffmpeg. Việc còn lại trước khi chiếu thật: test trên server rạp.
- **Một phim dài *đáng xem* do agent tự làm hoàn toàn thì chưa khả thi trong 2026**, kể cả với các studio dùng AI. Ví dụ *Critterz* (OpenAI hậu thuẫn) vẫn "human-led, AI-assisted", ngân sách < $30M.
- **Phim kiểu Avatar/Transformers (photoreal, VFX nặng) nằm ngoài tầm**: chúng cần render farm hàng chục nghìn core và đội ngũ hàng nghìn người.
- Mục tiêu khả thi và đáng giá là **phim 3D stylized kiểu *Flow***, phim đoạt Oscar Phim hoạt hình 2025. *Flow* làm bằng Blender EEVEE, khoảng $3.7M, render 0.5–10s/frame 4K trên một máy, không render farm.
- **Điểm nghẽn không phải compute** mà là diễn xuất, âm thanh, sự nhất quán qua hơn 1000 shot, và gu dựng phim. Tính nhanh: 90 phút × 24fps = 129.600 frame. Vector engine của repo mất ~30ms/frame, tức khoảng 1 giờ CPU cho cả phim.

## 2. Pipeline phim hoạt hình và vị trí của engine

| Công đoạn | Trạng thái trong repo | Ghi chú |
|---|---|---|
| Kịch bản → storyboard | ✅ có từ v1 | TSV/Google Sheet → frame; SVG hoặc construct spec |
| Animatic (board có timing) | ✅ **v4** | timeline thật, WebP từng shot, PreviewPlayer phát đúng thời lượng |
| Layout / previs (camera, blocking) | ✅ **v4** | construct 3D + rig `shot` + tracks camera + `follow` |
| Animation nhân vật | ✅ **N1** | FK figure, walk không trượt chân, **IK 2 xương giải tích** (bám cả vật chuyển động), **mặt + chớp mắt + lip-sync** theo giọng, easing, follow-through |
| Modeling / rigging chất lượng phim | ✅ cầu nối **N1** | glTF **skinned Armature** (joint thật, IBM) → Blender/Unreal chỉnh pose; blendshape vẫn là bước sau |
| Lighting / render | ✅ cầu nối **v4** | glTF → `scripts/blender_render.py` (Cycles/EEVEE), đã kiểm chứng |
| FX (nước, vải, tóc) | ⏭ Blender sim | ngoài phạm vi engine |
| Điều kiện cho AI video | ✅ **N2** | depth (ramp đúng từng mặt), segmentation, normal, OpenPose COCO-18 từ khớp FK |
| Compositing / dựng | ✅ **N4** | cảnh, 8 kiểu chuyển cảnh (xfade), timeline lượng tử 24 fps, **EDL CMX3600 + OTIO**, lint liền mạch |
| Âm thanh (thoại, nhạc, mix) | ✅ **N3** | thoại WAV/TTS local, ducking sidechain, −16 LUFS BS.1770-4, phụ đề khớp giọng. Foley/5.1 thật vẫn là việc phòng dub |
| Mastering DCP | ✅ **N5** | `npm run master:dcp`: X′Y′Z′ J2K + MXF SMPTE (muxer TS thuần) + CPL/PKL/ASSETMAP, 5.1 PCM ở −24 LUFS |

## 3. Kiến trúc đích: ba tầng, tất định trước, AI sau

```
Tầng 1  Agent viết layout TẤT ĐỊNH (repo này)
        kịch bản → shot → construct scene + motion (tracks, rigs, camera)
        → contact sheet để agent tự duyệt → animatic film.mp4
                 │ glTF 2.0 (mesh + camera + animation TRS)
Tầng 2  Render 3D thật (Blender headless: EEVEE stylized / Cycles path-traced)
        cùng camera, cùng timing → chuỗi PNG → film.mp4 / DCP
                 │ (tuỳ chọn) control passes: depth, OpenPose skeleton, segmentation
Tầng 3  Restyle bằng AI video (Wan VACE / LTX IC-LoRA / Runway Aleph) — có key, tuỳ chọn
```

Vì sao đi theo thứ tự này:

- **Tầng 1 giữ nhất quán tuyệt đối.** Nhân vật là cùng một mesh, camera là cùng một phép chiếu, timing là cùng một timeline. Đây đúng là thứ AI video còn yếu nhất: giữ nhân vật qua hàng nghìn shot.
- **Tầng 2 mang chất lượng hình ảnh**, và đã có tiền lệ đoạt Oscar.
- **Tầng 3 chỉ là lớp da tuỳ chọn.** Mô hình AI nhận khung xương, chiều sâu và chuyển động từ tầng 1, nên không phải "bịa" bố cục. Triết lý zero-key vẫn được giữ, vì tầng 3 không bắt buộc.

## 4. Đã có trong v4 (motion + glTF)

- [x] Motion spec = một shot: tracks keyframe, 10 easing + cubic-bezier + Catmull-Rom, nội suy màu linear-light.
- [x] Rig: `walk` (không trượt chân, test chặn < 3%), `shot` (dolly/orbit/crane/pan/tilt/shake, `auto` từ Shot Type EN/VI), `roll`, `follow`, `wiggle`.
- [x] `holdFrames` animate on twos; memo frame trùng; contact sheet để agent "nhìn" chuyển động.
- [x] Frame storyboard = shot (chuỗi PNG + WebP + poster); export có timeline, SRT khớp timeline, `assemble.sh` → film.mp4 (kiểm chứng bằng ffmpeg thật).
- [x] glTF 2.0 có animation: Khronos validator 0 lỗi, camera khớp pixel với SVG, đã render bằng Blender Cycles.

## 5. Các mốc N1–N5 (✅ đã xong, 24/09/2026; chi tiết và kiểm chứng ở ADR-016)

Giữ lại bản kế hoạch gốc bên dưới để đối chiếu. Mốc 6–7 vẫn là việc tiếp theo, cùng với: mã hoá/KDM, nhiều reel, track phụ đề SMPTE 428-7, metadata CPL ST 429-16 + MCA label, và test trên server rạp thật.

1. ✅ **Skinned glTF + rig chuẩn.** Xuất figure thành `skins` với cây joint thật (thay vì node rời mang TRS world), để animator chỉnh được trong Blender. Thêm blendshape/viseme cho miệng. Kèm IK 2 xương để khoá bàn chân (foot-lock), khi đó walk không còn trượt dù chỉ vài phần trăm.
2. ✅ **Control passes cho AI video (tuỳ chọn).** Cùng layout tất định, render thêm các chuỗi pass mà mô hình AI (Wan 2.2 VACE/Fun Control, LTX-2 IC-LoRA, Runway Aleph) nhận làm điều kiện:
   - depth (từ z_view sẵn có),
   - **OpenPose skeleton xuất thẳng từ khớp FK** (không cần ước lượng pose),
   - segmentation theo solid id.
3. ✅ **Âm thanh.**
   - Track thoại scratch với timing theo timeline, WAV 48kHz, mix trong `assemble.sh`.
   - Slot viseme cho lip-sync (nối với mốc 1).
   - Có thể dùng TTS local để giữ zero-key.
4. ✅ **Mô hình sequence/EDL.** Act → scene → shot; kiểm tra liên tục như luật 180°, match-cut, độ dài shot; chuyển cảnh (dissolve, fade) trong assemble. Giúp agent dựng phim dài mà không lạc.
5. ✅ **Mastering chiếu rạp (DCP).**
   - Preset canvas "DCI Flat" 1998×1080 (1.85:1) và "Scope" 2048×858 (2.39:1), 24fps. ✅ (kèm 4K)
   - Âm thanh WAV 24-bit/48kHz (stereo hoặc 5.1: L, R, C, LFE, Ls, Rs). ✅ 5.1 PCM 24-bit
   - Đóng gói SMPTE DCP không mã hoá. ✅ Tự viết muxer MXF + CPL/PKL bằng TS thay vì phụ thuộc DCP-o-matic: tất định, không cần GUI/build C++. Chỉ J2K dùng `opj_compress`.
   - Kiểm tra bằng ClairMeta. ✅ 0 cảnh báo; thêm asdcplib, XSD SMPTE, ffmpeg.
   - Luôn test trên server rạp thật trước khi chiếu.
6. **Scale render.** `evaluate(spec, t)` là hàm thuần, nên frame nào cũng render độc lập. Render farm chỉ là chia dải frame cho nhiều máy/worker (cả vector lẫn Blender `--frames a-b`).
7. **OpenUSD.** Khi Core Spec 1.1 (có animation) ổn định: xuất USD cho pipeline studio. Trước mắt glTF là đủ.

## 6. Dữ kiện kỹ thuật tham chiếu

**DCI/DCP:**
- Container 2K là 2048×1080 (Flat 1998×1080, Scope 2048×858); 4K là 4096×2160.
- Hình: JPEG 2000 12-bit 4:4:4, màu X′Y′Z′ gamma 2.6, ≤ 250 Mb/s.
- Frame rate: SMPTE hỗ trợ 24/25/30 (2K còn có 48/50/60); Interop chỉ 24 (48 ở 2K).
- Nên dùng SMPTE cho sản phẩm mới.
- DCP-o-matic 2.18.x là công cụ mở tốt nhất; OpenDCP gần như bỏ ngỏ.

**Blender:** 5.2 LTS là bản hiện hành (07/2026). Chạy headless bằng `blender -b -P script.py -- args`. Cycles chạy CPU ở mọi nơi. EEVEE headless trên Linux cần EGL/GPU, khó chịu hơn, nên fallback sang Cycles.

**AI video 2026:**
- Đơn vị thực tế là clip 5–15s: Veo 3.1 ~8s nối cảnh, Kling 3.0 ≤15s, Seedance 2.0 4–15s và giữ nhân vật tốt nhất.
- Sora đóng API ngày 24/09/2026, không nên xây trên nó.
- Mô hình open-weights nhận điều kiện depth/pose: Wan 2.2 VACE (Apache-2.0), LTX-2.
- Các con số phần lớn từ nguồn thứ cấp, nên coi là xấp xỉ.

**glTF:**
- Hệ trục +Y up, right-handed, 1 đơn vị = 1 m. Camera nhìn −Z. Quaternion theo thứ tự xyzw.
- Animation: `input` là giây, tăng nghiêm ngặt; `STEP` giữ giá trị (khớp với "on twos").
- Lens (yfov/xmag) không animate được trong core; cần `KHR_animation_pointer`.

## 7. 12 nguyên lý hoạt hình → tính năng engine

| Nguyên lý | Trong engine |
|---|---|
| Squash & stretch | track `scale` (giữ thể tích: s, 1/√s, 1/√s) — xem `motion-bounce.json`; rig tự động là việc tiếp theo |
| Anticipation | ease `inBack`, hoặc key lùi nhỏ trước chuyển động lớn |
| Staging | camera orbit/zoom/place; silhouette module có thể chấm độ "đọc được" (việc sau) |
| Straight-ahead vs pose-to-pose | tracks (pose-to-pose) vs rig thủ tục/noise |
| Follow-through & overlap | rig `follow` (trễ `lag`, hệ số `gain`) |
| Slow in / slow out | ease `inOut` mặc định |
| Arcs | FK xoay khớp nên tự sinh cung; `smooth` Catmull-Rom cho đường camera |
| Secondary action | `wiggle` (thở, idle), track `add` |
| Timing | `fps`, `holdFrames` (on twos), timeline theo giây |
| Exaggeration | `blend:"add"` với gain; `swing`/`bounce` của walk |
| Solid drawing | mesh 3D thật + depth sort exact |
| Appeal | thiết kế nhân vật: cần style guide cho agent (không phải code) |

## Nguồn

- Pixar pipeline: https://sciencebehindpixar.org/pipeline/rendering
- DCI spec: https://dcss.dcimovies.com/ · Flat/Scope: https://en.easydcp.com/support-faq.php?id=22 · SMPTE vs Interop: https://cinepedia.com/packaging/interop-smpte-dcp/
- DCP-o-matic CLI: https://dcpomatic.com/manual/html/ch15.html · ClairMeta: https://github.com/avtools-io/amazing-digital-cinema
- *Flow* làm bằng Blender: https://www.blender.org/user-stories/making-flow-an-interview-with-director-gints-zilbalodis/ · https://80.lv/articles/blender-made-movie-flow-wins-an-oscar-at-the-97th-academy-awards-ceremony
- OpenUSD Core 1.0: https://aousd.org/blog/foundations-of-open-3d-development-introducing-aousd-core-specification-1-0/
- Wan Fun Control: https://docs.comfy.org/tutorials/video/wan/fun-control · Runway Aleph: https://help.runwayml.com/hc/en-us/articles/43277392678803-Aleph-Prompting-Guide
- *Critterz*: https://deadline.com/2026/05/open-ai-produced-animated-family-film-critterz-cannes-1236879586/
- glTF animation: https://github.com/KhronosGroup/glTF-Tutorials/blob/main/gltfTutorial/gltfTutorial_007_Animations.md · KHR_materials_unlit: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_unlit
- 12 nguyên lý: https://arlingtonmuseum.org/explore-more/the-twelve-principles-of-animation · Walk cycle: https://animation.monmouth.edu/instruct/animation/walk-cycle/
