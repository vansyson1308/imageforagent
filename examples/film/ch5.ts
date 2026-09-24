/** Chương 5 — Ánh trăng (night, magic): the fireflies light the lantern; the hilltop; farewell. */
import { hilltop, paddies, pond } from "./sets";
import type { ShotDef } from "./shots";
import { firefly } from "./kit";
import { HOLD_LANTERN, K, LOOK_UP, guide, hop, swarm, wave } from "./acting";

/** The torn lantern glowing up: the held lantern's paper + halo keyed from dark to lit. */
const lightUp = (id: string, t0: number, t1: number) => [
  K(`solids.${id}.fill`, [0, "#6b4a3a"], [t0, "#6b4a3a"], [t1, "#ff6a3d"]),
];

/** Hill profile: y of the dome surface at radius r (hill r=900, flattened 0.6, centre y −380). */
const hillY = (x: number) => Math.max(0, -380 + 0.6 * Math.sqrt(Math.max(0, 900 * 900 - x * x)));

export const CH5: ShotDef[] = [
  {
    id: "5.01", scene: "Hồ sen", shotType: "Medium — the fireflies gather", dur: 14, pal: "night",
    desc: "Đom đóm từ khắp nơi bay về, đậu quanh chiếc đèn rách trên tay Tí.",
    set: pond,
    props: () => swarm("sw", [0, 120, 0], 18, 260, 14, { converge: [-10, 96, 40], convergeAt: 5 }),
    cam: { az: 14, el: 6, zoom: 4.2, focus: [0, 90, 0] },
    camTo: { az: 6, el: 5, zoom: 5.5, focus: [0, 95, 20] },
    actors: [{ who: "ti", at: [0, 0, 0], hero: true, lantern: "torn", pose: { ...HOLD_LANTERN, shoulderR: [-60, 0, 20], elbowR: [-40, 0, 0] },
      tracks: [K("pose.neck", [0, [18, 0, 0]], [4, [0, 20, 0]], [8, [-10, -20, 0]], [13, [6, 0, 0]])] }],
    tracks: swarm("sw", [0, 120, 0], 18, 260, 14, { converge: [-10, 96, 40], convergeAt: 5 }).tracks,
    transition: ["dissolve", 1.5],
    line: { by: "narrator", text: "Rồi những chú đom đóm bay về, đậu lên chiếc đèn nhỏ, như những ngọn nến tí hon.", offset: 1 },
  },
  {
    id: "5.02", scene: "Hồ sen", shotType: "Close — the lantern glows", dur: 10, pal: "night",
    desc: "Chiếc đèn ông sao sáng bừng lên trong tay Tí.",
    set: pond,
    props: () => swarm("sw", [-10, 96, 40], 10, 40, 10),
    cam: { az: 20, el: 4, zoom: 9, focus: [-10, 100, 30], screen: [999, 560] },
    actors: [{ who: "ti", at: [0, 0, 0], hero: true, lantern: "lit", pose: { shoulderR: [-60, 0, 20], elbowR: [-40, 0, 0], neck: [10, 0, 0] } }],
    tracks: [...lightUp("tiDen", 1, 5), ...swarm("sw", [-10, 96, 40], 10, 40, 10).tracks,
      K("solids.tiDen.effects.glow.opacity", [0, 0.02], [1, 0.02], [5, 0.6], [10, 0.6]),
      K("solids.tiDen.effects.glow.size", [0, 1.1], [5, 2.8], [10, 2.6])],
  },
  {
    id: "5.03", scene: "Hồ sen", shotType: "Close — joy", dur: 9, pal: "night",
    desc: "Gương mặt Tí bừng sáng. Cậu reo lên.",
    set: pond,
    cam: { az: -10, el: 3, zoom: 7.5, focus: [0, 100, 0] },
    actors: [{ who: "ti", at: [0, 0, 0], hero: true, talks: true, lantern: "lit", pose: { shoulderR: [-10, 0, -165], elbowR: [-10, 0, 0] }, tracks: hop(4.5, 22, 2) }],
    line: { by: "ti", text: "Sáng rồi! Đèn sáng rồi!", offset: 0.6 },
  },
  {
    id: "5.04", scene: "Hồ sen", shotType: "Wide — the pond aglow", dur: 12, pal: "night",
    desc: "Cả hồ sen lấp lánh ánh đom đóm, trăng soi đáy nước.",
    set: pond,
    props: () => ({ solids: [...swarm("sw", [0, 120, -140], 22, 520, 12).solids, { id: "moonGlint", type: "sphere", r: 60, segments: 12, at: [260, 4, -180], scale: [1.6, 0.02, 0.7], fill: "#e8e2b8", shading: "none", shadow: false, effects: { glow: { mode: "halo", size: 1.6, opacity: 0.25 } } }] }),
    cam: { az: 4, el: 16, zoom: 1.3, focus: [0, 60, -180] },
    camTo: { az: 14, el: 12, zoom: 1.5, focus: [0, 60, -150] },
    actors: [{ who: "ti", at: [0, 0, 0], hero: true, lantern: "lit", pose: HOLD_LANTERN }],
    tracks: swarm("sw", [0, 120, -140], 22, 520, 12).tracks,
  },
  {
    id: "5.05", scene: "Đồi trăng", shotType: "Tracking — the climb", dur: 15, pal: "night",
    desc: "Đom đóm dẫn Tí leo lên ngọn đồi cao.",
    set: hilltop,
    props: () => guide("dd", [[0, [-500, 260, 60]]]),
    cam: { az: 4, el: 4, zoom: 2.6, focus: [-600, 180, 60] },
    follow: "ti", followOffset: [120, 90, 0],
    actors: [{ who: "ti", at: [-760, hillY(-760), 60], hero: true, lantern: "lit", walk: { path: [[-760, 60], [-60, 60]], end: 15, cadence: 1.8, lean: 12 },
      tracks: [{ target: "at.1", keys: Array.from({ length: 11 }, (_, i) => ({ t: 1.5 * i, v: Math.round(hillY(-760 + 70 * i)), ...(i ? { ease: "linear" } : {}) })) }] }],
    tracks: [K("solids.dd.at", [0, [-500, 260, 60]], [5, [-300, 300, 60]], [10, [-80, 330, 60]], [15, [60, 320, 40]])],
    sky: { moonAt: [1300, 300] },
    transition: ["dissolve", 1.5],
  },
  {
    id: "5.06", scene: "Đồi trăng", shotType: "Hero — silhouette against the moon", dur: 15, pal: "night",
    desc: "Trên đỉnh đồi, bóng Tí nhỏ bé in trên vầng trăng tròn vành vạnh.",
    set: hilltop,
    cam: { az: 0, el: 0, zoom: 2.2, focus: [0, 180, 0], screen: [999, 700] },
    camTo: { az: 0, el: 1, zoom: 2.8, focus: [0, 190, 0], screen: [999, 700] },
    actors: [{ who: "ti", at: [0, hillY(0), 0], yaw: 180, hero: true, lantern: "lit", pose: { shoulderR: [-20, 0, -130], elbowR: [-10, 0, 0] } }],
    sky: { moonAt: [999, 520], moonScale: 3.2 },
  },
  {
    id: "5.07", scene: "Đồi trăng", shotType: "POV — the village lights up", dur: 15, pal: "night",
    desc: "Nhìn từ đỉnh đồi: ngôi làng xa xa lần lượt thắp đèn, từng ngọn một.",
    set: (p) => hilltop(p, { villageLit: 9 }),
    cam: { az: 0, el: 8, zoom: 1.6, focus: [0, 60, -1850], screen: [999, 620] },
    camTo: { az: 0, el: 7, zoom: 1.9, focus: [0, 60, -1850], screen: [999, 620] },
    actors: [{ who: "ti", at: [0, hillY(0), 0], yaw: 180, hero: true, lantern: "lit", pose: HOLD_LANTERN }],
    tracks: Array.from({ length: 9 }, (_, i) => [
      K(`solids.fvL${i}.fill`, [0, "#2a2a40"], [2 + i * 1.3, "#2a2a40"], [2.6 + i * 1.3, i % 2 ? "#f2b632" : "#e8412f"]),
      K(`solids.fvL${i}.effects.glow.opacity`, [0, 0.01], [2 + i * 1.3, 0.01], [2.8 + i * 1.3, 0.5]),
    ]).flat(),
  },
  {
    id: "5.08", scene: "Đồi trăng", shotType: "Medium — farewell", dur: 12, pal: "night",
    desc: "Đom đóm nghiêng mình chào Tí, rồi bay vút lên phía vầng trăng.",
    set: hilltop,
    props: () => ({ solids: firefly("dd", [60, 260, 40], true) }),
    cam: { az: -20, el: 4, zoom: 3.8, focus: [20, 230, 0] },
    actors: [{ who: "ti", at: [0, hillY(0), 0], yaw: -20, hero: true, lantern: "lit", pose: { ...HOLD_LANTERN, ...LOOK_UP } }],
    tracks: [
      K("solids.dd.at", [0, [60, 260, 40]], [2, [40, 240, 50]], [3, [50, 262, 40]], [5, [60, 250, 40]], [8, [200, 420, -200]], [12, [500, 800, -900]]),
      K("solids.dd.effects.glow.opacity", [0, 0.7], [9, 0.7], [12, 0.1]),
    ],
  },
  {
    id: "5.09", scene: "Đồi trăng", shotType: "Close — goodbye", dur: 10, pal: "night",
    desc: "Tí vẫy tay chào đom đóm.",
    set: hilltop,
    cam: { az: 16, el: 2, zoom: 6.5, focus: [0, hillY(0) + 90, 0] },
    actors: [{ who: "ti", at: [0, hillY(0), 0], yaw: 200, hero: true, talks: true, pose: LOOK_UP, tracks: [wave(2, 4)] }],
    line: { by: "ti", text: "Cảm ơn đom đóm! Tạm biệt nhé!", offset: 1.5 },
  },
  {
    id: "5.10", scene: "Đồi trăng", shotType: "Wide — running home", dur: 13, pal: "night",
    desc: "Tí chạy xuống đồi, băng qua đồng lúa về làng, chiếc đèn sáng rực trong tay.",
    set: paddies,
    cam: { az: -10, el: 8, zoom: 2.8, focus: [600, 60, 0] },
    follow: "ti", followOffset: [-100, 70, 0],
    actors: [{ who: "ti", at: [900, 0, 0], hero: true, lantern: "lit", walk: { path: [[900, 0], [-900, 0]], end: 13, cadence: 3.6, lean: 12 } }],
    sky: { moonAt: [600, 220] },
    transition: ["dissolve", 1.5],
  },
];
