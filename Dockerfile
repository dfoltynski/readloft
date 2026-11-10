# syntax=docker/dockerfile:1

# ---- build web ----
FROM node:24-alpine AS web
WORKDIR /app
RUN apk add --no-cache git
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared shared
COPY scripts scripts
COPY web web
ARG FOLIATE_REF=main
RUN FOLIATE_REF=$FOLIATE_REF sh scripts/fetch-foliate.sh && rm -rf web/public/foliate-js/.git \
    && npm run build -w web

# ---- runtime ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    LIBRARY_DIR=/books \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY shared shared
COPY server server
COPY --from=web /app/web/dist web/dist
RUN mkdir -p /books /data && chown -R node:node /books /data
USER node
EXPOSE 8080
VOLUME ["/books", "/data"]
WORKDIR /app/server
CMD ["node", "src/index.ts"]
