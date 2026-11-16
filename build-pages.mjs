// Ui Books - static page builder.
// Reads the PUBLISHED books and chapters from Supabase (public data only) and writes
// real, fast HTML pages for Google and readers:
//   books/                       the library
//   books/<id>/                  one page per book
//   books/<id>/chapter-<n>/      one page per chapter
//   og/<id>.png                  share-preview pictures (books without an uploaded cover)
//   sitemap.xml                  every page above
// Everything is written to the "dist" folder, which the workflow publishes.
import fs from "node:fs";
import path from "node:path";

const SITE = (process.env.SITE_URL || "https://mbh5626-ops.github.io/UiBookstudy").replace(/\/+$/, "");
const SB_URL = process.env.SB_URL || "https://cqamtbmrlkkerwpnypdh.supabase.co";
const SB_KEY = process.env.SB_KEY || "sb_publishable_KGq6gw1-ItPA-VBDXgKoNA_cv2LWxil";
const SRC = process.env.SRC_DIR || ".";
const OUT = process.env.OUT_DIR || "dist";
const SKIP = new Set([".git", ".github", "node_modules", "scripts", "dist", "README.md", "build-pages.mjs", "package.json", "package-lock.json"]);

let sharp = null;
try { sharp = (await import("sharp")).default; } catch { console.log("Note: image tool not available, share pictures will be skipped."); }

/* ---------- helpers ---------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ld = (o) => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, "\\u003c") + "</script>";
const cut = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const day = (d) => (d ? String(d).slice(0, 10) : "");
const hex = (v, d) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
const nu = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const PALS = [["#1a2f6e", "#0b1640", "#7fd6ff"], ["#5a0f1c", "#2a0610", "#ff9a5a"], ["#0e4a38", "#052a1f", "#d9f27a"], ["#4c1a58", "#1f0a35", "#ffd6f0"],
  ["#2e2f66", "#10113a", "#b6b8ff"], ["#6b2a0b", "#2a0f05", "#ffb347"], ["#133a5c", "#071a30", "#aef0ff"], ["#2f0f3f", "#12061f", "#ff8fb8"]];

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

/* ---------- artwork (same look as the website) ---------- */
function artFor(b) {
  const h = hash(b.id), pal = PALS[h % PALS.length];
  let c = pal.slice(), x = 30 + (h % 45), y = 28 + ((h >> 3) % 12), r = 9 + ((h >> 5) % 8);
  const a = b.art;
  if (a && typeof a === "object") {
    const cc = Array.isArray(a.c) ? a.c : [];
    c = [hex(cc[0], c[0]), hex(cc[1], c[1]), hex(cc[2], c[2])];
    x = nu(a.x, 0, 100, x); y = nu(a.y, 0, 140, y); r = nu(a.r, 4, 30, r);
  }
  return { c, x, y, r };
}
const sceneInner = (a) => `<rect width="100" height="140" fill="${a.c[0]}"/><circle cx="${a.x}" cy="${a.y}" r="${a.r * 1.8}" fill="${a.c[2]}" opacity=".2"/><circle cx="${a.x}" cy="${a.y}" r="${a.r}" fill="${a.c[2]}"/><path d="M0 105L22 75 40 98 66 62 100 100V140H0Z" fill="${a.c[1]}" opacity=".9"/><path d="M0 122L30 96 55 116 82 90 100 108V140H0Z" fill="#000" opacity=".45"/><g fill="#fff" opacity=".85"><circle cx="14" cy="18" r="1"/><circle cx="40" cy="10" r="1.2"/><circle cx="84" cy="22" r="1"/><circle cx="60" cy="26" r=".8"/></g>`;
const scene = (a, label) => `<svg viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(label)}">${sceneInner(a)}</svg>`;
const coverOk = (u) => typeof u === "string" && u.startsWith(`${SB_URL}/storage/v1/object/public/book-covers/`) && /^[A-Za-z0-9:\/._%~+@=?&-]+$/.test(u);

