import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMin, hhmm, tokyoNow, toDateTime, dayLabel, fmtDur, splitSec } from './time.js';

test('toMin: 시각 글자를 분으로', () => {
  assert.equal(toMin('9:30'), 570);
  assert.equal(toMin('04:00'), 240);
  assert.equal(toMin('25:10'), 1510);          // 자정 넘김 표기
  assert.equal(toMin('07:00 (+1)'), 420);      // 뒤에 붙은 표시는 무시
  assert.equal(toMin(''), null);
  assert.equal(toMin(null), null);
});

test('hhmm: 분을 시각 글자로 (24시 넘으면 0시부터)', () => {
  assert.equal(hhmm(570), '9:30');
  assert.equal(hhmm(1510), '1:10');
  assert.equal(hhmm(0), '0:00');
});

test('tokyoNow: 어느 시간대에서 열어도 일본 날짜·시각', () => {
  // UTC 12/25 19:10 = 일본 12/26 04:10
  assert.deepEqual(tokyoNow(new Date('2026-12-25T19:10:00Z')), { date: '2026-12-26', min: 250 });
  // 일본 자정 정각
  assert.deepEqual(tokyoNow(new Date('2026-12-25T15:00:00Z')), { date: '2026-12-26', min: 0 });
});

test('toDateTime: 일본 시간으로 해석', () => {
  assert.equal(toDateTime('2026-12-25', '4:00').toISOString(), '2026-12-24T19:00:00.000Z');
  assert.equal(toDateTime('2026-12-25', '25:10').toISOString(), '2026-12-25T16:10:00.000Z');
  assert.equal(toDateTime('2026-12-25', ''), null);
});

test('dayLabel·fmtDur·splitSec', () => {
  assert.equal(dayLabel('2026-12-25'), '12/25 (금)');
  assert.equal(dayLabel('2027-01-03'), '1/3 (일)');
  assert.equal(fmtDur(25), '25분');
  assert.equal(fmtDur(60), '1시간');
  assert.equal(fmtDur(85), '1시간 25분');
  assert.deepEqual(splitSec(90061), { d: 1, h: 1, m: 1, s: 1 });
});
