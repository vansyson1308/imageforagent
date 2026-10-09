# Storyboard Studio (+ Director): production image.
# Secrets (NEBIUS_API_KEY, TAVILY_API_KEY, DEMO_PASSCODE) are NEVER baked in:
# set them as platform environment variables (Railway → Variables).
# Mount a persistent volume at /data (SQLite DB + rendered storage) — attach it
# on the platform (Railway volume, docker run -v); no VOLUME line (Railway rejects it).
#
# Base: Ubuntu 24.04 (ffmpeg 6.1 with rubberband + espeak-ng, the versions the
# test suite is verified against), with Node 22 copied from the official image.
# Piper neural voices (EN/VI/JA) add ~0.8 GB (D32).

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

# ---- Piper neural voices (D32): a separate stage so code changes never rebuild it ----
# piper-tts is GPL-3.0 and runs as a separate process (never linked); voices are pinned by hash.
FROM base AS piper
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/piper/venv \
 && /opt/piper/venv/bin/pip install --no-cache-dir piper-tts==1.8.0 pyopenjtalk-plus==0.4.1.post9 \
 && /opt/piper/venv/bin/pip uninstall -y pip
COPY scripts/fetch-voices.sh /tmp/fetch-voices.sh
RUN sh /tmp/fetch-voices.sh /opt/piper/voices \
 && echo "テスト" | /opt/piper/venv/bin/python -m piper -m /opt/piper/voices/ja_JP-hi_fi_captain-medium.onnx -f /tmp/ja.wav \
 && echo "Test." | /opt/piper/venv/bin/python -m piper -m /opt/piper/voices/en_US-kristin-medium.onnx -f /tmp/en.wav \
 && rm -f /tmp/*.wav

# ---- runtime: ffmpeg (film assembler) + espeak-ng (fallback TTS) + Piper (neural TTS) ----
FROM base AS run
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg espeak-ng python3 ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=piper /opt/piper /opt/piper
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/storyboard.db \
    STORAGE_ROOT=/data/storage \
    PIPER_PYTHON=/opt/piper/venv/bin/python \
    PIPER_VOICES_DIR=/opt/piper/voices
COPY --from=build /app ./
RUN chmod +x scripts/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "scripts/docker-entrypoint.sh"]
