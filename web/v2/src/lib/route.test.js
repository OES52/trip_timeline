import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, arcPoints, dayLines, pinGroups, pinState, boundsOf, fitCoords, assignLanes, innerLines, MODE_HEX } from './route.js';
import { buildView, stopStates } from './trip.js';

test('decodePolyline: 구글 문서의 예시 값', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  assert.deepEqual(decodePolyline(''), []);
});

test('arcPoints: 양 끝은 그대로, 가운데는 휨', () => {
  const a = [34.7, 135.5], b = [35.0, 135.8];
  const arc = arcPoints(a, b, 10);
  assert.equal(arc.length, 11);
  assert.deepEqual(arc[0], a);
  assert.ok(Math.abs(arc[10][0] - b[0]) < 1e-9 && Math.abs(arc[10][1] - b[1]) < 1e-9);
  assert.notEqual(arc[5][0], (a[0] + b[0]) / 2);
});

const raw = () => ({
  dates: ['2026-12-25'], places: [], weather: {}, walk: {}, users: [], visitedBy: {}, arrivedBy: {}, spend: {}, overnight: [],
  points: [
    { placeKey: 'A', date: '2026-12-25', order: 1, place: '인천공항', arrive: '4:20', depart: '7:00', lat: 37.45, lng: 126.44 },
    { placeKey: 'B', date: '2026-12-25', order: 2, place: '간사이 공항', arrive: '9:30', depart: '10:20', lat: 34.43, lng: 135.24 },
    { placeKey: 'C', date: '2026-12-25', order: 3, place: '난바역', arrive: '11:15', depart: '11:20', lat: 34.6665, lng: 135.5005 },
    { placeKey: 'D', date: '2026-12-25', order: 4, place: '호텔', arrive: '11:30', depart: '12:00', lat: 34.668, lng: 135.502 },
    { placeKey: 'C', date: '2026-12-25', order: 5, place: '난바역', arrive: '12:10', depart: '12:15', lat: 34.6665, lng: 135.5005 },
  ],
  segments: [
    { date: '2026-12-25', fromOrder: 1, toOrder: 2, mode: '수동', minutes: 150 },   // 선 모양 없음 → 비행기 호
    { date: '2026-12-25', fromOrder: 2, toOrder: 3, mode: '대중교통', minutes: 45, steps: [
      { t: 'walk', min: 5, poly: '_p~iF~ps|U_ulLnnqC' },
      { t: 'transit', line: '난카이 본선', color: '', min: 40, poly: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
    ] },
    { date: '2026-12-25', fromOrder: 3, toOrder: 4, mode: '도보', minutes: 8, polyline: '_p~iF~ps|U_ulLnnqC' },
  ],
});

test('dayLines: 단계마다 노선 색, 도보는 점선, 모양 없으면 호 + 비행기', () => {
  const v = buildView(raw(), null);
  const states = stopStates(v, '2026-12-25', { date: '2026-12-25', min: 11 * 60 });
  const { features, planes } = dayLines(v, '2026-12-25', states);
  assert.equal(features.length, 4);
  assert.deepEqual(features.map(f => f.properties.dash), [1, 1, 0, 1]);
  assert.equal(features[0].properties.color, MODE_HEX.manual);
  assert.equal(features[1].properties.color, MODE_HEX.walk);
  assert.equal(features[2].properties.color, '#ff6a13');   // 난카이: 이름으로 찾은 노선 색
  assert.deepEqual(features.map(f => f.properties.past), [1, 1, 1, 0]);
  assert.equal(planes.length, 1);
  assert.deepEqual(features[3].geometry.coordinates[0], [-120.2, 38.5]);   // GeoJSON은 [경도, 위도]
  assert.deepEqual(dayLines(v, '2026-12-25').features.map(f => f.properties.past), [0, 0, 0, 0]);
});

test('pinGroups·pinState: 같은 장소는 핀 하나에 번호 여러 개', () => {
  const v = buildView(raw(), null);
  const g = pinGroups(v, '2026-12-25');
  assert.deepEqual(g.map(x => x.label), ['1', '2', '3·5', '4']);
  assert.deepEqual(g[2].keys, ['2026-12-25#3', '2026-12-25#5']);
  const states = stopStates(v, '2026-12-25', { date: '2026-12-25', min: 11 * 60 + 40 });
  assert.deepEqual(g.map(x => pinState(v, x, states)), ['past', 'past', 'next', 'now']);
});

// 인천 → (비행기) → 간사이·난바, 12/27 밤버스 → 12/28 신주쿠·요코하마
const farRaw = () => ({
  dates: ['2026-12-25', '2026-12-27', '2026-12-28'], places: [], weather: {}, walk: {}, users: [], visitedBy: {}, arrivedBy: {}, spend: {},
  points: [
    { placeKey: 'U', date: '2026-12-25', order: 1, arrive: '4:00', depart: '4:00', lat: 37.493, lng: 126.493 },
    { placeKey: 'I', date: '2026-12-25', order: 2, arrive: '4:20', depart: '6:35', lat: 37.449, lng: 126.451 },
    { placeKey: 'K', date: '2026-12-25', order: 3, arrive: '9:05', depart: '10:05', lat: 34.432, lng: 135.230 },
    { placeKey: 'N', date: '2026-12-25', order: 4, arrive: '11:00', depart: '11:05', lat: 34.666, lng: 135.500 },
    { placeKey: 'B', date: '2026-12-27', order: 1, arrive: '20:50', depart: '31:00', lat: 34.705, lng: 135.491 },
    { placeKey: 'S', date: '2026-12-28', order: 1, arrive: '7:40', depart: '7:50', lat: 35.689, lng: 139.701 },
    { placeKey: 'Y', date: '2026-12-28', order: 2, arrive: '8:40', depart: '9:00', lat: 35.466, lng: 139.622 },
  ],
  segments: [
    { date: '2026-12-25', fromOrder: 1, toOrder: 2, mode: '수동', minutes: 20 },
    { date: '2026-12-25', fromOrder: 2, toOrder: 3, mode: '수동', minutes: 150 },   // 비행기
    { date: '2026-12-25', fromOrder: 3, toOrder: 4, mode: '수동', minutes: 55 },
    { date: '2026-12-28', fromOrder: 1, toOrder: 2, mode: '수동', minutes: 50 },
  ],
  overnight: [{ date: '2026-12-27', toDate: '2026-12-28', fromOrder: 1, toOrder: 1, mode: '수동', minutes: 0 }],
});

test('dayLines: 밤버스는 떠나는 날·도착하는 날 둘 다, 먼 이동은 맞춤 제외 표시', () => {
  const v = buildView(farRaw(), null);
  const d25 = dayLines(v, '2026-12-25');
  assert.deepEqual(d25.features.map(f => f.properties.fit), [1, 0, 1]);   // 비행기만 0
  assert.equal(d25.planes.length, 1);
  assert.deepEqual(dayLines(v, '2026-12-27').features.map(f => f.properties.fit), [0]);
  const d28 = dayLines(v, '2026-12-28');
  assert.equal(d28.features.length, 2);
  const inc = d28.features[1];
  assert.equal(inc.properties.fit, 0);
  assert.deepEqual(inc.geometry.coordinates[0], [135.491, 34.705]);   // 오사카에서 출발
  assert.equal(dayLines(v, '2026-12-28', null, { incoming: false }).features.length, 1);
  // 다른 날 쪽 끝은 -1 (그날 같은 순서 장소를 골라도 밤버스가 같이 강조되지 않게)
  assert.deepEqual([inc.properties.a, inc.properties.b], [-1, 1]);
  const out = dayLines(v, '2026-12-27').features[0];
  assert.deepEqual([out.properties.a, out.properties.b], [1, -1]);
  // 넘어오는 밤버스는 도착하고 나서야 흐리게
  const at = min => dayLines(v, '2026-12-28', stopStates(v, '2026-12-28', { date: '2026-12-28', min })).features[1].properties.past;
  assert.equal(at(7 * 60), 0);
  assert.equal(at(7 * 60 + 45), 1);
});

test('fitCoords: 처음 맞춤은 그날 주로 다니는 곳만 (인천·밤버스 반대편 빼고)', () => {
  const v = buildView(farRaw(), null);
  const fc = d => fitCoords(v, d, pinGroups(v, d), dayLines(v, d).features);
  const c25 = fc('2026-12-25');
  assert.ok(c25.every(c => c[1] > 135 && c[0] < 35));   // 간사이·난바 쪽만
  assert.ok(c25.some(c => c[0] === 34.432 && c[1] === 135.230));
  assert.deepEqual(fc('2026-12-27'), [[34.705, 135.491]]);
  assert.ok(fc('2026-12-28').every(c => c[1] > 139));   // 오사카에서 오는 선은 빼고 도쿄·요코하마만
});

// 동서로 뻗은 길 (약 275m)
const line = (pts) => ({ type: 'Feature', properties: { lane: 0 }, geometry: { type: 'LineString', coordinates: pts.map(p => [p[1], p[0]]) } });
const W = [34.6650, 135.5000], E = [34.6650, 135.5030];

test('assignLanes: 같은 방향으로 겹치면 차선 하나씩, 반대 방향·옆 길은 그대로', () => {
  const f = [
    line([W, E]),                                         // 동쪽으로
    line([W, E]),                                         // 같은 길 같은 방향 → 1
    line([E, W]),                                         // 반대 방향 → 0 (왼쪽으로 비켜 그리면 저절로 갈라짐)
    line([[34.6656, 135.5000], [34.6656, 135.5030]]),     // 북쪽 60m 옆 길 → 0
    line([[34.66501, 135.5005], [34.66501, 135.5025]]),   // 앞의 두 선과 또 겹침 → 2
  ];
  assert.deepEqual(assignLanes(f).map(x => x.properties.lane), [0, 1, 0, 0, 2]);
  assert.deepEqual(assignLanes([line([W, E]), line([[34.6650, 135.5029], [34.6680, 135.5029]])]).map(x => x.properties.lane), [0, 0]);   // 끝에서 꺾여 나가면 안 겹침
  // 차선은 2칸까지
  assert.deepEqual(assignLanes([line([W, E]), line([W, E]), line([W, E]), line([W, E])]).map(x => x.properties.lane), [0, 1, 2, 2]);
  // 같은 구간 안 단계끼리는 이어지는 길이라 안 비킴
  const s1 = line([W, E]), s2 = line([W, E]);
  s1.properties.seg = s2.properties.seg = '2026-12-26#3';
  assert.deepEqual(assignLanes([s1, s2]).map(x => x.properties.lane), [0, 0]);
  // 50m 안 되게 스치면 안 비킴
  assert.deepEqual(assignLanes([line([W, E]), line([[34.6650, 135.5026], [34.6650, 135.5030]])]).map(x => x.properties.lane), [0, 0]);
});

test('innerLines: 관통하는 장소는 들어간 곳→나오는 곳 선 (모양 있으면 그 길)', () => {
  const v = buildView({
    dates: ['2026-12-26'], weather: {}, walk: {}, users: [], visitedBy: {}, arrivedBy: {}, spend: {}, segments: [], overnight: [],
    places: [{ key: 'K', name: '구로몬시장', type: '관광지', city: '오사카' }],
    points: [
      { placeKey: 'K', date: '2026-12-26', order: 5, arrive: '11:50', depart: '12:20', lat: 34.6665, lng: 135.5065, endLat: 34.6625, endLng: 135.5065 },
      { placeKey: '', date: '2026-12-26', order: 6, arrive: '13:00', depart: '13:30', lat: 34.67, lng: 135.50, endLat: 34.67, endLng: 135.50 },   // 종착점이 시작점과 같으면 관통 아님
    ],
  }, null);
  const [f] = innerLines(v, '2026-12-26');
  assert.equal(innerLines(v, '2026-12-26').length, 1);
  assert.deepEqual(f.geometry.coordinates, [[135.5065, 34.6665], [135.5065, 34.6625]]);
  assert.deepEqual([f.properties.a, f.properties.b, f.properties.fit], [5, 5, 1]);
  assert.equal(f.properties.color, '#f76b15');   // 오사카 도시색
  v.points[0].inner = { min: 6, m: 450, est: false, poly: '_p~iF~ps|U_ulLnnqC' };
  assert.deepEqual(innerLines(v, '2026-12-26')[0].geometry.coordinates, [[-120.2, 38.5], [-120.95, 40.7]]);
  // 경유점: 도보 모양이 없으면 시작 → 경유 → 시작(종착점 없음) 직선
  v.points[0].inner = null;
  v.points[1].via = [[34.68, 135.51]];
  const lines = innerLines(v, '2026-12-26');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[1].geometry.coordinates, [[135.50, 34.67], [135.51, 34.68], [135.50, 34.67]]);
});

test('boundsOf', () => {
  assert.deepEqual(boundsOf([[34, 135], [35, 136], [34.5, 134]]), [[134, 34], [136, 35]]);
  assert.equal(boundsOf([]), null);
});
