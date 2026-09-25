#!/bin/sh
# Boot: make sure the volume layout exists, apply migrations, start Next.
set -e
mkdir -p /data/storage
npx prisma migrate deploy
exec npx next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
