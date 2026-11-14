// 기록 쓰기: 방문 도장, 실제 도착 시각, 실제 지출
//  누르면 바로 화면에 반영(ops에 넣음)하고 뒤에서 차례로 서버에 보냄. 연결이 안 되면 폰에 뒀다가 연결되면 보냄
//  PIN은 폰에만 두고(v1과 같은 키) 보낼 때 붙임. 대기열에는 PIN을 넣지 않음
import { batch } from '@preact/signals';
import { ops, raw, user, users, view, sendState, dialog, showToast, nt, stampFx } from './store.js';
import { call, ApiError } from './api.js';
import { kv, local } from './cache.js';
import { nextBatch, applyResult, failureKind, clockNow } from '../lib/ops.js';
import { vk, pname, isVisited, arrivedAt } from '../lib/trip.js';
import { tokyoNow } from '../lib/time.js';
import { YEN } from '../lib/money.js';

const OUTBOX_KEY = 'trip2-outbox-v1';
const MAX_TRIES = 8;   // 서버 오류가 이만큼 이어지면 그 기록은 버림 (연결이 없는 건 세지 않음)

export const getPin = id => local.get('trip-pin-' + id) || '';
export const setPin = (id, v) => local.set('trip-pin-' + id, v || null);

/** 지금 사용자가 기록을 남길 수 있는지 (보기 전용이 아닌지) */
export function canRecord() { const u = user.value; return !!(u && u.canStamp); }

/** PIN 확인. 맞으면 폰에 저장하고 true. 틀리면 서버 안내가 담긴 ApiError */
export async function verifyPin(id, pin) {
  await call('checkPin', [id, pin]);
  setPin(id, pin);
  return true;
}

/* ── 대기열 ── */
let seq = 0, busy = false, timer = 0;
const persist = () => kv.set(OUTBOX_KEY, JSON.stringify(ops.value));
function push(list) {
  const at = Date.now();
  ops.value = ops.value.concat(list.map(o => Object.assign({ id: at + '-' + (++seq), at, tries: 0 }, o)));
  persist();
  flush(true);
}
function later(ms) { clearTimeout(timer); timer = setTimeout(() => flush(), ms); }
const drop = ids => { const s = new Set(ids); ops.value = ops.value.filter(o => !s.has(o.id)); };

/**
 * 밀린 기록을 앞에서부터 차례로 보냄
 * @param ask 사용자가 방금 뭔가 눌러서 보내는 것인지. 그럴 때만 PIN 창을 띄움
 *            (뒤에서 알아서 다시 보낼 때는 창을 띄우지 않고 위쪽 줄에 "PIN 입력"만 보여줌: 닫은 창이 저절로 다시 뜨지 않게)
 */
export async function flush(ask) {
  if (busy || !ops.value.length) return;
  if (navigator.onLine === false) { sendState.value = 'waiting'; return; }
  busy = true;
  try {
    while (ops.value.length) {
      const b = nextBatch(ops.value);
      const u = users.value.find(x => x.id === b.user);
      if (u && u.hasPin && !getPin(b.user)) {
        sendState.value = 'pin';
        if (ask === true && !dialog.value) dialog.value = { kind: 'pin', id: b.user, error: '' };
        return;
      }
      sendState.value = 'sending';
      try {
        const result = await call(b.fn, b.args.concat([b.user, getPin(b.user)]));
        batch(() => {
          if (raw.value) raw.value = applyResult(raw.value, b.fn, b.user, result);
          drop(b.ids);
        });
        persist();
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        const kind = failureKind(status, e.message);
        if (kind === 'pin') {
          setPin(b.user, '');
          sendState.value = 'pin';
          if (ask === true) dialog.value = { kind: 'pin', id: b.user, error: 'PIN이 바뀐 것 같음. 다시 입력' };
          return;
        }
        const head = ops.value[0];
        if (kind === 'retry' && (status === 0 || (head && head.tries < MAX_TRIES))) {
          if (status !== 0 && head) { ops.value = [Object.assign({}, head, { tries: head.tries + 1 })].concat(ops.value.slice(1)); persist(); }
          sendState.value = 'waiting';
          later(status === 429 ? 30000 : 8000);
          return;
        }
        drop(b.ids);
        persist();
        showToast('기록 ' + b.ids.length + '건을 저장 못 함: ' + e.message);
      }
    }
    sendState.value = 'idle';
  } finally {
    busy = false;
  }
}

