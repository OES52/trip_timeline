import { defineConfig } from 'vite';

// 같은 사이트의 /v2/ 아래에서 돎 (예전 화면은 / 에 그대로). API는 두 버전이 같은 /api 를 씀
export default defineConfig({
  base: '/v2/',
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: { outDir: 'dist', target: 'es2022', assetsInlineLimit: 0 },
  server: {
    // npm run dev: 화면은 내 PC에서, 데이터는 실제 서버에서
    proxy: { '/api': { target: 'https://japan2026.oesgame.xyz', changeOrigin: true } },
  },
});