async function ogPng(a, file) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a.c[1]}"/><stop offset="1" stop-color="#04020d"/></linearGradient><clipPath id="k"><rect x="396" y="30" width="408" height="570" rx="10"/></clipPath></defs><rect width="1200" height="630" fill="url(#g)"/><circle cx="170" cy="520" r="280" fill="${a.c[2]}" opacity=".08"/><circle cx="1040" cy="110" r="210" fill="${a.c[0]}" opacity=".55"/><g clip-path="url(#k)"><svg x="396" y="30" width="408" height="570" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice">${sceneInner(a)}</svg></g><rect x="396" y="30" width="408" height="570" rx="10" fill="none" stroke="#e0b45a" stroke-opacity=".7" stroke-width="3"/></svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
}

/* ---------- page shell ---------- */
const CSS = `:root{color-scheme:dark;--ink:#f4ead2;--mu:#a9a1c8;--ln:rgba(190,160,255,.2);--gold:#e0b45a;--em:#d9546e;--teal:#3fc6b8;--gl:rgba(20,12,44,.82);--bg:#04020d}
:root[data-theme=light]{color-scheme:light;--ink:#30233f;--mu:#665c74;--ln:rgba(93,62,122,.24);--gold:#94600d;--em:#ad3554;--teal:#087f78;--gl:rgba(255,250,239,.92);--bg:#f4efe6}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--ink);font:18px/1.5 "Crimson Pro",Georgia,serif;min-height:100vh}
body:before{content:"";position:fixed;inset:0;z-index:-1;background:radial-gradient(ellipse at 50% 120%,#2a0f5c,transparent 62%),radial-gradient(ellipse at 90% -10%,rgba(63,198,184,.18),transparent 50%)}
:root[data-theme=light] body:before{background:radial-gradient(ellipse at 50% 120%,#e4d9f5,transparent 62%)}
a{color:inherit;text-decoration:none}.hd{display:flex;align-items:center;gap:18px;max-width:900px;margin:0 auto;padding:16px 18px}
.logo{font:700 22px Cinzel,serif;color:var(--gold)}.hd nav{display:flex;gap:16px;margin-left:auto;font:500 13px Cinzel,serif;letter-spacing:.06em}
.hd nav a:hover,.crumb a:hover,.ft a:hover,.chl a:hover,.more a:hover{color:var(--gold)}.wrap{max-width:900px;margin:0 auto;padding:0 18px 50px}
.gl{background:var(--gl);border:1px solid var(--ln);border-radius:20px;padding:22px;margin-bottom:18px}
h1,h2,h3{font-family:Cinzel,serif;font-weight:500}h1{font-size:clamp(26px,5vw,38px);line-height:1.15;color:var(--gold)}h2{font-size:19px;color:var(--gold);margin-bottom:12px}
.crumb{font-size:15px;color:var(--mu);margin:4px 0 16px}.book{display:grid;grid-template-columns:minmax(150px,230px) 1fr;gap:26px;align-items:start}
.cv{position:relative;aspect-ratio:3/4.2;border-radius:3px 10px 10px 3px;overflow:hidden;box-shadow:inset 5px 0 0 rgba(0,0,0,.3),0 20px 30px -10px #000c,0 0 0 1px rgba(255,235,180,.18);background:#150b45}
.cv svg,.cv img{position:absolute;inset:0;width:100%;height:100%;display:block;object-fit:cover}
.by{color:var(--mu);font:italic 21px "Crimson Pro",serif;margin:4px 0 2px}.meta{color:var(--mu);font-size:15px;margin-bottom:14px}.desc{font-size:19px;margin-bottom:18px;max-width:560px}
.acts{display:flex;gap:10px;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;border-radius:10px;padding:12px 22px;font:700 12px Cinzel,serif;letter-spacing:.08em;background:linear-gradient(135deg,var(--gold),#b9822f);color:#2a1606}
.btn.g{background:rgba(255,255,255,.06);color:var(--ink);border:1px solid var(--ln)}
.chl{list-style:none;padding:0;columns:2;gap:24px}.chl li{break-inside:avoid;padding:8px 0;border-bottom:1px solid var(--ln)}.chl span{color:var(--gold);font:700 13px Cinzel,serif;margin-right:10px}
.more{list-style:none;padding:0}.more li{padding:8px 0;border-bottom:1px solid var(--ln)}.more span{color:var(--mu);font-size:15px;margin-left:8px}
.read{max-width:660px;margin:0 auto}.read .kick{color:var(--mu);font-size:15px;line-height:1.4;margin:0}.read h1{margin:4px 0 22px}
.read p{font-size:20px;line-height:1.8;margin-bottom:20px}.read h1+p:first-letter{font:700 3.1em/.8 Cinzel,serif;float:left;color:var(--gold);padding:6px 10px 0 0}
.pn{display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;margin-top:26px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:22px}.grid a{display:block}.grid .t{font:500 14px Cinzel,serif;margin-top:10px}.grid .s{color:var(--mu);font-size:14px}
.ft{max-width:900px;margin:0 auto;padding:6px 18px 40px;color:var(--mu);font-size:15px;display:flex;gap:6px 16px;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--teal);outline-offset:3px}@media(max-width:640px){.book{grid-template-columns:1fr}.book .cv{width:min(210px,100%);margin:0 auto}.chl{columns:1}}`;

