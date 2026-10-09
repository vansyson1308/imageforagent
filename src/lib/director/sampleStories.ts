/**
 * One-click sample stories for judges (SPEC v2 WP1.3): one each in English,
 * Vietnamese and Japanese. They are deliberately NOT the bench prompts
 * (scripts/eval/director_bench.ts), so the eval is never tuned on them.
 * Each one mentions a real place, festival or costume, so research has
 * something to look up when it is enabled.
 */

export interface SampleStory {
  readonly key: string;
  readonly language: "en" | "vi" | "ja";
  readonly title: string;
  /** one line in the UI language of the sample itself */
  readonly teaser: string;
  readonly story: string;
  readonly style: string;
  readonly maxShots: number;
  /** honest estimate from real 6–8 shot runs (3 shots drawn in parallel) */
  readonly estMinutes: [number, number];
}

export const SAMPLE_STORIES: readonly SampleStory[] = [
  {
    key: "en-kite",
    language: "en",
    title: "The Kite Mender",
    teaser: "A grandfather, a torn kite and a windy beach in Brighton.",
    story:
      "On a windy autumn morning in Brighton, eight-year-old Maya's red kite tears on the pier railings. She runs home crying. Her grandfather, who mended sails when he was young, sits with her at the kitchen table and stitches the kite with sailcloth thread. In the afternoon they walk back to the beach together. The kite climbs higher than ever, and Maya hands the string to her grandfather, who laughs like a boy.",
    style: "storybook",
    maxShots: 7,
    estMinutes: [3, 6],
  },
  {
    key: "vi-banh-chung",
    language: "vi",
    title: "Nồi bánh chưng đêm Ba Mươi",
    teaser: "Hai bà cháu canh nồi bánh chưng đêm giao thừa ở Hà Nội.",
    story:
      "Chiều Ba Mươi Tết, bé An cùng bà gói bánh chưng trong sân nhà ở phố cổ Hà Nội. Lá dong xanh, gạo nếp trắng, nhân đậu xanh và thịt. Đêm xuống, hai bà cháu ngồi canh nồi bánh bên bếp lửa hồng, bà kể chuyện Lang Liêu dâng bánh cho vua Hùng. An ngủ gục trên vai bà. Sáng mùng Một, An mở mắt và thấy chiếc bánh chưng vuông vức đầu tiên do chính tay mình gói đặt trên bàn thờ.",
    style: "storybook",
    maxShots: 7,
    estMinutes: [3, 6],
  },
  {
    key: "ja-furin",
    language: "ja",
    title: "風鈴のおくりもの",
    teaser: "京都の夏祭り、おばあちゃんと孫と江戸風鈴。",
    story:
      "夏休み、ゆいは京都のおばあちゃんの家に遊びに来ました。縁側には古い江戸風鈴がひとつ下がっていますが、もう音が鳴りません。夜、二人は浴衣を着て祇園祭の宵山へ出かけ、屋台で新しい風鈴の短冊を選びました。家に帰ってゆいが短冊に願いごとを書いて結ぶと、夜風が吹いて、風鈴がひさしぶりにちりんと鳴りました。おばあちゃんはそっと涙をふきました。",
    style: "storybook",
    maxShots: 7,
    estMinutes: [3, 6],
  },
];

export function sampleByKey(key: string): SampleStory | undefined {
  return SAMPLE_STORIES.find((s) => s.key === key);
}
