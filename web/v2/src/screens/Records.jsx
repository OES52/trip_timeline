// 기록: 여권(장소마다 도장)과 돈(여행 전체 지출·하루 영수증)
//  머리줄 = 여권 / 돈 전환. 여권 칸을 누르면 도장 찍기(빈칸) 또는 도장 시트, 돈은 날짜를 누르면 그날 영수증
import { useState } from 'preact/hooks';
import { view, nt, user, go, placeOpen, openDialog, showToast } from '../data/store.js';
import { local } from '../data/cache.js';
import { toggleVisit, clearStamps, canRecord } from '../data/records.js';
import { passport, receipt, moneySummary } from '../lib/passport.js';
import { dayLabel, md } from '../lib/time.js';
import { dayCity, vk } from '../lib/trip.js';
import { YEN } from '../lib/money.js';
import { TopBar, SyncLine } from '../ui/Shell.jsx';
import { Sheet } from '../ui/Sheet.jsx';
import { Stamp } from '../ui/Stamp.jsx';
import { Icon } from '../ui/Icon.jsx';
import { saveReceiptImage, SHOP, SHOP_EN } from '../ui/receiptImage.js';

const VIEW_KEY = 'trip2-records-view';
const when = p => p.date.slice(5).replace('-', '.');

function Switch({ cur, set }) {
  return (
    <div class="rtabs" role="group" aria-label="기록 보기">
      {[['pass', '여권'], ['money', '돈']].map(([k, t]) => (
        <button type="button" key={k} aria-pressed={cur === k} onClick={() => set(k)}>{t}</button>
      ))}
    </div>
  );
}

/* ── 여권 ── */

function Cover({ v, ps }) {
  const u = user.value;
  const pct = ps.slots.length ? Math.round((ps.got / ps.slots.length) * 100) : 0;
  return (
    <section class="pcover" aria-label="여권 표지">
      <p class="pcover-t">TRAVEL PASSPORT · 여행 여권</p>
      <p class="pcover-who"><b>{u ? u.id : ''}</b><span class="num">{md(v.dates[0])} – {md(v.dates[v.dates.length - 1])}</span></p>
      <div class="pcover-n">
        <span>도장 <b class="num">{ps.got}</b> / <span class="num">{ps.slots.length}</span></span>
        {ps.gold > 0 && <span class="pcover-gold">금박 <b class="num">{ps.gold}</b></span>}
      </div>
      <div class="pcover-bar" role="progressbar" aria-label="도장 모은 정도" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}><i style={{ width: pct + '%' }} /></div>
    </section>
  );
}

function Slot({ s, onOpen }) {
  if (s.visits.length) {
    return (
      <li class={'slot is-on' + (s.rare ? ' is-rare' : '')}>
        <button type="button" onClick={() => onOpen(s.key)} aria-label={s.name + ' 도장' + (s.rare ? ', 금박 ' + s.rare : '') + ', 자세히'}>
          <Stamp name={s.name} type={s.type} sub={when(s.visits[0])} seed={s.key} rare={s.rare} />
        </button>
      </li>
    );
  }
  const can = canRecord();
  return (
    <li class="slot">
      {can
        ? <button type="button" onClick={() => toggleVisit(s.point)}><span class="slot-n">{s.name}</span><span class="slot-h">눌러서 도장</span></button>
        : <span class="slot-in"><span class="slot-n">{s.name}</span></span>}
    </li>
  );
}

