# syntax=docker/dockerfile:1
# Production image for the Quiet Growth Media API + job worker.
# Built and run on the VPS by deploy/scripts/deploy.sh (see docs/phase-2-vps.md).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
# ffmpeg/ffprobe are needed for rendering and video QA (Phase 5); tini forwards signals for graceful shutdown.
RUN apk add --no-cache ffmpeg tini
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# Caption fonts (Latin, Devanagari, Telugu) used by the FFmpeg renderer.
COPY assets ./assets
# Working directory for generated media; mounted as a named volume in production.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
