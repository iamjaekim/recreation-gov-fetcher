# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:24-alpine AS base

WORKDIR /app

COPY package.json watch.js ./

# All config via env vars (overridable at `docker run` or in compose)
ENV CAMPGROUND_IDS="" \
    MONTHS="" \
    INTERVAL=5 \
    MIN_NIGHTS=1 \
    START_DATES="" \
    NOTIFY_PARTIAL="false"

CMD ["sh", "-c", "node watch.js \
    --campgrounds \"$CAMPGROUND_IDS\" \
    --months      \"$MONTHS\" \
    --interval    \"$INTERVAL\" \
    --min-nights  \"$MIN_NIGHTS\" \
    --start-dates \"$START_DATES\""]