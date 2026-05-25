// 간단한 오프라인 캐시 — 정적 자산을 처음 방문 시 캐싱, 이후 오프라인에서도 로드 가능.
// 캐시 이름을 바꾸면(=배포 버전 변경) 옛 캐시는 자동 폐기.
const CACHE = 'family-chart-v5';
const ASSETS = [
  './',
  './index.html',
  './assets/chart.css',
  './assets/chart.js',
  './data/family.json',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 네트워크 우선, 실패 시 캐시 — 항상 최신 코드를 받지만 오프라인도 동작
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
