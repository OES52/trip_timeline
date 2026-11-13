// 하루 타임라인. 오늘 화면(남은 일정)과 일정 화면이 같은 부품을 씀
//  장소 줄 하나 = 시각 | 선 위의 점 | 이름·한 줄 설명 | 행동 하나. 누르면 펼쳐서 사진·영업시간·메모
import { useEffect, useRef, useState } from 'preact/hooks';
import { view, nt as ntSig } from '../data/store.js';
import { toMin, hhmm, fmtDur } from '../lib/time.js';
import {
  vk, placeOf, pname, dayPoints, stopStates, isVisited, arrivedAt, arrivalDiff, predictedMin, dayDelay,
  MODE_KEY, segModeName, segRides, lastTrain,
} from '../lib/trip.js';
import { hoursFor, warnings } from '../lib/hours.js';
import { sunsetMin } from '../lib/sun.js';
import { canSplit, stepRows } from '../lib/steps.js';
import { YEN, costText, perText } from '../lib/money.js';
import { navUrl, fmtDist, photoUrl } from '../lib/geo.js';
import { onColor } from '../lib/colors.js';
import { Icon } from './Icon.jsx';
import { MODE_ICON, vehicleIcon, placeIcon, manualIcon } from './icons.js';

const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);

/** 구간의 선 색과 모양 */
function segLine(s) {
  if (!s) return { c: 'var(--hair-2)', dash: false };
  if (s.taxi && s.taxi.on) return { c: 'var(--mode-car)', dash: false };
  const k = MODE_KEY[s.mode] || 'manual';
  if (k === 'transit') { const r = segRides(s)[0]; return { c: (r && r.color) || 'var(--mode-transit)', dash: false }; }
  if (k === 'walk') return { c: 'var(--mode-walk)', dash: true };
  if (k === 'car') return { c: 'var(--mode-car)', dash: false };
  return { c: 'var(--ink-3)', dash: true };
}

function LineBadge({ line, color }) {
  return <span class="line" style={color ? { '--lc': color, '--lt': onColor(color) } : undefined}>{line}</span>;
}