function shell({ depth, title, desc, canonicalPath, image, body, json = [] }) {
  const R = "../".repeat(depth), url = SITE + canonicalPath;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#04020d">
<meta property="og:type" content="website"><meta property="og:site_name" content="Ui Books">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(image)}">` : '<meta name="twitter:card" content="summary">'}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2314082e'/%3E%3Ctext x='32' y='43' font-size='30' text-anchor='middle' fill='%23e0b45a' font-family='serif'%3EUi%3C/text%3E%3C/svg%3E">
<script>try{if(localStorage.getItem("ui-theme")==="light")document.documentElement.setAttribute("data-theme","light")}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Crimson+Pro:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<style>${CSS}</style>
${json.map(ld).join("\n")}
</head>
<body>
<header class="hd"><a class="logo" href="${R}" aria-label="Ui Books home">Ui</a><nav aria-label="Main"><a href="${R}">Home</a><a href="${R}books/">Library</a></nav></header>
<main class="wrap">
${body}
</main>
<footer class="ft"><a href="${R}">Home</a><a href="${R}books/">All books</a><a href="${R}privacy.html">Privacy</a><span>© ${new Date().getFullYear()} Ui Books · Read by lantern light</span></footer>
</body>
</html>
`;
}
const crumbLd = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it[0], item: it[1] })) });

/* ---------- build ---------- */
const startedAt = Date.now();
const books = (await rest("books", "select=id,title,author,genre,description,cover_url,art,sort_order,created_at,updated_at&published=eq.true&order=sort_order.asc,created_at.asc"))
  .filter((b) => /^[a-z0-9-]{3,60}$/.test(b.id));
const chapRows = await rest("book_chapters", "select=id,book_id,chapter_number,title,content,updated_at&order=book_id.asc,chapter_number.asc");
const chaps = {};
for (const c of chapRows) (chaps[c.book_id] = chaps[c.book_id] || []).push(c);
console.log(`Fetched ${books.length} published books and ${chapRows.length} chapters.`);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const name of fs.readdirSync(SRC)) {
  if (SKIP.has(name) || name.endsWith(".sql") || path.resolve(SRC, name) === path.resolve(OUT)) continue;
  fs.cpSync(path.join(SRC, name), path.join(OUT, name), { recursive: true });
}
const write = (rel, text) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

fs.mkdirSync(path.join(OUT, "og"), { recursive: true });
const defArt = artFor({ id: "ui-books-default", art: { c: ["#4c1a58", "#1f0a35", "#e0b45a"], x: 62, y: 30, r: 14 } });
let hasDefaultOg = false;
if (sharp) { try { await ogPng(defArt, path.join(OUT, "og/default.png")); hasDefaultOg = true; } catch (e) { console.log("default share picture failed:", e.message); } }

const urls = [{ loc: `${SITE}/` }, { loc: `${SITE}/books/` }, { loc: `${SITE}/privacy.html` }];
const infoFor = {};
for (const b of books) {
  const a = artFor(b), L = (chaps[b.id] || []).filter((c) => String(c.content || "").trim());
  let image = coverOk(b.cover_url) ? b.cover_url : null;
  if (!image && sharp) { try { await ogPng(a, path.join(OUT, `og/${b.id}.png`)); image = `${SITE}/og/${b.id}.png`; } catch (e) { console.log(`share picture for ${b.id} failed:`, e.message); } }
  if (!image && hasDefaultOg) image = `${SITE}/og/default.png`;
  infoFor[b.id] = { a, L, image };
}

const cvHtml = (b) => {
  const i = infoFor[b.id];
  return `<div class="cv">${coverOk(b.cover_url) ? `<img src="${esc(b.cover_url)}" alt="Cover of ${esc(b.title)}" loading="lazy" decoding="async">` : scene(i.a, `Artwork for ${b.title}`)}</div>`;
};

for (const b of books) {
  const { a, L, image } = infoFor[b.id], bUrl = `${SITE}/books/${b.id}/`;
  const desc = cut(b.description || `Read “${b.title}” by ${b.author}, a free ${b.genre} story, online at Ui Books.`, 155);
  const more = books.filter((x) => x.id !== b.id).sort((x, y) => (x.genre === b.genre ? -1 : 0) - (y.genre === b.genre ? -1 : 0)).slice(0, 6);
  const body = `<nav class="crumb" aria-label="Breadcrumb"><a href="../../">Home</a> › <a href="../">Library</a> › ${esc(b.title)}</nav>
