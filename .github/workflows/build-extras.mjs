// Ui Books - build extras. Runs right after build-pages.mjs and before the safety check.
//  1. Puts real text and links on the home page (visible to everyone, and readable by search engines
//     that do not run JavaScript): a short introduction, the stories, the genres and the authors.
//  2. Writes feed.xml (RSS) with the newest chapters, and links to it from every page.
//  3. Adds the Terms and Copyright pages to the sitemap, and a better home page description.
// It only changes files inside "dist". If something it expects is missing it says so and carries on.
import fs from "node:fs";
import path from "node:path";

const SITE = (process.env.SITE_URL || "https://mbh5626-ops.github.io/UiBookstudy").replace(/\/+$/, "");
const SB_URL = process.env.SB_URL || "https://cqamtbmrlkkerwpnypdh.supabase.co";
const SB_KEY = process.env.SB_KEY || "sb_publishable_KGq6gw1-ItPA-VBDXgKoNA_cv2LWxil";
const OUT = process.env.OUT_DIR || "dist";

/* ---------- helpers (same rules as build-pages.mjs, so every link matches a real page) ---------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cut = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const slugify = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/, "");
function groupBy(list, keyFn, prefix) {
  const groups = new Map();
  for (const b of list) {
    const name = String(keyFn(b) || "").trim(); if (!name) continue;
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name, books: [] });
    groups.get(key).books.push(b);
  }
  const used = new Set(), out = [];
  for (const g of [...groups.values()].sort((x, y) => x.name.localeCompare(y.name))) {
    const base = slugify(g.name) || `${prefix}-${hash(g.name).toString(36)}`; let u = base, i = 2;
    while (used.has(u)) u = `${base}-${i++}`;
    used.add(u); g.slug = u; out.push(g);
  }
  return out;
}
async function rest(table, query) {
  let last;
  for (let t = 0; t < 3; t++) {
    try {
      const rows = [];
      for (let off = 0; ; off += 100) {
        const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}&limit=100&offset=${off}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: "application/json" } });
        if (!r.ok) throw new Error(`${table}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
        const part = await r.json();
        rows.push(...part);
        if (part.length < 100) return rows;
      }
    } catch (e) { last = e; await new Promise((ok) => setTimeout(ok, 1500)); }
  }
  throw last;
}
const readIf = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);

/* ---------- data ---------- */
const books = (await rest("books", "select=id,title,author,genre,description,sort_order,created_at,updated_at&published=eq.true&order=sort_order.asc,created_at.asc"))
  .filter((b) => /^[a-z0-9-]{3,60}$/.test(b.id));
const chapRows = await rest("book_chapters", "select=id,book_id,chapter_number,title,content,updated_at&order=book_id.asc,chapter_number.asc");
const byId = new Map(books.map((b) => [b.id, b]));
const chapters = chapRows.filter((c) => byId.has(c.book_id) && String(c.content || "").trim());
const genreGroups = groupBy(books, (b) => b.genre, "genre"), authorGroups = groupBy(books, (b) => b.author, "author");
console.log(`Extras: ${books.length} books, ${chapters.length} readable chapters.`);

