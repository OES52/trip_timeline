// 거리·길찾기

/** 두 좌표 [lat, lng] 사이 직선거리(m) */
export function haversine(a, b) {
  const R = 6371000, rad = d => d * Math.PI / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 850 → "850m", 1234 → "1.2km", 12345 → "12km" */
export function fmtDist(m) {
  return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + 'km' : Math.round(m) + 'm';
}

/** 직선거리 → 걸어서 약 몇 분 (우회 1.3배, 분속 80m) */
export function walkMin(m) { return Math.max(1, Math.round(m * 1.3 / 80)); }

/** 구글 지도 길찾기 주소 */
export function navUrl(lat, lng, mode) {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=' + (mode || 'transit');
}

/** 장소 사진 주소: https 사진은 프록시(/api/photo)를 거쳐 받음 (캐시됨, 오프라인에서도 보임) */
/** 사진 폭: 목록 썸네일 / 카드·시트 (화면 폭 × 화면 배율 정도). 서버가 이 폭의 webp로 줄여 줌 */
export const PHOTO_THUMB = 160, PHOTO_FULL = 960;
export function photoUrl(u, w) {
  return /^https:\/\//i.test(u || '') ? '/api/photo?u=' + encodeURIComponent(u) + (w ? '&w=' + w : '') : u;
}
