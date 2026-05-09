#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const JINA_PREFIX = "https://r.jina.ai/";
const DEFAULT_MONTH_WINDOW = 3;

const SOURCES = {
  "91mobiles": "http://www.91mobiles.com/list-of-phones/latest-mobiles-in-india",
  smartprix: "http://www.smartprix.com/mobiles/latest-mobiles",
  gadgets360: "http://www.gadgets360.com/mobiles/latest-phones",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function normalizeSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(name) {
  return normalizeSpace(name).toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function toProxyUrl(sourceUrl) {
  if (!/^https?:\/\//i.test(sourceUrl)) return null;
  return `${JINA_PREFIX}${sourceUrl}`;
}

async function fetchMarkdownFromSource(sourceUrl) {
  const proxied = toProxyUrl(sourceUrl);
  if (!proxied) {
    throw new Error(`Invalid source URL: ${sourceUrl}`);
  }
  const maxAttempts = 4;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 35000);
    try {
      const res = await fetch(proxied, {
        method: "GET",
        headers: {
          Accept: "text/plain, text/markdown, */*",
          "User-Agent": "Mozilla/5.0",
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.text();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < maxAttempts) {
        await sleep(attempt * 1200);
        continue;
      }
    }
  }
  throw new Error(
    `Fetch failed after retries: ${sourceUrl} (${String(
      lastErr && lastErr.message ? lastErr.message : lastErr
    )})`
  );
}

function parseDayMonthYear(text) {
  const cleaned = normalizeSpace(text)
    .replace(/(\d+)(st|nd|rd|th)\b/gi, "$1")
    .replace(/,/g, " ");
  const m = cleaned.match(
    /(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})/i
  );
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[String(m[2]).toLowerCase()];
  const year = Number(m[3]);
  if (!day || !month || !year) return null;
  return {
    iso: `${String(year).padStart(4, "0")}-${String(month).padStart(
      2,
      "0"
    )}-${String(day).padStart(2, "0")}`,
    precision: "day",
  };
}

function parseMonthYear(text) {
  const cleaned = normalizeSpace(text).replace(/,/g, " ");
  const m = cleaned.match(/([A-Za-z]{3,9})\s+(20\d{2})/i);
  if (!m) return null;
  const month = MONTHS[String(m[1]).toLowerCase()];
  const year = Number(m[2]);
  if (!month || !year) return null;
  return {
    iso: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`,
    precision: "month",
  };
}

function toTimestamp(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function withinRecentMonths(iso, months, nowSec) {
  const ts = toTimestamp(iso);
  if (!Number.isFinite(ts)) return false;
  const spanDays = Math.max(1, months) * 31;
  const cutoff = nowSec - spanDays * 86400;
  return ts >= cutoff && ts <= nowSec + 86400;
}

function parse91Mobiles(markdown) {
  const rows = [];
  const lines = String(markdown || "").split(/\r?\n/);
  let active = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const modelHit = line.match(
      /^##\s+\[(.+?)\]\((https?:\/\/www\.91mobiles\.com\/[^)]+)\)/i
    );
    if (modelHit) {
      active = {
        source: "91mobiles",
        name: normalizeSpace(modelHit[1]),
        source_url: modelHit[2],
        launch_date_iso: null,
        launch_date_precision: null,
        launch_text: null,
      };
      continue;
    }
    const launchHit = line.match(/^New Release Date:\s*(.+)$/i);
    if (launchHit && active) {
      const parsed = parseDayMonthYear(launchHit[1]);
      if (parsed) {
        rows.push({
          ...active,
          launch_date_iso: parsed.iso,
          launch_date_precision: parsed.precision,
          launch_text: normalizeSpace(launchHit[1]),
        });
      }
      active = null;
    }
  }
  return rows;
}

function parseSmartprix(markdown) {
  const rows = [];
  const lines = String(markdown || "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    if (
      line.includes("Latest Mobile Phones Price List") ||
      line.includes("Mobile Phone") ||
      line.includes("---")
    ) {
      continue;
    }
    const m = line.match(/^\|\s*(.+?)\s*\|\s*([^|]+?)\s*\|\s*([A-Za-z]{3,9},?\s+20\d{2})\s*\|$/);
    if (!m) continue;
    const parsed = parseMonthYear(m[3]);
    if (!parsed) continue;
    rows.push({
      source: "smartprix",
      name: normalizeSpace(m[1]),
      source_url: SOURCES.smartprix,
      launch_date_iso: parsed.iso,
      launch_date_precision: parsed.precision,
      launch_text: normalizeSpace(m[3]),
      price_text: normalizeSpace(m[2]),
    });
  }
  return rows;
}

function parseGadgets360(markdown) {
  const rows = [];
  const lines = String(markdown || "").split(/\r?\n/);
  let active = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const modelHit = line.match(
      /\]\((https?:\/\/www\.gadgets360\.com\/[^ )]+)\s+"([^"]+)"\)\+ Compare/i
    );
    if (modelHit) {
      active = {
        source: "gadgets360",
        name: normalizeSpace(modelHit[2]),
        source_url: modelHit[1],
        launch_date_iso: null,
        launch_date_precision: null,
        launch_text: null,
      };
      continue;
    }
    const releaseHit = line.match(/^Release Date\s+(.+)$/i);
    if (releaseHit && active) {
      const parsed = parseDayMonthYear(releaseHit[1]);
      if (parsed) {
        rows.push({
          ...active,
          launch_date_iso: parsed.iso,
          launch_date_precision: parsed.precision,
          launch_text: normalizeSpace(releaseHit[1]),
        });
      }
      active = null;
    }
  }
  return rows;
}

function mergeRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = normalizeKey(row.name);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        model_key: key,
        model_name: row.name,
        first_launch_date_iso: row.launch_date_iso,
        source_count: 1,
        sources: [row.source],
        source_records: [row],
      });
      continue;
    }
    prev.source_records.push(row);
    if (!prev.sources.includes(row.source)) {
      prev.sources.push(row.source);
      prev.source_count += 1;
    }
    if (
      row.launch_date_iso &&
      (!prev.first_launch_date_iso || row.launch_date_iso < prev.first_launch_date_iso)
    ) {
      prev.first_launch_date_iso = row.launch_date_iso;
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    String(b.first_launch_date_iso || "").localeCompare(String(a.first_launch_date_iso || ""))
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const months = Number(args.months || DEFAULT_MONTH_WINDOW);
  const outFile = args.out
    ? path.resolve(String(args.out))
    : path.resolve(
        process.cwd(),
        "00_Inbox",
        `new-launch-pool-last-${months}-months.json`
      );

  const nowSec = Math.floor(Date.now() / 1000);
  const sourceTexts = {};
  const sourceErrors = [];
  for (const [source, url] of Object.entries(SOURCES)) {
    try {
      sourceTexts[source] = await fetchMarkdownFromSource(url);
    } catch (err) {
      sourceErrors.push(`${source}: ${String(err && err.message ? err.message : err)}`);
    }
  }

  const rawRows = []
    .concat(sourceTexts["91mobiles"] ? parse91Mobiles(sourceTexts["91mobiles"]) : [])
    .concat(sourceTexts.smartprix ? parseSmartprix(sourceTexts.smartprix) : [])
    .concat(sourceTexts.gadgets360 ? parseGadgets360(sourceTexts.gadgets360) : []);

  const inWindow = rawRows.filter((row) =>
    withinRecentMonths(row.launch_date_iso, months, nowSec)
  );
  const merged = mergeRows(inWindow);

  const report = {
    generated_at: new Date().toISOString(),
    window_months: months,
    window_cutoff_approx_days: months * 31,
    sources: SOURCES,
    source_errors: sourceErrors,
    stats: {
      raw_rows: rawRows.length,
      in_window_rows: inWindow.length,
      unique_models: merged.length,
      source_row_counts: {
        "91mobiles": inWindow.filter((x) => x.source === "91mobiles").length,
        smartprix: inWindow.filter((x) => x.source === "smartprix").length,
        gadgets360: inWindow.filter((x) => x.source === "gadgets360").length,
      },
    },
    models: merged,
  };

  const allowEmpty = args.allowEmpty === true || args.allowEmpty === "true";
  if (!allowEmpty && report.stats.in_window_rows === 0) {
    throw new Error(
      `No parsed rows from sources. errors=${sourceErrors.length}. Prevented empty overwrite for ${outFile}`
    );
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  console.log(`Saved: ${outFile}`);
  console.log(
    `rows=${report.stats.in_window_rows}, unique_models=${report.stats.unique_models}, errors=${sourceErrors.length}`
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
