// オフライン対応：ネットワーク優先、失敗時はキャッシュ
const CACHE = 'kikigokochi-v2';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/worker.js',
  'js/storage.js',
  'js/audio/engine.js',
  'js/audio/pcm.js',
  'js/audio/capture-worklet.js',
  'js/dsp/fft.js',
  'js/dsp/frameAnalyzer.js',
  'js/analysis/analyze.js',
  'js/analysis/coach.js',
  'js/analysis/compare.js',
  'js/analysis/music.js',
  'js/analysis/report.js',
  'js/analysis/score.js',
  'js/analysis/stats.js',
  'js/ui/dom.js',
  'js/ui/charts.js',
  'js/ui/pitchRoll.js',
  'js/ui/timeline.js',
  'js/views/sing.js',
  'js/views/result.js',
  'js/views/history.js',
  'js/views/practice.js',
  'js/views/guide.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
