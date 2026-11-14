import { useEffect } from 'preact/hooks';
import { toast } from '../data/store.js';

/** 아래쪽에 잠깐 뜨는 알림 한 줄. 되돌리기 같은 버튼이 있으면 조금 더 오래 */
export function Toast() {
  const t = toast.value;
  useEffect(() => {
    if (!t) return undefined;
    const id = setTimeout(() => { if (toast.value === t) toast.value = null; }, t.action ? 6000 : 4000);
    return () => clearTimeout(id);
  }, [t]);
  // 알림 영역은 늘 두고 안의 글만 바꿈 (화면 읽기 프로그램이 새 글을 읽도록)
  return (
    <div class="toast-wrap" role="status" aria-live="polite">
      {t && (
        <div class="toast" key={t.id}>
          <span>{t.text}</span>
          {t.action && <button type="button" onClick={() => { toast.value = null; t.action.fn(); }}>{t.action.label}</button>}
        </div>
      )}
    </div>
  );
}
