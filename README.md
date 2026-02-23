# recreation-gov-watcher

A high-performance campsite availability monitor for [recreation.gov](https://www.recreation.gov). It polls multiple campgrounds and months in parallel, filters for consecutive nights starting on specific dates, and sends instant Telegram push notifications.

## How It Works

1. **Parallel Polling**: On startup and every `INTERVAL` minutes, the bot fans out parallel `fetch` requests for every combination of `CAMPGROUND_IDS` and `MONTHS`.
2. **Consecutive Run Matching**: For each site returned, it scans for consecutive "Available" dates that meet your `MIN_NIGHTS` requirement.
3. **Start Date Filtering**: You can optionally restrict alerts to stays that **begin on** specific dates (e.g., only Fridays).
4. **Persistent Alarm**: Unlike other bots, this one has **no deduplication memory**. If a site is available, it will ping you on **every poll** until it is booked. This acts as a persistent alarm to ensure you don't miss the window.

## Files

| File | Purpose |
|---|---|
| `watch.js` | Core logic — parallel polling, parsing, and Telegram alerts. Uses native `fetch`. |
| `Dockerfile` | Minimal Alpine-based Node container. |
| `docker-compose.yml` | Orchestrates the watcher; the recommended way to run. |
| `.env.example` | Template for your secrets and configuration. |

## Configuration

All configuration is handled via environment variables inside `.env` or passed directly to Docker.

| Env Var | Description |
|---|---|
| `CAMPGROUND_IDS` | Comma-separated list of IDs (e.g., `232447,232450`). Find ID in the URL: `/campgrounds/{ID}`. |
| `MONTHS` | Comma-separated months to watch (e.g., `2026-05,2026-06`). |
| `START_DATES` | Optional. Comma-separated dates the stay **must begin on** (`YYYY-MM-DD`). |
| `MIN_NIGHTS` | Minimum consecutive nights required (default: `1`). |
| `INTERVAL` | Polling frequency in minutes (e.g., `1` or `0.5`). |
| `TELEGRAM_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather). |
| `TELEGRAM_CHAT_ID` | Your personal chat ID. |

## Quick Start

### 1. Preparations
- Create a bot via [@BotFather](https://t.me/BotFather).
- Get your Chat ID by messaging your bot and running: `curl https://api.telegram.org/bot<TOKEN>/getUpdates`.
- Copy `.env.example` to `.env` and fill in your values.

### 2. Run with Docker (Recommended)
```bash
# Build and run
docker compose up --build -d

# Check live status
docker compose logs -f
```

### 3. Run Locally (Node 18+)
```bash
# Uses Node 20+ built-in .env support
node --env-file=.env watch.js
```

## Advanced Logic
- **No Deduplication**: The bot will notify you on every poll for an available site. If you want it to be quieter, increase the `INTERVAL`.
- **Parallelism**: Multiple campgrounds do not increase the poll time; they are fetched simultaneously.
- **Error Handling**: If an API call fails, it logs the error but keeps polling.
