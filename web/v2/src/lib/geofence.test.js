import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from './trip.js';
import { arrivalCandidate, dwell } from './geofence.js';

const raw = () => ({
  dates: ['2026-12-25'], places: [],
  points: [
    { date: '2026-12-25', order: 1, place: '숙소', arrive: '8:00', depart: '9:00', lat: 34.6700, lng: 135.5000 },
    { date: '2026-12-25', order: 2, place: '성', arrive: '10:00', depart: '11:00', lat: 34.6873, lng: 135.5262 },
    { date: '2026-12-25', order: 3, place: '숙소', arrive: '21:00', depart: '21:00', lat: 34.6700, lng: 135.5000 },
  ],
  segments: [], overnight: [], users: [{ id: 'A', from: '2026-12-25', to: '2026-12-25' }],
  visitedBy: { A: {} }, arrivedBy: { A: {} }, spend: {},
});
const nt = min => ({ date: '2026-12-25', min });
const castle = { lat: 34.6875, lng: 135.5263, acc: 20 };
const hotel = { lat: 34.6701, lng: 135.5001, acc: 20 };

test('근처 + 시간대 안이면 그 장소', () => {
  const v = buildView(raw(), raw().users[0]);
  assert.equal(arrivalCandidate(v, castle, nt(600)).p.order, 2);
  assert.equal(arrivalCandidate(v, castle, nt(600 - 120)).p.order, 2);
  assert.equal(arrivalCandidate(v, castle, nt(600 - 121)), null);
  assert.equal(arrivalCandidate(v, castle, nt(600 + 91)), null);
});

test('정확도 나쁘거나 멀면 없음', () => {
  const v = buildView(raw(), raw().users[0]);
  assert.equal(arrivalCandidate(v, { ...castle, acc: 61 }, nt(600)), null);
  assert.equal(arrivalCandidate(v, { lat: 34.6900, lng: 135.5262, acc: 10 }, nt(600)), null);   // 300m
});

test('아침 숙소에선 저녁 숙소 도착을 안 물음, 이미 기록했거나 넘긴 곳 제외', () => {
  const r = raw();
  const v = buildView(r, r.users[0]);
  assert.equal(arrivalCandidate(v, hotel, nt(8 * 60 + 10)).p.order, 1);
  assert.equal(arrivalCandidate(v, hotel, nt(8 * 60 + 10), { '2026-12-25#1': 1 }), null);
  r.arrivedBy.A['2026-12-25#1'] = '8:05';
  assert.equal(arrivalCandidate(buildView(r, r.users[0]), hotel, nt(8 * 60 + 10)), null);
  assert.equal(arrivalCandidate(v, hotel, nt(20 * 60 + 30)).p.order, 3);
});

test('지연 예측 반영: 늦으면 시간대도 밀림', () => {
  const r = raw();
  r.arrivedBy.A['2026-12-25#1'] = '10:00';   // 2시간 늦음 → 성은 12:00 예상
  const v = buildView(r, r.users[0]);
  assert.equal(arrivalCandidate(v, castle, nt(13 * 60 + 20)).p.order, 2);
});

test('dwell: 1분 넘게 같은 곳이어야 물음', () => {
  const v = buildView(raw(), raw().users[0]);
  const c = arrivalCandidate(v, castle, nt(600));
  let s = dwell(null, c, 0);
  assert.equal(s.ask, null);
  s = dwell(s.state, c, 59000); assert.equal(s.ask, null);
  s = dwell(s.state, c, 60000); assert.equal(s.ask, '2026-12-25#2');
  assert.deepEqual(dwell(s.state, null, 70000), { state: null, ask: null });
});
