// 정적 페이지 빌드: Apps Script용 Index.html + include 파일들을 한 장짜리 web/dist/index.html로 합침
//  화면 코드 원본은 저장소 루트의 App_*.html / Style_*.html 하나뿐 → Apps Script 웹앱과 정적 페이지가 같은 코드를 씀
//  실행: node web/build.mjs   (API 주소는 web/config.json 또는 환경변수 TRIP_API_URL)
//  정적 페이지 전용 코드는 web/src/ (Apps Script에는 안 올라감)
//   static-head.js : 저장소(IndexedDB) → App_Core보다 먼저
//   static-tail.js : 서비스 워커·오프라인 준비·위치·알림 → 화면 코드 다 끼운 뒤, load() 직전
//   sw.js          : 서비스 워커 템플릿 → dist/sw.js (버전·미리 저장 목록 채움)
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = dirname(fileURLToPath(import.meta.url));
const ROOT = join(WEB, '..');
const DIST = join(WEB, 'dist');

const config = existsSync(join(WEB, 'config.json')) ? JSON.parse(readFileSync(join(WEB, 'config.json'), 'utf8')) : {};
const apiUrl = process.env.TRIP_API_URL || config.apiUrl || '';
// /api : 홈랩 프록시(trip-api) 경유 (권장) / https://script.google.com/.../exec : Apps Script 직접 (예전 방식)
if (!/^\/[a-z0-9/_-]*[a-z0-9]$/i.test(apiUrl) && !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(apiUrl)) {
  console.error('API 주소가 없거나 형식이 다름: ' + (apiUrl || '(비어 있음)'));
  console.error('web/config.json 의 apiUrl 에 /api (홈랩 프록시) 또는 Apps Script 웹앱 주소(.../exec)를 넣을 것');
  process.exit(1);
}
const viaProxy = apiUrl.charAt(0) === '/';
// 이 화면이 놓일 경로 (예전 화면은 /v1/, 새 화면 v2가 / 를 맡음). 환경변수 TRIP_BASE 또는 config.base
const BASE = ((process.env.TRIP_BASE || config.base || '/').replace(/\/?$/, '/')).replace(/^(?!\/)/, '/');
// 화면 코드에 넘길 설정 (사진 프록시는 프록시 경유일 때만 의미 있음)
const clientCfg = {
  photoProxy: viaProxy && config.photoProxy !== false,
  base: BASE,
};
const SRC = join(WEB, 'src');
const src = name => readFileSync(join(SRC, name), 'utf8');
// </script> 가 코드 안에 있으면 HTML이 깨짐
const inline = code => { if (/<\/script/i.test(code)) throw new Error('끼워 넣을 코드에 </script> 있음'); return code; };

let html = readFileSync(join(ROOT, 'Index.html'), 'utf8');

// 1. <?!= include('X'); ?> → X.html 내용 (끼워 넣은 파일 안에 또 include가 있어도 처리)
const INCLUDE = /<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\);?\s*\?>/g;
const used = [];
for (let depth = 0; INCLUDE.test(html); depth++) {
  if (depth > 5) throw new Error('include가 너무 깊음 (순환 참조?)');
  INCLUDE.lastIndex = 0;
  html = html.replace(INCLUDE, (_, name) => {
    const file = join(ROOT, name + '.html');
    if (!existsSync(file)) throw new Error('include 대상 파일 없음: ' + name + '.html');
    used.push(name);
    return readFileSync(file, 'utf8');
  });
  INCLUDE.lastIndex = 0;
}

// 2. 서버가 끼워 넣던 사용자 목록 → 빈 배열 (사용자는 데이터 받을 때 같이 옴) + API 주소 지정
const BOOT = /<\?!=\s*bootUsers\s*\?>/;
if (!BOOT.test(html)) throw new Error('Index.html에서 bootUsers 자리를 못 찾음');
html = html.replace(BOOT, '[]');
const headJs = viaProxy ? '<script>' + inline(src('static-head.js')) + '</script>\n' : '';
html = html.replace('<script>const BOOT_USERS', '<script>window.TRIP_API_URL = ' + JSON.stringify(apiUrl) + '; window.TRIP_CFG = ' +
  JSON.stringify(clientCfg) + ';</script>\n' + headJs + '<script>const BOOT_USERS');

