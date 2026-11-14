// trip-api: 여행 타임라인 정적 페이지 ↔ Apps Script 사이 프록시 (홈랩 k3s, trip 네임스페이스)
//  GET  /api/data                 일정 데이터. 캐시 먼저 주고 오래됐으면 뒤에서 갱신 (Apps Script 콜드스타트 숨김), gzip·brotli, ETag
//  GET  /api/events               SSE: 데이터가 바뀌면 {v} 알림 → 화면이 다시 받음 (친구 도장·도착 실시간)
//  POST /api/call   {fn, args}    쓰기·PIN 확인. PIN은 여기서 먼저 확인 (틀리면 Apps Script까지 안 감), 레이트 리밋
//  POST /api/hook/invalidate      Apps Script가 시트 바뀌면 부름 (X-Trip-Key)
//  GET  /api/photo?u=URL[&w=160|480|960]  장소 사진을 받아 디스크에 캐시 (사설 IP 차단). w가 있으면 그 폭의 webp로 줄여서
//  GET  /api/map/ofm/<경로>        OpenFreeMap 벡터 지도(스타일·타일·글꼴·아이콘)를 받아 디스크에 캐시
//                                  일정 경로 주변 타일은 미리 받아둠 (prewarm). 화면은 transformRequest로 이리로 보냄
//  GET  /api/push/key             VAPID 공개키
//  POST /api/push/subscribe|unsubscribe|test   출발 알림 구독
//  POST /api/login  {code}        접속 코드 확인 → 세션 쿠키 (ACCESS_CODE 있을 때)
//  GET  /api/session              세션 있는지 {need, ok}
//  GET  /healthz
//  ACCESS_CODE가 있으면 data·events·call·photo·push는 세션 쿠키 없으면 401. 지도 타일은 그대로 공개
//  환경변수: APPS_SCRIPT_URL, PROXY_KEY (필수) / VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (알림)
//           ACCESS_CODE (일정 보기 접속 코드, 비우면 잠금 없음), SESSION_DAYS(90)
//           DATA_DIR(/data), PORT(8080), PHOTO_CACHE_MB(500), XFF_HOPS(2), FRESH_SEC(30)
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import webpush from 'web-push';

const ENV = process.env;
const APPS_SCRIPT_URL = ENV.APPS_SCRIPT_URL || '';
const PROXY_KEY = ENV.PROXY_KEY || '';
const PORT = Number(ENV.PORT || 8080);
const DATA_DIR = ENV.DATA_DIR || '/data';
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const PUSH_FILE = path.join(DATA_DIR, 'push.json');
const PHOTO_MAX = Number(ENV.PHOTO_CACHE_MB || 500) * 1048576;
const MAP_DIR = path.join(DATA_DIR, 'map');
const MAP_MAX = Number(ENV.MAP_CACHE_MB || 700) * 1048576;
const OFM = 'https://tiles.openfreemap.org/';
const FRESH_MS = Number(ENV.FRESH_SEC || 30) * 1000;          // 이 안이면 그냥 캐시
const XFF_HOPS = Number(ENV.XFF_HOPS || 2);                   // X-Forwarded-For 뒤에서 몇 번째가 실제 클라이언트인지
const PUSH_ON = !!(ENV.VAPID_PUBLIC_KEY && ENV.VAPID_PRIVATE_KEY);