<article class="gl book">${cvHtml(b)}<div><h1>${esc(b.title)}</h1><p class="by">by ${esc(b.author)}</p><p class="meta">${esc(b.genre)} · ${L.length ? L.length + " chapter" + (L.length > 1 ? "s" : "") : "Chapters coming soon"} · Free to read</p><p class="desc">${esc(b.description || "")}</p><div class="acts">${L.length ? `<a class="btn" href="chapter-${L[0].chapter_number}/">START READING</a>` : ""}<a class="btn g" href="../../?book=${encodeURIComponent(b.id)}#book">RATE &amp; DISCUSS</a></div></div></article>
${L.length ? `<section class="gl"><h2>Chapters</h2><ol class="chl" style="list-style:none">${L.map((c) => `<li><span>${esc(c.chapter_number)}</span><a href="chapter-${c.chapter_number}/">${esc(c.title)}</a></li>`).join("")}</ol></section>` : ""}
${more.length ? `<section class="gl"><h2>More to read</h2><ul class="more">${more.map((x) => `<li><a href="../${x.id}/">${esc(x.title)}</a><span>${esc(x.author)} · ${esc(x.genre)}</span></li>`).join("")}</ul></section>` : ""}`;
  write(`books/${b.id}/index.html`, shell({
    depth: 2, title: cut(`${b.title} by ${b.author} – Read Free Online | Ui Books`, 70), desc, canonicalPath: `/books/${b.id}/`, image, body,
    json: [{ "@context": "https://schema.org", "@type": "Book", name: b.title, author: { "@type": "Person", name: b.author }, genre: b.genre, description: desc, url: bUrl, inLanguage: "en", isAccessibleForFree: true, ...(image ? { image } : {}),
      ...(L.length ? { hasPart: L.map((c) => ({ "@type": "Chapter", name: c.title, position: c.chapter_number, url: `${bUrl}chapter-${c.chapter_number}/` })) } : {}) },
      crumbLd([["Home", `${SITE}/`], ["Library", `${SITE}/books/`], [b.title, bUrl]])],
  }));
  urls.push({ loc: bUrl, lastmod: day(b.updated_at) });

  L.forEach((c, i) => {
    const prev = L[i - 1], next = L[i + 1], cUrl = `${bUrl}chapter-${c.chapter_number}/`;
    const paras = String(c.content).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const first = cut(paras[0] || "", 140);
    const cbody = `<nav class="crumb" aria-label="Breadcrumb"><a href="../../../">Home</a> › <a href="../../">Library</a> › <a href="../">${esc(b.title)}</a> › ${esc(c.title)}</nav>
