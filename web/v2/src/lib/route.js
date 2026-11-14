// 지도에 그릴 것 계산: 구간 선(GeoJSON), 핀 묶음, 범위. 지도 라이브러리와 무관한 순수 로직
import { dayPoints, isVisited, vk, segRides, MODE_KEY } from './trip.js';
import { lineColor } from './colors.js';
import { haversine } from './geo.js';

// 지도 위 선 색 (GL은 CSS 변수를 못 읽어서 값으로)
export const MODE_HEX = { transit: '#2B62D9', walk: '#13945F', car: '#E2731B', manual: '#7A8597' };

/** 구글 인코딩 polyline → [[lat, lng], ...] */
export function decodePolyline(str) {
  const out = [];
  const s = String(str || '');
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let b, shift = 0, r = 0;
    do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i <= s.length);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < s.length) {
    lat += next();
    lng += next();
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

/** 경로 모양이 없는 구간은 직선 대신 살짝 휜 선. 300km 넘으면(비행기) 크게 휨 */
export function arcPoints(a, b, n = 48) {
  const bend = haversine(a, b) > 300000 ? 0.22 : 0.12;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const c = [(a[0] + b[0]) / 2 - dy * bend, (a[1] + b[1]) / 2 + dx * bend];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

const toLine = (pts, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: pts.map(p => [p[1], p[0]]) } });

/**
 * 하루치 구간 선
 *  - 대중교통 단계마다 그 노선 색 실선, 걷는 단계는 초록 점선
 *  - 단계 모양이 없으면 구간 전체 선을 이동 방식 색으로
 *  - 선 모양이 아예 없으면 휜 점선, 아주 멀면(비행기) 가운데에 비행기 표시
 * @param states stopStates() 결과 (지난 구간을 흐리게 하려고). 없어도 됨
 * @returns {{ features: object[], planes: number[][] }}  planes = [lat, lng] 목록
 */
export function dayLines(v, date, states) {
  const pts = dayPoints(v, date);
  const features = [], planes = [];
  const add = seg => {
    const from = pts.find(p => p.order === seg.fromOrder);
    const past = states && states.get(seg.fromOrder) === 'past' ? 1 : 0;
    const taxi = seg.taxi && seg.taxi.on;
    const k = taxi ? 'car' : MODE_KEY[seg.mode] || 'manual';
    const steps = Array.isArray(seg.steps) ? seg.steps.filter(st => st.poly) : [];
    if (steps.length && !taxi) {
      steps.forEach(st => {
        const ll = decodePolyline(st.poly);
        if (ll.length < 2) return;
        const ride = st.t === 'transit';
        features.push(toLine(ll, { color: ride ? (st.color || lineColor(st.line + ' ' + (st.full || '')) || MODE_HEX.transit) : MODE_HEX.walk, dash: ride ? 0 : 1, past }));
      });
      return;
    }
    let ll = seg.polyline ? decodePolyline(seg.polyline) : [];
    let dash = k === 'walk' || k === 'manual' ? 1 : 0;
    if (ll.length < 2) {
      const to = (seg.toDate ? dayPoints(v, seg.toDate) : pts).find(p => p.order === seg.toOrder);
      if (!from || !to || from.lat == null || to.lat == null) return;
      const a = [from.lat, from.lng], b = [to.lat, to.lng];
      ll = arcPoints(a, b);
      dash = 1;
      if (haversine(a, b) > 300000) planes.push(ll[Math.floor(ll.length / 2)]);
    }
    const ride = k === 'transit' ? segRides(seg)[0] : null;
    features.push(toLine(ll, { color: (ride && ride.color) || MODE_HEX[k], dash, past }));
  };
  v.segments.filter(s => s.date === date).forEach(add);
  v.overnight.filter(s => s.date === date).forEach(add);
  return { features, planes };
}

/**
 * 핀 묶음: 하루 안에 같은 장소를 여러 번 들르면 핀 하나에 번호를 "3·15"처럼 같이 적음
 *  같은 장소 = 장소 키가 같거나 30m 이내
 * @returns {{ lat:number, lng:number, points:object[], keys:string[], label:string }[]}
 */
export function pinGroups(v, date) {
  const groups = [];
  dayPoints(v, date).forEach(p => {
    if (p.lat == null || p.lng == null) return;
    const g = groups.find(x => (x.points[0].placeKey && x.points[0].placeKey === p.placeKey) || haversine([x.lat, x.lng], [p.lat, p.lng]) <= 30);
    if (g) g.points.push(p); else groups.push({ lat: p.lat, lng: p.lng, points: [p] });
  });
  groups.forEach(g => { g.keys = g.points.map(vk); g.label = g.points.map(p => p.order).join('·'); });
  return groups;
}

/** 핀 묶음의 상태: 'now' > 'next' > 'done'(전부 도장) > 'past'(전부 지남) > 'future' */
export function pinState(v, g, states) {
  const st = g.points.map(p => states.get(p.order) || 'future');
  if (st.includes('now')) return 'now';
  if (st.includes('next')) return 'next';
  if (g.points.every(p => isVisited(v, p))) return 'done';
  if (st.every(s => s === 'past')) return 'past';
  return 'future';
}

/** 좌표들의 범위 [[서, 남], [동, 북]]. 점이 없으면 null */
export function boundsOf(latlngs) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  latlngs.forEach(p => { if (p[0] < s) s = p[0]; if (p[0] > n) n = p[0]; if (p[1] < w) w = p[1]; if (p[1] > e) e = p[1]; });
  return isFinite(w) ? [[w, s], [e, n]] : null;
}
