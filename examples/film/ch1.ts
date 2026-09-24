/** Chương 1 — Làng ven sông (dawn → day): the village, Bà and Tí, making the lantern. */
import { MARKS, paddies, village, yard } from "./sets";
import { titleCard, type ShotDef } from "./shots";
import { merge } from "./kit";
import { HOLD_LANTERN, K, SIT, bambooStrips, carpLantern, dragonfly, hop, riverBoat, seated, starFrame, withProps } from "./acting";

const Y = MARKS.yard;

export const CH1: ShotDef[] = [
  {
    id: "1.00", scene: "Mở đầu", shotType: "Sky — the legend", dur: 13, pal: "night",
    desc: "Trăng rằm. Trên cung trăng, bóng chú Cuội ngồi gốc cây đa.",
    set: (p) => village(p),
    cam: { az: 0, el: 0, zoom: 1.3, focus: [0, 640, -400] },
    camTo: { az: 0, el: 0, zoom: 1.2, focus: [0, 600, -400] },
    sky: { moonAt: [999, 500], mountains: false, moonScale: 2.6 },
    line: { by: "narrator", text: "Người ta kể rằng, trên cung trăng có chú Cuội ngồi gốc cây đa, đêm đêm chờ ánh đèn dưới trần gian.", offset: 1.5 },
  },
  // =========================================================================
  // CHƯƠNG 1 — LÀNG VEN SÔNG (dawn → day)
  // =========================================================================
  {
    id: "1.01", scene: "Làng ven sông", shotType: "Establishing — slow crane down", dur: 16, pal: "dawn",
    desc: "Bình minh trên ngôi làng ven sông. Tựa phim hiện lên.",
    set: (p) => village(p, { lit: false }),
    cam: { az: 10, el: 22, zoom: 0.5, focus: [0, 60, -400], screen: [999, 700] },
    camTo: { az: 16, el: 9, zoom: 0.6, focus: [0, 60, -400], screen: [999, 620] },
    overlay: titleCard("ĐÈN ÔNG SAO", "The Star Lantern", { y: 330, size: 110 }),
    transition: ["dissolve", 2],
    line: { by: "narrator", text: "Ngày xửa ngày xưa, ở một ngôi làng nhỏ bên dòng sông, mỗi mùa trăng rằm tháng Tám, trẻ con lại rước đèn.", offset: 2 },
  },
  {
    id: "1.02", scene: "Làng ven sông", shotType: "Wide — pan along the river", dur: 12, pal: "dawn",
    desc: "Con thuyền nhỏ trôi trên sông, sương sớm.",
    set: (p) => merge(village(p, { lit: false }), { solids: [] }),
    props: (p) => riverBoat(p),
    cam: { az: -4, el: 7, zoom: 1.6, focus: [-600, 40, 380] },
    camTo: { az: 6, el: 7, zoom: 1.6, focus: [300, 40, 380] },
    tracks: [K("groups.boatG.at", [0, [-900, 0, 420]], [12, [500, 0, 420]])],
    transition: ["dissolve", 1.5],
  },
  {
    id: "1.03", scene: "Nhà bà", shotType: "Medium — static", dur: 11, pal: "dawn",
    desc: "Bà bước ra sân, vươn vai đón nắng sớm.",
    set: (p) => yard(p, { lit: false }),
    cam: { az: 14, el: 8, zoom: 3.2, focus: [-40, 70, -200] },
    actors: [{
      who: "ba", at: [-40, 0, -290],
      walk: { path: [[-40, -290], [-40, -170]], start: 0.5, end: 3.5, cadence: 1.6 },
      tracks: [
        K("pose.shoulderL", [4, [0, 0, 0]], [5, [0, 0, 150]], [7, [0, 0, 150]], [8, [0, 0, 0]]),
        K("pose.shoulderR", [4, [0, 0, 0]], [5, [0, 0, -150]], [7, [0, 0, -150]], [8, [0, 0, 0]]),
        K("pose.spine", [4, [0, 0, 0]], [5.5, [-10, 0, 0]], [7, [-10, 0, 0]], [8, [0, 0, 0]]),
      ],
    }],
    transition: ["dissolve", 1],
  },
  {
    id: "1.04", scene: "Nhà bà", shotType: "Medium — static", dur: 9, pal: "dawn",
    desc: "Bà gọi Tí dậy.",
    set: (p) => yard(p, { lit: false }),
    cam: { az: 44, el: 6, zoom: 5, focus: [-190, 110, -240], screen: [1000, 600] },
    actors: [{ who: "ba", at: [-200, 0, -250], yaw: 80, talks: true, tracks: [K("pose.shoulderR", [0.5, [0, 0, 0]], [1.2, [-40, 0, -30]], [4, [-40, 0, -30]], [5, [0, 0, 0]])] }],
    line: { by: "ba", text: "Tí ơi, dậy đi con! Hôm nay bà làm đèn ông sao cho con.", offset: 0.6 },
  },
  {
    id: "1.05", scene: "Nhà bà", shotType: "Wide — static", dur: 10, pal: "dawn",
    desc: "Tí chạy ùa ra sân, nhảy cẫng lên vui sướng.",
    set: (p) => yard(p, { lit: false }),
    cam: { az: 6, el: 9, zoom: 2.8, focus: [0, 60, -120] },
    actors: [
      { who: "ba", at: [-120, 0, -150], yaw: 30 },
      { who: "ti", at: [-40, 0, -300], hero: true, walk: { path: [[-40, -300], [60, -120], [120, -40]], start: 0.3, end: 3.2, cadence: 3.4, armSwing: 40 }, tracks: hop(3.6, 34, 3) },
    ],
  },
  // --- the field (day) ---
  {
    id: "1.06", scene: "Cánh đồng", shotType: "Extreme wide — tracking", dur: 14, pal: "day",
    desc: "Hai bà cháu đi trên bờ ruộng, lúa xanh mướt.",
    set: paddies,
    cam: { az: 8, el: 11, zoom: 1.7, focus: [-700, 60, 0] },
    follow: "ti", followOffset: [60, 70, 0],
    actors: [
      { who: "ba", at: [-760, 0, 0], walk: { path: [[-760, 0], [520, 0]], start: 0.2, end: 14, cadence: 1.7 } },
      { who: "ti", at: [-660, 0, 10], hero: true, walk: { path: [[-660, 10], [620, 10]], start: 0, end: 13.6, cadence: 2.4 } },
    ],
    transition: ["dissolve", 1.5],
    line: { by: "narrator", text: "Tí sống với bà. Mùa trăng này, bà hứa làm cho cậu một chiếc đèn ông sao thật đẹp.", offset: 1 },
  },
  {
    id: "1.07", scene: "Cánh đồng", shotType: "Medium — static, comic beat", dur: 11, pal: "day",
    desc: "Tí đuổi theo chú chuồn chuồn rồi vấp ngã, bà bật cười.",
    set: paddies,
    props: (p) => ({ solids: [dragonfly("cc", p, [120, 150, 20])] }),
    cam: { az: 20, el: 7, zoom: 3.6, focus: [60, 70, 10] },
    actors: [
      { who: "ti", at: [-120, 0, 10], hero: true, walk: { path: [[-120, 10], [140, 10]], start: 0.3, end: 4.2, cadence: 3.2, armSwing: 35 },
        tracks: [
          K("pose.shoulderR", [3.5, [0, 0, 0]], [4.0, [-120, 0, 0]], [4.4, [-120, 0, 0]]),
          K("rotate.0", [4.2, 0], [4.7, 70], [7.5, 70], [8.4, 0]),
          K("at.1", [4.2, 0], [4.7, 18], [7.5, 18], [8.4, 0]),
        ], still: true },
      { who: "ba", at: [-260, 0, 0], yaw: 80, talks: true, tracks: [K("pose.spine", [5, [0, 0, 0]], [5.6, [14, 0, 0]], [6.2, [0, 0, 0]], [6.8, [14, 0, 0]], [7.4, [0, 0, 0]])] },
    ],
    tracks: [K("solids.cc.at", [0, [120, 150, 20]], [2, [60, 170, 40]], [4, [260, 190, 0]], [6, [420, 240, -60]], [11, [700, 300, -200]])],
    line: { by: "ba", text: "Hì hì, từ từ thôi cháu!", offset: 5.2 },
  },
  // --- making the lantern (the yard, noon) ---
  {
    id: "1.08", scene: "Làm đèn", shotType: "Wide — slow push in", dur: 12, pal: "day",
    desc: "Buổi trưa, bà ngồi chẻ tre, Tí ngồi chờ bên bàn.",
    set: (p) => withProps(yard, (q) => ({ solids: bambooStrips("bs", q, [Y.table[0] - 30, 66, Y.table[2]]) }))(p),
    cam: { az: 24, el: 12, zoom: 2.4, focus: [0, 60, 0] },
    camTo: { az: 20, el: 10, zoom: 3.2, focus: [0, 60, 0] },
    actors: [
      { who: "ba", at: seated("ba", Y.stoolBa, 34), yaw: 70, pose: { ...SIT, elbowR: [-70, 0, 0], elbowL: [-70, 0, 0] } },
      { who: "ti", at: seated("ti", Y.stoolTi, 34), yaw: -70, pose: { ...SIT }, hero: true },
    ],
    transition: ["fadeBlack", 1],
  },
  {
    id: "1.09", scene: "Làm đèn", shotType: "Close — hands at work", dur: 10, pal: "day",
    desc: "Đôi tay bà uốn nan tre thành năm cánh sao.",
    set: (p) => withProps(yard, (q) => ({ solids: bambooStrips("bs", q, [Y.table[0] - 20, 66, Y.table[2]]), shapes: [] }))(p),
    props: (p) => starFrame("khung", p, [0, 90, 0], 0.4),
    cam: { az: 40, el: 18, zoom: 7, focus: [-10, 80, 10] },
    actors: [{ who: "ba", at: seated("ba", Y.stoolBa, 34), yaw: 70, pose: { ...SIT, neck: [14, 0, 0] }, still: true,
      tracks: [K("pose.elbowR", [0, [-70, 0, 0]], [1.5, [-90, 0, 10]], [3, [-70, 0, 0]], [4.5, [-90, 0, 10]], [6, [-70, 0, 0]], [7.5, [-90, 0, 10]], [10, [-70, 0, 0]]),
               K("pose.elbowL", [0, [-80, 0, 0]], [2, [-60, 0, -10]], [4, [-80, 0, 0]], [6, [-60, 0, -10]], [8, [-80, 0, 0]])] }],
    tracks: [K("solids.khung.scale", [0, 0.4], [9, 1])],
  },
  {
    id: "1.10", scene: "Làm đèn", shotType: "Two-shot — static", dur: 12, pal: "day",
    desc: "Tí dán giấy đỏ lên khung sao, lém lỉnh dính cả giấy lên mũi.",
    set: yard,
    props: (p) => starFrame("khung", p, [0, 96, 0], 1, true),
    cam: { az: 0, el: 10, zoom: 4.2, focus: [0, 80, 0] },
    actors: [
      { who: "ba", at: seated("ba", Y.stoolBa, 34), yaw: 70, pose: { ...SIT, elbowL: [-60, 0, 0] } },
      { who: "ti", at: seated("ti", Y.stoolTi, 34), yaw: -70, pose: { ...SIT }, hero: true,
        tracks: [K("pose.shoulderR", [0, [0, 0, 0]], [1, [-60, 0, 20]], [3, [-60, 0, 20]], [4, [-20, 0, 0]], [6, [-60, 0, 20]], [8, [0, 0, 0]]),
                 K("pose.elbowR", [0, [0, 0, 0]], [1, [-50, 0, 0]], [8, [-50, 0, 0]], [9, [0, 0, 0]])] },
    ],
  },
  {
    id: "1.11", scene: "Làm đèn", shotType: "Medium — push in", dur: 12, pal: "day",
    desc: "Chiếc đèn ông sao hoàn thành. Bà trao cho Tí.",
    set: yard,
    cam: { az: 16, el: 8, zoom: 3.6, focus: [0, 80, 20] },
    camTo: { az: 10, el: 6, zoom: 5, focus: [40, 90, 30] },
    actors: [
      { who: "ba", at: [-70, 0, 30], yaw: 60, talks: true, pose: { shoulderR: [-40, 0, 0], elbowR: [-40, 0, 0] } },
      { who: "ti", at: [80, 0, 40], yaw: -60, lantern: "dark", pose: HOLD_LANTERN, hero: true, tracks: hop(8.5, 22, 2) },
    ],
    line: { by: "ba", text: "Đèn ông sao năm cánh đây. Con giữ cho cẩn thận nhé.", offset: 0.8 },
  },
  {
    id: "1.12", scene: "Làm đèn", shotType: "Close — reaction", dur: 7, pal: "day",
    desc: "Tí ôm chiếc đèn, cười tít mắt.",
    set: yard,
    cam: { az: -8, el: 4, zoom: 8, focus: [80, 100, 40] },
    actors: [{ who: "ti", at: [80, 0, 40], yaw: -20, lantern: "dark", pose: HOLD_LANTERN, hero: true, talks: true }],
    line: { by: "ti", text: "Con cảm ơn bà! Đẹp quá!", offset: 0.5 },
  },
  {
    id: "1.13", scene: "Làng ven sông", shotType: "Wide — tracking, time passes", dur: 14, pal: "day",
    desc: "Tí chạy khắp làng khoe đèn, ngang qua gốc đa.",
    set: village,
    cam: { az: 4, el: 8, zoom: 2, focus: [-400, 60, -60] },
    follow: "ti", followOffset: [0, 70, 0],
    actors: [{ who: "ti", at: [-600, 0, -60], lantern: "dark", hero: true, walk: { path: [[-600, -60], [200, -40], [700, -120]], end: 13, cadence: 3.2 } }],
    transition: ["dissolve", 1.5],
  },
  {
    id: "1.14", scene: "Làng ven sông", shotType: "Medium — static", dur: 12, pal: "day",
    desc: "Bạn Lan khoe chiếc đèn cá chép. Hai bạn so đèn với nhau.",
    set: village,
    props: (p) => carpLantern("cachep", p, "lan"),
    cam: { az: 12, el: 6, zoom: 4, focus: [760, 70, -150] },
    actors: [
      { who: "ti", at: [700, 0, -140], yaw: 90, lantern: "dark", pose: HOLD_LANTERN, hero: true, tracks: [K("pose.neck", [3, [0, 0, 0]], [4, [0, 20, 0]], [7, [0, 20, 0]], [8, [0, 0, 0]])] },
      { who: "lan", at: [830, 0, -150], yaw: -90, pose: HOLD_LANTERN, tracks: hop(6, 18, 2) },
    ],
  },
];

