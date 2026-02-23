#!/usr/bin/env node
/**
 * high-performance campsite availability monitor for recreation.gov.
 * Polls multiple campgrounds and months in parallel, filters for consecutive nights
 * starting on specific dates, and sends instant Telegram push notifications.
 * Usage:
 *   node watch.js [--campgrounds <id,...>] [--months <YYYY-MM,...>] [--interval <minutes>]
 *                 [--min-nights <n>] [--start-dates <YYYY-MM-DD,...>]
 *                 [--telegram-token <token>] [--telegram-chat-id <id>]
 *                 [--version] [--notify-partial]
 */

// No external dependencies needed. Native fetch is available in Node 18+

// ── Config ────────────────────────────────────────────────────────────────────
const pkg = require("./package.json");
const args = parseArgs(process.argv.slice(2));

if (process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log(`v${pkg.version}`);
    process.exit(0);
}
const CAMPGROUND_IDS = (args["campgrounds"] || process.env.CAMPGROUND_IDS || "")
    .split(",").filter(id => id.trim()).map((id) => id.trim());

const MONTHS = (args["months"] || process.env.MONTHS || "")
    .split(",").filter(m => m.trim()).map((m) => m.trim());

const START_DATES = (args["start-dates"] || process.env.START_DATES || "")
    .split(",").filter(d => d.trim()).map((d) => d.trim());

const INTERVAL_MINUTES = parseFloat(args["interval"] || process.env.INTERVAL || "5");
const MIN_NIGHTS = parseInt(args["min-nights"] || process.env.MIN_NIGHTS || "1", 10);
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

const TELEGRAM_TOKEN = args["telegram-token"] || process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID = args["telegram-chat-id"] || process.env.TELEGRAM_CHAT_ID || "";
const NOTIFY_PARTIAL = args["notify-partial"] !== undefined || process.env.NOTIFY_PARTIAL === "true";


// ── Validation ────────────────────────────────────────────────────────────────
if (CAMPGROUND_IDS.length === 0) {
    console.error("❌ Error: CAMPGROUND_IDS is required. Pass --campgrounds or set environment variable.");
    process.exit(1);
}
if (MONTHS.length === 0) {
    console.error("❌ Error: MONTHS is required (e.g. 2026-05). Pass --months or set environment variable.");
    process.exit(1);
}
if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("⚠️  Warning: Telegram credentials are not set. Notifications will only be logged to stdout.");
}

const HEADERS = {
    accept: "application/json",
    "cache-control": "no-cache",
};

let pollCount = 0;
let lastUpdateId = 0;


// ── Entry point ───────────────────────────────────────────────────────────────
console.log(`\n🏕️  Recreation.gov Availability Watcher`);
console.log(`   Campgrounds: ${CAMPGROUND_IDS.join(", ")}`);
console.log(`   Months     : ${MONTHS.join(", ")}`);
console.log(`   Interval   : every ${INTERVAL_MINUTES} min`);
console.log(`   Min nights : ${MIN_NIGHTS} consecutive night(s)`);
console.log(`   Start dates: run must begin on ${START_DATES.length ? START_DATES.join(" or ") : "any date"}`);
console.log(`   Telegram   : ${TELEGRAM_TOKEN ? `bot configured, chat ${TELEGRAM_CHAT_ID || "(chat ID not set)"}` : "(not configured)"}`);
console.log(`   Partial    : ${NOTIFY_PARTIAL ? "notifications enabled" : "disabled (min nights/start dates only)"}`);
console.log(`   Fetching   : ${CAMPGROUND_IDS.length * MONTHS.length} request(s) per poll\n`);


if (require.main === module) {
    poll(); // run immediately on start
    setInterval(poll, INTERVAL_MS);

    if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
        telegramListen();
    }

    // Graceful shutdown handlers
    const shutdown = () => {
        console.log("\n🛑 Gracefully shutting down...");
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}


