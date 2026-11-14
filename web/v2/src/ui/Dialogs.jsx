// 입력 창: PIN, 실제 지출, 도착 시각. 지우는 것도 확인 없이 바로 하고 알림의 "되돌리기"로 복구
import { useEffect, useRef, useState } from 'preact/hooks';
import { view, dialog, closeDialog } from '../data/store.js';
import { verifyPin, flush, saveSpend, saveArrival } from '../data/records.js';
import { vk, pname, arrivedAt } from '../lib/trip.js';
import { parseAmount } from '../lib/ops.js';
import { YEN } from '../lib/money.js';
import { Sheet } from './Sheet.jsx';

/** PIN 입력. 맞으면 폰에 저장하고 onDone */
export function PinForm({ id, error, okLabel, onDone, onCancel, cancelLabel }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(error || '');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => { if (input.current) input.current.focus(); }, []);
  const submit = async e => {
    e.preventDefault();
    if (!pin.trim()) { setErr('PIN을 입력해야 넘어감'); input.current.focus(); return; }
    setBusy(true);
    try {
      await verifyPin(id, pin.trim());
      onDone();
    } catch (ex) {
      setErr(ex.status === 403 ? 'PIN이 맞지 않음. 다시 입력'
        : ex.status === 429 ? ex.message
        : ex.status === 0 ? '서버에 연결 안 됨. 인터넷을 확인한 뒤 다시 시도'
        : '확인 못 함 (' + ex.message + '). 다시 시도');
      setBusy(false);
      input.current.focus();
    }
  };
  return (
    <form class="form" onSubmit={submit} novalidate>
      <label class="field">
        <span>PIN</span>
        <input ref={input} type="password" inputmode="numeric" autocomplete="off" value={pin}
          aria-invalid={err ? 'true' : undefined} aria-describedby="pin-err"
          onInput={e => { setPin(e.currentTarget.value); setErr(''); }} />
      </label>
      <p class="field-err" id="pin-err" role="alert">{err}</p>
      <button type="submit" class="btn btn-exit btn-block" disabled={busy}>{busy ? '확인 중' : okLabel || 'PIN 확인'}</button>
      {onCancel && <button type="button" class="btn btn-quiet btn-block" onClick={onCancel}>{cancelLabel || '취소'}</button>}
    </form>
  );
}

function SpendSheet({ v, p }) {
  const cur = v.spend[vk(p)] || null;
  const [amt, setAmt] = useState(cur ? String(cur.amount) : '');
  const [memo, setMemo] = useState(cur ? cur.memo || '' : '');
  const [err, setErr] = useState('');
  const input = useRef(null);
  const submit = e => {
    e.preventDefault();
    const r = parseAmount(amt);
    if (r.error) { setErr(r.error); input.current.focus(); return; }
    saveSpend(p, r.amount, memo.trim());
    closeDialog();
  };
  return (
    <Sheet title={pname(v, p) + ' 지출'} onClose={closeDialog}>
      <form class="form" onSubmit={submit} novalidate>
        <label class="field">
          <span>쓴 돈 (엔)</span>
          <input ref={input} data-autofocus type="text" inputmode="numeric" autocomplete="off" placeholder="예: 1200" value={amt}
            aria-invalid={err ? 'true' : undefined} aria-describedby="amt-err"
            onInput={e => { setAmt(e.currentTarget.value); setErr(''); }}
            onBlur={() => { if (amt.trim()) setErr(parseAmount(amt).error || ''); }} />
        </label>
        <p class="field-err" id="amt-err" role="alert">{err}</p>
        {p.yen != null && !isNaN(p.yen) && <p class="field-hint">계획한 금액 <span class="num">{YEN(p.yen)}</span></p>}
        <label class="field">
          <span>메모 (선택)</span>
          <input type="text" maxlength="60" autocomplete="off" value={memo} onInput={e => setMemo(e.currentTarget.value)} />
        </label>
        <button type="submit" class="btn btn-exit btn-block">지출 저장</button>
        {cur && <button type="button" class="btn btn-quiet btn-block btn-danger" onClick={() => { saveSpend(p, null); closeDialog(); }}>지출 기록 지우기</button>}
      </form>
    </Sheet>
  );
}

function ArriveSheet({ v, p }) {
  const cur = arrivedAt(v, p) || '';
  const [t, setT] = useState(cur ? cur.padStart(5, '0') : '');
  const [err, setErr] = useState('');
  const input = useRef(null);
  const submit = e => {
    e.preventDefault();
    if (!/^\d{2}:\d{2}$/.test(t)) { setErr('시각을 넣어야 저장됨'); input.current.focus(); return; }
    saveArrival(p, t);
    closeDialog();
  };
  return (
    <Sheet title={pname(v, p) + ' 도착 시각'} onClose={closeDialog}>
      <form class="form" onSubmit={submit} novalidate>
        <label class="field">
          <span>실제 도착 시각 (일본 시간)</span>
          <input ref={input} data-autofocus type="time" value={t} aria-invalid={err ? 'true' : undefined} aria-describedby="arr-err"
            onInput={e => { setT(e.currentTarget.value); setErr(''); }} />
        </label>
        <p class="field-err" id="arr-err" role="alert">{err}</p>
        {p.arrive && <p class="field-hint">계획한 도착 <span class="num">{p.arrive}</span></p>}
        <button type="submit" class="btn btn-exit btn-block">도착 시각 저장</button>
        {cur && <button type="button" class="btn btn-quiet btn-block btn-danger" onClick={() => { saveArrival(p, ''); closeDialog(); }}>도착 기록 지우기</button>}
      </form>
    </Sheet>
  );
}

/** 지금 열려 있는 입력 창 (앱 맨 바깥에 하나) */
export function Dialogs() {
  const d = dialog.value, v = view.value;
  if (!d || !v) return null;
  if (d.kind === 'pin') {
    return (
      <Sheet title={d.id + ' PIN 입력'} onClose={closeDialog}>
        <p class="sheet-lead">기록을 저장하려면 PIN이 필요함. 닫아도 기록은 폰에 남아 있다가 PIN을 넣으면 저장됨</p>
        <PinForm key={d.id} id={d.id} error={d.error} onDone={() => { closeDialog(); flush(true); }} onCancel={closeDialog} cancelLabel="나중에 입력" />
      </Sheet>
    );
  }
  const p = v.points.find(x => vk(x) === d.key);
  if (!p) return null;
  return d.kind === 'spend' ? <SpendSheet key={d.key} v={v} p={p} /> : <ArriveSheet key={d.key} v={v} p={p} />;
}
