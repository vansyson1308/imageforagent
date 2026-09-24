/** Chương 4 — Cầu khỉ (night): the monkey bridge, the sleeping buffalo, the lotus pond. */
import { MARKS, buffalo, forest, pond, stream } from "./sets";
import type { ShotDef } from "./shots";
import { merge } from "./kit";
import { K, SAD, guide, handle, hop, looseLantern } from "./acting";

const S = MARKS.stream;
const P = MARKS.pond;
const deck = S.deckY + 4;

/** Stepping-stone path across the pond (x, z) + a hop on each stone. */
const stonePath: [number, number][] = [[-560, 120], ...P.stones, [P.rock[0] - 60, P.rock[2] + 30]];
const stoneHops = () => {
  const keys: { t: number; v: number; ease?: string }[] = [{ t: 0, v: 0 }];
  for (let i = 0; i < 5; i++) {
    const t = 1.6 + i * 2.2;
    keys.push({ t, v: 0, ease: "inOut" }, { t: t + 0.5, v: 30, ease: "out" }, { t: t + 1, v: 12, ease: "in" });
  }
  keys.push({ t: 13, v: 12, ease: "inOut" });
  return [{ target: "at.1", keys, blend: "add" as const }];
};

export const CH4: ShotDef[] = [
  {
    id: "4.01", scene: "Cầu khỉ", shotType: "Wide — the stream", dur: 13, pal: "night",
    desc: "Con suối chắn ngang lối đi. Chỉ có một cây cầu khỉ mảnh mai.",
    set: stream,
    props: () => guide("dd", [[0, [0, 160, -20]]]),
    cam: { az: 24, el: 10, zoom: 1.5, focus: [0, 60, 0] },
    camTo: { az: 14, el: 8, zoom: 1.8, focus: [-120, 60, 0] },
    actors: [{ who: "ti", at: [-600, 0, 60], hero: true, walk: { path: [[-600, 60], [-330, 10]], end: 6, cadence: 2 } }],
    tracks: [K("solids.dd.at", [0, [0, 160, -20]], [6, [180, 180, -10]], [13, [320, 150, 0]])],
    transition: ["fadeBlack", 1.5],
    line: { by: "narrator", text: "Qua rừng tre, qua cầu khỉ, cậu bé cứ đi theo ánh sáng nhỏ ấy.", offset: 1.5 },
  },
  {
    id: "4.02", scene: "Cầu khỉ", shotType: "Medium — hesitation", dur: 10, pal: "night",
    desc: "Tí nhìn xuống dòng nước chảy xiết, ngập ngừng.",
    set: stream,
    cam: { az: -50, el: 6, zoom: 4.2, focus: [-320, 80, 0], screen: [1100, 620] },
    actors: [{ who: "ti", at: [-330, 0, 10], yaw: 90, hero: true, tracks: [K("pose.neck", [0, [0, 0, 0]], [2, [22, 0, 0]], [5, [22, 0, 0]], [6.5, [0, 0, 0]]), K("pose.spine", [1, [0, 0, 0]], [2, [12, 0, 0]], [5, [12, 0, 0]], [6, [0, 0, 0]])] }],
  },
  {
    id: "4.03", scene: "Cầu khỉ", shotType: "Tracking — crossing", dur: 16, pal: "night",
    desc: "Tí bước lên thân tre, một tay vịn lan can, từng bước chậm rãi.",
    set: (p) => merge(stream(p), { solids: [handle("railHand", [S.bridgeFrom[0] + 20, deck + 64, -24])] }),
    cam: { az: 8, el: 5, zoom: 3.2, focus: [-200, 80, 0] },
    follow: "ti", followOffset: [0, 90, 0],
    actors: [{ who: "ti", at: [S.bridgeFrom[0], deck, 0], hero: true, walk: { path: [[S.bridgeFrom[0], 0], [150, 0]], start: 0.5, end: 16, cadence: 1.4, armSwing: 4, bounce: 0.4 },
      pose: { shoulderR: [0, 0, -70] } }],
    rigs: [{ type: "ik", part: "ti", limb: "armL", target: { solid: "railHand" }, weight: 1, fade: 0.6 }],
    tracks: [K("solids.railHand.at", [0, [S.bridgeFrom[0] + 20, deck + 64, -24]], [16, [180, deck + 64, -24]])],
    transition: ["dissolve", 1],
  },
  {
    id: "4.04", scene: "Cầu khỉ", shotType: "Medium — the wobble", dur: 10, pal: "night",
    desc: "Cây cầu rung lắc. Tí khựng lại, dang tay giữ thăng bằng.",
    set: stream,
    cam: { az: 72, el: 4, zoom: 4, focus: [150, deck + 70, 0] },
    actors: [{ who: "ti", at: [150, deck, 0], yaw: 90, hero: true, still: true,
      tracks: [K("pose.shoulderL", [0, [0, 0, 0]], [0.6, [0, 0, 80]], [7, [0, 0, 80]], [8.5, [0, 0, 20]]), K("pose.shoulderR", [0, [0, 0, 0]], [0.6, [0, 0, -80]], [7, [0, 0, -80]], [8.5, [0, 0, -20]]),
               K("pose.spine", [0, [0, 0, 0]], [1, [0, 0, 12]], [2, [0, 0, -14]], [3, [0, 0, 10]], [4, [0, 0, -8]], [5, [0, 0, 5]], [6, [0, 0, -3]], [7, [0, 0, 0]])] }],
    tracks: [K("solids.log.rotate", [0, [0, 0, 90]], [1, [6, 0, 90]], [2, [-6, 0, 90]], [3, [4, 0, 90]], [4, [-3, 0, 90]], [5, [2, 0, 90]], [7, [0, 0, 90]])],
  },
  {
    id: "4.05", scene: "Cầu khỉ", shotType: "Close — determination", dur: 8, pal: "night",
    desc: "Tí hít một hơi, mím môi, bước tiếp.",
    set: stream,
    cam: { az: 20, el: 2, zoom: 8, focus: [150, deck + 100, 0], screen: [960, 560] },
    actors: [{ who: "ti", at: [150, deck, 0], yaw: 70, hero: true, pose: { shoulderL: [0, 0, 20], shoulderR: [0, 0, -20] }, tracks: [K("pose.neck", [0, [10, 0, 0]], [3, [-8, 0, 0]], [8, [-8, 0, 0]])] }],
  },
  {
    id: "4.06", scene: "Cầu khỉ", shotType: "Wide — made it", dur: 10, pal: "night",
    desc: "Qua được bờ bên kia, Tí nhảy xuống, reo lên khe khẽ.",
    set: stream,
    cam: { az: 16, el: 8, zoom: 2.4, focus: [320, 60, 0] },
    actors: [{ who: "ti", at: [160, deck, 0], hero: true, walk: { path: [[160, 0], [300, 0], [420, 30]], end: 4, cadence: 1.8, bounce: 0.5 },
      tracks: [K("at.1", [0, deck], [3, deck], [3.5, 0]), ...hop(5, 26, 2)] }],
  },
  {
    id: "4.07", scene: "Con trâu", shotType: "Medium — the sleeping buffalo", dur: 10, pal: "night",
    desc: "Một con trâu nằm ngủ chắn lối. Tí rón rén, nín thở đi vòng qua.",
    set: (p) => merge(forest(p), buffalo("trau", p, [120, -22, -40], 0)),
    cam: { az: 10, el: 7, zoom: 2.6, focus: [60, 70, 40] },
    actors: [{ who: "ti", at: [-360, 0, 120], hero: true, walk: { path: [[-360, 120], [-40, 150], [120, 160]], end: 10, cadence: 1.2, armSwing: 6, lean: 8 },
      tracks: [K("pose.shoulderL", [0, [-40, 0, 30]]), K("pose.shoulderR", [0, [-40, 0, -30]])] }],
    rigs: [{ type: "wiggle", target: "groups.trauG.at", amplitude: [0, 1.5, 0], frequency: 0.3, seed: 4 }],
  },
  {
    id: "4.08", scene: "Con trâu", shotType: "Wide — the buffalo wakes", dur: 8, pal: "night",
    desc: "Trâu phì phò ngẩng đầu, vẫy đuôi. Tí co giò chạy biến.",
    set: (p) => merge(forest(p), buffalo("trau", p, [120, -22, -40], 0)),
    cam: { az: 24, el: 8, zoom: 2.0, focus: [300, 70, 80] },
    actors: [{ who: "ti", at: [120, 0, 160], hero: true, walk: { path: [[120, 160], [760, 190]], start: 1.6, end: 6.5, cadence: 3.8, armSwing: 45, lean: 14 },
      tracks: [K("pose.neck", [0, [0, -40, 0]], [1.4, [0, -40, 0]], [1.8, [0, 0, 0]])] }],
    rigs: [{ type: "wiggle", target: "solids.trauTail.rotate", amplitude: [0, 0, 25], frequency: 1.4, seed: 5 }],
    tracks: [K("groups.trauG.rotate", [0, [0, 0, 0]], [0.8, [0, 26, 0]], [8, [0, 26, 0]]), K("groups.trauG.at", [0, [120, -22, -40]], [0.8, [120, -10, -40]])],
  },
  {
    id: "4.09", scene: "Hồ sen", shotType: "Establishing — crane down", dur: 14, pal: "night",
    desc: "Một hồ sen dưới chân thác nhỏ. Trên tảng đá giữa hồ — chiếc đèn ông sao!",
    set: pond,
    props: (p) => looseLantern("lostDen", p, [P.rock[0], 58, P.rock[2]], [-20, 30, 12], "torn"),
    cam: { az: 6, el: 22, zoom: 1.1, focus: [0, 80, -250] },
    camTo: { az: 12, el: 9, zoom: 3.0, focus: [60, 50, -130] },
    actors: [{ who: "ti", at: [-620, 0, 200], hero: true, walk: { path: [[-620, 200], [-540, 140]], start: 6, end: 9, cadence: 1.8 } }],
    transition: ["dissolve", 2],
  },
  {
    id: "4.10", scene: "Hồ sen", shotType: "Close — found", dur: 8, pal: "night",
    desc: "Chiếc đèn rách tả tơi, nằm trên đá.",
    set: pond,
    props: (p) => looseLantern("lostDen", p, [P.rock[0], 58, P.rock[2]], [-20, 30, 12], "torn"),
    cam: { az: -20, el: 14, zoom: 7, focus: [P.rock[0], 55, P.rock[2]] },
    camTo: { az: -26, el: 12, zoom: 8.5, focus: [P.rock[0], 58, P.rock[2]] },
    line: { by: "ti", text: "Tìm thấy rồi!", offset: 2 },
  },
  {
    id: "4.11", scene: "Hồ sen", shotType: "Wide — stepping stones", dur: 14, pal: "night",
    desc: "Tí nhảy từng hòn đá qua hồ sen.",
    set: pond,
    props: (p) => looseLantern("lostDen", p, [P.rock[0], 58, P.rock[2]], [-20, 30, 12], "torn"),
    cam: { az: 12, el: 11, zoom: 2.2, focus: [-240, 50, -10] },
    camTo: { az: 18, el: 10, zoom: 2.6, focus: [-60, 50, -60] },
    actors: [{ who: "ti", at: [-560, 0, 120], hero: true, walk: { path: stonePath, end: 13, cadence: 1.4, bounce: 0.3 }, tracks: stoneHops() }],
  },
  {
    id: "4.12", scene: "Hồ sen", shotType: "Medium — reaching", dur: 10, pal: "night",
    desc: "Tí rướn người với lấy chiếc đèn trên tảng đá.",
    set: pond,
    props: (p) => looseLantern("lostDen", p, [P.rock[0], 58, P.rock[2]], [-20, 30, 12], "torn"),
    cam: { az: 100, el: 8, zoom: 4.2, focus: [20, 60, -100] },
    actors: [{ who: "ti", at: [P.rock[0] - 60, 12, P.rock[2] + 30], yaw: 120, hero: true, still: true, pose: { spine: [18, 0, 0] } }],
    rigs: [{ type: "ik", part: "ti", limb: "armR", target: { solid: "lostDen", offset: [0, 0, 6] }, weight: 1, fade: 1.2, start: 1, end: 6 }],
    tracks: [K("solids.lostDen.at", [0, [P.rock[0], 58, P.rock[2]]], [6.2, [P.rock[0], 58, P.rock[2]]], [8, [P.rock[0] - 40, 90, P.rock[2] + 20]])],
  },
  {
    id: "4.13", scene: "Hồ sen", shotType: "Close — the torn lantern", dur: 11, pal: "night",
    desc: "Tí nâng chiếc đèn rách trên tay. Nến đã tắt, giấy đã ướt.",
    set: pond,
    cam: { az: -8, el: 4, zoom: 6.5, focus: [10, 95, 20] },
    actors: [{ who: "ti", at: [0, 0, 0], yaw: -20, hero: true, lantern: "torn", pose: { ...SAD, shoulderR: [-35, 0, 8], elbowR: [-55, 0, 0] }, tracks: [K("pose.neck", [0, SAD.neck], [6, [20, 0, 0]])] }],
  },
];
