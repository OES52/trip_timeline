// 앱 상태. 화면은 여기 신호(signal)를 읽기만 하고, 바꾸는 건 여기 함수로만
import { signal, computed, effect } from '@preact/signals';
import { fetchData, subscribe, login, ApiError } from './api.js';
import { readCache, writeCache, local } from './cache.js';
import { buildView } from '../lib/trip.js';
import { overlayOf } from '../lib/ops.js';
import { tokyoNow } from '../lib/time.js';

const USER_KEY = 'trip-user-v1';   // v1과 같은 키 → 고른 사용자가 두 버전에서 이어짐

/** 서버 원본 */
export const raw = signal(null);
/** 고른 사용자 id (없으면 고르기 전) */
export const userId = signal(local.get(USER_KEY));
/**
 * 불러오기 상태
 *  kind: 'loading' 처음 받는 중 / 'fresh' 최신 / 'refreshing' 저장본 보여주며 받는 중
 *        'stale' 연결 안 돼 저장본 / 'locked' 접속 코드 필요 / 'error' 못 불러옴(저장본도 없음)
 */
export const sync = signal({ kind: 'loading', savedAt: '', message: '' });

export const users = computed(() => (raw.value && raw.value.users) || []);
export const user = computed(() => users.value.find(u => u.id === userId.value) || null);
/**
 * 아직 서버에 안 간 기록(도장·도착·지출). 보내는 중인 것도 여기 있다가 성공하면 빠짐
 *  화면은 서버 데이터에 이걸 겹쳐 보여줘서, 누르는 즉시 바뀌고 연결이 없어도 그대로 보임. 보내는 일은 records.js
 */
export const ops = signal([]);
/** 보내기 상태: 'idle' / 'sending' / 'waiting'(연결 안 돼 대기) / 'pin'(PIN을 넣어야 보냄) */
export const sendState = signal('idle');
/** 화면용 보기 (사용자 범위 날짜만 + 색인 + 안 보낸 기록). 데이터 없으면 null */
export const view = computed(() => (raw.value ? buildView(raw.value, user.value, overlayOf(ops.value, userId.value)) : null));

/** 알림 한 줄 (아래쪽에 잠깐). action = { label, fn } 이면 버튼 하나 (되돌리기 등) */
export const toast = signal(null);
let toastSeq = 0;
export function showToast(text, action) { toast.value = { id: ++toastSeq, text, action: action || null }; }

/** 떠 있는 입력 창: { kind:'spend'|'arrive', key } / { kind:'pin', id, error } / null */
export const dialog = signal(null);
export function openDialog(d) { dialog.value = d; }
export function closeDialog() { dialog.value = null; }

/** 일본 시각. 20초마다 갱신 (초 단위가 필요한 전광판은 따로 돎) */
export const nt = signal(tokyoNow());
export const nowMs = signal(Date.now());
function tick() { nt.value = tokyoNow(); nowMs.value = Date.now(); }
setInterval(tick, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); refresh(); } });

let loading = null;
/** 저장본부터 바로 보여주고, 서버에서 최신을 받아 바꿈 */
export function load() {
  if (loading) return loading;
  loading = (async () => {
    if (!raw.value) {
      const c = await readCache();
      if (c && !raw.value) { raw.value = c.data; sync.value = { kind: 'refreshing', savedAt: c.savedAt, message: '' }; }
    }
    await refresh();
  })().finally(() => { loading = null; });
  return loading;
}

let pulling = false, again = false;
/** 서버에서 최신 데이터 받기 */
export async function refresh() {
  if (pulling) { again = true; return; }
  pulling = true;
  try {
    const data = await fetchData();
    raw.value = data;
    const savedAt = await writeCache(data);
    sync.value = { kind: 'fresh', savedAt, message: '' };
    startEvents();
  } catch (e) {
    const status = e instanceof ApiError ? e.status : -1;
    if (status === 401) sync.value = { kind: 'locked', savedAt: sync.value.savedAt, message: '' };
    else if (raw.value) sync.value = { kind: 'stale', savedAt: sync.value.savedAt, message: e.message };
    else sync.value = {
      kind: 'error', savedAt: '',
      message: navigator.onLine === false || status === 0 ? '서버에 연결이 안 됨. 인터넷을 확인한 뒤 다시 불러오기' : e.message,
    };
  } finally {
    pulling = false;
    if (again) { again = false; refresh(); }
  }
}

let stop = null;
function startEvents() {
  if (stop) return;
  stop = subscribe(v => { if (raw.value && raw.value._v !== v) refresh(); });
}

/** 접속 코드 넣기. 맞으면 다시 불러옴 */
export async function unlock(code) {
  const ok = await login(code);
  if (ok) await refresh();
  return ok;
}

export function chooseUser(id) {
  userId.value = id;
  local.set(USER_KEY, id);
}

/* ── 지금 보는 곳 (탭·날짜). 주소 #탭/날짜 와 맞춤 → 새로고침·뒤로 가기에 그대로 ── */
const TABS = ['today', 'plan', 'places', 'records'];
function parseHash() {
  const [t, d] = location.hash.replace(/^#\/?/, '').split('/');
  return { tab: TABS.includes(t) ? t : 'today', day: /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null };
}
export const route = signal(parseHash());
addEventListener('hashchange', () => { route.value = parseHash(); });
export function go(tab, day) {
  const next = { tab, day: day === undefined ? route.value.day : day };
  const hash = '#' + next.tab + (next.day ? '/' + next.day : '');
  // 같은 탭 안에서 날짜만 바꾸는 건 기록에 안 쌓음 (뒤로 가기가 날짜를 하나씩 되짚지 않게)
  if (next.tab === route.value.tab) { history.replaceState(null, '', hash); route.value = next; }
  else location.hash = hash;
}

/* ── 일정 탭: 타임라인/지도 전환, 고른 장소 ── */
const PLAN_VIEW_KEY = 'trip2-plan-view';
/** 좁은 화면에서 일정을 어떻게 볼지: 'list'(타임라인) | 'map'. 넓은 화면은 둘을 나란히 보여줘서 안 씀 */
export const planView = signal(local.get(PLAN_VIEW_KEY) === 'map' ? 'map' : 'list');
export function setPlanView(v) { planView.value = v; local.set(PLAN_VIEW_KEY, v); }
/**
 * 고른 장소 { key: "날짜#순서", from }. from = 어디서 골랐는지
 *  'map' 지도 핀·카드 → 타임라인이 그 줄로 감 / 'list' 타임라인 → 지도가 그 핀으로 감 / 'card' 지도 카드의 앞·다음 → 지도만 움직임
 */
export const picked = signal(null);
export function pick(key, from) { picked.value = key ? { key, from } : null; }

/** 일정 탭에서 보는 날짜: 주소에 있으면 그날, 없으면 오늘(여행 중) 또는 첫날 */
export const day = computed(() => {
  const v = view.value;
  if (!v || !v.dates.length) return null;
  const d = route.value.day;
  if (d && v.dates.includes(d)) return d;
  return v.dates.includes(nt.value.date) ? nt.value.date : v.dates[0];
});

export { effect };
