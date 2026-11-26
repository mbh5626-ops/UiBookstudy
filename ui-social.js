/* Ui Books - social layer.
   * Follow authors (author pages, book pages, the main page).
   * Alerts: new books and new chapters from followed authors and from saved books.
   * Chapter bookmarks: save a paragraph and jump back to it later.
   Needs the tables and functions from supabase-social.sql. If they are missing, everything here hides itself.
   All text coming from the database is escaped before it is shown. */
(function () {
"use strict";
if (window.UiSocial) { return; }
var W = window, D = document;
var SB_URL = "https://cqamtbmrlkkerwpnypdh.supabase.co", SB_KEY = "sb_publishable_KGq6gw1-ItPA-VBDXgKoNA_cv2LWxil";
var isSpa = !!D.getElementById("v-home");
var ROOT = (function () {
  try {
    var m = D.querySelector('meta[name="ui-root"]');
    return new URL(isSpa || !m ? "./" : (m.getAttribute("content") || "./"), location.href).href;
  } catch (e) { return location.href; }
})();

var sb = null, uid = null, off = false;
var follows = {}, names = {}, counts = {}, countsLoaded = false;
var notifs = [], unread = 0, newIds = {}, bms = [], isAuthor = false;
var panelOpen = false, tabSel = "n", manifest = null, mfLoading = false;
var pollT = null, readT = null, raf = 0, jumped = "";

/* ---------- helpers ---------- */
function E(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function key(n) { return String(n || "").trim().toLowerCase().slice(0, 80); }
function noop() { /* ignore */ }
function setText(el, t) { if (el && el.textContent !== t) { el.textContent = t; } }
function isMissing(e) {
  var m = (e && e.message) || "", c = e && e.code;
  return c === "PGRST205" || c === "PGRST202" || c === "42P01" || /schema cache|does not exist/i.test(m);
}
function limitMsg(e, fallback) { var m = (e && e.message) || ""; return /^Too many/.test(m) ? m : fallback; }
function ago(t) {
  var s = (Date.now() - Date.parse(t)) / 1000;
  if (isNaN(s)) { return ""; }
  s = Math.max(0, s);
  if (s < 60) { return "just now"; }
  if (s < 3600) { return Math.floor(s / 60) + " min ago"; }
  if (s < 86400) { return Math.floor(s / 3600) + " h ago"; }
  if (s < 604800) { return Math.floor(s / 86400) + " d ago"; }
  try { return new Date(t).toLocaleDateString(); } catch (e) { return ""; }
}
function toast(msg, action) {
  var old = D.getElementById("ui-stoast"); if (old) { old.remove(); }
  var t = D.createElement("div"); t.id = "ui-stoast"; t.setAttribute("role", "status"); t.textContent = msg + " ";
  if (action) { var a = D.createElement("a"); a.href = action.href; a.target = "_self"; a.textContent = action.label; t.appendChild(a); }
  D.body.appendChild(t);
  setTimeout(function () { if (t.parentNode) { t.remove(); } }, 6000);
}
function needSignIn(what) {
  if (isSpa && typeof W.openAuth === "function") { toast("Sign in to " + what + "."); W.openAuth("signin"); return; }
  toast("Sign in to " + what + ".", { label: "SIGN IN", href: ROOT + "#profile" });
}
function getSb(cb) {
  if (isSpa) { cb(W.sb || null); return; }
  if (W.UiRead && W.UiRead.client) { W.UiRead.client(cb); return; }
  cb(null);
}

/* ---------- styles ---------- */
(function () {
  var st = D.createElement("style");
  st.textContent =
    ".uifo{display:inline-flex;align-items:center;flex-wrap:wrap;gap:8px}.uifo .btn{padding:9px 16px;font-size:11px}" +
    ".uifc{color:var(--mu,#a9a1c8);font-size:15px}.uifo-row{margin:-8px 0 20px}.cd .uifo-row{margin:12px 0 0}#dt .uifo-row{margin:6px 0 4px}" +
    "article.read>p{position:relative}" +
    ".uibm{display:inline-block;margin-left:8px;background:none;border:0;padding:0 4px;font-size:.85em;line-height:1;color:var(--mu,#a9a1c8);opacity:.45;cursor:pointer;vertical-align:baseline}" +
    ".uibm:hover,.uibm:focus-visible,.uibm.on{opacity:1;color:var(--gold,#e0b45a)}@media(hover:none){.uibm{opacity:.7}}" +
    ".uibm-hit{background:rgba(224,180,90,.16);border-radius:6px;transition:background .6s}" +
    ".uihr{display:flex;align-items:center;gap:12px}" +
    ".uibell{position:relative;flex:none;width:38px;height:38px;border-radius:50%;border:1px solid var(--ln,rgba(190,160,255,.2));background:rgba(255,255,255,.05);color:var(--mu,#a9a1c8);display:grid;place-items:center;cursor:pointer;padding:0}" +
    ".uibell:hover,.uibell:focus-visible{color:var(--gold,#e0b45a);border-color:var(--gold,#e0b45a)}" +
    ".uibadge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:99px;background:var(--em,#d9546e);color:#fff;font:700 10px/18px Cinzel,serif;text-align:center;padding:0 4px}" +
    "#uiPanel{position:fixed;top:68px;right:16px;z-index:80;width:min(400px,calc(100vw - 24px));max-height:min(72vh,560px);overflow:auto;background:rgba(14,8,34,.98);border:1px solid var(--ln,rgba(190,160,255,.2));border-radius:20px;box-shadow:0 20px 50px rgba(0,0,0,.5);color:var(--ink,#f4ead2);font:16px/1.4 'Crimson Pro',Georgia,serif}" +
    ":root[data-theme=light] #uiPanel{background:rgba(255,250,239,.99)}" +
    ".uip-hd{display:flex;align-items:center;gap:6px;padding:10px 10px 6px;position:sticky;top:0;background:inherit;border-bottom:1px solid var(--ln,rgba(190,160,255,.2));z-index:1}" +
    ".uip-tabs{display:flex;gap:4px;flex:1}.uip-tabs button{flex:1;border:0;background:none;border-radius:12px;padding:8px 6px;font:600 12px Cinzel,serif;color:var(--mu,#a9a1c8);cursor:pointer}" +
    ".uip-tabs button.on{background:rgba(224,180,90,.16);color:var(--gold,#e0b45a)}.uip-tabs i{font-style:normal;margin-left:4px;color:var(--gold,#e0b45a)}" +
    ".uip-x,.uip-rm{flex:none;background:none;border:0;font-size:22px;line-height:1;color:var(--mu,#a9a1c8);cursor:pointer;padding:6px}.uip-x:hover,.uip-rm:hover{color:var(--gold,#e0b45a)}" +
    ".uip-bd{padding:6px 10px 12px}.uip-it{display:block;padding:10px 8px;border-radius:12px;color:inherit;text-decoration:none;border-bottom:1px solid var(--ln,rgba(190,160,255,.2))}" +
    ".uip-it:hover{background:rgba(255,255,255,.06)}.uip-it b{display:block;font:500 14px Cinzel,serif}.uip-it small{display:block;color:var(--mu,#a9a1c8);font-size:15px}.uip-it em{display:block;color:var(--mu,#a9a1c8);font-size:14px}" +
    ".uip-it.new{box-shadow:inset 3px 0 0 var(--gold,#e0b45a)}.uip-row{display:flex;align-items:flex-start;gap:4px}.uip-row .uip-it{flex:1;min-width:0}" +
    ".uip-row .uip-fn{flex:1;padding:10px 8px;font:500 14px Cinzel,serif;border-bottom:1px solid var(--ln,rgba(190,160,255,.2))}" +
    ".uip-empty{color:var(--mu,#a9a1c8);padding:14px 8px}.uip-act{display:block;width:100%;margin-top:10px;border:1px solid var(--ln,rgba(190,160,255,.2));background:none;border-radius:10px;padding:9px;font:600 12px Cinzel,serif;color:var(--mu,#a9a1c8);cursor:pointer}" +
    ".uip-act:hover{color:var(--gold,#e0b45a);border-color:var(--gold,#e0b45a)}.uip-ft{display:block;margin-top:10px;text-align:center;font:600 12px Cinzel,serif;color:var(--gold,#e0b45a);text-decoration:underline}" +
    "#ui-stoast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:90;background:rgba(14,8,34,.97);border:1px solid var(--ln,rgba(190,160,255,.2));border-radius:14px;padding:10px 16px;font:16px 'Crimson Pro',Georgia,serif;max-width:calc(100vw - 24px);color:var(--ink,#f4ead2)}" +
    ":root[data-theme=light] #ui-stoast{background:rgba(255,250,239,.98)}#ui-stoast a{color:var(--gold,#e0b45a);font:700 12px Cinzel,serif;margin-left:6px}";
  D.head.appendChild(st);
})();

/* ---------- follow authors ---------- */
function bump(k, d) { counts[k] = Math.max(0, (counts[k] || 0) + d); }
function mkFollow(name) {
  var s = D.createElement("span"); s.className = "uifo";
  s.innerHTML = '<button type="button" class="btn" data-fo="' + E(name) + '">+ FOLLOW</button><small class="uifc" data-fc="' + E(key(name)) + '"></small>';
  return s;
}
function paintFollow() {
  D.querySelectorAll("[data-fo]").forEach(function (b) {
    var on = !!follows[key(b.getAttribute("data-fo"))];
    setText(b, on ? "\u2713 FOLLOWING" : "+ FOLLOW");
    b.classList.toggle("g", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  D.querySelectorAll("[data-fc]").forEach(function (s) {
    var n = counts[s.getAttribute("data-fc")] || 0;
    setText(s, n ? n + (n === 1 ? " follower" : " followers") : "");
  });
}
function fetchCounts() {
  fetch(SB_URL + "/rest/v1/rpc/author_follower_counts", {
    method: "POST", headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" }, body: "{}"
  }).then(function (r) {
    if (r.status === 404) { off = true; decorate(); return []; }
    return r.ok ? r.json() : [];
  }).then(function (rows) {
    counts = {};
    (Array.isArray(rows) ? rows : []).forEach(function (x) { counts[x.author_key] = x.followers; });
    paintFollow();
  }).catch(noop);
}
function loadFollows() {
  sb.from("author_follows").select("author_key,author_name").then(function (r) {
    if (r.error) { if (isMissing(r.error)) { off = true; decorate(); } return; }
    follows = {}; names = {};
    (r.data || []).forEach(function (x) { follows[x.author_key] = 1; names[x.author_key] = x.author_name; });
    paintFollow(); if (panelOpen) { paintPanel(); }
  }).catch(noop);
}
function toggleFollow(name) {
  var k = key(name); if (!k) { return; }
  if (!sb || !uid) { needSignIn("follow authors"); return; }
  var on = !follows[k];
  function apply(v) {
    if (v) { follows[k] = 1; names[k] = String(name).trim(); } else { delete follows[k]; }
    bump(k, v ? 1 : -1); paintFollow(); if (panelOpen) { paintPanel(); }
  }
  apply(on);
  var q = on ? sb.from("author_follows").insert({ author_name: String(name).trim().slice(0, 80) })
    : sb.from("author_follows").delete().eq("author_key", k);
  q.then(function (r) {
    if (r.error && !(on && r.error.code === "23505")) { apply(!on); toast(limitMsg(r.error, "Couldn\u2019t update. Please try again.")); return; }
    toast(on ? "You follow " + name + " now." : "You unfollowed " + name + ".");
  }).catch(function () { apply(!on); toast("Network problem. Please try again."); });
}
function decorateFollow() {
  var made = false;
  /* generated author page */
  var h1 = D.querySelector("main.wrap section.gl > h1");
  if (h1 && /^Books by /.test(h1.textContent) && !h1.parentNode.querySelector("[data-fo]")) {
    var row = D.createElement("div"); row.className = "uifo-row"; row.appendChild(mkFollow(h1.textContent.replace(/^Books by /, "").trim()));
    var meta = h1.parentNode.querySelector("p.meta");
    if (meta) { meta.parentNode.insertBefore(row, meta.nextSibling); } else { h1.parentNode.insertBefore(row, h1.nextSibling); }
    made = true;
  }
  /* generated book page */
  var bk = D.querySelector("article.book[data-author]");
  if (bk) {
    var acts = bk.querySelector(".acts");
    if (acts && !acts.querySelector("[data-fo]")) { acts.appendChild(mkFollow(bk.getAttribute("data-author"))); made = true; }
  }
  /* main page: author cards and the book detail view */
  D.querySelectorAll("#au .cd[data-a]").forEach(function (c) {
    if (!c.querySelector("[data-fo]")) { var r = D.createElement("div"); r.className = "uifo-row"; r.appendChild(mkFollow(c.getAttribute("data-a"))); c.appendChild(r); made = true; }
  });
  var dt = D.getElementById("dt");
  if (dt && W.B && W.B[W.cur] && !dt.querySelector("[data-fo]")) {
    var a = dt.querySelector(".dr .a");
    if (a) { var r2 = D.createElement("div"); r2.className = "uifo-row"; r2.appendChild(mkFollow(W.B[W.cur].a)); a.parentNode.insertBefore(r2, a.nextSibling); made = true; }
  }
  if (made) {
    paintFollow();
    if (!countsLoaded) { countsLoaded = true; fetchCounts(); }
  }
}

/* ---------- bookmarks ---------- */
function curArt() { return D.querySelector("article.read[data-book][data-chapter]"); }
function chapterParas(art) {
  return Array.prototype.filter.call(art.children, function (el) { return el.tagName === "P" && !el.classList.contains("kick"); });
}
function markBms() {
  var art = curArt(); if (!art) { return; }
  var book = art.getAttribute("data-book"), ch = +art.getAttribute("data-chapter") || 0;
  art.querySelectorAll(".uibm").forEach(function (b) {
    var i = +b.getAttribute("data-bm");
    var on = bms.some(function (x) { return x.book_id === book && x.chapter === ch && x.paragraph === i; });
    setText(b, on ? "\u2605" : "\u2606");
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("title", on ? "Remove bookmark" : "Bookmark this paragraph");
  });
}
function afterBms() { markBms(); paintBell(); if (panelOpen) { paintPanel(); } }
function loadBms() {
  var F = "id,book_id,chapter,paragraph,snippet,created_at";
  sb.from("bookmarks").select(F + ",books(title)").order("created_at", { ascending: false }).limit(200).then(function (r) {
    if (r.error) {
      return sb.from("bookmarks").select(F).order("created_at", { ascending: false }).limit(200).then(function (q) {
        if (!q.error) { bms = q.data || []; afterBms(); }
      });
    }
    bms = r.data || []; afterBms();
  }).catch(noop);
}
function toggleBm(i) {
  var art = curArt(); if (!art) { return; }
  if (!sb || !uid) { needSignIn("save bookmarks"); return; }
  var book = art.getAttribute("data-book"), ch = +art.getAttribute("data-chapter") || 0;
  var ex = bms.filter(function (x) { return x.book_id === book && x.chapter === ch && x.paragraph === i; })[0];
  if (ex) {
    bms = bms.filter(function (x) { return x !== ex; }); afterBms();
    var back = function (m) { bms.unshift(ex); afterBms(); toast(m); };
    sb.from("bookmarks").delete().eq("id", ex.id).then(function (r) { if (r.error) { back("Couldn\u2019t remove the bookmark."); } }).catch(function () { back("Network problem. Please try again."); });
    return;
  }
  var p = chapterParas(art)[i]; if (!p) { return; }
  var c = p.cloneNode(true), x = c.querySelector(".uibm"); if (x) { x.remove(); }
  var snippet = c.textContent.replace(/\s+/g, " ").trim().slice(0, 120);
  sb.from("bookmarks").insert({ book_id: book, chapter: ch, paragraph: i, snippet: snippet })
    .select("id,book_id,chapter,paragraph,snippet,created_at").then(function (r) {
      if (r.error) { if (r.error.code === "23505") { loadBms(); return; } toast(limitMsg(r.error, "Couldn\u2019t save the bookmark.")); return; }
      var row = r.data && r.data[0];
      if (row) { row.books = { title: art.getAttribute("data-book-title") || book }; bms.unshift(row); afterBms(); toast("Bookmark saved."); }
    }).catch(function () { toast("Network problem. Please try again."); });
}
function delBm(id) {
  var ex = bms.filter(function (x) { return x.id === id; })[0]; if (!ex || !sb) { return; }
  bms = bms.filter(function (x) { return x !== ex; }); afterBms();
  sb.from("bookmarks").delete().eq("id", id).then(function (r) { if (r.error) { bms.unshift(ex); afterBms(); toast("Couldn\u2019t remove the bookmark."); } })
    .catch(function () { bms.unshift(ex); afterBms(); toast("Network problem. Please try again."); });
}
function decorateChapter() {
  var art = curArt(); if (!art) { return; }
  chapterParas(art).forEach(function (p, i) {
    if (!p.id) { p.id = "bm-" + i; }
    if (!p.querySelector(".uibm")) {
      var b = D.createElement("button"); b.type = "button"; b.className = "uibm"; b.setAttribute("data-bm", String(i));
      b.setAttribute("aria-label", "Bookmark this paragraph"); b.textContent = "\u2606"; p.appendChild(b);
    }
  });
  markBms();
  var m = /^#bm-(\d+)$/.exec(location.hash || "");
  if (m && jumped !== location.pathname + location.hash) {
    var tgt = D.getElementById("bm-" + m[1]);
    if (tgt) {
      jumped = location.pathname + location.hash;
      tgt.scrollIntoView({ block: "center" }); tgt.classList.add("uibm-hit");
      setTimeout(function () { tgt.classList.remove("uibm-hit"); }, 3000);
    }
  }
}

/* ---------- alerts ---------- */
function loadNotifs() {
  sb.from("notifications").select("id,kind,book_id,chapter,title,body,read_at,created_at").order("created_at", { ascending: false }).limit(30).then(function (r) {
    if (r.error) { return; }
    notifs = r.data || [];
    unread = notifs.filter(function (n) { return !n.read_at; }).length;
    if (panelOpen) { notifs.forEach(function (n) { if (!n.read_at) { newIds[n.id] = 1; } }); paintPanel(); if (tabSel === "n") { scheduleSeen(); } }
    paintBell();
  }).catch(noop);
}
function scheduleSeen() { clearTimeout(readT); readT = setTimeout(markSeen, 1200); }
function markSeen() {
  if (!panelOpen || tabSel !== "n" || !sb) { return; }
  var ids = notifs.filter(function (n) { return !n.read_at; }).map(function (n) { return n.id; });
  if (!ids.length) { return; }
  var now = new Date().toISOString();
  notifs.forEach(function (n) { if (!n.read_at) { n.read_at = now; } });
  unread = 0; paintBell();
  sb.from("notifications").update({ read_at: now }).in("id", ids).then(noop).catch(noop);
}
function clearAlerts() {
  if (!sb || !uid) { return; }
  notifs = []; unread = 0; newIds = {}; paintBell(); paintPanel();
  sb.from("notifications").delete().eq("user_id", uid).then(noop).catch(noop);
}
function checkAuthor() {
  sb.from("author_applications").select("status").eq("user_id", uid).eq("status", "approved").limit(1).then(function (r) {
    isAuthor = !!(r.data && r.data.length); if (panelOpen) { paintPanel(); }
  }).catch(noop);
}
function loadManifest() {
  if (manifest || mfLoading) { return; }
  mfLoading = true;
  fetch(ROOT + "books/manifest.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    manifest = j && j.books && typeof j.books === "object" ? j.books : {};
    mfLoading = false; if (panelOpen) { paintPanel(); }
  }).catch(function () { manifest = {}; mfLoading = false; });
}
/* a generated page when it exists, otherwise the in-page book view */
function pageUrl(bookId, chapter, para) {
  var g = manifest && Object.prototype.hasOwnProperty.call(manifest, bookId) ? manifest[bookId] : null;
  if (Array.isArray(g)) {
    if (chapter && g.indexOf(chapter) > -1) { return ROOT + "books/" + bookId + "/chapter-" + chapter + "/" + (para != null ? "#bm-" + para : ""); }
    return ROOT + "books/" + bookId + "/";
  }
  return ROOT + "?book=" + encodeURIComponent(bookId);
}

/* ---------- bell and panel ---------- */
var BELL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><span class="uibadge" hidden></span>';
function ensureBell() {
  var have = D.getElementById("uiBell");
  if (!uid || off) { if (have) { have.remove(); } return; }
  if (have) { return; }
  var host = isSpa ? D.querySelector("header") : D.querySelector("header.hd");
  if (!host) { return; }
  var b = D.createElement("button"); b.type = "button"; b.id = "uiBell"; b.className = "uibell";
  b.setAttribute("aria-label", "Alerts, bookmarks and followed authors"); b.setAttribute("aria-haspopup", "dialog"); b.innerHTML = BELL;
  if (isSpa) {
    var wrap = D.getElementById("uiHr"), us = D.getElementById("us");
    if (!wrap) {
      if (!us) { return; }
      wrap = D.createElement("div"); wrap.id = "uiHr"; wrap.className = "uihr"; host.insertBefore(wrap, us); wrap.appendChild(us);
    }
    wrap.insertBefore(b, wrap.firstChild);
  } else { host.appendChild(b); }
  paintBell();
}
function paintBell() {
  var b = D.getElementById("uiBell"); if (!b) { return; }
  var bd = b.querySelector(".uibadge");
  if (bd) { if (unread > 0) { setText(bd, unread > 9 ? "9+" : String(unread)); bd.hidden = false; } else { bd.hidden = true; } }
  b.setAttribute("title", unread ? unread + " new alert" + (unread > 1 ? "s" : "") : "Alerts and bookmarks");
}
function ensurePanel() {
  var p = D.getElementById("uiPanel"); if (p) { return p; }
  p = D.createElement("div"); p.id = "uiPanel"; p.tabIndex = -1;
  p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Alerts, bookmarks and followed authors");
  D.body.appendChild(p); return p;
}
function tabBtn(id, label, n) {
  return '<button type="button" role="tab" data-uitab="' + id + '" aria-selected="' + (tabSel === id ? "true" : "false") + '"' + (tabSel === id ? ' class="on"' : "") + ">" + label + (n ? "<i>" + n + "</i>" : "") + "</button>";
}
function paintPanel() {
  var p = D.getElementById("uiPanel"); if (!p) { return; }
  var fk = Object.keys(follows);
  var h = '<div class="uip-hd"><div class="uip-tabs" role="tablist">' + tabBtn("n", "Alerts", unread) + tabBtn("b", "Bookmarks", bms.length) + tabBtn("f", "Following", fk.length) +
    '</div><button type="button" class="uip-x" data-uiact="close" aria-label="Close">\u00d7</button></div><div class="uip-bd">';
  if (tabSel === "n") {
    if (!notifs.length) { h += '<p class="uip-empty">No alerts yet. Follow an author to hear about their new books and chapters.</p>'; }
    else {
      h += notifs.map(function (n) {
        var link = pageUrl(n.book_id, n.kind === "new_chapter" ? n.chapter : null, null);
        return '<a class="uip-it' + (newIds[n.id] ? " new" : "") + '" href="' + E(link) + '" target="_self"><b>' + E(n.title) + "</b>" +
          (n.body ? "<small>" + E(n.body) + "</small>" : "") + "<em>" + E(ago(n.created_at)) + "</em></a>";
      }).join("");
      h += '<button type="button" class="uip-act" data-uiact="clear">CLEAR ALL</button>';
    }
  } else if (tabSel === "b") {
    if (!bms.length) { h += '<p class="uip-empty">No bookmarks yet. Tap \u2606 at the end of a paragraph in any chapter to save your place.</p>'; }
    else {
      h += bms.map(function (b) {
        var title = b.books && b.books.title ? b.books.title : b.book_id;
        return '<div class="uip-row"><a class="uip-it" href="' + E(pageUrl(b.book_id, b.chapter, b.paragraph)) + '" target="_self"><b>' + E(title) + "</b><small>Chapter " + E(b.chapter) + "</small>" +
          (b.snippet ? "<em>\u201c" + E(b.snippet) + "\u201d</em>" : "") + '</a><button type="button" class="uip-rm" data-bmdel="' + E(b.id) + '" aria-label="Remove bookmark">\u00d7</button></div>';
      }).join("");
    }
  } else {
    if (!fk.length) { h += '<p class="uip-empty">You don\u2019t follow anyone yet. Open an author or a book and tap Follow.</p>'; }
    else {
      h += fk.sort().map(function (k) {
        return '<div class="uip-row"><span class="uip-fn">' + E(names[k] || k) + '</span><button type="button" class="uip-rm" data-unf="' + E(k) + '" aria-label="Unfollow ' + E(names[k] || k) + '">\u00d7</button></div>';
      }).join("");
    }
  }
  if (isAuthor) { h += '<a class="uip-ft" href="' + E(ROOT + "author.html") + '" target="_self">Open your author dashboard</a>'; }
  p.innerHTML = h + "</div>";
}
function openPanel() {
  panelOpen = true; newIds = {};
  notifs.forEach(function (n) { if (!n.read_at) { newIds[n.id] = 1; } });
  var p = ensurePanel(); paintPanel(); loadManifest(); loadNotifs();
  if (tabSel === "n") { scheduleSeen(); }
  try { p.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
}
function closePanel() {
  panelOpen = false; clearTimeout(readT);
  var p = D.getElementById("uiPanel"); if (p) { p.remove(); }
}

/* ---------- page wiring ---------- */
function hideAll() {
  D.querySelectorAll(".uifo-row,.uibm").forEach(function (n) { n.remove(); });
  var b = D.getElementById("uiBell"); if (b) { b.remove(); }
  closePanel();
}
function decorate() {
  try {
    if (off) { hideAll(); return; }
    decorateFollow(); decorateChapter(); ensureBell(); paintFollow(); paintBell();
  } catch (e) { /* never break the page */ }
}
function schedule() {
  if (raf) { return; }
  raf = W.requestAnimationFrame(function () { raf = 0; decorate(); });
}
function setUser(u) {
  var id = u ? u.id : null;
  if (id === uid) { return; }
  uid = id; follows = {}; names = {}; notifs = []; unread = 0; bms = []; isAuthor = false; newIds = {};
  if (pollT) { clearInterval(pollT); pollT = null; }
  if (!uid) { closePanel(); decorate(); return; }
  loadFollows(); loadNotifs(); loadBms(); checkAuthor();
  pollT = setInterval(function () { if (!D.hidden && uid && sb) { loadNotifs(); } }, 120000);
  decorate();
}
D.addEventListener("click", function (e) {
  var t = e.target; if (!t || !t.closest) { return; }
  var x;
  if ((x = t.closest("[data-fo]"))) { e.preventDefault(); e.stopPropagation(); toggleFollow(x.getAttribute("data-fo")); return; }
  if ((x = t.closest("[data-bm]"))) { e.preventDefault(); e.stopPropagation(); toggleBm(+x.getAttribute("data-bm")); return; }
  if (t.closest("#uiBell")) { e.preventDefault(); e.stopPropagation(); if (panelOpen) { closePanel(); } else { openPanel(); } return; }
  if ((x = t.closest("[data-uitab]"))) { tabSel = x.getAttribute("data-uitab"); paintPanel(); if (tabSel === "n") { scheduleSeen(); } return; }
  if ((x = t.closest("[data-bmdel]"))) { delBm(x.getAttribute("data-bmdel")); return; }
  if ((x = t.closest("[data-unf]"))) { var k = x.getAttribute("data-unf"); toggleFollow(names[k] || k); return; }
  if ((x = t.closest("[data-uiact]"))) {
    var a = x.getAttribute("data-uiact");
    if (a === "close") { closePanel(); } else if (a === "clear") { clearAlerts(); }
    return;
  }
  if (panelOpen && !t.closest("#uiPanel")) { closePanel(); }
}, true);
D.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && panelOpen) { closePanel(); var b = D.getElementById("uiBell"); if (b) { b.focus(); } }
});
D.addEventListener("visibilitychange", function () { if (!D.hidden && uid && sb) { loadNotifs(); } });

W.UiSocial = { refresh: decorate };
decorate();
new MutationObserver(schedule).observe(D.body, { childList: true, subtree: true });
getSb(function (c) {
  sb = c; if (!sb) { return; }
  sb.auth.getSession().then(function (r) { setUser(r.data && r.data.session ? r.data.session.user : null); }).catch(noop);
  sb.auth.onAuthStateChange(function (ev, s) { setTimeout(function () { setUser(s ? s.user : null); }, 0); });
});
})();
