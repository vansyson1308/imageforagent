/** Chương 2 — Cơn gió chiều (dusk → night): the wind takes the lantern into the river. */
import { village } from "./sets";
import type { ShotDef } from "./shots";
import { firefly, merge } from "./kit";
import { HOLD_LANTERN, K, KIDS, SAD, SIT_GROUND, hop, looseLantern, seated, withProps } from "./acting";

/** Everyone's lanterns at the banyan (unlit at dusk). */
const kidsAtBanyan = [
  { who: "ti" as const, at: [800, 0, -300] as [number, number, number], yaw: 10, lantern: "dark" as const, pose: HOLD_LANTERN, hero: true },
  { who: "lan" as const, at: [920, 0, -270] as [number, number, number], yaw: -30, pose: HOLD_LANTERN },
  { who: "lan" as const, id: "hoa", look: KIDS.hoa, at: [690, 0, -340] as [number, number, number], yaw: 30 },
  { who: "ti" as const, id: "minh", look: KIDS.minh, at: [1030, 0, -330] as [number, number, number], yaw: -50 },
];

/** Trees sway in the gust: seeded wiggles on the canopies. */
const gustRigs = (start = 0) => [
  { type: "wiggle", target: "parts.t1.rotate", amplitude: [3, 0, 6], frequency: 0.9, seed: 11, start },
  { type: "wiggle", target: "solids.dqC3.rotate", amplitude: [2, 0, 5], frequency: 1.1, seed: 12, start },
];

