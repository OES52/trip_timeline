// 껍데기: 머리줄(흰 판), 탭(남색 안내판), 사용자 고르기, 연결 상태 줄
import { useState } from 'preact/hooks';
import { route, go, user, users, userId, chooseUser, sync, refresh, raw, unlock } from '../data/store.js';
import { userColor } from '../lib/colors.js';
import { md } from '../lib/time.js';
import { Icon } from './Icon.jsx';
import { Sheet } from './Sheet.jsx';

const TABS = [
  { id: 'today', label: '오늘', icon: 'clock' },
  { id: 'plan', label: '일정', icon: 'path' },
  { id: 'places', label: '장소', icon: 'pin' },
  { id: 'records', label: '기록', icon: 'stamp' },
];

/** 남색 안내판 탭. 좁은 화면은 아래, 넓은 화면은 왼쪽 기둥 */
export function TabBar() {
  const cur = route.value.tab;
  return (
    <nav class="tabs" aria-label="화면">
      {TABS.map(t => (
        <button type="button" key={t.id} class="tab" aria-current={cur === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
          <Icon name={t.icon} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** 사람 동그라미 (자기 색 + 이름 첫 글자) */
export function Avatar({ id, size }) {
  return <span class={'avatar' + (size ? ' avatar-' + size : '')} style={{ background: userColor(id) }} aria-hidden="true">{id ? id[0] : '?'}</span>;
}

/** 머리줄. 왼쪽은 화면마다 다른 내용(children), 오른쪽은 사용자 버튼 */
export function TopBar({ children }) {
  const [open, setOpen] = useState(false);
  const u = user.value;
  return (
    <header class="top">
      <div class="top-main">{children}</div>
      <button type="button" class="top-me" onClick={() => setOpen(true)} aria-label={(u ? u.id : '사용자') + ', 사용자 바꾸기·연결 상태'}>
        <Avatar id={u ? u.id : ''} />
        {sync.value.kind === 'stale' && <i class="top-dot" aria-hidden="true" />}
      </button>
      {open && <MeSheet onClose={() => setOpen(false)} />}
    </header>
  );
}

/** 사용자 목록 (고르기) */
export function UserList({ onPick }) {
  const r = raw.value;
  return (
    <ul class="who">
      {users.value.map(u => {
        const stamps = r && r.visitedBy && r.visitedBy[u.id] ? Object.keys(r.visitedBy[u.id]).length : 0;
        const on = userId.value === u.id;
        return (
          <li key={u.id}>
            <button type="button" class="who-row" aria-pressed={on} onClick={() => { chooseUser(u.id); if (onPick) onPick(u.id); }}>
              <Avatar id={u.id} size="lg" />
              <span class="who-t">
                <b>{u.id}</b>
                <span class="num">{md(u.from)} – {md(u.to)}</span>
              </span>
              <span class="who-s">
                {u.canStamp ? <span>도장 <b class="num">{stamps}</b></span> : <span>보기 전용</span>}
                {u.hasPin && <Icon name="lock" label="PIN 있음" />}
              </span>
              {on && <Icon name="check" label="지금 고른 사용자" class="who-on" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MeSheet({ onClose }) {
  const s = sync.value;
  const [busy, setBusy] = useState(false);
  const text = s.kind === 'fresh' ? '최신 (' + s.savedAt + ' 받음)'
    : s.kind === 'stale' ? '연결 안 됨. ' + (s.savedAt ? s.savedAt + ' 저장본을 보는 중' : '저장본을 보는 중')
    : '받는 중';
  return (
    <Sheet title="누구로 볼까" onClose={onClose}>
      <p class="sheet-lead">고른 사람에 맞춰 일정이 보이고, 도장은 사람마다 따로 모임</p>
      <UserList onPick={onClose} />
      <div class="me-sync">
        <span class={'me-state' + (s.kind === 'stale' ? ' is-stale' : '')}>{s.kind === 'stale' && <Icon name="offline" />}{text}</span>
        <button type="button" class="btn btn-plate btn-sm" disabled={busy} onClick={async () => { setBusy(true); await refresh(); setBusy(false); }}>
          <Icon name="reload" />{busy ? '받는 중' : '다시 받기'}
        </button>
      </div>
      <a class="me-v1" href="/">예전 화면(v1) 열기<Icon name="out" /></a>
    </Sheet>
  );
}

/** 처음 열었을 때: 사용자부터 고름 */
export function FirstWho() {
  return (
    <main class="first">
      <div class="first-in">
        <h1>누구로 볼까</h1>
        <p>고른 사람에 맞춰 일정이 보이고, 도장은 사람마다 따로 모임</p>
        <UserList />
      </div>
    </main>
  );
}

/** 연결이 안 돼 저장본을 보여주는 중일 때만 뜨는 한 줄 */
export function SyncLine() {
  const s = sync.value;
  if (s.kind !== 'stale') return null;
  return (
    <div class="syncline" role="status">
      <Icon name="offline" />
      <span>연결 안 됨. {s.savedAt ? s.savedAt + ' 저장본' : '저장본'}으로 보는 중</span>
      <button type="button" class="btn btn-quiet btn-sm" onClick={() => refresh()}>다시 받기</button>
    </div>
  );
}

/** 처음 받는 중 */
export function Booting() {
  return (
    <main class="first" aria-busy="true">
      <div class="boot">
        <div class="boot-led" aria-hidden="true">案内準備中</div>
        <p role="status">일정 받는 중</p>
      </div>
    </main>
  );
}

/** 저장본도 없는데 못 받았을 때 */
export function LoadError() {
  const [busy, setBusy] = useState(false);
  return (
    <main class="first">
      <div class="state" role="alert">
        <h2>일정을 못 불러옴</h2>
        <p>{sync.value.message}</p>
        <button type="button" class="btn btn-exit" disabled={busy} onClick={async () => { setBusy(true); await refresh(); setBusy(false); }}>
          <Icon name="reload" />{busy ? '받는 중' : '다시 불러오기'}
        </button>
      </div>
    </main>
  );
}

/** 접속 코드 */
export function Locked() {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    if (!code.trim()) { setErr('접속 코드를 입력해야 들어감'); return; }
    setBusy(true);
    try {
      const ok = await unlock(code.trim());
      if (!ok) setErr('코드가 맞지 않음. 다시 입력');
    } catch (ex) {
      setErr(ex.status === 429 ? '시도가 너무 많아 잠깐 막힘. 1분쯤 뒤 다시 입력' : '서버에 연결 안 됨. 네트워크 확인 후 다시 입력');
    }
    setBusy(false);
  };
  return (
    <main class="first">
      <form class="first-in" onSubmit={submit} novalidate>
        <h1>접속 코드</h1>
        <p>일정을 보려면 코드가 필요함</p>
        <label class="field">
          <span>접속 코드</span>
          <input type="password" autocomplete="off" value={code} aria-invalid={err ? 'true' : undefined} aria-describedby="code-err"
            onInput={e => { setCode(e.currentTarget.value); setErr(''); }} />
        </label>
        <p class="field-err" id="code-err" role="alert">{err}</p>
        <button type="submit" class="btn btn-exit btn-block" disabled={busy}>{busy ? '확인 중' : '들어가기'}</button>
      </form>
    </main>
  );
}
