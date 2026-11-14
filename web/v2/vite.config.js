import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// 서비스 워커(sw/sw.js)를 빌드 결과 목록으로 채워 dist/sw.js로 내보냄
//  미리 저장: index.html + 앱 파일 전부. 단 Pretendard JP 글자 조각(100여 개, 6MB)은 쓰는 것만 그때그때 저장
function serviceWorker() {
  return {
    name: 'trip-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter(f => f !== 'index.html' && !/PretendardJP.*\.woff2$/.test(f) && !/\.woff$/.test(f) && !/\.map$/.test(f));
      const list = ['/v2/index.html'].concat(files.map(f => '/v2/' + f));
      const version = createHash('sha1').update(files.sort().join('|')).digest('hex').slice(0, 10);
      const src = readFileSync(new URL('./sw/sw.js', import.meta.url), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(list));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

// 같은 사이트의 /v2/ 아래에서 돎 (예전 화면은 / 에 그대로). API는 두 버전이 같은 /api 를 씀
export default defineConfig({
  base: '/v2/',
  plugins: [serviceWorker()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: 'dist', target: 'es2022', assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        // 지도 워커 파일(.mjs)은 .js 이름으로: 웹 서버가 .mjs를 자바스크립트 형식으로 안 보내면 워커가 안 뜸
        assetFileNames: a => (/\.mjs$/.test((a.names && a.names[0]) || a.name || '') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  server: {
    // npm run dev: 화면은 내 PC에서, 데이터는 실제 서버에서
    proxy: { '/api': { target: 'https://japan2026.oesgame.xyz', changeOrigin: true } },
  },
});