// ── Core poll ─────────────────────────────────────────────────────────────────
async function poll(replyToId = null, source = "Poll") {
    const now = new Date().toLocaleTimeString();
    let label = source;
    if (source === "Poll") {
        pollCount++;
        label = `Poll #${pollCount}`;
    }
    process.stdout.write(`[${now}] ${label} — checking ${MONTHS.length} month(s)... `);

    try {

        // Fan out all campground × month combos in parallel
        const combos = CAMPGROUND_IDS.flatMap((cgId) => MONTHS.map((month) => fetchMonth(cgId, month)));
        const results = await Promise.all(combos);
        const available = results.flat();

        if (available.length === 0) {
            console.log("nothing available.");
            if (replyToId) telegramSend("📭 Nothing available right now\\.", replyToId);
            return;
        }



        // Filter: must have a run of MIN_NIGHTS starting on one of START_DATES
        const qualified = [];
        for (const s of available) {
            const match = runStartingOn(s.availableDates, MIN_NIGHTS, START_DATES);
            if (match) qualified.push({ ...s, matchedRun: match });
        }

        if (qualified.length === 0) {
            const total = available.reduce((sum, s) => sum + s.availableDates.length, 0);
            const msg = `${total} night(s) available but none have ${MIN_NIGHTS} consecutive nights starting on ${START_DATES.join(" or ")}.`;
            console.log(msg);
            if (replyToId || (NOTIFY_PARTIAL && TELEGRAM_TOKEN && TELEGRAM_CHAT_ID)) {
                telegramSend(`ℹ️ *Partial Match*\n${esc(msg)}`, replyToId || TELEGRAM_CHAT_ID);
            }
            return;
        }




        const fresh = qualified;


        console.log(`\n🎉 FOUND ${fresh.length} SITE(S)!\n`);
        for (const s of fresh) {
            console.log(
                `  ✅ [${s.campgroundId}] Site ${s.siteName || s.siteId} | Loop: ${s.loop || "—"} | Type: ${s.type || "—"}`
            );
            console.log(`     Matched run : ${s.matchedRun.join(" → ")} (${s.matchedRun.length} nights)`);
            console.log(`     All available: ${s.availableDates.join(", ")}`);
            console.log(`     Book: https://www.recreation.gov/camping/campgrounds/${s.campgroundId}`);
        }
        console.log("");

        if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) telegramNotify(fresh, replyToId || TELEGRAM_CHAT_ID);

    } catch (err) {
        console.log(`ERROR: ${err.message}`);
    }
}

// ── Fetch one campground+month combo ─────────────────────────────────────────
async function fetchMonth(campgroundId, month) {
    const startDate = `${month}-01T00:00:00.000Z`;
    const url = `https://www.recreation.gov/api/camps/availability/campground/${campgroundId}/month?start_date=${encodeURIComponent(startDate)}`;

    try {
        const res = await fetch(url, { headers: HEADERS });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} for ${campgroundId}/${month}`);
        }
        const data = await res.json();
        return parseAvailable(data, campgroundId, month);
    } catch (err) {
        throw new Error(`Fetch failed for ${campgroundId}/${month}: ${err.message}`);
    }
}

// ── Parse available sites from response ──────────────────────────────────────
function parseAvailable(data, campgroundId, month) {
    if (!data.campsites) return [];
    const results = [];

    for (const [siteId, site] of Object.entries(data.campsites)) {
        const avail = site.availabilities || {};
        const availDates = Object.entries(avail)
            .filter(([, status]) => status === "Available")
            .map(([date]) => date.slice(0, 10))
            .sort();

        if (availDates.length > 0) {
            results.push({
                campgroundId,
                siteId,
                siteName: site.site,
                loop: site.loop,
                type: site.campsite_type,
                availableDates: availDates,
                month,
            });
        }
    }

    return results;
}

// ── Telegram push notification ────────────────────────────────────────────────
async function telegramNotify(sites, chatId = TELEGRAM_CHAT_ID) {
    const MAX_LENGTH = 4000;
    const chunks = [];
    let currentChunk = "🚨 *SITE ALERT* 🚨\n\n";

    for (let i = 0; i < sites.length; i++) {
        const s = sites[i];
        const siteInfo = esc(`${s.siteName || s.siteId} (${s.loop || s.type || "—"})`);
        const runInfo = esc(s.matchedRun.join(" → "));
        const campgroundLabel = esc(`Book Site at Campground ${s.campgroundId}`);
        const siteBlock = `🔔 *Site ${siteInfo}*\n📅 ${runInfo}\n[${campgroundLabel}](https://www.recreation.gov/camping/campgrounds/${s.campgroundId})\n\n`;

        if (currentChunk.length + siteBlock.length > MAX_LENGTH) {
            chunks.push(currentChunk.trim());
            currentChunk = `🚨 *SITE ALERT \\(continued\\)* 🚨\n\n${siteBlock}`;
        } else {
            currentChunk += siteBlock;
        }
    }
    chunks.push(currentChunk.trim());

    for (let i = 0; i < chunks.length; i++) {
        const prefix = chunks.length > 1 ? esc(`(${i + 1}/${chunks.length}) `) : "";
        await telegramSend(`${prefix}${chunks[i]}`, chatId);
    }
}


