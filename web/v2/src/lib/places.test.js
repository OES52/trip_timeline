import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from './trip.js';
import { filterPlaces, groupPlaces, cityList, visitsOf, placeStatus } from './places.js';

const raw = () => ({
  dates: ['2026-12-25', '2026-12-26'], segments: [], overnight: [], weather: {}, walk: {}, spend: {}, arrivedBy: {},
  users: [{ id: 'A', from: '2026-12-25', to: '2026-12-26' }],
  visitedBy: { A: { '2026-12-26#1': 1 } },
  places: [
    { key: 'K1', name: '기요미즈데라', alias: '', type: '관광지', city: '교토', area: '히가시야마', menu: [] },
    { key: 'K2', name: '니시키 시장', alias: '', type: '관광지', city: '교토', area: '중부', menu: ['두유 도넛'] },
    { key: 'O1', name: '오사카 성 천수각', alias: '오사카 성', type: '관광지', city: '오사카', area: '오사카성', menu: [] },
    { key: 'O2', name: '중화소바 쓰지', alias: '', type: '식당', city: '오사카', area: '난바', menu: ['중화소바'] },
    { key: 'O3', name: '추천 카페', alias: '', type: '카페', city: '오사카', area: '난바', menu: [] },
  ],
  points: [
    { placeKey: 'K2', date: '2026-12-25', order: 2, place: '니시키 시장' },
    { placeKey: 'K1', date: '2026-12-25', order: 1, place: '기요미즈데라' },
    { placeKey: 'O1', date: '2026-12-26', order: 1, place: '오사카 성 천수각' },
    { placeKey: 'O2', date: '2026-12-26', order: 2, place: '중화소바 쓰지' },
    { placeKey: 'O2', date: '2026-12-26', order: 4, place: '중화소바 쓰지' },
  ],
});

test('filterPlaces: 도시·종류·일정 여부·검색 (메뉴까지)', () => {
  const v = buildView(raw(), raw().users[0]);
  const keys = o => filterPlaces(v, o).map(p => p.key);
  assert.deepEqual(keys({}), ['K1', 'K2', 'O1', 'O2', 'O3']);
  assert.deepEqual(keys({ city: '오사카' }), ['O1', 'O2', 'O3']);
  assert.deepEqual(keys({ type: '식당' }), ['O2']);
  assert.deepEqual(keys({ scope: 'extra' }), ['O3']);
  assert.deepEqual(keys({ scope: 'plan', city: '오사카' }), ['O1', 'O2']);
  assert.deepEqual(keys({ q: '도넛' }), ['K2']);
  assert.deepEqual(keys({ q: '오사카 성' }), ['O1']);
});

test('groupPlaces: 첫 방문 날짜 순, 일정 없는 곳은 뒤', () => {
  const v = buildView(raw(), null);
  const g = groupPlaces(v, v.allPlaces);
  assert.deepEqual(g.map(x => x.city), ['교토', '오사카']);
  assert.deepEqual(g[0].areas.map(a => a.area), ['히가시야마', '중부']);
  assert.deepEqual(g[1].areas.map(a => a.area), ['오사카성', '난바']);
  assert.deepEqual(g[1].areas[1].places.map(p => p.key), ['O2', 'O3']);
  assert.deepEqual(cityList(v).map(c => c.city + c.n), ['교토2', '오사카3']);
});

test('visitsOf·placeStatus', () => {
  const v = buildView(raw(), raw().users[0]);
  assert.deepEqual(visitsOf(v, 'O2').map(p => p.order), [2, 4]);
  const st = k => placeStatus(v, v.allPlaces.find(p => p.key === k));
  assert.deepEqual(['O1', 'O2', 'O3'].map(st), ['done', 'plan', 'extra']);
});
