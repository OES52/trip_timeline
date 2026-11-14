import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView, pname, tripRange, phase, dayCity, dayRoute, dayDelay, predictedMin, nowNext, remainMin, stopStates, daySpend, dayFare, lastTrain, tripClock, dayEndMin, nightRide } from './trip.js';

// 이틀짜리 작은 여행
const raw = () => ({
  dates: ['2026-12-25', '2026-12-26'],
  rate: 10, walk: { '2026-12-25': { m: 5000, min: 70 } }, walkWarnKm: 12, weather: {}, today: '2026-11-12',
  places: [
    { key: 'P1', name: '운서역', alias: '', type: '교통', city: '인천' },
    { key: 'P2', name: '오사카 성 천수각', alias: '오사카 성', type: '관광지', city: '오사카' },
    { key: 'P3', name: '중화소바', alias: '', type: '식당', city: '오사카' },
    { key: 'P4', name: '도다이지', alias: '', type: '관광지', city: '나라' },
    { key: 'P9', name: '안 가는 곳', alias: '', type: '카페', city: '교토' },
  ],
  points: [
    { placeKey: 'P3', date: '2026-12-25', order: 3, place: '중화소바', arrive: '15:30', depart: '16:20', per: 10000, paid: false, fare: null },
    { placeKey: 'P1', date: '2026-12-25', order: 1, place: '운서역', arrive: '4:00', depart: '4:00', per: null, fare: 500 },
    { placeKey: 'P2', date: '2026-12-25', order: 2, place: '오사카 성 천수각', arrive: '14:05', depart: '15:05', per: 6000, paid: true, fare: 240 },
    { placeKey: 'P4', date: '2026-12-26', order: 1, place: '도다이지', arrive: '10:00', depart: '11:30', per: 6000, paid: false, budgetId: 'B1', fare: null },
  ],
  segments: [
    { date: '2026-12-25', fromOrder: 1, toOrder: 2, mode: '수동', minutes: 600 },
    { date: '2026-12-25', fromOrder: 2, toOrder: 3, mode: '대중교통', minutes: 25, dep: '15:05', last: '23:40' },
  ],
  overnight: [],
  users: [{ id: 'A', from: '2026-12-25', to: '2026-12-26' }, { id: 'B', from: '2026-12-26', to: '2026-12-26' }],
  visitedBy: { A: { '2026-12-25#1': 1 }, B: {} },
  arrivedBy: { A: {}, B: {} },
  spend: {},
});

test('buildView: 날짜·순서로 정렬, 사용자 범위만, 일정에 나오는 장소만', () => {
  const v = buildView(raw(), null);
  assert.deepEqual(v.points.map(p => p.date + '#' + p.order), ['2026-12-25#1', '2026-12-25#2', '2026-12-25#3', '2026-12-26#1']);
  assert.deepEqual(v.places.map(p => p.key), ['P1', 'P2', 'P3', 'P4']);
  assert.equal(v.allPlaces.length, 5);
  const b = buildView(raw(), raw().users[1]);
  assert.deepEqual(b.dates, ['2026-12-26']);
  assert.equal(b.points.length, 1);
  assert.equal(b.segments.length, 0);
});

test('buildView: 아직 안 보낸 기록을 덮어씀 (지움은 null)', () => {
  const r = raw();
  const v = buildView(r, r.users[0], { visited: { '2026-12-25#2': 1, '2026-12-25#1': null }, arrived: { '2026-12-25#2': '14:20' } });
  assert.deepEqual(Object.keys(v.visited), ['2026-12-25#2']);
  assert.equal(v.arrived['2026-12-25#2'], '14:20');
});

test('pname·tripRange·phase', () => {
  const v = buildView(raw(), null);
  assert.equal(pname(v, v.points[1]), '오사카 성');
  const r = tripRange(v);
  assert.equal(r.start.toISOString(), '2026-12-24T19:00:00.000Z');   // 12/25 04:00 일본
  assert.equal(r.end.toISOString(), '2026-12-26T02:30:00.000Z');     // 12/26 11:30 일본
  assert.equal(phase(v, new Date('2026-11-12T00:00:00Z')), 'before');
  assert.equal(phase(v, new Date('2026-12-25T05:00:00Z')), 'during');
  assert.equal(phase(v, new Date('2026-12-27T00:00:00Z')), 'after');
});