if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(APPS_SCRIPT_URL)) { console.error('APPS_SCRIPT_URL 없음/형식 다름'); process.exit(1); }
if (!PROXY_KEY) { console.error('PROXY_KEY 없음'); process.exit(1); }
if (PUSH_ON) webpush.setVapidDetails(ENV.VAPID_SUBJECT || 'mailto:admin@example.com', ENV.VAPID_PUBLIC_KEY, ENV.VAPID_PRIVATE_KEY);
fs.mkdirSync(PHOTO_DIR, { recursive: true });
fs.mkdirSync(MAP_DIR, { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

/* ── 접속 코드 세션 ──
 *  쿠키 trip_s = 만료시각.HMAC. 키는 PROXY_KEY+ACCESS_CODE에서 만듦 → 코드 바꾸면 기존 세션 전부 무효 */
const ACCESS_CODE = String(ENV.ACCESS_CODE || '');
const SESSION_DAYS = Number(ENV.SESSION_DAYS || 90);
const SESSION_KEY = crypto.createHash('sha256').update('trip-session|' + PROXY_KEY + '|' + ACCESS_CODE).digest();
const sessSig = p => crypto.createHmac('sha256', SESSION_KEY).update(p).digest('base64url');
function cookieOf(req, name) {
  const m = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.indexOf(name + '=') === 0);
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
function hasSession(req) {
  if (!ACCESS_CODE) return true;
  const v = cookieOf(req, 'trip_s');
  const i = v.lastIndexOf('.');
  if (i < 1) return false;
  const p = v.slice(0, i), sig = Buffer.from(v.slice(i + 1)), want = Buffer.from(sessSig(p));
  if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return false;
  return Number(p) > Date.now();
}
function sessionCookie() {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const p = String(exp);
  return 'trip_s=' + encodeURIComponent(p + '.' + sessSig(p)) + '; Path=/api; Max-Age=' + SESSION_DAYS * 86400 + '; HttpOnly; Secure; SameSite=Lax';
}

/* ── Apps Script 호출 ── */
// GET: 302로 googleusercontent에 넘어가서 결과. POST: 302 따라가면 GET으로 바뀌는 게 Apps Script 방식
async function gas(method, params, body) {
  const url = new URL(APPS_SCRIPT_URL);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const ctl = AbortSignal.timeout(method === 'POST' ? 90000 : 45000);
  const res = await fetch(url, method === 'POST'
    ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow', signal: ctl }
    : { redirect: 'follow', signal: ctl });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('Apps Script 응답이 JSON 아님 (' + res.status + ')'); }
  if (!j.ok) throw new Error(j.error || 'Apps Script 오류');
  return j.result;
}

/* ── 일정 데이터 캐시 ── */
const cache = { data: null, body: null, gz: null, br: null, etag: '', at: 0, inflight: null, auth: null, v: '' };
function setData(data) {
  // _v: 내용 지문. 화면이 들고 있는 데이터와 SSE로 받은 값을 비교해서 다르면 다시 받음
  const plain = Object.assign({}, data);
  delete plain._v;
  const v = sha256(JSON.stringify(plain)).slice(0, 12);
  data = Object.assign(plain, { _v: v });
  const body = Buffer.from(JSON.stringify({ ok: true, result: data }));
  cache.data = data;
  cache.body = body;
  cache.gz = zlib.gzipSync(body, { level: 9 });
  cache.br = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
  cache.etag = '"' + sha256(body).slice(0, 20) + '"';
  cache.at = Date.now();
  if (v !== cache.v) { cache.v = v; broadcast(); }
}

/* ── 실시간 알림 (SSE) ── */
const sse = new Set();
function broadcast() {
  const msg = 'event: data\ndata: ' + JSON.stringify({ v: cache.v }) + '\n\n';
  for (const res of sse) res.write(msg);
}
function apiEvents(req, res) {
  if (sse.size >= 200) return fail(req, res, 503, '연결이 너무 많음');
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n');
  if (cache.v) res.write('event: data\ndata: ' + JSON.stringify({ v: cache.v }) + '\n\n');
  sse.add(res);
  req.on('close', () => sse.delete(res));
}
// 프록시·게이트웨이가 놀고 있는 연결을 끊지 않게 25초마다 빈 줄
setInterval(() => { for (const res of sse) res.write(': ping\n\n'); }, 25000).unref();
function refresh(reason) {
  if (cache.inflight) return cache.inflight;
  const t0 = Date.now();
  cache.inflight = (async () => {
    try {
      const [data, auth] = await Promise.all([
        gas('GET', { api: 'data', key: PROXY_KEY }),
        gas('GET', { api: 'auth', key: PROXY_KEY }).catch(e => { log('auth 실패', e.message); return cache.auth; }),
      ]);
      setData(data);
      if (auth) cache.auth = auth;
      setTimeout(() => prewarm('데이터 갱신'), 5000);
      log('데이터 갱신', reason || '', (Date.now() - t0) + 'ms', Math.round(cache.body.length / 1024) + 'KB → br ' + Math.round(cache.br.length / 1024) + 'KB');
      return data;
    } finally {
      cache.inflight = null;
    }
  })();
  return cache.inflight;
}
// 쓰기 직후·시트 수정 알림: 여러 번 와도 1.5초 모아서 한 번
let refreshTimer = null;
function refreshSoon(reason) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh(reason).catch(e => log('갱신 실패', e.message)), 1500);
}

/* ── HTTP 도우미 ── */
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return xff.length >= XFF_HOPS ? xff[xff.length - XFF_HOPS] : (xff[0] || req.socket.remoteAddress || '?');
}
function pickEncoding(req) {
  const ae = String(req.headers['accept-encoding'] || '');
  return /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : '';
}
function send(res, status, headers, body) {
  res.writeHead(status, Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers));
  res.end(body);
}
function sendJSON(req, res, status, obj, extra) {
  let body = Buffer.from(JSON.stringify(obj));
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' }, extra);
  const enc = body.length > 1024 ? pickEncoding(req) : '';
  if (enc === 'br') body = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
  else if (enc === 'gzip') body = zlib.gzipSync(body);
  if (enc) h['Content-Encoding'] = enc;
  send(res, status, h, body);
}
const ok = (req, res, result) => sendJSON(req, res, 200, { ok: true, result });
const fail = (req, res, status, error, extra) => sendJSON(req, res, status, { ok: false, error }, extra);
async function readBody(req, limit) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('본문이 너무 큼'), { status: 413 }); chunks.push(c); }
  const s = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(s || '{}'); } catch (e) { throw Object.assign(new Error('JSON 형식이 아님'), { status: 400 }); }
}

/* ── 레이트 리밋 (고정 창) ── */
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
  b.n++;
  return b.n > max ? Math.ceil((b.start + windowMs - now) / 1000) : 0;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.start > 3600000) buckets.delete(k); }, 600000).unref();

/* ── PIN 확인 (Apps Script ?api=auth 의 해시와 비교) ── */
const pinFails = new Map();   // ip|user → { n, until }
function pinLocked(ip, user) {
  const f = pinFails.get(ip + '|' + user);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}
function pinFailed(ip, user) {
  const k = ip + '|' + user, now = Date.now();
  const f = pinFails.get(k) && pinFails.get(k).first > now - 600000 ? pinFails.get(k) : { n: 0, first: now, until: 0 };
  f.n++;
  if (f.n >= 5) f.until = now + 600000;   // 10분 안에 5번 틀리면 10분 잠금
  pinFails.set(k, f);
}
async function checkUserPin(user, pin) {
  if (!cache.auth) await refresh('auth 없음').catch(() => null);
  if (!cache.auth) return null;   // 모르면 Apps Script에 맡김
  const u = cache.auth.find(x => x.id === user);
  if (!u) return '없는 사용자: ' + user;
  if (u.pin && sha256(String(pin || '')) !== u.pin) return 'PIN이 틀림';
  return '';
}

