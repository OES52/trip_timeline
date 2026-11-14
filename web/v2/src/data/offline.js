// 오프라인: 서비스 워커 등록, 저장 공간, "오프라인 준비"(지도·사진 미리 받기)
import { signal } from '@preact/signals';
import { view } from './store.js';
import { tripTiles, glyphPaths } from '../lib/tiles.js';
import { photoUrl } from '../lib/geo.js';

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

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/v2/sw.js', { scope: '/v2/' })
    .then(() => navigator.serviceWorker.ready)
    .then(() => { appSaved.value = true; })
    .catch(() => { appSaved.value = false; });
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
  const photos = Array.from(new Set(v.allPlaces.flatMap(pl => pl.photos || []))).map(photoUrl);
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