/* ── 장소 줄 ── */
function Stop({ v, p, state, first, last, cIn, cOut, open, onToggle, compact }) {
  const pl = placeOf(v, p);
  const key = vk(p);
  const name = pname(v, p);
  const visited = isVisited(v, p);
  const arr = arrivedAt(v, p);
  const diff = arrivalDiff(v, p);
  const pred = predictedMin(v, p);
  const delay = dayDelay(v, p.date);
  const warns = warnings(p, pl, v.closeSoonMin);
  const type = pl && pl.type ? pl.type : '';
  const sub = p.activity || (pl && pl.area) || type;
  const hf = pl ? hoursFor(pl.hours, p.date) : null;
  const sp = v.spend[key];
  const canNav = p.lat != null && p.lng != null;

  const facts = [];
  if (p.stay) facts.push(['체류', fmtDur(p.stay)]);
  if (p.fixed) facts.push(['고정', p.fixed]);
  if (p.yen != null && !isNaN(p.yen)) facts.push(['예산', YEN(p.yen) + (p.per ? ' (1인 ' + perText(p, v.rate) + ')' : '')]);
  else if (pl && costText(pl)) facts.push(['예상', costText(pl)]);
  if (hf) facts.push(['영업', (hf.closed ? '휴무' : hf.text) + (hf.label ? ' (' + hf.label + ')' : '')]);
  if (pl && pl.closed) facts.push(['휴무', pl.closed]);
  if (sp) facts.push(['실제', YEN(sp.amount) + (sp.memo ? ' (' + sp.memo + ')' : '')]);
  if (p.slack != null && !isNaN(p.slack)) facts.push(p.slack < 0 ? ['시간', Math.abs(p.slack) + '분 늦음', 'late'] : ['여유', p.slack + '분', 'ok']);

  return (
    <li class={'stop is-' + state + (visited ? ' is-done' : '') + (first ? ' is-first' : '') + (last ? ' is-last' : '') + (open ? ' is-open' : '')}
      style={{ '--c-in': cIn, '--c-out': cOut }} data-key={key}>
      <div class="stop-rail" aria-hidden="true"><i class="dot">{visited && <Icon name="check" />}</i></div>
      <button type="button" class="stop-head" aria-expanded={open} aria-controls={'more-' + key} onClick={onToggle}>
        <span class="stop-time">
          <b class="num">{p.arrive || ''}</b>
          {p.depart && p.depart !== p.arrive && <span class="num">~{p.depart}</span>}
          {arr
            ? <span class={'stop-real ' + (diff > 0 ? 'note-late' : 'note-ok')}>실제 <span class="num">{arr}</span>{diff ? ' (' + sgn(diff) + ')' : ''}</span>
            : pred != null && delay && delay.delay
              ? <span class={'stop-real ' + (delay.delay > 0 ? 'note-late' : 'note-ok')}>예상 <span class="num">{hhmm(pred)}</span></span>
              : null}
        </span>
        <span class="stop-body">
          <span class="stop-n">
            {name}
            {state === 'now' && <em class="tag tag-now">지금</em>}
            {state === 'next' && <em class="tag tag-next">다음</em>}
          </span>
          {sub && <span class="stop-m">{type && <Icon name={placeIcon(type, name)} label={type} />}<span>{sub}</span></span>}
          {warns.map((w, i) => <span class="stop-w" key={i}><Icon name="warn" label="주의" /><span>{w}</span></span>)}
          {p.slack != null && p.slack < 0 && <span class="stop-w"><Icon name="clock" /><span>{Math.abs(p.slack)}분 늦음</span></span>}
        </span>
        <Icon name="down" class="stop-caret" />
      </button>
      {state === 'next' && canNav && !compact && (
        <div class="stop-act">
          <a class="btn btn-exit btn-sm" href={navUrl(p.lat, p.lng)} target="_blank" rel="noopener"><Icon name="nav" />길찾기</a>
        </div>
      )}
      {open && (
        <div class="stop-more" id={'more-' + key}>
          {pl && pl.photos && pl.photos[0] && <img class="stop-photo" src={photoUrl(pl.photos[0])} alt="" loading="lazy" onError={e => { e.currentTarget.hidden = true; }} />}
          {name !== p.place && <p class="stop-alt">{p.place}</p>}
          {facts.length > 0 && (
            <dl class="facts">
              {facts.map(([k, val, tone]) => <div key={k}><dt>{k}</dt><dd class={tone ? 'note-' + tone : undefined}>{val}</dd></div>)}
            </dl>
          )}
          {pl && pl.menu && pl.menu.length > 0 && <ul class="menu">{pl.menu.slice(0, 5).map((m, i) => <li key={i}>{m}</li>)}</ul>}
          {pl && pl.intro && <p class="stop-intro">{pl.intro}</p>}
          {p.memo && <p class="stop-memo">{p.memo}</p>}
          <div class="stop-btns">
            {canNav && <a class={'btn btn-sm ' + (state === 'next' && !compact ? 'btn-plate' : 'btn-exit')} href={navUrl(p.lat, p.lng)} target="_blank" rel="noopener"><Icon name="nav" />길찾기</a>}
            {pl && pl.link && <a class="btn btn-plate btn-sm" href={pl.link} target="_blank" rel="noopener"><Icon name="map" />지도에서 보기</a>}
          </div>
        </div>
      )}
    </li>
  );
}

