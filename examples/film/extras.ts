/**
 * Additional scenes spliced into the chapters (village life, fishing, the
 * children's dragon game, the Cuội legend, getting lost, the frog, sliding
 * down the hill, the second lion angle, floating lanterns, walking home).
 * `after` = the id of the shot each one follows.
 */
import { MARKS, buffalo, forest, hilltop, lion, paddies, pond, riverside, square, village } from "./sets";
import type { ShotDef } from "./shots";
import { merge, mix, paperLantern, rock, type Json, type Palette, type SetPiece, type Vec3 } from "./kit";
import { HOLD_LANTERN, K, KIDS, LOOK_UP, SAD, SIT_GROUND, VILLAGERS, hop, seated } from "./acting";

const R = MARKS.river;
const Q = MARKS.square;

/** Fishing rod held in the right hand (a long thin cane + line). */
function rod(id: string, holder: string, p: Palette): Json[] {
  const at = { attach: { part: holder, joint: "wristR" } };
  return [
    { id: `${id}Cane`, type: "cylinder", r: 1.6, h: 220, segments: 5, at: [0, -2, 100], rotate: [70, 0, 0], fill: mix("#b89a5a", p.tint, p.tintAmount), shading: "faceted", shadow: false, ...at },
  ];
}

function basket(id: string, holder: string, p: Palette): Json {
  return { id, type: "cylinder", r: 22, h: 22, rTop: 26, segments: 8, at: [0, -16, 6], fill: mix("#b88a4a", p.tint, p.tintAmount), shading: "faceted", shadow: false, attach: { part: holder, joint: "wristR" } };
}

function frog(id: string, p: Palette, at: Vec3): Json[] {
  const g = mix("#6aa84a", p.tint, p.tintAmount * 0.6);
  return [
    { id, type: "sphere", r: 12, segments: 8, at, scale: [1.2, 0.8, 1], fill: g, shading: "faceted", shadow: false },
    { id: `${id}EyeL`, type: "sphere", r: 3.6, segments: 6, at: [at[0] + 6, at[1] + 9, at[2] + 6], fill: "#f2f2d8", shading: "none", shadow: false },
    { id: `${id}EyeR`, type: "sphere", r: 3.6, segments: 6, at: [at[0] - 6, at[1] + 9, at[2] + 6], fill: "#f2f2d8", shading: "none", shadow: false },
  ];
}

function fish(id: string, p: Palette, at: Vec3): Json[] {
  return [{ id, type: "sphere", r: 12, segments: 8, at, scale: [1.8, 0.8, 0.6], fill: mix("#c8d0d8", p.tint, p.tintAmount), shading: "faceted", shadow: false }];
}

/** Floating paper lanterns on the river (thả đèn), drifting along x. */
function floaters(p: Palette, n: number, z: number, dur: number): { solids: Json[]; tracks: Json[] } {
  const cols = ["#e8412f", "#f2b632", "#e86a2f", "#d8325a"];
  const solids: Json[] = [];
  const tracks: Json[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = -900 + i * 130;
    const zz = z - 80 + ((i * 47) % 160);
    const id = `fl${i}`;
    solids.push(paperLantern(id, [x0, 12, zz], cols[i % 4], true));
    tracks.push({ target: `solids.${id}.at`, keys: [{ t: 0, v: [x0, 12, zz] }, { t: dur, v: [x0 + 260, 12, zz + 20], ease: "linear" }] });
  }
  void p;
  return { solids, tracks };
}

/** Four-legged walk: diagonal pairs swing in antiphase (buffalo). */
function legGait(id: string, dur: number, period = 1.1): Json[] {
  const mk = (leg: string, phase: number) => {
    const keys: { t: number; v: number[]; ease?: string }[] = [];
    for (let t = 0, i = 0; t <= dur + 1e-6; t += period / 2, i++) keys.push({ t: Math.round(t * 1000) / 1000, v: [0, 0, (i + phase) % 2 ? 16 : -16], ...(i ? { ease: "inOut" } : {}) });
    return { target: `solids.${id}Leg${leg}.rotate`, keys };
  };
  return [mk("FL", 0), mk("BR", 0), mk("FR", 1), mk("BL", 1)];
}

