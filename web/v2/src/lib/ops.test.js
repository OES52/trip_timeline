import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayOf, nextBatch, applyResult, failureKind, retryDelay, clockNow, parseAmount } from './ops.js';
import { buildView, isVisited, arrivedAt } from './trip.js';

const op = (id, kind, user, key, value, place) => ({ id, kind, user, key, value, place });

test('overlayOf: 도장·도착은 내 것만, 지출은 전부, 지움은 null, 나중 것이 이김', () => {
  const ops = [
    op('1', 'visit', 'A', 'd#1', 1), op('2', 'visit', 'B', 'd#2', 1), op('3', 'visit', 'A', 'd#1', 0),
    op('4', 'arrive', 'A', 'd#3', '14:17'), op('5', 'arrive', 'A', 'd#4', ''),
    op('6', 'spend', 'B', 'd#5', { amount: '1200', memo: '라멘' }), op('7', 'spend', 'A', 'd#6', null),
    op('8', 'todo', 'B', 'T1', 1), op('9', 'todo', 'A', 'T2', 0),
  ];
  assert.deepEqual(overlayOf(ops, 'A'), {
    visited: { 'd#1': null }, arrived: { 'd#3': '14:17', 'd#4': null },
    spend: { 'd#5': { amount: 1200, memo: '라멘' }, 'd#6': null },
    todo: { T1: true, T2: false },   // 할 일은 모두가 같이 씀 (다른 사람이 끝낸 것도)
  });
  assert.deepEqual(overlayOf([], 'A'), { visited: {}, arrived: {}, spend: {}, todo: {} });
});

test('할 일: 끝냄 체크는 setTodo 한 번, 결과로 목록 바꿈, 화면엔 바로 겹침', () => {
  assert.deepEqual(nextBatch([{ id: '1', kind: 'todo', user: 'A', key: 'T1', value: 1 }]), { fn: 'setTodo', args: ['T1', 1], user: 'A', ids: ['1'] });
  const raw0 = { todos: [{ key: 'T1', text: 'x', done: false }] };
  assert.deepEqual(applyResult(raw0, 'setTodo', 'A', [{ key: 'T1', text: 'x', done: true }]).todos[0].done, true);
  const v = buildView({ dates: [], points: [], segments: [], overnight: [], places: [], todos: [{ key: 'T1', text: 'x', done: false }] }, null, overlayOf([{ kind: 'todo', user: 'B', key: 'T1', value: 1 }], 'A'));
  assert.equal(v.todos[0].done, true);
  assert.deepEqual(v.bookings, []);
});

test('overlayOf + buildView: 누르는 즉시 화면 데이터에 반영', () => {
  const raw = {
    dates: ['2026-12-25'], places: [], segments: [], overnight: [], weather: {}, walk: {},
    points: [{ date: '2026-12-25', order: 1, place: 'X', arrive: '10:00', depart: '11:00' }, { date: '2026-12-25', order: 2, place: 'Y', arrive: '12:00', depart: '13:00' }],
    users: [{ id: 'A', from: '2026-12-25', to: '2026-12-25' }],
    visitedBy: { A: { '2026-12-25#2': 1 } }, arrivedBy: { A: {} }, spend: { '2026-12-25#2': { amount: 500, memo: '' } },
  };
  const ops = [op('1', 'visit', 'A', '2026-12-25#1', 1), op('2', 'visit', 'A', '2026-12-25#2', 0), op('3', 'arrive', 'A', '2026-12-25#1', '10:12'), op('4', 'spend', 'A', '2026-12-25#2', null)];
  const v = buildView(raw, raw.users[0], overlayOf(ops, 'A'));
  assert.equal(isVisited(v, v.points[0]), true);
  assert.equal(isVisited(v, v.points[1]), false);
  assert.equal(arrivedAt(v, v.points[0]), '10:12');
  assert.deepEqual(v.spend, {});
});

