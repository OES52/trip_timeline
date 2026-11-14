import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileOf, tripTiles, glyphPaths } from './tiles.js';
import { buildView } from './trip.js';

test('tileOf: 알려진 값', () => {
  assert.deepEqual(tileOf(0, 0, 1), [1, 1]);
  assert.deepEqual(tileOf(35.6812, 139.7671, 14), [14552, 6451]);   // 도쿄역
});

test('tripTiles: 한국 출발지는 넓은 범위에서 빼고, 줌별 범위 안', () => {
  const raw = {
    dates: ['2026-12-25'], places: [], weather: {}, walk: {}, users: [], visitedBy: {}, arrivedBy: {}, spend: {}, overnight: [],
    points: [
      { date: '2026-12-25', order: 1, place: '인천', lat: 37.45, lng: 126.44 },
      { date: '2026-12-25', order: 2, place: '난바', lat: 34.6665, lng: 135.5005 },
      { date: '2026-12-25', order: 3, place: '오사카성', lat: 34.6873, lng: 135.5262 },
    ],
    segments: [],
  };
  const t = tripTiles(buildView(raw, null));
  const zs = t.map(k => Number(k.split('/')[0]));
  assert.ok(Math.min(...zs) === 5 && Math.max(...zs) === 14);
  assert.ok(t.length > 20 && t.length < 400, '개수 ' + t.length);
  // 넓은 범위(z10)는 일본 쪽만: 인천 타일이 없음
  assert.ok(!t.includes('9/' + tileOf(37.45, 126.44, 9).join('/')));
  // 인천 둘레(z14)는 있음
  assert.ok(t.includes('14/' + tileOf(37.45, 126.44, 14).join('/')));
  assert.equal(new Set(t).size, t.length);
});

test('glyphPaths', () => {
  const g = glyphPaths(['Noto Sans Regular']);
  assert.equal(g[0], 'fonts/Noto%20Sans%20Regular/0-255.pbf');
  assert.equal(g.length, 7);
});
