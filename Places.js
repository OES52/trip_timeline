/* ───────────────────────── 장소 가이드 ───────────────────────── */
/* Places.gs  */
function buildPlaceSheet_(sh) {
  const n = PLACE_HEADERS.length;
  ensureColumns_(sh, n);
  const rows = sh.getMaxRows() - 1;

  sh.getRange(1, 1, 1, n).setValues([PLACE_HEADERS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground(CONFIG.COLOR_HEADER_INPUT);
  sh.getRange(1, G.KEY).setBackground(CONFIG.COLOR_HEADER_AUTO);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);

  sh.getRange(2, G.KEY, rows, 1).setBackground(CONFIG.COLOR_AUTO);
  sh.getRange(2, G.COST_MIN, rows, 2).setNumberFormat(CONFIG.YEN_FORMAT);
  sh.getRange(2, G.COORD, rows, 1).setNumberFormat('@');
  sh.getRange(2, G.MENU, rows, 3).setWrap(true).setVerticalAlignment('top');
  sh.getRange(2, G.TYPE, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(PLACE_TYPES, true).setAllowInvalid(false).build());

  [65, 190, 130, 70, 80, 100, 85, 85, 120, 90, 220, 220, 220, 140, 150, 140, 140, 120]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));
  setPidHeader_(sh, G.PID);
  sh.getRange(1, G.ALIAS).setNote(NOTE_ALIAS_);
  sh.getRange(1, G.CITY).setNote(NOTE_CITY_);
  sh.getRange(1, G.AREA).setNote(NOTE_AREA_);

  sh.getRange(1, G.KEY).setNote('스크립트가 자동 부여. "장소 가이드 갱신" 때 일정에 새로 나온 장소만 추가됨');
  sh.getRange(1, G.TYPE).setNote('일정 활동 칸으로 추측해서 미리 채움. 틀리면 고치기');
  sh.getRange(1, G.COST_MIN).setNote('1인 기준 예상 지출. 무료면 0');
  sh.getRange(1, G.MENU).setNote('쉼표나 줄바꿈으로 구분. 웹앱에서 메뉴 칩으로 표시');
  sh.getRange(1, G.LINK).setNote('일정과 같은 장소인지 판단할 때 지도 링크 → 좌표(' + CONFIG.PLACE_MATCH_M + 'm 이내) → 이름 순으로 비교');
  sh.getRange(1, G.PHOTO).setNote('이미지 주소 여러 개 가능 (쉼표·줄바꿈 구분). 첫 장이 카드 대표 사진\n구글 드라이브 사진은 "링크가 있는 모든 사용자 보기"로 공유한 링크를 그대로 붙여넣기');
}

const NOTE_ALIAS_ = '도감·여권·가이드에 이 이름으로 표시. 비우면 이름 그대로';
const NOTE_CITY_ = '가이드 탭 첫 단계 (예: 오사카, 교토, 도쿄)\n"장소 가이드 갱신"이 빈 칸만 좌표로 채움. 원하는 이름으로 고쳐도 됨';
const NOTE_AREA_ = '가이드 탭에서 묶는 동네 (예: 도톤보리, 우메다, 히가시야마). 직접 입력\n일정에 없는 장소(디저트 가게 등)도 구역을 넣어두면 가이드에 "추천"으로 나옴\n장소 정리 때도 구역 있는 곳은 안 지움';

function setPidHeader_(sh, col) {
  sh.getRange(1, col).setValue('Place ID')
    .setFontWeight('bold').setFontColor('#ffffff').setBackground(CONFIG.COLOR_HEADER_AUTO)
    .setNote('"영업시간 채우기"가 구글 장소 ID를 저장하는 칸. 다음 조회 때 무료 검색을 건너뜀\nnone = 구글에서 장소를 못 찾음. 다시 찾게 하려면 비우기');
  sh.getRange(2, col, sh.getMaxRows() - 1, 1).setBackground(CONFIG.COLOR_AUTO).setNumberFormat('@');
}

