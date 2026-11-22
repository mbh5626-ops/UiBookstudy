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

const slugify = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/, "");
// Groups books by genre or author (case-insensitive) and gives every group a unique, safe web address.
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

async function ogFromCover(url, file) {
  const r = await fetch(url); if (!r.ok) throw new Error("cover HTTP " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const bg = await sharp(buf).resize(1200, 630, { fit: "cover" }).blur(24).modulate({ brightness: 0.55 }).toBuffer();
  const fg = await sharp(buf).resize({ width: 420, height: 570, fit: "inside" }).toBuffer();
  const m = await sharp(fg).metadata();
  await sharp(bg).composite([{ input: fg, left: Math.round((1200 - m.width) / 2), top: Math.round((630 - m.height) / 2) }]).jpeg({ quality: 84 }).toFile(file);
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
.read p{font-size:var(--rfs,20px);line-height:1.8;margin-bottom:20px}.read .rtools+p:first-letter{font:700 3.1em/.8 Cinzel,serif;float:left;color:var(--gold);padding:6px 10px 0 0}
.pn{display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;margin-top:26px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:22px}.grid a{display:block}.grid .t{font:500 14px Cinzel,serif;margin-top:10px}.grid .s{color:var(--mu);font-size:14px}
.ft{max-width:900px;margin:0 auto;padding:6px 18px 40px;color:var(--mu);font-size:15px;display:flex;gap:6px 16px;flex-wrap:wrap}
.by a,.meta a{border-bottom:1px dotted var(--mu)}.by a:hover,.meta a:hover{color:var(--gold)}.chipl{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px}.chipl a{border:1px solid var(--ln);border-radius:99px;padding:6px 14px;font:500 12px Cinzel,serif;color:var(--mu)}.chipl a:hover{color:var(--gold);border-color:var(--gold)}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}.tile{display:block;border:1px solid var(--ln);border-radius:14px;padding:16px;background:linear-gradient(135deg,rgba(125,85,215,.3),rgba(63,198,184,.12))}.tile b{display:block;font:500 15px Cinzel,serif}.tile small{color:var(--mu);font-size:15px}.tile:hover{border-color:var(--gold)}
.rbar{position:fixed;left:0;top:0;width:100%;height:3px;z-index:60;pointer-events:none}.rbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--teal),var(--gold))}
.rtools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-8px 0 22px}.rtools .rmin{color:var(--mu);font-size:15px;margin-right:auto}
.rtools button{display:none;border:1px solid var(--ln);background:rgba(255,255,255,.05);color:var(--ink);border-radius:10px;padding:7px 12px;font:600 12px Cinzel,serif;cursor:pointer}
.ui-read .rtools button{display:inline-flex}.rtools button:hover{border-color:var(--gold);color:var(--gold)}
[data-bk]{display:none;cursor:pointer}.ui-read [data-bk]{display:inline-flex}
#ui-share{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:70;width:min(420px,calc(100vw - 24px));background:rgba(14,8,34,.97);border:1px solid var(--ln);border-radius:20px;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,.5)}
:root[data-theme=light] #ui-share{background:rgba(255,250,239,.98)}
#ui-share h3{font-size:16px;color:var(--gold);margin-bottom:10px}.shl{display:flex;flex-wrap:wrap;gap:8px}
.shl a,.shl button{border:1px solid var(--ln);background:rgba(255,255,255,.06);color:var(--ink);border-radius:99px;padding:8px 16px;font:600 12px Cinzel,serif;cursor:pointer}.shl a:hover,.shl button:hover{border-color:var(--gold);color:var(--gold)}
.shx{position:absolute;right:12px;top:6px;background:none;border:0;color:var(--mu);font-size:24px;line-height:1;cursor:pointer}
#ui-rtoast{position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:70;background:rgba(14,8,34,.96);border:1px solid var(--ln);border-radius:14px;padding:10px 16px;font-size:16px;max-width:calc(100vw - 24px)}
:root[data-theme=light] #ui-rtoast{background:rgba(255,250,239,.98)}#ui-rtoast button{background:none;border:0;color:var(--gold);font:700 12px Cinzel,serif;cursor:pointer;margin-left:6px}
:focus-visible{outline:2px solid var(--teal);outline-offset:3px}@media(max-width:640px){.book{grid-template-columns:1fr}.book .cv{width:min(210px,100%);margin:0 auto}.chl{columns:1}}`;

function shell({ depth, title, desc, canonicalPath, image, body, json = [], genre = "" }) {
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
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="ui-root" content="${R}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Ui Books">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}">${image.startsWith(SITE + "/og/") ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : ""}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(image)}">` : '<meta name="twitter:card" content="summary">'}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2314082e'/%3E%3Ctext x='32' y='43' font-size='30' text-anchor='middle' fill='%23e0b45a' font-family='serif'%3EUi%3C/text%3E%3C/svg%3E">
<script>try{if(localStorage.getItem("ui-theme")==="light")document.documentElement.setAttribute("data-theme","light")}catch(e){}try{var f=+localStorage.getItem("uifs");if(f>=16&&f<=30)document.documentElement.style.setProperty("--rfs",f+"px")}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Crimson+Pro:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<style>${CSS}</style>
${json.map(ld).join("\n")}
</head>
<body>
<header class="hd"><a class="logo" href="${R}" aria-label="Ui Books home">Ui</a><nav aria-label="Main"><a href="${R}">Home</a><a href="${R}books/">Library</a></nav></header>
<main class="wrap"${genre ? ` data-genre="${esc(genre)}"` : ""}>
${body}
</main>
<footer class="ft"><a href="${R}">Home</a><a href="${R}books/">All books</a><a href="${R}genres/">Genres</a><a href="${R}authors/">Authors</a><a href="${R}apply.html">Write for us</a><a href="${R}privacy.html">Privacy</a><span>© ${new Date().getFullYear()} Ui Books · Read by lantern light</span></footer>
<script src="${R}ui-music.js" defer></script>
<script src="${R}ui-read.js" defer></script>
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
  if (image && sharp) {
    try { await ogFromCover(image, path.join(OUT, `og/${b.id}.jpg`)); image = `${SITE}/og/${b.id}.jpg`; } catch (e) { console.log(`share picture from cover for ${b.id} failed:`, e.message); image = null; }
  }
  if (!image && sharp) { try { await ogPng(a, path.join(OUT, `og/${b.id}.png`)); image = `${SITE}/og/${b.id}.png`; } catch (e) { console.log(`share picture for ${b.id} failed:`, e.message); } }
  if (!image && hasDefaultOg) image = `${SITE}/og/default.png`;
  infoFor[b.id] = { a, L, image };
}

