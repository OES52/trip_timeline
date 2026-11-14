// 오프라인: 서비스 워커 등록, 저장 공간, "오프라인 준비"(지도·사진 미리 받기)
import { signal } from '@preact/signals';
import { view, dialog } from './store.js';
import { tripTiles, glyphPaths } from '../lib/tiles.js';
import { photoUrl, PHOTO_THUMB, PHOTO_FULL } from '../lib/geo.js';

const OFM = '/api/map/ofm/';
const MAP_CACHE = 'trip2-map', PHOTO_CACHE = 'trip-photos-v1';
const FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];
const TILE_KB = 120;   // 실제 일정 주변 타일로 잰 평균

/** 앱 화면이 폰에 저장돼서 인터넷 없이 열리는지 */
export const appSaved = signal(false);
/** 저장 공간 { usage, quota, persisted } */
export const storage = signal(null);
/** 진행 중인 미리 받기 { done, total, fail, stop } 또는 null */
export const prep = signal(null);
/** 지난번 확인한 미리 받은 개수 { map, mapAll, photo, photoAll } */
export const prepared = signal(null);

/** 새 버전을 받아 둠 (열려 있는 화면은 아직 예전 코드). 다시 열면 새 버전 */
export const updateReady = signal(false);

let swReg = null, checkedAt = Date.now(), hiddenAt = 0;
const CHECK_EVERY = 30 * 60000;   // 앱으로 돌아올 때 새 버전 확인 간격
const AWAY_RELOAD = 60000;        // 이만큼 넘게 나가 있다 돌아오면 새 버전으로 바로 다시 엶

/**
 * 지금 열린 화면이 새 서비스 워커보다 예전 코드인지: 새 미리 저장 목록(sw.js가 활성화 때 적어 둠)에 지금 앱 파일이 없으면 예전
 *  배포 직후 처음 여는 화면은 이미 새 코드를 받아서 열리는데 서비스 워커도 그때 바뀌므로, 그땐 알리지 않게
 *  판단할 수 없으면(개발 서버 등) false
 */
async function runningOld() {
  try {
    const el = document.querySelector('script[type="module"][src*="/assets/"]');
    if (!el) return false;
    const me = new URL(el.src).pathname;
    const m = await (await caches.open('trip2-assets')).match('/v2/__precache.json');
    if (!m) return false;
    const list = await m.json();
    return Array.isArray(list) && list.indexOf(me) === -1;
  } catch (e) {
    return false;
  }
}

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // 처음 설치될 때도 controllerchange가 오므로, 원래 서비스 워커가 있던 화면에서만, 그리고 지금 코드가 정말 예전일 때만 "새 버전"
  const hadController = !!navigator.serviceWorker.controller;
  // controllerchange는 새 서비스 워커가 활성화를 "시작"할 때 옴 (sw.js가 새 목록을 적기 전). 활성화가 끝난 뒤에 비교
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const sw = navigator.serviceWorker.controller;
    const check = () => runningOld().then(old => { if (old) updateReady.value = true; });
    if (!sw || sw.state === 'activated') { check(); return; }
    sw.addEventListener('statechange', function on() {
      if (sw.state !== 'activated' && sw.state !== 'redundant') return;
      sw.removeEventListener('statechange', on);
      check();
    });
  });
  navigator.serviceWorker.register('/v2/sw.js', { scope: '/v2/' })
    .then(reg => { swReg = reg; return navigator.serviceWorker.ready; })
    .then(() => { appSaved.value = true; })
    .catch(() => { appSaved.value = false; });
  // 홈 화면 앱은 며칠씩 안 닫혀서 브라우저가 새 버전을 잘 안 찾음 → 앱으로 돌아올 때 직접 확인
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    // 받아 둔 새 버전이 있고 한동안 나가 있었으면, 입력 중인 창이 없을 때 바로 새 버전으로 (보던 탭·날짜는 주소에 있음)
    if (updateReady.value && hiddenAt && Date.now() - hiddenAt > AWAY_RELOAD && !dialog.value) { location.reload(); return; }
    if (swReg && Date.now() - checkedAt > CHECK_EVERY) { checkedAt = Date.now(); swReg.update().catch(() => null); }
  });
}

