// 껍데기: 머리줄(흰 판), 탭(남색 안내판), 사용자 고르기, 연결 상태 줄
import { useState } from 'preact/hooks';
import { route, go, user, users, userId, chooseUser, sync, refresh, raw, view, unlock, ops, sendState, openDialog, settingsOpen } from '../data/store.js';
import { stampCount } from '../lib/passport.js';
import { getPin, flush, failed, sendError } from '../data/records.js';
import { updateReady } from '../data/offline.js';
import { PinForm } from './Dialogs.jsx';
import { Sheet } from './Sheet.jsx';
import { userColor } from '../lib/colors.js';
import { md, tokyoNow, hhmm } from '../lib/time.js';
import { preview } from '../preview.js';
import { Icon } from './Icon.jsx';
import { SettingsSheet } from './Settings.jsx';

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
  const u = user.value;
  const k = sync.value.kind;
  return (
    <header class="top">
      <div class="top-main">{children}</div>
      <button type="button" class="top-me" onClick={() => { settingsOpen.value = true; }} aria-label={(u ? u.id : '사용자') + ', 설정 (사용자·알림·위치·오프라인)'}>
        <Avatar id={u ? u.id : ''} />
        {(k === 'stale' || k === 'locked' || failed.value.length > 0) && <i class="top-dot" aria-hidden="true" />}
      </button>
      {settingsOpen.value && <SettingsSheet onClose={() => { settingsOpen.value = false; }} />}
    </header>
  );
}