async function telegramSend(text, chatId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: "MarkdownV2",
                disable_web_page_preview: false
            }),
        });
        const data = await res.json();
        if (!res.ok) console.error(`  ⚠️  Telegram error: ${data.description}`);
    } catch (err) {
        console.error(`  ⚠️  Telegram send failed: ${err.message}`);
    }
}

function esc(str) {
    if (!str) return "";
    // MarkdownV2 reserved: _ * [ ] ( ) ~ ` > # + - = | { } . !
    // We must be extremely thorough here.
    return str.toString()
        .replace(/\\/g, "\\\\") // Escape backslashes first
        .replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

async function telegramListen() {

    console.log("   Telegram   : Listening for commands (/check, /status)...");
    while (true) {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.ok && data.result.length > 0) {
                for (const update of data.result) {
                    lastUpdateId = update.update_id;
                    const msg = update.message;
                    if (msg && msg.chat.id.toString() === TELEGRAM_CHAT_ID.toString() && msg.text) {
                        const cmd = msg.text.trim().toLowerCase();
                        if (cmd === "/check" || cmd === "/poll") {
                            telegramSend("🔍 *Manual check triggered*\\.\\.\\.", msg.chat.id);
                            await poll(msg.chat.id, "Check");
                        } else if (cmd === "/status") {
                            const status = [
                                `ℹ️ *Watcher Status*`,
                                `📍 Campgrounds: ${esc(CAMPGROUND_IDS.join(", "))}`,
                                `📅 Months: ${esc(MONTHS.join(", "))}`,
                                `⏱ Interval: every ${esc(INTERVAL_MINUTES)}m`,
                                `🌙 Min Nights: ${esc(MIN_NIGHTS)}`,
                                `🔢 Poll Count: ${esc(pollCount)}`
                            ].join("\n");
                            telegramSend(status, msg.chat.id);
                        } else if (cmd === "/help" || cmd === "/start") {
                            telegramSend("👋 *Campground Watcher Commands*:\n\n/check \\- Trigger manual poll\n/status \\- View current settings", msg.chat.id);
                        }

                    }
                }
            }
        } catch (err) {
            if (err.message.includes("409")) {
                console.error(`  ⚠️  Telegram Conflict (409): Another instance is likely running with this token.`);
                console.error(`      Please stop all other bot processes or containers.`);
                await new Promise(r => setTimeout(r, 10000)); // wait longer on conflict
            } else {
                console.error(`  ⚠️  Telegram listener error: ${err.message}`);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
}


// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * Finds the first consecutive run of `minNights` dates that begins on one of
 * the `startDates` ("YYYY-MM-DD"). Returns the matching date array or null.
 * If startDates is empty, any run of the required length qualifies.
 */
function runStartingOn(dates, minNights, startDates) {
    if (dates.length < minNights) return null;

    // Build all consecutive runs
    const runs = [];
    let run = [dates[0]];
    for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1]);
        const curr = new Date(dates[i]);
        if ((curr - prev) / 86400000 === 1) {
            run.push(dates[i]);
        } else {
            runs.push(run);
            run = [dates[i]];
        }
    }
    runs.push(run);

    for (const r of runs) {
        if (r.length < minNights) continue;
        // Check every possible sub-run of exactly minNights within this run
        for (let start = 0; start <= r.length - minNights; start++) {
            const sub = r.slice(start, start + minNights);
            if (startDates.length === 0 || startDates.includes(sub[0])) {
                return sub;
            }
        }
    }
    return null;
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith("--") && i + 1 < argv.length) {
            out[argv[i].slice(2)] = argv[i + 1];
            i++;
        }
    }
    return out;
}

module.exports = {
    runStartingOn,
    parseAvailable,
    esc,
    poll,
    parseArgs,
};
