// 지도에 그릴 것 계산: 구간 선(GeoJSON), 핀 묶음, 범위. 지도 라이브러리와 무관한 순수 로직
import { dayPoints, isVisited, vk, segRides, MODE_KEY, FAR_M, mainOrders, placeOf, passThrough, innerPath } from './trip.js';
import { lineColor, cityColor } from './colors.js';
import { haversine, bearing } from './geo.js';

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
 *  - 날짜를 넘는 이동(밤버스 등)은 떠나는 날과 도착하는 날 둘 다 그림
 *  선마다 properties: a·b = 구간 양 끝의 이날 순서 (다른 날 쪽 끝은 -1), fit = 지도를 처음 맞출 때 넣을지 (먼 이동·날짜 넘는 이동은 0),
 *   lane = 같은 방향으로 겹칠 때 비킬 차선 (assignLanes가 채움)
 * @param states stopStates() 결과 (지난 구간을 흐리게 하려고). 없어도 됨
 * @param opt.incoming false면 전날에서 넘어오는 이동은 안 그림 (여행 전체 보기에서 두 번 그리지 않게)
 * @returns {{ features: object[], planes: number[][] }}  planes = [lat, lng] 목록
 */
export function dayLines(v, date, states, opt = {}) {
  const pts = dayPoints(v, date);
  const features = [], planes = [];
  const add = (seg, inbound) => {
    const over = !!seg.toDate;
    const from = (over ? dayPoints(v, seg.date) : pts).find(p => p.order === seg.fromOrder);
    const to = (over ? dayPoints(v, seg.toDate) : pts).find(p => p.order === seg.toOrder);
    // 지난 구간: 떠난 곳이 지났으면. 넘어오는 밤버스는 도착하고 나면
    const state = states && states.get(inbound ? seg.toOrder : seg.fromOrder);
    const past = state === 'past' || (inbound && state === 'now') ? 1 : 0;
    const far = from && to && from.lat != null && to.lat != null && haversine([from.lat, from.lng], [to.lat, to.lng]) > FAR_M;
    const base = { a: inbound ? -1 : seg.fromOrder, b: over && !inbound ? -1 : seg.toOrder, fit: over || far ? 0 : 1, past, lane: 0, seg: seg.date + '#' + seg.fromOrder };
    const taxi = seg.taxi && seg.taxi.on;
    const k = taxi ? 'car' : MODE_KEY[seg.mode] || 'manual';
    const steps = Array.isArray(seg.steps) ? seg.steps.filter(st => st.poly) : [];
    if (steps.length && !taxi) {
      steps.forEach(st => {
        const ll = decodePolyline(st.poly);
        if (ll.length < 2) return;
        const ride = st.t === 'transit';
        features.push(toLine(ll, Object.assign({ color: ride ? (st.color || lineColor(st.line + ' ' + (st.full || '')) || MODE_HEX.transit) : MODE_HEX.walk, dash: ride ? 0 : 1 }, base)));
      });
      return;
    }
    let ll = seg.polyline ? decodePolyline(seg.polyline) : [];
    let dash = k === 'walk' || k === 'manual' ? 1 : 0;
    if (ll.length < 2) {
      if (!from || !to || from.lat == null || to.lat == null) return;
      const a = [from.lat, from.lng], b = [to.lat, to.lng];
      ll = arcPoints(a, b);
      dash = 1;
      if (haversine(a, b) > 300000) planes.push(ll[Math.floor(ll.length / 2)]);
    }
    const ride = k === 'transit' ? segRides(seg)[0] : null;
    features.push(toLine(ll, Object.assign({ color: (ride && ride.color) || MODE_HEX[k], dash }, base)));
  };
  v.segments.filter(s => s.date === date).forEach(s => add(s, false));
  v.overnight.filter(s => s.date === date).forEach(s => add(s, false));
  if (opt.incoming !== false) v.overnight.filter(s => s.toDate === date).forEach(s => add(s, true));
  return { features, planes };
}

/** 선을 step(m)마다 쪼갠 점들 { pts: { lat, lng, dir }[], gap: 실제 간격(m) }. 아주 긴 선은 점이 1500개를 넘지 않게 간격을 늘림 */
function sampleLine(ll, step) {
  let total = 0;
  for (let k = 1; k < ll.length; k++) total += haversine(ll[k - 1], ll[k]);
  const gap = Math.max(step, total / 1500);
  const pts = [];
  for (let k = 1; k < ll.length; k++) {
    const a = ll[k - 1], b = ll[k], d = haversine(a, b);
    if (!d) continue;
    const dir = bearing(a, b), n = Math.max(1, Math.ceil(d / gap));
    for (let t = 0; t < n; t++) pts.push({ lat: a[0] + (b[0] - a[0]) * t / n, lng: a[1] + (b[1] - a[1]) * t / n, dir });
  }
  return { pts, gap };
}
const turn = (x, y) => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };

/** 같은 방향으로 겹칠 때 비키는 차선은 2칸까지 (더 비키면 길에서 떨어져 보임). 그 이상은 고른 장소 강조로 구분 */
export const MAX_LANE = 2;

/**
 * 같은 방향으로 겹치는 선에 차선 번호(properties.lane)를 매김 (그리는 순서대로, 나중 선이 비킴)
 *  지도는 모든 선을 진행 방향 왼쪽으로 조금 비켜 그려서, 왕복(반대 방향)은 차선 없이도 저절로 두 줄이 됨
 *  겹침 = 앞서 그린 다른 구간 선과 12m 안·방향 45° 안으로 50m 넘게 같이 감 (같은 구간 안 단계끼리는 이어지는 길이라 안 셈)
 *  차선 = 겹친 선들이 안 쓰는 가장 안쪽 칸 (MAX_LANE까지)
 * @param features toLine() 선들 (properties.seg = 구간 이름). 그 자리에서 lane을 고침
 */
export function assignLanes(features) {
  const CELL = 0.00016;   // 격자 한 칸 (위도 약 18m, 경도 약 15m). 이웃 칸까지 보면 12m 안은 다 찾음
  const grid = new Map();
  const cell = (i, j) => i + ':' + j;
  features.forEach(f => {
    const { pts, gap } = sampleLine(f.geometry.coordinates.map(c => [c[1], c[0]]), 10);
    const seg = f.properties.seg;
    const shared = new Map();   // 차선 → 같이 가는 점 수
    pts.forEach(s => {
      const ci = Math.floor(s.lat / CELL), cj = Math.floor(s.lng / CELL);
      const seen = new Set();
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          (grid.get(cell(ci + di, cj + dj)) || []).forEach(o => {
            if ((seg != null && o.seg === seg) || seen.has(o.lane)) return;
            if (turn(o.dir, s.dir) <= 45 && haversine([o.lat, o.lng], [s.lat, s.lng]) <= 12) seen.add(o.lane);
          });
        }
      }
      seen.forEach(l => shared.set(l, (shared.get(l) || 0) + 1));
    });
    const busy = new Set(Array.from(shared).filter(([, n]) => n * gap >= 50).map(([l]) => l));
    let lane = 0;
    while (busy.has(lane) && lane < MAX_LANE) lane++;
    f.properties.lane = lane;
    pts.forEach(s => {
      const k = cell(Math.floor(s.lat / CELL), Math.floor(s.lng / CELL));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ lat: s.lat, lng: s.lng, dir: s.dir, lane, seg });
    });
  });
  return features;
}

/**
 * 장소 안 길 (시작 → 경유1 → 경유2 → 종착, 빈 곳은 건너뜀). 서버가 준 도보 모양(inner.poly)이 있으면 그 길, 없으면 지점을 잇는 직선
 * @returns object[] properties: a·b = 그 장소 순서, fit = 1, past, color = 도시색
 */
export function innerLines(v, date, states) {
  return dayPoints(v, date).filter(passThrough).map(p => {
    const shape = p.inner && p.inner.poly ? decodePolyline(p.inner.poly) : [];
    const ll = shape.length >= 2 ? shape : innerPath(p);
    const pl = placeOf(v, p);
    const past = states && states.get(p.order) === 'past' ? 1 : 0;
    return toLine(ll, { a: p.order, b: p.order, fit: 1, past, color: cityColor(pl && pl.city) || MODE_HEX.walk });
  });
}

/**
 * 지도를 처음 맞출 좌표 [[lat, lng], ...]: 그날 주로 다니는 곳(mainOrders)의 핀과 그 사이 선만
 *  비행기·밤버스 같은 먼 이동은 선만 그리고 맞춤엔 안 넣음 (선이 화면 밖으로 이어짐). 남는 게 없으면 전부
 * @param groups pinGroups() 결과  @param features dayLines().features
 */
export function fitCoords(v, date, groups, features) {
  const main = mainOrders(v, date);
  const ll = f => f.geometry.coordinates.map(c => [c[1], c[0]]);
  const pins = groups.filter(g => g.points.some(p => main.has(p.order))).map(g => [g.lat, g.lng]);
  const lines = features.filter(f => f.properties.fit && main.has(f.properties.a) && main.has(f.properties.b)).flatMap(ll);
  const out = pins.concat(lines);
  return out.length ? out : groups.map(g => [g.lat, g.lng]).concat(features.flatMap(ll));
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
