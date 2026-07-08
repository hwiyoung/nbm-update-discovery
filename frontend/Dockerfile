# ============================================================
# frontend/Dockerfile — Vite dev server (개발용)
# 운영 빌드(Nginx 정적 서빙) 는 이정표 6에서 Dockerfile.prod 추가.
# ============================================================
FROM node:20-alpine

WORKDIR /app

# 종속성 먼저 설치 (빌드 캐시 활용)
COPY package.json package-lock.json* ./
COPY patches ./patches
RUN npm install --no-audit --no-fund

# 나머지 소스는 compose의 volume 으로 마운트되어 HMR.
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
