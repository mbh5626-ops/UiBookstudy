/* Ui Books service worker.
   Purpose: lets the site be installed as an app, and lets pages a reader already opened work offline.
   It is network-first: online, readers always get the newest version of every page and script.
   Only when the network fails does it fall back to the saved copy (or the offline page).
   It never touches other websites (the database, fonts, scripts) and never saves failed responses.
   To switch it off for everyone later, replace this file with one that only unregisters itself. */
const VERSION = "ui-v1";
const MAX_ENTRIES = 150;
const OFFLINE = "offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll([OFFLINE, "./"])).catch(() => { /* not fatal */ }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              // only our own site
  if (url.pathname.endsWith("/sw.js")) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(VERSION).then(async (c) => { await c.put(req, copy); await trim(c); }).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
      if (cached) return cached;
      if (req.mode === "navigate") {
        const off = await caches.match(OFFLINE);
        if (off) return off;
      }
      return Response.error();
    }
  })());
});
