/* Ui Books - reader toolkit.
   * Saved books and reading progress, kept on this device and synced to the reader's account.
   * Reading tools on chapter pages: progress bar, text size, light/dark switch, resume where you stopped.
   * A share menu for books and chapters.
   * Loads ui-social.js (follow authors, alerts, bookmarks) and shares its account connection with it.
   Works on the generated pages and (for syncing and sharing) on the main page. */
(function () {
"use strict";
if (window.UiRead) { return; }
var W = window, D = document;
var SB_URL = "https://cqamtbmrlkkerwpnypdh.supabase.co", SB_KEY = "sb_publishable_KGq6gw1-ItPA-VBDXgKoNA_cv2LWxil";
var KP = "uiprog", KF = "uibooks2", KT = "uilibts", KFS = "uifs", KTH = "ui-theme";
var isSpa = !!D.getElementById("v-home");
var SELF = D.currentScript && D.currentScript.src ? D.currentScript.src.split("?")[0].replace(/[^\/]*$/, "") : "";

function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
var handlers = [];
function emit() { handlers.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); }

/* ================= library sync ================= */
var client = null, uid = null, queued = {}, timer = null, waiting = [], booting = false;
function favs() { var f = jget(KF, []); return Array.isArray(f) ? f : []; }
function prog() { var p = jget(KP, {}); return p && typeof p === "object" ? p : {}; }
function stamps() { var t = jget(KT, {}); return t && typeof t === "object" ? t : {}; }

function rowFor(id) {
  var pr = prog()[id], f = favs().indexOf(id) > -1;
  var c = pr ? clamp(Math.round(pr.c) || 0, 0, 500) : 0, p = pr ? clamp(+pr.p || 0, 0, 1) : 0;
  return { book_id: id, favorite: f, chapter: c, progress: p, status: pr ? (p >= 0.98 ? "completed" : "reading") : null };
}
function queue(id) { queued[id] = 1; schedule(); }
function schedule() { if (client && uid && !timer) { timer = setTimeout(flush, 4000); } }
function flush() {
  timer = null;
  var ids = Object.keys(queued); if (!ids.length || !client || !uid) { return; }
  queued = {};
  client.from("library").upsert(ids.map(rowFor), { onConflict: "user_id,book_id" }).then(function (r) {
    if (!r.error) { return; }
    // a bad id (for example a deleted book) must not block the others: retry one by one
    ids.forEach(function (id) {
      client.from("library").upsert([rowFor(id)], { onConflict: "user_id,book_id" }).then(function (x) {
        if (x.error && x.error.code === "23503") { dropLocal(id); } else if (x.error) { queued[id] = 1; }
      });
    });
  }).catch(function () { ids.forEach(function (id) { queued[id] = 1; }); });
}
function dropLocal(id) {
  var p = prog(), t = stamps(); delete p[id]; delete t[id]; jset(KP, p); jset(KT, t); jset(KF, favs().filter(function (x) { return x !== id; }));
}
function pull() {
  if (!client || !uid) { return; }
  client.from("library").select("book_id,favorite,chapter,progress,updated_at").then(function (r) {
    if (r.error || !r.data) { return; }
    var f = favs(), p = prog(), t = stamps(), changed = false, have = {};
    r.data.forEach(function (row) {
      var id = row.book_id, cts = Date.parse(row.updated_at) || 0, lts = t[id] || 0; have[id] = 1;
      if (cts > lts) {
        f = f.filter(function (x) { return x !== id; }); if (row.favorite) { f.push(id); }
        if (row.chapter > 0 || row.progress > 0) { p[id] = { c: row.chapter, p: row.progress, t: cts }; }
        t[id] = cts; changed = true;
      } else if (lts > cts) { queued[id] = 1; }
    });
    f.forEach(function (id) { if (!have[id]) { if (!t[id]) { t[id] = 1; } queued[id] = 1; } });
    Object.keys(p).forEach(function (id) { if (!have[id]) { queued[id] = 1; } });
    jset(KF, f); jset(KP, p); jset(KT, t);
    if (changed) { emit(); }
    schedule();
  }).catch(function () { /* offline: local data is kept */ });
}
function setUser(u) { var id = u ? u.id : null; if (id === uid) { return; } uid = id; if (uid) { setTimeout(pull, 0); } }
function flushWaiting(c) {
  var w = waiting; waiting = [];
  w.forEach(function (f) { try { f(c); } catch (e) { /* ignore */ } });
}
function attach(c) {
  if (!c || !c.auth || client === c) { return; }
  client = c;
  flushWaiting(c);
  c.auth.getSession().then(function (r) { setUser(r.data && r.data.session ? r.data.session.user : null); }).catch(function () { /* ignore */ });
  c.auth.onAuthStateChange(function (ev, s) { setUser(s ? s.user : null); });
}
function hasSession() {
  try { for (var i = 0; i < localStorage.length; i++) { if (/^sb-.*-auth-token$/.test(localStorage.key(i))) { return true; } } } catch (e) { /* ignore */ }
  return false;
}
function boot() {
  if (W.sb && W.sb.auth) { attach(W.sb); return; }
  if (isSpa || !hasSession() || booting) { return; }     // visitors who are not signed in never load the account library
  booting = true;
  var s = D.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
  s.onload = function () {
    try { attach(W.supabase.createClient(SB_URL, SB_KEY, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })); } catch (e) { flushWaiting(null); }
  };
  s.onerror = function () { booting = false; flushWaiting(null); };
  D.head.appendChild(s);
}
/* hands the one shared account connection to other scripts; gives null when nobody is signed in */
function getClient(cb) {
  if (W.sb && W.sb.auth) { cb(W.sb); return; }
  if (client) { cb(client); return; }
  if (isSpa || !hasSession()) { cb(null); return; }
  waiting.push(cb); boot();
}
var Sync = {
  getProgress: function (id) { var p = prog()[id]; return p ? { c: p.c, p: p.p, t: p.t } : null; },
  last: function () { var p = prog(), best = null; Object.keys(p).forEach(function (id) { if (!best || p[id].t > best.t) { best = { id: id, c: p[id].c, p: p[id].p, t: p[id].t }; } }); return best; },
  isFav: function (id) { return favs().indexOf(id) > -1; },
  setFav: function (id, on) {
    var f = favs().filter(function (x) { return x !== id; }); if (on) { f.push(id); }
    var t = stamps(); t[id] = Date.now(); jset(KF, f); jset(KT, t); queue(id); emit();
  },
  /* used by the main page, which keeps its own list of saved book ids */
  favsChanged: function (ids) {
    var old = favs(), t = stamps(), now = Date.now();
    ids.forEach(function (id) { if (old.indexOf(id) < 0) { t[id] = now; queue(id); } });
    old.forEach(function (id) { if (ids.indexOf(id) < 0) { t[id] = now; queue(id); } });
    jset(KT, t);
  },
  setProgress: function (id, c, p) {
    var pr = prog(), t = stamps(), now = Date.now();
    pr[id] = { c: c, p: Math.round(clamp(p, 0, 1) * 1000) / 1000, t: now }; t[id] = now; jset(KP, pr); jset(KT, t); queue(id);
  },
  attach: attach, pull: pull, flushNow: function () { if (timer) { clearTimeout(timer); } flush(); }
};

