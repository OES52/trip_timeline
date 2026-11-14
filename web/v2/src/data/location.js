// 내 위치 (앱이 열려 있을 때만) + 도착 자동 제안
import { signal, effect, untracked } from '@preact/signals';
import { view, user, userId, nt } from './store.js';
import { local } from './cache.js';
import { arrivalCandidate, dwell } from '../lib/geofence.js';
import { tripClock } from '../lib/trip.js';
import { tokyoNow } from '../lib/time.js';

const ASK_KEY = 'trip-geo-ask';            // v1과 같은 키: '1'이면 근처 오면 도착 물어봄 (기본 꺼짐)
const askedKey = id => 'trip-geo-asked-' + (id || '');   // v1과 같은 키: 이미 물어본 곳

/** 최근 위치 { lat, lng, acc, heading, speed, t } 또는 null */
export const pos = signal(null);
/** 'off' 안 봄 / 'on' 보는 중 / 'denied' 권한 막힘 / 'none' 기기가 못 함 */
export const geoState = signal('geolocation' in navigator ? 'off' : 'none');
/** 근처 오면 도착 찍을지 묻기 */
export const askOn = signal(local.get(ASK_KEY) === '1');
/** 지금 묻고 있는 장소 키 ("날짜#순서") 또는 null */
export const arriveAsk = signal(null);

let watch = null;
export function startGeo() {
  if (watch != null || !('geolocation' in navigator)) return;
  watch = navigator.geolocation.watchPosition(p => {
    const c = p.coords;
    pos.value = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, heading: c.heading, speed: c.speed, t: Date.now() };
    geoState.value = 'on';
    check();
  }, err => {
    if (watch != null) navigator.geolocation.clearWatch(watch);
    watch = null;
    geoState.value = err.code === 1 ? 'denied' : 'off';
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  geoState.value = 'on';
}
export function stopGeo() {
  if (watch != null) navigator.geolocation.clearWatch(watch);
  watch = null;
  pos.value = null;
  geoState.value = 'off';
  arriveAsk.value = null;
}

export function setAskOn(on) {
  askOn.value = on;
  local.set(ASK_KEY, on ? '1' : '0');
  if (on) startGeo();
  else arriveAsk.value = null;
}

function asked() { try { return JSON.parse(local.get(askedKey(userId.value)) || '{}'); } catch (e) { return {}; } }
/** "도착"이든 "아님"이든 한 번 답한 곳은 다시 안 물음 */
export function answerAsk() {
  const k = arriveAsk.value;
  if (!k) return;
  const a = asked(); a[k] = 1;
  local.set(askedKey(userId.value), JSON.stringify(a));
  arriveAsk.value = null;
}

let stay = null;
function check() {
  const v = view.value, u = user.value;
  if (!askOn.value || !v || !u || !u.canStamp || arriveAsk.value) return;
  const r = dwell(stay, arrivalCandidate(v, pos.value, tripClock(v, tokyoNow()), asked()), Date.now());
  stay = r.state;
  if (r.ask) {
    arriveAsk.value = r.ask;
    if (navigator.vibrate) navigator.vibrate(60);
  }
}
// 1분 머무름은 위치가 안 바뀌어도(가만히 서 있으면 새 위치가 잘 안 옴) 시각으로 확인
effect(() => { nt.value; untracked(() => { if (pos.value) check(); }); });
setInterval(() => { if (pos.value && askOn.value) check(); }, 20000);
// 사용자가 바뀌면 묻던 것 취소
effect(() => { userId.value; arriveAsk.value = null; stay = null; });

/** 이미 위치를 허용한 기기면 열자마자 켬 (권한 창은 안 뜸) */
export function resumeGeo() {
  if (!navigator.permissions || !navigator.permissions.query) return;
  navigator.permissions.query({ name: 'geolocation' }).then(p => {
    if (p.state === 'granted') startGeo();
    else if (p.state === 'denied') geoState.value = 'denied';
  }).catch(() => null);
}