const cvHtml = (b) => {
  const i = infoFor[b.id];
  return `<div class="cv">${coverOk(b.cover_url) ? `<img src="${esc(b.cover_url)}" alt="Cover of ${esc(b.title)}" loading="lazy" decoding="async">` : scene(i.a, `Artwork for ${b.title}`)}</div>`;
};

const genreGroups = groupBy(books, (b) => b.genre, "genre"), authorGroups = groupBy(books, (b) => b.author, "author");
const genreOf = new Map(), authorOf = new Map();
genreGroups.forEach((g) => g.books.forEach((b) => genreOf.set(b.id, g)));
authorGroups.forEach((g) => g.books.forEach((b) => authorOf.set(b.id, g)));
const newest = (bs) => bs.map((b) => day(b.updated_at)).sort().pop() || "";
const genreChips = (rel) => (genreGroups.length ? `<p class="chipl" aria-label="Genres">${genreGroups.map((g) => `<a href="${rel}genres/${g.slug}/">${esc(g.name)}</a>`).join("")}<a href="${rel}authors/">Authors</a></p>` : "");
const bookGrid = (bs, rel) => `<div class="grid">${bs.map((b) => `<a href="${rel}books/${b.id}/">${cvHtml(b)}<div class="t">${esc(b.title)}</div><div class="s">${esc(b.author)} · ${esc(b.genre)}</div></a>`).join("")}</div>`;
const itemList = (bs) => ({ "@type": "ItemList", itemListElement: bs.map((b, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/books/${b.id}/`, name: b.title })) });

for (const b of books) {
  const { a, L, image } = infoFor[b.id], bUrl = `${SITE}/books/${b.id}/`;
  const desc = cut(b.description || `Read “${b.title}” by ${b.author}, a free ${b.genre} story, online at Ui Books.`, 155);
  const gg = genreOf.get(b.id), ag = authorOf.get(b.id), byAuthor = ag.books.filter((x) => x.id !== b.id);
  const bookMins = L.length ? Math.max(1, Math.ceil(L.reduce((n, c) => n + String(c.content).split(/\s+/).filter(Boolean).length, 0) / 200)) : 0;
  const more = books.filter((x) => x.id !== b.id).sort((x, y) => (x.genre === b.genre ? -1 : 0) - (y.genre === b.genre ? -1 : 0)).slice(0, 6);
  const body = `<nav class="crumb" aria-label="Breadcrumb"><a href="../../">Home</a> › <a href="../">Library</a> › ${esc(b.title)}</nav>
<article class="gl book" data-book="${b.id}" data-title="${esc(b.title)}" data-author="${esc(b.author)}">${cvHtml(b)}<div><h1>${esc(b.title)}</h1><p class="by">by <a href="../../authors/${ag.slug}/">${esc(b.author)}</a></p><p class="meta"><a href="../../genres/${gg.slug}/">${esc(b.genre)}</a> · ${L.length ? L.length + " chapter" + (L.length > 1 ? "s" : "") : "Chapters coming soon"}${bookMins ? " · " + bookMins + " min read" : ""} · Free to read</p><p class="desc">${esc(b.description || "")}</p><div class="acts">${L.length ? `<a class="btn" href="chapter-${L[0].chapter_number}/">START READING</a>` : ""}<a class="btn g" href="../../?book=${encodeURIComponent(b.id)}#book">RATE &amp; DISCUSS</a><button type="button" class="btn g" data-bk="save">\u2661 SAVE</button><button type="button" class="btn g" data-bk="share">SHARE</button></div></div></article>
${L.length ? `<section class="gl"><h2>Chapters</h2><ol class="chl" style="list-style:none">${L.map((c) => `<li><span>${esc(c.chapter_number)}</span><a href="chapter-${c.chapter_number}/">${esc(c.title)}</a></li>`).join("")}</ol></section>` : ""}
${byAuthor.length ? `<section class="gl"><h2>More by ${esc(b.author)}</h2><ul class="more">${byAuthor.map((x) => `<li><a href="../${x.id}/">${esc(x.title)}</a><span>${esc(x.genre)}</span></li>`).join("")}</ul></section>` : ""}
${more.length ? `<section class="gl"><h2>More to read</h2><ul class="more">${more.map((x) => `<li><a href="../${x.id}/">${esc(x.title)}</a><span>${esc(x.author)} · ${esc(x.genre)}</span></li>`).join("")}</ul></section>` : ""}`;
  write(`books/${b.id}/index.html`, shell({
    depth: 2, genre: b.genre, title: cut(`${b.title} by ${b.author} – Read Free Online | Ui Books`, 70), desc, canonicalPath: `/books/${b.id}/`, image, body,
    json: [{ "@context": "https://schema.org", "@type": "Book", name: b.title, author: { "@type": "Person", name: b.author }, genre: b.genre, description: desc, url: bUrl, inLanguage: "en", isAccessibleForFree: true, ...(image ? { image } : {}),
      ...(L.length ? { hasPart: L.map((c) => ({ "@type": "Chapter", name: c.title, position: c.chapter_number, url: `${bUrl}chapter-${c.chapter_number}/` })) } : {}) },
      crumbLd([["Home", `${SITE}/`], ["Library", `${SITE}/books/`], [b.title, bUrl]])],
  }));
  urls.push({ loc: bUrl, lastmod: day(b.updated_at) });

  L.forEach((c, i) => {
    const prev = L[i - 1], next = L[i + 1], cUrl = `${bUrl}chapter-${c.chapter_number}/`;
    const paras = String(c.content).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const first = cut(paras[0] || "", 140);
    const mins = Math.max(1, Math.ceil(paras.join(" ").split(/\s+/).filter(Boolean).length / 200));
    const tools = `<div class="rtools" role="toolbar" aria-label="Reading tools"><span class="rmin">${mins} min read</span><button type="button" data-rt="fs-" aria-label="Smaller text">A\u2212</button><button type="button" data-rt="fs+" aria-label="Larger text">A+</button><button type="button" data-rt="theme" aria-label="Switch light or dark theme">\u263c</button><button type="button" data-rt="share">SHARE</button></div>`;
    const cbody = `<nav class="crumb" aria-label="Breadcrumb"><a href="../../../">Home</a> › <a href="../../">Library</a> › <a href="../">${esc(b.title)}</a> › ${esc(c.title)}</nav>
<article class="gl read" data-book="${b.id}" data-chapter="${c.chapter_number}" data-title="${esc(c.title)}" data-book-title="${esc(b.title)}" data-author="${esc(b.author)}"><p class="kick">${esc(b.title)} · ${esc(b.author)}</p><h1>${esc(c.title)}</h1>
${tools}
${paras.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n")}
<div class="pn">${prev ? `<a class="btn g" href="../chapter-${prev.chapter_number}/">‹ PREVIOUS</a>` : `<a class="btn g" href="../">‹ BOOK PAGE</a>`}${next ? `<a class="btn" href="../chapter-${next.chapter_number}/">NEXT CHAPTER ›</a>` : `<a class="btn" href="../../../?book=${encodeURIComponent(b.id)}#book">RATE &amp; DISCUSS ›</a>`}</div></article>`;
    write(`books/${b.id}/chapter-${c.chapter_number}/index.html`, shell({
      depth: 3, genre: b.genre, title: cut(`${c.title} – ${b.title} by ${b.author} | Ui Books`, 70), desc: first || desc, canonicalPath: `/books/${b.id}/chapter-${c.chapter_number}/`, image, body: cbody,
      json: [{ "@context": "https://schema.org", "@type": "Chapter", name: c.title, position: c.chapter_number, url: cUrl, inLanguage: "en", isAccessibleForFree: true, isPartOf: { "@type": "Book", name: b.title, url: bUrl, author: { "@type": "Person", name: b.author } } },
        crumbLd([["Home", `${SITE}/`], ["Library", `${SITE}/books/`], [b.title, bUrl], [c.title, cUrl]])],
    }));
    urls.push({ loc: cUrl, lastmod: day(c.updated_at) });
  });
}

const libBody = `<nav class="crumb" aria-label="Breadcrumb"><a href="../">Home</a> › Library</nav>
<section class="gl"><h1>The Ui Books Library</h1><p class="meta" style="margin:8px 0 22px">${books.length} free fantasy and adventure stories to read online by lantern light.</p>
${genreChips("../")}
${books.length ? `<div class="grid">${books.map((b) => `<a href="${b.id}/">${cvHtml(b)}<div class="t">${esc(b.title)}</div><div class="s">${esc(b.author)} · ${esc(b.genre)}</div></a>`).join("")}</div>` : "<p>New books are on the way.</p>"}</section>`;
write("books/index.html", shell({ depth: 1, title: "Free Fantasy Novels to Read Online – Library | Ui Books", desc: cut(`Browse ${books.length} free fantasy, epic, romance and adventure stories. Read short chapters online at Ui Books.`, 155), canonicalPath: "/books/", image: hasDefaultOg ? `${SITE}/og/default.png` : null, body: libBody,
  json: [crumbLd([["Home", `${SITE}/`], ["Library", `${SITE}/books/`]])] }));

/* ---------- genre and author pages (so Google can match searches like "free epic fantasy stories") ---------- */
urls.push({ loc: `${SITE}/genres/` }, { loc: `${SITE}/authors/` });
if (fs.existsSync(path.join(SRC, "apply.html"))) urls.push({ loc: `${SITE}/apply.html` });
const collection = (kind, name, url, desc, bs, extra = {}) => ({ "@context": "https://schema.org", "@type": "CollectionPage", name, url, description: desc, inLanguage: "en", ...extra, mainEntity: itemList(bs) });
for (const g of genreGroups) {
  const n = g.books.length, gUrl = `${SITE}/genres/${g.slug}/`;
  const desc = cut(`Read ${n} free ${g.name.toLowerCase()} ${n > 1 ? "stories" : "story"} online: ${g.books.slice(0, 3).map((b) => b.title).join(", ")}${n > 3 ? " and more" : ""}. Short chapters, free at Ui Books.`, 155);
  const body = `<nav class="crumb" aria-label="Breadcrumb"><a href="../../">Home</a> › <a href="../">Genres</a> › ${esc(g.name)}</nav>
<section class="gl"><h1>Free ${esc(g.name)} Stories</h1><p class="meta" style="margin:8px 0 22px">${n} free ${esc(g.name.toLowerCase())} ${n > 1 ? "stories" : "story"} to read online, chapter by chapter.</p>${bookGrid(g.books, "../../")}</section>
<section class="gl"><h2>More genres</h2>${genreChips("../../")}</section>`;
  write(`genres/${g.slug}/index.html`, shell({ depth: 2, genre: g.name, title: cut(`Free ${g.name} Stories to Read Online | Ui Books`, 70), desc, canonicalPath: `/genres/${g.slug}/`, image: hasDefaultOg ? `${SITE}/og/default.png` : null, body,
    json: [collection("genre", `Free ${g.name} Stories`, gUrl, desc, g.books), crumbLd([["Home", `${SITE}/`], ["Genres", `${SITE}/genres/`], [g.name, gUrl]])] }));
  urls.push({ loc: gUrl, lastmod: newest(g.books) });
}
write("genres/index.html", shell({ depth: 1, title: "Browse Free Stories by Genre | Ui Books", desc: cut(`Browse free stories by genre at Ui Books: ${genreGroups.map((g) => g.name).join(", ")}.`, 155), canonicalPath: "/genres/", image: hasDefaultOg ? `${SITE}/og/default.png` : null,
  body: `<nav class="crumb" aria-label="Breadcrumb"><a href="../">Home</a> › Genres</nav><section class="gl"><h1>Browse by Genre</h1><p class="meta" style="margin:8px 0 22px">Pick a genre and start reading.</p>${genreGroups.length ? `<div class="tiles">${genreGroups.map((g) => `<a class="tile" href="${g.slug}/"><b>${esc(g.name)}</b><small>${g.books.length} ${g.books.length > 1 ? "books" : "book"}</small></a>`).join("")}</div>` : "<p>New genres are on the way.</p>"}</section>`,
  json: [crumbLd([["Home", `${SITE}/`], ["Genres", `${SITE}/genres/`]])] }));
for (const g of authorGroups) {
  const n = g.books.length, gUrl = `${SITE}/authors/${g.slug}/`;
  const desc = cut(`Read ${n > 1 ? "all " + n + " free stories" : "the free story"} by ${g.name} online: ${g.books.slice(0, 3).map((b) => b.title).join(", ")}${n > 3 ? " and more" : ""}. At Ui Books.`, 155);
  const body = `<nav class="crumb" aria-label="Breadcrumb"><a href="../../">Home</a> › <a href="../">Authors</a> › ${esc(g.name)}</nav>
<section class="gl"><h1>Books by ${esc(g.name)}</h1><p class="meta" style="margin:8px 0 22px">${n} free ${n > 1 ? "stories" : "story"} to read online.</p>${bookGrid(g.books, "../../")}</section>`;
  write(`authors/${g.slug}/index.html`, shell({ depth: 2, title: cut(`${g.name} – Free Stories to Read Online | Ui Books`, 70), desc, canonicalPath: `/authors/${g.slug}/`, image: hasDefaultOg ? `${SITE}/og/default.png` : null, body,
    json: [collection("author", `Books by ${g.name}`, gUrl, desc, g.books, { about: { "@type": "Person", name: g.name } }), crumbLd([["Home", `${SITE}/`], ["Authors", `${SITE}/authors/`], [g.name, gUrl]])] }));
  urls.push({ loc: gUrl, lastmod: newest(g.books) });
}
write("authors/index.html", shell({ depth: 1, title: "Authors – Free Stories to Read Online | Ui Books", desc: cut(`Meet the authors at Ui Books: ${authorGroups.map((g) => g.name).join(", ")}.`, 155), canonicalPath: "/authors/", image: hasDefaultOg ? `${SITE}/og/default.png` : null,
  body: `<nav class="crumb" aria-label="Breadcrumb"><a href="../">Home</a> › Authors</nav><section class="gl"><h1>Authors</h1><p class="meta" style="margin:8px 0 22px">Tap an author to see their books.</p>${authorGroups.length ? `<div class="tiles">${authorGroups.map((g) => `<a class="tile" href="${g.slug}/"><b>${esc(g.name)}</b><small>${g.books.length} ${g.books.length > 1 ? "books" : "book"}</small></a>`).join("")}</div>` : "<p>Authors will appear here.</p>"}</section>`,
  json: [crumbLd([["Home", `${SITE}/`], ["Authors", `${SITE}/authors/`]])] }));

// Footer links on the home page, so search engines can find every section from the first page.
{
  const idx = path.join(OUT, "index.html"), needle = '<a href="privacy.html">Privacy</a></span>';
  if (fs.existsSync(idx)) {
    let h = fs.readFileSync(idx, "utf8");
    if (h.includes(needle) && !h.includes('href="genres/"')) {
      h = h.replace(needle, '<a href="books/">All books</a><a href="genres/">Genres</a><a href="authors/">Authors</a><a href="apply.html">Write for us</a>' + needle);
      fs.writeFileSync(idx, h);
    }
  }
}

// Tells the website which books have a generated page, so book cards only link to pages that exist.
write("books/manifest.json", JSON.stringify({ v: 1, built: new Date().toISOString(), books: Object.fromEntries(books.map((b) => [b.id, infoFor[b.id].L.map((c) => c.chapter_number)])) }));

write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`);
console.log(`Done: ${books.length} book pages, ${genreGroups.length} genre pages, ${authorGroups.length} author pages, ${urls.length} sitemap entries in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
