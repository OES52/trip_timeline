/* 예전 화면(v1)을 걷어낸 뒤 /v1/ 에 남은 서비스 워커를 걷어내는 서비스 워커
 *  예전 화면은 사이트에서 뺐고 /v1/ 은 새 화면(/v2/)으로 넘어감 (nginx.conf)
 *  폰에 남은 v1 서비스 워커가 저장본 v1 화면을 계속 보여주지 않게:
 *   설치 즉시 활성화 → v1 앱 셸 저장소(trip1-shell-*)만 지움 → 스스로 등록 해제 → 열려 있던 화면을 새로 열게 함(→ /v2/)
 *  사진(trip-photos-v1)·지도(trip2-map)·v2(trip2-assets) 저장소는 그대로 둠 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => /^trip1-shell-/.test(k)).map(k => caches.delete(k)));
    await self.registration.unregister();
    const list = await self.clients.matchAll({ type: 'window' });
    await Promise.all(list.map(c => (c.navigate ? c.navigate('/v2/').catch(() => null) : null)));
  })());
});
