import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fillTemplate, markdownToHtml, page } from "../scripts/judge-access-pdf";

const md = readFileSync(path.join(process.cwd(), "docs/hackathon/JUDGE_ACCESS.md"), "utf8");
const values = { passcode: "test-pass-<b>", contact: "owner@example.com", maxConcurrentRuns: "2", maxProjects: "3", retentionHours: "24" };

describe("Judge Access PDF source", () => {
  it("keeps only the placeholder in the repo (never a real passcode)", () => {
    expect(md).toContain("{{DEMO_PASSCODE}}");
    expect(md).toMatch(/4 steps/);
    for (const k of ["Demo", "Health", "Limits", "Contact", "Sample stories", "What to look at"]) expect(md).toContain(k);
  });

  it("fills every placeholder, escapes HTML, and refuses a half-filled file", () => {
    const html = page(markdownToHtml(fillTemplate(md, values)));
    expect(html).toContain("test-pass-&lt;b&gt;");
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(html).toContain('<a href="https://studio-production-049c.up.railway.app/api/health">');
    expect(html).toMatch(/<ol><li>Open the demo/);
    expect(() => fillTemplate(md + "\n{{NEW_THING}}", values)).toThrow(/Unfilled placeholder/);
  });

  it("writes its output only under the git-ignored out/ folder", () => {
    const r = spawnSync("git", ["check-ignore", "out/judge-access/Judge-Access-Storyboard-Studio-Director.pdf"], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });
});
