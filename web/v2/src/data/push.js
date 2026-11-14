// 출발 알림 (웹 푸시). 서버가 일정·도착 기록을 보고 출발 n분 전에 보냄 (api/server.mjs pushTick)
//  구독은 v2 서비스 워커(/v2/) 것. 예전 화면(v1)에서 켠 구독과는 따로임
import { signal } from '@preact/signals';
import { user } from './store.js';
import { local } from './cache.js';
import { getPin } from './records.js';

const KEY = 'trip2-push';   // { user, lead, endpoint }

/**
 * 'none' 이 기기·브라우저는 못 함 / 'install' 아이폰: 홈 화면에 추가해서 열어야 함
 * 'denied' 알림 권한 막힘 / 'off' 꺼짐 / 'on' 켜짐 / 'nokey' 서버에 알림 키 없음
 */
export const pushState = signal('off');
/** 켜져 있으면 { user, lead } */
export const pushInfo = signal(null);

const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const can = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function reg() {
  const r = await navigator.serviceWorker.getRegistration('/v2/');
  return r || navigator.serviceWorker.ready;
}

async function post(path, body) {
  let r;
  try { r = await fetch('/api' + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch (e) { throw new Error('서버에 연결 안 됨'); }
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  if (!j || !j.ok) throw Object.assign(new Error((j && j.error) || '서버 오류 ' + r.status), { status: r.status });
  return j.result;
}

function b64ToU8(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

/** 지금 상태 다시 읽기 (시트를 열 때) */
export async function readPush() {
  if (!can()) { pushState.value = ios && !standalone() ? 'install' : 'none'; return; }
  if (Notification.permission === 'denied') { pushState.value = 'denied'; return; }
  let saved = null;
  try { saved = JSON.parse(local.get(KEY) || 'null'); } catch (e) { saved = null; }
  try {
    const sub = await (await reg()).pushManager.getSubscription();
    if (sub && saved && saved.endpoint === sub.endpoint) { pushInfo.value = { user: saved.user, lead: saved.lead }; pushState.value = 'on'; return; }
  } catch (e) { /* 서비스 워커 없음 */ }
  pushInfo.value = null;
  pushState.value = 'off';
}

/** 켜기 또는 몇 분 전인지 바꾸기. 권한 요청은 누른 직후 바로 해야 아이폰이 받아 줌 */
export async function pushOn(lead) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { pushState.value = perm === 'denied' ? 'denied' : 'off'; throw new Error('알림 권한을 허용해야 켜짐'); }
  let key;
  try {
    const r = await fetch('/api/push/key', { credentials: 'same-origin' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    key = j.result.key;
  } catch (e) { pushState.value = 'nokey'; throw new Error('서버에 알림 설정이 없음'); }
  const r = await reg();
  let sub = await r.pushManager.getSubscription();
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
  const u = user.value;
  await post('/push/subscribe', { sub: sub.toJSON(), user: u.id, pin: getPin(u.id), lead });
  local.set(KEY, JSON.stringify({ user: u.id, lead, endpoint: sub.endpoint }));
  pushInfo.value = { user: u.id, lead };
  pushState.value = 'on';
}

export async function pushOff() {
  try {
    const sub = await (await reg()).pushManager.getSubscription();
    if (sub) {
      await post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => null);
      await sub.unsubscribe().catch(() => null);
    }
  } finally {
    local.set(KEY, null);
    pushInfo.value = null;
    pushState.value = 'off';
  }
}

export async function pushTest() {
  const sub = await (await reg()).pushManager.getSubscription();
  if (!sub) { await readPush(); throw new Error('구독이 없어짐. 다시 켜기'); }
  await post('/push/test', { endpoint: sub.endpoint });
}
