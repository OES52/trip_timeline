import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNow, preview } from './preview.js';

test('parseNow: 일본 시각으로 읽음, 형식이 틀리면 NaN', () => {
  assert.equal(new Date(parseNow('2026-12-25T12:30')).toISOString(), '2026-12-25T03:30:00.000Z');
  assert.equal(new Date(parseNow('2026-12-25 9:05')).toISOString(), '2026-12-25T00:05:00.000Z');
  assert.equal(new Date(parseNow('2026-12-31T23:59:30')).toISOString(), '2026-12-31T14:59:30.000Z');
  assert.ok(Number.isNaN(parseNow('')));
  assert.ok(Number.isNaN(parseNow('12/25 12:30')));
  assert.ok(Number.isNaN(parseNow(null)));
});

test('preview: 브라우저 밖(테스트)에서는 꺼져 있고 Date를 안 건드림', () => {
  assert.equal(preview.on, false);
  assert.ok(Math.abs(Date.now() - new Date().getTime()) < 1000);
});