function StampSheet({ v, s, onClose }) {
  const can = canRecord();
  return (
    <Sheet title={s.name} onClose={onClose}>
      <div class="ssheet">
        <div class="ssheet-st"><Stamp name={s.name} type={s.type} sub={when(s.visits[0])} seed={s.key} rare={s.rare} /></div>
        {s.rare && <p class="ssheet-rare">금박 도장 · {s.rare}</p>}
        <ul class="ssheet-v">
          {s.visits.map(p => <li key={vk(p)}><b>{dayLabel(p.date)}</b> <span class="num">{v.arrived[vk(p)] || p.arrive}</span>{v.arrived[vk(p)] ? ' 도착' : ' (계획)'}</li>)}
        </ul>
        <div class="stop-btns">
          {s.place && <button type="button" class="btn btn-plate btn-sm" onClick={() => { onClose(); placeOpen.value = s.place.key; go('places'); }}><Icon name="pin" />장소 보기</button>}
          <button type="button" class="btn btn-plate btn-sm" onClick={() => { onClose(); go('plan', s.visits[0].date); }}><Icon name="path" />그날 일정</button>
          {can && <button type="button" class="btn btn-quiet btn-sm" onClick={() => { onClose(); clearStamps(s.points, s.name); }}>도장 지우기</button>}
        </div>
      </div>
    </Sheet>
  );
}

