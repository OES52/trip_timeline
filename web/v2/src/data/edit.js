// 일정 조정: 체류 ±15분, 건너뛰기, 택시로 가기 (일정 수정 권한이 있는 사용자만)
//  서버(Apps Script)가 시트를 고치고 경로를 다시 계산해 일정 전체를 돌려줌. 10~30초 걸리고, 연결이 꼭 있어야 해서 대기열에 안 넣음
import { signal } from '@preact/signals';
import { raw, user, showToast, openDialog } from './store.js';
import { writeCache } from './cache.js';
import { call, ApiError } from './api.js';
import { getPin, previewBlocks } from './records.js';
import { vk } from '../lib/trip.js';

/** 지금 다시 계산 중인 조정 { key, label } 또는 null. 그동안 다른 조정 버튼은 막음 */
export const editing = signal(null);

export function canEdit() { const u = user.value; return !!(u && u.canEdit); }

/**
 * @param key 일정 점 키  @param op 'stay' | 'skip' | 'unskip' | 'taxi'
 * @param label 끝나고 알림에 띄울 글  @param undo 되돌리기로 할 조정 { op, value, label } (없으면 버튼 없음)
 */
export async function editPlan(key, op, value, label, undo) {
  if (!canEdit() || editing.value || previewBlocks()) return;
  const u = user.value;
  if (navigator.onLine === false) { showToast('일정 조정은 연결이 있어야 됨. 연결되면 다시 시도'); return; }
  if (u.hasPin && !getPin(u.id)) { openDialog({ kind: 'pin', id: u.id, error: '' }); return; }
  editing.value = { key, label };
  try {
    const data = await call('editPlan', [key, op, value, u.id, getPin(u.id)]);
    if (data && data.points) { raw.value = data; writeCache(data); }
    showToast(label, undo ? { label: '되돌리기', fn: () => editPlan(key, undo.op, undo.value, undo.label) } : null);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 0;
    if (status === 403 && /PIN/.test(e.message)) openDialog({ kind: 'pin', id: u.id, error: 'PIN이 바뀐 것 같음. 다시 입력한 뒤 다시 조정' });
    else showToast('일정 조정 못 함: ' + (status === 0 ? '서버에 연결 안 됨' : e.message));
  } finally {
    editing.value = null;
  }
}

/* 화면에서 부르는 것 */
export const changeStay = (p, name, d) =>
  editPlan(vk(p), 'stay', d, name + ' 체류 ' + (d > 0 ? '+' : '−') + Math.abs(d) + '분', { op: 'stay', value: -d, label: name + ' 체류 되돌림' });
export const skipStop = (p, name) =>
  editPlan(vk(p), 'skip', 0, name + ' 건너뜀', { op: 'unskip', value: 0, label: name + ' 되돌림' });
export const setTaxi = (s, on) =>
  editPlan(s.date + '#' + s.fromOrder, 'taxi', on ? 1 : 0, on ? '택시로 바꿈' : '원래 이동수단으로 되돌림', { op: 'taxi', value: on ? 0 : 1, label: '되돌림' });
