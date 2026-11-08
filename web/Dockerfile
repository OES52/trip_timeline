# 빌드: 저장소 루트에서  docker build -f web/Dockerfile -t trip-web .
# 1단계: 화면 코드(App_*.html, Style_*.html, Index.html)를 index.html 한 장으로 합침
#  빌드 단계는 빌드하는 기계 아키텍처로 돌려서 arm64 에뮬레이션 없이 빠르게
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
COPY Index.html App_*.html Style_*.html ./
COPY web ./web
RUN node web/build.mjs

# 2단계: 정적 파일만 nginx로 서빙 (root 아님, 8080)
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/web/dist /usr/share/nginx/html
EXPOSE 8080
