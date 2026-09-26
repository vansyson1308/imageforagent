# Storyboard Studio (+ Director): production image.
# Secrets (NEBIUS_API_KEY, TAVILY_API_KEY, DEMO_PASSCODE) are NEVER baked in:
# set them as platform environment variables (Railway → Variables).
# Mount a persistent volume at /data (SQLite DB + rendered storage) — attach it
# on the platform (Railway volume, docker run -v); no VOLUME line (Railway rejects it).
#
# Base: Ubuntu 24.04 (ffmpeg 6.1 + espeak-ng, the versions the test suite is
# verified against), with Node 22 copied from the official image.

FROM node:22-bookworm-slim AS node

FROM ubuntu:24.04 AS base
ENV NEXT_TELEMETRY_DISABLED=1 DEBIAN_FRONTEND=noninteractive
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version && npm --version
WORKDIR /app

# ---- dependencies (native modules: better-sqlite3, sharp) ----
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ---- build ----
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# ---- runtime: ffmpeg (film assembler) + espeak-ng (offline TTS) ----
FROM base AS run
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg espeak-ng ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/storyboard.db \
    STORAGE_ROOT=/data/storage
COPY --from=build /app ./
RUN chmod +x scripts/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "scripts/docker-entrypoint.sh"]