/** 앱을 켤 때: 지난번에 못 보낸 기록을 꺼내 이어서 보냄 */
export async function loadOutbox() {
  let saved = [];
  try { saved = JSON.parse((await kv.get(OUTBOX_KEY)) || '[]') || []; } catch (e) { saved = []; }
  if (Array.isArray(saved) && saved.length) ops.value = saved.concat(ops.value);
  flush();
}
addEventListener('online', () => flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
setInterval(() => flush(), 30000);

/* ── 기록 남기기 (화면에서 부르는 것). 전부 되돌리기 가능 ── */
const me = () => user.value.id;

/** 도장 찍기/지우기 */
export function toggleVisit(p) {
  if (!canRecord()) return;
  const key = vk(p), on = !isVisited(view.value, p), name = pname(view.value, p);
  push([{ kind: 'visit', user: me(), key, value: on ? 1 : 0 }]);
  if (on) stampFx.value = key;
  showToast(name + (on ? ' 도장 찍음' : ' 도장 지움'), { label: '되돌리기', fn: () => push([{ kind: 'visit', user: me(), key, value: on ? 0 : 1 }]) });
}

/** "도착 기록": 지금 시각으로 도착을 적고, 아직이면 도장도 같이 */
export function recordArrivalNow(p) {
  if (!canRecord()) return;
  const v = view.value, key = vk(p), t = clockNow(tokyoNow());
  const prev = arrivedAt(v, p) || '', had = isVisited(v, p);
  const list = [{ kind: 'arrive', user: me(), key, value: t }];
  if (!had) list.unshift({ kind: 'visit', user: me(), key, value: 1 });
  push(list);
  if (!had) stampFx.value = key;
  showToast(pname(v, p) + ' 도착 ' + t + ' 기록' + (had ? '' : ', 도장 찍음'), {
    label: '되돌리기',
    fn: () => push([{ kind: 'arrive', user: me(), key, value: prev }].concat(had ? [] : [{ kind: 'visit', user: me(), key, value: 0 }])),
  });
  nt.value = tokyoNow();   // 지연 예측이 바로 다시 계산되게
}

/** 한 장소의 도장을 모두 지움 (같은 장소를 여러 번 들렀으면 다) */
export function clearStamps(points, name) {
  if (!canRecord()) return;
  const keys = points.filter(p => isVisited(view.value, p)).map(vk);
  if (!keys.length) return;
  push(keys.map(key => ({ kind: 'visit', user: me(), key, value: 0 })));
  showToast(name + ' 도장 지움', { label: '되돌리기', fn: () => push(keys.map(key => ({ kind: 'visit', user: me(), key, value: 1 }))) });
}

/** 도착 시각 고치기 ("HH:MM") 또는 지우기 ('') */
export function saveArrival(p, hhmm) {
  if (!canRecord()) return;
  const v = view.value, key = vk(p), prev = arrivedAt(v, p) || '';
  if (prev === (hhmm || '')) return;
  push([{ kind: 'arrive', user: me(), key, value: hhmm || '' }]);
  showToast(pname(v, p) + (hhmm ? ' 도착 시각 ' + hhmm + ' 저장' : ' 도착 기록 지움'), { label: '되돌리기', fn: () => push([{ kind: 'arrive', user: me(), key, value: prev }]) });
}

/** 실제 지출 저장 (amount 숫자) 또는 지우기 (amount null) */
export function saveSpend(p, amount, memo) {
  if (!canRecord()) return;
  const v = view.value, key = vk(p), place = pname(v, p);
  const prev = v.spend[key] ? { amount: v.spend[key].amount, memo: v.spend[key].memo || '' } : null;
  const value = amount == null ? null : { amount: Number(amount), memo: memo || '' };
  push([{ kind: 'spend', user: me(), key, place, value }]);
  showToast(place + (value ? ' 지출 ' + YEN(value.amount) + ' 저장' : ' 지출 기록 지움'), { label: '되돌리기', fn: () => push([{ kind: 'spend', user: me(), key, place, value: prev }]) });
}