test('nextBatch: 연달은 도장은 한 번에, 다른 기록이 끼면 거기서 끊음', () => {
  const ops = [op('1', 'visit', 'A', 'd#1', 1), op('2', 'visit', 'A', 'd#2', 1), op('3', 'visit', 'A', 'd#1', 0), op('4', 'arrive', 'A', 'd#2', '9:05'), op('5', 'visit', 'A', 'd#3', 1)];
  assert.deepEqual(nextBatch(ops), { fn: 'setVisitedMany', args: [{ 'd#1': 0, 'd#2': 1 }], user: 'A', ids: ['1', '2', '3'] });
  assert.deepEqual(nextBatch(ops.slice(3)), { fn: 'setArrived', args: ['d#2', '9:05'], user: 'A', ids: ['4'] });
  assert.deepEqual(nextBatch([op('1', 'visit', 'A', 'd#1', 1), op('2', 'visit', 'B', 'd#1', 1)]).ids, ['1']);   // 다른 사용자는 따로
  assert.deepEqual(nextBatch([op('9', 'spend', 'A', 'd#1', { amount: 1200, memo: '' }, '라멘집')]), { fn: 'setSpend', args: ['d#1', '라멘집', 1200, ''], user: 'A', ids: ['9'] });
  assert.deepEqual(nextBatch([op('9', 'spend', 'A', 'd#1', null, '라멘집')]).args, ['d#1', '라멘집', '', '']);   // 빈 금액 = 지움
  assert.deepEqual(nextBatch([op('9', 'arrive', 'A', 'd#1', '')]).args, ['d#1', '']);
  assert.equal(nextBatch([]), null);
});

test('applyResult: 결과로 그 사용자 기록만 바꾸고 원본은 안 건드림', () => {
  const raw = { visitedBy: { A: { x: 1 }, B: { y: 1 } }, arrivedBy: { A: {} }, spend: {} };
  const r = applyResult(raw, 'setVisitedMany', 'A', { z: 1 });
  assert.deepEqual(r.visitedBy, { A: { z: 1 }, B: { y: 1 } });
  assert.deepEqual(raw.visitedBy.A, { x: 1 });
  assert.deepEqual(applyResult(raw, 'setArrived', 'A', { k: '10:00' }).arrivedBy, { A: { k: '10:00' } });
  assert.deepEqual(applyResult(raw, 'setSpend', 'A', { k: { amount: 1, memo: '' } }).spend, { k: { amount: 1, memo: '' } });
  assert.equal(applyResult(raw, 'setSpend', 'A', null), raw);
});

test('failureKind: PIN / 접속 코드 / 다시 시도 / 못 보냄', () => {
  assert.equal(failureKind(403, 'PIN이 틀림'), 'pin');
  assert.equal(failureKind(403, 'Guest는 기록할 수 없음 (보기 전용)'), 'drop');
  assert.equal(failureKind(401, '접속 코드 필요'), 'auth');
  assert.equal(failureKind(0, '연결 안 됨'), 'retry');
  assert.equal(failureKind(429, '요청이 너무 많음'), 'retry');
  assert.equal(failureKind(502, 'x'), 'retry');
  assert.equal(failureKind(400, 'x'), 'drop');
});

test('retryDelay: 서버 오류는 두 배씩 늘려 최대 5분, 버리지 않음', () => {
  assert.equal(retryDelay(0, 0), 8000);
  assert.equal(retryDelay(429, 3), 30000);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map(n => retryDelay(502, n)), [8000, 16000, 32000, 64000, 128000, 256000, 300000, 300000]);
});

test('clockNow·parseAmount', () => {
  assert.equal(clockNow({ date: 'x', min: 14 * 60 + 5 }), '14:05');
  assert.equal(clockNow({ date: 'x', min: 7 }), '00:07');
  assert.deepEqual(parseAmount('1,200'), { amount: 1200 });
  assert.deepEqual(parseAmount(' ¥980 '), { amount: 980 });
  assert.deepEqual(parseAmount('0'), { amount: 0 });
  assert.ok(parseAmount('').error);
  assert.ok(parseAmount('12.5').error);
  assert.ok(parseAmount('-3').error);
  assert.ok(parseAmount('천엔').error);
});
