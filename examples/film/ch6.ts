/** Chương 6 — Đêm hội trăng rằm (festival): lion dance, lantern parade, reunion, mooncakes. */
import { MARKS, lion, square } from "./sets";
import type { Actor, ShotDef } from "./shots";
import { merge } from "./kit";
import { HOLD_LANTERN, K, KIDS, SIT_GROUND, VILLAGERS, carpLantern, hop, seated, swarm } from "./acting";

const Q = MARKS.square;

/** Drummer beating the drum: both forearms alternating at `bpm`. */
function drumming(dur: number, bpm = 132) {
  const beat = 60 / bpm;
  const kR: [number, number[]][] = [];
  const kL: [number, number[]][] = [];
  for (let t = 0, i = 0; t + beat * 0.45 < dur; t += beat, i++) {
    (i % 2 ? kL : kR).push([Math.round(t * 1000) / 1000, [-100, 0, 0]], [Math.round((t + beat * 0.45) * 1000) / 1000, [-40, 0, 0]]);
  }
  return [K("pose.shoulderR", ...kR), K("pose.shoulderL", ...kL)];
}

/** The lion dancer (Cường carries the head): bobbing, swaying, rearing up. */
function lionDance(dur: number): NonNullable<Actor["tracks"]> {
  const bob: [number, number][] = [];
  const yaw: [number, number][] = [];
  const spine: [number, number[]][] = [];
  for (let t = 0, i = 0; t <= dur; t += 0.45, i++) {
    const r = Math.round(t * 1000) / 1000;
    bob.push([r, i % 2 ? 10 : -6]);
    yaw.push([r, -30 + 60 * ((i >> 2) % 2) + (i % 2 ? 8 : -8)]);
    spine.push([r, [i % 8 < 4 ? -18 : 20, 0, i % 2 ? 6 : -6]]);
  }
  return [K("at.1", ...bob), K("rotate.1", ...yaw), K("pose.spine", ...spine)];
}

/** Children walking the lantern parade around the square (an ellipse path). */
function paradePath(phase: number, n = 10, rx = 420, rz = 230, cz = -160): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 1.6;
    return [Math.round(Math.cos(a) * rx), Math.round(cz + Math.sin(a) * rz)] as [number, number];
  });
}

const parade = (dur: number, lead: "ti" | null): Actor[] => {
  const kids: Actor[] = [
    { who: "lan", at: [0, 0, 0], lantern: undefined, walk: { path: paradePath(0.0), end: dur, cadence: 2.2 } },
    { who: "lan", id: "hoa", look: KIDS.hoa, at: [0, 0, 0], lantern: "lit", walk: { path: paradePath(-0.45), end: dur, cadence: 2.2 } },
    { who: "ti", id: "minh", look: KIDS.minh, at: [0, 0, 0], lantern: "lit", walk: { path: paradePath(-0.9), end: dur, cadence: 2.2 } },
    { who: "ti", id: "nam", look: KIDS.nam, at: [0, 0, 0], lantern: "lit", walk: { path: paradePath(-1.35), end: dur, cadence: 2.2 } },
  ];
  if (lead) kids.unshift({ who: "ti", at: [0, 0, 0], hero: true, lantern: "lit", walk: { path: paradePath(0.45), end: dur, cadence: 2.2 } });
  return kids;
};

