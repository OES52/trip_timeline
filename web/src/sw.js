/* 여행 타임라인 서비스 워커. build.mjs가 버전·미리 저장 목록 자리(아래 두 상수)를 채워서 dist/sw.js로 만듦
 *  - 앱 셸(index.html + CDN 라이브러리): 설치 때 미리 저장, 버전 바뀌면 통째로 교체
 *  - 화면 이동(index): 네트워크 먼저(4초), 안 되면 저장본
 *  - /api/photo: 캐시 먼저 (사진은 주소가 같으면 내용도 같음)
 *  - 글꼴(구글 폰트·jsdelivr): 저장본 먼저 보여주고 뒤에서 갱신
 *  - /api/* 나머지: 손대지 않음 (일정 데이터는 화면이 IndexedDB에 직접 저장)
 *  - 푸시: 출발 알림 표시, 누르면 앱 열기 */
const VERSION = '__VERSION__';
const BASE = '__BASE__';   // 이 화면 경로 (예전 화면은 /v1/)
const PRECACHE = __PRECACHE__;
const SHELL = 'trip1-shell-' + VERSION;   // 루트(/)에 있던 예전 서비스 워커의 trip-shell-* 과 안 겹치게
const RUNTIME = 'trip-runtime-v1';
const PHOTOS = 'trip-photos-v1';
const PHOTO_MAX = 600;   // 사진 캐시 최대 장수 (넘으면 오래된 것부터)
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // 하나 실패해도 나머지는 저장 (CDN 하나 느려도 설치는 끝나게). 같은 사이트는 실패하면 설치 실패
    const results = await Promise.allSettled(PRECACHE.map(async u => {
      const same = u.charAt(0) === '/';
      const res = await fetch(new Request(u, same ? { cache: 'reload' } : { mode: 'cors', cache: 'reload' }));
      if (!res.ok) throw new Error(u + ' ' + res.status);
      await c.put(u, res);
    }));
    const bad = results.map((r, i) => r.status === 'rejected' ? PRECACHE[i] : null).filter(Boolean);
    if (bad.some(u => u.charAt(0) === '/')) throw new Error('앱 셸 저장 실패: ' + bad.join(', '));
    if (bad.length) console.warn('미리 저장 못 함 (나중에 다시)', bad);
    // 처음 설치면 바로 활성화. 업데이트면 화면의 "적용" 버튼을 기다림
    if (!self.registration.active) self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.indexOf('trip1-shell-') === 0 && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;

  if (req.mode === 'navigate' && same && url.pathname.indexOf(BASE) === 0) { e.respondWith(navigate(req)); return; }
  if (same && url.pathname === '/api/photo') { e.respondWith(photo(req)); return; }
  if (same && url.pathname.indexOf('/api/map/ofm/') === 0) { e.respondWith(mapTile(req)); return; }
  if (same && url.pathname.indexOf('/api/') === 0) return;

  const key = same ? url.pathname : req.url;
  if (PRECACHE.indexOf(key) >= 0) { e.respondWith(shell(req, key)); return; }
  if (FONT_HOSTS.indexOf(url.hostname) >= 0) { e.respondWith(swr(req)); return; }
});

async function navigate(req) {
  const c = await caches.open(SHELL);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(req, { signal: ctl.signal });
    clearTimeout(t);
    if (res.ok) return res;
    throw new Error(String(res.status));
  } catch (err) {
    return (await c.match(BASE + 'index.html')) || (await c.match(BASE)) || Response.error();
  }
}

async function shell(req, key) {
  const c = await caches.open(SHELL);
  const hit = await c.match(key);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(key, res.clone());
  return res;
}

async function swr(req) {
  const c = await caches.open(RUNTIME);
  const hit = await c.match(req);
  const net = fetch(req).then(res => {
    if (res.ok && (res.type === 'basic' || res.type === 'cors')) c.put(req, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await net) || Response.error();
}

async function photo(req) {
  const c = await caches.open(PHOTOS);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) { await c.put(req, res.clone()); trimPhotos(c); }
    return res;
  } catch (err) {
    return Response.error();
  }
}

// 벡터 지도(프록시): 캐시 먼저, 최대 4000개 (오래된 것부터 지움)
const MAP = 'trip-map-v1', MAP_MAX = 4000;
async function mapTile(req) {
  const c = await caches.open(MAP);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) { await c.put(req, res.clone()); trimMap(c); }
    return res;
  } catch (err) {
    return Response.error();
  }
}
let mapTrimAt = 0;
async function trimMap(c) {
  if (Date.now() - mapTrimAt < 30000) return;
  mapTrimAt = Date.now();
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAP_MAX; i++) await c.delete(keys[i]);
}

let trimming = false;
async function trimPhotos(c) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await c.keys();   // 넣은 순서
    for (let i = 0; i < keys.length - PHOTO_MAX; i++) await c.delete(keys[i]);
  } finally { trimming = false; }
}

/* ── 푸시 ── */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: '여행 타임라인', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '여행 타임라인', {
    body: d.body || '',
    tag: d.tag || 'trip',
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: BASE },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || BASE;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of list) {
      if (new URL(w.url).pathname.indexOf(BASE) === 0) { await w.focus(); return; }
    }
    await self.clients.openWindow(target);
  })());
});
