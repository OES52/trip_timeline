// 할 일 · 예약·티켓 · 보여주기 카드 · 비상 연락처
//  할 일·예약은 시트("할 일", "예약")에서 오고, 보여주기는 장소 시트의 일본어 이름·주소를 씀
import { useState } from 'preact/hooks';
import { view, user, go, pick, showToast, bookingOpen, showPlace } from '../data/store.js';
import { toggleTodo, canRecord } from '../data/records.js';
import { myTodos, ddayText, myBookings, bookingPoint, phoneOf, lodgings, canShow } from '../lib/extras.js';
import { pname, vk } from '../lib/trip.js';
import { dayLabel, fmtHM } from '../lib/time.js';
import { navUrl, photoUrl } from '../lib/geo.js';
import { placeName } from '../lib/places.js';
import { Sheet } from './Sheet.jsx';
import { Icon } from './Icon.jsx';

/** 글 속 주소(https://…)는 누를 수 있게 */
function Linkify({ text }) {
  const parts = String(text || '').split(/(https?:\/\/[^\s]+)/g);
  return <>{parts.map((s, i) => (i % 2 ? <a key={i} href={s} target="_blank" rel="noopener">{s.replace(/^https?:\/\//, '').slice(0, 40)}</a> : s))}</>;
}

/* ── 할 일 ── */

function TodoRow({ t, today, can }) {
  const late = !t.done && t.date && t.date < today;
  const dd = ddayText(t.date, today);
  return (
    <li class={'todo' + (t.done ? ' is-done' : '') + (late ? ' is-late' : '')}>
      <button type="button" class="todo-ck" role="checkbox" aria-checked={t.done ? 'true' : 'false'} disabled={!can}
        aria-label={t.text + (t.done ? ', 끝냄' : '')} onClick={() => toggleTodo(t)}>
        <Icon name="check" />
      </button>
      <div class="todo-t">
        <p class="todo-n">{t.text}</p>
        <p class="todo-m">
          {dd && <b class={'todo-d' + (dd === '오늘' ? ' is-today' : '')}>{dd}</b>}
          {t.date && <span class="num">{dayLabel(t.date)}{t.time ? ' ' + t.time : ''}</span>}
          {t.who.length > 0 && <span>{t.who.join(', ')}</span>}
          {t.done && t.doneBy && <span>{t.doneBy} 끝냄</span>}
        </p>
        {t.memo && <p class="todo-memo"><Linkify text={t.memo} /></p>}
      </div>
    </li>
  );
}

/** 오늘 화면: 할 일 (안 끝낸 것 먼저, 끝낸 건 접어 둠) */
export function TodoBlock({ v, today }) {
  const u = user.value;
  const [showDone, setShowDone] = useState(false);
  const list = myTodos(v, u ? u.id : '');
  if (!list.length) return null;
  const open = list.filter(t => !t.done), done = list.filter(t => t.done);
  const can = canRecord();
  return (
    <section class="block" aria-labelledby="todo-h">
      <h2 class="block-h" id="todo-h">할 일 {open.length > 0 && <span class="num">{open.length}</span>}</h2>
      {open.length === 0 && <p class="todo-none">다 끝냄</p>}
      <ul class="todos">
        {open.map(t => <TodoRow key={t.key} t={t} today={today} can={can} />)}
        {showDone && done.map(t => <TodoRow key={t.key} t={t} today={today} can={can} />)}
      </ul>
      {done.length > 0 && (
        <button type="button" class="btn btn-quiet btn-sm todo-more" aria-expanded={showDone} onClick={() => setShowDone(x => !x)}>
          {showDone ? '끝낸 일 접기' : '끝낸 일 ' + done.length + '개 보기'}
        </button>
      )}
      {!can && <p class="todo-none">보기 전용 사용자라 체크는 못 함</p>}
    </section>
  );
}

/* ── 예약·티켓 ── */

/** 오늘 화면: 앞으로 쓸 예약·티켓 목록 */
export function BookingBlock({ v, today }) {
  const u = user.value;
  const list = myBookings(v, u ? u.id : '', today);
  if (!list.length) return null;
  return (
    <section class="block" aria-labelledby="book-h">
      <h2 class="block-h" id="book-h">예약·티켓</h2>
      <ul class="books">
        {list.map(({ b, p }) => (
          <li key={b.key}>
            <button type="button" class="book-row" onClick={() => { bookingOpen.value = b.key; }}>
              <Icon name="ticket" />
              <span class="book-t">
                <b>{b.title || b.no || '예약'}</b>
                <span>{b.date ? dayLabel(b.date) : '날짜 없음'}{p ? ' · ' + pname(v, p) : b.place ? ' · ' + b.place : ''}</span>
              </span>
              <Icon name="right" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 일정 줄·다음 장소 카드에 붙는 예약 버튼들 */
export function BookingButtons({ list }) {
  if (!list || !list.length) return null;
  return list.map(b => (
    <button type="button" key={b.key} class="btn btn-plate btn-sm" onClick={() => { bookingOpen.value = b.key; }}>
      <Icon name="ticket" />{b.title || '예약'}
    </button>
  ));
}

/** 예약 시트 (앱 맨 바깥에 하나): 예약번호 크게 + 복사, 티켓 그림, 링크 */
export function BookingSheet() {
  const key = bookingOpen.value, v = view.value;
  const b = key && v ? v.bookings.find(x => x.key === key) : null;
  if (!b) return null;
  const p = bookingPoint(v, b);
  const close = () => { bookingOpen.value = null; };
  const copy = async () => {
    try { await navigator.clipboard.writeText(b.no); showToast('예약번호 복사함'); }
    catch (e) { showToast('복사 못 함. 번호를 길게 눌러서 복사'); }
  };
  return (
    <Sheet title={b.title || '예약'} onClose={close}>
      <div class="bsheet">
        {(b.date || p || b.place) && (
          <p class="bsheet-m">
            {b.date ? dayLabel(b.date) : ''}
            {p ? ' · ' + (p.arrive ? fmtHM(p.arrive) + ' ' : '') + pname(v, p) : b.place ? ' · ' + b.place : ''}
          </p>
        )}
        {b.no && (
          <div class="bsheet-no">
            <span>예약번호</span>
            <b class="num">{b.no}</b>
            <button type="button" class="btn btn-plate btn-sm" onClick={copy}>복사</button>
          </div>
        )}
        {/* 티켓 그림은 줄이지 않은 원본으로 (QR이 뭉개지지 않게). 한 번 열면 폰에 저장됨 */}
        {b.images.map((u, i) => <img key={i} class="bsheet-img" src={photoUrl(u)} alt={'티켓 그림 ' + (i + 1)} onError={e => { e.currentTarget.hidden = true; }} />)}
        {b.memo && <p class="stop-memo"><Linkify text={b.memo} /></p>}
        <div class="stop-btns">
          {b.link && <a class="btn btn-plate btn-sm" href={b.link} target="_blank" rel="noopener"><Icon name="out" />예약 열기</a>}
          {p && <button type="button" class="btn btn-plate btn-sm" onClick={() => { close(); pick(vk(p), 'map'); go('plan', p.date); }}><Icon name="path" />일정에서 보기</button>}
        </div>
      </div>
    </Sheet>
  );
}

/* ── 보여주기 카드 ── */

/** "보여주기" 버튼 (일본어 이름이나 주소가 있는 장소만) */
export function ShowButton({ pl, label }) {
  if (!canShow(pl)) return null;
  return <button type="button" class="btn btn-plate btn-sm" onClick={() => { showPlace.value = pl.key; }}><Icon name="taxi" />{label || '보여주기'}</button>;
}

/** 택시 기사·역무원에게 그대로 보여주는 카드 (앱 맨 바깥에 하나) */
export function ShowCard() {
  const key = showPlace.value, v = view.value;
  const pl = key && v ? v.placeByKey.get(key) : null;
  if (!pl) return null;
  return (
    <Sheet title={placeName(pl) + ' 보여주기'} onClose={() => { showPlace.value = null; }} full>
      <div class="show">
        <p class="show-lead" lang="ja">ここへ行ってください</p>
        <p class="show-ja" lang="ja">{pl.ja || pl.name}</p>
        {pl.addr && <p class="show-addr" lang="ja">{pl.addr}</p>}
        <p class="show-ko">{placeName(pl)}{pl.area ? ' · ' + pl.area : ''}. 화면을 그대로 보여주기</p>
        <div class="stop-btns">
          {pl.lat != null && <a class="btn btn-exit btn-sm" href={navUrl(pl.lat, pl.lng)} target="_blank" rel="noopener"><Icon name="nav" />길찾기</a>}
          {pl.link && <a class="btn btn-plate btn-sm" href={pl.link} target="_blank" rel="noopener"><Icon name="map" />지도에서 보기</a>}
        </div>
      </div>
    </Sheet>
  );
}

/* ── 비상 연락처 (설정 시트) ── */

// 확인: 외교부 영사안전콜센터, JNTO Japan Visitor Hotline 공식 안내 (2026-11)
const BUILTIN = [
  { text: '경찰 110', tel: '110' },
  { text: '구급차·소방 119', tel: '119' },
  { text: '영사안전콜센터 (외교부, 24시간 한국어) +82-2-3210-0404', tel: '+82232100404' },
  { text: 'Japan Visitor Hotline (24시간, 한국어 가능) 050-3816-2787', tel: '05038162787' },
];

export function EmergencySet() {
  const v = view.value;
  if (!v) return null;
  const extra = (v.emergency || []).map(phoneOf);
  const homes = lodgings(v).filter(canShow);
  return (
    <section class="set" aria-labelledby="set-sos">
      <h3 id="set-sos" class="set-h">비상 연락처</h3>
      <ul class="sos">
        {BUILTIN.concat(extra).map((x, i) => (
          <li key={i}>{x.tel ? <a href={'tel:' + x.tel}><Icon name="phone" />{x.text}</a> : <span>{x.text}</span>}</li>
        ))}
      </ul>
      {extra.length === 0 && <p class="set-note">여행자 보험 번호 등은 시트 "설정"의 비상 연락처 칸에 넣으면 여기 나옴</p>}
      {homes.length > 0 && (
        <div class="set-btns">
          {homes.map(pl => <ShowButton key={pl.key} pl={pl} label={placeName(pl) + ' 주소 보여주기'} />)}
        </div>
      )}
    </section>
  );
}
