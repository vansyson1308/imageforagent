/**
 * The v2 showcase films, re-shot after the quality sprint (owner QC
 * 2026-10-10): the same three sample stories (EN/VI/JA) told at film length,
 * 11 narrated lines each, so each film runs 45–90 s with longer holds. Shot N
 * illustrates line N (the `narration` request option, D52); the story sent to
 * the Director is the lines joined. Each telling keeps a hero object that gets
 * an insert (the kite's star patch, the first bánh chưng, the wish card).
 */
export interface ShowcaseStory {
  readonly slug: string;
  readonly language: "en" | "vi" | "ja";
  readonly style: string;
  readonly lines: readonly string[];
  /**
   * The film's places, named up front like the Hidamari series brief (re-shoot 2026-10-11:
   * left to itself, each run invented different sets, e.g. no festival street for fūrin's
   * three festival shots). Each place names the kit place it is drawn from and the times it is seen at.
   */
  readonly sets: readonly string[];
  /**
   * The owner's by-eye targets for the key object (round 3, 2026-10-12): what it must visibly be, and
   * what each of its states must visibly show. Sent with the sets; Ultra's anatomy follows it.
   */
  readonly keyObject: string;
}

/** The SETS brief sent before the story: one set member per place, the right one in every shot. */
export function setsBrief(s: Pick<ShowcaseStory, "sets" | "keyObject">): string {
  return [`SETS (make each one a cast member of kind "set" and give every shot the set of the place it shows):`, ...s.sets.map((x, i) => `${i + 1}. ${x}`), "", `KEY OBJECT (the owner's notes — draw it exactly so): ${s.keyObject}`].join("\n");
}

export const SHOWCASE_V2: readonly ShowcaseStory[] = [
  {
    slug: "v2-kite",
    sets: [
      "Brighton seafront: the pier and its shingle beach by the sea (kit place: beach); morning wind, afternoon, golden dusk",
      "Grandfather's kitchen with a wooden table and a window (kit place: kitchen); morning light",
    ],
    keyObject:
      "Maya's red diamond kite: a red sail on a cross of thin bamboo sticks, a tail of small bows, flown on a string. States in order: intact (smooth taut sail) → torn (a jagged hole with a flap of sail hanging down and the sky showing through it) → patched (a white cloth patch over the hole with visible stitches) → starred (the same patch with a big gold star painted on it).",
    language: "en",
    style: "storybook",
    lines: [
      "On a windy autumn morning in Brighton, eight-year-old Maya flies her red kite above the pier.",
      "A gust slams it into the pier railings, and the red sail tears from corner to corner.",
      "Maya runs home along the seafront, the broken kite hugged to her chest.",
      "Her grandfather, who mended sails when he was young, looks up from his newspaper.",
      "At the kitchen table he lays the kite flat and threads a needle with sailcloth thread.",
      "Stitch by stitch, he shows Maya how a sailor's seam holds against the wind.",
      "Maya paints a small gold star over the patch, so the kite will remember.",
      "In the afternoon they walk back to the beach together, the kite under Grandfather's arm.",
      "Maya runs into the wind, and the kite climbs higher than ever over the waves.",
      "She hands the string to her grandfather, and he laughs like a boy.",
      "At golden dusk they walk home along the sand, the mended kite on Maya's shoulder.",
    ],
  },
  {
    slug: "v2-banh-chung",
    sets: [
      "The courtyard of a Hanoi tube house: a tiled yard with low stools, a charcoal stove and a big pot (kit place: garden); afternoon, night, dawn",
      "The family's front room with the ancestor altar (kit place: living-room); dawn",
      "Hanoi's old quarter rooftops under New Year's Eve fireworks (kit place: village); midnight",
    ],
    keyObject:
      "Bánh chưng: a flat SQUARE parcel wrapped in glossy green dong leaves with visible leaf texture (veins), tied with two pairs of thin pale bamboo strings each way (four strings crossing in a grid, NOT a ribbon, NO bow), a darker green leaf fold at the corners. ONE look only (owner 2026-10-12, D77): the wrapped parcel; the cooking is told by the pot and the fire in the courtyard sets, and the altar by the front room.",
    language: "vi",
    style: "storybook",
    lines: [
      "Chiều Ba Mươi Tết, bé An cùng bà gói bánh chưng trong sân nhà ở phố cổ Hà Nội.",
      "Bà trải lá dong xanh lên mâm, đong gạo nếp trắng, nhân đậu xanh và thịt.",
      "An học bà gấp lá thật vuông và buộc lạt tre thật chặt.",
      "Chiếc bánh đầu tiên An tự gói, bà khen vuông vắn như bánh của người lớn.",
      "Đêm xuống, nồi bánh sôi lục bục trên bếp lửa hồng giữa sân.",
      "Hai bà cháu ngồi canh nồi bánh, bà kể chuyện Lang Liêu dâng bánh cho vua Hùng.",
      "Bà chỉ chiếc bánh vuông như mặt đất, An tròn mắt lắng nghe.",
      "Đêm giao thừa, pháo hoa nở rực trên những mái ngói phố cổ.",
      "An ngủ gục trên vai bà, tay vẫn nắm sợi lạt tre.",
      "Sáng mùng Một, An mở mắt và chạy ra phòng khách.",
      "Trên bàn thờ là chiếc bánh chưng vuông vức đầu tiên do chính tay An gói.",
    ],
  },
  {
    slug: "v2-furin",
    sets: [
      "The engawa veranda of grandma's Kyoto machiya with shoji and a small garden (kit place: veranda); summer day and night",
      "The Gion festival street lined with lantern-lit stalls, paved with grey stone (kit place: market); dusk",
      "Grandma's tatami room with a low table (kit place: tea-room); night",
    ],
    keyObject:
      "The Edo fūrin (glass wind chime): a small TRANSPARENT glass bell, open at the bottom, with a white highlight on the glass and a painted pattern; a clapper hanging inside the bell; a short string from the top of the bell to the eaves; a long paper strip (tanzaku) hanging below on a thread. NOT brass, NOT rods. States in order: still (the bell and strip hanging straight down, the strip plain) → ringing (the bell tilted, the paper strip — now the blue wish strip — lifted sideways by the wind, small motion lines).",
    language: "ja",
    style: "storybook",
    lines: [
      "夏休み、ゆいは、京都のおばあちゃんの家に、遊びに来ました。",
      "縁側には、古い江戸風鈴が、ひとつ下がっていますが、もう、音が鳴りません。",
      "「おじいちゃんと買った風鈴なの」と、おばあちゃんは、言いました。",
      "夕方、二人は、浴衣を着て、祇園祭の宵山へ、出かけました。",
      "提灯の灯る通りには、屋台が、ずらりと並んでいます。",
      "風鈴の屋台で、ゆいは、青い短冊を、一枚選びました。",
      "夜、家に帰ると、ゆいは、短冊に、願いごとを書きました。",
      "「おばあちゃんの風鈴が、また、鳴りますように」。",
      "ゆいが、短冊を風鈴に結ぶと、夜風が、そっと吹きました。",
      "ちりん。風鈴が、ひさしぶりに、鳴りました。",
      "おばあちゃんは、そっと涙をふいて、ゆいの頭を、なでました。",
    ],
  },
];

/** Rough spoken length (s) of a telling: EN/VI by words (2.6/s), JA by characters (5/s), + 0.6 s per line. */
export function spokenSeconds(s: ShowcaseStory): number {
  return s.lines.reduce((t, l) => t + 0.6 + (s.language === "ja" ? [...l].length / 5 : l.split(/\s+/).length / 2.6), 0);
}
