// Ui Books - safety check. Runs after the build and before anything is published.
//  1. Stops the publish if the build looks broken (for example 0 books because the database was unreachable),
//     so the live site stays exactly as it is. GitHub then emails you about the failed run.
//  2. On the automatic runs, says whether anything changed since the live site was published.
//     If nothing changed, nothing is published (no needless deploys).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SITE = (process.env.SITE_URL || "https://mbh5626-ops.github.io/UiBookstudy").replace(/\/+$/, "");
const OUT = process.env.OUT_DIR || "dist";
const AUTO = process.env.EVENT_NAME === "schedule";
const FORCE = process.env.FORCE === "true";

const setOutput = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const fail = (msg) => { console.error(`::error::${msg}`); setOutput("changed", "false"); process.exit(1); };
const live = async (p) => {
  try { const r = await fetch(`${SITE}/${p}?t=${Date.now()}`, { cache: "no-store" }); return r.ok ? await r.text() : null; } catch { return null; }
};

/* ---- 1. is the build healthy? ---- */
let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(OUT, "books/manifest.json"), "utf8")); }
catch { fail("The build did not produce books/manifest.json, so nothing was published."); }
const count = Object.keys(manifest.books || {}).length;
if (!count) fail("The build found 0 published books. Publishing it would remove every book page, so the live site was left untouched. Check the database, then run the workflow again.");
for (const f of ["index.html", "books/index.html", "sitemap.xml"]) {
  if (!fs.existsSync(path.join(OUT, f))) fail(`The build is missing ${f}, so nothing was published.`);
}
const liveManifest = await live("books/manifest.json");
if (liveManifest && !FORCE) {
  try {
    const before = Object.keys(JSON.parse(liveManifest).books || {}).length;
    if (before >= 4 && count < before / 2) {
      fail(`The build has ${count} books but the live site has ${before}. That looks like a database problem, so nothing was published. If you removed books on purpose, run the workflow by hand and tick "Publish even if the book count dropped".`);
    }
  } catch { /* live manifest unreadable: ignore */ }
}

/* ---- 2. did anything change? ---- */
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else files.push(p);
  }
};
for (const d of ["books", "genres", "authors"]) if (fs.existsSync(path.join(OUT, d))) walk(path.join(OUT, d));
files.push(path.join(OUT, "sitemap.xml"));
const h = crypto.createHash("sha256");
for (const f of files.filter((f) => !f.endsWith("manifest.json")).sort()) {
  h.update(path.relative(OUT, f).replace(/\\/g, "/")); h.update("\0"); h.update(fs.readFileSync(f)); h.update("\0");
}
const hash = h.digest("hex");
fs.writeFileSync(path.join(OUT, "build-hash.txt"), hash + "\n");

const liveHash = ((await live("build-hash.txt")) || "").trim();
const changed = !AUTO || FORCE || liveHash !== hash;
console.log(`Books: ${count}. Build fingerprint: ${hash.slice(0, 12)}. Live: ${liveHash ? liveHash.slice(0, 12) : "unknown"}. ${changed ? "Publishing." : "Nothing changed, skipping the publish."}`);
setOutput("changed", changed ? "true" : "false");
