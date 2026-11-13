import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, hoursFor, closedOn, memoDeadline, warnings } from './hours.js';

test('parseHours: 여러 칸, 자정 넘김', () => {
  assert.deepEqual(parseHours('11:00~15:00, 17:00~22:00'), [[660, 900], [1020, 1320]]);
  assert.deepEqual(parseHours('18:00~02:00'), [[1080, 1560]]);
});

test('hoursFor: 날짜 > 요일 > 기본 순서로 고름', () => {
  const t = '11:00~15:00, 17:00~22:00 / 토·일 11:00~22:00 / 12/31 11:00~18:00 / 1/1 휴무';
  assert.equal(hoursFor(t, '2026-12-25').text, '11:00~15:00, 17:00~22:00');   // 금: 기본
  assert.equal(hoursFor(t, '2026-12-26').text, '11:00~22:00');                 // 토: 요일
  assert.equal(hoursFor(t, '2026-12-31').text, '11:00~18:00');                 // 날짜
  assert.equal(hoursFor(t, '2027-01-01').closed, true);
  assert.equal(hoursFor('', '2026-12-25'), null);
});

test('closedOn: 요일·날짜 범위(해 넘김 포함)', () => {
  assert.equal(closedOn('월요일', '2026-12-28'), true);
  assert.equal(closedOn('월요일', '2026-12-29'), false);
  assert.equal(closedOn('12/30~1/3', '2027-01-02'), true);
  assert.equal(closedOn('연중무휴 (12/31 야간연장)', '2026-12-31'), false);
});

test('memoDeadline: 가장 이른 마감', () => {
  assert.equal(memoDeadline('15시 전까지 입장, L.O. 19:45'), 900);
  assert.equal(memoDeadline('최종 입장 16:30'), 990);
  assert.equal(memoDeadline('그냥 메모'), null);
});

test('warnings: 영업 전·마감 직전·머무는 중 종료·휴무', () => {
  const pt = (arrive, depart, extra) => Object.assign({ date: '2026-12-25', order: 1, arrive, depart, stay: 60, memo: '' }, extra);
  const food = { type: '식당', hours: '11:00~15:00, 17:00~22:00', closed: '' };
  assert.match(warnings(pt('10:30', '11:30'), food)[0], /영업 전 도착 \(11:00 오픈\)/);
  assert.match(warnings(pt('14:45', '15:30'), food)[0], /마감 15:00 직전/);
  assert.match(warnings(pt('21:00', '22:30'), food)[0], /머무는 중 영업 종료 \(22:00\)/);
  assert.deepEqual(warnings(pt('12:00', '13:00'), food), []);
  assert.match(warnings(pt('12:00', '13:00'), { type: '관광지', hours: '', closed: '금요일' })[0], /이날 휴무/);
  // 교통·숙소는 영업시간 비교 안 함
  assert.deepEqual(warnings(pt('4:00', '4:00'), { type: '교통', hours: '05:20~00:10', closed: '' }), []);
  // 메모 마감
  assert.match(warnings(pt('16:00', '17:00', { memo: '15시 전까지' }), null)[0], /메모 마감 15:00 넘김/);
});
