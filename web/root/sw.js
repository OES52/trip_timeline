/* 사이트 루트(/)에 예전 화면(v1)이 있던 시절의 서비스 워커를 걷어내는 서비스 워커
 *  예전 화면은 /v1/, 새 화면은 /v2/ 로 옮겼고, / 는 /v2/ 로 넘어감
 *  폰에 남은 예전 루트 서비스 워커가 저장본 v1 화면을 계속 보여주지 않게:
 *   설치 즉시 활성화 → 예전 앱 셸 저장소(trip-shell-*)만 지움 → 스스로 등록 해제 → 열려 있던 화면을 새로 열게 함
 *  사진(trip-photos-v1)·지도(trip2-map)·v1(trip1-shell-*)·v2(trip2-assets) 저장소는 그대로 둠 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => /^trip-shell-/.test(k)).map(k => caches.delete(k)));
    await self.registration.unregister();
    const list = await self.clients.matchAll({ type: 'window' });
    await Promise.all(list.map(c => (c.navigate ? c.navigate(c.url).catch(() => null) : null)));
  })());
});