test('dayCity·dayRoute: 교통은 가중치 낮게, 연속 중복 제거', () => {
  const v = buildView(raw(), null);
  assert.equal(dayCity(v, '2026-12-25').name, '오사카');
  assert.deepEqual(dayRoute(v, '2026-12-25').map(c => c.name), ['인천', '오사카']);
});

test('nowNext: 머무는 중 / 이동 중 / 오늘 끝', () => {
  const v = buildView(raw(), null);
  let r = nowNext(v, { date: '2026-12-25', min: 14 * 60 + 30 });
  assert.equal(r.cur.order, 2); assert.equal(r.next.order, 3); assert.equal(r.after, null);
  r = nowNext(v, { date: '2026-12-25', min: 15 * 60 + 10 });
  assert.equal(r.cur, null); assert.equal(r.next.order, 3);
  r = nowNext(v, { date: '2026-12-25', min: 20 * 60 });
  assert.equal(r.cur, null); assert.equal(r.next.date, '2026-12-26');   // 내일 첫 장소
});

test('dayDelay·predictedMin·remainMin: 도착 기록 뒤 장소는 같은 만큼 밀림', () => {
  const r = raw();
  r.arrivedBy.A['2026-12-25#2'] = '14:17';   // 12분 늦게 도착
  const v = buildView(r, r.users[0]);
  assert.equal(dayDelay(v, '2026-12-25').delay, 12);
  assert.equal(predictedMin(v, v.points[2]), 15 * 60 + 42);
  assert.equal(predictedMin(v, v.points[1]), null);   // 기록한 곳 자신은 예측 없음
  assert.equal(remainMin(v, v.points[2], { date: '2026-12-25', min: 15 * 60 }), 42);
  assert.equal(remainMin(v, v.points[3], { date: '2026-12-25', min: 15 * 60 }), null);   // 다른 날
});

test('stopStates: 지금·다음·지남', () => {
  const v = buildView(raw(), null);
  const s = stopStates(v, '2026-12-25', { date: '2026-12-25', min: 14 * 60 + 30 });
  assert.deepEqual([s.get(1), s.get(2), s.get(3)], ['past', 'now', 'next']);
  const t = stopStates(v, '2026-12-25', { date: '2026-12-25', min: 15 * 60 + 10 });
  assert.deepEqual([t.get(2), t.get(3)], ['past', 'next']);
  assert.equal(stopStates(v, '2026-12-25', { date: '2026-12-26', min: 0 }).get(3), 'past');
  assert.equal(stopStates(v, '2026-12-26', { date: '2026-12-25', min: 0 }).get(1), 'future');
});

test('daySpend·dayFare', () => {
  const v = buildView(raw(), null);
  assert.deepEqual(daySpend(v, '2026-12-25'), { total: 16000, paid: 6000, left: 10000 });
  assert.deepEqual(dayFare(v, '2026-12-25'), { sum: 740, missing: 0 });
});

test('lastTrain: 여유 30분 미만이면 빠듯, 오늘이면 남은 시간', () => {
  const seg = { date: '2026-12-25', dep: '23:20', last: '23:40' };
  assert.equal(lastTrain(seg, { date: '2026-12-24', min: 0 }).level, 'tight');
  assert.match(lastTrain(seg, { date: '2026-12-25', min: 23 * 60 }).text, /막차까지 40분/);
  assert.equal(lastTrain(seg, { date: '2026-12-25', min: 23 * 60 + 50 }).level, 'over');
  assert.equal(lastTrain({ date: '2026-12-25', dep: '20:00', last: '-' }), null);
  assert.equal(lastTrain({ date: '2026-12-25', dep: '20:00', last: '0:15 (+1)' }, { date: '2026-12-24', min: 0 }).level, 'info');
});

