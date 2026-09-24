/** Chương 7 — Trăng (epilogue) + credits. */
import { porch, village } from "./sets";
import { creditsCard, titleCard, type ShotDef } from "./shots";
import { K, LOOK_UP, handle, looseLantern, seated, swarm } from "./acting";
import { merge } from "./kit";
import { CH1 } from "./ch1";
import { CH2 } from "./ch2";
import { CH3 } from "./ch3";
import { CH4 } from "./ch4";
import { CH5 } from "./ch5";
import { CH6 } from "./ch6";
import { withExtras } from "./extras";

const STORY = [CH1, CH2, CH3, CH4, CH5, CH6].flatMap((c) => withExtras(c));
const stepY = 24;
const tiSeat = seated("ti", [40, 0, -100], stepY);
const baSeat = seated("ba", [-60, 0, -105], stepY);

const nightSky = (id: string, dur: number) => swarm(id, [0, 520, -400], 14, 700, dur);

const credits = (id: string, heading: string, rows: readonly (readonly [string, string])[], dur = 14): ShotDef => ({
  id, scene: "Credits", shotType: "Credits", dur, pal: "night",
  desc: `Danh đề: ${heading}`,
  set: porch,
  props: () => ({ solids: nightSky(`cr${id.replace(".", "")}`, dur).solids }),
  tracks: nightSky(`cr${id.replace(".", "")}`, dur).tracks,
  cam: { az: 0, el: 0, zoom: 1.2, focus: [0, 560, -300] },
  overlay: creditsCard(rows, heading),
  transition: ["dissolve", 1.5],
});