export async function readStorage() {
  if (!navigator.storage || !navigator.storage.estimate) { storage.value = { usage: null, quota: null, persisted: false }; return; }
  const [e, p] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false]);
  storage.value = { usage: e.usage || 0, quota: e.quota || 0, persisted: !!p };
}

/** 브라우저가 저장 공간을 마음대로 비우지 않게 요청 (홈 화면 앱이면 대개 허락됨) */
export async function askPersist() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* 무시 */ }
  readStorage();
}

/** 받을 것 목록: 지도(스타일·아이콘·글꼴·타일)와 장소 사진 */
async function plan() {
  const v = view.value;
  const map = ['styles/liberty', 'styles/dark', 'planet',
    'sprites/ofm_f384/ofm.json', 'sprites/ofm_f384/ofm.png', 'sprites/ofm_f384/ofm@2x.json', 'sprites/ofm_f384/ofm@2x.png']
    .concat(glyphPaths(FONTS)).map(p => OFM + p);
  let tpl = null;
  try {
    // 타일 주소는 지도 자료 버전이 들어간 틀이라 tilejson에서 받아 옴 (서비스 워커가 저장해 둔 것과 같은 버전)
    const tj = await (await fetch(OFM + 'planet')).json();
    tpl = String(tj.tiles[0]).replace('https://tiles.openfreemap.org/', OFM);
  } catch (e) { tpl = null; }
  const tiles = tpl ? tripTiles(v).map(t => { const [z, x, y] = t.split('/'); return tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y); }) : [];
  // 화면이 쓰는 그대로: 첫 장은 목록 썸네일과 카드, 나머지는 장소 시트
  const photos = Array.from(new Set(v.allPlaces.flatMap(pl => (pl.photos || []).flatMap((u, i) => (i === 0 ? [photoUrl(u, PHOTO_THUMB), photoUrl(u, PHOTO_FULL)] : [photoUrl(u, PHOTO_FULL)])))
    .concat((v.bookings || []).flatMap(b => (b.images || []).map(u => photoUrl(u))))));   // 예약 티켓 그림은 원본 (QR이 뭉개지지 않게)
  return { map: map.concat(tiles), photos, tileCount: tiles.length, tplOk: !!tpl };
}

/** 이미 받아 둔 것 세기 (화면에 "n / m" 표시용) */
export async function countPrepared() {
  if (!('caches' in window) || !view.value) return;
  const p = await plan();
  const [mc, pc] = await Promise.all([caches.open(MAP_CACHE), caches.open(PHOTO_CACHE)]);
  let map = 0, photo = 0;
  for (const u of p.map) if (await mc.match(u)) map++;
  for (const u of p.photos) if (await pc.match(u)) photo++;
  prepared.value = { map, mapAll: p.map.length, photo, photoAll: p.photos.length, estMB: Math.round((p.tileCount * TILE_KB) / 1024) };
}

/** 미리 받기 시작. 이미 받은 건 건너뜀. 서비스 워커가 받아 가며 저장함 */
export async function runPrep() {
  if (prep.value) return;
  askPersist();
  const p = await plan();
  const mc = await caches.open(MAP_CACHE), pc = await caches.open(PHOTO_CACHE);
  const jobs = p.map.map(u => [u, mc]).concat(p.photos.map(u => [u, pc]));
  const st = { done: 0, total: jobs.length, fail: 0, stop: false };
  prep.value = Object.assign({}, st);
  let i = 0;
  const worker = async () => {
    while (i < jobs.length && !st.stop) {
      const [u, c] = jobs[i++];
      try {
        if (!(await c.match(u))) {
          const r = await fetch(u);
          if (!r.ok) st.fail++;
          else if (!navigator.serviceWorker || !navigator.serviceWorker.controller) await c.put(u, r);   // 서비스 워커가 아직 없으면 직접 저장
        }
      } catch (e) { st.fail++; }
      st.done++;
      if (st.done % 5 === 0 || st.done === st.total) prep.value = Object.assign({}, st);
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  const result = { stopped: st.stop, fail: st.fail };
  prep.value = null;
  await Promise.all([countPrepared(), readStorage()]);
  return result;
}

export function stopPrep() {
  if (prep.value) prep.value = Object.assign(prep.value, { stop: true });
}