/* ================= share ================= */
var shareEl = null;
function closeShare() { if (shareEl) { shareEl.remove(); shareEl = null; } }
function link(h, label, cls) { var a = D.createElement("a"); a.href = h; a.target = "_blank"; a.rel = "noopener"; a.textContent = label; if (cls) { a.className = cls; } return a; }
function shareMenu(o) {
  closeShare();
  var u = encodeURIComponent(o.url), tt = encodeURIComponent(o.title);
  var m = D.createElement("div"); m.id = "ui-share"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "Share");
  var h = D.createElement("h3"); h.textContent = "Share"; m.appendChild(h);
  var box = D.createElement("div"); box.className = "shl";
  box.appendChild(link("https://wa.me/?text=" + encodeURIComponent(o.title + " " + o.url), "WhatsApp"));
  box.appendChild(link("https://www.facebook.com/sharer/sharer.php?u=" + u, "Facebook"));
  box.appendChild(link("https://t.me/share/url?url=" + u + "&text=" + tt, "Telegram"));
  box.appendChild(link("https://twitter.com/intent/tweet?url=" + u + "&text=" + tt, "X"));
  box.appendChild(link("mailto:?subject=" + tt + "&body=" + encodeURIComponent((o.text || o.title) + "\n" + o.url), "Email"));
  var cp = D.createElement("button"); cp.type = "button"; cp.textContent = "Copy link";
  cp.onclick = function () {
    var done = function () { cp.textContent = "Copied \u2713"; };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(o.url).then(done, function () { W.prompt("Copy this link:", o.url); }); } else { W.prompt("Copy this link:", o.url); }
  };
  box.appendChild(cp); m.appendChild(box);
  var x = D.createElement("button"); x.type = "button"; x.className = "shx"; x.setAttribute("aria-label", "Close"); x.textContent = "\u00d7"; x.onclick = closeShare; m.appendChild(x);
  D.body.appendChild(m); shareEl = m;
  var first = m.querySelector("a"); if (first) { first.focus(); }
}
function share(o) {
  if (!o || !o.url) { return; }
  if (navigator.share) { navigator.share({ title: o.title, text: o.text || o.title, url: o.url }).catch(function () { /* cancelled */ }); return; }
  shareMenu(o);
}
function pageUrl() {
  var c = D.querySelector("link[rel=canonical]");
  return (c && c.getAttribute("href")) || (location.href.split("#")[0]);
}
function shareCurrent() {
  var art = D.querySelector("article.read[data-book]"), bk = D.querySelector("article.book[data-book]");
  if (art) {
    var bt = art.getAttribute("data-book-title") || "", au = art.getAttribute("data-author") || "";
    share({ title: (art.getAttribute("data-title") || "") + " \u2013 " + bt + " by " + au, text: "Read \u201c" + bt + "\u201d free on Ui Books", url: pageUrl() });
  } else if (bk) {
    share({ title: (bk.getAttribute("data-title") || "") + " by " + (bk.getAttribute("data-author") || ""), text: "Read \u201c" + (bk.getAttribute("data-title") || "") + "\u201d free on Ui Books", url: pageUrl() });
  }
}