// 정적 페이지가 부를 수 있는 함수: [사용자 인자 위치, PIN 인자 위치, 쓰기인지]
const FNS = {
  checkPin: [0, 1, false],
  setSpend: [4, 5, true],
  setVisited: [2, 3, true],
  setVisitedMany: [1, 2, true],
  setArrived: [2, 3, true],
  editPlan: [3, 4, true],
  setTodo: [2, 3, true],
};

async function apiCall(req, res) {
  const ip = clientIp(req);
  const wait = limited('call|' + ip, 60, 60000);
  if (wait) return fail(req, res, 429, '요청이 너무 많음. ' + wait + '초 뒤 다시', { 'Retry-After': String(wait) });
  const body = await readBody(req, 64 * 1024);
  const spec = FNS[body.fn];
  if (!spec) return fail(req, res, 400, '호출할 수 없는 함수: ' + body.fn);
  const args = Array.isArray(body.args) ? body.args : [];
  const user = String(args[spec[0]] || ''), pin = args[spec[1]];
  const lock = pinLocked(ip, user);
  if (lock) return fail(req, res, 429, 'PIN 시도가 너무 많음. ' + lock + '분 뒤 다시');
  const bad = await checkUserPin(user, pin);
  if (bad) {
    if (/PIN/.test(bad)) pinFailed(ip, user);
    return fail(req, res, 403, bad);
  }
  try {
    const result = await gas('POST', null, { fn: body.fn, args: args, key: PROXY_KEY });
    if (spec[2]) {
      // 결과로 바로 캐시를 고쳐서 친구 화면에 즉시 알림 → 그 뒤 Apps Script에서 한 번 더 받아 맞춤
      if (body.fn === 'editPlan' && result && result.points) setData(result);
      else {
        patchRecords(body.fn, user, result);
        refreshSoon(body.fn);
      }
    }
    ok(req, res, result);
  } catch (e) {
    if (/PIN/.test(e.message)) { pinFailed(ip, user); refreshSoon('PIN 불일치'); }   // 설정 시트에서 PIN 바뀐 경우
    // 403·409는 다시 보내도 안 되는 것 (화면이 "못 보낸 기록"으로 옮김), 502는 화면이 간격 두고 다시 보냄
    fail(req, res, /PIN|권한|보기 전용|수정할 수 없음|없는 사용자/.test(e.message) ? 403 : /^할 일이/.test(e.message) ? 409 : 502, e.message);
  }
}

// 쓰기 결과(그 사용자 기록 전체)를 캐시에 반영
function patchRecords(fn, user, result) {
  if (!cache.data || !result || typeof result !== 'object') return;
  const d = Object.assign({}, cache.data);
  if (fn === 'setVisitedMany' || fn === 'setVisited') d.visitedBy = Object.assign({}, d.visitedBy, { [user]: result });
  else if (fn === 'setArrived') d.arrivedBy = Object.assign({}, d.arrivedBy, { [user]: result });
  else if (fn === 'setSpend') d.spend = result;
  else if (fn === 'setTodo') d.todos = result;
  else return;
  setData(d);
}

async function apiData(req, res) {
  const ip = clientIp(req);
  if (limited('data|' + ip, 120, 60000)) return fail(req, res, 429, '요청이 너무 많음');
  if (!cache.data) {
    try { await refresh('첫 요청'); } catch (e) { return fail(req, res, 502, 'Apps Script 연결 실패: ' + e.message); }
  } else if (Date.now() - cache.at > FRESH_MS) {
    refresh('오래됨').catch(e => log('뒤에서 갱신 실패', e.message));   // 지금은 있는 것 주고 뒤에서
  }
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-cache', ETag: cache.etag, Vary: 'Accept-Encoding, Cookie',
    'X-Data-Age': String(Math.round((Date.now() - cache.at) / 1000)) };
  if (req.headers['if-none-match'] === cache.etag) return send(res, 304, h);
  const enc = pickEncoding(req);
  if (enc) h['Content-Encoding'] = enc;
  send(res, 200, h, enc === 'br' ? cache.br : enc === 'gzip' ? cache.gz : cache.body);
}