export const CH7: ShotDef[] = [
  {
    id: "7.01", scene: "Trăng", shotType: "Wide — the porch", dur: 16, pal: "night",
    desc: "Khuya. Bà và Tí ngồi trước hiên nhà ngắm trăng, chiếc đèn ông sao vẫn sáng bên cạnh.",
    set: porch,
    props: (p) => looseLantern("den", p, [150, stepY + 30, -95], [0, -20, 0], "lit"),
    cam: { az: 10, el: 6, zoom: 2.4, focus: [0, 70, -100] },
    camTo: { az: 4, el: 5, zoom: 3.0, focus: [0, 80, -100] },
    actors: [
      { who: "ba", at: baSeat, hero: false, pose: { hipL: [-86, 0, 0], hipR: [-86, 0, 0], kneeL: [86, 0, 0], kneeR: [86, 0, 0], ...LOOK_UP } },
      { who: "ti", at: tiSeat, hero: true, pose: { hipL: [-86, 0, 0], hipR: [-86, 0, 0], kneeL: [86, 0, 0], kneeR: [86, 0, 0], ...LOOK_UP } },
    ],
    sky: { moonAt: [1300, 200] },
    transition: ["fadeBlack", 2],
    line: { by: "narrator", text: "Và từ đó, mỗi mùa trăng, Tí biết rằng ánh sáng nhỏ bé nhất cũng có thể dẫn ta về nhà.", offset: 2.5 },
  },
  {
    id: "7.02", scene: "Trăng", shotType: "Close — sleep", dur: 12, pal: "night",
    desc: "Tí gà gật, tựa đầu vào vai bà rồi thiếp đi.",
    set: porch,
    cam: { az: -10, el: 3, zoom: 6.5, focus: [0, stepY + 70, -100] },
    actors: [
      { who: "ba", at: baSeat, pose: { hipL: [-86, 0, 0], hipR: [-86, 0, 0], kneeL: [86, 0, 0], kneeR: [86, 0, 0] } },
      { who: "ti", at: tiSeat, hero: true, still: true, pose: { hipL: [-86, 0, 0], hipR: [-86, 0, 0], kneeL: [86, 0, 0], kneeR: [86, 0, 0] },
        tracks: [K("face.blink", [0, 0], [3, 0], [4, 0.7], [4.6, 0.2], [6.5, 0.9], [7.2, 1]), K("pose.neck", [0, [0, 0, 0]], [7, [8, 0, 22]]), K("pose.spine", [0, [0, 0, 0]], [7, [4, 0, 10]])] },
    ],
  },
  {
    id: "7.03", scene: "Trăng", shotType: "Medium — Bà's hand", dur: 11, pal: "night",
    desc: "Bà mỉm cười, khẽ xoa đầu đứa cháu nhỏ.",
    set: (p) => merge(porch(p), { solids: [handle("pat", [tiSeat[0] - 2, tiSeat[1] + 128, tiSeat[2] + 4], "#e3b48c")] }),
    cam: { az: 20, el: 5, zoom: 5.2, focus: [-10, stepY + 80, -100] },
    actors: [
      { who: "ba", at: baSeat, pose: { hipL: [-86, 0, 0], hipR: [-86, 0, 0], kneeL: [86, 0, 0], kneeR: [86, 0, 0], neck: [6, 0, -14] } },
      { who: "ti", at: tiSeat, hero: true, asleep: true, pose: { hipL: [-86, 0, 0], hipR: [-86, 0, 0], kneeL: [86, 0, 0], kneeR: [86, 0, 0], neck: [8, 0, 22], spine: [4, 0, 10] } },
    ],
    rigs: [{ type: "ik", part: "ba", limb: "armL", target: { solid: "pat" }, weight: 1, fade: 1, start: 1, end: 10 }],
    tracks: [K("solids.pat.at", [0, [tiSeat[0] - 2, tiSeat[1] + 128, tiSeat[2] + 4]], [3, [tiSeat[0] + 8, tiSeat[1] + 124, tiSeat[2]]], [5, [tiSeat[0] - 6, tiSeat[1] + 128, tiSeat[2] + 6]], [7, [tiSeat[0] + 8, tiSeat[1] + 124, tiSeat[2]]], [10, [tiSeat[0] - 2, tiSeat[1] + 128, tiSeat[2] + 4]])],
  },
  {
    id: "7.04", scene: "Trăng", shotType: "Sky — across the moon", dur: 11, pal: "night",
    desc: "Chú đom đóm bay ngang qua vầng trăng.",
    set: porch,
    props: () => ({ solids: [{ id: "dd", type: "sphere", r: 9, segments: 8, at: [-700, 640, -400], fill: "#fff7a1", shading: "none", shadow: false, effects: { glow: { mode: "halo", size: 4, opacity: 0.7 } } }] }),
    cam: { az: 0, el: 0, zoom: 1.4, focus: [0, 620, -400] },
    tracks: [K("solids.dd.at", [0, [-700, 560, -400]], [5, [-60, 660, -400]], [11, [700, 760, -400]])],
    sky: { moonAt: [999, 470], mountains: false, moonScale: 2.8 },
  },
  {
    id: "7.05", scene: "Trăng", shotType: "Extreme wide — crane up", dur: 16, pal: "night",
    desc: "Ngôi làng say ngủ dưới trăng rằm. Máy quay nâng dần lên bầu trời.",
    set: (p) => village(p, { lanterns: true }),
    cam: { az: 14, el: 8, zoom: 0.7, focus: [0, 60, -400] },
    camTo: { az: 18, el: 24, zoom: 0.55, focus: [0, 60, -400] },
    sky: { moonAt: [1500, 180] },
    transition: ["dissolve", 2],
  },
  {
    id: "7.06", scene: "Trăng", shotType: "Title — the end", dur: 7, pal: "night",
    desc: "HẾT",
    set: porch,
    props: () => ({ solids: nightSky("end", 7).solids }),
    tracks: nightSky("end", 7).tracks,
    cam: { az: 0, el: 0, zoom: 1.2, focus: [0, 560, -300] },
    overlay: titleCard("HẾT", "The End", { y: 520, size: 120 }),
    transition: ["dissolve", 2],
  },
  credits("7.07", "ĐÈN ÔNG SAO · The Star Lantern", [
    ["Kịch bản · Screenplay", "Claude (AI agent)"],
    ["Dựng cảnh · Sets & Characters", "Claude, bằng construct engine"],
    ["Hoạt hình · Animation", "rig walk · IK · lip-sync · keyframes"],
    ["Âm nhạc · Score", "tổng hợp tất định bằng TypeScript"],
    ["Giọng đọc · Voices", "espeak-ng (TTS cục bộ, không API key)"],
    ["Engine", "Storyboard Studio · imageforagent"],
  ]),
  credits("7.08", "Làm hoàn toàn bằng mã nguồn · Made entirely in code", [
    ["Số shot · Shots", `${STORY.length + 9}`],
    ["Thời lượng câu chuyện · Story", `${Math.round(STORY.reduce((a, s) => a + s.dur, 0) / 60)} phút`],
    ["Khuôn hình · Picture", "1998×1080 DCI Flat · 24 fps"],
    ["Vẽ tay · Hand-drawn frames", "0"],
    ["Khoá API · API keys", "0"],
    ["Tái lập · Reproducible", "byte-for-byte"],
  ]),
  credits("7.09", "Cảm ơn đã xem · Thank you for watching", [
    ["Công cụ · Tools", "sharp/librsvg · ffmpeg · OpenJPEG"],
    ["Đóng gói rạp · Cinema master", "SMPTE DCP (JPEG 2000, MXF)"],
    ["Kiểm định · Validated with", "asdcplib · ClairMeta"],
    ["Giấy phép · License", "MIT"],
  ], 12),
];
