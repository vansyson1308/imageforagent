/**
 * Map shotType → chỉ dẫn khung hình gửi cho model ảnh.
 * Match theo substring không phân biệt hoa thường — mở rộng bằng cách thêm entry.
 * Entry đứng trước có độ ưu tiên cao hơn (match cụ thể để trên, chung chung để dưới).
 */
const SHOT_TYPE_RULES: ReadonlyArray<readonly [pattern: string, instruction: string]> = [
  [
    "extreme close-up",
    "Extreme close-up composition, subject's key detail fills the frame, shallow depth of feeling",
  ],
  [
    "close-up",
    "Tight close-up composition on the subject, face and expression clearly visible, minimal background",
  ],
  [
    "wide static shot",
    "Fixed camera, wide establishing framing showing the full scene, character occupies roughly the lower third",
  ],
  [
    "wide shot",
    "Wide establishing framing showing the full scene and environment, character small but clearly visible",
  ],
  [
    "medium shot",
    "Medium framing from the waist up, balanced composition between character and background",
  ],
  [
    "slow zoom-in",
    "Composition framed as the tight end of a zoom-in: close, centered focus on the subject with converging attention",
  ],
  [
    "slow zoom-out",
    "Composition framed as the wide end of a zoom-out: subject centered with generous surrounding context",
  ],
  [
    "over-the-shoulder",
    "Over-the-shoulder framing, foreground shoulder softly out of focus, subject of attention in clear view",
  ],
  [
    "low angle",
    "Low camera angle looking up at the subject, emphasizing scale and presence",
  ],
  [
    "high angle",
    "High camera angle looking down at the subject, showing layout of the scene",
  ],
  [
    "pan",
    "Horizontal panoramic composition suggesting lateral camera movement, scene elements arranged along the width",
  ],
  [
    "bounce-in",
    "Dynamic entrance composition: character mid-motion popping into frame with energetic squash-and-stretch pose",
  ],
  [
    "static shot",
    "Fixed camera, stable balanced framing of the subject at a comfortable medium distance",
  ],
];

const DEFAULT_INSTRUCTION =
  "Clear, stable framing of the subject appropriate to the described action";

export function shotTypeToCameraInstruction(shotType: string): string {
  const normalized = shotType.trim().toLowerCase();
  const rule = SHOT_TYPE_RULES.find(([pattern]) => normalized.includes(pattern));
  return rule ? rule[1] : DEFAULT_INSTRUCTION;
}

export const KNOWN_SHOT_TYPES: readonly string[] = [
  "Static shot",
  "Wide static shot",
  "Wide shot",
  "Medium shot",
  "Close-up",
  "Extreme close-up",
  "Slow zoom-in",
  "Slow zoom-out",
  "Over-the-shoulder",
  "Low angle",
  "High angle",
  "Pan",
];