/* ---------- 1. home page ---------- */
const indexFile = path.join(OUT, "index.html");
let home = readIf(indexFile);
if (!home) {
  console.log("Note: dist/index.html not found, home page text skipped.");
} else {
  const swap = (needle, html, what) => {
    if (!home.includes(needle)) { console.log(`Note: could not find the place for ${what} on the home page, skipped.`); return; }
    home = home.replace(needle, html);
  };
  const featured = books.slice(0, 24);
  const nG = genreGroups.length, nB = books.length;
  const intro = `Ui Books is a free reading room by Lantern Light. Browse ${nB} fantasy, epic, romance and adventure ${nB === 1 ? "story" : "stories"}${nG > 1 ? ` across ${nG} genres` : ""}, read short chapters right in your browser, and keep your place on every device.`;
  const section = `
  <section class="gl" id="seo-home" style="margin-top:22px" aria-labelledby="seo-h">
   <h2 id="seo-h">Free fantasy stories to read online</h2>
   <p class="sub" style="max-width:680px;margin-bottom:18px">${esc(intro)}</p>
   ${featured.length ? `<h3 style="margin:6px 0 8px">Stories to start with</h3><ul class="seo-list">${featured.map((b) => `<li><a href="books/${b.id}/">${esc(b.title)}</a><span>by ${esc(b.author)} · ${esc(b.genre)}</span></li>`).join("")}</ul>${nB > featured.length ? `<p><a href="books/" style="color:var(--gold)">See all ${nB} stories in the library</a></p>` : ""}` : ""}
   ${genreGroups.length ? `<h3 style="margin:18px 0 8px">Browse by genre</h3><p class="ch">${genreGroups.slice(0, 40).map((g) => `<a class="chip" href="genres/${g.slug}/">${esc(g.name)}</a>`).join("")}</p>` : ""}
   ${authorGroups.length ? `<h3 style="margin:6px 0 8px">Authors</h3><p class="ch">${authorGroups.slice(0, 40).map((g) => `<a class="chip" href="authors/${g.slug}/">${esc(g.name)}</a>`).join("")}</p>` : ""}
   <p class="sub" style="margin-top:6px">Want to share your own story? <a href="apply.html" style="color:var(--gold);text-decoration:underline">Write for Ui Books</a>. New chapters are also available as an <a href="feed.xml" style="color:var(--gold);text-decoration:underline">RSS feed</a>.</p>
  </section>`;
  swap('<div class="tiles" id="rl"></div></div>', '<div class="tiles" id="rl"></div></div>' + section, "the story lists");

  swap("</style>\n</head>", ".seo-list{list-style:none;padding:0;columns:2;gap:28px;margin:0 0 12px}.seo-list li{padding:7px 0;border-bottom:1px solid var(--ln);break-inside:avoid}.seo-list a{color:var(--gold)}.seo-list a:hover{text-decoration:underline}.seo-list span{display:block;color:var(--mu);font-size:15px}@media(max-width:640px){.seo-list{columns:1}}\n</style>\n</head>", "its styles");

  const desc = `Free fantasy, epic, romance and adventure stories to read online. ${nB} ${nB === 1 ? "book" : "books"} with short chapters, and your place saved on every device. Read by lantern light at Ui Books.`;
  swap('<meta name="description" content="Ui Books is a free home for fantasy tales. Read short chapters, listen aloud, save favourites and stay focused with a study timer.">',
    `<meta name="description" content="${esc(cut(desc, 300))}">\n<meta name="robots" content="index,follow,max-image-preview:large">`, "the description");

  const ldItems = {
    "@context": "https://schema.org", "@type": "ItemList", name: "Stories at Ui Books",
    itemListElement: featured.map((b, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/books/${b.id}/`, name: b.title })),
  };
  const ldOrg = { "@context": "https://schema.org", "@type": "Organization", name: "Lantern Light", url: `${SITE}/`, brand: { "@type": "Brand", name: "Ui Books" } };
  const ld = (o) => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, "\\u003c") + "</script>";
  swap('<link rel="canonical" href="https://mbh5626-ops.github.io/UiBookstudy/">',
    `<link rel="canonical" href="${esc(SITE)}/">\n${ld(ldOrg)}${featured.length ? "\n" + ld(ldItems) : ""}`, "the structured data");
  fs.writeFileSync(indexFile, home);
}

/* ---------- 2. RSS feed, linked from every page ---------- */
const latest = [...chapters].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || (b.chapter_number - a.chapter_number)).slice(0, 40);
const rfc = (d) => new Date(d).toUTCString();
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>Ui Books – new chapters</title>
<link>${esc(SITE)}/</link>
<description>The newest chapters of free fantasy stories at Ui Books, read by lantern light.</description>
<language>en</language>
<atom:link href="${esc(SITE)}/feed.xml" rel="self" type="application/rss+xml"/>${latest.length ? `\n<lastBuildDate>${rfc(latest[0].updated_at)}</lastBuildDate>` : ""}
${latest.map((c) => {
    const b = byId.get(c.book_id), url = `${SITE}/books/${b.id}/chapter-${c.chapter_number}/`;
    const first = String(c.content).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)[0] || "";
    return `<item><title>${esc(`${b.title}: ${c.title}`)}</title><link>${esc(url)}</link><guid isPermaLink="true">${esc(url)}</guid><pubDate>${rfc(c.updated_at)}</pubDate><description>${esc(cut(first, 300))}</description></item>`;
  }).join("\n")}
</channel></rss>
`;
fs.writeFileSync(path.join(OUT, "feed.xml"), feed);

const alt = `<link rel="alternate" type="application/rss+xml" title="Ui Books – new chapters" href="${esc(SITE)}/feed.xml">\n`;
const walk = (dir, list) => {
  if (!fs.existsSync(dir)) return list;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, list); else if (e.name === "index.html") list.push(p);
  }
  return list;
};
const pages = [indexFile, ...walk(path.join(OUT, "books"), []), ...walk(path.join(OUT, "genres"), []), ...walk(path.join(OUT, "authors"), [])];
let linked = 0;
for (const f of pages) {
  const h = readIf(f);
  if (!h || h.includes("application/rss+xml") || !h.includes("</head>")) continue;
  fs.writeFileSync(f, h.replace("</head>", alt + "</head>")); linked++;
}

/* ---------- 3. sitemap: Terms and Copyright ---------- */
const smFile = path.join(OUT, "sitemap.xml");
let sm = readIf(smFile);
if (sm) {
  const add = ["terms.html", "copyright.html"].filter((p) => fs.existsSync(path.join(OUT, p)) && !sm.includes(`${SITE}/${p}`));
  if (add.length) { sm = sm.replace("</urlset>", add.map((p) => `  <url><loc>${esc(`${SITE}/${p}`)}</loc></url>\n`).join("") + "</urlset>"); fs.writeFileSync(smFile, sm); }
}
console.log(`Extras done: feed with ${latest.length} items, RSS link added to ${linked} pages.`);
