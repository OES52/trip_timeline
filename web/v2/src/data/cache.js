// 폰에 저장해 두는 마지막 일정 (오프라인·빠른 시작용)
//  v1과 같은 IndexedDB(trip-timeline / kv), 같은 키·형식을 써서 두 버전이 저장본을 같이 씀
const DB_NAME = 'trip-timeline', STORE = 'kv';
const CACHE_KEY = 'trip-timeline-cache-v1';

let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbP;
}
function tx(mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const rq = fn(t.objectStore(STORE));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = t.onabort = () => rej(t.error);
  }));
}

/** 폰 저장소에 글자 값 하나 넣고 꺼내기. 저장소를 못 쓰면 조용히 넘어감 */
export const kv = {
  async get(key) { try { return await tx('readonly', s => s.get(key)); } catch (e) { return null; } },
  async set(key, value) { try { await tx('readwrite', s => s.put(value, key)); } catch (e) { /* 저장 공간 없으면 무시 */ } },
};

/** @returns {Promise<{savedAt:string, data:object}|null>} */
export async function readCache() {
  try {
    const raw = await tx('readonly', s => s.get(CACHE_KEY));
    const j = JSON.parse(raw || 'null');
    return j && j.data ? j : null;
  } catch (e) { return null; }
}

export async function writeCache(data) {
  const d = new Date();
  const savedAt = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  try { await tx('readwrite', s => s.put(JSON.stringify({ savedAt, data }), CACHE_KEY)); } catch (e) { /* 저장 공간 없으면 무시 */ }
  return savedAt;
}

/* 작은 설정값은 localStorage (v1과 같은 키) */
export const local = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 무시 */ } },
};
