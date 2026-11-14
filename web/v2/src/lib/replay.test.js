import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from './trip.js';
import { buildReplay, frameAt, trailUntil } from './replay.js';

const raw = () => ({
  dates: ['2026-12-25'], places: [],
  points: [
    { date: '2026-12-25', order: 1, place: 'A', arrive: '9:00', depart: '10:00', lat: 34.60, lng: 135.50 },
    { date: '2026-12-25', order: 2, place: 'B', arrive: '10:16', depart: '11:00', lat: 34.70, lng: 135.50, activity: '관광' },
    { date: '2026-12-25', order: 3, place: 'C', arrive: '', depart: '', lat: null, lng: null },
  ],
  segments: [{ date: '2026-12-25', fromOrder: 1, toOrder: 2, mode: '도보', minutes: 16 }],
  overnight: [], users: [], visitedBy: {}, arrivedBy: {}, spend: {},
});

test('buildReplay: 머묾·이동·머묾, 좌표 없는 곳 빠짐, 길이 배분', () => {
  const v = buildView(raw(), null);
  const R = buildReplay(v, '2026-12-25');
  assert.deepEqual(R.ev.map(e => e.type), ['stay', 'move', 'stay']);
  assert.equal(R.ev[0].len, 15);                // 60분 × 1/4
  assert.equal(R.ev[1].len, 6 * Math.sqrt(16));  // 24
  assert.equal(R.ev[2].len, 11);
  assert.equal(R.total, 50);
});

test('frameAt: 시각은 실제 일정 시각, 이동 중엔 선 위', () => {
  const v = buildView(raw(), null);
  const R = buildReplay(v, '2026-12-25');
  let f = frameAt(v, R, 0);
  assert.equal(f.clock, 540);
  assert.deepEqual(f.pos, [34.60, 135.50]);
  f = frameAt(v, R, 15 + 12);   // 이동 한가운데
  assert.equal(f.clock, 608);
  assert.ok(f.pos[0] > 34.62 && f.pos[0] < 34.68);
  assert.match(f.label, /도보 → B/);
  f = frameAt(v, R, R.total);
  assert.equal(f.label, 'B · 관광');
  assert.equal(f.clock, 660);
});

test('trailUntil: 지나온 점만', () => {
  const v = buildView(raw(), null);
  const R = buildReplay(v, '2026-12-25');
  assert.equal(trailUntil(v, R, 1).length, 2);
  assert.ok(trailUntil(v, R, 30).length > 3);
});
