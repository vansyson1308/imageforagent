import { piperHas, type PiperModel } from "@/lib/services/tts";
import type { CastMember } from "@/lib/services/director/schemas";

/**
 * Voice casting (SPEC v2 WP4.5): every speaking character gets a consistent
 * voice for the whole film (and the whole series, WP5). With Piper installed:
 * a neural voice per language and gender, and age as a pitch shift (children
 * higher, elders lower). Without it: espeak-ng as before. Deterministic and
 * pure given the installed voices; the choice is recorded in the trace.
 */

export interface VoiceCast {
  /** id passed to synthesizeSpeech: "piper:<model>[#speaker][@semitones]" or an espeak-ng voice */
  readonly voice: string;
  /** human label for the trace and UI */
  readonly label: string;
}

const ESPEAK: Record<string, string> = { en: "en-us", vi: "vi", ja: "ja", zh: "cmn", ko: "ko", fr: "fr-fr", es: "es", id: "id" };

/** whole-word match for Vietnamese (JS \b is ASCII-only), substring match for CJK */
const vi = (words: string) => `(?<!\\p{L})(?:${words})(?!\\p{L})`;
const rx = (en: string, viWords: string, cjk: string) => new RegExp(`\\b(?:${en})\\b|${vi(viWords)}|${cjk}`, "iu");

const FEMALE = rx("woman|women|girl|grandma|grandmother|granny|mother|mom|mum|she|her|lady|queen|princess|daughter|sister|aunt|wife|bride|widow|maid", "bà|mẹ|chị|cô|bé gái|nữ|cô bé", "女|娘|母|おばあ|お母|少女|姉|妹|妻");
const MALE = rx("man|men|boy|grandpa|grandfather|father|dad|he|his|king|prince|son|brother|uncle|husband|groom|monk|lord", "ông|bố|cha|anh|chú|cậu|bé trai|cậu bé", "男|父|おじい|お父|少年|兄|弟|夫");
const CHILD = rx("child|kid|little|girl|boy|toddler|baby|five|six|seven|eight|nine", "bé|cháu|em|cô bé|cậu bé", "子|ちゃん|くん|少年|少女");
const ELDER = new RegExp(`\\b(?:grandma|grandmother|granny|grandpa|grandfather|elderly|aged|widow)\\b|(?<!year-|years )\\bold\\b|${vi("bà|ông|cụ|bà ngoại|ông nội")}|おばあ|おじい|老`, "iu");

export function voiceTraits(member: Pick<CastMember, "name" | "look"> | null): { gender: "female" | "male"; age: "child" | "adult" | "elder" } {
  if (!member) return { gender: "female", age: "adult" };
  const text = `${member.name} ${member.look}`;
  const f = FEMALE.test(text);
  const m = MALE.test(text);
  const gender = m && !f ? "male" : "female";
  const age = ELDER.test(text) ? "elder" : CHILD.test(text) ? "child" : "adult";
  return { gender, age };
}

function piperFor(language: string, gender: "female" | "male"): { model: PiperModel; speaker?: number; maleShift: number } | null {
  if (language === "en") return { model: gender === "male" ? "en_US-john-medium" : "en_US-kristin-medium", maleShift: 0 };
  if (language === "vi") return { model: "vi_VN-vais1000-medium", maleShift: -4 };
  if (language === "ja") return { model: "ja_JP-hi_fi_captain-medium", speaker: gender === "male" ? 1 : 0, maleShift: 0 };
  return null;
}

/** The voice of a cast member (null = the narrator) in a film language. */
export function castVoice(language: string, member: Pick<CastMember, "name" | "look"> | null, has: (m: PiperModel) => boolean = piperHas): VoiceCast {
  const { gender, age } = voiceTraits(member);
  const p = piperFor(language, gender);
  if (p && has(p.model)) {
    const shift = (gender === "male" ? p.maleShift : 0) + (age === "child" ? 3 : age === "elder" ? (gender === "male" ? -2 : -1) : 0);
    const voice = `piper:${p.model}${p.speaker !== undefined ? `#${p.speaker}` : ""}${shift ? `@${shift}` : ""}`;
    return { voice, label: `Piper ${p.model}${shift ? ` ${shift > 0 ? "+" : ""}${shift} st` : ""}${member ? ` (${gender}, ${age})` : " (narrator)"}` };
  }
  const espeak = ESPEAK[language] ?? (/^[a-z]{2,3}$/.test(language) ? language : "en-us");
  return { voice: espeak, label: `espeak-ng ${espeak}` };
}
