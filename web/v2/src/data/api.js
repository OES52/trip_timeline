// 서버 호출. 홈랩 프록시(/api) 하나만 봄
//  GET  /api/data            일정 전체
//  POST /api/call {fn,args}  쓰기 (도장·도착·지출·일정 조정)
//  POST /api/login {code}    접속 코드
//  GET  /api/events          SSE: 데이터가 바뀌면 { v } 알림
const API = '/api';

/** status: 0 연결 안 됨 / 401 접속 코드 필요 / 4xx 요청 문제 / 5xx 서버 쪽 */
export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function read(res) {
  let j = null;
  try { j = await res.json(); } catch (e) { j = null; }
  if (res.status === 401) throw new ApiError('접속 코드 필요', 401);
  if (!j) throw new ApiError(res.ok ? '서버 응답을 못 읽음' : '서버 오류 ' + res.status, res.ok ? 502 : res.status);
  if (!j.ok) throw new ApiError(j.error || '서버 오류 ' + res.status, res.status);
  return j.result;
}

export async function fetchData() {
  let res;
  try { res = await fetch(API + '/data', { cache: 'no-cache', credentials: 'same-origin' }); }
  catch (e) { throw new ApiError('연결 안 됨', 0); }
  return read(res);
}

export async function call(fn, args) {
  let res;
  try {
    res = await fetch(API + '/call', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fn, args }),
    });
  } catch (e) { throw new ApiError('연결 안 됨', 0); }
  return read(res);
}

/** 접속 코드 확인. 맞으면 true, 틀리면 false, 너무 많이 틀렸으면 429 오류 */
export async function login(code) {
  let res;
  try {
    res = await fetch(API + '/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  } catch (e) { throw new ApiError('연결 안 됨', 0); }
  if (res.ok) return true;
  if (res.status === 429) throw new ApiError('시도가 너무 많아 잠깐 막힘', 429);
  return false;
}

/** 데이터 바뀜 알림 구독. 끊기면 브라우저가 알아서 다시 붙음. 돌려주는 함수를 부르면 끊음 */
export function subscribe(onVersion, onOpen) {
  if (!window.EventSource) return () => {};
  const es = new EventSource(API + '/events');
  es.addEventListener('data', e => {
    let d = null;
    try { d = JSON.parse(e.data); } catch (err) { return; }
    if (d && d.v) onVersion(d.v);
  });
  if (onOpen) es.onopen = onOpen;
  return () => es.close();
}