export const CH6: ShotDef[] = [
  {
    id: "6.01", scene: "Đêm hội", shotType: "Establishing — crane down", dur: 15, pal: "festival",
    desc: "Đêm rằm. Sân đình rực rỡ đèn lồng, cả làng tụ về dưới gốc đa.",
    set: square,
    cam: { az: 0, el: 26, zoom: 0.8, focus: [0, 60, -300], screen: [999, 640] },
    camTo: { az: 8, el: 10, zoom: 1.1, focus: [0, 80, -260], screen: [999, 620] },
    actors: [
      { who: "bo", id: "cuong", look: VILLAGERS.cuong, at: [-420, 0, -60], yaw: 20 },
      { who: "bo", id: "mai", look: VILLAGERS.mai, at: [300, 0, -100], yaw: -30 },
      { who: "bo", id: "tu", look: VILLAGERS.tu, at: [520, 0, -40], yaw: -60 },
      { who: "ba", at: [140, 0, 40], yaw: 10 },
    ],
    transition: ["fadeBlack", 2],
    line: { by: "narrator", text: "Đêm rằm tháng Tám, cả làng rước đèn dưới trăng. Tiếng trống lân vang lên rộn rã.", offset: 2 },
  },
  {
    id: "6.02", scene: "Đêm hội", shotType: "Medium — the lion dance", dur: 15, pal: "festival",
    desc: "Múa lân: con lân đỏ vàng nhảy nhót theo nhịp trống.",
    set: square,
    props: (p) => ({ solids: lion("lion", p, "cuong") }),
    cam: { az: 16, el: 6, zoom: 2.8, focus: [-200, 90, -60] },
    actors: [
      { who: "bo", id: "cuong", look: { ...VILLAGERS.cuong, hat: undefined }, at: [-120, 0, -40], yaw: 20, still: true, pose: { shoulderL: [-80, 0, 0], shoulderR: [-80, 0, 0] }, tracks: lionDance(15) },
      { who: "bo", id: "tu", look: VILLAGERS.tu, at: [Q.drum[0] + 70, 0, Q.drum[2] + 10], yaw: -90, still: true, pose: { spine: [10, 0, 0] }, tracks: drumming(15) },
    ],
  },
  {
    id: "6.03", scene: "Đêm hội", shotType: "Close — the drum", dur: 8, pal: "festival",
    desc: "Dùi trống nện xuống mặt trống, dồn dập.",
    set: square,
    cam: { az: -60, el: 14, zoom: 6.5, focus: [Q.drum[0] + 20, 105, Q.drum[2]] },
    actors: [{ who: "bo", id: "tu", look: VILLAGERS.tu, at: [Q.drum[0] + 70, 0, Q.drum[2] + 10], yaw: -90, still: true, pose: { spine: [10, 0, 0] }, tracks: drumming(8, 160) }],
  },
  {
    id: "6.04", scene: "Đêm hội", shotType: "Wide — lantern parade", dur: 15, pal: "festival",
    desc: "Lũ trẻ rước đèn vòng quanh sân đình.",
    set: square,
    props: (p) => carpLantern("cachep", p, "lan"),
    cam: { az: 6, el: 14, zoom: 1.5, focus: [0, 60, -160] },
    actors: parade(15, null),
  },
  {
    id: "6.05", scene: "Đêm hội", shotType: "Medium — Bà searching", dur: 11, pal: "festival",
    desc: "Bà lo lắng tìm Tí giữa đám đông.",
    set: square,
    cam: { az: 30, el: 5, zoom: 4.2, focus: [140, 110, 40] },
    actors: [{ who: "ba", at: [140, 0, 40], yaw: 10, talks: true, tracks: [K("pose.neck", [0, [0, 0, 0]], [2, [0, 40, 0]], [5, [0, -40, 0]], [8, [0, 30, 0]], [11, [0, 0, 0]]), K("rotate.1", [0, 10], [4, -30], [8, 40], [11, 10])] }],
    line: { by: "ba", text: "Tí ơi! Tí đâu rồi hả con?", offset: 1.5 },
  },
  {
    id: "6.06", scene: "Đêm hội", shotType: "Wide — the brightest lantern", dur: 13, pal: "festival",
    desc: "Tí chạy vào sân, chiếc đèn ông sao sáng rực nhất. Lũ trẻ ồ lên.",
    set: square,
    props: (p) => carpLantern("cachep", p, "lan"),
    cam: { az: 12, el: 8, zoom: 2.2, focus: [0, 80, 60] },
    actors: [
      { who: "ti", at: [-700, 0, 200], hero: true, lantern: "lit", walk: { path: [[-700, 200], [-80, 90]], end: 5, cadence: 3.6, lean: 12 }, tracks: hop(6, 20, 2) },
      { who: "lan", at: [120, 0, 60], yaw: -70, pose: HOLD_LANTERN, tracks: hop(6.4, 14, 1) },
      { who: "lan", id: "hoa", look: KIDS.hoa, at: [220, 0, 0], yaw: -80, lantern: "lit", pose: HOLD_LANTERN },
      { who: "ti", id: "minh", look: KIDS.minh, at: [170, 0, 140], yaw: -90, lantern: "lit", pose: HOLD_LANTERN, tracks: hop(6.8, 14, 1) },
    ],
  },
  {
    id: "6.07", scene: "Đêm hội", shotType: "Two-shot — reunion", dur: 13, pal: "festival",
    desc: "Bà ôm chầm lấy Tí.",
    set: square,
    cam: { az: 8, el: 6, zoom: 4.6, focus: [30, 90, 60] },
    actors: [
      { who: "ti", at: [80, 0, 60], yaw: -90, hero: true, lantern: "lit", pose: HOLD_LANTERN },
      { who: "ba", at: [-40, 0, 60], yaw: 90, talks: true, tracks: [K("pose.spine", [0, [0, 0, 0]], [1.5, [26, 0, 0]], [11, [26, 0, 0]], [12.5, [0, 0, 0]]), K("pose.neck", [0, [0, 0, 0]], [1.5, [-10, 0, 0]])] },
    ],
    rigs: [
      { type: "ik", part: "ba", limb: "armL", target: [70, 85, 30], weight: 1, fade: 0.8, start: 1, end: 11.5 },
      { type: "ik", part: "ba", limb: "armR", target: [70, 85, 90], weight: 1, fade: 0.8, start: 1, end: 11.5 },
    ],
    line: { by: "ba", text: "Con đi đâu thế? Bà lo quá!", offset: 2 },
  },
  {
    id: "6.08", scene: "Đêm hội", shotType: "Close — Tí explains", dur: 10, pal: "festival",
    desc: "Tí giơ chiếc đèn sáng rực kể cho bà nghe.",
    set: square,
    cam: { az: -50, el: 3, zoom: 7, focus: [80, 100, 60], screen: [1080, 560] },
    actors: [{ who: "ti", at: [80, 0, 60], yaw: -90, hero: true, talks: true, lantern: "lit", pose: { shoulderR: [-20, 0, -120], elbowR: [-10, 0, 0], neck: [-10, 0, 0] } }],
    line: { by: "ti", text: "Đom đóm đã thắp đèn cho con đấy bà ạ!", offset: 0.8 },
  },
  {
    id: "6.09", scene: "Đêm hội", shotType: "Tracking — leading the parade", dur: 15, pal: "festival",
    desc: "Tí dẫn đầu đoàn rước đèn, bà và mọi người vỗ tay.",
    set: square,
    props: (p) => carpLantern("cachep", p, "lan"),
    cam: { az: 20, el: 7, zoom: 2.6, focus: [0, 70, 0] },
    follow: "ti", followOffset: [0, 70, 0],
    actors: [...parade(15, "ti"), { who: "ba", at: [0, 0, 160], yaw: 180, tracks: [K("pose.elbowL", [0, [-90, 0, 0]], [15, [-90, 0, 0]]), K("pose.elbowR", [0, [-90, 0, 0]], [15, [-90, 0, 0]])] }],
  },
  {
    id: "6.10", scene: "Đêm hội", shotType: "Crane up — the circle of light", dur: 15, pal: "festival",
    desc: "Máy quay nâng lên cao: vòng tròn đèn lồng chuyển động dưới trăng.",
    set: square,
    props: (p) => carpLantern("cachep", p, "lan"),
    cam: { az: 10, el: 12, zoom: 1.6, focus: [0, 60, -160] },
    camTo: { az: 30, el: 55, zoom: 1.2, focus: [0, 60, -160] },
    actors: parade(15, "ti"),
  },
  {
    id: "6.11", scene: "Đêm hội", shotType: "Medium — mooncakes", dur: 13, pal: "festival",
    desc: "Dưới gốc đa, bà chia bánh trung thu cho Tí và Lan.",
    set: square,
    cam: { az: 196, el: 10, zoom: 3.6, focus: [Q.table[0] + 20, 60, Q.table[2] + 60] },
    actors: [
      { who: "ba", at: [Q.table[0] - 60, 0, Q.table[2] + 90], yaw: 160, talks: false, pose: { shoulderR: [-60, 0, 0], elbowR: [-30, 0, 0] } },
      { who: "ti", at: seated("ti", [Q.table[0] + 40, 0, Q.table[2] + 110], 0), yaw: 180, hero: true, pose: { ...SIT_GROUND, shoulderR: [-70, 0, 0] } },
      { who: "lan", at: seated("lan", [Q.table[0] + 120, 0, Q.table[2] + 100], 0), yaw: 200, pose: { ...SIT_GROUND } },
    ],
  },
  {
    id: "6.12", scene: "Đêm hội", shotType: "Wide — the fireflies return", dur: 15, pal: "festival",
    desc: "Bầy đom đóm bay về múa lượn trên sân đình. Cả làng ngước nhìn.",
    set: (p) => merge(square(p)),
    props: () => swarm("sw", [0, 300, -200], 16, 600, 15, { appearAt: 1 }),
    cam: { az: 0, el: 8, zoom: 1.3, focus: [0, 150, -200] },
    camTo: { az: 6, el: 5, zoom: 1.2, focus: [0, 200, -200] },
    actors: [
      { who: "ti", at: [0, 0, 60], yaw: 180, hero: true, lantern: "lit", pose: { shoulderR: [-20, 0, -130], neck: [-24, 0, 0] } },
      { who: "ba", at: [-100, 0, 80], yaw: 170, pose: { neck: [-22, 0, 0] } },
      { who: "lan", at: [110, 0, 70], yaw: 190, pose: { neck: [-22, 0, 0] } },
      { who: "bo", id: "mai", look: VILLAGERS.mai, at: [300, 0, -20], yaw: 200, pose: { neck: [-20, 0, 0] } },
      { who: "bo", id: "tu", look: VILLAGERS.tu, at: [-320, 0, -10], yaw: 160, pose: { neck: [-20, 0, 0] } },
    ],
    tracks: swarm("sw", [0, 300, -200], 16, 600, 15, { appearAt: 1 }).tracks,
  },
];