/** 사용자 목록 (고르기) */
export function UserList({ onPick }) {
  const r = raw.value;
  const [ask, setAsk] = useState(null);   // PIN을 물어볼 사용자 id
  const choose = id => { chooseUser(id); if (onPick) onPick(id); };
  if (ask) {
    return (
      <div class="who-pin">
        <p class="who-pin-h"><Avatar id={ask} size="lg" /><b>{ask}</b></p>
        <PinForm id={ask} okLabel={ask + '(으)로 들어가기'} onDone={() => choose(ask)} onCancel={() => setAsk(null)} cancelLabel="다른 사용자 고르기" />
      </div>
    );
  }
  return (
    <ul class="who">
      {users.value.map(u => {
        const stamps = r && r.visitedBy && view.value ? stampCount(view.value, r.visitedBy[u.id]) : 0;
        const on = userId.value === u.id;
        return (
          <li key={u.id}>
            <button type="button" class="who-row" aria-pressed={on} onClick={() => (u.hasPin && !getPin(u.id) ? setAsk(u.id) : choose(u.id))}>
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

/** 시간 미리보기(?now=) 중일 때 맨 위 한 줄 */
function PreviewLine() {
  const t = tokyoNow(new Date(preview.start));
  return (
    <div class="syncline syncline-preview" role="status">
      <Icon name="clock" />
      <span>미리보기 <b class="num">{md(t.date)} {hhmm(t.min)}</b>부터 · 기록 안 남음</span>
      <a class="btn btn-quiet btn-sm" href={preview.exitUrl}>끝내기</a>
    </div>
  );
}

/** 연결 상태 줄: 저장본을 보는 중·안 보낸 기록·PIN 필요할 때만 (시간 미리보기 중이면 그 줄이 먼저) */
export function SyncLine() {
  return preview.on ? <><PreviewLine /><SyncState /></> : <SyncState />;
}

function SyncState() {
  const s = sync.value;
  const n = ops.value.length, send = sendState.value, bad = failed.value.length;
  const [askCode, setAskCode] = useState(false);
  // 접속 코드가 바뀌었거나 세션이 끝남: 저장본만 보이고 기록도 못 보냄 (기록은 폰에 그대로)
  if (s.kind === 'locked' || send === 'locked') {
    return (
      <>
        <div class="syncline" role="status">
          <Icon name="lock" />
          <span>접속 코드를 다시 넣어야 최신 일정을 받음{s.savedAt ? ' (지금은 ' + s.savedAt + ' 저장본)' : ''}{n ? '. 안 보낸 기록 ' + n + '건은 폰에 있음' : ''}</span>
          <button type="button" class="btn btn-quiet btn-sm" onClick={() => setAskCode(true)}>코드 입력</button>
        </div>
        {askCode && (
          <Sheet title="접속 코드" onClose={() => setAskCode(false)}>
            <p class="sheet-lead">코드를 넣으면 최신 일정을 다시 받고, 밀린 기록도 이어서 보냄</p>
            <CodeForm okLabel="코드 확인" onDone={() => setAskCode(false)} />
          </Sheet>
        )}
      </>
    );
  }
  // PIN을 넣어야 저장되는 기록이 있음
  if (n && send === 'pin') {
    return (
      <div class="syncline" role="status">
        <Icon name="lock" />
        <span>PIN을 넣어야 기록 {n}건이 저장됨</span>
        <button type="button" class="btn btn-quiet btn-sm" onClick={() => openDialog({ kind: 'pin', id: ops.value[0].user, error: '' })}>PIN 입력</button>
      </div>
    );
  }
  if (s.kind === 'stale') {
    return (
      <div class="syncline" role="status">
        <Icon name="offline" />
        <span>연결 안 됨. {s.savedAt ? s.savedAt + ' 저장본' : '저장본'}으로 보는 중{n ? ', 안 보낸 기록 ' + n + '건' : ''}</span>
        <button type="button" class="btn btn-quiet btn-sm" onClick={() => { refresh(); flush(true); }}>다시 연결</button>
      </div>
    );
  }
  // 일정은 받았는데 기록만 못 보낸 상태 (연결 없음, 또는 서버 오류로 간격 두고 다시 보내는 중)
  if (n && send === 'waiting') {
    const err = sendError.value;
    return (
      <div class="syncline" role="status">
        <Icon name={err ? 'warn' : 'offline'} />
        <span>{err ? '서버가 잠깐 기록을 안 받음. 안 보낸 기록 ' + n + '건, 알아서 다시 보냄' : '안 보낸 기록 ' + n + '건. 연결되면 알아서 보냄'}</span>
        <button type="button" class="btn btn-quiet btn-sm" onClick={() => flush(true)}>지금 보내기</button>
      </div>
    );
  }
  // 새 버전을 받아 둠: 다시 열면 적용 (한동안 다른 앱에 있다 돌아오면 저절로)
  if (updateReady.value && !bad) {
    return (
      <div class="syncline syncline-info" role="status">
        <Icon name="reload" />
        <span>새 버전을 받아 둠. 다시 열면 바뀜</span>
        <button type="button" class="btn btn-quiet btn-sm" onClick={() => location.reload()}>다시 열기</button>
      </div>
    );
  }
  // 서버가 받지 않아 따로 둔 기록
  if (bad) {
    return (
      <div class="syncline" role="status">
        <Icon name="warn" />
        <span>서버가 안 받은 기록 {bad}건. 설정에서 다시 보내거나 지움</span>
        <button type="button" class="btn btn-quiet btn-sm" onClick={() => { settingsOpen.value = true; }}>보기</button>
      </div>
    );
  }
  return null;
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

/** 접속 코드 입력. 맞으면 최신 일정을 다시 받고 onDone (처음 화면과 연결 줄의 시트가 같이 씀) */
export function CodeForm({ okLabel, onDone }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    if (!code.trim()) { setErr('접속 코드를 입력해야 들어감'); return; }
    setBusy(true);
    try {
      const ok = await unlock(code.trim());
      if (ok) { if (onDone) onDone(); return; }
      setErr('코드가 맞지 않음. 다시 입력');
    } catch (ex) {
      setErr(ex.status === 429 ? '시도가 너무 많아 잠깐 막힘. 1분쯤 뒤 다시 입력' : '서버에 연결 안 됨. 네트워크 확인 후 다시 입력');
    }
    setBusy(false);
  };
  return (
    <form class="form" onSubmit={submit} novalidate>
      <label class="field">
        <span>접속 코드</span>
        <input type="password" autocomplete="off" data-autofocus value={code} aria-invalid={err ? 'true' : undefined} aria-describedby="code-err"
          onInput={e => { setCode(e.currentTarget.value); setErr(''); }} />
      </label>
      <p class="field-err" id="code-err" role="alert">{err}</p>
      <button type="submit" class="btn btn-exit btn-block" disabled={busy}>{busy ? '확인 중' : okLabel || '들어가기'}</button>
    </form>
  );
}

/** 접속 코드 (저장본도 없을 때 첫 화면) */
export function Locked() {
  return (
    <main class="first">
      <div class="first-in">
        <h1>접속 코드</h1>
        <p>일정을 보려면 코드가 필요함</p>
        <CodeForm />
      </div>
    </main>
  );
}
