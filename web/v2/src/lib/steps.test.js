import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepNow, stepRows } from './steps.js';

// 숙소 → 신사이바시(도보) → 미도스지선 → 요도야바시 → 게이한 본선 → 후시미이나리 → 도보
const seg = {
  mode: '대중교통',
  steps: [
    { t: 'walk', min: 8 },
    { t: 'transit', line: '미도스지선', from: '신사이바시', to: '요도야바시', dep: '11:50', arr: '11:53', head: '센리추오' },
    { t: 'walk', min: 3 },
    { t: 'transit', line: '게이한 본선', from: '요도야바시', to: '후시미이나리', dep: '12:00', arr: '12:48', head: '데마치야나기' },
    { t: 'walk', min: 4 },
    { t: 'walk', min: 2 },
  ],
};
const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

test('stepNow: 타기 전 / 갈아타기 기다림 / 타는 중 / 내린 뒤 걷기', () => {
  assert.deepEqual(stepNow(seg, hm('11:40')), { kind: 'board', ride: seg.steps[1] });
  const r1 = stepNow(seg, hm('11:51'));
  assert.equal(r1.kind, 'ride');
  assert.equal(r1.ride.to, '요도야바시');
  assert.equal(r1.next.line, '게이한 본선');
  const t = stepNow(seg, hm('11:55'));
  assert.equal(t.kind, 'transfer');
  assert.equal(t.ride.from, '요도야바시');
  assert.equal(t.prev.line, '미도스지선');
  const r2 = stepNow(seg, hm('12:30'));
  assert.equal(r2.kind, 'ride');
  assert.equal(r2.next, null);
  assert.deepEqual(stepNow(seg, hm('12:50')), { kind: 'walk', ride: seg.steps[3], min: 6 });
});

test('stepNow: 자정 넘는 구간 (지금은 일정 기준: 0:10 = 24:10), 탈 것 없는 구간', () => {
  const late = { mode: '대중교통', steps: [{ t: 'transit', line: 'A', from: 'x', to: 'y', dep: '23:50', arr: '0:20' }] };
  assert.equal(stepNow(late, hm('23:40')).kind, 'board');
  assert.equal(stepNow(late, hm('23:55')).kind, 'ride');
  assert.equal(stepNow(late, hm('0:10') + 1440).kind, 'ride');
  assert.equal(stepNow(late, hm('0:30') + 1440).kind, 'walk');
  // 자정 지나 출발하는 구간 ("0:30 (+1)")
  const after = { mode: '대중교통', dep: '0:30 (+1)', steps: [{ t: 'transit', line: 'B', from: 'x', to: 'y', dep: '0:35', arr: '1:05' }] };
  assert.equal(stepNow(after, hm('23:59')).kind, 'board');
  assert.equal(stepNow(after, hm('0:40') + 1440).kind, 'ride');
  // 새벽 첫차 구간은 그날 시각 그대로 (4시 전이라고 전날로 보지 않음)
  const early = { mode: '대중교통', dep: '4:10', steps: [{ t: 'transit', line: 'C', from: 'x', to: 'y', dep: '4:15', arr: '4:50' }] };
  assert.equal(stepNow(early, hm('3:50')).kind, 'board');
  assert.equal(stepNow(early, hm('4:20')).kind, 'ride');
  assert.equal(stepNow({ mode: '도보', steps: [{ t: 'walk', min: 5 }] }, hm('12:00')), null);
  assert.equal(stepNow(null, 600), null);
});

test('stepRows: 자정 넘긴 역 시각에 익일 표시', () => {
  const late = {
    mode: '대중교통', dep: '23:40',
    steps: [
      { t: 'transit', line: 'A', from: 'x', to: 'y', dep: '23:45', arr: '23:58' },
      { t: 'transit', line: 'B', from: 'y', to: 'z', dep: '0:05', arr: '0:30' },
    ],
  };
  const st = stepRows(late, '출발', '도착').filter(r => r.type === 'station');
  assert.deepEqual(st.map(r => [r.name, r.time, r.nd, r.time2, r.nd2]), [
    ['x', '23:45', false, '', false],
    ['y', '23:58', false, '0:05', true],
    ['z', '0:30', true, '', false],
  ]);
});