/* ── 사진 프록시 ── */
//  사설·예약 주소로 가는 요청 차단 (리다이렉트 매 단계, 실제 연결할 IP 기준)
const BLOCK = new net.BlockList();
[['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]].forEach(([a, p]) => BLOCK.addSubnet(a, p, 'ipv4'));
// 주의: ::ffff:0:0/96(IPv4 매핑)을 넣으면 Node BlockList가 모든 IPv4를 막음 → 매핑 주소는 isBlocked에서 IPv4로 바꿔 확인
[['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]].forEach(([a, p]) => BLOCK.addSubnet(a, p, 'ipv6'));
function isBlocked(addr) {
  const m = String(addr).match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i);
  if (m) {
    const v4 = m[1] || [parseInt(m[2], 16) >> 8, parseInt(m[2], 16) & 255, parseInt(m[3], 16) >> 8, parseInt(m[3], 16) & 255].join('.');
    return BLOCK.check(v4, 'ipv4');
  }
  const fam = net.isIP(addr);
  return fam ? BLOCK.check(addr, fam === 6 ? 'ipv6' : 'ipv4') : true;
}
function safeLookup(host, opts, cb) {
  dns.lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const good = addrs.filter(a => !isBlocked(a.address));
    if (!good.length) return cb(new Error('차단된 주소: ' + host));
    if (opts && opts.all) return cb(null, good);
    cb(null, good[0].address, good[0].family);
  });
}
function getOnce(u) {
  return new Promise((resolve, reject) => {
    const url = new URL(u);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return reject(new Error('https 443만 허용'));
    // IP를 직접 쓴 주소는 lookup을 안 거치므로 여기서 확인
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isBlocked(host)) return reject(new Error('차단된 주소: ' + host));
    const req = https.get(url, { lookup: safeLookup, timeout: 15000, headers: { 'User-Agent': 'trip-api/1 (photo cache)', Accept: 'image/*' } }, resolve);
    req.on('timeout', () => req.destroy(new Error('시간 초과')));
    req.on('error', reject);
  });
}
async function fetchImage(u) {
  for (let hop = 0; hop < 5; hop++) {
    const r = await getOnce(u);
    if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) { r.resume(); u = new URL(r.headers.location, u).toString(); continue; }
    if (r.statusCode !== 200) { r.resume(); throw new Error('원본 ' + r.statusCode); }
    const type = String(r.headers['content-type'] || '').split(';')[0].trim();
    if (!/^image\//.test(type) || /svg/.test(type)) { r.resume(); throw new Error('이미지가 아님: ' + type); }
    const chunks = [];
    let n = 0;
    for await (const c of r) { n += c.length; if (n > 15 * 1048576) { r.destroy(); throw new Error('15MB 넘음'); } chunks.push(c); }
    return { type, buf: Buffer.concat(chunks) };
  }
  throw new Error('리다이렉트가 너무 많음');
}
const photoIndex = new Map();   // hash → { size, at }
let photoTotal = 0;
const photoInflight = new Map();
async function scanPhotos() {
  for (const f of await fsp.readdir(PHOTO_DIR)) {
    if (!f.endsWith('.bin')) continue;
    const st = await fsp.stat(path.join(PHOTO_DIR, f)).catch(() => null);
    if (st) { photoIndex.set(f.slice(0, -4), { size: st.size, at: st.mtimeMs }); photoTotal += st.size; }
  }
  log('사진 캐시', photoIndex.size + '장', Math.round(photoTotal / 1048576) + 'MB');
}
async function prunePhotos() {
  if (photoTotal <= PHOTO_MAX) return;
  const list = Array.from(photoIndex.entries()).sort((a, b) => a[1].at - b[1].at);
  for (const [h, v] of list) {
    if (photoTotal <= PHOTO_MAX * 0.9) break;
    await fsp.rm(path.join(PHOTO_DIR, h + '.bin'), { force: true });
    await fsp.rm(path.join(PHOTO_DIR, h + '.type'), { force: true });
    photoIndex.delete(h); photoTotal -= v.size;
  }
}
// 사진 줄이기: ?w=160|480|960 이면 그 폭(이하)의 webp로. 원본은 따로 캐시해 두고 폭마다 한 번만 줄임
//  sharp가 없거나 줄이다 실패하면 원본 그대로 (화면은 똑같이 보임, 크기만 큼)
const PHOTO_W = new Set([160, 480, 960]);
let sharp = null;
try {
  sharp = (await import('sharp')).default;
  sharp.cache(false);        // 메모리 제한(384Mi) 안에서: 캐시 끄고 한 번에 하나씩
  sharp.concurrency(1);
} catch (e) { console.log('sharp 없음, 사진은 원본 그대로:', e.message); }

async function photoFromDisk(h) {
  if (!photoIndex.has(h)) return null;
  try {
    const [buf, type] = await Promise.all([fsp.readFile(path.join(PHOTO_DIR, h + '.bin')), fsp.readFile(path.join(PHOTO_DIR, h + '.type'), 'utf8')]);
    photoIndex.get(h).at = Date.now();
    return { buf, type };
  } catch (e) { photoIndex.delete(h); return null; }
}
async function photoToDisk(h, img) {
  if (photoIndex.has(h)) return;
  await fsp.writeFile(path.join(PHOTO_DIR, h + '.bin'), img.buf);
  await fsp.writeFile(path.join(PHOTO_DIR, h + '.type'), img.type);
  photoIndex.set(h, { size: img.buf.length, at: Date.now() });
  photoTotal += img.buf.length;
  prunePhotos().catch(() => null);
}
/** 같은 h를 동시에 여러 번 만들지 않게 (받는 중·줄이는 중이면 그걸 기다림) */
function once(h, make) {
  if (!photoInflight.has(h)) photoInflight.set(h, make().finally(() => photoInflight.delete(h)));
  return photoInflight.get(h);
}
/** 원본: 디스크 → 없으면 받아서 저장 */
function originalPhoto(u) {
  const h = sha256(u);
  return once(h, async () => {
    const hit = await photoFromDisk(h);
    if (hit) return hit;
    const img = await fetchImage(u);
    await photoToDisk(h, img);
    return img;
  });
}
/** 폭 w로 줄인 것: 디스크 → 없으면 원본을 줄여서 저장 (원본보다 커지면 원본) */
function resizedPhoto(u, w, h) {
  return once(h, async () => {
    const hit = await photoFromDisk(h);
    if (hit) return hit;
    const orig = await originalPhoto(u);
    let img = orig;
    try {
      const buf = await sharp(orig.buf, { failOn: 'none', limitInputPixels: 50e6, sequentialRead: true })
        .rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: w <= 160 ? 70 : 78 }).toBuffer();
      if (buf.length < orig.buf.length) img = { type: 'image/webp', buf };
    } catch (e) { log('사진 줄이기 실패, 원본으로', u.slice(0, 120), e.message); }
    await photoToDisk(h, img);
    return img;
  });
}

