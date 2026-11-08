// 정적 페이지 빌드: Apps Script용 Index.html + include 파일들을 한 장짜리 web/dist/index.html로 합침
//  화면 코드 원본은 저장소 루트의 App_*.html / Style_*.html 하나뿐 → Apps Script 웹앱과 정적 페이지가 같은 코드를 씀
//  실행: node web/build.mjs   (API 주소는 web/config.json 또는 환경변수 TRIP_API_URL)
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = dirname(fileURLToPath(import.meta.url));
const ROOT = join(WEB, '..');
const DIST = join(WEB, 'dist');

const config = existsSync(join(WEB, 'config.json')) ? JSON.parse(readFileSync(join(WEB, 'config.json'), 'utf8')) : {};
const apiUrl = process.env.TRIP_API_URL || config.apiUrl || '';
if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(apiUrl)) {
  console.error('API 주소가 없거나 형식이 다름: ' + (apiUrl || '(비어 있음)'));
  console.error('web/config.json 의 apiUrl 에 Apps Script 웹앱 주소(.../exec)를 넣을 것');
  process.exit(1);
}

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
html = html.replace('<script>const BOOT_USERS', '<script>window.TRIP_API_URL = ' + JSON.stringify(apiUrl) + ';</script>\n<script>const BOOT_USERS');

// 3. Apps Script 전용 부분 정리: iframe용 base 태그 제거, 제목·viewport는 Apps Script가 붙여주던 것이라 직접 넣음
html = html.replace(/<base target="_top">\s*/i, '');
html = html.replace('<meta charset="utf-8">',
  '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>여행 타임라인</title>');

// 4. 남은 Apps Script 템플릿 구문이 있으면 실패 (빠뜨린 치환 방지)
const left = html.match(/<\?[!=]?[\s\S]*?\?>/);
if (left) throw new Error('처리 안 된 템플릿 구문: ' + left[0].slice(0, 80));

mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'index.html'), html);
if (existsSync(join(WEB, 'public'))) cpSync(join(WEB, 'public'), DIST, { recursive: true });
console.log('빌드 완료: web/dist/index.html (' + Math.round(html.length / 1024) + 'KB, 포함 ' + used.length + '개: ' + used.join(', ') + ')');