/** Hilltop dome surface (matches sets.hilltop: r 900, flattened 0.6, centre y −380). */
const hillY = (x: number) => Math.max(0, -380 + 0.6 * Math.sqrt(Math.max(0, 900 * 900 - x * x)));
const slopeDeg = (x: number) => (Math.atan2(hillY(x + 5) - hillY(x - 5), 10) * 180) / Math.PI;
/** Slide timing: slow push-off, fast middle, run-out on the flat. */
const slide: [number, number][] = [[0, 60], [2, 60], [3.5, 180], [5, 340], [6.3, 500], [7.4, 640], [8.6, 780], [10, 880], [12, 920]];

const kidLine = (phase: number) => ([[-500 + phase, 120], [-200 + phase, 40], [100 + phase, 140], [400 + phase, 60], [700 + phase, 120]] as [number, number][]);

export const EXTRAS: { after: string; shot: ShotDef }[] = [
  // ---------------- Chapter 1 ----------------
  { after: "1.02", shot: {
    id: "1.02a", scene: "Làng ven sông", shotType: "Wide — village morning", dur: 12, pal: "dawn",
    desc: "Chú Cường dắt trâu ra đồng trong nắng sớm.",
    set: (p) => merge(paddies(p), buffalo("trau", p, [-600, 0, 20], 0)),
    cam: { az: 14, el: 8, zoom: 1.6, focus: [-300, 70, 0] },
    camTo: { az: 10, el: 8, zoom: 1.6, focus: [100, 70, 0] },
    actors: [{ who: "bo", id: "cuong", look: VILLAGERS.cuong, at: [-560, 0, -60], walk: { path: [[-560, -60], [300, -60]], end: 12, cadence: 1.4 } }],
    rigs: [{ type: "wiggle", target: "groups.trauG.rotate", amplitude: [0, 3, 1.5], frequency: 0.7, seed: 9 }, { type: "wiggle", target: "solids.trauTail.rotate", amplitude: [0, 0, 20], frequency: 1.1, seed: 10 }],
    tracks: [K("groups.trauG.at", [0, [-600, 0, 20]], [12, [260, 0, 20]]), ...legGait("trau", 12)],
  } },
  { after: "1.02a", shot: {
    id: "1.02b", scene: "Làng ven sông", shotType: "Medium — tracking", dur: 12, pal: "dawn",
    desc: "Các cô đội nón lá, xách giỏ đi chợ sớm.",
    set: (p) => village(p, { lit: false }),
    props: (p) => ({ solids: [basket("bk1", "mai", p), basket("bk2", "hanh", p)] }),
    cam: { az: 20, el: 6, zoom: 2.6, focus: [-200, 80, 120] },
    follow: "mai", followOffset: [60, 80, 0],
    actors: [
      { who: "bo", id: "mai", look: VILLAGERS.mai, at: [-600, 0, 120], walk: { path: [[-600, 120], [400, 150]], end: 12, cadence: 1.8 } },
      { who: "bo", id: "hanh", look: { ...VILLAGERS.mai, fills: { ...VILLAGERS.mai.fills, shirt: "#8ab04a" } }, at: [-700, 0, 170], walk: { path: [[-700, 170], [300, 200]], end: 12, cadence: 1.8 } },
    ],
  } },
  { after: "1.07", shot: {
    id: "1.07a", scene: "Câu cá", shotType: "Wide — fishing", dur: 14, pal: "day",
    desc: "Buổi trưa, hai bà cháu ngồi câu cá bên sông.",
    set: riverside,
    props: (p) => ({ solids: [...rod("rodBa", "ba", p), ...rod("rodTi", "ti", p)] }),
    cam: { az: 150, el: 10, zoom: 2.6, focus: [0, 50, 40] },
    camTo: { az: 158, el: 9, zoom: 3.0, focus: [0, 50, 40] },
    actors: [
      { who: "ba", at: seated("ba", [-70, 0, 20], 0), pose: { ...SIT_GROUND, shoulderR: [-50, 0, 0] } },
      { who: "ti", at: seated("ti", [70, 0, 30], 0), hero: true, pose: { ...SIT_GROUND, shoulderR: [-50, 0, 0] }, tracks: [K("pose.neck", [0, [0, 0, 0]], [4, [0, 30, 0]], [8, [0, -20, 0]], [12, [0, 0, 0]])] },
    ],
    transition: ["dissolve", 1.5],
  } },
  { after: "1.07a", shot: {
    id: "1.07b", scene: "Câu cá", shotType: "Close — waiting", dur: 10, pal: "day",
    desc: "Tí sốt ruột chờ cá cắn câu, chống cằm thở dài.",
    set: riverside,
    props: (p) => ({ solids: rod("rodTi", "ti", p) }),
    cam: { az: 30, el: 4, zoom: 7, focus: [70, 55, 30] },
    actors: [{ who: "ti", at: seated("ti", [70, 0, 30], 0), hero: true, pose: { ...SIT_GROUND, shoulderR: [-50, 0, 0], shoulderL: [-110, 0, 0], elbowL: [-120, 0, 0] }, tracks: [K("pose.spine", [0, [10, 0, 0]], [5, [16, 0, 0]], [6, [4, 0, 0]], [10, [12, 0, 0]])] }],
  } },
  { after: "1.07b", shot: {
    id: "1.07c", scene: "Câu cá", shotType: "Medium — the splash", dur: 12, pal: "day",
    desc: "Một con cá quẫy nhảy lên, té nước vào Tí. Tí ngã ngửa, bà cười.",
    set: riverside,
    props: (p) => ({ solids: [...rod("rodBa", "ba", p), ...rod("rodTi", "ti", p), ...fish("ca", p, [90, -20, 200])] }),
    cam: { az: 150, el: 8, zoom: 3.2, focus: [20, 60, 60] },
    actors: [
      { who: "ba", at: seated("ba", [-70, 0, 20], 0), talks: true, pose: { ...SIT_GROUND, shoulderR: [-50, 0, 0] }, tracks: [K("pose.spine", [5, [0, 0, 0]], [5.5, [-14, 0, 0]], [6, [6, 0, 0]], [6.5, [-14, 0, 0]], [7.5, [0, 0, 0]])] },
      { who: "ti", at: seated("ti", [70, 0, 30], 0), hero: true, still: true, pose: { ...SIT_GROUND, shoulderR: [-50, 0, 0] },
        tracks: [K("rotate.0", [2.4, 0], [3, -65], [7, -65], [8.5, 0]), K("pose.shoulderL", [2.4, [0, 0, 0]], [2.8, [-150, 0, 40]], [6, [-150, 0, 40]], [7, [0, 0, 0]])] },
    ],
    tracks: [K("solids.ca.at", [0, [90, -20, 200]], [1.8, [90, -20, 200]], [2.3, [80, 110, 120]], [2.8, [60, 40, 60]], [3.2, [40, -20, 180]]), K("solids.ca.rotate", [1.8, [0, 0, 40]], [2.8, [0, 0, -120]])],
    line: { by: "ba", text: "Hì hì, cá nó trêu cháu đấy!", offset: 4.5 },
  } },
  { after: "1.14", shot: {
    id: "1.14a", scene: "Rồng rắn", shotType: "Wide — the dragon game", dur: 14, pal: "day",
    desc: "Lũ trẻ chơi rồng rắn lên mây, nối đuôi nhau uốn lượn.",
    set: (p) => village(p),
    cam: { az: 10, el: 12, zoom: 2.0, focus: [100, 60, 80] },
    actors: [
      { who: "ti", at: [-500, 0, 120], hero: true, walk: { path: kidLine(0), end: 14, cadence: 2.6, armSwing: 10 }, pose: { shoulderL: [-70, 0, 0], shoulderR: [-70, 0, 0] } },
      { who: "lan", at: [-600, 0, 120], walk: { path: kidLine(-90), end: 14, cadence: 2.6, armSwing: 10 }, pose: { shoulderL: [-70, 0, 0], shoulderR: [-70, 0, 0] } },
      { who: "lan", id: "hoa", look: KIDS.hoa, at: [-700, 0, 120], walk: { path: kidLine(-180), end: 14, cadence: 2.6, armSwing: 10 }, pose: { shoulderL: [-70, 0, 0], shoulderR: [-70, 0, 0] } },
      { who: "ti", id: "minh", look: KIDS.minh, at: [-800, 0, 120], walk: { path: kidLine(-270), end: 14, cadence: 2.6, armSwing: 10 }, pose: { shoulderL: [-70, 0, 0], shoulderR: [-70, 0, 0] } },
      { who: "ti", id: "nam", look: KIDS.nam, at: [-900, 0, 120], walk: { path: kidLine(-360), end: 14, cadence: 2.6, armSwing: 10 }, pose: { shoulderL: [-70, 0, 0], shoulderR: [-70, 0, 0] } },
    ],
    transition: ["dissolve", 1.5],
  } },
  { after: "1.14a", shot: {
    id: "1.14b", scene: "Rồng rắn", shotType: "Medium — tumble", dur: 11, pal: "day",
    desc: "Đoàn rồng rắn đứt đuôi, cả bọn ngã lăn ra cười.",
    set: (p) => village(p),
    cam: { az: 18, el: 9, zoom: 3.2, focus: [260, 50, 100] },
    actors: [
      { who: "ti", at: [360, 0, 90], hero: true, still: true, tracks: [K("rotate.0", [1, 0], [1.6, 70], [8, 70], [9.5, 0]), K("at.1", [1, 0], [1.6, 16], [8, 16], [9.5, 0])] },
      { who: "lan", at: [260, 0, 130], still: true, tracks: [K("rotate.2", [1.3, 0], [1.9, -80], [8, -80], [9.5, 0]), K("at.1", [1.3, 0], [1.9, 18], [8, 18], [9.5, 0])] },
      { who: "lan", id: "hoa", look: KIDS.hoa, at: [170, 0, 80], still: true, tracks: [K("rotate.0", [1.6, 0], [2.2, -70], [8, -70], [9.5, 0])] },
      { who: "ti", id: "minh", look: KIDS.minh, at: [90, 0, 140], tracks: hop(2, 20, 4) },
    ],
  } },
  { after: "3.05", shot: {
    id: "3.05a", scene: "Cánh đồng đêm", shotType: "Tracking — along the dike", dur: 12, pal: "night",
    desc: "Tí chạy trên bờ ruộng, đốm sáng nhỏ dẫn đường phía trước.",
    set: paddies,
    props: () => ({ solids: [{ id: "dd", type: "sphere", r: 9, segments: 8, at: [-100, 150, 0], fill: "#fff7a1", shading: "none", shadow: false, effects: { glow: { mode: "halo", size: 4, opacity: 0.7 } } }] }),
    cam: { az: 40, el: 6, zoom: 3.4, focus: [-300, 70, 0] },
    follow: "ti", followOffset: [80, 80, 0],
    actors: [{ who: "ti", at: [-400, 0, 0], hero: true, walk: { path: [[-400, 0], [500, 0]], end: 12, cadence: 3 } }],
    tracks: [K("solids.dd.at", [0, [-160, 150, 0]], [4, [150, 170, 0]], [8, [460, 150, 0]], [12, [760, 160, 0]])],
  } },
  // ---------------- Chapter 2 ----------------
  { after: "2.01", shot: {
    id: "2.01a", scene: "Chiều gió", shotType: "Medium — the legend", dur: 18, pal: "dusk",
    desc: "Dưới gốc đa, bà kể lũ trẻ nghe sự tích chú Cuội ngồi gốc cây đa trên cung trăng.",
    set: (p) => village(p),
    cam: { az: -8, el: 6, zoom: 3.4, focus: [860, 80, -330] },
    camTo: { az: -2, el: 5, zoom: 4.2, focus: [870, 90, -330] },
    actors: [
      { who: "ba", at: seated("ba", [960, 0, -380], 30), yaw: -20, talks: true, pose: { hipL: [-86, 0, 0], hipR: [-86, 0, 0], kneeL: [86, 0, 0], kneeR: [86, 0, 0] },
        tracks: [K("pose.shoulderR", [2, [0, 0, 0]], [3, [-60, 0, -40]], [6, [-40, 0, -70]], [9, [-60, 0, -40]], [12, [0, 0, 0]])] },
      { who: "ti", at: seated("ti", [790, 0, -270], 0), yaw: 40, hero: true, pose: { ...SIT_GROUND, neck: [-10, 0, 0] } },
      { who: "lan", at: seated("lan", [870, 0, -250], 0), yaw: 20, pose: { ...SIT_GROUND, neck: [-10, 0, 0] } },
      { who: "lan", id: "hoa", look: KIDS.hoa, at: seated("lan", [720, 0, -310], 0), yaw: 60, pose: { ...SIT_GROUND } },
    ],
    line: { by: "ba", text: "Ngày xưa, có chú Cuội ôm cây đa thần bay lên cung trăng. Đêm rằm, trẻ con rước đèn để soi đường cho chú Cuội về.", offset: 1 },
  } },
  { after: "2.01a", shot: {
    id: "2.01b", scene: "Chiều gió", shotType: "Close — listening", dur: 10, pal: "dusk",
    desc: "Tí chăm chú lắng nghe, mắt tròn xoe nhìn lên trời.",
    set: (p) => village(p),
    cam: { az: 30, el: 4, zoom: 7.5, focus: [790, 50, -270], screen: [1000, 540] },
    actors: [{ who: "ti", at: seated("ti", [790, 0, -270], 0), yaw: 40, hero: true, pose: { ...SIT_GROUND }, tracks: [K("pose.neck", [0, [-10, 0, 0]], [4, [-10, 0, 0]], [6, [-28, 10, 0]])] }],
    sky: { moonAt: [1500, 420] },
  } },
  // ---------------- Chapter 3 ----------------
  { after: "3.07", shot: {
    id: "3.07a", scene: "Rừng tre", shotType: "Wide — lost", dur: 12, pal: "night",
    desc: "Đom đóm khuất bóng. Tí đi vòng vòng rồi lại quay về đúng tảng đá cũ.",
    set: (p) => merge(forest(p), { solids: [rock("lostRock", p, [0, 0, 60], 42)] }),
    cam: { az: 0, el: 30, zoom: 2.0, focus: [0, 20, 40] },
    actors: [{ who: "ti", at: [-80, 0, 150], hero: true, walk: { path: [[-80, 150], [-260, 20], [-80, -140], [200, -100], [260, 120], [60, 170]], end: 12, cadence: 1.8, armSwing: 10 } }],
  } },
  { after: "3.07a", shot: {
    id: "3.07b", scene: "Rừng tre", shotType: "Medium — courage", dur: 10, pal: "night",
    desc: "Bóng tre lay động như những bàn tay. Tí nấp sau tảng đá, rồi tự nhủ: không sợ!",
    set: (p) => merge(forest(p), { solids: [rock("lostRock", p, [0, 0, 60], 42)] }),
    cam: { az: 12, el: 5, zoom: 4.2, focus: [10, 55, 30] },
    actors: [{ who: "ti", at: [10, 0, 0], hero: true, talks: true, pose: { kneeL: [60, 0, 0], kneeR: [60, 0, 0], hipL: [-50, 0, 0], hipR: [-50, 0, 0] },
      tracks: [K("at.1", [0, -22], [5, -22], [6, 0]), K("pose.kneeL", [5, [60, 0, 0]], [6, [0, 0, 0]]), K("pose.kneeR", [5, [60, 0, 0]], [6, [0, 0, 0]]), K("pose.hipL", [5, [-50, 0, 0]], [6, [0, 0, 0]]), K("pose.hipR", [5, [-50, 0, 0]], [6, [0, 0, 0]])] }],
    rigs: [{ type: "wiggle", target: "solids.fb2S0.rotate", amplitude: [4, 0, 8], frequency: 0.6, seed: 3 }, { type: "wiggle", target: "solids.fb2S1.rotate", amplitude: [4, 0, 8], frequency: 0.7, seed: 4 }],
    line: { by: "ti", text: "Mình không sợ đâu! Mình không sợ!", offset: 6 },
  } },
  // ---------------- Chapter 4 ----------------
  { after: "4.09", shot: {
    id: "4.09a", scene: "Hồ sen", shotType: "Close — the frog", dur: 10, pal: "night",
    desc: "Chú ếch trên lá sen nhảy tõm xuống nước làm Tí giật mình.",
    set: pond,
    props: (p) => ({ solids: frog("ech", p, [-250, 14, 60]) }),
    cam: { az: 0, el: 12, zoom: 6.5, focus: [-260, 20, 60] },
    tracks: [
      K("solids.ech.at", [0, [-250, 14, 60]], [4, [-250, 14, 60]], [4.5, [-190, 60, 40]], [5, [-130, 0, 20]]),
      K("solids.echEyeL.at", [0, [-244, 23, 66]], [4, [-244, 23, 66]], [4.5, [-184, 69, 46]], [5, [-124, -10, 26]]),
      K("solids.echEyeR.at", [0, [-256, 23, 66]], [4, [-256, 23, 66]], [4.5, [-196, 69, 46]], [5, [-136, -10, 26]]),
    ],
  } },
  { after: "4.13", shot: {
    id: "4.13a", scene: "Hồ sen", shotType: "Medium — trying to fix it", dur: 11, pal: "night",
    desc: "Tí ngồi xuống bờ đá, cố vuốt lại tờ giấy rách, lặng lẽ.",
    set: pond,
    cam: { az: 24, el: 6, zoom: 4.6, focus: [0, 60, 0] },
    actors: [{ who: "ti", at: seated("ti", [0, 0, 0], 0), hero: true, lantern: "torn", pose: { ...SIT_GROUND, ...SAD, shoulderR: [-50, 0, 10], elbowR: [-40, 0, 0] },
      tracks: [K("pose.shoulderL", [1, [0, 0, 0]], [2, [-60, 0, -20]], [4, [-50, 0, -30]], [6, [-60, 0, -20]], [8, [0, 0, 0]])] }],
  } },
  // ---------------- Chapter 5 ----------------
  { after: "5.05", shot: {
    id: "5.05a", scene: "Đồi trăng", shotType: "Medium — a rest", dur: 10, pal: "night",
    desc: "Giữa sườn đồi, Tí dừng lại thở, ngước nhìn vầng trăng mỗi lúc một gần.",
    set: hilltop,
    cam: { az: 150, el: 2, zoom: 4, focus: [-300, 170, 60] },
    actors: [{ who: "ti", at: [-300, Math.round(-380 + 0.6 * Math.sqrt(900 * 900 - 300 * 300)), 60], yaw: 110, hero: true, lantern: "lit", pose: { ...HOLD_LANTERN, ...LOOK_UP }, tracks: [K("pose.spine", [0, [16, 0, 0]], [3, [4, 0, 0]], [5, [14, 0, 0]], [8, [2, 0, 0]])] }],
    sky: { moonAt: [800, 300] },
  } },
  { after: "5.09", shot: {
    id: "5.09a", scene: "Đồi trăng", shotType: "Wide — sliding down", dur: 12, pal: "night",
    desc: "Tí ngồi lên tàu lá chuối, trượt vèo xuống sườn đồi.",
    set: (p) => merge(hilltop(p), { solids: [{ id: "leafSled", type: "box", size: [70, 4, 34], at: [60, hillY(60) + 2, 60], fill: mix("#6fae45", p.tint, p.tintAmount), shading: "faceted", shadow: false }] }),
    cam: { az: 6, el: 6, zoom: 3.2, focus: [300, 100, 60] },
    follow: "ti", followOffset: [60, 60, 0],
    actors: [{ who: "ti", at: seated("ti", [60, 0, 60], hillY(60) + 4), yaw: 90, hero: true, lantern: "lit", still: true, pose: { ...SIT_GROUND, ...HOLD_LANTERN, shoulderL: [0, 0, 80] },
      tracks: [{ target: "at", keys: slide.map(([t, x], i) => ({ t, v: [x, seated("ti", [0, 0, 0], hillY(x) + 4)[1], 60], ...(i ? { ease: "linear" } : {}) })) }] }],
    tracks: [
      { target: "solids.leafSled.at", keys: slide.map(([t, x], i) => ({ t, v: [x, Math.round(hillY(x) + 2), 60], ...(i ? { ease: "linear" } : {}) })) },
      { target: "solids.leafSled.rotate", keys: slide.map(([t, x], i) => ({ t, v: [0, 0, Math.round(slopeDeg(x))], ...(i ? { ease: "linear" } : {}) })) },
    ],
  } },
  { after: "5.10", shot: {
    id: "5.10a", scene: "Về làng", shotType: "Wide — the festival lights", dur: 12, pal: "festival",
    desc: "Đến đầu làng, Tí dừng lại: sân đình đã rực rỡ ánh đèn, tiếng trống vọng ra.",
    set: square,
    cam: { az: 6, el: 6, zoom: 1.7, focus: [0, 90, 240] },
    actors: [{ who: "ti", at: [0, 0, 520], yaw: 180, hero: true, lantern: "lit", pose: HOLD_LANTERN, tracks: hop(8, 16, 1) }],
  } },
  // ---------------- Chapter 6 ----------------
  { after: "6.03", shot: {
    id: "6.03a", scene: "Đêm hội", shotType: "Low angle — the lion rears", dur: 12, pal: "festival",
    desc: "Con lân chồm lên, lắc đầu, chớp mắt trước lũ trẻ thích thú.",
    set: square,
    props: (p) => ({ solids: lion("lion", p, "cuong") }),
    cam: { az: -30, el: -2, zoom: 4.2, focus: [-120, 120, -40] },
    actors: [
      { who: "bo", id: "cuong", look: { ...VILLAGERS.cuong, hat: undefined }, at: [-120, 0, -40], yaw: -20, still: true, pose: { shoulderL: [-80, 0, 0], shoulderR: [-80, 0, 0] },
        tracks: [K("pose.spine", [0, [0, 0, 0]], [2, [-30, 0, 0]], [3, [10, 0, 10]], [4, [-30, 0, -10]], [6, [10, 0, 10]], [8, [-25, 0, 0]], [10, [5, 0, -8]], [12, [0, 0, 0]]), K("at.1", [0, 0], [2, 20], [3, 0], [4, 20], [6, 0], [8, 18], [10, 0])] },
      { who: "ti", id: "minh", look: KIDS.minh, at: [120, 0, 60], yaw: -110, lantern: "lit", pose: HOLD_LANTERN, tracks: hop(3.5, 16, 2) },
    ],
  } },
  { after: "6.09", shot: {
    id: "6.09a", scene: "Đêm hội", shotType: "Medium — the dance", dur: 12, pal: "festival",
    desc: "Người lớn nắm tay nhau múa quanh gốc đa theo nhịp trống.",
    set: square,
    cam: { az: 12, el: 9, zoom: 2.6, focus: [0, 80, -250] },
    actors: [
      { who: "bo", id: "mai", look: VILLAGERS.mai, at: [-200, 0, -260], walk: { path: [[-200, -260], [-60, -140], [120, -150], [240, -260]], end: 12, cadence: 1.6 }, pose: { shoulderL: [0, 0, 50], shoulderR: [0, 0, -50] } },
      { who: "bo", id: "tu", look: VILLAGERS.tu, at: [-300, 0, -340], walk: { path: [[-300, -340], [-200, -200], [-20, -140], [180, -170]], end: 12, cadence: 1.6 }, pose: { shoulderL: [0, 0, 50], shoulderR: [0, 0, -50] } },
      { who: "ba", at: [120, 0, -120], walk: { path: [[120, -120], [260, -220], [220, -380], [40, -420]], end: 12, cadence: 1.4 }, pose: { shoulderL: [0, 0, 50], shoulderR: [0, 0, -50] } },
    ],
  } },
  { after: "6.11", shot: {
    id: "6.11a", scene: "Đêm hội", shotType: "Close — the mooncake", dur: 10, pal: "festival",
    desc: "Bà đưa cho Tí chiếc bánh nướng thơm lừng.",
    set: square,
    props: (p) => ({ solids: [{ id: "banh", type: "cylinder", r: 13, h: 9, segments: 10, at: [0, -6, 14], fill: mix("#c98a3c", p.tint, p.tintAmount), shading: "faceted", shadow: false, attach: { part: "ba", joint: "wristR" } }] }),
    cam: { az: 70, el: 6, zoom: 6.5, focus: [Q.table[0] - 10, 80, Q.table[2] + 100] },
    actors: [
      { who: "ba", at: [Q.table[0] - 60, 0, Q.table[2] + 90], yaw: 90, tracks: [K("pose.shoulderR", [0, [0, 0, 0]], [2, [-70, 0, 0]], [9, [-70, 0, 0]])] },
      { who: "ti", at: seated("ti", [Q.table[0] + 40, 0, Q.table[2] + 110], 0), yaw: -90, hero: true, talks: true, pose: { ...SIT_GROUND }, tracks: [K("pose.shoulderR", [3, [0, 0, 0]], [4, [-80, 0, 0]], [9, [-80, 0, 0]])] },
    ],
    line: { by: "ti", text: "Con cảm ơn bà ạ! Bánh thơm quá!", offset: 4.5 },
  } },
  { after: "6.12", shot: {
    id: "6.12a", scene: "Thả đèn", shotType: "Medium — releasing lanterns", dur: 13, pal: "festival",
    desc: "Lũ trẻ ra bờ sông thả những chiếc đèn nhỏ xuống nước.",
    set: riverside,
    props: (p) => floaters(p, 6, R.waterZ, 13),
    tracks: floaters({} as Palette, 6, R.waterZ, 13).tracks,
    cam: { az: -16, el: 8, zoom: 2.6, focus: [-300, 60, 100] },
    actors: [
      { who: "ti", at: [-380, 0, 30], hero: true, lantern: "lit", pose: { spine: [24, 0, 0], shoulderL: [-70, 0, 0] } },
      { who: "lan", at: [-240, 0, 20], pose: { spine: [24, 0, 0], shoulderR: [-70, 0, 0] } },
      { who: "lan", id: "hoa", look: KIDS.hoa, at: [-520, 0, 40], yaw: 20, pose: { spine: [20, 0, 0], shoulderR: [-60, 0, 0] } },
    ],
    transition: ["dissolve", 1.5],
  } },
  { after: "6.12a", shot: {
    id: "6.12b", scene: "Thả đèn", shotType: "Extreme wide — river of light", dur: 16, pal: "festival",
    desc: "Dòng sông lấp lánh ánh đèn trôi dưới trăng rằm.",
    set: riverside,
    props: (p) => floaters(p, 14, R.waterZ, 16),
    tracks: floaters({} as Palette, 14, R.waterZ, 16).tracks,
    cam: { az: 6, el: 20, zoom: 2.0, focus: [0, 10, 220] },
    camTo: { az: 14, el: 22, zoom: 1.7, focus: [200, 10, 220] },
    sky: { moonAt: [1300, 200] },
  } },
  { after: "6.12b", shot: {
    id: "6.12c", scene: "Về nhà", shotType: "Tracking — walking home", dur: 14, pal: "night",
    desc: "Khuya, bà nắm tay Tí đi về nhà qua con đường làng.",
    set: (p) => village(p),
    cam: { az: 22, el: 6, zoom: 2.4, focus: [0, 70, 100] },
    follow: "ti", followOffset: [0, 70, 0],
    actors: [
      { who: "ti", at: [600, 0, 140], hero: true, lantern: "lit", walk: { path: [[600, 140], [-500, 100]], end: 14, cadence: 1.8 } },
      { who: "ba", at: [640, 0, 60], walk: { path: [[640, 60], [-460, 20]], end: 14, cadence: 1.4 } },
    ],
    transition: ["dissolve", 1.5],
  } },
];

/** Splice extras into a chapter list (by `after` id). */
export function withExtras(shots: ShotDef[]): ShotDef[] {
  const out: ShotDef[] = [];
  const pending = (id: string) => EXTRAS.filter((e) => e.after === id).map((e) => e.shot);
  const push = (s: ShotDef) => {
    out.push(s);
    for (const x of pending(s.id)) push(x);
  };
  shots.forEach(push);
  return out;
}

export type { SetPiece };