/* ================= reading tools (generated pages) ================= */
var art = null, bar = null, ticking = false, saveT = null, lastMain = null;
function applyFs() { var v = +localStorage.getItem(KFS); if (v >= 16 && v <= 30) { D.documentElement.style.setProperty("--rfs", v + "px"); } }
function curFs() { var v = parseInt(W.getComputedStyle(D.documentElement).getPropertyValue("--rfs"), 10); return isFinite(v) ? v : 20; }
function changeFs(d) { var v = clamp(curFs() + d, 16, 30); D.documentElement.style.setProperty("--rfs", v + "px"); try { localStorage.setItem(KFS, String(v)); } catch (e) { /* ignore */ } }
function isLight() { return D.documentElement.getAttribute("data-theme") === "light"; }
function themeLabels() { D.querySelectorAll("[data-rt=theme]").forEach(function (b) { b.textContent = isLight() ? "\u263e" : "\u263c"; b.setAttribute("aria-label", isLight() ? "Switch to dark theme" : "Switch to light theme"); }); }
function toggleTheme() {
  if (isLight()) { D.documentElement.removeAttribute("data-theme"); } else { D.documentElement.setAttribute("data-theme", "light"); }
  try { localStorage.setItem(KTH, isLight() ? "light" : "dark"); } catch (e) { /* ignore */ }
  themeLabels();
}
function toast(msg, action) {
  var old = D.getElementById("ui-rtoast"); if (old) { old.remove(); }
  var t = D.createElement("div"); t.id = "ui-rtoast"; t.setAttribute("role", "status"); t.textContent = msg + " ";
  if (action) { var b = D.createElement("button"); b.type = "button"; b.textContent = action.label; b.onclick = function () { action.fn(); t.remove(); }; t.appendChild(b); }
  D.body.appendChild(t); setTimeout(function () { if (t.parentNode) { t.remove(); } }, 6000);
}
function artMetrics() {
  var r = art.getBoundingClientRect(), vh = W.innerHeight, den = r.height - vh * 0.7;
  return { r: r, vh: vh, den: den };
}
function progressNow() {
  var m = artMetrics();
  if (m.den <= 0) { return m.r.bottom <= m.vh + 60 ? 1 : 0.5; }
  return clamp((-m.r.top + m.vh * 0.15) / m.den, 0, 1);
}
function onScroll() {
  if (!art || ticking) { return; }
  ticking = true;
  W.requestAnimationFrame(function () {
    ticking = false; if (!art) { return; }
    var p = progressNow(); if (bar) { bar.firstChild.style.width = (p * 100).toFixed(1) + "%"; }
    clearTimeout(saveT); saveT = setTimeout(function () { recordProgress(p); }, 700);
  });
}
/* Reading log: which days you read and which chapters you got through (60% or more of the chapter).
   The profile page uses it, so reading on the chapter pages counts towards streaks, badges and chapter totals. */