<article class="gl read"><p class="kick">${esc(b.title)} · ${esc(b.author)}</p><h1>${esc(c.title)}</h1>
${paras.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n")}
<div class="pn">${prev ? `<a class="btn g" href="../chapter-${prev.chapter_number}/">‹ PREVIOUS</a>` : `<a class="btn g" href="../">‹ BOOK PAGE</a>`}${next ? `<a class="btn" href="../chapter-${next.chapter_number}/">NEXT CHAPTER ›</a>` : `<a class="btn" href="../../../?book=${encodeURIComponent(b.id)}#book">RATE &amp; DISCUSS ›</a>`}</div></article>`;
    write(`books/${b.id}/chapter-${c.chapter_number}/index.html`, shell({
      depth: 3, title: cut(`${c.title} – ${b.title} by ${b.author} | Ui Books`, 70), desc: first || desc, canonicalPath: `/books/${b.id}/chapter-${c.chapter_number}/`, image, body: cbody,
      json: [{ "@context": "https://schema.org", "@type": "Chapter", name: c.title, position: c.chapter_number, url: cUrl, inLanguage: "en", isAccessibleForFree: true, isPartOf: { "@type": "Book", name: b.title, url: bUrl, author: { "@type": "Person", name: b.author } } },
        crumbLd([["Home", `${SITE}/`], ["Library", `${SITE}/books/`], [b.title, bUrl], [c.title, cUrl]])],
    }));
    urls.push({ loc: cUrl, lastmod: day(c.updated_at) });
  });
}

const libBody = `<nav class="crumb" aria-label="Breadcrumb"><a href="../">Home</a> › Library</nav>
<section class="gl"><h1>The Ui Books Library</h1><p class="meta" style="margin:8px 0 22px">${books.length} free fantasy and adventure stories to read online by lantern light.</p>
${books.length ? `<div class="grid">${books.map((b) => `<a href="${b.id}/">${cvHtml(b)}<div class="t">${esc(b.title)}</div><div class="s">${esc(b.author)} · ${esc(b.genre)}</div></a>`).join("")}</div>` : "<p>New books are on the way.</p>"}</section>`;
write("books/index.html", shell({ depth: 1, title: "Free Fantasy Novels to Read Online – Library | Ui Books", desc: cut(`Browse ${books.length} free fantasy, epic, romance and adventure stories. Read short chapters online at Ui Books.`, 155), canonicalPath: "/books/", image: hasDefaultOg ? `${SITE}/og/default.png` : null, body: libBody,
  json: [crumbLd([["Home", `${SITE}/`], ["Library", `${SITE}/books/`]])] }));

// Tells the website which books have a generated page, so book cards only link to pages that exist.
write("books/manifest.json", JSON.stringify({ v: 1, built: new Date().toISOString(), books: Object.fromEntries(books.map((b) => [b.id, infoFor[b.id].L.length])) }));

write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`);
console.log(`Done: ${books.length} book pages, ${urls.length - 3 - books.length} chapter pages, ${urls.length} sitemap entries in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