// 12/31 밤 새해 참배 → 숙소 (자정 넘김), 12/27 야간버스 (교통 장소에 밤새 머묾으로 적음)
const lateRaw = () => ({
  dates: ['2026-12-27', '2026-12-28', '2026-12-31', '2027-01-01'],
  places: [
    { key: 'B', name: '윌러 버스터미널', type: '교통', city: '오사카' },
    { key: 'S', name: '신주쿠 터미널', type: '교통', city: '도쿄' },
    { key: 'J', name: '메이지 신궁', type: '관광지', city: '도쿄' },
    { key: 'H', name: '숙소', type: '숙소', city: '도쿄' },
  ],
  points: [
    { placeKey: 'B', date: '2026-12-27', order: 1, place: '윌러 버스터미널', arrive: '20:50', depart: '31:00', stay: 570 },
    { placeKey: 'S', date: '2026-12-28', order: 1, place: '신주쿠 터미널', arrive: '7:40', depart: '7:50' },
    { placeKey: 'H', date: '2026-12-31', order: 1, place: '숙소', arrive: '21:00', depart: '23:20' },
    { placeKey: 'J', date: '2026-12-31', order: 2, place: '메이지 신궁', arrive: '24:00', depart: '25:00' },
    { placeKey: 'H', date: '2026-12-31', order: 3, place: '숙소', arrive: '25:40', depart: '25:40' },
    { placeKey: 'H', date: '2027-01-01', order: 1, place: '숙소', arrive: '10:00', depart: '10:30' },
  ],
  segments: [], overnight: [], users: [], visitedBy: {}, arrivedBy: {}, spend: {},
});

test('tripClock: 전날 일정이 자정을 넘겨 이어지는 동안은 전날 + 24시 넘긴 분', () => {
  const v = buildView(lateRaw(), null);
  assert.equal(dayEndMin(v, '2026-12-31'), 1540);
  assert.deepEqual(tripClock(v, { date: '2027-01-01', min: 30 }), { date: '2026-12-31', min: 1470 });
  assert.deepEqual(tripClock(v, { date: '2027-01-01', min: 100 }), { date: '2026-12-31', min: 1540 });   // 1:40 숙소 도착까지
  assert.deepEqual(tripClock(v, { date: '2027-01-01', min: 101 }), { date: '2027-01-01', min: 101 });
  assert.deepEqual(tripClock(v, { date: '2026-12-31', min: 600 }), { date: '2026-12-31', min: 600 });
  // 1/1 0:30: 지금은 참배 중, 다음은 숙소, 12/31 줄은 아직 안 지남
  const t = tripClock(v, { date: '2027-01-01', min: 30 });
  const nn = nowNext(v, t);
  assert.equal(nn.cur.place, '메이지 신궁');
  assert.equal(nn.next.place, '숙소');
  assert.equal(nn.next.order, 3);
  const st = stopStates(v, '2026-12-31', t);
  assert.deepEqual([st.get(1), st.get(2), st.get(3)], ['past', 'now', 'next']);
  assert.equal(remainMin(v, nn.next, t), 70);
});

test('야간버스: 12/28 1:00은 전날(12/27) 버스 타는 중', () => {
  const v = buildView(lateRaw(), null);
  const t = tripClock(v, { date: '2026-12-28', min: 60 });
  assert.deepEqual(t, { date: '2026-12-27', min: 1500 });
  const nn = nowNext(v, t);
  assert.equal(nn.cur.place, '윌러 버스터미널');
  assert.equal(nn.next.place, '신주쿠 터미널');
  assert.equal(nightRide(v, nn.cur), true);
  assert.equal(nightRide(v, v.points.find(p => p.placeKey === 'J')), false);
  // 7:01부터는 그날(12/28)
  assert.deepEqual(tripClock(v, { date: '2026-12-28', min: 421 }), { date: '2026-12-28', min: 421 });
});

test('lastTrain: 자정 넘어 전날 일정이 이어지는 중이면 막차 경고도 이어짐', () => {
  const seg = { date: '2026-12-31', dep: '23:30', last: '0:15 (+1)' };
  assert.match(lastTrain(seg, { date: '2026-12-31', min: 1445 }).text, /막차까지 10분 \(익일 0:15까지 출발\)/);
  assert.equal(lastTrain(seg, { date: '2026-12-31', min: 1460 }).level, 'over');
  assert.match(lastTrain(seg, { date: '2026-12-30', min: 0 }).text, /막차 타려면 익일 0:15까지 출발, 여유 45분/);
});
