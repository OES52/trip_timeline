// 기록(도장·도착·지출) 쓰기의 순수 로직
//  기록 하나 = op { id, kind, user, key, value, place }
//    kind 'visit'  : value 1(도장) | 0(지움)
//    kind 'arrive' : value "HH:MM" | ''(지움)
//    kind 'spend'  : value { amount, memo } | null(지움), place = 장소 이름 (지출 시트에 같이 적힘)
//  화면은 "서버 데이터 + 아직 안 보낸 op"를 겹쳐서 보여주므로, 누르는 즉시 바뀌고 연결이 없어도 그대로 보임

/**
 * 아직 안 보낸 기록을 화면에 겹칠 모양으로 (buildView의 pending 인자)
 *  도장·도착은 그 사용자 것만, 지출은 모두가 같이 쓰는 값이라 전부. 지움은 null
 */
export function overlayOf(ops, userId) {
  const out = { visited: {}, arrived: {}, spend: {}, todo: {} };
  (ops || []).forEach(o => {
    if (o.kind === 'spend') out.spend[o.key] = o.value ? { amount: Number(o.value.amount), memo: o.value.memo || '' } : null;
    else if (o.kind === 'todo') out.todo[o.key] = !!o.value;   // 할 일도 모두가 같이 씀
    else if (o.user !== userId) return;
    else if (o.kind === 'visit') out.visited[o.key] = o.value ? 1 : null;
    else if (o.kind === 'arrive') out.arrived[o.key] = o.value || null;
  });
  return out;
}

/**
 * 맨 앞 기록을 서버 호출 하나로. 연달아 찍은 도장은 한 번에 묶음 (같은 사용자, 사이에 다른 기록이 없을 때)
 * @returns {{ fn:string, args:any[], user:string, ids:string[] }|null}  args 뒤에 [user, pin]을 붙여서 부름
 */
export function nextBatch(ops) {
  const head = ops && ops[0];
  if (!head) return null;
  if (head.kind === 'visit') {
    const changes = {}, ids = [];
    for (const o of ops) {
      if (o.kind !== 'visit' || o.user !== head.user) break;
      changes[o.key] = o.value ? 1 : 0;
      ids.push(o.id);
    }
    return { fn: 'setVisitedMany', args: [changes], user: head.user, ids };
  }
  if (head.kind === 'arrive') return { fn: 'setArrived', args: [head.key, head.value || ''], user: head.user, ids: [head.id] };
  if (head.kind === 'todo') return { fn: 'setTodo', args: [head.key, head.value ? 1 : 0], user: head.user, ids: [head.id] };
  const v = head.value;
  return { fn: 'setSpend', args: [head.key, head.place || '', v ? Number(v.amount) : '', v ? v.memo || '' : ''], user: head.user, ids: [head.id] };
}

/** 서버가 돌려준 결과(그 사용자의 도장·도착 전체, 또는 지출 전체)를 원본 데이터에 반영한 새 객체 */
export function applyResult(raw, fn, user, result) {
  if (!raw || !result || typeof result !== 'object') return raw;
  if (fn === 'setVisitedMany' || fn === 'setVisited') return Object.assign({}, raw, { visitedBy: Object.assign({}, raw.visitedBy, { [user]: result }) });
  if (fn === 'setArrived') return Object.assign({}, raw, { arrivedBy: Object.assign({}, raw.arrivedBy, { [user]: result }) });
  if (fn === 'setSpend') return Object.assign({}, raw, { spend: result });
  if (fn === 'setTodo' && Array.isArray(result)) return Object.assign({}, raw, { todos: result });
  return raw;
}

/**
 * 실패한 호출을 어떻게 할지
 *  'pin'   PIN 다시 넣어야 함 / 'auth' 접속 코드 다시 넣어야 함 (대기열 그대로)
 *  'retry' 연결 없음·너무 많음·서버 오류: 대기열에 두고 다시 (버리지 않음)
 *  'drop'  서버가 받지 않음 (권한 없음 등): 대기열에서 빼서 "못 보낸 기록"으로
 */
export function failureKind(status, message) {
  if (status === 403 && /PIN/.test(message || '')) return 'pin';
  if (status === 401) return 'auth';
  if (status == null || status === 0 || status === 429 || status >= 500) return 'retry';
  return 'drop';
}

/** 다시 보낼 때까지 기다릴 시간(ms): 연결 없음 8초, 너무 많음 30초, 서버 오류는 8초부터 두 배씩 최대 5분 */
export function retryDelay(status, tries) {
  if (status === 429) return 30000;
  if (!status) return 8000;
  return Math.min(300000, 8000 * 2 ** Math.max(0, (tries || 1) - 1));
}

/** 지금 일본 시각을 그 날짜 기준 "HH:MM"으로 (자정을 넘겼어도 시각만 적음) */
export function clockNow(nt) {
  return String(Math.floor(nt.min / 60) % 24).padStart(2, '0') + ':' + String(nt.min % 60).padStart(2, '0');
}

/** 금액 입력값 확인. 맞으면 { amount }, 아니면 { error } */
export function parseAmount(text) {
  const t = String(text == null ? '' : text).replace(/[,\s¥]/g, '');
  if (t === '') return { error: '금액을 입력해야 저장됨' };
  if (!/^\d+$/.test(t)) return { error: '금액은 숫자만 (엔 단위)' };
  const n = Number(t);
  if (n > 10000000) return { error: '금액이 너무 큼. 엔 단위인지 확인' };
  return { amount: n };
}