/* ── 이동 줄 ── */
function Move({ v, s, past, open, onToggle, fromName, toName, now, tail }) {
  const taxiOn = s.taxi && s.taxi.on;
  const k = taxiOn ? 'taxi' : MODE_KEY[s.mode] || 'manual';
  const rides = segRides(s);
  const ln = segLine(s);
  const lt = lastTrain(s, now);
  const split = canSplit(s);
  const approx = String(s.summary || '').indexOf('[같은 요일 시간표 기준]') === 0;
  const fare = s.fare != null && !isNaN(s.fare) && s.fare > 0 ? YEN(s.fare) : '';
  const transfers = s.transfers !== '' && Number(s.transfers) > 0 ? '환승 ' + s.transfers + '회' : '';
  const key = s.date + '>' + s.fromOrder;
  const summary = String(s.summary || '').replace('[같은 요일 시간표 기준]', '').trim();
  return (
    <>
      <li class={'move k-' + k + (ln.dash ? ' is-dash' : '') + (past ? ' is-past' : '') + (open ? ' is-open' : '')} style={{ '--c': ln.c }}>
        <div class="move-rail" aria-hidden="true" />
        <button type="button" class="move-head" aria-expanded={open} aria-controls={'mv-' + key} onClick={onToggle}>
          <Icon name={k === 'manual' ? manualIcon(fromName, toName, summary) : MODE_ICON[k]} label={rides.length ? segModeName(s) : undefined} />
          <b>{tail ? '다음 날로 ' : ''}{rides.length ? '' : segModeName(s) + ' '}{fmtDur(s.minutes)}</b>
          {rides.slice(0, 3).map((r, i) => <LineBadge key={i} line={r.line} color={r.color} />)}
          {rides.length > 3 && <span class="move-x">외 {rides.length - 3}</span>}
          {fare && <span class="move-x num">{fare}</span>}
          {transfers && <span class="move-x">{transfers}</span>}
          <Icon name="down" class="move-caret" />
        </button>
        {(s.warn || (lt && lt.level !== 'info')) && (
          <div class="move-alert">
            {s.warn && <p><Icon name="warn" label="주의" /><span>{s.warn}</span></p>}
            {lt && lt.level !== 'info' && <p><Icon name="moon" label="막차" /><span>{lt.text}</span></p>}
          </div>
        )}
        {open && (
          <div class="move-more" id={'mv-' + key}>
            <p class="num move-t">{s.dep} 출발, {s.arr} 도착</p>
            {lt && lt.level === 'info' && <p class="move-i"><Icon name="moon" /><span>{lt.text}</span></p>}
            {s.walkHint && <p class="move-i note-ok"><Icon name="walk" /><span>걸어도 됨: {s.walkHint}</span></p>}
            {s.pass === '주유패스' && <p class="move-i"><Icon name="ticket" /><span>주유패스 사용{s.passFare > 0 ? ' (원래 ' + YEN(s.passFare) + ')' : ''}</span></p>}
            {s.pass && s.pass !== '주유패스' && <p class="move-i"><Icon name="ticket" /><span>일부만 주유패스, 요금 확인</span></p>}
            {s.taxi && (
              <p class="move-i"><Icon name="taxi" /><span>
                택시 약 {s.taxi.min}분, 1인 {YEN(s.taxi.perLow)}~{YEN(s.taxi.perHigh)}
                {s.taxi.saved > 0 ? ' (대중교통보다 ' + s.taxi.saved + '분 빠름)' : ''}{s.taxi.night ? ', 심야 할증' : ''}
              </span></p>
            )}
            {!split && k !== 'walk' && summary && <p class="move-s">{summary}</p>}
            {approx && <p class="move-s">시간표는 같은 요일 기준 근사값</p>}
            {s.link && <a class="btn btn-plate btn-sm" href={s.link} target="_blank" rel="noopener"><Icon name="map" />구글 지도에서 경로 보기</a>}
          </div>
        )}
      </li>
      {open && split && stepRows(s, fromName, toName).map((r, i) => <Step key={key + i} r={r} />)}
    </>
  );
}

/* ── 환승 단계 줄 ── */
function Step({ r }) {
  if (r.type === 'station') {
    return (
      <li class="step step-st" style={{ '--c1': r.c1, '--c2': r.c2 }}>
        <span class="step-time num">{r.time}{r.time2 && <small>{r.time2} 출발</small>}</span>
        <div class="step-rail" aria-hidden="true"><i /></div>
        <p class="step-b"><b>{r.name}</b>{r.ja && <span class="ja">{r.ja}</span>}<span class="step-k">{r.kind}</span></p>
      </li>
    );
  }
  if (r.type === 'walk') {
    return (
      <li class="step step-walk" style={{ '--c': r.c }}>
        <span class="step-time" />
        <div class="step-rail" aria-hidden="true" />
        <div class="step-b">
          <p class="step-h"><Icon name="walk" /><b>{r.label} {r.min}분</b>{r.m > 0 && <span class="num">{fmtDist(r.m)}</span>}</p>
          <p class="step-s">{r.from}에서 {r.to}{r.note ? ' (' + r.note + ')' : ''}{r.wait ? ', 대기 약 ' + r.wait + '분' : ''}</p>
        </div>
      </li>
    );
  }
  return (
    <li class="step step-ride" style={{ '--c': r.c }}>
      <span class="step-time" />
      <div class="step-rail" aria-hidden="true" />
      <div class="step-b">
        <p class="step-h">
          <Icon name={vehicleIcon(r.vehicle, r.line)} label={r.vehicle} />
          <LineBadge line={r.line} color={r.color} />
          <b>{r.min}분</b>{r.stops > 0 && <span>{r.stops}정거장</span>}
        </p>
        <p class="step-s">
          {r.head && <span>{r.head}{r.jhead && <span class="ja">{r.jhead}</span>} 방면</span>}
          {r.jline && <span class="ja">{r.jline}</span>}
          {r.pass === 'pass' && <span class="step-pay">주유패스</span>}
          {r.pass === 'card' && <span class="step-pay">IC카드·현금</span>}
        </p>
      </div>
    </li>
  );
}