// 새로 끼워 넣은 입력 열 머리글 (옆 열 서식·드롭다운이 따라오지 않게 정리)
function setInputHeader_(sh, col, name, note, width) {
  sh.getRange(1, col).setValue(name)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground(CONFIG.COLOR_HEADER_INPUT)
    .setNote(note);
  sh.getRange(2, col, sh.getMaxRows() - 1, 1).clearFormat().clearDataValidations();
  if (width) sh.setColumnWidth(col, width);
}

// 예전 장소 시트를 지금 구성으로
//  - Place ID 열(맨 끝) 없으면 추가
//  - 별칭 열(이름 오른쪽) 없으면 추가
//  - 지역 열 → 구역으로 이름 바꿈 (값 그대로), 구역 왼쪽에 도시 열 추가
function ensurePlaceHeader_(sh) {
  const headN = () => sh.getRange(1, 1, 1, sh.getMaxColumns()).getDisplayValues()[0].map(hn_);
  let h = headN();
  if (h.indexOf(hn_('Place ID')) === -1) {
    const row = sh.getRange(1, 1, 1, sh.getMaxColumns()).getDisplayValues()[0];
    const last = row.reduce((m, v, i) => v !== '' ? i + 1 : m, 0);
    ensureColumns_(sh, last + 1);
    setPidHeader_(sh, last + 1);
  }
  h = headN();
  if (h.indexOf('별칭') === -1) {
    const nameCol = (h.indexOf('이름') + 1) || G.NAME;
    sh.insertColumnAfter(nameCol);
    setInputHeader_(sh, nameCol + 1, '별칭', NOTE_ALIAS_, 130);
  }
  h = headN();
  if (h.indexOf('구역') === -1) {
    const old = h.indexOf('지역') + 1;
    if (old) {
      sh.getRange(1, old).setValue('구역').setNote(NOTE_AREA_);
    } else {
      const typeCol = (h.indexOf('종류') + 1) || G.TYPE;
      sh.insertColumnAfter(typeCol);
      setInputHeader_(sh, typeCol + 1, '구역', NOTE_AREA_, 100);
    }
  }
  h = headN();
  if (h.indexOf('도시') === -1) {
    const areaCol = h.indexOf('구역') + 1;
    sh.insertColumnBefore(areaCol);
    setInputHeader_(sh, areaCol, '도시', NOTE_CITY_, 80);
  }
}

