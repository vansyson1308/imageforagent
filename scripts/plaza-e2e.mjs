// E2E qua app THẬT như client agent: project → script → construct → artwork → zip.
// + stress rate limit có chủ đích. Chạy: npx tsx scripts/plaza-e2e.mjs
import { writeFileSync } from "node:fs";
import { plazaSpec } from "./plaza-scene.mjs";

const BASE = "http://localhost:3000";
const j = (r) => r.json();
const post = (url, body) =>
  fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const put = (url, body) =>
  fetch(BASE + url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Chờ server
for (let i = 0; i < 30; i++) {
  try { await fetch(BASE + "/api/meta"); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
}

const findings = [];

// 1. Project + script
const project = await j(await post("/api/projects", { name: "Quảng trường đêm — audit v3" }));
console.log("project:", project.id);
const tsv = "1\tWide shot\tHero shot: du khách vẫy tram giữa quảng trường đêm\n2\tExtreme wide shot\tOverview toàn cảnh quảng trường\n3\tSlow zoom-in\tKeyframe animation: tram ngang qua, hero vẫy";
await post("/api/script/import", { projectId: project.id, source: "tsv", tsvText: tsv });
const hydrated = await j(await fetch(BASE + `/api/projects/${project.id}`));
const frames = hydrated.frames;
console.log("frames:", frames.length);

// 2. Construct qua API cho 3 shot (spec sinh từ builder — đúng luồng client)
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const e60 = easeInOut(60 / 95);
const shots = [
  { spec: plazaSpec({ orbit: { azimuth: -23, elevation: 17.5 }, at: [900, 650], scale: 1.08 }), name: "hero" },
  { spec: plazaSpec({ orbit: { azimuth: -27, elevation: 21 }, at: [960, 610], scale: 0.6 }), name: "overview" },
  { spec: plazaSpec({ frame: 60, orbit: { azimuth: -30 + 9 * e60, elevation: 22 - 6 * e60 }, at: [980 - 75 * e60, 615 + 40 * e60], scale: 0.68 + 0.38 * e60 }), name: "anim-f60" },
];
for (let i = 0; i < shots.length; i++) {
  const t0 = performance.now();
  const res = await post("/api/construct", { spec: shots[i].spec });
  const body = await j(res);
  if (!res.ok) {
    findings.push(`construct ${shots[i].name}: HTTP ${res.status} — ${body.error?.message}`);
    console.log("FAIL construct", shots[i].name, res.status, body.error?.message);
    continue;
  }
  console.log(
    `construct ${shots[i].name}: ${res.status} in ${(performance.now() - t0).toFixed(0)}ms —`,
    `compileMs=${body.stats.compileMs} bytes=${body.stats.bytes} effects=${body.stats.effectPaths}`,
    `warnings=${body.warnings.length}`,
  );
  // 3. PUT artwork (render sync qua app)
  const svg = `<rect width="1920" height="1080" fill="#0a0e24"/>${body.svg}`;
  const t1 = performance.now();
  const fRes = await put(`/api/frames/${frames[i].id}/artwork`, { svg });
  const fBody = await j(fRes);
  console.log(
    `artwork f${i + 1}: ${fRes.status} in ${(performance.now() - t1).toFixed(0)}ms — status=${fBody.status} imageUrl=${fBody.imageUrl ? "OK" : "MISSING"}`,
  );
  if (!fRes.ok || fBody.status !== "done") findings.push(`artwork ${shots[i].name}: ${fRes.status} / ${fBody.status} ${fBody.errorMsg ?? ""}`);
}

// 4. Export ZIP
const zipRes = await fetch(BASE + `/api/export/zip?projectId=${project.id}`);
const zipBuf = Buffer.from(await zipRes.arrayBuffer());
writeFileSync("storage/plaza-export.zip", zipBuf);
console.log(`zip: ${zipRes.status}, ${(zipBuf.length / 1024).toFixed(0)}KB → storage/plaza-export.zip`);
if (!zipRes.ok) findings.push(`zip export: ${zipRes.status}`);

// 5. Stress rate limit CÓ CHỦ ĐÍCH: bắn 35 construct nhanh — kỳ vọng 429 sau ~30/10s
let ok = 0, limited = 0;
const tinySpec = { version: 1, solids: [{ id: "b", type: "box", size: [100, 100, 100], fill: "#cc8844" }] };
for (let i = 0; i < 35; i++) {
  const r = await post("/api/construct", { spec: tinySpec });
  if (r.status === 429) limited++;
  else if (r.ok) ok++;
}
console.log(`rate-limit probe: ${ok} OK, ${limited} × 429`);
if (limited === 0) findings.push("rate limit KHÔNG kích hoạt sau 35 request/10s — kiểm tra enforceRateLimit");

console.log("\nFINDINGS:", findings.length ? findings : "(none — mọi luồng OK)");