function NowLine({ min }) {
  return (
    <li class="nowline" role="separator" aria-label={'지금 ' + hhmm(min)}>
      <span class="now-chip">今 {hhmm(min)}</span><i />
    </li>
  );
}

function SunLine({ min, where }) {
  return (
    <li class="sunline" role="separator" aria-label={'일몰 ' + hhmm(min)}>
      <span class="num">{hhmm(min)}</span>
      <span class="sun-l"><Icon name="sunset" />일몰{where ? ', ' + where : ''}</span>
    </li>
  );
}

/**
 * @param date 날짜  @param fromOrder 이 순서 뒤부터만 (오늘 화면: 남은 일정)
 * @param focus 열릴 때 지금·다음 줄이 보이게 스크롤  @param compact 줄 안 행동 버튼 숨김
 */
export function Timeline({ date, fromOrder, focus, compact }) {
  const v = view.value;
  const now = ntSig.value;
  const [open, setOpen] = useState(() => new Set());
  const list = useRef(null);
  const toggle = k => setOpen(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // 날짜가 바뀌면 펼친 것 접고, 오늘이면 지금·다음 줄로
  useEffect(() => {
    setOpen(new Set());
    if (!focus || !list.current) return;
    const el = list.current.querySelector('.stop.is-now, .stop.is-next');
    if (el) el.scrollIntoView({ block: 'center' });
  }, [date]);

  if (!v) return null;
  const all = dayPoints(v, date);
  const pts = fromOrder == null ? all : all.filter(p => p.order > fromOrder);
  if (!pts.length) return null;
  const states = stopStates(v, date, now);
  const isToday = date === now.date;
  const items = [];
  const over = v.overnight.find(o => o.date === date);   // 날짜 넘는 이동 (밤버스 등)
  let nowDone = !isToday, sunDone = false, prevDep = null, lastLL = null;

  pts.forEach((p, i) => {
    const key = vk(p);
    if (p.lat != null) lastLL = [p.lat, p.lng];
    const sun = !sunDone && lastLL ? sunsetMin(date, lastLL[0], lastLL[1], v.tzOffsetMin) : null;
    const pa = toMin(p.arrive), pd = toMin(p.depart);
    // 일몰 선: 처음으로 해가 지는 구간 한 곳에만
    if (sun != null && pa != null && pa >= sun) {
      items.push(<SunLine key={'sun' + key} min={sun} where={prevDep != null && prevDep < sun ? '이동 중' : ''} />);
      sunDone = true;
    }
    if (!nowDone && pa != null && pa > now.min) { items.push(<NowLine key="now" min={now.min} />); nowDone = true; }

    const sIn = v.segTo.get(key), sOut = v.segFrom.get(key);
    const state = states.get(p.order) || 'future';
    items.push(
      <Stop key={key} v={v} p={p} state={state} first={i === 0} last={i === pts.length - 1 && !(over && fromOrder == null)}
        cIn={segLine(i === 0 ? null : sIn).c} cOut={segLine(sOut).c}
        open={open.has(key)} onToggle={() => toggle(key)} compact={compact} />,
    );

    // 머무는 동안 해 짐: 장소 줄 바로 아래
    if (sun != null && !sunDone && pa != null && pd != null && pd > sun) {
      items.push(<SunLine key={'sun' + key} min={sun} where={pname(v, p) + '에 있을 때'} />);
      sunDone = true;
    }
    if (pd != null) prevDep = pd;
    // 머무는 중이면 장소 줄과 이동 줄 사이에 지금 선
    if (!nowDone && sOut && pd != null && pd > now.min) { items.push(<NowLine key="now" min={now.min} />); nowDone = true; }
    if (sOut && i < pts.length - 1) {
      const toPt = pts.find(x => x.order === sOut.toOrder);
      const mk = 'm' + key;
      items.push(
        <Move key={mk} v={v} s={sOut} past={state === 'past'} now={now}
          open={open.has(mk)} onToggle={() => toggle(mk)} fromName={pname(v, p)} toName={toPt ? pname(v, toPt) : ''} />,
      );
    }
  });
  if (!nowDone) items.push(<NowLine key="now" min={now.min} />);   // 오늘 일정이 다 끝났으면 맨 아래

  if (over && fromOrder == null) {
    const mk = 'over' + date;
    items.push(<Move key={mk} v={v} s={over} tail now={now} open={open.has(mk)} onToggle={() => toggle(mk)} fromName="" toName="" />);
  }

  return <ol class={'tl' + (isToday ? ' is-today' : '')} ref={list}>{items}</ol>;
}
