import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from './trip.js';
import { passport, receipt, moneySummary, hashNum } from './passport.js';

const raw = () => ({
  dates: ['2026-12-25', '2026-12-26'], walk: { '2026-12-25': { m: 4200, min: 60 } },
  places: [
    { key: 'H', name: '호텔', type: '숙소', city: '오사카' },
    { key: 'C', name: '오사카 성', alias: '성', type: '관광지', city: '오사카' },
    { key: 'R', name: '라멘집', type: '식당', city: '오사카' },
  ],
  points: [
    { placeKey: 'H', date: '2026-12-25', order: 1, place: '호텔', arrive: '9:00', depart: '9:30', fare: 240 },
    { placeKey: 'C', date: '2026-12-25', order: 2, place: '오사카 성', arrive: '10:00', depart: '12:30', stay: 150, yen: 600, budgetId: 'B1' },
    { placeKey: 'R', date: '2026-12-25', order: 3, place: '라멘집', arrive: '19:00', depart: '20:00', yen: 1200 },
    { placeKey: 'H', date: '2026-12-25', order: 4, place: '호텔', arrive: '21:00', depart: '21:00' },
    { placeKey: 'C', date: '2026-12-26', order: 1, place: '오사카 성', arrive: '19:00', depart: '20:00', yen: 600, budgetId: 'B1' },
    { date: '2026-12-26', order: 2, place: '이름만 있는 곳', arrive: '21:00', depart: '21:00' },
  ],
  segments: [{ date: '2026-12-25', fromOrder: 1, toOrder: 2, mode: '대중교통', minutes: 20 }],
  overnight: [], users: [{ id: 'A', from: '2026-12-25', to: '2026-12-26' }],
  visitedBy: { A: { '2026-12-25#1': 1, '2026-12-25#2': 1 } }, arrivedBy: { A: { '2026-12-25#2': '10:10' } },
  spend: { '2026-12-25#2': { amount: 600, memo: '입장' }, '2026-12-25#3': { amount: 980, memo: '' } },
});

test('passport: 같은 장소는 처음 나오는 날 한 칸, 이름만 있는 곳도 칸', () => {
  const v = buildView(raw(), raw().users[0]);
  const ps = passport(v);
  assert.deepEqual(ps.slots.map(s => s.key), ['H', 'C', 'R', 'n:이름만 있는 곳']);
  assert.deepEqual(ps.days.map(d => d.slots.length), [3, 1]);
  assert.equal(ps.got, 2);
  assert.equal(ps.slots[1].name, '성');
});

test('passport: 금박 = 2시간 넘게 머묾 / 재방문 / 밤 관광, 숙소는 없음', () => {
  const r = raw();
  let ps = passport(buildView(r, r.users[0]));
  assert.equal(ps.slots[0].rare, '');           // 숙소
  assert.equal(ps.slots[1].rare, '오래 머묾');
  assert.equal(ps.gold, 1);
  r.visitedBy.A['2026-12-26#1'] = 1;
  ps = passport(buildView(r, r.users[0]));
  assert.equal(ps.slots[1].rare, '재방문');
});

test('receipt: 도착 기록 시각, 지출, 교통비, 합계, 예정 여부', () => {
  const v = buildView(raw(), raw().users[0]);
  const rc = receipt(v, '2026-12-25', { date: '2026-12-25', min: 800 }, 'A');
  assert.equal(rc.items[1].time, '10:10');
  assert.equal(rc.items[1].amount, 600);
  assert.equal(rc.items[0].amount, null);
  assert.equal(rc.fare, 240);
  assert.equal(rc.spent, 1580);
  assert.equal(rc.sum, 1820);
  assert.equal(rc.stamps, 2);
  assert.equal(rc.walkKm, 4.2);
  assert.equal(rc.planned, false);
  assert.equal(receipt(v, '2026-12-26', { date: '2026-12-25', min: 800 }, 'A').planned, true);
});

test('moneySummary: 같은 예산 번호는 하루에 한 번', () => {
  const m = moneySummary(buildView(raw(), raw().users[0]));
  assert.equal(m.spent, 1580);
  assert.equal(m.fare, 240);
  assert.equal(m.plan, 600 + 1200 + 600);
  assert.equal(m.n, 2);
  assert.ok(hashNum('C') >= 0);
});
