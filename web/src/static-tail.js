/* 홈랩 정적 페이지 전용 뒷부분. build.mjs가 화면 코드(App_*) 다 끼운 뒤, load() 직전에 넣음
 *  화면 코드의 전역 함수(renderWho, applyData, distanceCard …)를 감싸서 기능을 덧붙임. Apps Script 웹앱은 영향 없음
 *  1. 서비스 워커 등록 + 새 버전 알림줄
 *  2. 저장 공간 유지 요청 (navigator.storage.persist)
 *  3. 장소 사진을 홈랩 프록시(/api/photo) 경유로 → 오프라인에서도 보임
 *  4. 사용자 선택 화면 아래 "이 기기" 패널: 설치·저장 공간·사진 미리 받기·출발 알림·도착 제안
 *  5. 위치: 권한 있으면 자동으로 켬, 다음 장소 거리·도착 예상, 지도·타임라인 아래 다음 장소 칩
 *  6. 도착 자동 제안 (앱 열려 있을 때만. 웹은 백그라운드 위치 불가)
 *  7. 출발 N분 전 푸시 (Web Push, iOS는 홈 화면에 추가한 뒤만)
 *  8. 친구 기록 실시간 반영 (SSE /api/events → 바뀌면 다시 받음, 알림 없이 화면만 갱신)
 *  9. 오프라인 쓰기 대기열 (도장·도착·지출을 저장해뒀다가 연결되면 순서대로 전송)
 * 10. 공유 (장소·하루 일정, Web Share → 안 되면 복사)
 * 11. 화면 전환 애니메이션 (View Transitions)
 * 12. 폰: 하단 탭바 + 스크롤하면 헤더 접기 */
