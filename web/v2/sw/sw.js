/* 새 화면(v2) 서비스 워커. 범위는 /v2/ (예전 화면의 /sw.js 와 따로 돎)
 *  vite.config.js가 빌드 때 버전·미리 저장 목록(아래 두 상수)을 채워서 dist/sw.js로 만듦
 *  - 화면 이동(/v2/…): 네트워크 먼저(4초), 안 되면 저장해 둔 index.html
 *  - /v2/assets/*: 저장본 먼저 (이름에 해시가 붙어 있어서 내용이 안 바뀜). 미리 저장 목록은 설치 때 받아 둠
 *  - /api/photo: 저장본 먼저 (예전 화면과 같은 저장소를 같이 씀)
 *  - /api/map/ofm/*: 저장본 먼저 (지도 스타일·타일·글꼴. "오프라인 준비"로 미리 받아 둘 수 있음)
 *  - 나머지 /api/*: 손대지 않음 (일정 데이터는 화면이 IndexedDB에 직접 저장) */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const ASSETS = 'trip2-assets';
const META = '/v2/__precache.json';   // 지난번 미리 저장 목록 (업데이트 때 한 버전 전 파일까지는 남겨 둠)
const PHOTOS = 'trip-photos-v1';
const MAP = 'trip2-map';
const MAP_MAX = 3000, PHOTO_MAX = 600;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(ASSETS);
    for (const u of PRECACHE) {
      if (u !== '/v2/index.html' && (await c.match(u))) continue;   // 해시 붙은 파일은 이미 있으면 그대로
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (!res.ok) throw new Error('미리 저장 실패: ' + u + ' ' + res.status);
      await c.put(u, res);
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const c = await caches.open(ASSETS);
    // 지금 목록과 바로 전 목록에 없는 파일만 지움 (업데이트 직전에 열어 둔 화면이 예전 파일을 늦게 받아도 되게)
    let prev = [];
    try { const m = await c.match(META); if (m) prev = await m.json(); } catch (err) { prev = []; }
    const keep = new Set(PRECACHE.concat(prev));
    for (const req of await c.keys()) {
      const p = new URL(req.url).pathname;
      if (p === META || keep.has(p) || /PretendardJP/.test(p)) continue;
      await c.delete(req);
    }
    await c.put(META, new Response(JSON.stringify(PRECACHE), { headers: { 'Content-Type': 'application/json' } }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (req.mode === 'navigate' && p.indexOf('/v2') === 0) { e.respondWith(navigate(req)); return; }
  if (p.indexOf('/v2/assets/') === 0) { e.respondWith(cacheFirst(req, ASSETS, 0, true)); return; }
  if (p === '/api/photo') { e.respondWith(cacheFirst(req, PHOTOS, PHOTO_MAX)); return; }
  if (p.indexOf('/api/map/ofm/') === 0) { e.respondWith(cacheFirst(req, MAP, MAP_MAX)); return; }
  if (p.indexOf('/icons/') === 0) { e.respondWith(cacheFirst(req, ASSETS, 0)); return; }
});

async function navigate(req) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(req, { signal: ctl.signal });
    clearTimeout(t);
    if (res.ok) return res;
    throw new Error(String(res.status));
  } catch (err) {
    const c = await caches.open(ASSETS);
    return (await c.match('/v2/index.html')) || Response.error();
  }
}

async function cacheFirst(req, name, max, byPath) {
  const c = await caches.open(name);
  const key = byPath ? new URL(req.url).pathname : req;
  const hit = await c.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) { await c.put(key, res.clone()); if (max) trim(c, max); }
    return res;
  } catch (err) {
    return Response.error();
  }
}

const trimAt = {};
async function trim(c, max) {
  const now = Date.now();
  if (trimAt[max] && now - trimAt[max] < 30000) return;
  trimAt[max] = now;
  const keys = await c.keys();   // 넣은 순서 → 오래된 것부터 지움
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

/* ── 출발 알림 ── 서버(pushTick)가 { title, body, tag } 를 보냄. tag 'dep-날짜-순서' 면 그날 일정으로 엶 */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: '여행 타임라인', body: e.data ? e.data.text() : '' }; }
  const m = /^dep-(\d{4}-\d{2}-\d{2})-/.exec(d.tag || '');
  e.waitUntil(self.registration.showNotification(d.title || '여행 타임라인', {
    body: d.body || '',
    tag: d.tag || 'trip',
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: d.url || (m ? '/v2/#today' : '/v2/') },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/v2/', self.location.origin).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = list.find(c => new URL(c.url).pathname.indexOf('/v2') === 0);
    if (w) { await w.focus(); if ('navigate' in w) await w.navigate(target).catch(() => null); return; }
    await self.clients.openWindow(target);
  })());
});