async function apiPhoto(req, res, q) {
  const u = q.get('u') || '';
  if (!/^https:\/\//i.test(u) || u.length > 2000) return fail(req, res, 400, 'https 주소만');
  const w = Number(q.get('w') || 0);
  if (w && !PHOTO_W.has(w)) return fail(req, res, 400, 'w는 ' + Array.from(PHOTO_W).join('·') + ' 중 하나');
  const small = !!(w && sharp);
  const h = small ? sha256(u + '#w' + w) : sha256(u);
  const etag = '"' + h.slice(0, 20) + '"';
  const hdr = type => ({ 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag });
  if (photoIndex.has(h)) {
    if (req.headers['if-none-match'] === etag) return send(res, 304, hdr('image/jpeg'));
    const hit = await photoFromDisk(h);
    if (hit) return send(res, 200, hdr(hit.type), hit.buf);
  }
  if (limited('photo|' + clientIp(req), 120, 60000)) return fail(req, res, 429, '요청이 너무 많음');
  try {
    const img = small ? await resizedPhoto(u, w, h) : await originalPhoto(u);
    send(res, 200, hdr(img.type), img.buf);
  } catch (e) {
    log('사진 실패', u.slice(0, 120), e.message);
    fail(req, res, 502, '사진 못 받음: ' + e.message, { 'Cache-Control': 'no-store' });
  }
}


/* ── 벡터 지도 캐시 (OpenFreeMap) ── */
//  타일은 주소에 빌드 버전이 들어 있어서(planet/20251105_.../z/x/y.pbf) 내용이 안 바뀜 → 오래 보관
//  스타일·TileJSON(planet)은 하루마다 다시 받음
const mapIndex = new Map();   // hash → { size, at }
let mapTotal = 0;
const mapInflight = new Map();
let mapUpstreamFails = 0;
async function scanMap() {
  for (const f of await fsp.readdir(MAP_DIR)) {
    if (!f.endsWith('.bin')) continue;
    const st = await fsp.stat(path.join(MAP_DIR, f)).catch(() => null);
    if (st) { mapIndex.set(f.slice(0, -4), { size: st.size, at: st.mtimeMs }); mapTotal += st.size; }
  }
  log('지도 캐시', mapIndex.size + '개', Math.round(mapTotal / 1048576) + 'MB');
}
async function pruneMap() {
  if (mapTotal <= MAP_MAX) return;
  const list = Array.from(mapIndex.entries()).sort((a, b) => a[1].at - b[1].at);
  for (const [h, v] of list) {
    if (mapTotal <= MAP_MAX * 0.9) break;
    await fsp.rm(path.join(MAP_DIR, h + '.bin'), { force: true });
    await fsp.rm(path.join(MAP_DIR, h + '.json'), { force: true });
    mapIndex.delete(h); mapTotal -= v.size;
  }
}
const isImmutable = p => /^(planet|monaco)\/\d{8}_[^/]+\/\d+\/\d+\/\d+\.pbf$/.test(p) || /^(fonts|sprites|natural_earth)\//.test(p);
// 캐시에서 꺼내거나 받아서 저장. 결과: { type, gz(Buffer, gzip), raw(Buffer|null) }
async function mapGet(p) {
  const h = sha256(p);
  const file = path.join(MAP_DIR, h + '.bin'), meta = path.join(MAP_DIR, h + '.json');
  if (mapIndex.has(h)) {
    try {
      const m = JSON.parse(await fsp.readFile(meta, 'utf8'));
      if (isImmutable(p) || Date.now() - m.at < 86400000) {
        mapIndex.get(h).at = Date.now();
        return { type: m.type, body: await fsp.readFile(file), gz: m.gz, status: m.status };
      }
    } catch (e) { /* 다시 받음 */ }
  }
  if (mapInflight.has(h)) return mapInflight.get(h);
  const job = (async () => {
    const res = await fetch(OFM + p, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'trip-api/1 (personal travel map cache)' } });
    if (res.status === 404) return { type: 'text/plain', body: Buffer.alloc(0), gz: false, status: 404 };
    if (!res.ok) { mapUpstreamFails++; throw new Error('지도 원본 ' + res.status); }
    mapUpstreamFails = 0;
    const type = res.headers.get('content-type') || 'application/octet-stream';
    let body = Buffer.from(await res.arrayBuffer());   // fetch가 이미 압축 풂
    const gz = !/^image\//.test(type);
    if (gz) body = zlib.gzipSync(body, { level: 6 });
    await fsp.writeFile(file, body);
    await fsp.writeFile(meta, JSON.stringify({ type, gz, at: Date.now(), status: 200 }));
    const old = mapIndex.get(h);
    if (old) mapTotal -= old.size;
    mapIndex.set(h, { size: body.length, at: Date.now() });
    mapTotal += body.length;
    pruneMap().catch(() => null);
    return { type, body, gz, status: 200 };
  })().finally(() => mapInflight.delete(h));
  mapInflight.set(h, job);
  return job;
}
async function apiMap(req, res, sub) {
  const p = decodeURIComponent(sub || '');
  if (!/^[a-zA-Z0-9_./,%@\- ]+$/.test(p) || p.indexOf('..') !== -1 || p.length > 300) return fail(req, res, 400, '잘못된 지도 경로');
  if (limited('map|' + clientIp(req), 1200, 60000)) return fail(req, res, 429, '요청이 너무 많음');
  try {
    const r = await mapGet(p);
    if (r.status === 404) return send(res, 404, { 'Cache-Control': 'public, max-age=86400' }, '');
    const h = { 'Content-Type': r.type, 'Cache-Control': isImmutable(p) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' };
    if (r.gz) {
      if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; return send(res, 200, h, r.body); }
      return send(res, 200, h, zlib.gunzipSync(r.body));
    }
    send(res, 200, h, r.body);
  } catch (e) {
    fail(req, res, 502, '지도 못 받음: ' + e.message, { 'Cache-Control': 'no-store' });
  }
}