export const CH2: ShotDef[] = [
  {
    id: "2.01", scene: "Chiều gió", shotType: "Establishing — slow pan", dur: 13, pal: "dusk",
    desc: "Hoàng hôn buông xuống làng. Đèn trong nhà bắt đầu sáng.",
    set: (p) => village(p),
    cam: { az: 22, el: 10, zoom: 0.62, focus: [-300, 60, -400] },
    camTo: { az: 12, el: 9, zoom: 0.66, focus: [300, 60, -400] },
    transition: ["fadeBlack", 1.5],
    line: { by: "narrator", text: "Chiều hôm ấy, lũ trẻ trong làng rủ nhau ra gốc đa khoe đèn.", offset: 1.5 },
  },
  {
    id: "2.02", scene: "Chiều gió", shotType: "Wide — static", dur: 12, pal: "dusk",
    desc: "Lũ trẻ tụ tập dưới gốc đa. Tí giơ cao chiếc đèn ông sao.",
    set: (p) => village(p),
    cam: { az: 8, el: 7, zoom: 3, focus: [860, 70, -310] },
    actors: [
      { ...kidsAtBanyan[0], tracks: [K("pose.shoulderR", [3, [-35, 0, 8]], [4, [-20, 0, -140]], [8, [-20, 0, -140]], [9, [-35, 0, 8]])] },
      { ...kidsAtBanyan[1], tracks: hop(4.5, 16, 2) },
      kidsAtBanyan[2],
      kidsAtBanyan[3],
    ],
  },
  {
    id: "2.03", scene: "Chiều gió", shotType: "Close — proud", dur: 8, pal: "dusk",
    desc: "Tí hãnh diện, chiếc đèn đỏ rực trong nắng chiều.",
    set: (p) => village(p),
    cam: { az: -6, el: 3, zoom: 8, focus: [805, 100, -300], screen: [1080, 600] },
    actors: [{ ...kidsAtBanyan[0], pose: { shoulderR: [-10, 0, -165], elbowR: [-10, 0, 0] } }],
  },
  {
    id: "2.04", scene: "Chiều gió", shotType: "Medium — wind rises", dur: 10, pal: "dusk",
    desc: "Gió nổi lên. Cây đa rung lá, lũ trẻ ngước nhìn.",
    set: (p) => village(p),
    cam: { az: 20, el: 9, zoom: 2.6, focus: [820, 90, -320] },
    actors: kidsAtBanyan.map((k, i) => ({ ...k, tracks: [K("pose.neck", [1 + i * 0.3, [0, 0, 0]], [2 + i * 0.3, [-18, (i % 2 ? 1 : -1) * 25, 0]], [9, [-18, (i % 2 ? 1 : -1) * 25, 0]])] })),
    rigs: [
      ...gustRigs(1),
      { type: "wiggle", target: "solids.dqC1.rotate", amplitude: [2, 0, 4], frequency: 0.8, seed: 21, start: 1 },
      { type: "wiggle", target: "solids.dqC2.rotate", amplitude: [3, 0, 5], frequency: 1.0, seed: 22, start: 1 },
    ],
  },
  {
    id: "2.05", scene: "Chiều gió", shotType: "Medium — the gust", dur: 10, pal: "dusk",
    desc: "Một cơn gió mạnh giật chiếc đèn khỏi tay Tí, cuốn bay lên cao.",
    set: (p) => village(p),
    props: (p) => looseLantern("flyDen", p, [790, 96, -262], [-10, 0, 0], "dark", 1.6),
    cam: { az: 14, el: 8, zoom: 3.2, focus: [780, 110, -250] },
    camTo: { az: 4, el: 14, zoom: 1.8, focus: [620, 200, -60] },
    actors: [
      { who: "ti", at: [800, 0, -300], yaw: 10, hero: true, still: true,
        tracks: [K("pose.shoulderR", [0, [-35, 0, 8]], [1.3, [-35, 0, 8]], [1.8, [-160, 0, -20]], [4, [-170, 0, -10]], [6, [-60, 0, 0]]),
                 K("pose.neck", [1.2, [0, 0, 0]], [2.2, [-30, 0, 0]], [6, [-30, 0, 0]]),
                 K("rotate.1", [4, 10], [5, 150])] },
      { who: "lan", at: [920, 0, -270], yaw: -30, pose: HOLD_LANTERN, tracks: [K("pose.neck", [1.5, [0, 0, 0]], [2.5, [-30, 0, 0]])] },
    ],
    tracks: [
      K("solids.flyDen.at", [0, [790, 96, -262]], [1.3, [790, 96, -262]], [2.5, [760, 190, -200]], [4.5, [680, 320, -80]], [7, [520, 300, 80]], [10, [300, 240, 240]]),
      K("solids.flyDen.rotate", [1.3, [-10, 0, 0]], [4, [60, 80, 200]], [7, [120, 160, 400]], [10, [200, 220, 620]]),
    ],
    rigs: gustRigs(0),
  },
  {
    id: "2.06", scene: "Chiều gió", shotType: "Tracking — chase along the bank", dur: 14, pal: "dusk",
    desc: "Tí chạy theo chiếc đèn dọc bờ sông.",
    set: (p) => village(p),
    props: (p) => looseLantern("flyDen", p, [420, 240, 200], [40, 60, 200], "dark", 1.6),
    cam: { az: 6, el: 6, zoom: 2.6, focus: [600, 60, 180] },
    follow: "ti", followOffset: [-160, 80, 0],
    actors: [{ who: "ti", at: [640, 0, -120], hero: true, walk: { path: [[640, -120], [420, 150], [-100, 220], [-500, 230]], end: 13.5, cadence: 3.6, armSwing: 40, lean: 12 },
      tracks: [K("pose.shoulderR", [0, [-150, 0, -20]], [3, [-150, 0, -20]], [4, [0, 0, 0]], [9, [0, 0, 0]], [10, [-150, 0, -20]])] }],
    tracks: [
      K("solids.flyDen.at", [0, [420, 240, 200]], [3, [160, 280, 240]], [6, [-120, 220, 250]], [9, [-380, 250, 270]], [12, [-640, 170, 300]], [14, [-800, 120, 320]]),
      K("solids.flyDen.rotate", [0, [40, 60, 200]], [14, [300, 400, 1100]]),
    ],
  },
  {
    id: "2.07", scene: "Chiều gió", shotType: "Wide — the lantern falls", dur: 12, pal: "dusk",
    desc: "Chiếc đèn rơi xuống sông và trôi xa dần. Tí chạy tới bờ, không kịp.",
    set: (p) => village(p),
    props: (p) => looseLantern("flyDen", p, [-700, 180, 320], [120, 200, 800], "dark", 1.6),
    cam: { az: 10, el: 12, zoom: 2.6, focus: [-760, 40, 330] },
    camTo: { az: 14, el: 11, zoom: 2.6, focus: [-980, 30, 380] },
    actors: [{ who: "ti", at: [-420, 0, 220], hero: true, walk: { path: [[-420, 220], [-700, 245]], end: 4, cadence: 3.4, lean: 10 } }],
    tracks: [
      K("solids.flyDen.at", [0, [-700, 180, 320]], [1.6, [-760, 40, 360]], [2.2, [-790, 6, 380]], [12, [-1500, 6, 430]]),
      K("solids.flyDen.rotate", [0, [120, 200, 800]], [2.2, [-90, 0, 830]], [12, [-90, 0, 900]]),
    ],
    rigs: [{ type: "wiggle", target: "solids.flyDen.at", amplitude: [2, 3, 2], frequency: 0.8, seed: 31, start: 2.4 }],
  },
  {
    id: "2.08", scene: "Chiều gió", shotType: "Medium — reaching", dur: 10, pal: "dusk",
    desc: "Tí cúi người với theo, bàn tay chỉ chạm mặt nước.",
    set: (p) => village(p),
    props: (p) => looseLantern("flyDen", p, [-1100, 6, 410], [-90, 0, 860], "dark", 1.6),
    cam: { az: -24, el: 6, zoom: 4.4, focus: [-760, 60, 250] },
    actors: [{ who: "ti", at: [-720, 0, 240], yaw: -30, hero: true, talks: true, still: true,
      pose: { spine: [32, 0, 0], neck: [-18, 0, 0], kneeL: [26, 0, 0], kneeR: [26, 0, 0] } }],
    rigs: [{ type: "ik", part: "ti", limb: "armR", target: [-800, 22, 300], weight: 1, fade: 0.6, start: 0.5, end: 7 }],
    tracks: [K("solids.flyDen.at", [0, [-860, 6, 380]], [10, [-1180, 6, 430]])],
    line: { by: "ti", text: "Đèn của con! Đèn ơi!", offset: 1.2 },
  },
  {
    id: "2.09", scene: "Chiều gió", shotType: "Close — sadness", dur: 9, pal: "dusk",
    desc: "Tí đứng lặng bên bờ sông, mắt rưng rưng.",
    set: (p) => village(p),
    cam: { az: -40, el: 2, zoom: 8.5, focus: [-720, 100, 240], screen: [1100, 580] },
    actors: [{ who: "ti", at: [-720, 0, 240], yaw: -20, hero: true, pose: SAD, tracks: [K("pose.neck", [0, SAD.neck], [5, [22, 0, 0]], [9, [24, 0, 0]])] }],
  },
  {
    id: "2.10", scene: "Chiều gió", shotType: "Two-shot — comfort", dur: 13, pal: "dusk",
    desc: "Bà tìm đến, đặt tay lên vai Tí an ủi.",
    set: (p) => village(p),
    cam: { az: -14, el: 7, zoom: 3.6, focus: [-640, 80, 200] },
    actors: [
      { who: "ti", at: [-720, 0, 240], yaw: -20, hero: true, pose: SAD },
      { who: "ba", at: [-300, 0, 60], talks: true, walk: { path: [[-300, 60], [-640, 210]], end: 5, cadence: 1.7 } },
    ],
    rigs: [{ type: "ik", part: "ba", limb: "armR", target: [-705, 92, 235], weight: 1, fade: 0.8, start: 5.2 }],
    line: { by: "ba", text: "Đừng buồn, cháu ngoan của bà. Về nhà thôi con.", offset: 6 },
  },
  {
    id: "2.11", scene: "Chiều gió", shotType: "Extreme wide — night falls", dur: 14, pal: "night",
    desc: "Đêm xuống. Làng lên đèn. Tí vẫn ngồi một mình bên bờ sông.",
    set: (p) => village(p),
    cam: { az: 12, el: 9, zoom: 0.7, focus: [-500, 40, 100] },
    camTo: { az: 14, el: 8, zoom: 0.85, focus: [-650, 40, 180] },
    sky: { moonAt: [1500, 380] },
    actors: [{ who: "ti", at: seated("ti", [-720, 0, 250], 4), yaw: 0, hero: true, pose: { ...SIT_GROUND, ...SAD } }],
    transition: ["dissolve", 2],
  },
  {
    id: "2.12", scene: "Chiều gió", shotType: "Medium — a spark", dur: 12, pal: "night",
    desc: "Một đốm sáng nhỏ lập loè bay lên từ mặt nước.",
    set: (p) => withProps(village, () => ({}))(p),
    props: () => merge({ solids: firefly("domdom", [-790, 8, 420], true) }),
    cam: { az: -12, el: 5, zoom: 4.6, focus: [-725, 60, 300], screen: [999, 640] },
    actors: [{ who: "ti", at: seated("ti", [-720, 0, 250], 4), yaw: 0, hero: true, pose: { ...SIT_GROUND, ...SAD },
      tracks: [K("pose.neck", [0, SAD.neck], [6, SAD.neck], [7.5, [-12, 0, 0]])] }],
    tracks: [
      K("solids.domdom.at", [0, [-790, 8, 420]], [3, [-770, 50, 400]], [6, [-740, 80, 360]], [9, [-715, 95, 320]], [12, [-735, 100, 310]]),
      K("solids.domdom.effects.glow.opacity", [0, 0.05], [1, 0.6], [2, 0.2], [3, 0.7], [5, 0.3], [6, 0.75], [12, 0.7]),
    ],
  },
];
