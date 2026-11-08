/* ───────────────────────── 장소 정리 ───────────────────────── */
/* PlaceCleanup.gs  */
// 메뉴: 장소 정리
//  - 삭제: 일정에 안 나오고 구역도 빈 장소
//          (구역이 있으면 가이드 "추천" 장소라 남김. 구역 없이 남기고 싶으면 메모나 한 줄 소개에 [유지])
//  - 삭제: 같은 일정 장소에 두 줄 이상 붙은 중복 (내용을 더 많이 채운 줄 하나만 남김)
//  - 맞춤: 남는 장소의 지도 링크·좌표를 일정 기준으로 (이름으로만 연결돼서 좌표가 다른 경우 등)
//  - 장소 키를 P001부터 다시 매김 (삭제로 생긴 빈 번호 정리)
// 실행 전에 바뀔 내용 목록을 보여주고 확인 받음
function cleanupPlaces() {
  requireSheetUi_();
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
  const sh = ss.getSheetByName(CONFIG.PLACE_SHEET);
  if (!plan || !sh) { alert_('"일정" 또는 "장소" 시트가 없음'); return; }
  ensurePlaceHeader_(sh);

  // 1. 일정에 나오는 장소 (같은 장소끼리 묶음. 장소 가이드 갱신과 같은 기준)
  const groups = [];
  readPlanRows_(plan, ss.getSpreadsheetTimeZone()).forEach(r => {
    const item = { name: r.place, link: r.link, lat: r.lat, lng: r.lng };
    if (!groups.some(g => samePlace_(g, item))) groups.push(item);
  });

  const places = readPlaces_(sh);
  if (!places.length) { alert_('장소 시트가 비어 있음'); return; }
  const col = places[0].col;
  const filled = p => [p.alias, p.area, p.costMin, p.costMax, p.hours, p.closed, p.intro, p.memo, p.web]
    .filter(x => x !== '' && x != null).length + p.menu.length + p.photos.length;
  const keepTag = p => /\[유지\]/.test(p.memo + ' ' + p.intro);

  // 2. 분류
  const drop = [];
  const fix = [];
  const kept = [];
  const byGroup = new Map();
  places.forEach(p => {
    const g = groups.find(x => samePlace_(p, x));
    if (!g) {
      if (p.area || keepTag(p)) kept.push(p);
      else drop.push({ p: p, why: '일정에 없고 구역도 없음' });
      return;
    }
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(p);
  });
  byGroup.forEach((list, g) => {
    list.sort((a, b) => (filled(b) - filled(a)) || (a.row - b.row));
    const main = list[0];
    list.slice(1).forEach(p => drop.push({ p: p, why: '중복 (' + main.key + ' ' + main.name + ' 남김)' }));
    const coordDiff = g.lat != null && (main.lat == null || distanceM_(main.lat, main.lng, g.lat, g.lng) > CONFIG.PLACE_MATCH_M);
    const linkDiff = !!g.link && main.link !== g.link;
    if (coordDiff || linkDiff) fix.push({ p: main, g: g, coordDiff: coordDiff, linkDiff: linkDiff });
  });
  const missing = groups.filter(g => !places.some(p => samePlace_(p, g)));

  // 남는 장소를 지금 시트 순서대로 다시 번호
  const dropRows = {};
  drop.forEach(d => { dropRows[d.p.row] = true; });
  const remain = places.filter(p => !dropRows[p.row]);
  const renum = remain.filter((p, i) => p.key !== 'P' + String(i + 1).padStart(3, '0')).length;

  if (!drop.length && !fix.length && !renum) {
    alert_('정리할 것 없음' + (missing.length ? '\n일정에 있는데 장소 시트에 없는 곳 ' + missing.length + '곳: 장소 가이드 갱신 실행' : ''));
    return;
  }

  // 3. 확인
  const list = (arr, f) => arr.slice(0, 25).map(f).join('\n- ') + (arr.length > 25 ? '\n(외 ' + (arr.length - 25) + '건)' : '');
  const lines = [];
  if (drop.length) lines.push('삭제 ' + drop.length + '곳:\n- ' + list(drop, d => d.p.key + ' ' + d.p.name + ' — ' + d.why));
  if (fix.length) {
    lines.push('지도 링크·좌표를 일정 기준으로 맞춤 ' + fix.length + '곳:\n- ' + list(fix, f =>
      f.p.key + ' ' + f.p.name + ' (' + [f.linkDiff ? '링크' : '', f.coordDiff ? '좌표' + (f.p.lat != null ? ' ' + Math.round(distanceM_(f.p.lat, f.p.lng, f.g.lat, f.g.lng)) + 'm 차이' : ' 없음') : ''].filter(Boolean).join(', ') + ')'));
  }
  if (renum) lines.push('장소 키를 P001부터 다시 매김 (' + remain.length + '곳)');
  if (kept.length) lines.push('일정에 없지만 구역·[유지]가 있어서 남김 (가이드 추천): ' + kept.map(p => p.name).join(', '));
  if (missing.length) lines.push('일정에 있는데 장소 시트에 없는 곳 ' + missing.length + '곳: 정리 후 장소 가이드 갱신 실행');
  lines.push('남겨둘 후보 장소는 취소하고 구역을 채우거나 메모에 [유지] 적은 뒤 다시 실행');
  const ok = ui.alert('장소 정리', lines.join('\n\n') + '\n\n계속할까? (되돌리려면 파일 → 버전 기록)', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  // 4. 링크·좌표 맞춤 (행 번호가 바뀌기 전에)
  fix.forEach(f => {
    if (f.linkDiff && col.LINK >= 0) sh.getRange(f.p.row, col.LINK + 1).setValue(f.g.link);
    if (f.coordDiff && col.COORD >= 0) sh.getRange(f.p.row, col.COORD + 1).setValue(f.g.lat.toFixed(6) + ',' + f.g.lng.toFixed(6));
  });

  // 5. 삭제 (아래 행부터)
  Object.keys(dropRows).map(Number).sort((a, b) => b - a).forEach(row => sh.deleteRow(row));

  // 6. 장소 키 다시 매김
  readPlaces_(sh).forEach((p, i) => {
    const key = 'P' + String(i + 1).padStart(3, '0');
    if (p.key !== key) sh.getRange(p.row, col.KEY + 1).setValue(key);
  });

  invalidateCache_();
  alert_('장소 정리 완료\n삭제 ' + drop.length + '곳, 링크·좌표 맞춤 ' + fix.length + '곳, 남은 장소 ' + remain.length + '곳' +
    (missing.length ? '\n\n일정에 있는데 장소 시트에 없는 곳 ' + missing.length + '곳: 장소 가이드 갱신 실행' : ''));
}