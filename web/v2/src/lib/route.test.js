import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, arcPoints, dayLines, pinGroups, pinState, boundsOf, MODE_HEX } from './route.js';
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

test('boundsOf', () => {
  assert.deepEqual(boundsOf([[34, 135], [35, 136], [34.5, 134]]), [[134, 34], [136, 35]]);
  assert.equal(boundsOf([]), null);
});
