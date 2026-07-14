# "Quảng trường thành phố tương lai về đêm" — audit construct v3 quy mô lớn

Bài stress-test dùng chính engine như một client agent: dựng scene 3D lớn
theo tư duy vector→3D, rig + animation + camera động, xuất hero shot /
overview / video 12s. Toàn bộ tài sản dựng từ primitive của spec — không
asset ngoài.

## Chạy lại

```bash
npx tsx scripts/plaza-preview.mjs -1 storage/plaza-hero.png --2k   # ORBIT/PLACE env để đổi camera
npx tsx scripts/plaza-render-batch.mjs 0 95                        # 96 frames animation (~2.5 phút)
cd storage && ffmpeg -y -framerate 8 -i plaza-frames/f%03d.png -r 24 -c:v libx264 -pix_fmt yuv420p -crf 18 plaza-anim.mp4
npx tsx scripts/plaza-e2e.mjs                                      # E2E qua app thật (cần npm run dev)
```

Deliverables sinh ra (storage/, không commit): `plaza-hero.png` (2K),
`plaza-overview.png` (2K), `plaza-anim.mp4` (12s @ 24fps), `plaza-export.zip`
(export chính chủ từ app: PNG + storyboard.json + captions.srt).

## Scene hierarchy (5 khu / 3 lớp không gian)

| Nhóm | Objects | Ghi chú |
|---|---|---|
| Nền + quảng trường trung tâm | earth, 3 tầng đĩa, vành kẻ CSG, đài phun (vành CSG + nước + trụ + orb + 6 tia + vòng loang cutout), 4 cột đèn ×3 khối, 3 ghế ×3 khối, 2 bồn cây | ~40 solids |
| Giao thông | đường + 2 ray, tram 2 toa (extrude bo, 13 khối, animate x), trạm chờ 5 khối, 2 biển báo | ~24 solids |
| Kiến trúc nền | 6 building khác silhouette (bậc thang / trụ tròn+chóp / tháp antenna+beacon / tháp đôi+cầu / khối ngang / tháp xa), 5 dải cửa sổ cutout, 2 neon glow | ~15 solids + 5 cutouts |
| Cây xanh | 6 tree parts (4 quanh plaza + 2 trong bồn), rung lệch pha | 12+ solids |
| Nhân vật + tiền cảnh | hero (figure 14 khớp, áo coral, rim + formShadow), walker (walk cycle), sitter (ngồi ghế), vali extrude + tay cầm, kiosk 4 khối + neon | ~55 solids |
| 2D | sky gradient, moon + halo, skyline polygon, 5 sao, quầng plaza, 2 dải sương foreground | 13 shapes |

Tổng sau expand: ~150 solids · ~3.5k faces · 7 cutouts · 4 gradients tác giả.
Đếm nhanh: 12+ loại asset độc lập, 3 lớp không gian (skyline 2D → buildings
→ plaza → kiosk/sương tiền cảnh).

## Rig + animation

- **Rig**: `figure` part = FK 14 khớp (spine, neck, shoulder/elbow/wrist L/R,
  hip/knee/ankle L/R) trên 17 khối capsule — đủ head/neck/torso/pelvis/
  upper-lower arm/hand/upper-lower leg/foot theo yêu cầu.
- **A1 idle** (hero): thở spine/neck ±1.5° chu kỳ 2s + đầu DÕI THEO tram
  (neck.y bám tramX, suy giảm theo khoảng cách).
- **A2 walk cycle** (walker): hip ±26° / knee 6–40° ngược pha / tay đối
  chân, chu kỳ 8 frame, di chuyển 1020 units/12s — loop được.
- **A3 wave** (hero, f48–84): tay phải giơ chếch −126°±16° + cẳng tay vẫy
  (lưu ý dấu: shoulderR âm = xoè ra ngoài).
- **Secondary**: tram lướt suốt 12s; 6 tia nước scale sin lệch pha; vòng
  nước loang (cutout r animate); neon cyan flicker tắt 2f/16f; magenta
  pulse; 6 cây sway lệch pha; 4 đèn "thở"; beacon nhấp.
- **Camera**: dolly-in easeInOut 12s — overview (az −30, elev 22, scale
  0.68) → hero (az −21, elev 16, scale 1.06).

## Ánh sáng (lạnh–ấm theo đề)

Moonlight lạnh: directional [0.55,−1.5,0.65] + ambient 0.36 + rim #bcd2ff
trên hero. Hệ ấm: 4 đèn đường + đèn tram + cửa kiosk (#ffc861/#ffd98c).
Emissive: orb đài phun (glow **blur** duy nhất) + neon cyan/magenta + beacon.
Chiều sâu: depthFade #232c52 + 2 dải sương + vignette 0.38. Focus: hero áo
coral #e86a5a — màu nóng duy nhất giữa palette lạnh.

## Bug engine tìm được (đã fix + test)

Bóng của vành CSG mỏng (`plazaRim`) ở camera orbit lẻ làm path-bool chết
nội bộ ("undefined winding") khi union footprint per-face → **cả compile
chết vì một lớp trang trí**. Fix trong `shadow.ts`: degrade convex hull
per-solid + fallback multi-subpath cho union tổng, đều kèm warning.
Regression test: `tests/construct/shadowDegrade.test.ts`.

Ghi nhận thêm (không phải bug): compile scene ~150 solids ≈ 1.2–1.8s
(NNS ~600 splits chủ yếu từ khớp capsule figure); rate limit 30 req/10s
đúng thiết kế — agent batch cần throttle; `light.mode: "gradient"` cạn
budget 128 gradient với scene cỡ này → dùng `smooth`.
