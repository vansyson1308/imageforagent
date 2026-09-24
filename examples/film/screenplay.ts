/**
 * "Đèn Ông Sao" (The Star Lantern) — the screenplay, shot by shot.
 *
 * A child's star lantern is carried off by the river wind on the eve of the
 * Mid-Autumn festival; a firefly leads him through the night to find it, and
 * the fireflies light it for him. Told mostly without words (like *Flow*):
 * acting, camera, light and music carry the story; a narrator opens each
 * chapter.
 *
 * Every shot becomes one storyboard frame → one PUT /api/frames/:id/motion.
 */
import type { ShotDef } from "./shots";
import { CH1 } from "./ch1";
import { CH2 } from "./ch2";
import { CH3 } from "./ch3";
import { CH4 } from "./ch4";
import { CH5 } from "./ch5";
import { CH6 } from "./ch6";
import { CH7 } from "./ch7";
import { withExtras } from "./extras";

export const CHAPTERS: readonly { title: string; shots: ShotDef[] }[] = [
  { title: "Làng ven sông", shots: CH1 },
  { title: "Cơn gió chiều", shots: CH2 },
  { title: "Đom đóm", shots: CH3 },
  { title: "Cầu khỉ", shots: CH4 },
  { title: "Ánh trăng", shots: CH5 },
  { title: "Đêm hội trăng rằm", shots: CH6 },
  { title: "Trăng", shots: CH7 },
];

export const SHOTS: ShotDef[] = CHAPTERS.flatMap((c) => withExtras(c.shots));
