/**
 * Judge Access PDF (SPEC v2 WP9.5). Renders docs/hackathon/JUDGE_ACCESS.md
 * with the passcode read from the environment AT EXPORT TIME, into the
 * git-ignored out/judge-access/ folder. The passcode is never written to the
 * repo, never printed, and never logged.
 *
 *   DEMO_PASSCODE=… npx tsx scripts/judge-access-pdf.ts
 *   # optional: DEMO_CONTACT_EMAIL, DEMO_MAX_CONCURRENT_RUNS, DEMO_MAX_PROJECTS_PER_SESSION,
 *   #           DEMO_RETENTION_HOURS, CHROME_PATH (a Chrome/Chromium/Edge binary)
 *
 * PDF: printed by a local headless Chrome/Chromium/Edge (`--print-to-pdf`).
 * No browser found → the filled HTML is written and you print it to PDF
 * from any browser (Ctrl/Cmd+P → Save as PDF). No new dependency.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline markdown: **bold**, *italic*, `code`, [text](url), bare https links. Input is escaped first. */
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
}

/** The small markdown subset JUDGE_ACCESS.md uses: headings, paragraphs, lists, tables. Pure. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,3}) (.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const body = rows.filter((r) => r.some((c) => c.length > 0));
      out.push(`<table>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table>`);
      continue;
    }
    const ol = line.match(/^\d+\. (.*)$/);
    const ul = line.match(/^- (.*)$/);
    if (ol || ul) {
      const tag = ol ? "ol" : "ul";
      const re = ol ? /^\d+\. (.*)$/ : /^- (.*)$/;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(`<li>${inline(lines[i].match(re)![1])}</li>`), i++;
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3} |\||- |\d+\. )/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

export interface FillValues {
  readonly passcode: string;
  readonly contact: string | null;
  readonly maxConcurrentRuns: string;
  readonly maxProjects: string;
  readonly retentionHours: string;
}

/** Fill the placeholders. Throws if any `{{…}}` is left (never ship a half-filled PDF). */
export function fillTemplate(md: string, v: FillValues): string {
  const filled = md
    .replaceAll("{{DEMO_PASSCODE}}", v.passcode)
    .replaceAll("{{CONTACT}}", v.contact ? `Questions during judging: ${v.contact}` : "Questions during judging: through the Devpost project page.")
    .replaceAll("{{MAX_CONCURRENT_RUNS}}", v.maxConcurrentRuns)
    .replaceAll("{{MAX_PROJECTS}}", v.maxProjects)
    .replaceAll("{{RETENTION_HOURS}}", v.retentionHours);
  const left = filled.match(/\{\{[A-Z_]+\}\}/);
  if (left) throw new Error(`Unfilled placeholder ${left[0]} in JUDGE_ACCESS.md`);
  return filled;
}

export function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Judge Access · Storyboard Studio Director</title>
<style>
@page { size: A4; margin: 16mm 16mm 18mm; }
body { font: 11pt/1.45 -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans JP", "Noto Sans CJK JP", sans-serif; color: #17171c; }
h1 { font-size: 20pt; margin: 0 0 6pt; } h2 { font-size: 13.5pt; margin: 16pt 0 6pt; border-bottom: 1.5pt solid #8b5cf6; padding-bottom: 2pt; }
table { border-collapse: collapse; width: 100%; } td { border: 0.6pt solid #d4d4dc; padding: 5pt 7pt; vertical-align: top; } td:first-child { width: 32%; color: #55556a; }
a { color: #6d28d9; } code { font-size: 9.5pt; background: #f2f0fb; padding: 0 2pt; border-radius: 2pt; } li { margin: 2pt 0; }
</style></head><body>
${body}
</body></html>`;
}

function findBrowser(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (c.includes("/") || c.includes("\\")) {
      if (existsSync(c)) return c;
    } else if (spawnSync(c, ["--version"], { stdio: "ignore" }).status === 0) return c;
  }
  return null;
}

function main() {
  const passcode = process.env.DEMO_PASSCODE?.trim();
  if (!passcode) {
    console.error("Set DEMO_PASSCODE in the environment (the same value as on Railway). It is never written to the repo or printed.");
    process.exit(1);
  }
  const root = process.cwd();
  const md = readFileSync(path.join(root, "docs/hackathon/JUDGE_ACCESS.md"), "utf8");
  const filled = fillTemplate(md, {
    passcode,
    contact: process.env.DEMO_CONTACT_EMAIL?.trim() || null,
    maxConcurrentRuns: process.env.DEMO_MAX_CONCURRENT_RUNS || "2",
    maxProjects: process.env.DEMO_MAX_PROJECTS_PER_SESSION || "3",
    retentionHours: process.env.DEMO_RETENTION_HOURS || "24",
  });
  const outDir = path.join(root, "out", "judge-access");
  mkdirSync(outDir, { recursive: true });
  const html = path.join(outDir, "JUDGE_ACCESS.html");
  const pdf = path.join(outDir, "Judge-Access-Storyboard-Studio-Director.pdf");
  writeFileSync(html, page(markdownToHtml(filled)));
  const browser = findBrowser();
  if (!browser) {
    console.log(`No Chrome/Chromium/Edge found. Open ${html} in a browser and print it to PDF (Ctrl/Cmd+P → Save as PDF). Delete the HTML afterwards.`);
    return;
  }
  const r = spawnSync(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { stdio: "ignore", timeout: 60_000 });
  if (r.status !== 0 || !existsSync(pdf)) {
    console.log(`The browser could not print the PDF. Open ${html} and print it to PDF manually.`);
    return;
  }
  rmSync(html, { force: true }); // the filled HTML holds the passcode: keep only the PDF
  console.log(`Wrote ${path.relative(root, pdf)} (git-ignored). Upload it to Devpost as the Judge Access file.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
