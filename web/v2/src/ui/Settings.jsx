// 설정 시트 (머리줄 오른쪽 내 동그라미): 보는 사람, 출발 알림, 위치·도착 제안, 인터넷 없이 보기, 연결 상태
import { useState, useEffect } from 'preact/hooks';
import { sync, refresh, user, view, showToast } from '../data/store.js';
import { failed, retryFailed, clearFailed } from '../data/records.js';
import { vk, pname } from '../lib/trip.js';
import { YEN } from '../lib/money.js';
import { appSaved, storage, prep, prepared, readStorage, countPrepared, runPrep, stopPrep } from '../data/offline.js';
import { pushState, pushInfo, readPush, pushOn, pushOff, pushTest } from '../data/push.js';
import { geoState, askOn, setAskOn, startGeo } from '../data/location.js';
import { UserList } from './Shell.jsx';
import { EmergencySet } from './Extras.jsx';
import { Sheet } from './Sheet.jsx';
import { Icon } from './Icon.jsx';

const LEADS = [5, 10, 15, 20, 30];
const mb = b => (b == null ? '?' : b >= 1024 * 1024 * 1024 ? (b / 1024 / 1024 / 1024).toFixed(1) + 'GB' : Math.round(b / 1024 / 1024) + 'MB');

export function SettingsSheet({ onClose }) {
  return (
    <Sheet title="설정" onClose={onClose}>
      <section class="set" aria-labelledby="set-who">
        <h3 id="set-who" class="set-h">보는 사람</h3>
        <p class="set-note">고른 사람에 맞춰 일정이 보이고, 도장은 사람마다 따로 모임</p>
        <UserList onPick={onClose} />
      </section>
      <FailedSet />
      <EmergencySet />
      <PushSet />
      <GeoSet />
      <OfflineSet />
      <SyncSet />
    </Sheet>
  );
}

/** 기록 한 건을 사람이 읽는 글로 */
function opText(v, o) {
  const p = v ? v.points.find(x => vk(x) === o.key) : null;
  const name = p ? pname(v, p) : o.place || o.key;
  if (o.kind === 'visit') return name + (o.value ? ' 도장' : ' 도장 지움');
  if (o.kind === 'arrive') return name + (o.value ? ' 도착 ' + o.value : ' 도착 기록 지움');
  if (o.kind === 'spend') return name + (o.value ? ' 지출 ' + YEN(o.value.amount) : ' 지출 지움');
  return name;
}

/** 서버가 받지 않은 기록 (있을 때만): 다시 보내기 / 지우기 */
function FailedSet() {
  const list = failed.value;
  if (!list.length) return null;
  const v = view.value;
  return (
    <section class="set" aria-labelledby="set-failed">
      <h3 id="set-failed" class="set-h">못 보낸 기록 <em class="tag tag-late">{list.length}건</em></h3>
      <p class="set-note">서버가 받지 않아 따로 둔 기록. 이유를 보고 다시 보내거나 지움</p>
      <ul class="failed-l">
        {list.map(o => <li key={o.id}><b>{o.user}</b> {opText(v, o)}<span>{o.error}</span></li>)}
      </ul>
      <div class="set-btns">
        <button type="button" class="btn btn-plate btn-sm" onClick={retryFailed}><Icon name="reload" />다시 보내기</button>
        <button type="button" class="btn btn-quiet btn-sm btn-danger" onClick={clearFailed}>지우기</button>
      </div>
    </section>
  );
}

