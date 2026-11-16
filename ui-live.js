/* Ui Books - live data layer.
   Loaded after the main script in index.html. It reads books, chapters, covers and
   website settings from Supabase. If anything fails, the built-in books keep working.
   All text coming from the database is escaped before it is shown. */
(function () {
"use strict";
var W = window, D = document;
if (!W.B || !W.render || !W.$ || !W.scene) { return; }
var $ = W.$;

function E(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function hex(v, d) { return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d; }
function nu(v, lo, hi, d) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; }
function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h; }

var PALS = [["#1a2f6e", "#0b1640", "#7fd6ff"], ["#5a0f1c", "#2a0610", "#ff9a5a"], ["#0e4a38", "#052a1f", "#d9f27a"],
  ["#4c1a58", "#1f0a35", "#ffd6f0"], ["#2e2f66", "#10113a", "#b6b8ff"], ["#6b2a0b", "#2a0f05", "#ffb347"],
  ["#133a5c", "#071a30", "#aef0ff"], ["#2f0f3f", "#12061f", "#ff8fb8"]];
var FEAT = { comments: true, reviews: true };
var DBSRC = false;      // true once the owner has confirmed the migration (chapters come only from the database)
var merged = false;
var GEN = null;         // book ids that have a generated page (from books/manifest.json)

/* ---------- small helpers ---------- */
function art(b, a) {
  var h = hash(b.id), pal = PALS[h % PALS.length];
  if (!b.c) { b.c = pal.slice(); b.x = 30 + h % 45; b.y = 28 + (h >> 3) % 12; b.r = 9 + (h >> 5) % 8; }
  if (a && typeof a === "object") {
    var c = Array.isArray(a.c) ? a.c : [];
    b.c = [hex(c[0], b.c[0]), hex(c[1], b.c[1]), hex(c[2], b.c[2])];
    b.x = nu(a.x, 0, 100, b.x); b.y = nu(a.y, 0, 140, b.y); b.r = nu(a.r, 4, 30, b.r);
  }
}
function okCover(u) {
  var base = (W.SB_URL || "") + "/storage/v1/object/public/book-covers/";
  return typeof u === "string" && base.length > 40 && u.indexOf(base) === 0 && /^[A-Za-z0-9:\/._%~+@=?&-]+$/.test(u) ? u : null;
}
function vis(i) { return !!B[i] && !B[i].off; }
function ord() {
  var a = [];
  B.forEach(function (b, i) { if (!b.off) { a.push(i); } });
  return a.sort(function (i, j) { return (B[i].so - B[j].so) || (i - j); });
}
function parse(text) {
  return String(text || "").split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
}
function chaps(b) {
  if (b.chLoaded && (b.dbch.length || DBSRC)) { return b.dbch; }
  if (b.p) {
    var a = [{ n: 1, title: "Chapter 1", paras: b.p }];
    if (b.q) { a.push({ n: 2, title: "Chapter 2", paras: b.q }); }
    return a;
  }
  return b.dbch || [];
}
function need(b) {
  if (!W.sb || b.chLoaded || b.chLoading) { return; }
  b.chLoading = true;
  W.sb.from("book_chapters").select("chapter_number,title,content").eq("book_id", b.id).order("chapter_number", { ascending: true })
    .then(function (r) {
      b.chLoading = false;
      if (r.error) { return; }
      b.dbch = (r.data || []).map(function (x) { return { n: x.chapter_number, title: x.title, paras: parse(x.content) }; });
      b.chLoaded = true;
      W.render();
    }).catch(function () { b.chLoading = false; });
}

/* ---------- covers and book blocks ---------- */
function cvr(b) {
  if (b.cu) { return '<div class="cv"><img class="cvi" src="' + E(b.cu) + '" alt="" loading="lazy"></div>'; }
  return '<div class="cv">' + W.scene(b) + '<small>' + E(b.g) + '</small><div class="tt"><strong>' + E(b.t) +
    '</strong><span class="au">' + E(b.a) + '</span></div></div>';
}
function line(i) {
  var x = B[i];
  return '<div class="ln" tabindex="0" role="link" data-o="' + i + '">' + cvr(x) + '<div><h3>' + E(x.t) + '</h3><small>' +
    E(x.a) + ' · ' + E(x.g) + '</small><div>' + W.starsFor(i) + '</div></div><button class="hr' +
    (saved.indexOf(i) > -1 ? ' on' : '') + '" data-s="' + i + '" aria-label="Save">♥</button></div>';
}
function infoTab(b) {
  var L = chaps(b), n = L.length, p;
  if (b.seed) {
    var cw = (n || 2) === 1 ? "one short chapter" : (n || 2) === 2 ? "two short chapters" : (n || 2) + " chapters";
    p = E(b.d) + " A story of " + E(String(b.g).toLowerCase()) + ", moonlight and courage, told in " + cw + ".";
  } else {
    p = E(b.d) + (n ? '<br><span class="sub">' + n + " chapter" + (n > 1 ? "s" : "") + " · " + E(b.g) + "</span>" : "");
  }
  return "<p>" + p + '</p><div id="rwbox"></div>';
}
function readerHTML(b) {
  var L = chaps(b);
  if (chap >= L.length) { chap = Math.max(0, L.length - 1); }
  var h = '<h2 style="margin:0">' + E(b.t) + '</h2><div class="sub">by ' + E(b.a) + '</div><div class="bx">';
  if (L.length > 1) {
    h += L.map(function (c, k) {
      return '<button class="chip' + (k === chap ? ' on' : '') + '" data-c="' + k + '">Chapter ' + E(c.n) + '</button>';
    }).join("");
  }
  h += '<button class="rnd" data-f="-1" aria-label="Smaller">A−</button><button class="rnd" data-f="1" aria-label="Larger">A+</button>' +
    '<button class="btn g" data-s="' + cur + '">' + (saved.indexOf(cur) > -1 ? '♥ SAVED' : '♡ SAVE') + '</button></div>';
  if (!L.length) {
    return h + '<p class="sub">' + (b.chLoaded || !W.sb ? "No chapters yet. Check back soon." : "Loading…") + "</p>";
  }
  var c = L[chap];
  if (c.title && !/^chapter\s*\d+$/i.test(String(c.title).trim())) {
    h += '<h3 style="margin:6px 0 14px">' + E(c.title) + "</h3>";
  }
  h += c.paras.map(function (p) { return "<p>" + E(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
  if (L.length > 1) {
    h += '<div class="bx">' + (chap > 0 ? '<button class="btn g" data-nx="' + (chap - 1) + '">‹ PREVIOUS</button>' : "") +
      (chap < L.length - 1 ? '<button class="btn" data-nx="' + (chap + 1) + '">NEXT CHAPTER ›</button>' : "") + "</div>";
  }
  if (chap >= L.length - 1) { h += '<p class="sub">More chapters soon…</p>'; }
  return h;
}

/* ---------- main render (same layout and classes as before) ---------- */
function render() {
  var O = ord();
  if (B[cur] && B[cur].off) { cur = O.length ? O[0] : cur; }
  var b = B[cur];
  need(b);
  var L = chaps(b);
  if (chap >= L.length) { chap = Math.max(0, L.length - 1); }
  $("ol").textContent = (L[0] && L[0].paras[0]) || b.d || "";
  $("or").innerHTML = b.cu ? '<img class="cvi" src="' + E(b.cu) + '" alt="">' : W.scene(b);
  $("ct").textContent = b.t; $("ca").textContent = "by " + b.a;
  var tot = Math.max(1, L.length || 2) * 150;
  $("cp").textContent = pgs(cur) + " / " + tot; $("cb").style.width = Math.min(100, pgs(cur) * 100 / tot) + "%";
  $("pop").innerHTML = O.slice(0, 6).map(function (i) {
    var x = B[i];
    return '<button class="it" data-o="' + i + '">' + cvr(x) + '<div class="cp"><b>' + E(x.t) + "</b>" + E(x.a) + "</div></button>";
  }).join("");
  var d = new Date(), sun = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()), n = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  $("wk").innerHTML = n.map(function (x, i) {
    var dd = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + i);
    return '<button class="' + (i === day ? 'on ' : '') + (i === d.getDay() ? 'td' : '') + '" data-d="' + i + '"><small>' + x + "</small>" + dd.getDate() + "</button>";
  }).join("");
  $("wm").textContent = day === d.getDay() ? "Today: read 20 pages of “" + b.t + "”." : "Planned: one chapter of “" + b.t + "”.";
  var gs = ["All"];
  O.forEach(function (i) { if (gs.indexOf(B[i].g) < 0) { gs.push(B[i].g); } });
  if (gs.indexOf(gen) < 0) { gen = "All"; }
  $("ch").innerHTML = gs.map(function (g) { return '<button class="chip' + (g === gen ? ' on' : '') + '" data-g="' + E(g) + '">' + E(g) + "</button>"; }).join("");
  var f = $("q").value.toLowerCase(), l = "";
  O.forEach(function (i) {
    var x = B[i];
    if ((gen === "All" || x.g === gen) && (!f || (x.t + x.a + x.g).toLowerCase().indexOf(f) > -1)) { l += line(i); }
  });
  $("lib").innerHTML = l || '<p class="emp">No books found.</p>';
  $("sv").innerHTML = saved.filter(vis).map(line).join("") || '<p class="emp">Nothing saved yet. Tap ♥ on any book.</p>';
  var sim = O.filter(function (i) { return i !== cur; }).slice(0, 3).map(function (i) {
    return '<button class="it" style="width:auto" data-o="' + i + '">' + cvr(B[i]) + "</button>";
  }).join("");
  var tx = [infoTab(b), '<div id="rvbox"></div>', '<div id="cmbox"></div>', '<div class="sm">' + sim + "</div>"][tab];
  $("dt").innerHTML = '<div class="dl">' + cvr(b) + '</div><div class="dr"><div class="tb">' +
    ["INFO", "REVIEWS (" + sc(b, "reviews_count") + ")", "DISCUSSION (" + sc(b, "comments_count") + ")", "SIMILAR"].map(function (x, i) {
      return '<button class="' + (i === tab ? 'on' : '') + '" data-t="' + i + '">' + x + "</button>";
    }).join("") + "</div><h1>" + E(b.t) + '</h1><div class="a">' + E(b.a) + "</div>" + W.starsFor(cur) +
    '<div style="min-height:110px">' + tx + '</div><a class="btn" href="#reader">READ</a> <button class="btn t" data-l="1">♫ LISTEN</button> ' +
    '<button class="btn g" data-s="' + cur + '">' + (saved.indexOf(cur) > -1 ? '♥ SAVED' : '♡ SAVE') + "</button></div>";
  $("rd").innerHTML = readerHTML(b);
  $("pt").textContent = b.t;
  W.paintRating(); W.paintReviews(); W.paintComments(); W.render2(); W.acctUi();
}

function render2() {
  var O = ord(), au = {}, G = {};
  O.forEach(function (i) { var x = B[i]; (au[x.a] = au[x.a] || []).push(i); G[x.g] = (G[x.g] || 0) + 1; });
  function rw(a) {
    return a.filter(vis).map(function (i) {
      return '<button class="it" data-o="' + i + '">' + cvr(B[i]) + '<div class="cp"><b>' + E(B[i].t) + "</b>" + E(B[i].a) + "</div></button>";
    }).join("");
  }
  $("au").innerHTML = Object.keys(au).map(function (n) {
    var x = B[au[n][0]];
    return '<div class="cd" tabindex="0" role="link" data-a="' + E(n) + '"><div class="av" style="width:48px;height:48px">' + E(W.ini(n).slice(0, 2)) +
      "</div><h3>" + E(n) + '</h3><small class="sub">' + E(x.g) + " · " + au[n].length + " book</small><p>" + E(x.d) + "</p></div>";
  }).join("");
  var SS = S.map(function (s) { return [s[0], s[1], s[2].filter(vis), " · 2 chapters each"]; }).filter(function (s) { return s[2].length; });
  var fresh = O.filter(function (i) { return !B[i].seed; });
  if (fresh.length) { SS.push(["New Arrivals", "Fresh from the library.", fresh, ""]); }
  $("hs").innerHTML = rw(SS[0] ? SS[0][2] : []);
  $("se2").innerHTML = SS.map(function (s) {
    return '<div class="gl" style="margin-bottom:18px"><h2>' + E(s[0]) + '<small class="sub" style="font:16px Crimson Pro">' + s[2].length + " vol" + s[3] +
      '</small></h2><p class="sub" style="margin-bottom:10px">' + E(s[1]) + '</p><div class="row">' + rw(s[2]) + "</div></div>";
  }).join("");
  $("rl").innerHTML = Object.keys(G).map(function (g) {
    return '<button class="tile" data-gh="' + E(g) + '"><b>' + E(g) + "</b><small>" + G[g] + " books</small></button>";
  }).join("");
  $("pf").innerHTML = '<div class="stats">' + [[bk(), "Books started"], [hist.length, "Chapters read"], [streak(), "Day streak"], [saved.filter(vis).length, "Saved"]].map(function (s) {
    return '<div class="stat"><b>' + s[0] + "</b>" + s[1] + "</div>";
  }).join("") + '</div><h3 style="margin:22px 0 8px">Goal: ' + goal + ' books this year</h3><div class="bar"><i style="width:' + Math.min(100, bk() * 100 / goal) +
    '%"></i></div><p class="sub">' + bk() + ' of ' + goal + ' done. <button class="chip" data-gl="-1">−</button> <button class="chip" data-gl="1">+</button></p>' +
    '<h3 style="margin:22px 0 10px">Badges</h3><div class="ch">' +
    bd("🐉 Dragon Slayer", hist.some(function (k) { var x = B[+k.split(":")[0]]; return x && x.g === "Epic"; })) +
    bd("🌙 Night Owl", streak() >= 3) + bd("📚 Bookworm", bk() >= 3) + bd("⭐ Early Reader", hist.length > 0) + "</div>";
}

function speak() {
  if (!W.speechSynthesis) { alert("Audio isn’t supported in this browser."); return; }
  var b = B[cur], L = chaps(b), c = L[chap] || L[0];
  if (!c) { toast("This book has no chapters to read aloud yet."); return; }
  speechSynthesis.cancel();
  var u = new SpeechSynthesisUtterance(b.t + ". Chapter " + c.n + ". " + c.paras.join(" "));
  u.rate = 0.95;
  u.onend = function () { play = false; $("pp").textContent = "▶"; $("pb").style.width = "100%"; };
  u.onboundary = function (e) { $("pb").style.width = Math.min(100, e.charIndex * 100 / u.text.length) + "%"; };
  $("pl").hidden = false; $("pt").textContent = b.t; $("pm").textContent = "Ch. " + c.n;
  play = true; $("pp").textContent = "❚❚"; speechSynthesis.speak(u);
}

/* Saved books are remembered by book id, so they stay correct when books are added or removed. */
function idsNow() { return saved.map(function (i) { return B[i] && B[i].id; }).filter(Boolean); }
function sv() {
  try {
    localStorage.setItem("uibooks", JSON.stringify(saved.filter(function (i) { return i < W.IDS.length; })));
    if (merged) { localStorage.setItem("uibooks2", JSON.stringify(idsNow())); }
  } catch (e) { /* storage unavailable */ }
}

/* ---------- comments and reviews can be switched off (site-wide or per book) ---------- */
function lock(box, formSel, msg, starts) {
  var f = box.querySelector(formSel); if (f) { f.remove(); }
  box.querySelectorAll("[data-signin]").forEach(function (x) { x.remove(); });
  box.querySelectorAll("p.sub").forEach(function (p) { if (p.textContent.indexOf(starts) === 0) { p.remove(); } });
  if (!box.querySelector(".ui-closed")) { box.insertAdjacentHTML("afterbegin", '<p class="msg er ui-closed">' + E(msg) + "</p>"); }
}
var _pr = W.paintReviews, _pc = W.paintComments;
function paintReviews() {
  _pr();
  var box = $("rvbox");
  if (box && FEAT.reviews === false) { lock(box, "#rvf", "New reviews are switched off right now.", "Sign in to write"); }
}
function paintComments() {
  _pc();
  var box = $("cmbox");
  if (!box || !B[cur]) { return; }
  if (FEAT.comments === false) { lock(box, "#cmf", "Comments are switched off right now.", "Sign in to join"); }
  else if (B[cur].ce === false) { lock(box, "#cmf", "Comments are closed for this book.", "Sign in to join"); }
}

/* ---------- website settings and the floating widget ---------- */
function widget(w) {
  var el = $("uiWidget");
  if (!w || w.enabled !== true || !w.label) { if (el) { el.remove(); } return; }
  var url = String(w.url || ""), ok = /^https:\/\//.test(url) || /^#[A-Za-z0-9_-]*$/.test(url);
  if (!el) { el = D.createElement("a"); el.id = "uiWidget"; el.className = "theme-toggle ui-widget"; D.body.appendChild(el); }
  el.textContent = String(w.label).slice(0, 40);
  if (ok && url) {
    el.setAttribute("href", url);
    if (url.charAt(0) !== "#") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
    else { el.removeAttribute("target"); el.removeAttribute("rel"); }
  } else { el.removeAttribute("href"); }
  el.setAttribute("data-pos", w.position === "right" ? "right" : "left");
  el.setAttribute("data-style", /^(gold|teal|crimson)$/.test(w.style) ? w.style : "gold");
}
function applySettings(rows) {
  var m = {};
  (rows || []).forEach(function (r) { m[r.key] = r.value; });
  if (m.features && typeof m.features === "object") { FEAT.comments = m.features.comments !== false; FEAT.reviews = m.features.reviews !== false; }
  DBSRC = !!(m.migration && m.migration.chapters === "db");
  var tt = $("themeToggle");
  if (tt) { tt.hidden = !!(m.theme_toggle && m.theme_toggle.enabled === false); }
  widget(m.floating_widget);
}

/* ---------- load books from the database ---------- */
function merge(rows, preview) {
  var byId = {}, seen = {}, n = 0;
  B.forEach(function (b) { byId[b.id] = b; });
  rows.forEach(function (r) {
    if (!r || typeof r.id !== "string") { return; }
    if (!r.published && r.id !== preview) { return; }
    var b = byId[r.id];
    if (!b) { b = { id: r.id, seed: false, c: null, x: 50, y: 32, r: 12 }; B.push(b); byId[r.id] = b; }
    b.t = r.title || b.t || "Untitled"; b.a = r.author || b.a || ""; b.g = r.genre || b.g || "";
    if (r.description || DBSRC) { b.d = r.description || ""; } else if (b.d == null) { b.d = ""; }
    art(b, r.art);
    b.cu = okCover(r.cover_url); b.ce = r.comments_enabled !== false; b.so = Number(r.sort_order) || 0; b.draft = !r.published;
    seen[r.id] = 1; n++;
  });
  if (!n) { return null; }
  B.forEach(function (b) { b.off = !seen[b.id]; });
  var s2 = null;
  try { s2 = JSON.parse(localStorage.getItem("uibooks2") || "null"); } catch (e) { s2 = null; }
  if (!Array.isArray(s2)) { s2 = idsNow(); }
  var list = [];
  s2.forEach(function (id) {
    var k = -1; B.forEach(function (b, i) { if (b.id === id) { k = i; } });
    if (k > -1 && list.indexOf(k) < 0) { list.push(k); }
  });
  saved = list; merged = true; sv();
  return byId[preview] || null;
}
function openParam() {
  var id = null;
  try { id = new URLSearchParams(location.search).get("book"); } catch (e) { id = null; }
  if (!id) { return; }
  var k = -1;
  B.forEach(function (b, i) { if (b.id === id && !b.off) { k = i; } });
  if (k < 0) { return; }
  cur = k; chap = 0; tab = 0;
  if (location.hash !== "#book") { location.hash = "#book"; }
}
function load() {
  if (!W.sb) { return; }
  var pv = null;
  try { pv = new URLSearchParams(location.search).get("preview"); } catch (e) { pv = null; }
  var manifest = typeof fetch === "function"
    ? fetch(new URL("books/manifest.json", location.href).href, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    : Promise.resolve(null);
  Promise.all([
    W.sb.from("books").select("id,title,author,genre,description,cover_url,comments_enabled,sort_order,art,published,created_at").order("created_at", { ascending: true }),
    W.sb.from("site_settings").select("key,value"),
    manifest
  ]).then(function (a) {
    if (!a[1].error && a[1].data) { applySettings(a[1].data); }
    if (a[2] && a[2].books && typeof a[2].books === "object") { GEN = a[2].books; }
    var r = a[0];
    if (r.error || !r.data || !r.data.length) { openParam(); W.render(); return; }
    var pb = merge(r.data, pv);
    if (pb && pb.draft) {
      cur = B.indexOf(pb); chap = 0; tab = 0;
      if (location.hash !== "#book") { location.hash = "#book"; }
      toast("Preview: this book is not published yet.");
    } else { openParam(); }
    W.render();
  }).catch(function () { /* keep the built-in books */ });
}

/* ---------- open the generated page for a book ---------- */
/* A book card opens its own page (books/<id>/) only when the book is published in the database
   AND the site build has generated that page (listed in books/manifest.json).
   Otherwise the old in-page view is used, so nothing ever leads to a missing page. */
function pageFor(i) {
  var b = B[i];
  if (!GEN || !merged || !b || b.off || b.draft) { return null; }
  if (!/^[a-z0-9-]{3,60}$/.test(b.id) || !Object.prototype.hasOwnProperty.call(GEN, b.id)) { return null; }
  try { return new URL("books/" + b.id + "/", location.href).href; } catch (e) { return null; }
}
function onCardClick(e) {
  var t = e.target;
  if (!t || !t.closest) { return; }
  if (t.closest("[data-s],[data-l],[data-nx]")) { return; }   // save heart and other controls keep their own behaviour
  var card = t.closest("[data-o]");
  if (!card) { return; }
  var url = pageFor(+card.getAttribute("data-o"));
  if (!url) { return; }
  e.preventDefault(); e.stopPropagation();
  if (e.ctrlKey || e.metaKey) { W.open(url, "_blank", "noopener"); } else { W.location.assign(url); }
}

/* ---------- install ---------- */
B.forEach(function (b, i) { b.seed = true; b.so = i + 1; b.ce = true; b.off = false; });
var st = D.createElement("style");
st.textContent =
  ".cv img.cvi,.pg.r img.cvi{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}" +
  ".ln .cv img.cvi{display:block}.ln .cv svg *{display:inline}" +
  ".ui-widget{left:20px;right:auto;text-decoration:none}" +
  ".ui-widget[data-pos=right]{left:auto;right:20px;bottom:70px}" +
  ".ui-widget[data-style=teal]{border-color:var(--teal)}.ui-widget[data-style=crimson]{border-color:var(--em)}" +
  "@media(max-width:860px){.ui-widget{left:16px;right:auto}.ui-widget[data-pos=right]{left:auto;right:16px;bottom:130px}}";
D.head.appendChild(st);
var ftl = D.querySelector(".ft span");
if (ftl && !ftl.querySelector('a[href="books/"]')) { ftl.insertAdjacentHTML("beforeend", '<a href="books/">All books</a>'); }
W.cover = cvr; W.infoTab = infoTab; W.render = render; W.render2 = render2; W.speak = speak; W.sv = sv;
W.paintReviews = paintReviews; W.paintComments = paintComments;
D.addEventListener("click", onCardClick, true);   // capture phase: runs before the old card handler
D.addEventListener("click", function (e) {
  var x = e.target && e.target.closest ? e.target.closest("[data-nx]") : null;
  if (x) { chap = +x.getAttribute("data-nx"); track(); W.render(); W.scrollTo(0, 0); }
});
W.render();
load();
})();
