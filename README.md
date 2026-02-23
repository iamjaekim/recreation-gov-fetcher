# recreation-gov-watcher

A high-performance campsite availability monitor for [recreation.gov](https://www.recreation.gov). It polls multiple campgrounds and months in parallel, filters for consecutive nights starting on specific dates, and sends instant Telegram push notifications.

## Features

1. **Parallel Polling**: Fans out parallel `fetch` requests for every combination of `CAMPGROUND_IDS` and `MONTHS`.
2. **Consecutive Run Matching**: Scans for consecutive "Available" dates that meet your `MIN_NIGHTS`.
3. **Start Date Filtering**: Optionally restrict alerts to stays that **begin on** specific dates (e.g., only Fridays).
4. **Persistent Alarm**: Unlike other bots, this one has **no deduplication memory**. If a site is available, it will ping you on **every poll** until it is booked. This ensures you don't miss the window.
5. **Interactive Telegram Bot**: Trigger manual checks or view status directly from your Telegram chat.

## Files

| File | Purpose |
|---|---|
| `watch.js` | Core logic — parallel polling, parsing, and Telegram alerts. |
| `Dockerfile` | Minimal Alpine-based Node container. |
| `docker-compose.yml` | Orchestrates the watcher; the recommended way to run. |
| `.env.example` | Template for your secrets and configuration. |

## Configuration

All configuration is handled via environment variables inside `.env` or passed directly to Docker.

| Env Var | Description |
|---|---|
| `CAMPGROUND_IDS` | Comma-separated list of IDs. Find ID in the URL: `/campgrounds/{ID}`. |
| `MONTHS` | Comma-separated months to watch (e.g., `2026-05,2026-06`). |
| `START_DATES` | Optional. Comma-separated dates the stay **must begin on** (`YYYY-MM-DD`). |
| `MIN_NIGHTS` | Minimum consecutive nights required (default: `1`). |
| `INTERVAL` | Polling frequency in minutes (e.g., `5`). |
| `TELEGRAM_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather). |
| `TELEGRAM_CHAT_ID` | Your personal chat ID. |

## Quick Start

### 1. Preparations
- Create a bot via [@BotFather](https://t.me/BotFather).
- Get your Chat ID by messaging your bot.
- Copy `.env.example` to `.env` and fill in your values.

### 2. Run with Docker (Recommended)
```bash
# Build and run
docker compose up --build -d

# Check live status
docker compose logs -f
```

### 3. Run Locally (Node 24+)
```bash
# Uses Node's built-in .env support
node --env-file=.env watch.js
```

## Telegram Commands
The bot listens for commands from your `TELEGRAM_CHAT_ID`:
- `/check`: Trigger a manual poll immediately.
- `/status`: Show current config and poll statistics.
- `/help`: Show available commands.

## Automation & Releases
This project uses **Release Please** for automated versioning and changelogs.
- **Commits**: Use [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat:`, `fix:`) to trigger version bumps.
- **Merge Strategy**: All PRs are **Squash Merged** to keep the `main` history clean (one commit per feature/fix).
- **Docker**: New images are automatically published to the Container Registry on every version tag.