// 메뉴: 일정에 나온 장소 중 장소 시트에 없는 것만 추가
function refreshPlaceGuide() {
  requireSheetUi_();
  invalidateCache_();
  const ss = SpreadsheetApp.getActive();
  const plan = ss.getSheetByName(CONFIG.PLAN_SHEET);
  if (!plan) { alert_('먼저 "시트 생성" 실행'); return; }
  let sh = ss.getSheetByName(CONFIG.PLACE_SHEET);
  if (!sh) { sh = ss.insertSheet(CONFIG.PLACE_SHEET); buildPlaceSheet_(sh); }
  ensurePlaceHeader_(sh);

  const rows = readPlanRows_(plan, ss.getSpreadsheetTimeZone());
  const places = readPlaces_(sh);

  // 일정 안에서 같은 장소끼리 묶기
  const groups = [];
  rows.forEach(r => {
    const item = { name: r.place, link: r.link, lat: r.lat, lng: r.lng };
    let g = groups.find(x => samePlace_(x, item));
    if (!g) { g = Object.assign(item, { texts: [] }); groups.push(g); }
    g.texts.push(r.activity + ' ' + r.place);
  });

  // 시트 열 위치는 머리글 이름으로 찾음 (열 순서가 PLACE_HEADERS와 달라도 맞는 칸에 씀)
  const width = sh.getMaxColumns();
  const headN = sh.getRange(1, 1, 1, width).getDisplayValues()[0].map(hn_);
  const at = k => headN.indexOf(hn_(PLACE_HEADERS[G[k] - 1]));

  let next = maxPlaceNum_(places);
  const add = [];
  groups.forEach(g => {
    if (places.some(p => samePlace_(p, g))) return;
    next++;
    const row = new Array(width).fill('');
    row[at('KEY')] = 'P' + String(next).padStart(3, '0');
    row[at('NAME')] = g.name;
    row[at('TYPE')] = guessPlaceType_(g.texts);
    row[at('LINK')] = g.link;
    row[at('COORD')] = g.lat != null ? g.lat.toFixed(6) + ',' + g.lng.toFixed(6) : '';
    add.push(row);
  });

  if (add.length) {
    const start = lastPlaceRow_(sh) + 1;
    if (start + add.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), add.length + 20);
    sh.getRange(start, 1, add.length, width).setValues(add);
  }

  // 도시가 빈 줄은 좌표로 채움 (직접 쓴 도시는 안 건드림). 구역은 동네 이름이라 직접 입력
  let cityFilled = 0;
  const cityCol = at('CITY');
  readPlaces_(sh).forEach(p => {
    if (p.city || p.lat == null || cityCol < 0) return;
    const city = cityFor_(p.lat, p.lng);
    if (city) {
      sh.getRange(p.row, cityCol + 1).setValue(city);
      cityFilled++;
    }
    Utilities.sleep(CONFIG.SLEEP_MS);
  });

  const msg = [];
  msg.push(add.length ? add.length + '곳 추가. 종류는 추측값이니 확인하고, 구역·비용·메뉴·메모를 채우면 웹앱 도감·가이드에 나옴' : '새로 추가할 장소 없음');
  const after = readPlaces_(sh);
  // 일정에서 빠진 장소: 구역이 있으면 가이드 추천, 없으면 웹앱에 안 보임
  const orphan = after.filter(p => !groups.some(g => samePlace_(p, g)));
  const rec = orphan.filter(p => p.area);
  const lost = orphan.filter(p => !p.area);
  if (rec.length) msg.push('일정에 없는 장소 중 구역 있는 ' + rec.length + '곳은 가이드에 "추천"으로 나옴');
  if (lost.length) msg.push('일정에도 없고 구역도 없는 장소 ' + lost.length + '곳: ' + lost.slice(0, 8).map(p => p.name).join(', ') + (lost.length > 8 ? ' 외' : '') + '\n(웹앱엔 안 보임. 필요 없으면 "장소 정리"로 삭제)');
  const noArea = after.filter(p => !p.area && !orphan.includes(p)).length;
  if (noArea) msg.push('구역이 빈 장소 ' + noArea + '곳: 가이드에서 "기타"로 묶임. 구역 칸 채우기');
  if (cityFilled) msg.push('도시 자동 입력: ' + cityFilled + '곳 (원하는 이름으로 고쳐도 됨)');
  alert_(msg.join('\n'));
}

// 좌표 → "오사카", "교토", "도쿄", "인천" 같은 도시 이름 (시·도·부·현·광역시 떼고)
function cityFor_(lat, lng) {
  try {
    const res = Maps.newGeocoder().setLanguage('ko').reverseGeocode(lat, lng);
    if (res.status !== 'OK' || !res.results.length) return '';
    const comps = res.results[0].address_components || [];
    const pick = type => {
      const c = comps.find(x => x.types.indexOf(type) !== -1);
      return c ? c.long_name : '';
    };
    const admin = pick('administrative_area_level_1');
    const local = pick('locality');
    // 도쿄 23구·한국 광역시는 locality가 구 이름이라 상위 행정구역을 씀
    const raw = /도쿄|東京|광역시|특별시/.test(admin) ? admin : (local || admin);
    return String(raw).replace(/(특별자치시|광역시|특별시|도|부|현|시)$/, '').trim();
  } catch (e) {
    return '';
  }
}

