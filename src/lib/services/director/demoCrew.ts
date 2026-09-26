import { MockLlmProvider, type MockHandler } from "@/lib/providers/mockLlmProvider";
import type { ChatMessage } from "@/lib/providers/types";
import type { CrewModels } from "@/lib/providers";

/**
 * Scripted crew for `LLM_PROVIDER=mock` and the automated tests: answers
 * each ROLE with a small, valid reply derived from the story text. No
 * network, no key, deterministic. Everything it makes is labelled
 * provider "mock" (never presented as Nemotron output).
 */

export const MOCK_MODELS: CrewModels = { strong: "mock-strong", mid: "mock-mid", fast: "mock-fast", vision: "mock-vision" };

const roleOf = (messages: readonly ChatMessage[]) => messages[0]?.content.match(/^ROLE: (\w+)/)?.[1] ?? "UNKNOWN";

function storyOf(messages: readonly ChatMessage[]): string {
  const m = messages[messages.length - 1]?.content.match(/<story>\n([\s\S]*?)\n<\/story>/);
  return m ? m[1] : "A small robot finds a lantern.";
}

function sentences(story: string): string[] {
  return story
    .split(/(?<=[.!?。！？])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

export function demoPlan(story: string, shots: number) {
  const lines = sentences(story);
  const n = Math.max(2, Math.min(shots, Math.max(lines.length, 3)));
  const types = ["Wide shot", "Medium shot", "Close-up", "Slow zoom-in", "Pan"];
  return {
    title: (lines[0] ?? "A short film").slice(0, 60),
    logline: story.slice(0, 200) || "A short film.",
    palette: ["#1d2b4f", "#f4b23c", "#e2571b", "#7ccf7c", "#fef6e4"],
    cast: [
      { id: "hero", name: "Hero", kind: "character", look: "a round orange character with a yellow scarf", colors: ["#e2571b", "#f4b23c", "#241d33"] },
      { id: "home", name: "Home", kind: "set", look: "a quiet street at dusk", colors: ["#1d2b4f", "#3d4a73", "#7ccf7c"] },
    ],
    shots: Array.from({ length: n }, (_, i) => ({
      scene: `SC${Math.floor(i / 3) + 1}`,
      shotType: types[i % types.length],
      description: `Shot ${i + 1}: ${lines[i % Math.max(1, lines.length)] ?? "the hero at home"}`,
      mode: i % 2 === 1 ? "motion" : "still",
      durationSec: 3,
      dialogue: i === 0 ? (lines[0] ?? "Once upon a time.").slice(0, 40) : null,
      speaker: i === 0 ? "Narrator" : null,
      transition: i === n - 1 ? "fadeBlack" : "cut",
      cast: ["hero", "home"],
    })),
  };
}

export const DEMO_LIBRARY = [
  `<symbol id="hero" viewBox="0 0 400 600"><ellipse cx="200" cy="370" rx="130" ry="190" fill="#e2571b"/><rect x="120" y="300" width="160" height="40" rx="12" fill="#f4b23c"/><circle cx="200" cy="170" r="110" fill="#f4b23c"/><path d="M95 150 Q200 20 305 150 Q250 90 200 95 Q150 90 95 150 Z" fill="#241d33"/><circle cx="165" cy="165" r="16" fill="#ffffff"/><circle cx="240" cy="165" r="16" fill="#ffffff"/><circle cx="168" cy="168" r="9" fill="#241d33"/><circle cx="243" cy="168" r="9" fill="#241d33"/><path d="M150 135 L180 130 M225 130 L255 135" stroke="#241d33" stroke-width="6"/><path d="M160 215 Q200 245 240 215" stroke="#241d33" stroke-width="10" fill="none"/><ellipse cx="70" cy="360" rx="28" ry="70" fill="#e2571b"/><ellipse cx="330" cy="360" rx="28" ry="70" fill="#e2571b"/><rect x="120" y="540" width="60" height="60" rx="20" fill="#241d33"/><rect x="220" y="540" width="60" height="60" rx="20" fill="#241d33"/></symbol>`,
  `<linearGradient id="home-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2b4f"/><stop offset="1" stop-color="#3d4a73"/></linearGradient>`,
  `<symbol id="home" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="url(#home-sky)"/><circle cx="1500" cy="220" r="90" fill="#fef6e4"/><circle cx="300" cy="120" r="4" fill="#fef6e4"/><circle cx="700" cy="200" r="3" fill="#fef6e4"/><circle cx="1100" cy="90" r="4" fill="#fef6e4"/><path d="M0 700 Q300 560 600 700 T1200 690 T1920 680 L1920 1080 L0 1080 Z" fill="#2c3a63"/><rect y="860" width="1920" height="220" fill="#7ccf7c"/><rect y="860" width="1920" height="20" fill="#5cb85c"/><rect x="200" y="520" width="360" height="340" fill="#e2571b"/><polygon points="180,520 380,380 580,520" fill="#241d33"/><rect x="250" y="600" width="80" height="80" fill="#f4b23c"/><rect x="420" y="700" width="90" height="160" fill="#241d33"/><rect x="1300" y="600" width="40" height="260" fill="#3d2b1f"/><circle cx="1320" cy="560" r="120" fill="#2f6b3a"/><ellipse cx="960" cy="1000" rx="500" ry="40" fill="#5cb85c"/></symbol>`,
].join("\n");

export function demoFrame(index: number, motion: boolean, heightPct = 55): string {
  const x = 500 + ((index * 173) % 700);
  const h = Math.round((heightPct / 100) * 1080);
  const w = Math.round((h * 2) / 3);
  const svg = [
    "```svg",
    `<use href="#home" x="0" y="0" width="1920" height="1080"/>`,
    `<circle cx="${300 + index * 90}" cy="200" r="40" fill="#f4b23c" opacity="0.8"/>`,
    `<use href="#hero" x="${x}" y="${h > 1080 ? -Math.round(h * 0.05) : Math.min(860 - h, 380)}" width="${w}" height="${h}"/>`,
    "```",
  ];
  if (motion) {
    svg.push(
      "```json",
      JSON.stringify({
        shapes: [{ id: "spark", type: "circle", r: 18, at: [x + 160, 300], fill: "#fef6e4cc" }],
        tracks: [{ target: "shapes.spark.at", keys: [{ t: 0, v: [x + 160, 300] }, { t: 3, v: [x + 220, 180], ease: "inOut" }] }],
      }),
      "```",
    );
  }
  return svg.join("\n");
}

/** The scripted crew. `criticScores` lets tests drive the revision loop. */
export function demoHandler(opts: { criticScores?: number[]; shots?: number } = {}): MockHandler {
  const scores = [...(opts.criticScores ?? [6, 8])];
  let drawn = 0;
  return (messages) => {
    const role = roleOf(messages);
    const user = messages[messages.length - 1]?.content ?? "";
    switch (role) {
      case "DIRECTOR":
        return demoPlan(storyOf(messages), opts.shots ?? 4);
      case "CAST":
        return DEMO_LIBRARY;
      case "ARTIST": {
        drawn++;
        const index = Number(user.match(/shot (\d+) of/)?.[1] ?? drawn);
        const shotType = user.match(/Shot type: ([^.]*)\./)?.[1] ?? "";
        return demoFrame(index, /MOTION shot/.test(user), /close/i.test(shotType) ? 110 : 55);
      }
      case "CRITIC": {
        const s = scores.length > 1 ? scores.shift()! : (scores[0] ?? 8);
        return { score: s, verdict: s < 7 ? "revise" : "accept", issues: s < 7 ? ["the hero is small in frame"] : [], fixes: s < 7 ? ["make the hero larger and centred"] : [] };
      }
      case "EDITOR":
        return { edits: [], notes: "No changes needed." };
      case "CONTINUITY":
        return { ok: true, notes: [] };
      case "RESEARCHER":
        return { queries: [] };
      case "RESEARCH_NOTES":
        return { notes: [] };
      default:
        return "{}";
    }
  };
}

export function createDemoProvider(): MockLlmProvider {
  return new MockLlmProvider(demoHandler(), "mock");
}
