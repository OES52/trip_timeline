// 오프라인 준비: 일정 주변 지도 타일 목록 계산 (순수 로직)
//  지도 자료(OpenFreeMap 벡터 타일)는 z14까지 있고, 그보다 확대하면 z14를 늘려 씀
import { decodePolyline } from './route.js';

export const MAX_Z = 14;

/** 경위도 → 타일 번호 */
export function tileOf(lat, lng, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/** 범위 [[서, 남], [동, 북]] 안의 타일 */
function bboxTiles(b, z, out) {
  const [x0, y1] = tileOf(b[0][1], b[0][0], z);
  const [x1, y0] = tileOf(b[1][1], b[1][0], z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.add(z + '/' + x + '/' + y);
}

/** 한 점 둘레 r미터 안의 타일 */
function aroundTiles(lat, lng, r, z, out) {
  const dLat = r / 111320, dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
  bboxTiles([[lng - dLng, lat - dLat], [lng + dLng, lat + dLat]], z, out);
}

function bboxOf(pts, pad) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  pts.forEach(([la, ln]) => { if (la < s) s = la; if (la > n) n = la; if (ln < w) w = ln; if (ln > e) e = ln; });
  return isFinite(w) ? [[w - pad, s - pad], [e + pad, n + pad]] : null;
}

/**
 * 받을 타일 "z/x/y" 목록
 *  - 여행 전체 범위 + 사방 1도: z5~9 (한국 쪽 출발지가 끼면 아주 넓어져서 일본 쪽 점만으로 범위를 잡음)
 *  - 날마다 그날 범위: z10~12
 *  - 장소마다 둘레: z13은 1.2km, z14는 500m (z14 타일은 도심에서 하나에 수백 KB라 좁게)
 *  - 이동 경로 위 400m 간격: z13
 * @param v 화면용 보기 (buildView 결과)
 */
export function tripTiles(v) {
  const out = new Set();
  const pts = v.points.filter(p => p.lat != null && p.lng != null);
  const jp = pts.filter(p => p.lng > 128.5);   // 대한해협 동쪽 = 일본
  const all = bboxOf((jp.length ? jp : pts).map(p => [p.lat, p.lng]), 1);   // 1도 여유: 멀리서 볼 때 화면 가장자리까지
  if (all) for (let z = 5; z <= 9; z++) bboxTiles(all, z, out);
  v.dates.forEach(d => {
    const dp = pts.filter(p => p.date === d && (!jp.length || p.lng > 128.5));
    const b = bboxOf(dp.map(p => [p.lat, p.lng]), 0.01);
    if (b) for (let z = 10; z <= 12; z++) bboxTiles(b, z, out);
  });
  pts.forEach(p => { aroundTiles(p.lat, p.lng, 1200, 13, out); aroundTiles(p.lat, p.lng, 500, MAX_Z, out); });
  v.segments.concat(v.overnight || []).forEach(s => {
    const lines = Array.isArray(s.steps) && s.steps.some(x => x.poly) ? s.steps.map(x => x.poly).filter(Boolean) : s.polyline ? [s.polyline] : [];
    lines.forEach(code => {
      const ll = decodePolyline(code);
      let last = null;
      ll.forEach(q => {
        if (last && Math.abs(q[0] - last[0]) < 0.0036 && Math.abs(q[1] - last[1]) < 0.0044) return;   // 약 400m
        last = q;
        const [x, y] = tileOf(q[0], q[1], 13);
        out.add('13/' + x + '/' + y);
      });
    });
  });
  return Array.from(out);
}

/** 지도에 라틴 글자 라벨을 그리는 데 드는 글꼴 조각 (한글·한자·가나는 기기 글꼴로 그려서 안 받음) */
export function glyphPaths(fonts) {
  const ranges = ['0-255', '256-511', '512-767', '7680-7935', '8192-8447', '12288-12543', '65280-65535'];
  const out = [];
  fonts.forEach(f => ranges.forEach(r => out.push('fonts/' + encodeURIComponent(f) + '/' + r + '.pbf')));
  return out;
}
