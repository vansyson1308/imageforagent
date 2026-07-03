/**
 * Motion map: shotType → chuyển động camera cho cả 2 đường:
 * - kenBurns: hiệu ứng animatic ffmpeg (zoompan) miễn phí
 * - veoMotion: chỉ dẫn chuyển động trong prompt Veo
 * Match substring không phân biệt hoa thường, entry cụ thể để trên.
 */

export type KenBurnsEffect = "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "static";

export interface MotionRule {
  readonly kenBurns: KenBurnsEffect;
  readonly veoMotion: string;
}

const MOTION_RULES: ReadonlyArray<readonly [pattern: string, rule: MotionRule]> = [
  [
    "extreme close-up",
    {
      kenBurns: "zoom-in",
      veoMotion:
        "Very slow, subtle push-in on the subject's key detail; minimal camera movement",
    },
  ],
  [
    "close-up",
    {
      kenBurns: "zoom-in",
      veoMotion:
        "Gentle slow push-in toward the subject's face; subject performs the described action naturally",
    },
  ],
  [
    "slow zoom-in",
    {
      kenBurns: "zoom-in",
      veoMotion: "Slow steady zoom-in toward the subject, smooth and continuous",
    },
  ],
  [
    "slow zoom-out",
    {
      kenBurns: "zoom-out",
      veoMotion: "Slow steady zoom-out revealing the surrounding scene, smooth and continuous",
    },
  ],
  [
    "pan left",
    {
      kenBurns: "pan-left",
      veoMotion: "Smooth horizontal pan from right to left across the scene",
    },
  ],
  [
    "pan right",
    {
      kenBurns: "pan-right",
      veoMotion: "Smooth horizontal pan from left to right across the scene",
    },
  ],
  [
    "pan",
    {
      kenBurns: "pan-right",
      veoMotion: "Smooth slow horizontal pan across the scene",
    },
  ],
  [
    "wide static shot",
    {
      kenBurns: "static",
      veoMotion:
        "Camera locked off, wide framing; life happens inside the frame (ambient motion, background characters)",
    },
  ],
  [
    "wide shot",
    {
      kenBurns: "zoom-out",
      veoMotion: "Nearly static wide framing with a very subtle drift; scene alive with ambient motion",
    },
  ],
  [
    "medium shot",
    {
      kenBurns: "zoom-in",
      veoMotion: "Steady medium framing; subject performs the described action with natural secondary motion",
    },
  ],
  [
    "bounce-in",
    {
      kenBurns: "zoom-in",
      veoMotion:
        "Character pops into frame with energetic squash-and-stretch bounce; camera static",
    },
  ],
  [
    "static shot",
    {
      kenBurns: "static",
      veoMotion: "Camera locked off; subject animates naturally within the frame",
    },
  ],
];

const DEFAULT_RULE: MotionRule = {
  kenBurns: "zoom-in",
  veoMotion: "Subtle, stable camera; subject performs the described action naturally",
};

export function motionForShotType(shotType: string): MotionRule {
  const normalized = shotType.trim().toLowerCase();
  const hit = MOTION_RULES.find(([pattern]) => normalized.includes(pattern));
  return hit ? hit[1] : DEFAULT_RULE;
}