/** 출발 알림: 다음 장소로 출발할 시각 n분 전 (서버가 보냄, 앱을 닫아도 옴) */
function PushSet() {
  const [busy, setBusy] = useState('');
  useEffect(() => { readPush(); }, []);
  const st = pushState.value, info = pushInfo.value, u = user.value;
  const [lead, setLead] = useState(info ? info.lead : 15);
  useEffect(() => { if (info) setLead(info.lead); }, [info && info.lead]);
  const run = async (what, fn, done) => {
    setBusy(what);
    try { await fn(); if (done) showToast(done); }
    catch (e) { showToast(e.message); }
    setBusy('');
  };
  const why = st === 'none' ? '이 브라우저는 알림을 못 받음'
    : st === 'install' ? '아이폰은 공유 → 홈 화면에 추가 → 그 아이콘으로 열어야 알림 켤 수 있음 (iOS 16.4 이상)'
    : st === 'denied' ? '알림 권한이 막혀 있음. 폰 설정에서 이 사이트(또는 앱) 알림을 허용한 뒤 다시 열기'
    : st === 'nokey' ? '서버에 알림 설정이 없어서 못 켬' : '';
  const other = info && u && info.user !== u.id;
  const changed = info && (info.lead !== lead || other);
  return (
    <section class="set" aria-labelledby="set-push">
      <h3 id="set-push" class="set-h">출발 알림 {st === 'on' && <em class="tag tag-ok">켜짐</em>}</h3>
      <p class="set-note">다음 장소로 출발할 시각 몇 분 전에 알림. 앱을 닫아도 옴. 도착 기록으로 늦어진 만큼 알림도 밀림</p>
      {why ? <p class="set-warn">{why}</p> : (
        <>
          <div class="chips" role="group" aria-label="출발 몇 분 전">
            {LEADS.map(n => <button type="button" key={n} class="chip" aria-pressed={lead === n} onClick={() => setLead(n)}>{n}분 전</button>)}
          </div>
          {info && <p class="set-note">{info.user} 일정 기준 · 출발 {info.lead}분 전{other ? '. 지금 고른 ' + u.id + ' 기준으로 바꾸려면 저장' : ''}</p>}
          <div class="set-btns">
            {st !== 'on' && <button type="button" class="btn btn-exit btn-sm" disabled={!!busy} onClick={() => run('on', () => pushOn(lead), '출발 ' + lead + '분 전 알림 켬')}><Icon name="clock" />{busy === 'on' ? '켜는 중' : '알림 켜기'}</button>}
            {st === 'on' && changed && <button type="button" class="btn btn-exit btn-sm" disabled={!!busy} onClick={() => run('on', () => pushOn(lead), '출발 ' + lead + '분 전으로 저장')}>{busy === 'on' ? '저장 중' : '바꾼 설정 저장'}</button>}
            {st === 'on' && <button type="button" class="btn btn-plate btn-sm" disabled={!!busy} onClick={() => run('test', pushTest, '시험 알림 보냄. 몇 초 안에 와야 정상')}>{busy === 'test' ? '보내는 중' : '시험 알림 보내기'}</button>}
            {st === 'on' && <button type="button" class="btn btn-quiet btn-sm" disabled={!!busy} onClick={() => run('off', pushOff, '출발 알림 끔')}>알림 끄기</button>}
          </div>
        </>
      )}
    </section>
  );
}

/** 위치: 다음 장소까지 걸어서 몇 분인지, 근처 오면 도착 찍을지 묻기. 앱이 열려 있을 때만 */
function GeoSet() {
  const g = geoState.value, u = user.value;
  const on = askOn.value;
  return (
    <section class="set" aria-labelledby="set-geo">
      <h3 id="set-geo" class="set-h">위치 {g === 'on' && <em class="tag tag-ok">보는 중</em>}</h3>
      <p class="set-note">오늘 화면에 다음 장소까지 걸어서 몇 분인지 보여주고, 장소 근처에 1분 넘게 있으면 도착을 찍을지 물어봄. 앱이 열려 있을 때만 씀</p>
      {g === 'none' && <p class="set-warn">이 브라우저는 위치를 못 씀</p>}
      {g === 'denied' && <p class="set-warn">위치 권한이 막혀 있음. 폰 설정에서 이 사이트(또는 앱) 위치를 허용한 뒤 다시 열기</p>}
      {g !== 'none' && g !== 'denied' && (
        <div class="set-btns">
          <label class="switch">
            <input type="checkbox" role="switch" checked={on} disabled={!u || !u.canStamp} onChange={e => setAskOn(e.currentTarget.checked)} />
            <span>근처 오면 도착 찍을지 묻기{u && !u.canStamp ? ' (보기 전용 사용자는 못 씀)' : ''}</span>
          </label>
          {g !== 'on' && <button type="button" class="btn btn-plate btn-sm" onClick={startGeo}><Icon name="nav" />위치 켜기</button>}
        </div>
      )}
    </section>
  );
}