function guessPlaceType_(texts) {
  const t = texts.join(' ');
  if (/체크인|체크아웃|숙소|호텔|hotel|inn\b/i.test(t)) return '숙소';
  if (/카페|커피|coffee|cafe/i.test(t)) return '카페';
  if (/식사|식당|점심|저녁|아침|먹기|라멘|스시|규카츠/i.test(t)) return '식당';
  if (/공항|역$|역\s|터미널|짐 맡기|수속|버스/.test(t)) return '교통';
  if (/쇼핑|상점가|돈키호테|굿즈/.test(t)) return '쇼핑';
  if (/관광|관람|경마|전망|산책|신사|사슴|크루즈|구경/.test(t)) return '관광지';
  return '기타';
}

// 사진 칸: 쉼표·줄바꿈·공백으로 여러 장. 구글 드라이브 공유 링크는 바로 보이는 주소로 변환
function parsePhotos_(cell) {
  return String(cell || '').split(/[\s,，]+/).map(x => x.trim()).filter(x => /^https?:\/\//.test(x)).map(u => {
    const m = u.match(/drive\.google\.com\/file\/d\/([^/?#]+)/) || u.match(/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([^&#]+)/);
    return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1200' : u;
  });
}

function readPlaces_(sh) {
  const last = lastPlaceRow_(sh);
  if (last < 2) return [];
  const width = sh.getMaxColumns();
  const head = sh.getRange(1, 1, 1, width).getDisplayValues()[0];
  const idx = {};
  const headN = head.map(hn_);
  Object.keys(G).forEach(k => { idx[k] = headN.indexOf(hn_(PLACE_HEADERS[G[k] - 1])); });
  if (idx.AREA < 0) idx.AREA = headN.indexOf('지역');   // 시트 구조 업데이트 전 예전 시트
  const range = sh.getRange(2, 1, last - 1, width);
  const vals = range.getValues();
  const disp = range.getDisplayValues();
  const num = v => (v === '' || v === null || isNaN(Number(v))) ? null : Number(v);
  const list = [];
  vals.forEach((v, i) => {
    const get = k => idx[k] >= 0 ? v[idx[k]] : '';
    const show = k => idx[k] >= 0 ? disp[i][idx[k]] : '';
    const name = String(get('NAME')).trim();
    const key = String(get('KEY')).trim();
    if (!name && !key) return;
    const c = parseCoord_(show('COORD'));
    list.push({
      row: i + 2,
      key: key,
      name: name,
      alias: String(get('ALIAS')).trim(),
      type: String(get('TYPE')).trim() || '기타',
      city: String(get('CITY')).trim(),
      area: String(get('AREA')).trim(),
      costMin: num(get('COST_MIN')),
      costMax: num(get('COST_MAX')),
      hours: show('HOURS'),
      closed: show('CLOSED'),
      menu: String(get('MENU')).split(/[,，\n]/).map(x => x.trim()).filter(Boolean),
      intro: String(get('INTRO')).trim(),
      memo: String(get('MEMO')).trim(),
      link: String(get('LINK')).trim(),
      lat: c ? c.lat : null,
      lng: c ? c.lng : null,
      photos: parsePhotos_(get('PHOTO')),
      web: String(get('WEB')).trim(),
      pid: String(get('PID')).trim(),
      col: idx,   // 열 위치 (쓰기용, 0부터)
    });
  });
  return list;
}

// 같은 장소 판단
//  1. 지도 링크가 같으면 같은 곳 (이름만 바꾼 경우)
//  2. 이름이 같으면 같은 곳
//  3. 둘 다 링크가 있는데 다르면 다른 곳
//  4. 좌표가 아주 가까워도 이름이 다르면 다른 곳 (도톤보리 크루즈 ↔ 에비스 타워처럼 붙어 있는 곳이 합쳐지지 않게)
//     좌표만으로 같다고 보는 건 한쪽 이름이 비어 있을 때뿐
function samePlace_(a, b) {
  const an = String(a.name || '').trim(), bn = String(b.name || '').trim();
  if (a.link && b.link) return a.link === b.link || (!!an && an === bn);
  if (an && bn) return an === bn;
  return a.lat != null && b.lat != null && distanceM_(a.lat, a.lng, b.lat, b.lng) <= CONFIG.PLACE_MATCH_M;
}

function distanceM_(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function maxPlaceNum_(list) {
  let max = 0;
  list.forEach(p => {
    const m = String(p.key).match(/^P(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max;
}

function lastPlaceRow_(sh) {
  const max = sh.getMaxRows();
  if (max < 2) return 1;
  const v = sh.getRange(2, 1, max - 1, 2).getDisplayValues();
  for (let i = v.length - 1; i >= 0; i--) if (v[i][0] !== '' || v[i][1] !== '') return i + 2;
  return 1;
}

/* ───────────────────────── 영업시간 (Places API) ───────────────────────── */
// 시트 메뉴에서만 실행. 트리거 없음. 키는 스크립트 속성 PLACES_API_KEY
// 비용: 장소 ID 찾기 = Text Search (IDs Only, 무료) / 영업시간 = Place Details Enterprise (월 1,000건 무료)

function setPlacesKey() {
  requireSheetUi_();
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const has = !!props.getProperty('PLACES_API_KEY');
  const r = ui.prompt('Places API 키', (has ? '이미 저장된 키가 있음. 새 키를 넣으면 바뀜, 비우고 확인하면 삭제\n' : '') +
    '구글 클라우드 콘솔에서 발급한 키 (Places API (New)만 허용해 둔 키 권장)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const v = r.getResponseText().trim();
  if (v) { props.setProperty('PLACES_API_KEY', v); ui.alert('키 저장 완료'); }
  else { props.deleteProperty('PLACES_API_KEY'); ui.alert('키 삭제'); }
}

function fillOpeningHours() { runOpeningHours_(false); }
function refreshOpeningHours() { runOpeningHours_(true); }

// refresh=false: 영업시간·휴무 둘 다 빈 장소만 (한 번 조회해서 Place ID 있는 곳은 건너뜀)
// refresh=true : 예전에 자동으로 채운 칸만 다시 받음 (직접 고친 칸은 안 건드림). 연말 직전 재확인용
function runOpeningHours_(refresh) {
  requireSheetUi_();
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('PLACES_API_KEY');
  if (!key) { ui.alert('Places API 키가 없음. 여행 도구 → Places API 키 설정 먼저'); return; }

  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.PLACE_SHEET);
  if (!sh) { ui.alert('"장소" 시트가 없음'); return; }
  ensurePlaceHeader_(sh);
  const places = readPlaces_(sh);
  const col = places.length ? places[0].col : null;
  if (!col || col.HOURS < 0 || col.CLOSED < 0 || col.PID < 0) { ui.alert('장소 시트에 영업시간·휴무·Place ID 열이 없음. 시트 구조 업데이트 실행'); return; }
  const isAuto = p => String(sh.getRange(p.row, col.HOURS + 1).getNote()).indexOf('[자동]') === 0;

  const targets = places.filter(p => {
    if (CONFIG.PLACES_SKIP_TYPES.indexOf(p.type) !== -1) return false;
    if (p.pid === 'none') return false;
    if (refresh) return !!p.pid && (!p.hours || isAuto(p)) && !(p.closed && !isAuto(p));
    return !p.hours && !p.closed && !p.pid;
  });
  if (!targets.length) {
    ui.alert(refresh ? '다시 받을 장소 없음 (자동으로 채운 칸이 없음)' : '채울 장소 없음 (영업시간·휴무가 빈 곳이 없거나 이미 조회함)');
    return;
  }

  // 하루 상한
  const today = Utilities.formatDate(new Date(), CONFIG.TRIP_TZ, 'yyyy-MM-dd');
  const usedKey = 'places-used:' + today;
  const used = Number(props.getProperty(usedKey) || 0);
  const left = Math.max(0, CONFIG.PLACES_DAILY_CAP - used);
  if (!left) { ui.alert('오늘 상한(' + CONFIG.PLACES_DAILY_CAP + '건) 다 씀. 내일 다시'); return; }
  const list = targets.slice(0, left);
  const needSearch = list.filter(p => !p.pid).length;

  const ok = ui.alert('영업시간 ' + (refresh ? '다시 받기' : '채우기'),
    list.length + '곳 조회\n' +
    '- 장소 ID 찾기 ' + needSearch + '건 (무료)\n' +
    '- 영업시간 조회 ' + list.length + '건 (유료 등급, 월 1,000건 무료, 넘으면 1건 약 0.02달러)\n' +
    '오늘 사용 ' + used + ' / ' + CONFIG.PLACES_DAILY_CAP + '건' +
    (targets.length > list.length ? '\n상한 때문에 ' + (targets.length - list.length) + '곳은 내일로 미룸' : '') +
    '\n\n계속할까?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  let billed = 0, filled = 0;
  const errors = [];
  try {
    list.forEach(p => {
      let pid = p.pid;
      if (!pid) {
        pid = placesSearchId_(key, p);
        sh.getRange(p.row, col.PID + 1).setValue(pid || 'none');
        if (!pid) { errors.push(p.name + ': 구글에서 장소를 못 찾음'); return; }
      }
      const det = placesDetails_(key, pid);
      billed++;
      const h = det.regularOpeningHours ? summarizeHours_(det.regularOpeningHours, det.currentOpeningHours) : null;
      if (!h) { errors.push(p.name + ': 구글에 영업시간 정보 없음'); return; }
      const note = '[자동] ' + today + ' Places API\n' + (h.full || []).join('\n');
      const hc = sh.getRange(p.row, col.HOURS + 1);
      if (!p.hours || isAuto(p)) hc.setValue(h.hours).setNote(note);
      const cc = sh.getRange(p.row, col.CLOSED + 1);
      if (!p.closed || isAuto(p)) cc.setValue(h.closed || '');
      filled++;
      Utilities.sleep(150);
    });
  } catch (e) {
    errors.unshift('중단: ' + (e.message || e));
  } finally {
    props.setProperty(usedKey, String(used + billed));
  }
  invalidateCache_();
  ui.alert(filled + '곳 채움 (유료 호출 ' + billed + '건, 오늘 누적 ' + (used + billed) + '건)' +
    (errors.length ? '\n\n확인 필요:\n- ' + errors.slice(0, 15).join('\n- ') : '') +
    '\n\n특별 영업일·휴무(연말연시 등)는 구글이 오늘부터 7일 안 날짜만 알려줌.\n여행 시작 7일 전 안쪽에 "다시 받기" 한 번 더 추천');
}

// 무료: Text Search (IDs Only). 이름 + 좌표 근처 300m
function placesSearchId_(key, p) {
  const body = { textQuery: p.name, languageCode: 'ja', maxResultCount: 1 };
  if (p.lat != null) body.locationBias = { circle: { center: { latitude: p.lat, longitude: p.lng }, radius: 300 } };
  const res = UrlFetchApp.fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id' },
    payload: JSON.stringify(body),
  });
  checkPlacesRes_(res);
  const j = JSON.parse(res.getContentText() || '{}');
  return j.places && j.places.length ? j.places[0].id : '';
}

// 유료(Enterprise): 평소 영업시간 + 이번 주 영업시간(특별 영업일 포함). 둘 다 같은 등급이라 요금 같음
function placesDetails_(key, pid) {
  const res = UrlFetchApp.fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(pid) + '?languageCode=ko', {
    muteHttpExceptions: true,
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'regularOpeningHours,currentOpeningHours' },
  });
  checkPlacesRes_(res);
  return JSON.parse(res.getContentText() || '{}');
}

function checkPlacesRes_(res) {
  const code = res.getResponseCode();
  if (code === 200) return;
  let msg = res.getContentText();
  try { msg = JSON.parse(msg).error.message; } catch (e) { /* 원문 그대로 */ }
  // 키 문제·할당량 초과면 바로 전체 중단
  throw new Error('Places API ' + code + ': ' + msg);
}

// 요일별 영업시간 → 우리 형식
//  영업시간: 가장 흔한 하루를 기본으로, 다른 요일·특별 영업일은 " / "로 덧붙임
//    "11:00~15:00, 17:00~22:00 / 토·일 11:00~22:00 / 12/31 11:00~18:00"
//  휴무: 쉬는 요일 + 특별 휴무일 ("화요일, 12/31")
//  cur: currentOpeningHours (특별 영업일은 조회일부터 7일 안 날짜만 들어 있음)
function summarizeHours_(oh, cur) {
  const DAY = ['일', '월', '화', '수', '목', '금', '토'];
  const ORDER = [1, 2, 3, 4, 5, 6, 0];   // 월요일부터 표시
  const hm = (h, m) => pad2_(h || 0) + ':' + pad2_(m || 0);
  const norm = k => k === '00:00~24:00' ? '00:00~23:59' : k;
  const byDay = {};
  (oh.periods || []).forEach(pr => {
    if (!pr.open) return;
    // 24시간 영업: close 없이 일요일 0시 open 하나
    if (!pr.close) { for (let d = 0; d < 7; d++) byDay[d] = ['00:00~24:00']; return; }
    (byDay[pr.open.day] = byDay[pr.open.day] || []).push(hm(pr.open.hour, pr.open.minute) + '~' + hm(pr.close.hour, pr.close.minute));
  });
  const open = Object.keys(byDay);
  if (!open.length) return null;
  const keyOf = d => byDay[d].slice().sort().join(', ');
  // 가장 흔한 하루 시간표를 기본으로
  const count = {};
  open.forEach(d => { const k = keyOf(d); count[k] = (count[k] || 0) + 1; });
  const base = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  // 기본과 다른 요일: 같은 시간표끼리 묶어서 "토·일 10:00~22:00"
  const groups = {}, gOrder = [];
  ORDER.forEach(d => {
    if (!byDay[d]) return;
    const k = keyOf(d);
    if (k === base) return;
    if (!groups[k]) { groups[k] = []; gOrder.push(k); }
    groups[k].push(DAY[d]);
  });
  const segs = [norm(base)].concat(gOrder.map(k => groups[k].join('·') + ' ' + norm(k)));

  // 특별 영업일 (연말연시 등): 그날 period가 없으면 휴무
  const closedDates = [];
  ((cur && cur.specialDays) || []).forEach(sd => {
    const dt = sd.date;
    if (!dt) return;
    const label = dt.month + '/' + dt.day;
    const same = x => x && x.date && x.date.year === dt.year && x.date.month === dt.month && x.date.day === dt.day;
    const ps = (cur.periods || []).filter(pr => same(pr.open));
    if (!ps.length) { closedDates.push(label); return; }
    segs.push(label + ' ' + ps.map(pr => hm(pr.open.hour, pr.open.minute) + '~' + (pr.close ? hm(pr.close.hour, pr.close.minute) : '24:00')).sort().join(', '));
  });

  const closed = DAY.map((n, i) => byDay[i] ? null : n + '요일').filter(Boolean).concat(closedDates).join(', ');
  return { hours: segs.join(' / '), closed: closed, full: oh.weekdayDescriptions || [] };
}