/* ── 경로 주변 타일 미리 받기 ── */
//  일정 장소 주변(반경 1.2km)·이동 경로 주변(400m)은 z12~14, 30km 넘는 긴 구간은 z10~12, 날짜별 범위는 z9~11, 전체는 z5~8
function decodePoly(str) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    let b, shift = 0, r = 0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
    lat += (r & 1) ? ~(r >> 1) : (r >> 1);
    shift = 0; r = 0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
    lng += (r & 1) ? ~(r >> 1) : (r >> 1);
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
function addBox(set, s, w, n, e, z0, z1) {
  for (let z = z0; z <= z1; z++) {
    const lim = 2 ** z - 1;
    for (let x = Math.max(0, lon2x(w, z)); x <= Math.min(lim, lon2x(e, z)); x++)
      for (let y = Math.max(0, lat2y(n, z)); y <= Math.min(lim, lat2y(s, z)); y++) set.add(z + '/' + x + '/' + y);
  }
}
function addAround(set, lat, lng, m, z0, z1) {
  const dLat = m / 111320, dLng = m / (111320 * Math.cos(lat * Math.PI / 180));
  addBox(set, lat - dLat, lng - dLng, lat + dLat, lng + dLng, z0, z1);
}
function routeTiles(data) {
  const set = new Set();
  const pts = (data.points || []).filter(p => p.lat != null);
  if (!pts.length) return [];
  const bb = list => list.reduce((b, p) => [Math.min(b[0], p.lat), Math.min(b[1], p.lng), Math.max(b[2], p.lat), Math.max(b[3], p.lng)], [90, 180, -90, -180]);
  const all = bb(pts);
  addBox(set, all[0], all[1], all[2], all[3], 5, 8);
  (data.dates || []).forEach(d => {
    const dp = pts.filter(p => p.date === d);
    if (!dp.length) return;
    const b = bb(dp);
    addBox(set, b[0] - 0.02, b[1] - 0.02, b[2] + 0.02, b[3] + 0.02, 9, 11);
  });
  pts.forEach(p => {
    addAround(set, p.lat, p.lng, 1200, 12, 14);
    if (p.endLat != null) addAround(set, p.endLat, p.endLng, 800, 12, 14);
  });
  (data.segments || []).forEach(s => {
    let line = [];
    try {
      if (s.polyline) line = decodePoly(s.polyline);
      else if (Array.isArray(s.steps)) s.steps.forEach(st => { if (st.poly) line = line.concat(decodePoly(st.poly)); });
    } catch (e) { line = []; }
    // 긴 구간(야간버스·신칸센 등 30km 넘음)은 창밖 풍경까지 자세히 받을 필요 없어서 z10~12만
    const km = line.reduce((a, ll, i) => i ? a + Math.hypot((ll[0] - line[i - 1][0]) * 111, (ll[1] - line[i - 1][1]) * 91) : 0, 0);
    const long = km > 30;
    let last = null;
    line.forEach(ll => {
      if (last && Math.hypot((ll[0] - last[0]) * 111, (ll[1] - last[1]) * 91) < (long ? 2 : 0.3)) return;   // 300m(긴 구간 2km)마다
      last = ll;
      addAround(set, ll[0], ll[1], long ? 1500 : 400, long ? 10 : 12, long ? 12 : 14);
    });
  });
  return Array.from(set);
}
let prewarmSig = '', prewarming = false;
async function prewarm(reason) {
  if (prewarming || !cache.data) return;
  const tiles = routeTiles(cache.data);
  const sig = sha256(tiles.join(','));
  if (sig === prewarmSig) return;
  prewarming = true;
  try {
    // 현재 타일 주소 형식 (버전 들어간 planet 경로)
    const tj = await mapGet('planet');
    const tpl = JSON.parse((tj.gz ? zlib.gunzipSync(tj.body) : tj.body).toString('utf8')).tiles[0];
    const base = tpl.replace(OFM, '');
    let got = 0, had = 0, failN = 0, i = 0;
    const t0 = Date.now();
    async function worker() {
      while (i < tiles.length) {
        const [z, x, y] = tiles[i++].split('/');
        const p = base.replace('{z}', z).replace('{x}', x).replace('{y}', y);
        if (mapIndex.has(sha256(p))) { had++; continue; }
        try { await mapGet(p); got++; } catch (e) { failN++; if (mapUpstreamFails > 20) return; }
        await new Promise(r => setTimeout(r, 40));   // 원본 서버에 부담 안 주게 천천히
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    prewarmSig = failN ? '' : sig;
    log('지도 미리 받기', reason, '전체 ' + tiles.length + ' · 새로 ' + got + ' · 있음 ' + had + ' · 실패 ' + failN, Math.round((Date.now() - t0) / 1000) + 's');
  } catch (e) {
    log('지도 미리 받기 실패', e.message);
  } finally { prewarming = false; }
}

/* ── 출발 알림 ── */
let push = { subs: {}, sent: {} };   // subs: 엔드포인트 해시 → { sub, user, lead, at } / sent: 보낸 알림 키 → 시각
try { push = Object.assign(push, JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8'))); } catch (e) { /* 처음 */ }
let pushSaveTimer = null;
function savePush() {
  clearTimeout(pushSaveTimer);
  pushSaveTimer = setTimeout(() => {
    const tmp = PUSH_FILE + '.tmp';
    fsp.writeFile(tmp, JSON.stringify(push)).then(() => fsp.rename(tmp, PUSH_FILE)).catch(e => log('push 저장 실패', e.message));
  }, 300);
}
async function sendPush(id, payload) {
  const s = push.subs[id];
  if (!s) return;
  try {
    await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 600, urgency: 'high' });
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) { delete push.subs[id]; savePush(); log('만료된 구독 삭제', s.user); }
    else throw e;
  }
}
async function apiPush(req, res, action) {
  if (!PUSH_ON) return fail(req, res, 503, '서버에 알림 키(VAPID)가 설정 안 됨');
  if (action === 'key') return ok(req, res, { key: ENV.VAPID_PUBLIC_KEY });
  const ip = clientIp(req);
  if (limited('push|' + ip, 20, 60000)) return fail(req, res, 429, '요청이 너무 많음');
  const b = await readBody(req, 16 * 1024);
  if (action === 'subscribe') {
    const sub = b.sub;
    if (!sub || !/^https:\/\//.test(sub.endpoint || '') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return fail(req, res, 400, '구독 정보가 이상함');
    const user = String(b.user || '');
    const lock = pinLocked(ip, user);
    if (lock) return fail(req, res, 429, 'PIN 시도가 너무 많음. ' + lock + '분 뒤 다시');
    const bad = await checkUserPin(user, b.pin);
    if (bad == null) return fail(req, res, 503, '사용자 정보를 아직 못 받음. 잠시 뒤 다시');
    if (bad) { if (/PIN/.test(bad)) pinFailed(ip, user); return fail(req, res, 403, bad); }
    const lead = Math.min(60, Math.max(1, Number(b.lead) || 15));
    push.subs[sha256(sub.endpoint)] = { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, user, lead, at: Date.now() };
    savePush();
    log('알림 구독', user, lead + '분 전');
    return ok(req, res, true);
  }
  const id = sha256(String(b.endpoint || ''));
  if (action === 'unsubscribe') { delete push.subs[id]; savePush(); return ok(req, res, true); }
  if (action === 'test') {
    if (!push.subs[id]) return fail(req, res, 404, '구독 없음');
    await sendPush(id, { title: '여행 타임라인', body: '알림 잘 옴. 출발 ' + push.subs[id].lead + '분 전에 알려줌', tag: 'test' });
    return ok(req, res, true);
  }
  fail(req, res, 404, '없는 기능');
}

// 일정 시각(HH:MM, 25:10 같은 자정 넘김 포함) → 분
const toMin = s => { const m = String(s || '').match(/^(\d+):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
// 그 날짜 0시(여행 시간대)의 실제 시각(ms)
const dayStart = (date, tzMin) => Date.parse(date + 'T00:00:00Z') - tzMin * 60000;
// 화면 dayDelay와 같은 규칙: 그날 마지막 도착 기록 기준 지연(분)
function dayDelay(points, arrived, date) {
  let ref = null;
  points.filter(p => p.date === date).sort((a, b) => a.order - b.order).forEach(p => {
    const a = arrived[p.date + '#' + p.order], pm = toMin(p.arrive);
    if (!a || pm == null) return;
    let d = toMin(a) - pm;
    if (d < -720) d += 1440;
    if (d > 720) d -= 1440;
    ref = { order: p.order, delay: d };
  });
  return ref;
}
function placeName(data, p) {
  const pl = p.placeKey ? (data.places || []).find(x => x.key === p.placeKey) : null;
  return pl && pl.alias ? pl.alias : p.place;
}
async function pushTick() {
  const data = cache.data;
  if (!PUSH_ON || !data || !Object.keys(push.subs).length) return;
  const now = Date.now(), tz = data.tzOffsetMin != null ? data.tzOffsetMin : 540;
  for (const [id, s] of Object.entries(push.subs)) {
    const u = (data.users || []).find(x => x.id === s.user);
    if (!u) continue;
    const arrived = (data.arrivedBy && data.arrivedBy[s.user]) || {};
    const dates = (data.dates || []).filter(d => d >= u.from && d <= u.to);
    for (const date of dates) {
      const base = dayStart(date, tz);
      if (now < base - 86400000 || now > base + 2 * 86400000) continue;   // 오늘·내일 근처만
      const ref = dayDelay(data.points, arrived, date);
      for (const seg of (data.segments || []).filter(x => x.date === date)) {
        const from = data.points.find(p => p.date === date && p.order === seg.fromOrder);
        const to = data.points.find(p => p.date === date && p.order === seg.toOrder);
        if (!from || !to) continue;
        if (arrived[date + '#' + to.order]) continue;   // 이미 다음 장소 도착
        const dep = toMin(from.depart) != null ? toMin(from.depart) : toMin(seg.dep);
        if (dep == null) continue;
        const delay = ref && from.order >= ref.order ? ref.delay : 0;
        const at = base + (dep + delay) * 60000;
        const fireAt = at - s.lead * 60000;
        const key = id + '|' + date + '#' + from.order;
        if (now < fireAt || now > fireAt + 10 * 60000 || push.sent[key]) continue;
        push.sent[key] = now;
        savePush();
        const mode = seg.taxi && seg.taxi.on ? '택시' : seg.mode;
        const hm = m => Math.floor(m / 60) % 24 + ':' + String(m % 60).padStart(2, '0');
        const mins = Math.max(0, Math.round((at - now) / 60000));
        sendPush(id, {
          title: mins + '분 뒤 출발 · ' + placeName(data, to),
          body: placeName(data, from) + ' → ' + placeName(data, to) + ' · ' + (mode || '') + (seg.summary ? ' ' + seg.summary : '') +
            ' · ' + hm(dep + delay) + ' 출발' + (delay ? ' (지연 ' + (delay > 0 ? '+' : '') + delay + '분 반영)' : ''),
          tag: 'dep-' + date + '-' + from.order,
        }).then(() => log('출발 알림', s.user, date, from.order), e => log('알림 실패', s.user, e.statusCode || e.message));
      }
    }
  }
  // 할 일 알림: 할 일 시트의 날짜·시각(비우면 9:00)에, 그 사람(누구가 비면 모두) 구독으로. 끝낸 일은 안 보냄
  for (const t of (data.todos || [])) {
    if (t.done || !t.date) continue;
    const m = toMin(t.time);
    const at = dayStart(t.date, tz) + (m != null ? m : 540) * 60000;
    if (now < at || now > at + 10 * 60000) continue;
    for (const [id, s] of Object.entries(push.subs)) {
      if (t.who && t.who.length && t.who.indexOf(s.user) === -1) continue;
      const key = id + '|todo|' + t.key;
      if (push.sent[key]) continue;
      push.sent[key] = now;
      savePush();
      sendPush(id, { title: '할 일 · ' + t.text, body: t.memo || '오늘 할 일. 앱에서 끝냄 체크', tag: 'todo-' + t.key, url: '/v2/#today' })
        .then(() => log('할 일 알림', s.user, t.date, t.text), e => log('알림 실패', s.user, e.statusCode || e.message));
    }
  }

  // 3일 지난 기록 정리
  let pruned = false;
  for (const [k, t] of Object.entries(push.sent)) if (now - t > 3 * 86400000) { delete push.sent[k]; pruned = true; }
  if (pruned) savePush();
}

/* ── 주기 작업 ── */
// 구독이 있으면 2분마다(도착 기록 반영), 없으면 15분마다 데이터 갱신
let lastBg = 0;
setInterval(() => {
  const every = PUSH_ON && Object.keys(push.subs).length ? 120000 : 900000;
  if (Date.now() - Math.max(cache.at, lastBg) < every) return;
  lastBg = Date.now();
  refresh('주기').catch(e => log('주기 갱신 실패', e.message));
}, 30000).unref();
setInterval(() => pushTick().catch(e => log('알림 처리 오류', e.message)), 30000).unref();

async function apiLogin(req, res) {
  const ip = clientIp(req);
  const wait = limited('login|' + ip, 10, 600000);
  if (wait) return fail(req, res, 429, '시도가 너무 많음. ' + Math.ceil(wait / 60) + '분 뒤 다시');
  if (!ACCESS_CODE) return ok(req, res, true);
  const b = await readBody(req, 4096);
  const a = Buffer.from(sha256(String(b.code || '').trim())), w = Buffer.from(sha256(ACCESS_CODE));
  if (!crypto.timingSafeEqual(a, w)) { log('접속 코드 틀림', ip); return fail(req, res, 403, '접속 코드가 틀림'); }
  sendJSON(req, res, 200, { ok: true, result: true }, { 'Set-Cookie': sessionCookie() });
}
// 세션이 있어야 하는 주소 (지도 타일·healthz·hook·login은 제외)
const NEED_SESSION = /^\/api\/(data|events|call|photo|push\/(key|subscribe|unsubscribe|test))$/;

/* ── 서버 ── */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') return send(res, 200, { 'Content-Type': 'text/plain' }, 'ok\n');
    if (p === '/api/login' && req.method === 'POST') return await apiLogin(req, res);
    if (p === '/api/session' && req.method === 'GET') return ok(req, res, { need: !!ACCESS_CODE, ok: hasSession(req) });
    if (NEED_SESSION.test(p) && !hasSession(req)) return fail(req, res, 401, '접속 코드 필요');
    if (p === '/api/data' && req.method === 'GET') return await apiData(req, res);
    if (p === '/api/events' && req.method === 'GET') return apiEvents(req, res);
    if (p === '/api/call' && req.method === 'POST') return await apiCall(req, res);
    if (p === '/api/photo' && req.method === 'GET') return await apiPhoto(req, res, url.searchParams);
    if (p.indexOf('/api/map/ofm/') === 0 && req.method === 'GET') return await apiMap(req, res, p.slice('/api/map/ofm/'.length));
    if (p === '/api/hook/invalidate' && req.method === 'POST') {
      const k = String(req.headers['x-trip-key'] || '');
      if (k.length !== PROXY_KEY.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(PROXY_KEY))) return fail(req, res, 403, '키가 틀림');
      refreshSoon('시트 수정');
      return ok(req, res, true);
    }
    const m = p.match(/^\/api\/push\/(key|subscribe|unsubscribe|test)$/);
    if (m && (req.method === (m[1] === 'key' ? 'GET' : 'POST'))) return await apiPush(req, res, m[1]);
    fail(req, res, 404, '없는 주소');
  } catch (e) {
    log('오류', req.method, p, e.message);
    if (!res.headersSent) fail(req, res, e.status || 500, e.message);
  }
});
server.requestTimeout = 120000;
server.headersTimeout = 20000;

await scanPhotos().catch(e => log('사진 캐시 확인 실패', e.message));
await scanMap().catch(e => log('지도 캐시 확인 실패', e.message));
// 데이터가 바뀌면(경로 추가 등) 경로 주변 타일 다시 확인, 시작 1분 뒤 첫 실행
setTimeout(() => prewarm('시작'), Number(ENV.PREWARM_DELAY_SEC || 60) * 1000).unref();
setInterval(() => prewarm('주기'), 6 * 3600000).unref();
server.listen(PORT, () => log('trip-api 시작', PORT, PUSH_ON ? '알림 켜짐' : '알림 꺼짐 (VAPID 없음)'));
refresh('시작').catch(e => log('시작 갱신 실패 (첫 요청 때 다시)', e.message));
const stop = () => { log('종료'); for (const r of sse) r.end(); server.close(); clearTimeout(pushSaveTimer); try { fs.writeFileSync(PUSH_FILE, JSON.stringify(push)); } catch (e) { /* 무시 */ } process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
