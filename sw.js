// Чесний Детектив — офлайн-кеш застосунку (scope: тека застосунку).
var CACHE = 'honest-detective-v2';
var VENDOR = 'honest-detective-vendor-v1'; // Tesseract (~6 МБ): незмінні файли, кеш окремо
var ASSETS = [
  './', './index.html', './style.css', './calc.js', './ocr-parse.js', './ocr.js', './app.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('honest-detective-') === 0 && k !== CACHE && k !== VENDOR; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Network-first (свіжа версія онлайн), кеш — у магазині без зв'язку.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Бібліотека розпізнавання: cache-first (завантажується раз, далі працює офлайн).
  if (url.pathname.indexOf('/vendor/') !== -1) {
    e.respondWith(caches.open(VENDOR).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; });
      });
    }));
    return;
  }
  e.respondWith(
    fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error());
      });
    })
  );
});
