import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon.jsx';

/**
 * 아래서 올라오는 시트 (넓은 화면에선 가운데 창).
 *  Esc·바깥 누르면 닫히고, Tab은 시트 안에서만 돌고, 닫으면 열기 전 포커스로 돌아감
 */
export function Sheet({ title, onClose, children, locked }) {
  const box = useRef(null);
  useEffect(() => {
    const back = document.activeElement;
    const el = box.current;
    const focusables = () => Array.from(el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(x => !x.disabled && x.offsetParent);
    const first = el.querySelector('[data-autofocus]') || focusables()[0];
    if (first) first.focus();
    const key = e => {
      if (!el.contains(document.activeElement)) return;   // 시트 위에 다른 시트가 떠 있으면 위의 것만 반응
      if (e.key === 'Escape' && !locked) { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (back && back.focus) back.focus(); };
  }, []);
  return (
    <div class="sheet-wrap" onClick={e => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <div class="sheet-head">
          <h2>{title}</h2>
          {!locked && <button type="button" class="sheet-x" onClick={onClose} aria-label="닫기"><Icon name="close" /></button>}
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