/** 인터넷 없이 보기: 앱 화면 저장 상태 + 지도·사진 미리 받기 */
function OfflineSet() {
  useEffect(() => { readStorage(); countPrepared(); }, []);
  const p = prep.value, c = prepared.value, st = storage.value;
  const start = async () => {
    const r = await runPrep();
    if (!r) return;
    showToast(r.stopped ? '미리 받기를 멈춤. 다시 누르면 받은 곳부터 이어 받음'
      : r.fail ? '미리 받기 끝. ' + r.fail + '개는 못 받음. 다시 누르면 그것만 다시 받음'
      : '미리 받기 끝. 인터넷 없이도 지도와 사진이 보임');
  };
  const all = c && c.map === c.mapAll && c.photo === c.photoAll;
  return (
    <section class="set" aria-labelledby="set-off">
      <h3 id="set-off" class="set-h">인터넷 없이 보기</h3>
      <dl class="off-l">
        <div><dt>일정·기록</dt><dd>이 폰에 저장됨</dd></div>
        <div><dt>앱 화면</dt><dd>{appSaved.value ? '이 폰에 저장됨' : '저장 안 됨 (이 브라우저는 못 함)'}</dd></div>
        <div><dt>지도</dt><dd>{c ? <><span class="num">{c.map} / {c.mapAll}</span>{c.map < c.mapAll ? ' · 다 받으면 약 ' + c.estMB + 'MB' : ' · 다 받음'}</> : '세는 중'}</dd></div>
        <div><dt>장소 사진</dt><dd>{c ? <><span class="num">{c.photo} / {c.photoAll}</span>{c.photo < c.photoAll ? '' : ' · 다 받음'}</> : '세는 중'}</dd></div>
        {st && st.usage != null && <div><dt>저장 공간</dt><dd><span class="num">{mb(st.usage)}</span> 사용{st.quota ? ' · 남은 곳 ' + mb(st.quota - st.usage) : ''}{st.persisted ? ' · 안 지워지게 잡아 둠' : ''}</dd></div>}
      </dl>
      {p ? (
        <div class="off-run" role="status">
          <div class="off-bar" aria-hidden="true"><i style={{ width: Math.round((p.done / Math.max(1, p.total)) * 100) + '%' }} /></div>
          <span class="num">{p.done} / {p.total}{p.fail ? ' · 못 받음 ' + p.fail : ''}</span>
          <button type="button" class="btn btn-plate btn-sm" disabled={p.stop} onClick={stopPrep}>{p.stop ? '멈추는 중' : '멈추기'}</button>
        </div>
      ) : (
        <>
          <p class="set-note">일정 주변 지도와 장소 사진을 미리 받아 둠. 와이파이에서 받기</p>
          <div class="set-btns">
            <button type="button" class={'btn btn-sm ' + (all ? 'btn-plate' : 'btn-exit')} disabled={!('caches' in window)} onClick={start}>
              <Icon name="down" />{all ? '다시 확인하기' : '지도·사진 미리 받기'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function SyncSet() {
  const s = sync.value;
  const [busy, setBusy] = useState(false);
  const text = s.kind === 'fresh' ? '최신 (' + s.savedAt + ' 받음)'
    : s.kind === 'stale' ? '연결 안 됨. ' + (s.savedAt ? s.savedAt + ' 저장본을 보는 중' : '저장본을 보는 중')
    : s.kind === 'locked' ? '접속 코드 필요. ' + (s.savedAt ? s.savedAt + ' 저장본을 보는 중' : '저장본을 보는 중')
    : '받는 중';
  return (
    <div class="me-sync">
      <span class={'me-state' + (s.kind === 'stale' || s.kind === 'locked' ? ' is-stale' : '')}>{s.kind === 'stale' && <Icon name="offline" />}{s.kind === 'locked' && <Icon name="lock" />}{text}</span>
      <button type="button" class="btn btn-plate btn-sm" disabled={busy} onClick={async () => { setBusy(true); await refresh(); setBusy(false); }}>
        <Icon name="reload" />{busy ? '받는 중' : '다시 받기'}
      </button>
    </div>
  );
}
