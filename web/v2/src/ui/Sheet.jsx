import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon.jsx';

/* ── 뒤로 가기 = 맨 위 시트 닫기 ──
 *  시트를 열 때 같은 주소로 기록을 하나 쌓아 두고(pushState), 뒤로 가면 맨 위 시트만 닫음
 *  버튼·바깥 누르기로 닫으면 쌓아 둔 기록을 걷어냄. 단 시트에서 다른 화면으로 넘어갔으면(주소가 바뀜) 그대로 둠 */
const stack = [];     // 열린 시트 [{ id, close, locked, byBack }]
let seq = 0, skip = 0;
addEventListener('popstate', () => {
  if (skip) { skip--; return; }   // 시트를 닫으며 걷어낸 기록
  const top = stack[stack.length - 1];
  if (!top) return;
  if (top.locked) { history.pushState({ sheet: top.id }, ''); return; }
  top.byBack = true;
  top.close();
});

const DRAG_CLOSE = 96;   // 이만큼(px) 끌어내리면 닫힘 (빠르게 튕기면 더 짧아도)

/**
 * 아래서 올라오는 시트 (넓은 화면에선 가운데 창).
 *  Esc·바깥·뒤로 가기·머리 부분을 아래로 끌기로 닫히고, Tab은 시트 안에서만 돌고, 닫으면 열기 전 포커스로 돌아감
 */
export function Sheet({ title, onClose, children, locked, full }) {
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const drag = useRef(null);

  useEffect(() => {
    const back = document.activeElement;
    const el = box.current;
    const focusables = () => Array.from(el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(x => !x.disabled && x.offsetParent);
    const first = el.querySelector('[data-autofocus]') || focusables()[0];
    if (first) first.focus();
    const key = e => {
      if (!el.contains(document.activeElement)) return;   // 시트 위에 다른 시트가 떠 있으면 위의 것만 반응
      if (e.key === 'Escape' && !locked) { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', key, true);

    const entry = { id: ++seq, close: () => closeRef.current(), locked: !!locked, byBack: false };
    stack.push(entry);
    history.pushState({ sheet: entry.id }, '');

    return () => {
      document.removeEventListener('keydown', key, true);
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      // 뒤로 가기가 아니라 버튼 등으로 닫았고, 아직 이 시트의 기록 위에 있으면 걷어냄
      if (!entry.byBack && history.state && history.state.sheet === entry.id) { skip++; history.back(); }
      if (back && back.focus) back.focus();
    };
  }, []);

  /* 머리 부분을 아래로 끌어서 닫기 (손가락·펜만) */
  const onDown = e => {
    if (locked || e.pointerType === 'mouse' || e.target.closest('button, a, input')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    box.current.style.transition = 'none';
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = e => {
    const d = drag.current;
    if (!d) return;
    d.dy = Math.max(0, e.clientY - d.y);
    box.current.style.transform = d.dy ? 'translateY(' + d.dy + 'px)' : '';
  };
  const onUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const el = box.current;
    el.style.transition = '';
    const speed = d.dy / Math.max(1, performance.now() - d.t);   // px/ms
    if (d.dy > DRAG_CLOSE || (d.dy > 24 && speed > 0.6)) { closeRef.current(); return; }
    el.style.transform = '';
  };

  return (
    <div class={'sheet-wrap' + (full ? ' is-full' : '')} onClick={e => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <div class="sheet-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {!locked && <i class="sheet-grab" aria-hidden="true" />}
          <h2>{title}</h2>
          {!locked && <button type="button" class="sheet-x" onClick={onClose} aria-label="닫기"><Icon name="close" /></button>}
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
