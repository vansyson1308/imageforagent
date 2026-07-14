/**
 * plaza-scene.mjs — "Quảng trường thành phố tương lai về đêm"
 * Builder spec construct v3, tham số hoá theo frame t (0..95, 8fps = 12s).
 * t = -1 → scene tĩnh (hero/overview).
 *
 * HỆ TỶ LỆ (người 165 = đơn vị gốc): đèn 170 · cây 145-200 · tram cao 126/
 * dài 520 · kiosk 210 · buildings 260-700. HỆ ĐỘ CAO (tránh xuyên khối):
 * đất top 0 · plaza tầng 1/2/3 top 8.2/16.4/24.6 · road top 6.2.
 *
 * PALETTE: nền đêm #0a0e24→#232c52 · kiến trúc #29314f/#2a3355/#333e66/
 * #3a4670 · cửa sổ ấm #ffd98c / lạnh #9fd8ef · neon cyan #4ef0e0 / magenta
 * #f06ad8 · đèn ấm #ffc861 · nước #7fd8e8 · cây #2c4a58 · HERO coral #e86a5a.
 */

const TAU = Math.PI * 2;
const lerp = (a, b, u) => a + (b - a) * u;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function mixHex(a, b, u) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(lerp(v, pb[i], u)).toString(16).padStart(2, "0")).join("");
}