(function () {
  'use strict';
  const CFG = window.TRIP_CFG || {};
  const API = window.TRIP_API_URL || '/api';
  const PHOTO_CACHE = 'trip-photos-v1';   // sw.js와 같은 이름
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 무시 */ } },
  };
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  /* ── 스타일 ── */
  const css = document.createElement('style');
  css.textContent = `
  .dev { margin-top: 28px; }
  .dev h3 { font-size: 15px; margin: 0 0 2px; }
  .dev .hcard p { margin: 4px 0; font-size: 13px; color: var(--muted); line-height: 1.55; }
  .dev .hcard p b { color: var(--ink); }
  .dev .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
  .dev select { font: inherit; font-size: 14px; border: 1px solid var(--rule); border-radius: 10px; padding: 7px 10px; background: var(--panel); color: var(--ink); }
  .dev .bar { height: 6px; border-radius: 3px; background: var(--rule); overflow: hidden; margin-top: 8px; }
  .dev .bar i { display: block; height: 100%; width: 0; background: var(--ink); transition: width .2s; }
  .dev .ok { color: #13945f !important; }
  .dev .warn-t { color: #c2410c !important; }

  .float-bar { position: fixed; left: 50%; transform: translateX(-50%); z-index: 2500; display: flex; gap: 8px; align-items: center;
    max-width: calc(100vw - 24px); padding: 10px 12px 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.4;
    background: var(--ink); color: var(--panel); box-shadow: 0 8px 26px rgba(0,0,0,.28); }
  .float-bar button { font: inherit; font-size: 13px; font-weight: 700; border: 0; border-radius: 9px; padding: 6px 11px; cursor: pointer;
    background: var(--panel); color: var(--ink); white-space: nowrap; }
  .float-bar button.ghost { background: transparent; color: var(--panel); border: 1px solid color-mix(in srgb, var(--panel) 40%, transparent); }
  #swUpdate { top: calc(10px + env(safe-area-inset-top, 0px)); }
  #geoAsk { bottom: calc(76px + env(safe-area-inset-bottom, 0px)); }
  #nextChip { bottom: calc(14px + env(safe-area-inset-bottom, 0px)); left: 12px; transform: none; max-width: calc(100vw - 90px);
    padding: 7px 12px; font-size: 13px; cursor: pointer; background: var(--panel); color: var(--ink); border: 1px solid var(--rule); }
  #nextChip b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40vw; display: inline-block; vertical-align: bottom; }
  #nextChip .k { font-weight: 700; color: var(--muted); }
  .eta-line { margin: 6px 0 0; font-size: 13px; color: var(--muted); }
  .eta-line b { color: var(--ink); }
  .eta-line .late { color: #c2410c; font-weight: 700; }
  .eta-line .early { color: #13945f; font-weight: 700; }
  `;
  document.head.appendChild(css);

  function bar(id) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'float-bar'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    return el;
  }
  function hideBar(id) { const el = document.getElementById(id); if (el) el.remove(); }
  const MB = n => (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + 'MB';

  /* ── 1. 서비스 워커 ── */
  let swReg = null;
  if ('serviceWorker' in navigator) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
    addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        swReg = reg;
        const offer = w => {
          const el = bar('swUpdate');
          el.innerHTML = '<span>새 버전 있음</span><button type="button">적용</button><button type="button" class="ghost">나중에</button>';
          el.querySelector('button').onclick = () => { el.remove(); w.postMessage('SKIP_WAITING'); };
          el.querySelector('.ghost').onclick = () => el.remove();
        };
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
        });
        // 오래 켜 둔 폰: 화면 다시 볼 때 새 버전 확인
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => null); });
      }).catch(e => console.warn('서비스 워커 등록 실패', e));
    });
  }

  /* ── 2. 저장 공간 유지 (첫 터치 때 한 번 요청) ── */
  function askPersist() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
    return navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => false);
  }
  addEventListener('pointerdown', function once() { removeEventListener('pointerdown', once, true); askPersist(); }, true);

  /* ── 3. 사진은 프록시 경유 ── */
  function proxyPhotos(data) {
    (data && data.places || []).forEach(p => {
      if (Array.isArray(p.photos)) p.photos = p.photos.map(u => /^https?:\/\//i.test(u) ? API + '/photo?u=' + encodeURIComponent(u) : u);
    });
  }
  if (CFG.photoProxy !== false) {
    const applyData1 = applyData;
    applyData = function (data, keepView) { proxyPhotos(data); return applyData1(data, keepView); };
  }

  /* ── 4. "이 기기" 패널 (사용자 선택 화면 아래) ── */
  const renderWho0 = renderWho;
  renderWho = function () {
    renderWho0();
    const box = document.getElementById('whoInner');
    if (!box) return;
    const sec = document.createElement('div');
    sec.className = 'dev';
    sec.innerHTML = '<h2 style="font-size:20px;margin:0 0 4px">이 기기</h2><p class="lead">이 폰에만 적용되는 설정</p>' +
      '<div class="hcard" id="devInstall"></div>' +
      '<div class="hcard" id="devOffline"></div>' +
      '<div class="hcard" id="devPush"></div>' +
      '<div class="hcard" id="devGeo"></div>';
    box.appendChild(sec);
    paintInstall(); paintOffline(); paintPush(); paintGeo();
  };

  function paintInstall() {
    const el = document.getElementById('devInstall');
    if (!el) return;
    const st = standalone();
    el.innerHTML = '<h3>설치 · 저장 공간</h3>' +
      '<p>' + (st ? '<b class="ok">홈 화면 앱으로 실행 중</b>' :
        (isIOS ? '사파리 공유 버튼 → <b>홈 화면에 추가</b> 후 그 아이콘으로 열기. 알림·저장 공간 유지에 필요'
               : '브라우저 메뉴 → <b>앱 설치</b>(홈 화면에 추가) 추천')) + '</p>' +
      '<p id="devStore">저장 공간 확인 중…</p>' +
      '<div class="row"><button class="btn" type="button" id="devPersist">저장 공간 유지 요청</button></div>';
    document.getElementById('devPersist').onclick = () => askPersist().then(paintStore);
    paintStore();
  }
  function paintStore() {
    const el = document.getElementById('devStore');
    if (!el || !navigator.storage || !navigator.storage.estimate) { if (el) el.textContent = '이 브라우저는 저장 공간 정보를 안 알려줌'; return; }
    Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false]).then(([e, p]) => {
      el.innerHTML = '사용 <b>' + MB(e.usage || 0) + '</b> / 한도 ' + MB(e.quota || 0) + ' · ' +
        (p ? '<b class="ok">유지됨</b> (브라우저가 마음대로 안 지움)' : '<b class="warn-t">유지 안 됨</b>' + (isIOS && !standalone() ? ' (홈 화면에 추가하면 7일 미사용 삭제 대상에서 빠짐)' : ''));
    });
  }

  /* ── 오프라인 준비: 장소 사진 미리 받기 (지도는 OSM이라 대량 저장 안 함, 본 화면만 브라우저가 캐시) ── */
  function photoList() {
    if (!DATA) return [];
    const out = new Set();
    (DATA.places || []).forEach(p => (p.photos || []).forEach(u => { if (u.indexOf(API + '/photo') === 0) out.add(location.origin + u); }));
    return Array.from(out);
  }

  let prep = null;   // 진행 중 { stop, done, total, fail }
  function paintOffline() {
    const el = document.getElementById('devOffline');
    if (!el) return;
    if (!DATA) { el.innerHTML = '<h3>오프라인 준비</h3><p>일정 불러온 뒤 가능</p>'; return; }
    const photos = photoList();
    el.innerHTML = '<h3>오프라인 준비</h3>' +
      '<p>장소 사진 <b>' + photos.length + '장</b> 미리 받기. 일정 데이터는 열 때마다 자동 저장</p>' +
      '<p>지도 배경은 인터넷 필요 (한 번 본 곳은 잠깐 남아 있을 수 있음)</p>' +
      '<div class="bar"><i id="prepBar"></i></div><p id="prepMsg"></p>' +
      '<div class="row"><button class="btn primary" type="button" id="prepGo">' + (prep ? '멈추기' : '받기') + '</button></div>';
    document.getElementById('prepGo').onclick = () => { if (prep) prep.stop = true; else runPrep(photos); };
    if (prep) paintPrep();
  }
  function paintPrep() {
    const b = document.getElementById('prepBar'), m = document.getElementById('prepMsg');
    if (!b || !prep) return;
    b.style.width = (prep.total ? Math.round(prep.done / prep.total * 100) : 0) + '%';
    m.textContent = prep.done + ' / ' + prep.total + (prep.fail ? ' · 실패 ' + prep.fail : '');
  }
  async function runPrep(photos) {
    askPersist();
    prep = { stop: false, done: 0, total: photos.length, fail: 0 };
    paintOffline();
    const c = await caches.open(PHOTO_CACHE);
    let i = 0;
    async function worker() {
      while (i < photos.length && !prep.stop) {
        const u = photos[i++];
        try {
          if (!(await c.match(u))) {
            const r = await fetch(u);
            if (r.ok) await c.put(u, r); else prep.fail++;
          }
        } catch (e) { prep.fail++; }
        prep.done++;
        paintPrep();
      }
    }
    await Promise.all([1, 2, 3, 4].map(worker));
    const stopped = prep.stop, fail = prep.fail;
    prep = null;
    paintOffline();
    paintStore();
    showToast(stopped ? '오프라인 준비 멈춤' : '사진 받기 끝' + (fail ? ' (실패 ' + fail + '건, 다시 누르면 실패한 것만 받음)' : ''));
  }

  /* ── 7. 출발 알림 (Web Push) ── */
  const PUSH_KEY = 'trip-push-v1';
  function pushState() { try { return JSON.parse(LS.get(PUSH_KEY, 'null')); } catch (e) { return null; } }
  function b64ToU8(b64) {
    const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  async function postJSON(path, body) {
    const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!j || !j.ok) throw new Error((j && j.error) || '서버 오류 ' + r.status);
    return j.result;
  }
  function paintPush() {
    const el = document.getElementById('devPush');
    if (!el) return;
    const st = pushState();
    const can = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    let why = '';
    if (!can) why = isIOS && !standalone() ? '아이폰은 홈 화면에 추가한 아이콘으로 열어야 알림 가능 (iOS 16.4 이상)' : '이 브라우저는 푸시 알림 미지원';
    else if (!USER) why = '먼저 위에서 사용자 고르기';
    else if (Notification.permission === 'denied') why = '알림 권한이 막혀 있음. 설정에서 이 사이트 알림 허용 필요';
    const lead = st ? st.lead : 15;
    el.innerHTML = '<h3>출발 알림</h3>' +
      '<p>다음 장소로 출발할 시각 몇 분 전에 알림. 도착 기록으로 늦어진 만큼 알림도 밀림</p>' +
      (why ? '<p class="warn-t">' + esc(why) + '</p>' :
        '<p>' + (st ? '<b class="ok">켜짐</b> · ' + esc(st.user) + ' 일정 기준 · ' + st.lead + '분 전' : '꺼짐') + '</p>' +
        '<div class="row"><select id="pushLead" aria-label="몇 분 전">' + [5, 10, 15, 20, 30].map(n =>
          '<option value="' + n + '"' + (n === lead ? ' selected' : '') + '>' + n + '분 전</option>').join('') + '</select>' +
        '<button class="btn primary" type="button" id="pushOn">' + (st ? '설정 저장' : '켜기') + '</button>' +
        (st ? '<button class="btn" type="button" id="pushTest">시험 알림</button><button class="btn" type="button" id="pushOff">끄기</button>' : '') + '</div>');
    const on = document.getElementById('pushOn');
    if (on) on.onclick = () => pushOn(Number(document.getElementById('pushLead').value)).then(paintPush, e => { showToast('알림 켜기 실패: ' + e.message); paintPush(); });
    const off = document.getElementById('pushOff');
    if (off) off.onclick = () => pushOff().then(paintPush, e => showToast('끄기 실패: ' + e.message));
    const test = document.getElementById('pushTest');
    if (test) test.onclick = () => pushTest().then(() => showToast('시험 알림 보냄'), e => showToast('시험 알림 실패: ' + e.message));
  }
  async function pushReg() {
    const reg = swReg || await navigator.serviceWorker.ready;
    return reg;
  }
  async function pushOn(lead) {
    // 권한 요청은 버튼 누른 직후에 바로 해야 iOS가 받아줌
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('알림 권한 거부됨');
    const r = await fetch(API + '/push/key');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '서버에 알림 키가 없음');
    const reg = await pushReg();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(j.result.key) });
    await postJSON('/push/subscribe', { sub: sub.toJSON(), user: USER.id, pin: getPin(USER.id), lead: lead });
    LS.set(PUSH_KEY, JSON.stringify({ user: USER.id, lead: lead, endpoint: sub.endpoint }));
    showToast('출발 ' + lead + '분 전 알림 켬');
  }
  async function pushOff() {
    const reg = await pushReg();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await postJSON('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => null);
      await sub.unsubscribe().catch(() => null);
    }
    LS.set(PUSH_KEY, null);
    showToast('출발 알림 끔');
  }
  async function pushTest() {
    const reg = await pushReg();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) throw new Error('구독 없음. 다시 켜기');
    await postJSON('/push/test', { endpoint: sub.endpoint });
  }

  /* ── 5. 위치 ── */
  const GEO_KEY = 'trip-geo-ask';    // 도착 제안 켬/끔 ('1'이면 켬, 기본 꺼짐)
  let lastPos = null, lastHomeRender = 0, lastHomePos = null, geoWatch = null;

  function startWatch() {
    if (!navigator.geolocation || geoWatch != null) return;
    geoWatch = navigator.geolocation.watchPosition(onPos, err => {
      geoWatch = null;
      homeWatch = null;
      if (err.code === 1) setStatus('위치 권한이 막혀 있음. 브라우저 설정에서 이 사이트 위치 허용', true);
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
    homeWatch = geoWatch;   // 홈 화면 "내 위치로 거리 보기"가 또 켜지 않게
  }
  // 홈 화면 버튼도 이 감시를 쓰게
  startHomeLocation = startWatch;

  // 이미 허용된 기기면 열자마자 켬 (권한 창은 안 뜸)
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') startWatch(); }).catch(() => null);
  }

  function onPos(pos) {
    const c = pos.coords;
    lastPos = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, t: Date.now() };
    myPos = [c.latitude, c.longitude];
    const now = Date.now();
    const moved = lastHomePos ? haversine(lastHomePos, myPos) : Infinity;
    if (currentView === 'home' && DATA && (moved > 20 || now - lastHomeRender > 30000)) {
      lastHomeRender = now; lastHomePos = myPos;
      try { renderHomeBody(); } catch (e) { /* 다음 갱신 때 */ }
    }
    paintChip();
    geofence();
  }

  // 다음 장소 카드에 도착 예상 한 줄
  function etaLine(target) {
    if (!target || target.lat == null) return '';
    const nt = tokyoNow();
    if (target.date !== nt.date) return '';
    const plan = predictedMin(target) != null ? predictedMin(target) : toMin(target.arrive);
    if (myPos) {
      const d = haversine(myPos, [target.lat, target.lng]);
      if (d <= 2500) {
        const walk = Math.max(1, Math.round(d * 1.3 / 80));
        const eta = nt.min + walk;
        if (plan == null) return '<p class="eta-line">지금 걸어가면 <b>' + hhmm(eta) + '</b> 도착</p>';
        const diff = plan - eta;
        return '<p class="eta-line">지금 걸어가면 <b>' + hhmm(eta) + '</b> 도착 · 계획 ' + hhmm(plan) + ' ' +
          (diff >= 0 ? '<span class="early">' + diff + '분 여유</span>' : '<span class="late">' + (-diff) + '분 늦음</span>') + '</p>';
      }
    }
    // 멀면: 이전 장소 출발 시각 기준
    const prev = DATA.points.filter(p => p.date === target.date && p.order < target.order).sort((a, b) => b.order - a.order)[0];
    const dep = prev ? toMin(prev.depart) : null;
    if (dep == null) return '';
    const r = dayDelay(target.date);
    const depAdj = dep + (r && prev.order >= r.order ? r.delay : 0);
    const left = depAdj - nt.min;
    return '<p class="eta-line">' + esc(pname(prev)) + ' 출발 <b>' + hhmm(depAdj) + '</b>' + (left > 0 ? ' (' + left + '분 뒤)' : left > -60 ? ' <span class="late">출발 시각 지남</span>' : '') + '</p>';
  }
  const distanceCard0 = distanceCard;
  distanceCard = function () {
    const h = distanceCard0();
    if (!h || !DATA) return h;
    const extra = etaLine(nextStopNow());
    return extra ? h.replace('<div style="margin-top:10px">', extra + '<div style="margin-top:10px">') : h;
  };

  // 지도·타임라인 화면 아래 "다음 장소" 칩
  function paintChip() {
    const show = DATA && USER && (currentView === 'plan' || currentView === 'tl');
    const t = show ? nextStopNow() : null;
    if (!t || t.lat == null || t.date !== tokyoNow().date) { hideBar('nextChip'); return; }
    const el = bar('nextChip');
    let txt = '<span class="k">次</span> <b>' + esc(pname(t)) + '</b>';
    if (myPos) {
      const d = haversine(myPos, [t.lat, t.lng]);
      txt += ' · ' + fmtDist(d) + (d <= 2500 ? ' · 도보 ' + Math.max(1, Math.round(d * 1.3 / 80)) + '분' : '');
    }
    const plan = predictedMin(t) != null ? predictedMin(t) : toMin(t.arrive);
    if (plan != null) txt += ' · ' + hhmm(plan) + ' 도착 계획';
    el.innerHTML = '<span>' + txt + '</span>';
    el.onclick = () => window.open(navUrl(t.lat, t.lng), '_blank', 'noopener');
  }
  let animNext = false;
  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('.seg .view, .tabbar button, .navgrid [data-go], .subnav button')) { animNext = true; setTimeout(() => { animNext = false; }, 0); }
  }, true);
  const setView0 = setView;
  setView = function (v) {
    const go = () => { setView0(v); paintChip(); hideBar('geoAsk'); afterView(); };
    // 탭·보기 버튼을 직접 눌렀을 때만 애니메이션 (코드가 부르는 전환은 바로 바뀌어야 뒤 코드가 맞게 동작)
    const anim = animNext; animNext = false;
    if (!anim || v === currentView || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches || !DATA) return go();
    // 탭 순서 기준으로 왼쪽/오른쪽으로 밀리는 방향
    const a = TAB_ORDER.indexOf(currentView), b = TAB_ORDER.indexOf(v);   // 같은 묶음 안(타임라인↔지도)도 순서대로
    document.documentElement.style.setProperty('--vt-dir', a >= 0 && b >= 0 && b < a ? '-1' : '1');
    document.startViewTransition(go);
  };
  setInterval(paintChip, 30000);

  /* ── 6. 도착 자동 제안 ── */
  //  반경 80m 안(정확도 60m 이내)에 1분 넘게 있으면 물어봄. 같은 장소는 한 번만
  //  계획 도착 시각 기준 -2시간 ~ +1.5시간인 곳만 (아침 숙소에서 저녁 숙소 도착을 묻지 않게)
  let geoCand = null;
  function askedKey() { return 'trip-geo-asked-' + (USER ? USER.id : ''); }
  function asked() { try { return JSON.parse(LS.get(askedKey(), '{}')); } catch (e) { return {}; } }
  function geofence() {
    if (LS.get(GEO_KEY, '0') !== '1' || !DATA || !USER || !canStamp() || !lastPos || lastPos.acc > 60) return;
    const nt = tokyoNow();
    const done = asked();
    let best = null;
    DATA.points.filter(p => p.date === nt.date && p.lat != null).forEach(p => {
      const vk = p.date + '#' + p.order;
      if (arrivedAt(p) || done[vk]) return;
      const plan = predictedMin(p) != null ? predictedMin(p) : toMin(p.arrive);
      if (plan != null && (nt.min < plan - 120 || nt.min > plan + 90)) return;
      const d = haversine([lastPos.lat, lastPos.lng], [p.lat, p.lng]);
      if (d > 80) return;
      const score = Math.abs((plan == null ? nt.min : plan) - nt.min) + d / 10;
      if (!best || score < best.score) best = { vk: vk, p: p, score: score };
    });
    if (!best) { geoCand = null; return; }
    if (!geoCand || geoCand.vk !== best.vk) { geoCand = { vk: best.vk, since: Date.now() }; return; }
    if (Date.now() - geoCand.since < 60000 || document.getElementById('geoAsk')) return;
    const p = best.p, vk = best.vk;
    const mark = () => { const a = asked(); a[vk] = 1; LS.set(askedKey(), JSON.stringify(a)); };
    const el = bar('geoAsk');
    el.innerHTML = '<span><b>' + esc(pname(p)) + '</b> 근처. 도착 찍을까?</span>' +
      '<button type="button">도착</button><button type="button" class="ghost">아님</button>';
    el.querySelector('button').onclick = () => { mark(); el.remove(); recordArrivalNow(vk); };
    el.querySelector('.ghost').onclick = () => { mark(); el.remove(); };
    if (navigator.vibrate) navigator.vibrate(60);
  }

  function paintGeo() {
    const el = document.getElementById('devGeo');
    if (!el) return;
    const on = LS.get(GEO_KEY, '0') === '1';
    el.innerHTML = '<h3>위치</h3>' +
      '<p>' + (geoWatch != null ? '<b class="ok">위치 켜짐</b>' : '위치 꺼짐') + ' · 다음 장소 거리, 걸어서 도착 예상, 근처 도착 제안에 사용. 앱이 열려 있을 때만 동작</p>' +
      '<div class="row"><label class="chk"><input type="checkbox" id="geoOn"' + (on ? ' checked' : '') + '><span>근처 오면 도착 찍을지 묻기</span></label>' +
      (geoWatch == null ? '<button class="btn" type="button" id="geoStart">위치 켜기</button>' : '') + '</div>';
    document.getElementById('geoOn').onchange = e => LS.set(GEO_KEY, e.target.checked ? '1' : '0');
    const b = document.getElementById('geoStart');
    if (b) b.onclick = () => { startWatch(); setTimeout(paintGeo, 1500); };
  }

  /* ── 8. 친구 기록 실시간 반영 ── */
  //  프록시가 데이터 지문(_v)이 바뀔 때마다 알려줌 → 내가 가진 것과 다르면 다시 받음
  //  입력 중(지출 칸 등)이거나 시트·상세가 열려 있으면 다 닫힐 때까지 미룸
  let es = null, pendingPull = false, pulling = false;
  function busy() {
    const a = document.activeElement;
    return (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) ||
      document.querySelector('.sheet-wrap.open, .detail-wrap.open, .spend-form.open, .arr-form.open, .photo-view');
  }
  function startEvents() {
    if (!window.EventSource || (es && es.readyState !== 2)) return;
    es = new EventSource(API + '/events');
    es.addEventListener('data', e => {
      let d = null;
      try { d = JSON.parse(e.data); } catch (err) { return; }
      if (d && d.v && RAW && RAW._v !== d.v) pull();
    });
    es.onopen = () => flushOutbox();
  }
  function pull() {
    if (pulling) { pendingPull = true; return; }
    if (busy()) { pendingPull = true; setTimeout(() => { if (pendingPull) { pendingPull = false; pull(); } }, 3000); return; }
    pulling = true; pendingPull = false;
    apiCall('getMapData', []).then(data => {
      applyData(data, true);
      saveCache(data);
    }, () => null).finally(() => { pulling = false; if (pendingPull) pull(); });
  }
  addEventListener('load', startEvents);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    startEvents();      // 폰이 백그라운드에서 끊은 연결 다시
    flushOutbox();
  });
  addEventListener('online', () => { startEvents(); flushOutbox(); });

  /* ── 9. 오프라인 쓰기 대기열 ── */
  //  도장·도착·지출은 연결이 안 되면 대기열에 넣고 화면에는 저장된 것처럼 보여줌
  //  일정 조정(경로 다시 계산)·PIN 확인은 서버가 꼭 필요해서 대기열 안 씀
  const QUEUE_FNS = { setVisitedMany: 1, setVisited: 1, setArrived: 1, setSpend: 1 };
  const OUTBOX_KEY = 'trip-outbox-v1';
  let outbox = [], flushing = false;
  (window.TRIP_STORE ? window.TRIP_STORE.get(OUTBOX_KEY) : Promise.resolve(LS.get(OUTBOX_KEY, null))).then(raw => {
    try { outbox = JSON.parse(raw || '[]') || []; } catch (e) { outbox = []; }
    paintOutbox();
    if (outbox.length) flushOutbox();
  }, () => null);
  function saveOutbox() {
    const raw = JSON.stringify(outbox);
    if (window.TRIP_STORE) window.TRIP_STORE.set(OUTBOX_KEY, raw); else LS.set(OUTBOX_KEY, raw);
    paintOutbox();
  }
  const retryable = e => !e || e.status == null || e.status === 0 || e.status === 429 || e.status >= 500;
  // 대기열에 넣었을 때 성공 처리기에 넘길 값 = 지금 화면 상태 (화면은 이미 바꿔 둔 상태)
  function localResult(fn) {
    if (fn === 'setArrived') return Object.assign({}, DATA && DATA.arrived);
    if (fn === 'setSpend') return Object.assign({}, DATA && DATA.spend);
    return Object.assign({}, DATA && DATA.visited);
  }
  const apiCall0 = apiCall;
  apiCall = async function (fn, args) {
    if (!QUEUE_FNS[fn]) return apiCall0(fn, args);
    // 앞에 밀린 게 있으면 순서 지키려고 뒤에 붙임
    if (outbox.length || !navigator.onLine) { enqueue(fn, args); return localResult(fn); }
    try {
      return await apiCall0(fn, args);
    } catch (e) {
      if (!retryable(e)) throw e;
      enqueue(fn, args);
      return localResult(fn);
    }
  };
  function enqueue(fn, args) {
    outbox.push({ fn: fn, args: args, at: Date.now(), tries: 0 });
    saveOutbox();
    setTimeout(flushOutbox, 5000);
  }
  async function flushOutbox() {
    if (flushing || !outbox.length || !navigator.onLine) return;
    flushing = true;
    let sent = 0;
    try {
      while (outbox.length) {
        const op = outbox[0];
        try {
          await apiCall0(op.fn, op.args);
          outbox.shift(); sent++;
        } catch (e) {
          if (retryable(e) && (e.status === 0 || e.status == null || ++op.tries < 8)) { saveOutbox(); break; }
          outbox.shift();
          showToast('보내지 못한 기록 1건 버림: ' + (e && e.message || e));
        }
        saveOutbox();
      }
    } finally {
      flushing = false;
    }
    if (sent) { showToast('밀린 기록 ' + sent + '건 보냄'); pull(); }
  }
  setInterval(flushOutbox, 30000);
  // 서버에서 받은 데이터에 아직 못 보낸 기록을 덮어서 보여줌 (받는 순간 깜빡 사라지지 않게)
  function overlayOutbox(data) {
    if (!data || !outbox.length) return;
    outbox.forEach(op => {
      const a = op.args || [];
      if (op.fn === 'setVisitedMany' || op.fn === 'setVisited') {
        const user = op.fn === 'setVisited' ? a[2] : a[1];
        const changes = op.fn === 'setVisited' ? { [a[0]]: a[1] ? 1 : 0 } : (a[0] || {});
        data.visitedBy = Object.assign({}, data.visitedBy);
        const m = data.visitedBy[user] = Object.assign({}, data.visitedBy[user]);
        Object.keys(changes).forEach(k => { if (changes[k]) m[k] = 1; else delete m[k]; });
      } else if (op.fn === 'setArrived') {
        data.arrivedBy = Object.assign({}, data.arrivedBy);
        const m = data.arrivedBy[a[2]] = Object.assign({}, data.arrivedBy[a[2]]);
        if (a[1]) m[a[0]] = a[1]; else delete m[a[0]];
      } else if (op.fn === 'setSpend') {
        data.spend = Object.assign({}, data.spend);
        if (a[2] === '' || a[2] == null) delete data.spend[a[0]]; else data.spend[a[0]] = { amount: Number(a[2]), memo: a[3] || '' };
      }
    });
  }
  const applyData2 = applyData;
  applyData = function (data, keepView) { overlayOutbox(data); return applyData2(data, keepView); };
  // 헤더 새로고침 버튼 옆 "↑ 3" 표시
  function paintOutbox() {
    let el = document.getElementById('obx');
    if (!outbox.length) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('button');
      el.id = 'obx'; el.type = 'button'; el.className = 'obx';
      el.onclick = () => { showToast('보낼 기록 ' + outbox.length + '건. 연결되면 자동으로 보냄'); flushOutbox(); };
      const rl = document.getElementById('reload');
      rl.parentNode.insertBefore(el, rl);
    }
    el.textContent = '↑ ' + outbox.length;
    el.title = '아직 못 보낸 기록 ' + outbox.length + '건';
  }

  /* ── 10. 공유 ── */
  async function share(title, text, url) {
    const data = { title: title, text: text };
    if (url) data.url = url;
    try {
      if (navigator.share) { await navigator.share(data); return; }
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // 사용자가 닫음
    }
    const all = text + (url ? '\n' + url : '');
    try { await navigator.clipboard.writeText(all); showToast('복사함. 붙여넣기로 보내기'); }
    catch (e) { prompt('복사해서 보내기', all); }
  }
  function mapsUrl(p) {
    const pl = typeof placeOf === 'function' ? placeOf(p) : null;
    if (pl && pl.link && /^https?:\/\//.test(pl.link)) return pl.link;
    return p.lat != null ? 'https://www.google.com/maps/search/?api=1&query=' + p.lat + ',' + p.lng : '';
  }
  function sharePlace(vk) {
    const p = DATA.points.find(x => x.date + '#' + x.order === vk);
    if (!p) return;
    const pl = typeof placeOf === 'function' ? placeOf(p) : null;
    const lines = [dayLabel(p.date) + ' ' + (p.arrive || '') + (p.depart && p.depart !== p.arrive ? '~' + p.depart : '') + ' ' + pname(p)];
    if (pl && pl.name && pl.name !== pname(p)) lines.push(pl.name);
    if (p.activity) lines.push(p.activity);
    share(pname(p), lines.join('\n'), mapsUrl(p));
  }
  function shareDay(date) {
    const pts = DATA.points.filter(p => p.date === date).sort((a, b) => a.order - b.order);
    if (!pts.length) return;
    const text = dayLabel(date) + ' 일정\n' + pts.map(p => (p.arrive || '  :  ') + ' ' + pname(p)).join('\n');
    share(dayLabel(date) + ' 일정', text, location.origin + '/');
  }
  const renderTimeline0 = renderTimeline;
  renderTimeline = function () {
    renderTimeline0();
    const box = document.getElementById('tlInner');
    if (!box) return;
    // 공유 버튼은 ⋯ 시트에 들어가게 숨은 버튼 모음(.act-more)에 넣음
    box.querySelectorAll('.titem[data-key] .tcard .actions').forEach(act0 => {
      const act = act0.querySelector('.act-more') || act0;
      if (act.querySelector('.share-btn')) return;
      const vk = act.closest('.titem').dataset.key;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'share-btn'; b.textContent = '공유';
      b.onclick = () => sharePlace(vk);
      act.appendChild(b);
    });
    const tools = box.querySelector('.tl-tools');
    if (tools && !tools.querySelector('.share-day')) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'share-day';
      b.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10V2M5 5l3-3 3 3"/><path d="M3 9v4h10V9"/></svg><span>이 날 공유</span>';
      b.onclick = () => shareDay(selected && selected !== 'all' ? selected : (DATA.dates.indexOf(tokyoNow().date) >= 0 ? tokyoNow().date : DATA.dates[0]));
      tools.insertBefore(b, tools.firstChild);
    }
  };

  /* ── 11·12. 하단 탭바 · 헤더 접기 · 화면 전환 ── */
  // 탭 4개 (묶음은 App_Theme의 VIEW_GROUP·goGroup): 홈 / 일정(타임라인·지도) / 장소(가이드·도감) / 여권
  const TAB_ORDER = ['home', 'plan', 'tl', 'area', 'guide', 'pass'];
  const TABS = [
    ['home', '홈', '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>'],
    ['sched', '일정', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'],
    ['place', '장소', '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'],
    ['pass', '여권', '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="11" r="3"/><path d="M9 17h6"/>'],
  ];
  const groupOf = v => (window.VIEW_GROUP && window.VIEW_GROUP[v]) || v;
  const tabbar = document.createElement('nav');
  tabbar.className = 'tabbar';
  tabbar.setAttribute('aria-label', '보기');
  tabbar.innerHTML = TABS.map(t => '<button type="button" data-v="' + t[0] + '"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    t[2] + '</svg><span>' + t[1] + '</span></button>').join('');
  tabbar.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.v === groupOf(currentView)) { scrollTopCurrent(); return; }   // 같은 탭 한 번 더 → 맨 위로
    if (window.goGroup) window.goGroup(b.dataset.v); else setView(b.dataset.v);
  }));
  document.body.appendChild(tabbar);
  document.body.classList.add('has-tabbar');
  function syncTabs() {
    tabbar.querySelectorAll('[data-v]').forEach(b => { if (b.dataset.v === groupOf(currentView)) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  }
  function scrollTopCurrent() {
    const sel = { home: '#home', pass: '#pass', wrap: '#wrap', who: '#who', area: '#area', guide: '#dexList', plan: '#list', tl: '.swiper-slide-active, .tl-scroll' }[currentView];
    const el = sel && document.querySelector(sel);
    if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
    setHeaderMin(false);
  }
  // 탭바 높이 → 토스트·칩 위치 계산용
  const tabH = () => document.documentElement.style.setProperty('--tabbar-h', (tabbar.offsetParent ? tabbar.offsetHeight : 0) + 'px');
  if (window.ResizeObserver) new ResizeObserver(tabH).observe(tabbar);
  addEventListener('resize', tabH);

  // 헤더 접기: 폰에서 아래로 스크롤하면 제목줄 숨김, 위로 조금만 올려도 다시
  const lastTop = new WeakMap();
  let hdrMin = false;
  function setHeaderMin(on) {
    if (on === hdrMin) return;
    hdrMin = on;
    document.body.classList.toggle('hdr-min', on);
    if (currentView === 'plan') setTimeout(() => { try { map.invalidateSize(); } catch (e) { /* 무시 */ } }, 260);
  }
  document.addEventListener('scroll', e => {
    if (!matchMedia('(max-width: 640px)').matches) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    const top = t.scrollTop, prev = lastTop.has(t) ? lastTop.get(t) : top;
    lastTop.set(t, top);
    const d = top - prev;
    if (top < 40) setHeaderMin(false);
    else if (d > 6) setHeaderMin(true);
    else if (d < -10) setHeaderMin(false);
  }, { capture: true, passive: true });

  function afterView() { syncTabs(); setHeaderMin(false); tabH(); }
  syncTabs();

  const css2 = document.createElement('style');
  css2.textContent = `
  .share-btn { font: inherit; font-size: 12px; color: var(--muted); background: var(--panel); border: 1px solid var(--rule); border-radius: 12px; padding: 1px 10px; cursor: pointer; }
  .tl-tools { align-items: center; }
  .share-day { display: inline-flex; align-items: center; gap: 4px; margin-right: auto; font: inherit; font-size: 12px; color: var(--muted);
    background: none; border: 1px solid var(--rule); border-radius: 8px; padding: 5px 9px; cursor: pointer; }
  .obx { font: inherit; font-size: 12px; font-weight: 700; color: #c2410c; background: color-mix(in srgb, #c2410c 10%, var(--panel));
    border: 1px solid color-mix(in srgb, #c2410c 35%, transparent); border-radius: 8px; height: 32px; padding: 0 9px; cursor: pointer; }

  /* 화면 전환: 헤더·탭바는 그대로, 본문만 살짝 밀리며 바뀜 */
  header { view-transition-name: hdr; }
  .tabbar { view-transition-name: tabbar; }
  ::view-transition-old(root) { animation: vt-out .16s cubic-bezier(.4, 0, 1, 1) both; }
  ::view-transition-new(root) { animation: vt-in .22s cubic-bezier(.2, .7, .2, 1) both; }
  @keyframes vt-out { to { opacity: 0; transform: translateX(calc(var(--vt-dir, 1) * -18px)); } }
  @keyframes vt-in { from { opacity: 0; transform: translateX(calc(var(--vt-dir, 1) * 18px)); } }

  /* 하단 탭바 (폰) */
  .tabbar { display: none; }
  @media (max-width: 640px) {
    body.has-tabbar .views .seg { display: none; }
    body.has-tabbar .views { width: auto; }
    body.has-tabbar .title-row { flex-wrap: nowrap; align-items: center; }
    .tabbar { display: grid; grid-template-columns: repeat(4, 1fr); order: 99; flex: none; position: relative; z-index: 600;
      background: color-mix(in srgb, var(--panel) 94%, transparent); border-top: 1px solid var(--rule);
      padding: 4px 6px calc(4px + env(safe-area-inset-bottom, 0px)); }
    .tabbar button { display: flex; flex-direction: column; align-items: center; gap: 2px; font: inherit; font-size: 11px; font-weight: 500; min-height: 48px; justify-content: center;
      color: var(--muted); background: none; border: 0; padding: 6px 0 4px; border-radius: 10px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .tabbar button svg { transition: transform .18s var(--ease); }
    .tabbar button[aria-current="page"] { color: var(--ink); font-weight: 700; }
    .tabbar button[aria-current="page"] svg { transform: translateY(-1px); stroke-width: 2.1; }
    .tabbar button:active svg { transform: scale(.9); }
    body[data-view="who"] .tabbar { display: none; }
    body.has-tabbar .toast { bottom: calc(var(--tabbar-h, 0px) + 12px); }
    body.has-tabbar #nextChip { bottom: calc(var(--tabbar-h, 0px) + 10px); }
    body.has-tabbar #geoAsk { bottom: calc(var(--tabbar-h, 0px) + 62px); }

    /* 헤더 접기 */
    body.has-tabbar .title-row { max-height: 90px; overflow: hidden; transition: max-height .22s var(--ease), opacity .18s var(--ease); }
    body.has-tabbar.hdr-min .title-row { max-height: 0; opacity: 0; }
    body.has-tabbar header { transition: padding .22s var(--ease); }
    body.has-tabbar.hdr-min header { padding-top: env(safe-area-inset-top, 0px); }
    body.has-tabbar.hdr-min .days { margin-top: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
    body.has-tabbar .title-row, body.has-tabbar header { transition: none; }
  }
  `;
  document.head.appendChild(css2);
})();
