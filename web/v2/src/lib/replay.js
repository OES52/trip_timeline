// 하루 리플레이 (순수 로직): 그날 머묾·이동을 시간 순 사건으로 만들고, 재생 위치(u)마다 점 위치·시각을 계산
//  재생 길이 배분: 이동은 제곱근으로 눌러서 짧은 이동도 보이고 긴 이동은 덜 길게, 머묾은 1/4로 압축(최대 30)
//  시계는 실제 일정 시각 그대로
import { toMin } from './time.js';
import { haversine } from './geo.js';
import { dayPoints, pname, segModeName } from './trip.js';
import { decodePolyline, arcPoints } from './route.js';

const hasEnd = p => p.endLat != null && p.endLng != null;
const outLL = p => (hasEnd(p) ? [p.endLat, p.endLng] : [p.lat, p.lng]);

/** 이동 구간 좌표: 단계 모양들 → 구간 선 → 휜 선 */
function segCoords(s, from, to) {
  let ll = [];
  if (s && Array.isArray(s.steps) && s.steps.some(x => x.poly) && !(s.taxi && s.taxi.on)) s.steps.forEach(x => { if (x.poly) ll = ll.concat(decodePolyline(x.poly)); });
  if (ll.length < 2 && s && s.polyline) ll = decodePolyline(s.polyline);
  if (ll.length < 2) ll = arcPoints(outLL(from), [to.lat, to.lng]);
  return ll;
}

/** @returns {{ ev: object[], total: number }} 좌표·시각이 없으면 ev가 빔 */
export function buildReplay(v, date) {
  const pts = dayPoints(v, date).filter(p => p.lat != null && p.lng != null);
  const ev = [];
  pts.forEach((p, i) => {
    const a = toMin(p.arrive), d = toMin(p.depart);
    if (a != null) ev.push({ type: 'stay', p, a, d: d != null && d >= a ? d : a });
    const nx = pts[i + 1];
    if (!nx) return;
    const dep = toMin(p.depart), arr = toMin(nx.arrive);
    if (dep == null || arr == null) return;
    const s = v.segments.find(x => x.date === date && x.fromOrder === p.order && x.toOrder === nx.order) || null;
    const coords = segCoords(s, p, nx);
    const cum = [0];
    for (let k = 1; k < coords.length; k++) cum.push(cum[k - 1] + haversine(coords[k - 1], coords[k]));
    ev.push({ type: 'move', s, from: p, to: nx, a: dep, d: Math.max(dep, arr), coords, cum, total: cum[cum.length - 1] || 1 });
  });
  let u = 0;
  ev.forEach(e => {
    const m = Math.max(1, e.d - e.a);
    e.u0 = u;
    e.len = e.type === 'move' ? 6 * Math.sqrt(m) : Math.max(0.5, Math.min(30, m * 0.25));
    u += e.len;
  });
  return { ev, total: u };
}

function along(e, f) {
  const dist = f * e.total;
  let k = 1;
  while (k < e.cum.length - 1 && e.cum[k] < dist) k++;
  const s0 = e.cum[k - 1], s1 = e.cum[k] || s0 + 1;
  const t = Math.max(0, Math.min(1, (dist - s0) / (s1 - s0)));
  const a = e.coords[k - 1], b = e.coords[k] || a;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * 재생 위치 u에서의 모습
 * @returns {{ pos:[lat,lng], clock:number(분), label:string, ev, i:number }}
 */
export function frameAt(v, R, u) {
  let i = R.ev.findIndex(x => u >= x.u0 && u < x.u0 + x.len);
  if (i < 0) i = R.ev.length - 1;
  const e = R.ev[i];
  const f = Math.max(0, Math.min(1, (u - e.u0) / e.len));
  const clock = e.a + f * (e.d - e.a);
  if (e.type === 'stay') {
    const p = e.p;
    const pos = hasEnd(p) ? [p.lat + (p.endLat - p.lat) * f, p.lng + (p.endLng - p.lng) * f] : [p.lat, p.lng];
    return { pos, clock, label: pname(v, p) + (p.activity ? ' · ' + p.activity : ''), ev: e, i };
  }
  return { pos: along(e, f), clock, label: (e.s ? segModeName(e.s) : '이동') + ' → ' + pname(v, e.to), ev: e, i };
}

/** u까지 지나온 길 (다시 그리기용) [lat,lng][] */
export function trailUntil(v, R, u) {
  const out = [];
  R.ev.forEach(x => {
    if (x.u0 > u) return;
    const f = Math.min(1, (u - x.u0) / x.len);
    if (x.type === 'move') x.coords.forEach((c, k) => { if (x.cum[k] <= f * x.total) out.push(c); });
    else out.push([x.p.lat, x.p.lng]);
  });
  out.push(frameAt(v, R, Math.min(u, R.total - 1e-6)).pos);
  return out;
}