var KL = "uireadlog";
function readLog() {
  var L = jget(KL, null);
  if (!L || !Array.isArray(L.c) || !Array.isArray(L.d)) { L = { c: [], d: [] }; }
  return L;
}
function logRead(id, c, p) {
  if (p < 0.02) { return; }
  var L = readLog(), t = new Date().toISOString().slice(0, 10), k = id + ":" + c, changed = false;
  if (L.d.indexOf(t) < 0) { L.d.push(t); L.d = L.d.slice(-400); changed = true; }
  if (p >= 0.6 && L.c.indexOf(k) < 0) { L.c.push(k); L.c = L.c.slice(-5000); changed = true; }
  if (changed) { jset(KL, L); }
}
function recordProgress(p) {
  if (!art) { return; }
  var id = art.getAttribute("data-book"), c = +art.getAttribute("data-chapter") || 0, saved = Sync.getProgress(id);
  logRead(id, c, p);
  if (saved && c < saved.c && p < 0.05) { return; }                 // opening an earlier chapter must not erase later progress
  if (saved && saved.c === c && p < saved.p - 0.02 && p < 0.9) { return; }   // do not move backwards within a chapter by accident
  if (!saved && p < 0.02) { return; }
  Sync.setProgress(id, c, p);
}
function initChapter() {
  var main = D.querySelector("main"); if (!main) { return; }
  bar = D.createElement("div"); bar.className = "rbar"; bar.setAttribute("aria-hidden", "true"); bar.innerHTML = "<i></i>"; main.appendChild(bar);
  themeLabels();
  var id = art.getAttribute("data-book"), c = +art.getAttribute("data-chapter") || 0, saved = Sync.getProgress(id);
  onScroll();
  if (saved && saved.c === c && saved.p > 0.03 && saved.p < 0.96 && !location.hash && W.scrollY < 100) {
    setTimeout(function () {
      if (!art || W.scrollY > 100) { return; }
      var m = artMetrics(), y = W.scrollY + m.r.top + saved.p * Math.max(m.den, 0) - m.vh * 0.15;
      W.scrollTo(0, Math.max(0, y));
      toast("Resumed where you left off.", { label: "START OVER", fn: function () { W.scrollTo(0, 0); } });
    }, 350);
  }
}

/* ================= book page buttons ================= */
function paintBook() {
  var bk = D.querySelector("article.book[data-book]"); if (!bk) { return; }
  var id = bk.getAttribute("data-book"), sv = D.querySelector("[data-bk=save]");
  if (sv) { var on = Sync.isFav(id); sv.textContent = on ? "\u2665 SAVED" : "\u2661 SAVE"; sv.setAttribute("aria-pressed", on ? "true" : "false"); }
  var acts = bk.querySelector(".acts"), old = acts && acts.querySelector("[data-continue]"); if (old) { old.remove(); }
  var pr = Sync.getProgress(id);
  if (acts && pr && pr.c > 0) {
    var target = pr.p >= 0.96 && D.querySelector('.chl a[href="chapter-' + (pr.c + 1) + '/"]') ? pr.c + 1 : pr.c;
    var a = D.querySelector('.chl a[href="chapter-' + target + '/"]');
    if (a) {
      var b = D.createElement("a"); b.className = "btn"; b.setAttribute("data-continue", "1"); b.setAttribute("href", "chapter-" + target + "/");
      b.textContent = (target === pr.c ? "CONTINUE" : "NEXT") + " \u00b7 CHAPTER " + target; acts.insertBefore(b, acts.firstChild);
    }
  }
}

/* ================= wiring ================= */
function init() {
  art = D.querySelector("article.read[data-book]");
  lastMain = D.querySelector("main");
  if (isSpa) { return; }
  D.documentElement.classList.add("ui-read");
  if (art) { initChapter(); }
  paintBook();
}
D.addEventListener("click", function (e) {
  var t = e.target && e.target.closest ? e.target.closest("[data-rt],[data-bk]") : null;
  if (shareEl && !(e.target.closest && e.target.closest("#ui-share")) && !t) { closeShare(); }
  if (!t) { return; }
  var rt = t.getAttribute("data-rt"), bk = t.getAttribute("data-bk");
  if (rt === "fs+") { changeFs(2); } else if (rt === "fs-") { changeFs(-2); } else if (rt === "theme") { toggleTheme(); }
  else if (rt === "share" || bk === "share") { shareCurrent(); }
  else if (bk === "save") { var b = D.querySelector("article.book[data-book]"); if (b) { Sync.setFav(b.getAttribute("data-book"), !Sync.isFav(b.getAttribute("data-book"))); } }
});
D.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeShare(); } });
W.addEventListener("scroll", onScroll, { passive: true });
W.addEventListener("resize", onScroll);
W.addEventListener("pagehide", function () { if (art) { recordProgress(progressNow()); } Sync.flushNow(); });
D.addEventListener("visibilitychange", function () { if (D.hidden) { if (art) { recordProgress(progressNow()); } Sync.flushNow(); } });
handlers.push(paintBook);

W.UiRead = { sync: Sync, share: share, on: function (f) { handlers.push(f); }, client: getClient, readLog: readLog };

applyFs();
if (!isSpa) {
  init();
  // the music player swaps pages without reloading: set up the new page when its content changes
  new MutationObserver(function () { if (D.querySelector("main") !== lastMain) { setTimeout(init, 0); } }).observe(D.body, { childList: true });
}
setTimeout(boot, isSpa ? 0 : 1200);
D.dispatchEvent(new Event("uiread:ready"));

/* the social layer (follow authors, alerts, bookmarks) lives in the same folder as this file */
if (!D.querySelector('script[src$="ui-social.js"]')) {
  var soc = D.createElement("script");
  soc.src = SELF + "ui-social.js"; soc.defer = true; D.head.appendChild(soc);
}
})();
