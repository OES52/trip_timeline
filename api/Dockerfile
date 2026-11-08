# trip-api: 저장소 루트에서  docker build -f api/Dockerfile -t trip-api api
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.mjs ./
# node 사용자(1000). /data는 PVC
USER 1000:1000
EXPOSE 8080
CMD ["node", "server.mjs"]