export function plazaSpec(o = {}) {
  const t = o.frame ?? -1;
  const anim = t >= 0;

  // ================= ANIMATION DRIVERS =================
  const breathe = anim ? Math.sin((t / 16) * TAU) : 0;
  const tramX = anim ? -1450 + (t / 95) * 2900 : 260;
  const watch = anim ? clamp(-(tramX - 90) / 16, -34, 34) * clamp(1.3 - Math.abs(tramX - 90) / 800, 0, 1) : -12;
  const waving = anim ? t >= 48 && t < 84 : true; // tĩnh: hero đang vẫy (storytelling)
  const waveSwing = anim ? (waving ? Math.sin(((t - 48) / 8) * TAU) : 0) : 0.4;
  const walkPh = anim ? Math.sin((t / 8) * TAU) : 0.6;
  const walkerX = anim ? 560 - (t / 95) * 1020 : -240;
  const jetPh = (i) => (anim ? 0.72 + 0.3 * Math.sin((t / 8) * TAU + (i / 6) * TAU) : 0.9 + 0.12 * Math.sin(i * 2.4));
  const ringU = anim ? (t % 10) / 10 : 0.45;
  const cyanOn = !anim || t % 16 >= 2;
  const magentaGlow = anim ? 0.5 + 0.18 * Math.sin((t / 6) * TAU) : 0.62;
  const sway = (ph) => (anim ? 1.6 * Math.sin((t / 28) * TAU + ph) : 0);
  const lampGlow = (i) => (anim ? 0.52 + 0.07 * Math.sin((t / 12) * TAU + i * 1.7) : 0.58);

  // ================= GRADIENTS =================
  const gradients = [
    { id: "sky", kind: "linear", angle: 90, stops: [
      { offset: 0, color: "#0a0e24" }, { offset: 0.55, color: "#161d3c" }, { offset: 1, color: "#232c52" },
    ] },
    { id: "moonHalo", kind: "radial", stops: [
      { offset: 0, color: "#dfe6f5", opacity: 0.24 }, { offset: 1, color: "#dfe6f5", opacity: 0 },
    ] },
    { id: "plazaGlowG", kind: "radial", stops: [
      { offset: 0, color: "#7fd8e8", opacity: 0.26 }, { offset: 0.6, color: "#4ef0e0", opacity: 0.09 },
      { offset: 1, color: "#4ef0e0", opacity: 0 },
    ] },
    { id: "mist", kind: "linear", angle: 90, stops: [
      { offset: 0, color: "#3d4a7a", opacity: 0 }, { offset: 0.5, color: "#3d4a7a", opacity: 0.2 },
      { offset: 1, color: "#3d4a7a", opacity: 0 },
    ] },
  ];

  // ================= 2D BACKGROUND =================
  const shapes = [
    { id: "skyBg", type: "rect", w: 2800, h: 1600, at: [0, -320], fill: "url(#sky)" },
    { id: "moon", type: "circle", r: 38, at: [-660, -580], fill: "#dfe6f5" },
    { id: "moonG", type: "circle", r: 95, at: [-660, -580], fill: "url(#moonHalo)" },
    { id: "skyline", type: "polygon", fill: "#151b38", points: [
      [-1400, -160], [-1400, -330], [-1230, -330], [-1230, -430], [-1080, -430],
      [-1080, -300], [-920, -300], [-920, -540], [-850, -580], [-780, -540],
      [-780, -360], [-600, -360], [-600, -470], [-470, -470], [-470, -290],
      [-290, -290], [-290, -560], [-160, -560], [-160, -390], [10, -390],
      [10, -620], [60, -660], [110, -620], [110, -440], [300, -440],
      [300, -310], [490, -310], [490, -520], [630, -520], [630, -350],
      [810, -350], [810, -460], [980, -460], [980, -300], [1400, -300], [1400, -160],
    ] },
    { id: "star1", type: "circle", r: 3, at: [-320, -600], fill: "#aebadf" },
    { id: "star2", type: "circle", r: 2.5, at: [430, -640], fill: "#8e9cc8" },
    { id: "star3", type: "circle", r: 3.5, at: [880, -570], fill: "#aebadf" },
    { id: "star4", type: "circle", r: 2, at: [-1010, -640], fill: "#8e9cc8" },
    { id: "star5", type: "circle", r: 2.5, at: [180, -700], fill: "#aebadf" },
    { id: "plazaGlow", type: "ellipse", rx: 720, ry: 250, at: [0, -60], fill: "url(#plazaGlowG)" },
    // Profile 2D cho extrude bo góc (vector-first)
    { id: "benchProfile", type: "rect", w: 96, h: 12, rx: 5 },
    { id: "tramProfile", type: "rect", w: 84, h: 110, rx: 24 },
    { id: "shelterRoof", type: "rect", w: 190, h: 12, rx: 6 },
    { id: "kioskProfile", type: "rect", w: 190, h: 210, rx: 16 },
    { id: "caseProfile", type: "rect", w: 40, h: 58, rx: 9 },
    // Dải cửa sổ (union → 1 cutout/building)
    ...windowStrips("winA", 4, 150, 14, 28),
    ...windowStrips("winC", 8, 140, 13, 34),
    ...windowStrips("winD", 5, 86, 11, 26),
    ...windowStrips("winE", 3, 270, 15, 32),
    ...windowStrips("winF", 6, 160, 12, 30),
    { id: "mistFar", type: "rect", w: 2800, h: 210, at: [0, -190], fill: "url(#mist)", layer: "foreground" },
    { id: "mistNear", type: "rect", w: 2800, h: 240, at: [0, 330], fill: "url(#mist)", layer: "foreground" },
  ];

  const solids = [];
  const cutouts = [];
  const S = (s) => solids.push(s);
  const C = (c) => cutouts.push(c);

  // ================= NỀN ĐẤT + KHU 1: QUẢNG TRƯỜNG =================
  S({ id: "earth", type: "box", size: [3600, 6, 2800], at: [0, -3, -250], fill: "#171d33", shadow: false, effects: {} });
  // 3 tầng đĩa + vành kẻ sáng viền tầng 1 (csg ring — chữ ký vector)
  S({ id: "plaza1", type: "cylinder", r: 470, h: 8, segments: 36, at: [0, 4.2, 0], fill: "#262f4f", shading: "faceted", shadow: false, effects: {} });
  S({ id: "rimOuter", type: "cylinder", r: 471, h: 3, segments: 36, at: [0, 9.8, 0], fill: "#46548a", shading: "none", shadow: false });
  S({ id: "rimInner", type: "cylinder", r: 455, h: 5, segments: 36, at: [0, 9.8, 0], fill: "#46548a", shading: "none" });
  S({ id: "plazaRim", type: "csg", op: "difference", of: ["rimOuter", "rimInner"], fill: "#46548a", shadow: false });
  S({ id: "plaza2", type: "cylinder", r: 330, h: 8, segments: 32, at: [0, 12.4, 0], fill: "#2b3457", shading: "faceted", shadow: false, effects: {} });
  S({ id: "plaza3", type: "cylinder", r: 195, h: 8, segments: 28, at: [0, 20.6, 0], fill: "#303a5e", shading: "faceted", shadow: false, effects: {} });
  // Đài phun: vành csg + mặt nước + trụ + orb + 6 tia + vòng loang
  S({ id: "ftnRimO", type: "cylinder", r: 116, h: 24, segments: 24, at: [0, 36.8, 0], fill: "#3a4670", shading: "faceted" });
  S({ id: "ftnRimI", type: "cylinder", r: 100, h: 30, segments: 24, at: [0, 38, 0], fill: "#3a4670" });
  S({ id: "ftnRim", type: "csg", op: "difference", of: ["ftnRimO", "ftnRimI"], fill: "#3a4670", shadow: false });
  S({ id: "ftnWater", type: "cylinder", r: 97, h: 16, segments: 24, at: [0, 32.9, 0], fill: "#23486a", shading: "none", shadow: false, effects: {} });
  S({ id: "ftnCol", type: "cone", r: 30, rTop: 15, h: 62, segments: 14, at: [0, 72.3, 0], fill: "#3a4670" });
  S({
    id: "ftnOrb", type: "sphere", r: 25, segments: 16, at: [0, 129, 0], fill: "#bfe9f2",
    shadow: false,
    effects: { glow: { mode: "blur", size: 2.8, opacity: 0.85, color: "#7fd8e8" } },
  });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    S({
      id: `jet${i}`, type: "cylinder", r: 3, h: 42, segments: 6,
      at: [Math.cos(a) * 21, 156, Math.sin(a) * 21],
      rotate: [Math.sin(a) * 55, 0, -Math.cos(a) * 55],
      scale: [1, jetPh(i), 1],
      fill: "#7fd8e8", shading: "none", shadow: false, effects: {},
    });
  }
  // Vòng nước loang: ring 2D overlay lên mặt nước (0 solid, 0 split)
  shapes.push(
    { id: "ringO", type: "circle", r: 40 + 52 * ringU },
    { id: "ringI", type: "circle", r: 34 + 52 * ringU },
    { id: "ringShape", type: "boolean", op: "difference", of: ["ringO", "ringI"] },
  );
  C({ solid: "ftnWater", face: "top", shape: "ringShape", fill: mixHex("#7fd8e8", "#2c567a", ringU), mode: "overlay" });
  // 4 cột đèn quanh vành plaza (trên tầng 1: base y 8.4)
  const lampAt = [[-360, 215], [360, 215], [-405, -175], [405, -175]];
  lampAt.forEach(([x, z], i) => {
    S({ id: `lp${i}`, type: "cylinder", r: 6, h: 190, segments: 10, at: [x, 103.4, z], fill: "#2b3040" });
    S({ id: `lh${i}`, type: "cone", r: 20, rTop: 7, h: 16, segments: 12, at: [x, 206.7, z], fill: "#333e4e" });
    S({
      id: `lb${i}`, type: "sphere", r: 10, segments: 10, at: [x, 187, z], fill: "#ffdf9e",
      shading: "none", shadow: false,
      effects: { glow: { mode: "halo", size: 3.8, opacity: lampGlow(i), color: "#ffc861" } },
    });
  });
  // Ghế đá ×3 + bồn cây ×2
  const benchAt = [[-180, 285, 6], [318, 178, -38], [-90, -298, 12]];
  benchAt.forEach(([x, z, ry], i) => {
    S({ id: `bs${i}`, type: "extrude", profile: "benchProfile", depth: 34, rotate: [0, ry, 0], at: [x, 30.4, z], fill: "#3a4670" });
    S({ id: `bl${i}a`, type: "box", size: [10, 16, 30], rotate: [0, ry, 0], at: [x - 34, 16.4, z], fill: "#232b4a", shading: "none" });
    S({ id: `bl${i}b`, type: "box", size: [10, 16, 30], rotate: [0, ry, 0], at: [x + 34, 16.4, z], fill: "#232b4a", shading: "none" });
  });
  S({ id: "pl1", type: "cylinder", r: 42, h: 24, segments: 14, at: [-296, 20.4, -58], fill: "#333e66", shading: "faceted" });
  S({ id: "pl2", type: "cylinder", r: 42, h: 24, segments: 14, at: [296, 20.4, -76], fill: "#333e66", shading: "faceted" });

  // ================= KHU 2: GIAO THÔNG (z -560) =================
  S({ id: "road", type: "box", size: [2900, 6, 170], at: [0, 3.2, -560], fill: "#141a2e", shadow: false, effects: {} });
  S({ id: "railA", type: "box", size: [2900, 3, 6], at: [0, 7.8, -600], fill: "#4a5a8e", shading: "none", shadow: false });
  S({ id: "railB", type: "box", size: [2900, 3, 6], at: [0, 7.8, -520], fill: "#4a5a8e", shading: "none", shadow: false });
  // Tram — thân extrude bo, đùn dọc x; cao 126 (người ×0.76 tới vai... ×1.9 tổng)
  S({ id: "tramBog1", type: "box", size: [110, 12, 60], at: [tramX - 150, 12.2, -560], fill: "#1d2438", shading: "none" });
  S({ id: "tramBog2", type: "box", size: [110, 12, 60], at: [tramX + 150, 12.2, -560], fill: "#1d2438", shading: "none" });
  S({ id: "tramCar1", type: "extrude", profile: "tramProfile", depth: 246, rotate: [0, 90, 0], at: [tramX - 260, 74.5, -560], fill: "#c9d2e8" });
  S({ id: "tramCar2", type: "extrude", profile: "tramProfile", depth: 246, rotate: [0, 90, 0], at: [tramX + 14, 74.5, -560], fill: "#c9d2e8" });
  S({ id: "tramStripe1", type: "box", size: [238, 10, 2], at: [tramX - 133, 44, -517.2], fill: "#4ef0e0", shading: "none", shadow: false });
  S({ id: "tramStripe2", type: "box", size: [238, 10, 2], at: [tramX + 133, 44, -517.2], fill: "#4ef0e0", shading: "none", shadow: false });
  S({ id: "tramWin1", type: "box", size: [200, 34, 2], at: [tramX - 133, 96, -517.2], fill: "#bfe9f2", shading: "none", shadow: false });
  S({ id: "tramWin2", type: "box", size: [200, 34, 2], at: [tramX + 133, 96, -517.2], fill: "#bfe9f2", shading: "none", shadow: false });
  S({
    id: "tramHead", type: "sphere", r: 11, segments: 8, at: [tramX + 262, 52, -535], fill: "#ffd98c",
    shading: "none", shadow: false,
    effects: { glow: { mode: "halo", size: 3, opacity: 0.7, color: "#ffc861" } },
  });
  S({ id: "pant1", type: "box", size: [5, 40, 5], at: [tramX - 80, 149.5, -560], rotate: [0, 0, 20], fill: "#3d4a7a", shading: "none", shadow: false });
  S({ id: "pant2", type: "box", size: [36, 3, 3], at: [tramX - 87, 171, -560], fill: "#3d4a7a", shading: "none", shadow: false });
  // Trạm chờ
  S({ id: "shPostA", type: "box", size: [9, 130, 9], at: [-150, 65, -462], fill: "#2b3040" });
  S({ id: "shPostB", type: "box", size: [9, 130, 9], at: [-10, 65, -462], fill: "#2b3040" });
  S({ id: "shRoof", type: "extrude", profile: "shelterRoof", depth: 80, at: [-80, 136.5, -482], fill: "#3a4670" });
  S({ id: "shBench", type: "box", size: [120, 9, 32], at: [-80, 38, -470], fill: "#333e66" });
  S({
    id: "shSign", type: "box", size: [13, 64, 30], at: [52, 74, -470],
    fill: cyanOn ? "#4ef0e0" : "#1e6b62", shading: "none",
    effects: { glow: { mode: "halo", size: 2.4, opacity: cyanOn ? 0.5 : 0.1, color: "#4ef0e0" } },
  });
  // Biển báo ×2
  S({ id: "sg1p", type: "cylinder", r: 4, h: 95, segments: 8, at: [-620, 47.5, -450], fill: "#2b3040", shading: "none" });
  S({ id: "sg1h", type: "cylinder", r: 18, h: 6, segments: 14, rotate: [90, 0, 0], at: [-620, 108, -450], fill: "#ffc861", shading: "none" });
  S({ id: "sg2p", type: "cylinder", r: 4, h: 95, segments: 8, at: [660, 47.5, -462], fill: "#2b3040", shading: "none" });
  S({ id: "sg2h", type: "box", size: [32, 24, 5], at: [660, 112, -462], fill: "#4ef0e0", shading: "none" });

  // ================= KHU 3: KIẾN TRÚC NỀN (z -760..-1120) =================
  S({ id: "b1a", type: "box", size: [230, 240, 160], at: [-900, 120, -800], fill: "#2a3355" });
  S({ id: "b1b", type: "box", size: [180, 180, 140], at: [-900, 330.5, -800], fill: "#2f3a5e" });
  S({ id: "b1c", type: "box", size: [120, 130, 120], at: [-900, 486, -800], fill: "#2a3355" });
  C({ solid: "b1a", face: "front", shape: "winA", at: [0, 10], fill: "#ffd98c", mode: "overlay" });
  S({ id: "b2", type: "cylinder", r: 98, h: 440, segments: 18, at: [-540, 220, -880], fill: "#333e66", shading: "faceted" });
  S({ id: "b2cap", type: "cone", r: 98, rTop: 24, h: 64, segments: 18, at: [-540, 472.5, -880], fill: "#2a3355", shading: "faceted" });
  S({ id: "b3", type: "box", size: [200, 500, 160], at: [-80, 250, -980], fill: "#29314f" });
  S({ id: "b3ant", type: "cylinder", r: 5, h: 90, segments: 8, at: [-80, 545.5, -980], fill: "#3d4a7a", shading: "none" });
  S({
    id: "b3beacon", type: "sphere", r: 9, segments: 8, at: [-80, 599.5, -980], fill: "#4ef0e0",
    shading: "none", shadow: false,
    effects: { glow: { mode: "halo", size: 3.4, opacity: cyanOn ? 0.65 : 0.2, color: "#4ef0e0" } },
  });
  C({ solid: "b3", face: "front", shape: "winC", at: [0, -20], fill: "#9fd8ef", mode: "overlay" });
  S({ id: "b4a", type: "box", size: [125, 460, 120], at: [340, 230, -860], fill: "#3a4670" });
  S({ id: "b4b", type: "box", size: [125, 410, 120], at: [560, 205, -860], fill: "#333e66" });
  S({ id: "b4bridge", type: "box", size: [94, 44, 84], at: [450, 348, -860], fill: "#2f3a5e" });
  C({ solid: "b4a", face: "front", shape: "winD", at: [0, 24], fill: "#ffd98c", mode: "overlay" });
  C({ solid: "b4b", face: "front", shape: "winD", at: [0, 34], fill: "#9fd8ef", mode: "overlay" });
  S({ id: "b5a", type: "box", size: [360, 260, 150], at: [940, 130, -800], fill: "#2a3355" });
  S({ id: "b5b", type: "box", size: [270, 110, 130], at: [940, 315.5, -800], fill: "#2f3a5e" });
  C({ solid: "b5a", face: "front", shape: "winE", at: [0, 8], fill: "#ffd98c", mode: "overlay" });
  S({ id: "b6", type: "box", size: [280, 560, 160], at: [170, 280, -1120], fill: "#262e4d" });
  C({ solid: "b6", face: "front", shape: "winF", at: [0, -30], fill: "#9fd8ef", mode: "overlay" });
  // Neon: dải magenta dọc mép B4a + vành cyan ngang B3
  S({
    id: "neonMag", type: "box", size: [14, 340, 8], at: [268, 210, -796], fill: "#f06ad8",
    shading: "none", shadow: false,
    effects: { glow: { mode: "halo", size: 2.6, opacity: magentaGlow, color: "#f06ad8" } },
  });
  S({
    id: "neonCyan", type: "box", size: [204, 16, 8], at: [-80, 560, -896],
    fill: cyanOn ? "#4ef0e0" : "#1e6b62", shading: "none", shadow: false,
    effects: { glow: { mode: "halo", size: 2.2, opacity: cyanOn ? 0.55 : 0.12, color: "#4ef0e0" } },
  });

  // ================= TIỀN CẢNH: kiosk =================
  S({ id: "kiosk", type: "extrude", profile: "kioskProfile", depth: 150, at: [-620, 105.2, 250], fill: "#333e66" });
  S({ id: "kioskRoof", type: "box", size: [215, 14, 175], at: [-620, 217.5, 250], fill: "#3a4670" });
  S({ id: "kioskWin", type: "box", size: [130, 66, 2], at: [-620, 118, 326.5], fill: "#ffd98c", shading: "none", shadow: false });
  S({
    id: "kioskSign", type: "box", size: [110, 24, 9], at: [-620, 242, 322], fill: "#f06ad8",
    shading: "none", shadow: false,
    effects: { glow: { mode: "halo", size: 2.6, opacity: magentaGlow, color: "#f06ad8" } },
  });
  // Vali hero (prop nhận diện)
  S({ id: "case", type: "extrude", profile: "caseProfile", depth: 24, at: [104, 37.6, 296], rotate: [0, 14, 0], fill: "#3fc7ba" });
  S({ id: "caseHandle", type: "box", size: [17, 12, 5], at: [104, 72.8, 296], rotate: [0, 14, 0], fill: "#2b3040", shading: "none" });

  // ================= PARTS: cây + 3 nhân vật =================
  const parts = [
    { id: "tr1", type: "tree", trunkH: 105, trunkR: 13, canopyR: 72, style: "blob", at: [-660, 0, -260], rotate: [0, 0, sway(0)], fills: { trunk: "#2b3143", canopy: "#2c4a58" } },
    { id: "tr2", type: "tree", trunkH: 120, trunkR: 14, canopyR: 80, style: "blob", at: [660, 0, -280], rotate: [0, 40, sway(1.5)], fills: { trunk: "#2b3143", canopy: "#2c4a58" } },
    { id: "tr3", type: "tree", trunkH: 92, trunkR: 11, canopyR: 60, style: "blob", at: [-760, 0, 60], rotate: [0, 80, sway(3)], fills: { trunk: "#2b3143", canopy: "#31525f" } },
    { id: "tr4", type: "tree", trunkH: 100, trunkR: 12, canopyR: 64, style: "blob", at: [740, 0, 40], rotate: [0, 120, sway(4.5)], fills: { trunk: "#2b3143", canopy: "#2c4a58" } },
    { id: "tr5", type: "tree", trunkH: 44, trunkR: 7, canopyR: 30, style: "blob", at: [-296, 32.6, -58], rotate: [0, 20, sway(0.8)], fills: { trunk: "#2b3143", canopy: "#31525f" } },
    { id: "tr6", type: "tree", trunkH: 44, trunkR: 7, canopyR: 30, style: "blob", at: [296, 32.6, -76], rotate: [0, 60, sway(2.2)], fills: { trunk: "#2b3143", canopy: "#2c4a58" } },
    // HERO — du khách áo coral cạnh vali, dõi tram + vẫy
    {
      id: "hero", type: "figure", height: 165, headCount: 3.5,
      at: [150, 8.4, 260], rotate: [0, 152, 0],
      pose: {
        spine: [1.5 * breathe, 0, 0],
        neck: [-9 + 1.6 * breathe, watch, 0],
        shoulderL: [0, 0, -6],
        shoulderR: waving ? [0, 0, -(126 + 16 * waveSwing)] : [0, 0, 8 + breathe],
        elbowL: [-8, 0, 0],
        elbowR: waving ? [0, 0, -(34 + 14 * waveSwing)] : [-10, 0, 0],
        hipL: [1, 0, 0],
        hipR: [-1.5, 0, 0],
      },
      fills: { skin: "#e6b58f", shirt: "#e86a5a", pants: "#2b3247", shoes: "#1d222f" },
      effects: { formShadow: { opacity: 0.22 }, rim: { color: "#bcd2ff", width: 0.05, opacity: 0.65 } },
    },
    // Walker — walk cycle ngang plaza
    {
      id: "walker", type: "figure", height: 158, headCount: 3.5,
      at: [walkerX, 8.4, 96], rotate: [0, -90, 0],
      pose: {
        spine: [4, 0, 0],
        neck: [-4, 0, 0],
        hipL: 26 * walkPh,
        hipR: -26 * walkPh,
        kneeL: Math.max(0, -34 * walkPh) + 6,
        kneeR: Math.max(0, 34 * walkPh) + 6,
        shoulderL: [14 * walkPh, 0, -6],
        shoulderR: [-14 * walkPh, 0, 6],
        elbowL: [-16, 0, 0],
        elbowR: [-16, 0, 0],
      },
      fills: { skin: "#d9a97e", shirt: "#4e5a78", pants: "#232b3f", shoes: "#1d222f" },
      effects: { formShadow: { opacity: 0.2 } },
    },
    // Sitter — ngồi ghế bs1 (silhouette phụ)
    {
      id: "sitter", type: "figure", height: 150, headCount: 3.5,
      at: [318, o.sitterY ?? -20, 166], rotate: [0, 142, 0],
      pose: {
        spine: [10, 0, 0], neck: [-8, 0, 0],
        hipL: [-84, 0, 4], hipR: [-84, 0, -4],
        kneeL: [82, 0, 0], kneeR: [82, 0, 0],
        shoulderL: [-22, 0, -4], shoulderR: [-22, 0, 4],
        elbowL: [-34, 0, 0], elbowR: [-34, 0, 0],
      },
      fills: { skin: "#b78d6d", shirt: "#39415f", pants: "#232b3f", shoes: "#1a1e2b" },
    },
  ];

  return {
    version: 1,
    gradients,
    shapes,
    solids,
    cutouts,
    parts,
    shadow: { style: "silhouette", color: "#0a0f1f", opacity: 0.3, blur: 6, ground: 0 },
    light: { direction: [0.55, -1.5, 0.65], ambient: 0.36, mode: "smooth" },
    atmosphere: {
      depthFade: { color: "#232c52", strength: 0.5, desaturate: 0.4 },
      vignette: { color: "#070b16", strength: o.vignette ?? 0.38, start: 0.5 },
    },
    camera: { orbit: o.orbit ?? { azimuth: -24, elevation: 20 } },
    place: { at: o.at ?? [960, 660], scale: o.scale ?? 0.78 },
  };
}

/** Dải cửa sổ: n dải w×h cách gap → union thành shape `id`. */
function windowStrips(id, n, w, h, gap) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ id: `${id}_${i}`, type: "rect", w, h, rx: 3, at: [0, i * (h + gap) - ((n - 1) * (h + gap)) / 2] });
  }
  return [...rows, { id, type: "boolean", op: "union", of: rows.map((r) => r.id) }];
}
