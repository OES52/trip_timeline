// 바로 전 배포의 앱 파일을 새 이미지에 같이 넣으려고 골라 복사함 (CI의 web.yml이 부름)
//  배포 직후에도 예전 화면을 열어 둔 사람은 예전 파일(지도 조각 등)을 늦게 받으러 옴 → 새 서버에 없으면 404
//  전 이미지의 sw.js에 든 "미리 저장 목록"이 그 빌드의 파일 전부라, 그것만 옮김 (그 전 것까지 쌓이지 않게)
//  쓰기: node scripts/prev-assets.mjs <전 이미지의 /v2 폴더> <출력 폴더>
import { readFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const [from, out] = process.argv.slice(2);
if (!from || !out) { console.error('쓰기: node scripts/prev-assets.mjs <전 /v2 폴더> <출력 폴더>'); process.exit(2); }

let list = [];
try {
  const sw = readFileSync(path.join(from, 'sw.js'), 'utf8');
  const m = /const PRECACHE = (\[[^\]]*\]);/.exec(sw);
  list = m ? JSON.parse(m[1]) : [];
} catch (e) {
  console.log('전 빌드 sw.js 없음, 건너뜀:', e.message);
}

let n = 0;
for (const u of list) {
  if (!u.startsWith('/v2/assets/')) continue;
  const rel = u.slice('/v2/'.length);
  const src = path.join(from, rel);
  if (!existsSync(src)) continue;
  mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  copyFileSync(src, path.join(out, rel));
  n++;
}
console.log('전 빌드 앱 파일', n + '개 옮김');