function Passport({ v }) {
  const ps = passport(v);
  const [open, setOpen] = useState(null);
  const s = open ? ps.slots.find(x => x.key === open && x.visits.length) : null;
  return (
    <div class="rec-in">
      <Cover v={v} ps={ps} />
      {!canRecord() && <p class="rec-note">보기 전용 사용자라 도장을 찍을 수 없음. 도장은 사용자를 바꿔서 찍기</p>}
      {ps.days.map(d => {
        const c = dayCity(v, d.date);
        const got = d.slots.filter(x => x.visits.length).length;
        return (
          <section key={d.date} class="ppage" style={{ '--c': c.color || 'var(--ink-3)' }} aria-label={dayLabel(d.date) + ' 도장 ' + got + '개'}>
            <h2 class="ppage-h"><b>{v.dates.indexOf(d.date) + 1}일차</b><span>{dayLabel(d.date)}{c.name ? ' · ' + c.name : ''}</span><span class="num ppage-n">{got} / {d.slots.length}</span></h2>
            <ul class="slots">{d.slots.map(x => <Slot key={x.key} s={x} onOpen={setOpen} />)}</ul>
          </section>
        );
      })}
      {s && <StampSheet v={v} s={s} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ── 돈 ── */

function Receipt({ r }) {
  const can = canRecord();
  return (
    <div class="rc">
      <p class="rc-shop">{SHOP}</p>
      <p class="rc-en">{SHOP_EN}{r.planned ? ' (예정)' : ''}</p>
      <hr />
      <p class="rc-row"><span>{dayLabel(r.date)} · {r.no}일차</span><b class="num">No.{String(r.no).padStart(4, '0')}</b></p>
      <p class="rc-row"><span>여행자</span><b>{r.user}</b></p>
      {r.route && <p class="rc-row"><span>구간</span><b>{r.route}</b></p>}
      <hr />
      <ul class="rc-items">
        {r.items.map(x => (
          <li key={x.key} class={x.done || x.amount != null ? 'is-done' : ''}>
            <button type="button" disabled={!can} onClick={() => openDialog({ kind: 'spend', key: x.key })} aria-label={x.name + (x.amount != null ? ' 지출 ' + YEN(x.amount) + ', 고치기' : ' 지출 적기')}>
              <span class="rc-t num">{x.time}</span>
              <span class="rc-n">{x.name}{x.memo && <i> {x.memo}</i>}</span>
              <b class="num">{x.amount != null ? YEN(x.amount) : x.done ? '✓' : ''}</b>
            </button>
          </li>
        ))}
      </ul>
      <hr />
      <p class="rc-row"><span>방문 도장</span><b class="num">{r.stamps} / {r.total}</b></p>
      {r.walkKm != null && <p class="rc-row"><span>걸은 거리</span><b class="num">{r.walkKm.toFixed(1)} km{r.walkMin ? ' · ' + r.walkMin + '분' : ''}</b></p>}
      <p class="rc-row"><span>교통비 (1인)</span><b class="num">{YEN(r.fare)}</b></p>
      <p class="rc-row"><span>쓴 돈 (기록)</span><b class="num">{YEN(r.spent)}</b></p>
      <hr class="dbl" />
      <p class="rc-row rc-total"><span>합계{!r.planned && <em class="rc-hanko" aria-hidden="true">領収</em>}</span><b class="num">{YEN(r.sum)}</b></p>
      <p class="rc-thanks">またお越しくださいませ · 또 와요</p>
    </div>
  );
}

function ReceiptSheet({ v, date, onClose }) {
  const r = receipt(v, date, nt.value, user.value ? user.value.id : '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const how = await saveReceiptImage(r); if (how === 'saved') showToast('영수증 그림 저장함'); }
    catch (e) { showToast(e.message); }
    setBusy(false);
  };
  return (
    <Sheet title={dayLabel(date) + ' 영수증'} onClose={onClose}>
      {canRecord() && <p class="sheet-lead">줄을 누르면 그 장소 지출을 적거나 고침</p>}
      <Receipt r={r} />
      <div class="stop-btns">
        <button type="button" class="btn btn-exit btn-sm" disabled={busy} onClick={save}><Icon name="down" />{busy ? '만드는 중' : '그림으로 저장'}</button>
      </div>
    </Sheet>
  );
}

function Money({ v }) {
  const m = moneySummary(v);
  const [open, setOpen] = useState(null);
  const total = m.spent + m.fare;
  const max = Math.max(1, ...m.days.map(d => Math.max(d.spent + d.fare, d.plan)));
  const today = nt.value.date;
  return (
    <div class="rec-in">
      <section class="msum" aria-label="여행 전체 돈">
        <p class="msum-h">여행 전체 · 1인</p>
        <p class="msum-total"><b class="num">{YEN(total)}</b><span>쓴 돈 + 교통비</span></p>
        <dl class="msum-l">
          <div><dt>쓴 돈 (기록 {m.n}건)</dt><dd class="num">{YEN(m.spent)}</dd></div>
          <div><dt>교통비</dt><dd class="num">{YEN(m.fare)}</dd></div>
          {m.plan > 0 && <div><dt>예산 (일정표 금액)</dt><dd class="num">{YEN(m.plan)}</dd></div>}
        </dl>
      </section>
      <section class="block" aria-labelledby="mday-h">
        <h2 class="block-h" id="mday-h">날짜별</h2>
        <p class="rec-note">막대 = 쓴 돈 + 교통비, 눈금 = 예산. 누르면 그날 영수증</p>
        <ol class="mdays">
          {m.days.map((d, i) => {
            const c = dayCity(v, d.date);
            const sum = d.spent + d.fare;
            return (
              <li key={d.date}>
                <button type="button" class={'mday' + (d.date === today ? ' is-today' : '')} style={{ '--c': c.color || 'var(--ink-3)' }} onClick={() => setOpen(d.date)}>
                  <span class="mday-d"><b>{i + 1}일차</b><span>{dayLabel(d.date)}</span></span>
                  <span class="mday-bar" aria-hidden="true">
                    <i style={{ width: (sum / max) * 100 + '%' }} />
                    {d.plan > 0 && <u style={{ left: (d.plan / max) * 100 + '%' }} />}
                  </span>
                  <span class="mday-n"><b class="num">{sum ? YEN(sum) : '–'}</b>{d.plan > 0 && <span class="num">예산 {YEN(d.plan)}</span>}</span>
                  <Icon name="right" />
                </button>
              </li>
            );
          })}
        </ol>
      </section>
      {open && <ReceiptSheet v={v} date={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function Records() {
  const v = view.value;
  const [cur, setCur] = useState(local.get(VIEW_KEY) === 'money' ? 'money' : 'pass');
  const set = k => { setCur(k); local.set(VIEW_KEY, k); };
  return (
    <main class="screen records">
      <TopBar><Switch cur={cur} set={set} /></TopBar>
      <SyncLine />
      <div class="scroll">{cur === 'money' ? <Money v={v} /> : <Passport v={v} />}</div>
    </main>
  );
}
