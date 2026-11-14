import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepNow } from './steps.js';

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

test('stepNow: 자정 넘는 구간, 탈 것 없는 구간', () => {
  const late = { mode: '대중교통', steps: [{ t: 'transit', line: 'A', from: 'x', to: 'y', dep: '23:50', arr: '0:20' }] };
  assert.equal(stepNow(late, hm('23:55')).kind, 'ride');
  assert.equal(stepNow(late, hm('0:10')).kind, 'ride');
  assert.equal(stepNow(late, hm('0:30')).kind, 'walk');
  assert.equal(stepNow({ mode: '도보', steps: [{ t: 'walk', min: 5 }] }, hm('12:00')), null);
  assert.equal(stepNow(null, 600), null);
});