// 정적 페이지 뒷부분: 마지막 <script>(load(); 호출) 바로 앞
if (viaProxy) {
  const at = html.lastIndexOf('<script>');
  if (at < 0 || !/^<script>[\s\S]*?\bload\(\);[\s\S]*?<\/script>/.test(html.slice(at))) throw new Error('마지막 load() 스크립트를 못 찾음');
  html = html.slice(0, at) + '<script>' + inline(src('static-tail.js')) + '</script>\n' + html.slice(at);
}

// 3. Apps Script 전용 부분 정리: iframe용 base 태그 제거, 제목·viewport는 Apps Script가 붙여주던 것이라 직접 넣음
html = html.replace(/<base target="_top">\s*/i, '');
html = html.replace('<meta charset="utf-8">',
  '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>여행 타임라인</title>' +
  (viaProxy ? '\n<link rel="manifest" href="' + BASE + 'manifest.webmanifest">' +
    '\n<meta name="theme-color" content="#1d2633">' +
    '\n<link rel="icon" href="/icons/icon-192.png">' +
    '\n<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">' +
    '\n<meta name="apple-mobile-web-app-capable" content="yes">' +
    '\n<meta name="mobile-web-app-capable" content="yes">' +
    '\n<meta name="apple-mobile-web-app-title" content="여행">' +
    '\n<meta name="apple-mobile-web-app-status-bar-style" content="default">' : ''));

// 4. 남은 Apps Script 템플릿 구문이 있으면 실패 (빠뜨린 치환 방지)
const left = html.match(/<\?[!=]?[\s\S]*?\?>/);
if (left) throw new Error('처리 안 된 템플릿 구문: ' + left[0].slice(0, 80));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'index.html'), html);
if (existsSync(join(WEB, 'public'))) cpSync(join(WEB, 'public'), DIST, { recursive: true });
// 매니페스트: 시작 주소·범위를 이 화면 경로로 (아이콘은 사이트 루트 /icons 를 같이 씀)
{
  const mf = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'));
  Object.assign(mf, { id: BASE, start_url: BASE, scope: BASE });
  if (BASE !== '/') mf.name = mf.name + ' (예전 화면)';
  writeFileSync(join(DIST, 'manifest.webmanifest'), JSON.stringify(mf, null, 2) + '\n');
}

// 서비스 워커: 페이지가 바뀌면 버전도 바뀜 → 폰에 "새 버전 있음"
if (viaProxy) {
  const cdn = Array.from(new Set((html.match(/(?:src|href)="(https:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com)\/[^"]+)"/g) || [])
    .map(m => m.replace(/^(?:src|href)="|"$/g, '').replace(/&amp;/g, '&'))));
  const precache = [BASE, BASE + 'manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/badge-96.png', '/icons/apple-touch-icon.png'].concat(cdn);
  // 아이콘은 사이트 루트(/icons)에 따로 나감 → web/public 에서 확인
  precache.filter(u => u.charAt(0) === '/' && u !== BASE).forEach(u => {
    const f = u.indexOf(BASE) === 0 ? join(DIST, u.slice(BASE.length)) : join(WEB, 'public', u);
    if (!existsSync(f)) throw new Error('미리 저장 목록 파일 없음: ' + u);
  });
  const tpl = src('sw.js');
  const version = createHash('sha256').update(html).update(tpl).update(JSON.stringify(precache)).digest('hex').slice(0, 12);
  writeFileSync(join(DIST, 'sw.js'), tpl.replace('__VERSION__', () => version).replace('__PRECACHE__', () => JSON.stringify(precache, null, 2)).replace(/__BASE__/g, () => BASE));
  console.log('경로 ' + BASE + ', 서비스 워커: 버전 ' + version + ', 미리 저장 ' + precache.length + '개');
}
console.log('빌드 완료: web/dist/index.html (' + Math.round(html.length / 1024) + 'KB, 포함 ' + used.length + '개: ' + used.join(', ') + ')');
