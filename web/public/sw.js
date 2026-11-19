/* תורנצ׳יק (MahanRoster) service worker: push notifications, and opening without reception.

   Offline: the page itself (index.html) is fetched from the network first, every time – so a new
   version is what loads whenever there is a connection, and the owl's update screen keeps working.
   Only without a connection the last copy is served. The files of the version in use (/assets/,
   named by their content) are kept as they load; when index.html names a new entry, the kept files
   of the old version are dropped. Only the app's own files are kept – never data from the server
   (the soldier's duties are kept by the app itself, per user). */
const SHELL = "mahan-shell-v1";
const ASSETS = "mahan-assets-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mahan-") && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

const entries = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]).sort();

async function keepShell(res) {
  const html = await res.clone().text();
  const shell = await caches.open(SHELL);
  const now = entries(html);
  const before = await shell.match("/__entries").then((r) => (r ? r.json() : []), () => []);
  await shell.put("/", res);
  if (JSON.stringify(now) !== JSON.stringify(before)) {
    // a new version: drop the old one's files, keep the new entry files now
    await caches.delete(ASSETS);
    const assets = await caches.open(ASSETS);
    await Promise.all(now.map((u) => assets.add(u).catch(() => undefined)));
    await shell.put("/__entries", new Response(JSON.stringify(now), { headers: { "content-type": "application/json" } }));
  }
}

async function page(event) {
  try {
    const res = await fetch(event.request);
    if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) event.waitUntil(keepShell(res.clone()).catch(() => undefined));
    return res;
  } catch (e) {
    const kept = await caches.open(SHELL).then((c) => c.match("/"));
    if (kept) return kept;
    throw e;
  }
}

async function asset(event) {
  const assets = await caches.open(ASSETS);
  const kept = await assets.match(event.request);
  if (kept) return kept;
  const res = await fetch(event.request);
  if (res.ok) event.waitUntil(assets.put(event.request, res.clone()).catch(() => undefined));
  return res;
}

// icons, images, the manifest: the network first, the kept copy without one
async function other(event) {
  try {
    const res = await fetch(event.request);
    if (res.ok) event.waitUntil(caches.open(SHELL).then((c) => c.put(event.request, res.clone())).catch(() => undefined));
    return res;
  } catch (e) {
    const kept = await caches.open(SHELL).then((c) => c.match(event.request));
    if (kept) return kept;
    throw e;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the server's data is never kept here
  if (url.pathname === "/sw.js" || url.search.includes("join=")) return;
  if (req.mode === "navigate") return event.respondWith(page(event));
  if (url.pathname.startsWith("/assets/")) return event.respondWith(asset(event));
  if (/^\/(brand\/|favicon|manifest|icon)/.test(url.pathname)) return event.respondWith(other(event));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "תורנצ׳יק", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "תורנצ׳יק", {
      body: data.body || "",
      icon: "/brand/icon-192.png",
      badge: "/brand/owl/badge-96.png",
      tag: data.tag,
      lang: "he",
      dir: "rtl",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin)) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
