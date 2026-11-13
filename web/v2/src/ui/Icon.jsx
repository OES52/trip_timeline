import { ICONS } from './icons.js';

/** 아이콘. label을 주면 그 이름으로 읽히고, 안 주면 장식으로 숨김 */
export function Icon({ name, label, class: cls }) {
  return (
    <span
      class={'ic' + (cls ? ' ' + cls : '')}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
      dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }}
    />
  );
}
