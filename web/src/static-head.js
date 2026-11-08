/* 홈랩 정적 페이지 전용 (Apps Script 웹앱에는 안 들어감). build.mjs가 App_Core보다 먼저 끼워 넣음
 *  TRIP_STORE: 일정 데이터 저장소 (IndexedDB, localStorage 5MB 한계 없음) */
(function () {
  'use strict';
  /* ── IndexedDB 키-값 저장소 ── */
  const DB_NAME = 'trip-timeline', STORE = 'kv';
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
  if (window.indexedDB) {
    window.TRIP_STORE = {
      // 예전(localStorage)에 저장된 게 있으면 한 번 옮기고 지움
      get(key) {
        return tx('readonly', s => s.get(key)).then(v => {
          if (v != null) return v;
          let old = null;
          try { old = localStorage.getItem(key); } catch (e) { old = null; }
          if (old == null) return null;
          return this.set(key, old).then(() => { try { localStorage.removeItem(key); } catch (e) { /* 무시 */ } return old; }, () => old);
        });
      },
      set(key, val) { return tx('readwrite', s => s.put(val, key)).catch(() => null); },
    };
  }
})();
