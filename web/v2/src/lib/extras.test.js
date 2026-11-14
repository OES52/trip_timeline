import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from './trip.js';
import { myTodos, ddayText, bookingPoint, bookingsFor, myBookings, phoneOf, lodgings, canShow } from './extras.js';

const raw = () => ({
  dates: ['2026-12-25', '2026-12-26'],
  places: [
    { key: 'H', name: '헨나호텔 오사카 난바', type: '숙소', ja: '変なホテル大阪 なんば', addr: '大阪府大阪市中央区' },
    { key: 'K', name: '간사이 공항', type: '교통' },
    { key: 'N', name: '난바역', type: '교통' },
  ],
  points: [
    { placeKey: 'K', date: '2026-12-25', order: 1, place: '간사이 공항', arrive: '9:30', depart: '10:00' },
    { placeKey: 'N', date: '2026-12-25', order: 2, place: '난바역', arrive: '11:15', depart: '11:20' },
    { placeKey: 'H', date: '2026-12-25', order: 3, place: '헨나호텔 오사카 난바', arrive: '11:30', depart: '12:00' },
    { placeKey: 'H', date: '2026-12-26', order: 1, place: '헨나호텔 오사카 난바', arrive: '7:00', depart: '7:00' },
  ],
  segments: [], overnight: [],
  todos: [
    { key: 'T1', date: '2026-11-25', time: '', text: '라피트 예약', who: [], done: false },
    { key: 'T2', date: '2026-12-05', time: '10:50', text: '코미케 티켓', who: ['OES'], done: false },
    { key: 'T3', date: '2026-12-20', time: '', text: '환전', who: ['KanoC'], done: true },
  ],
  bookings: [
    { key: 'R2', date: '2026-12-25', order: 1, place: '', title: '라피트 β', no: 'AB12', images: [], who: [] },
    { key: 'R3', date: '2026-12-25', order: null, place: '헨나', title: '호텔', no: '9', images: [], who: [] },
    { key: 'R4', date: '', order: null, place: '', title: '여행자 보험', no: 'X', images: [], who: ['OES'] },
    { key: 'R5', date: '2027-01-02', order: null, place: '', title: '범위 밖', no: 'Y', images: [], who: [] },
  ],
});

test('할 일: 누구가 비었거나 그 사람만, D-day 글', () => {
  const v = buildView(raw(), null);
  assert.deepEqual(myTodos(v, 'OES').map(t => t.key), ['T1', 'T2']);
  assert.deepEqual(myTodos(v, 'KanoC').map(t => t.key), ['T1', 'T3']);
  assert.equal(ddayText('2026-11-25', '2026-11-15'), 'D-10');
  assert.equal(ddayText('2026-11-25', '2026-11-25'), '오늘');
  assert.equal(ddayText('2026-11-25', '2026-11-27'), '2일 지남');
  assert.equal(ddayText('', '2026-11-27'), '');
});

test('예약: 순서로, 순서가 없으면 장소 이름으로 그날 일정에 붙음', () => {
  const v = buildView(raw(), { id: 'OES', from: '2026-12-25', to: '2027-01-01' });
  const r = id => v.bookings.find(b => b.key === id);
  assert.equal(bookingPoint(v, r('R2')).order, 1);
  assert.equal(bookingPoint(v, r('R3')).order, 3);   // 같은 날 첫 "헨나"
  assert.equal(bookingPoint(v, r('R4')), null);
  assert.deepEqual(bookingsFor(v, v.points[2], 'OES').map(b => b.key), ['R3']);
  // 목록: 날짜 순, 날짜 없는 건 뒤, 볼 수 있는 날짜 밖(1/2)은 뺌, 다른 사람 것도 뺌
  assert.deepEqual(myBookings(v, 'OES').map(x => x.b.key), ['R2', 'R3', 'R4']);
  assert.deepEqual(myBookings(v, 'KanoC').map(x => x.b.key), ['R2', 'R3']);
  assert.deepEqual(myBookings(v, 'OES', '2026-12-26').map(x => x.b.key), ['R4']);
});

test('비상 연락처 줄에서 전화번호, 숙소 목록, 보여주기 가능', () => {
  assert.deepEqual(phoneOf('여행자 보험 OO화재 24시간 +82-2-1234-5678'), { text: '여행자 보험 OO화재 24시간 +82-2-1234-5678', tel: '+82212345678' });
  assert.equal(phoneOf('호텔 체크인 15시').tel, '');
  const v = buildView(raw(), null);
  assert.deepEqual(lodgings(v).map(p => p.key), ['H']);
  assert.equal(canShow(v.placeByKey.get('H')), true);
  assert.equal(canShow(v.placeByKey.get('K')), false);
});
