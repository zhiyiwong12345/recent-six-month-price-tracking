const fs = require("fs");
const path = require("path");
const { fetchPriceBeforeHistoryByUrl } = require("./pricebefore_history");

const ROOT = path.resolve(__dirname, "..");
const INBOX = path.join(ROOT, "00_Inbox");
const DATE_TAG = "2026-05-23";
const REPORT_TAG = process.env.REPORT_TAG || DATE_TAG;

const WATCHLIST = [
  { query: "nothing phone 3a lite", file: "manual-amazon-nothing-phone-3a-lite-2026-05-24.json", tokens: ["nothing", "phone", "3a", "lite"] },
  { query: "nothing phone 4a", file: "manual-fk-nothing-phone-4a-2026-05-23.json", tokens: ["nothing", "phone", "4a"], exclude: ["pro"] },
  { query: "nothing phone 4a pro", file: "manual-fk-nothing-phone-4a-pro-2026-05-23.json", tokens: ["nothing", "phone", "4a", "pro"] },
  { query: "nothing phone3", file: "manual-fk-nothing-phone3-2026-05-24.json", tokens: ["nothing", "phone", "3"], exclude: ["3a"], allowUnavailable: true },
  { query: "vivo T5X", file: "manual-fk-vivo-t5x-2026-05-23.json", tokens: ["vivo", "t5x"] },
  { query: "vivo v70", file: "manual-fk-vivo-v70-2026-05-23.json", tokens: ["vivo", "v70"], exclude: ["fe", "elite"] },
  { query: "vivo v70 FE", file: "manual-fk-vivo-v70fe-2026-05-23.json", tokens: ["vivo", "v70", "fe"] },
  { query: "vivo v70 Elite", file: "manual-fk-vivo-v70-elite-2026-05-23.json", tokens: ["vivo", "v70", "elite"] },
  { query: "vivo v60", file: "manual-fk-vivo-v60-2026-05-23.json", tokens: ["vivo", "v60"], exclude: ["v60e"] },
  { query: "vivo v60e", file: "manual-fk-vivo-v60e-2026-05-23.json", tokens: ["vivo", "v60e"] },
  { query: "realme 16", file: "manual-fk-realme-16-2026-05-23.json", tokens: ["realme", "16"], exclude: ["pro", "plus"] },
  { query: "realme 16 Pro", file: "manual-fk-realme-16-pro-2026-05-23.json", tokens: ["realme", "16", "pro"], exclude: ["plus"] },
  { query: "realme 15", file: "manual-fk-realme-15-2026-05-23.json", tokens: ["realme", "15"], exclude: ["pro", "plus"] },
  { query: "realme 15 Pro", file: "manual-fk-realme-15-pro-2026-05-23.json", tokens: ["realme", "15", "pro"], exclude: ["plus"] },
  { query: "oneplus nord ce6", file: "manual-fk-oneplus-nord-ce6-2026-05-23.json", tokens: ["oneplus", "nord", "ce6"], exclude: ["lite"] },
  { query: "oneplus nord 6", file: "manual-fk-oneplus-nord-6-2026-05-23.json", tokens: ["oneplus", "nord", "6"], exclude: ["ce6"] },
  { query: "oppo reno 15c", file: "manual-fk-oppo-reno-15c-2026-05-23.json", tokens: ["oppo", "reno15c"] },
  { query: "oppo reno 15", file: "manual-fk-oppo-reno-15-2026-05-23.json", tokens: ["oppo", "reno15"], exclude: ["reno15c", "pro"] },
  { query: "OPPO Reno15 5G selected SKUs", file: "manual-fk-oppo-reno15-selected-skus-2026-05-24.json", tokens: ["oppo", "reno15"] },
  { query: "OPPO reno15 pro mini", file: "manual-fk-oppo-reno15-pro-mini-2026-05-24.json", tokens: ["oppo", "reno15", "pro", "mini"] },
  { query: "realme P4", file: "manual-fk-realme-p4-2026-05-23.json", tokens: ["realme", "p4"], exclude: ["pro", "power"] },
  { query: "motorola edge 60 fusion", file: "manual-fk-motorola-edge-60-fusion-2026-05-23.json", tokens: ["motorola", "edge", "60", "fusion"] },
  { query: "motorola edge 70 fusion", file: "manual-fk-motorola-edge-70-fusion-2026-05-23.json", tokens: ["motorola", "edge", "70", "fusion"] },
  { query: "samsung A57", file: "manual-fk-samsung-a57-2026-05-23.json", tokens: ["samsung", "a57"] },
  { query: "samsung A37", file: "manual-fk-samsung-a37-2026-05-23.json", tokens: ["samsung", "a37"] },
  { query: "samsung A56", file: "manual-fk-samsung-a56-2026-05-23.json", tokens: ["samsung", "a56"] },
  { query: "samsung A36", file: "manual-fk-samsung-a36-2026-05-23.json", tokens: ["samsung", "a36"] },
  { query: "oppo F33", file: "manual-fk-oppo-f33-2026-05-23.json", tokens: ["oppo", "f33"], exclude: ["pro"] },
  { query: "OPPO F33 pro", file: "manual-fk-oppo-f33-pro-2026-05-23.json", tokens: ["oppo", "f33", "pro"] },
];

const HISTORY_FILES = [
  "memory-cost-pass-through-2026-05-21-memory-cost-20k-50k.json",
  "memory-cost-pass-through-2026-05-20-memory-cost-20k-50k.json",
  "memory-cost-pass-through-verify-model-family-top10.json",
  "memory-cost-pass-through-verify-resolution-rebuild.json",
];
const LIVE_OBSERVATION_FILE = "manual-pricehistory-live-observations-2026-05-23.json";
const PRICEBEFORE_CACHE_FILE = `manual-pricebefore-history-cache-${DATE_TAG}.json`;
const PRICEBEFORE_FETCH_LIMIT = Number(process.env.PRICEBEFORE_FETCH_LIMIT || 999);
const RECENT_WINDOW_DAYS = 30;
const REPORT_NOW = Date.parse(`${DATE_TAG}T23:59:59.000Z`);
const RECENT_CUTOFF = REPORT_NOW - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const TIMELINE_START = Date.parse("2026-04-01T00:00:00.000Z");
const SIGNIFICANT_DELTA_INR = 500;
const MAX_TIMELINE_ROWS = 60;

const BRAND_META = {
  nothing: { label: "Nothing", order: 5 },
  vivo: { label: "vivo", order: 10 },
  realme: { label: "realme", order: 20 },
  oneplus: { label: "OnePlus", order: 30 },
  oppo: { label: "OPPO", order: 40 },
  motorola: { label: "Motorola", order: 50 },
  samsung: { label: "Samsung", order: 60 },
  other: { label: "Other", order: 999 },
};

const MARKET_CONTEXT = [
  {
    label: "Amazon Great Summer Sale",
    start: "2026-05-08",
    end: "2026-05-17",
    note: "Amazon India 5 月大促窗口，手机品类有折扣与银行优惠。",
    source_label: "Amazon India / Gadgets360",
    source_url: "https://www.aboutamazon.in/news/retail/amazon-great-summer-sale",
  },
  {
    label: "Flipkart Big Saving Days",
    start: "2026-05-08",
    end: "2026-05-15",
    note: "Flipkart 5 月大促窗口，多品牌在手机上配置限时价、银行优惠或换新优惠。",
    source_label: "Moneycontrol",
    source_url:
      "https://www.moneycontrol.com/technology/nothing-announces-discounts-on-phone-4a-phone-4a-pro-ear-and-cmf-buds-during-flipkart-big-saving-days-sale-article-13913348.html",
  },
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b5g\b/g, " ")
    .replace(/\bmobile\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasToken(text, token) {
  return new RegExp(`(^| )${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(text);
}

function candidateText(row) {
  return normalizeText(`${row.candidate_name || ""} ${row.raw_line || ""}`);
}

function hasMissingTitle(row) {
  return /\b(currently unavailable|coming soon)\b/i.test(String(row.candidate_name || ""));
}

function displayTitleFromRow(row) {
  const name = String(row.candidate_name || "").trim();
  if (!hasMissingTitle(row)) return name;
  const raw = String(row.raw_line || "").replace(/^Currently unavailable\s+/i, "").trim();
  const title =
    raw.match(/(?:Add to Compare\s+)?(.+?)\s+\d(?:\.\d)?[\d,]*\s+Ratings/i)?.[1] ||
    raw.match(/(?:Add to Compare\s+)?(.+?)\s+\d+\s*GB\s*RAM/i)?.[1] ||
    name;
  return title.trim();
}

function exactMatch(spec, row) {
  const name = String(row.candidate_name || "");
  const text = hasMissingTitle(row) ? candidateText(row) : normalizeText(name);
  if (!spec.tokens.every((token) => hasToken(text, token))) return false;
  if (spec.requirePlus && !/\b(plus|pro plus)\b/.test(text)) return false;
  if ((spec.exclude || []).some((token) => hasToken(text, token))) return false;
  if (!spec.allowUnavailable && name.toLowerCase().includes("currently unavailable")) return false;
  return true;
}

function extractSku(row) {
  const raw = `${row.raw_line || ""} ${row.candidate_name || ""}`;
  const ram = raw.match(/(\d+)\s*GB\s*RAM/i)?.[1];
  const rom = raw.match(/(\d+)\s*GB\s*ROM/i)?.[1] || raw.match(/,\s*(\d+)\s*GB\)/i)?.[1];
  if (ram && rom) return `${ram}GB+${rom}GB`;
  if (rom) return `RAM_UNKNOWN+${rom}GB`;
  return "SKU_UNKNOWN";
}

function extractPid(url) {
  const m = String(url || "").match(/[?&]pid=([^&]+)/i);
  return m ? m[1] : "";
}

function candidateOption(row) {
  return {
    title: displayTitleFromRow(row),
    product_url: row.product_url,
    store: row.store_name || "Flipkart",
    price: row.current_store_price_inr,
    availability: row.availability,
  };
}

function mergeCandidateOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    const key = `${option.product_url || ""}|${option.title || ""}|${option.price || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function familyKeyFromQuery(query) {
  return normalizeText(query).replace(/\b(5g|mobile)\b/g, "").replace(/\s+/g, "-");
}

function brandKeyFromQuery(query) {
  const first = normalizeText(query).split(" ")[0];
  return BRAND_META[first] ? first : "other";
}

function brandLabel(brandKey) {
  return BRAND_META[brandKey]?.label || brandKey;
}

function slug(value) {
  return normalizeText(value).replace(/\s+/g, "-") || "item";
}

function formatInr(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const num = Number(value);
  return `${num < 0 ? "-" : ""}₹${Math.abs(num).toLocaleString("en-IN")}`;
}

function formatDate(value) {
  if (!value) return "-";
  return String(value).slice(0, 10);
}

function formatShortDate(value) {
  const date = formatDate(value);
  if (date === "-") return date;
  return date.slice(5).replace("-", "/");
}

function formatSignedInr(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${formatInr(value)}`;
}

function formatPct(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(1)}%`;
}

function loadJson(file) {
  const full = path.join(INBOX, file);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function modelLabelFromTitle(title, fallback) {
  const clean = String(title || "")
    .replace(/\s*\(([^)]*)\)\s*/g, (_, value) => {
      const token = String(value || "").trim();
      return /^\d+[a-z]?$/i.test(token) && token.length <= 3 ? ` (${token}) ` : " ";
    })
    .replace(/\b\d+\s*GB\s*(RAM|ROM)?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || fallback || "-";
}

function loadHistoryRows() {
  const rows = [];
  for (const file of HISTORY_FILES) {
    const payload = loadJson(file);
    for (const product of payload?.products || []) {
      if (!product.raw_price_points?.length && !product.price_change_events?.length) continue;
      rows.push({ ...product, history_file: file });
    }
  }
  return rows;
}

function loadLiveObservations() {
  const payload = loadJson(LIVE_OBSERVATION_FILE);
  const rows = payload?.observations || [];
  const byPid = new Map();
  for (const row of rows) {
    if (row.store_product_code) byPid.set(String(row.store_product_code), row);
  }
  return byPid;
}

function cacheKeysForRow(row) {
  return [extractPid(row.product_url), row.product_url].filter(Boolean).map(String);
}

function loadPriceBeforeCache() {
  const payload = loadJson(PRICEBEFORE_CACHE_FILE);
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const byKey = new Map();
  for (const entry of entries) {
    if (!entry?.product) continue;
    for (const key of entry.keys || []) {
      if (key) byKey.set(String(key), entry.product);
    }
  }
  return { entries, byKey, dirty: false };
}

function savePriceBeforeCache(cache) {
  const full = path.join(INBOX, PRICEBEFORE_CACHE_FILE);
  if (!cache.dirty && fs.existsSync(full)) return;
  const byFirstKey = new Map();
  for (const entry of cache.entries || []) {
    const first = entry?.keys?.[0];
    if (first && !byFirstKey.has(first)) byFirstKey.set(first, entry);
  }
  fs.writeFileSync(
    full,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        source: "pricebefore",
        entries: [...byFirstKey.values()],
      },
      null,
      2
    ),
    "utf8"
  );
}

async function resolvePriceBefore(row, cache, stats) {
  const keys = cacheKeysForRow(row);
  for (const key of keys) {
    const hit = cache.byKey.get(key);
    if (hit) {
      stats.cache_hits += 1;
      return hit;
    }
  }
  if (stats.fetch_attempts >= PRICEBEFORE_FETCH_LIMIT) {
    stats.skipped_by_budget += 1;
    return null;
  }
  stats.fetch_attempts += 1;
  const result = await fetchPriceBeforeHistoryByUrl(row, { timeoutMs: 15000 });
  if (!result.ok || !result.product) {
    stats.failures += 1;
    stats.errors.push({
      title: row.candidate_name,
      product_url: row.product_url,
      error: result.error || "pricebefore_resolve_failed",
    });
    return null;
  }
  stats.fetched += 1;
  const product = result.product;
  const entry = {
    keys,
    product,
    fetched_at: new Date().toISOString(),
  };
  cache.entries.push(entry);
  cache.dirty = true;
  for (const key of keys) {
    cache.byKey.set(key, product);
  }
  return product;
}

function matchHistory(row, sku, spec, historyRows) {
  const pid = extractPid(row.product_url);
  let best = null;
  let bestScore = -1;
  for (const hist of historyRows) {
    const histText = normalizeText(`${hist.candidate_name || ""} ${hist.family_name || ""}`);
    const histSku = hist.variant_label || extractSku(hist);
    const pidMatch = pid && String(hist.product_url || "").includes(pid);
    const modelMatch =
      spec.tokens.every((token) => hasToken(histText, token)) &&
      !(spec.exclude || []).some((token) => hasToken(histText, token)) &&
      (!spec.requirePlus || /\b(plus|pro plus)\b/.test(histText));
    const skuMatch = histSku === sku;
    if (!pidMatch && !(modelMatch && skuMatch)) continue;
    let score = pidMatch ? 100 : 0;
    if (histSku === sku) score += 20;
    if (modelMatch) score += 20;
    if (score > bestScore) {
      best = hist;
      bestScore = score;
    }
  }
  return bestScore >= 20 ? best : null;
}

function dedupeVariants(rows) {
  const bySku = new Map();
  for (const row of rows) {
    const sku = extractSku(row);
    const prepared = { ...row, same_sku_candidates: [candidateOption(row)] };
    const prev = bySku.get(sku);
    if (!prev) {
      bySku.set(sku, prepared);
      continue;
    }
    const sameSkuCandidates = mergeCandidateOptions([...(prev.same_sku_candidates || [candidateOption(prev)]), candidateOption(row)]);
    const prevListed = prev.availability === "listed" ? 1 : 0;
    const rowListed = row.availability === "listed" ? 1 : 0;
    const prevRank = Number(prev.listing_rank || 999);
    const rowRank = Number(row.listing_rank || 999);
    if (rowListed > prevListed || (rowListed === prevListed && rowRank < prevRank)) {
      bySku.set(sku, { ...prepared, same_sku_candidates: sameSkuCandidates });
    } else {
      prev.same_sku_candidates = sameSkuCandidates;
    }
  }
  return [...bySku.values()].sort((a, b) => extractSku(a).localeCompare(extractSku(b)));
}

function chartSvg(points, width = 720, height = 210) {
  const parsed = points
    .map((p) => ({ t: Date.parse(p.timestamp_iso), y: Number(p.price_inr) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.y));
  if (!parsed.length) return "";
  const minT = Math.min(...parsed.map((p) => p.t));
  const maxT = Math.max(...parsed.map((p) => p.t));
  const minY = Math.min(...parsed.map((p) => p.y));
  const maxY = Math.max(...parsed.map((p) => p.y));
  const pad = 34;
  const x = (t) => pad + ((t - minT) / Math.max(1, maxT - minT)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - minY) / Math.max(1, maxY - minY)) * (height - pad * 2);
  const stepPoints = parsed.filter((point, idx, arr) => idx === 0 || idx === arr.length - 1 || point.y !== arr[idx - 1].y);
  const d =
    stepPoints.length === 1
      ? `M ${pad} ${y(stepPoints[0].y).toFixed(1)} L ${width - pad} ${y(stepPoints[0].y).toFixed(1)}`
      : stepPoints
          .map((p, i, arr) => {
            const px = x(p.t).toFixed(1);
            const py = y(p.y).toFixed(1);
            if (i === 0) return `M ${px} ${py}`;
            return `H ${px} V ${py}`;
          })
          .join(" ");
  const marketRanges = MARKET_CONTEXT.map((event) => ({
    start: Math.max(minT, Date.parse(`${event.start}T00:00:00.000Z`)),
    end: Math.min(maxT, Date.parse(`${event.end}T23:59:59.000Z`) + 7 * 24 * 60 * 60 * 1000),
  }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > minT && range.start < maxT)
    .sort((a, b) => a.start - b.start);
  const mergedMarketRanges = marketRanges.reduce((merged, range) => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
    return merged;
  }, []);
  const marketWindows = mergedMarketRanges
    .map((range) => {
      const left = x(range.start);
      const right = x(range.end);
      return `<rect class="chart-event-window" x="${left.toFixed(1)}" y="${pad}" width="${Math.max(2, right - left).toFixed(
        1
      )}" height="${height - pad * 2}" />`;
    })
    .join("");
  const dot =
    stepPoints.length === 1
      ? `<circle cx="${width / 2}" cy="${y(stepPoints[0].y).toFixed(1)}" r="5" />`
      : stepPoints
          .map((point, idx, arr) => {
            const previous = idx > 0 ? arr[idx - 1] : null;
            const direction = previous ? classifyDelta(point.y - previous.y) : "flat";
            return `<circle class="chart-point ${direction}" cx="${x(point.t).toFixed(1)}" cy="${y(point.y).toFixed(1)}" r="3" />`;
          })
          .join("");
  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img">
    ${marketWindows}
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" />
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" />
    <text x="${pad}" y="22">${formatInr(maxY)}</text>
    <text x="${pad}" y="${height - 8}">${formatInr(minY)}</text>
    <text x="${pad}" y="${height - 42}">${formatDate(new Date(minT).toISOString())}</text>
    <text x="${width - 120}" y="${height - 42}">${formatDate(new Date(maxT).toISOString())}</text>
    <path d="${d}" />
    ${dot}
  </svg>`;
}

function parsePricePoints(points) {
  return (points || [])
    .map((p) => ({ t: Date.parse(p.timestamp_iso), price: Number(p.price_inr), timestamp_iso: p.timestamp_iso }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.price))
    .sort((a, b) => a.t - b.t);
}

function pointAtOrBefore(points, cutoff) {
  let selected = points[0] || null;
  for (const point of points) {
    if (point.t <= cutoff) selected = point;
    else break;
  }
  return selected;
}

function priceEventsWithDelta(events) {
  return (events || [])
    .map((event, idx, arr) => {
      const prev = idx > 0 ? Number(arr[idx - 1].price_inr) : null;
      const price = Number(event.price_inr);
      return {
        ...event,
        price_inr: price,
        delta_inr: prev == null || !Number.isFinite(price) ? null : price - prev,
      };
    })
    .filter((event) => event.timestamp_iso && Number.isFinite(event.price_inr));
}

function classifyDelta(delta) {
  if (delta == null || Number.isNaN(Number(delta))) return "flat";
  if (Number(delta) >= SIGNIFICANT_DELTA_INR) return "up";
  if (Number(delta) <= -SIGNIFICANT_DELTA_INR) return "down";
  return "flat";
}

function directionLabel(direction) {
  if (direction === "up") return "上调";
  if (direction === "down") return "下调";
  return "基本稳定";
}

function isNearMarketEvent(timestampIso) {
  const t = Date.parse(timestampIso);
  if (!Number.isFinite(t)) return false;
  return MARKET_CONTEXT.some((event) => {
    const start = Date.parse(`${event.start}T00:00:00.000Z`) - 24 * 60 * 60 * 1000;
    const end = Date.parse(`${event.end}T23:59:59.000Z`) + 7 * 24 * 60 * 60 * 1000;
    return t >= start && t <= end;
  });
}

function analyzeVariant(variant) {
  const points = parsePricePoints(variant.raw_price_points);
  const events = priceEventsWithDelta(variant.price_change_events);
  const first = points[0] || events[0] || null;
  const latest = points[points.length - 1] || events[events.length - 1] || null;
  const baseline = points.length ? pointAtOrBefore(points, RECENT_CUTOFF) : first;
  const recentDelta =
    latest && baseline && latest.price != null && baseline.price != null ? latest.price - baseline.price : null;
  const launchDelta = latest && first && latest.price != null && first.price != null ? latest.price - first.price : null;
  const recentPct = baseline?.price ? (recentDelta / baseline.price) * 100 : null;
  const launchPct = first?.price ? (launchDelta / first.price) * 100 : null;
  const recentEvents = events.filter((event) => Date.parse(event.timestamp_iso) >= RECENT_CUTOFF && event.delta_inr !== 0);
  const maxAbsStep = events.reduce((max, event) => Math.max(max, Math.abs(Number(event.delta_inr) || 0)), 0);
  return {
    points_count: points.length,
    price_change_count: Math.max(0, events.length - 1),
    first_price_at: first?.timestamp_iso || "",
    latest_price_at: latest?.timestamp_iso || "",
    latest_history_price_inr: latest?.price ?? null,
    recent_baseline_price_inr: baseline?.price ?? null,
    recent_delta_inr: recentDelta,
    recent_delta_pct: recentPct,
    launch_delta_inr: launchDelta,
    launch_delta_pct: launchPct,
    recent_direction: classifyDelta(recentDelta),
    recent_events_count: recentEvents.length,
    last_event: events.length > 1 ? events[events.length - 1] : null,
    max_abs_step_inr: maxAbsStep,
    near_market_event: events.some((event) => event.delta_inr && isNearMarketEvent(event.timestamp_iso)),
  };
}

function representativeScore(variant) {
  const a = variant.analysis || analyzeVariant(variant);
  return [
    a.price_change_count,
    Math.abs(Number(a.recent_delta_inr) || 0) / 100,
    Math.abs(Number(a.launch_delta_inr) || 0) / 100,
    Number(variant.rating_count || 0) / 100000,
  ].reduce((sum, score) => sum + score, 0);
}

function chooseRepresentativeVariant(variants) {
  return [...variants].sort((a, b) => representativeScore(b) - representativeScore(a))[0] || null;
}

function modelAttentionScore(model) {
  const rep = model.representative_variant;
  if (!rep) return -1;
  const a = rep.analysis || analyzeVariant(rep);
  return (
    Math.abs(Number(a.recent_delta_inr) || 0) / 100 +
    Math.abs(Number(a.last_event?.delta_inr) || 0) / 100 +
    a.recent_events_count * 4 +
    a.price_change_count / 10
  );
}

function summarizeModel(item) {
  const variants = item.variants.map((variant) => ({
    ...variant,
    analysis: analyzeVariant(variant),
  }));
  const representative = chooseRepresentativeVariant(variants);
  const others = representative ? variants.filter((variant) => variant.sku !== representative.sku) : variants;
  return {
    ...item,
    id: `model-${slug(item.query)}`,
    brand_key: brandKeyFromQuery(item.query),
    brand_label: brandLabel(brandKeyFromQuery(item.query)),
    variants,
    representative_variant: representative,
    hidden_variants: others,
  };
}

function modelMergeKey(model) {
  const label = model.representative_variant ? modelLabelFromTitle(model.representative_variant.title, model.query) : model.query;
  return `${model.brand_key}:${normalizeText(label)}`;
}

function variantMergeKey(variant) {
  return `${variant.store_key || variant.store || "store"}:${variant.product_url || variant.title}:${variant.sku}`;
}

function refreshModelRepresentative(model) {
  const representative = chooseRepresentativeVariant(model.variants);
  return {
    ...model,
    status: representative ? "store_exact_match" : model.status,
    variant_count: model.variants.length,
    representative_variant: representative,
    hidden_variants: representative ? model.variants.filter((variant) => variant.sku !== representative.sku) : model.variants,
  };
}

function mergeDuplicateModelSummaries(models) {
  const byModel = new Map();
  for (const model of models) {
    const key = modelMergeKey(model);
    const existing = byModel.get(key);
    if (!existing) {
      byModel.set(key, {
        ...model,
        variants: [...model.variants],
        hidden_variants: [...model.hidden_variants],
        top_unmatched_candidates: [...(model.top_unmatched_candidates || [])],
      });
      continue;
    }
    const variants = new Map(existing.variants.map((variant) => [variantMergeKey(variant), variant]));
    for (const variant of model.variants) variants.set(variantMergeKey(variant), variant);
    existing.variants = [...variants.values()];
    if (/selected skus/i.test(existing.query) && !/selected skus/i.test(model.query)) {
      existing.query = model.query;
      existing.id = `model-${slug(model.query)}`;
      existing.family_key = model.family_key;
    }
    existing.top_unmatched_candidates = [
      ...(existing.top_unmatched_candidates || []),
      ...(model.top_unmatched_candidates || []),
    ].slice(0, 5);
    byModel.set(key, refreshModelRepresentative(existing));
  }
  return [...byModel.values()].map(refreshModelRepresentative);
}

function summarizeBrand(brandKey, models) {
  const reps = models.map((model) => model.representative_variant).filter(Boolean);
  const counts = { up: 0, down: 0, flat: 0 };
  for (const rep of reps) counts[rep.analysis.recent_direction] += 1;
  const netRecentDelta = reps.reduce((sum, rep) => sum + (Number(rep.analysis.recent_delta_inr) || 0), 0);
  const allEvents = reps
    .map((rep) => ({ model: rep.title, sku: rep.sku, ...rep.analysis.last_event }))
    .filter((event) => event.timestamp_iso && event.delta_inr !== 0)
    .sort((a, b) => Date.parse(b.timestamp_iso) - Date.parse(a.timestamp_iso));
  const biggestIncrease = allEvents.filter((event) => event.delta_inr > 0).sort((a, b) => b.delta_inr - a.delta_inr)[0] || null;
  const biggestDecrease = allEvents.filter((event) => event.delta_inr < 0).sort((a, b) => a.delta_inr - b.delta_inr)[0] || null;
  const marketEventTouches = reps.filter((rep) => rep.analysis.near_market_event).length;
  const unresolvedModels = models.filter((model) => !model.representative_variant).length;
  const attentionScore =
    counts.up * 2 +
    counts.down * 2 +
    Math.min(5, Math.abs(netRecentDelta) / 3000) +
    (biggestIncrease ? Math.min(3, Math.abs(biggestIncrease.delta_inr) / 3000) : 0) +
    (biggestDecrease ? Math.min(3, Math.abs(biggestDecrease.delta_inr) / 3000) : 0) +
    unresolvedModels * 0.4;
  let headline = "价格动作分化";
  if (counts.up > counts.down && netRecentDelta > 0) headline = "近30天以提价为主";
  else if (counts.down > counts.up && netRecentDelta < 0) headline = "近30天以降价为主";
  else if (counts.flat >= counts.up + counts.down) headline = "近30天整体较稳";
  if (headline === "近30天以提价为主" && allEvents[0]?.delta_inr <= -500) headline = "近30天净提价，最近有回落";
  if (headline === "近30天以降价为主" && allEvents[0]?.delta_inr >= 500) headline = "近30天净降价，最近有回收";

  let inference = "目前更像是单机型/单 SKU 动作，品牌层面的策略信号还不够集中。";
  if (headline === "价格动作分化") {
    inference = "同一品牌内不同机型方向不一致，更像是在按价位段/生命周期分别处理：部分 SKU 做价格回收，部分 SKU 继续用活动价或跟价维持竞争力。";
  } else if (counts.up > counts.down && marketEventTouches) {
    inference = "调价集中在 5 月大促窗口及结束后一周附近，可能是促销后价格回收，同时叠加内存成本上行带来的价格梯度重置。";
  } else if (counts.up > counts.down) {
    inference = "多个代表 SKU 上调，可能是在做成本传导或重新抬高价格锚点。";
  } else if (counts.down > counts.up && marketEventTouches) {
    inference = "降价动作靠近 5 月大促窗口，可能是平台活动、银行优惠或竞品跟价带来的短期成交价下探。";
  } else if (counts.down > counts.up) {
    inference = "多个代表 SKU 下调，可能是在做促销拉动、库存消化或价位段防守。";
  }
  const strategyTags = [];
  if (counts.up > counts.down && netRecentDelta > 0) strategyTags.push("价格回收/成本传导");
  if (counts.down > counts.up && netRecentDelta < 0) strategyTags.push("促销/库存防守");
  if (headline.includes("分化")) strategyTags.push("按机型分层处理");
  if (marketEventTouches) strategyTags.push("靠近5月电商大促");
  if (unresolvedModels) strategyTags.push(`${unresolvedModels}个机型待补链接`);
  if (!strategyTags.length) strategyTags.push("继续观察");

  return {
    brand_key: brandKey,
    brand_label: brandLabel(brandKey),
    model_count: models.length,
    variant_count: models.reduce((sum, model) => sum + model.variant_count, 0),
    representative_count: reps.length,
    up_models: counts.up,
    down_models: counts.down,
    flat_models: counts.flat,
    net_recent_delta_inr: netRecentDelta,
    latest_event: allEvents[0] || null,
    biggest_increase: biggestIncrease,
    biggest_decrease: biggestDecrease,
    market_event_touches: marketEventTouches,
    unresolved_models: unresolvedModels,
    attention_score: attentionScore,
    attention_level: attentionScore >= 8 ? "高" : attentionScore >= 4 ? "中" : "低",
    strategy_tags: strategyTags,
    headline,
    inference,
  };
}

function eventModelLabel(event) {
  return modelLabelFromTitle(event.model_title || event.model, event.model_query || event.model);
}

function summarizeExecutive(brandGroups, items, timeline) {
  const matchedModels = items.filter((item) => item.variant_count > 0).length;
  const unmatchedModels = items.length - matchedModels;
  const upBrands = brandGroups.filter((brand) => brand.up_models > brand.down_models && brand.net_recent_delta_inr > 0);
  const downBrands = brandGroups.filter((brand) => brand.down_models > brand.up_models && brand.net_recent_delta_inr < 0);
  const splitBrands = brandGroups.filter((brand) => brand.headline.includes("分化"));
  const significantEvents = timeline.filter((event) => Math.abs(Number(event.delta_inr) || 0) >= SIGNIFICANT_DELTA_INR);
  const biggestIncrease = [...significantEvents].filter((event) => event.delta_inr > 0).sort((a, b) => b.delta_inr - a.delta_inr)[0] || null;
  const biggestDecrease = [...significantEvents].filter((event) => event.delta_inr < 0).sort((a, b) => a.delta_inr - b.delta_inr)[0] || null;
  const latest = significantEvents[0] || null;
  const priorityBrands = [...brandGroups].sort((a, b) => b.attention_score - a.attention_score).slice(0, 3);
  const coveragePct = items.length ? (matchedModels / items.length) * 100 : 0;
  const movementText = [
    upBrands.length ? `${upBrands.map((brand) => brand.brand_label).join("、")} 偏上调` : "",
    downBrands.length ? `${downBrands.map((brand) => brand.brand_label).join("、")} 偏下调` : "",
    splitBrands.length ? `${splitBrands.map((brand) => brand.brand_label).join("、")} 分化` : "",
  ]
    .filter(Boolean)
    .join("；");
  const headline = movementText
    ? `本轮不是单一方向：${movementText}。`
    : "本轮多数代表 SKU 近30天变化不大，暂时更像价格观测期。";
  const takeaways = [
    biggestIncrease
      ? `最大上调：${eventModelLabel(biggestIncrease)} ${biggestIncrease.sku}，${formatShortDate(biggestIncrease.timestamp_iso)} ${formatSignedInr(biggestIncrease.delta_inr)}。`
      : "暂未看到超过阈值的代表 SKU 上调。",
    biggestDecrease
      ? `最大下调：${eventModelLabel(biggestDecrease)} ${biggestDecrease.sku}，${formatShortDate(biggestDecrease.timestamp_iso)} ${formatSignedInr(biggestDecrease.delta_inr)}。`
      : "暂未看到超过阈值的代表 SKU 下调。",
    `数据覆盖：${matchedModels}/${items.length} 个清单机型有严格商城链接命中，${coveragePct.toFixed(0)}%；${unmatchedModels ? `${unmatchedModels} 个还需要补链接/改关键词。` : "暂无待补机型。"}`,
  ];
  return {
    headline,
    coverage_pct: coveragePct,
    matched_models: matchedModels,
    unmatched_models: unmatchedModels,
    significant_event_count: significantEvents.length,
    biggest_increase: biggestIncrease,
    biggest_decrease: biggestDecrease,
    latest_significant_event: latest,
    priority_brands: priorityBrands.map((brand) => ({
      brand_key: brand.brand_key,
      brand_label: brand.brand_label,
      headline: brand.headline,
      attention_level: brand.attention_level,
      net_recent_delta_inr: brand.net_recent_delta_inr,
      tags: brand.strategy_tags,
    })),
    takeaways,
  };
}

function buildAnalysis(items) {
  const modelSummaries = mergeDuplicateModelSummaries(items.map(summarizeModel));
  const byBrand = new Map();
  for (const model of modelSummaries) {
    if (!byBrand.has(model.brand_key)) byBrand.set(model.brand_key, []);
    byBrand.get(model.brand_key).push(model);
  }
  const brand_groups = [...byBrand.entries()]
    .map(([brandKey, models]) => ({
      ...summarizeBrand(brandKey, models),
      models: models.sort((a, b) => {
        return modelAttentionScore(b) - modelAttentionScore(a) || a.query.localeCompare(b.query);
      }),
    }))
    .sort((a, b) => (BRAND_META[a.brand_key]?.order || 999) - (BRAND_META[b.brand_key]?.order || 999));
  const timeline = brand_groups
    .flatMap((brand) =>
      brand.models.flatMap((model) => {
        const rep = model.representative_variant;
        return priceEventsWithDelta(rep?.price_change_events)
          .filter((event) => event.delta_inr && Date.parse(event.timestamp_iso) >= TIMELINE_START)
          .map((event) => ({
            brand_key: brand.brand_key,
            brand_label: brand.brand_label,
            model_title: rep.title,
            model_query: model.query,
            model_id: model.id,
            sku: rep.sku,
            timestamp_iso: event.timestamp_iso,
            price_inr: event.price_inr,
            delta_inr: event.delta_inr,
          }));
      })
    )
    .sort((a, b) => Date.parse(b.timestamp_iso) - Date.parse(a.timestamp_iso));
  return {
    recent_window_days: RECENT_WINDOW_DAYS,
    market_context: MARKET_CONTEXT,
    brand_groups,
    executive: summarizeExecutive(brand_groups, items, timeline),
    timeline,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderEventTable(variant) {
  const events = priceEventsWithDelta(variant.price_change_events);
  if (!events.length) return `<p class="warn">暂无可用历史点：只能先记录商城链接和当前价。</p>`;
  const rows = events
    .map(
      (event, idx) =>
        `<tr><td>${idx + 1}</td><td>${formatDate(event.timestamp_iso)}</td><td>${formatInr(event.price_inr)}</td><td>${
          event.delta_inr == null ? "-" : formatSignedInr(event.delta_inr)
        }</td></tr>`
    )
    .join("");
  const recentRows = events
    .slice(-5)
    .map(
      (event) =>
        `<tr><td>${formatDate(event.timestamp_iso)}</td><td>${formatInr(event.price_inr)}</td><td>${
          event.delta_inr == null ? "-" : formatSignedInr(event.delta_inr)
        }</td></tr>`
    )
    .join("");
  return `${recentRows ? `<table><thead><tr><th>近期节点</th><th>价格</th><th>变化</th></tr></thead><tbody>${recentRows}</tbody></table>` : ""}
    <details class="fold"><summary>查看完整调价点（${events.length}）</summary>
      <table><thead><tr><th>#</th><th>时间</th><th>价格</th><th>变化</th></tr></thead><tbody>${rows}</tbody></table>
    </details>`;
}

function renderTagList(tags) {
  return (tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
}

function renderExecutivePanel(executive) {
  const biggestIncrease = executive.biggest_increase
    ? `${eventModelLabel(executive.biggest_increase)} ${executive.biggest_increase.sku} ${formatSignedInr(executive.biggest_increase.delta_inr)}`
    : "暂无";
  const biggestDecrease = executive.biggest_decrease
    ? `${eventModelLabel(executive.biggest_decrease)} ${executive.biggest_decrease.sku} ${formatSignedInr(executive.biggest_decrease.delta_inr)}`
    : "暂无";
  const priorityBrands = executive.priority_brands
    .map(
      (brand) => `<a class="priority-brand" href="#brand-${escapeHtml(brand.brand_key)}">
        <span>${escapeHtml(brand.brand_label)} · ${escapeHtml(brand.attention_level)}关注</span>
        <b>${escapeHtml(brand.headline)}</b>
        <small>近30天净变化 ${formatSignedInr(brand.net_recent_delta_inr)}</small>
        <p>${renderTagList(brand.tags)}</p>
      </a>`
    )
    .join("");
  return `<section class="exec-panel">
    <div class="exec-copy">
      <span class="eyebrow">PM 读数</span>
      <h2>${escapeHtml(executive.headline)}</h2>
      <ol>${executive.takeaways.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>
    </div>
    <div class="exec-metrics">
      <div><span>最大上调</span><b>${escapeHtml(biggestIncrease)}</b></div>
      <div><span>最大下调</span><b>${escapeHtml(biggestDecrease)}</b></div>
      <div><span>显著调价点</span><b>${executive.significant_event_count}</b></div>
    </div>
    <div class="priority-list">${priorityBrands}</div>
  </section>`;
}

function renderActionMatrix(analysis) {
  const brands = analysis.brand_groups.map((brand) => ({
    key: brand.brand_key,
    label: brand.brand_label,
  }));
  const storeOptions = new Map();
  const rawRows = analysis.brand_groups.flatMap((brand) =>
    brand.models.map((model) => {
      const rep = model.representative_variant;
      if (!rep) {
        return {
          brand_key: brand.brand_key,
          brand_label: brand.brand_label,
          model_id: model.id,
          model_label: model.query,
          sku: "-",
          store_key: "unresolved",
          store_label: "待补",
          current_price: null,
          recent_delta: null,
          launch_delta: null,
          last_move: "待补链接",
          direction: "unresolved",
          significant: false,
          read: "未严格命中商城链接，暂不进入价格动作判断。",
        };
      }
      const analysis = rep.analysis || analyzeVariant(rep);
      const lastEvent = analysis.last_event;
      const storeKey = normalizeText(rep.store_key || rep.store || "flipkart").replace(/\s+/g, "-") || "unknown";
      const storeLabel = rep.store || "Flipkart";
      storeOptions.set(storeKey, storeLabel);
      const significant =
        Math.abs(Number(analysis.recent_delta_inr) || 0) >= SIGNIFICANT_DELTA_INR ||
        Math.abs(Number(lastEvent?.delta_inr) || 0) >= SIGNIFICANT_DELTA_INR;
      const marketNear = lastEvent?.timestamp_iso && isNearMarketEvent(lastEvent.timestamp_iso);
      return {
        brand_key: brand.brand_key,
        brand_label: brand.brand_label,
        model_id: model.id,
        model_label: modelLabelFromTitle(rep.title, model.query),
        sku: rep.sku,
        store_key: storeKey,
        store_label: storeLabel,
        current_price: rep.current_store_price_inr,
        recent_delta: analysis.recent_delta_inr,
        launch_delta: analysis.launch_delta_inr,
        last_move: lastEvent
          ? `${formatShortDate(lastEvent.timestamp_iso)} ${formatSignedInr(lastEvent.delta_inr)}${marketNear ? " · 大促附近" : ""}`
          : "暂无调价点",
        direction: analysis.recent_direction,
        significant,
        read: `${brand.headline}${marketNear ? "；最近动作靠近大促窗口" : ""}`,
      };
    })
  );
  const rows = [
    ...rawRows
      .reduce((deduped, row) => {
        const key = `${row.brand_key}:${normalizeText(row.model_label || row.model_id)}`;
        const existing = deduped.get(key);
        const score = (candidate) =>
          (candidate.direction === "unresolved" ? -1_000_000 : 0) +
          Math.abs(Number(candidate.recent_delta) || 0) +
          Math.abs(Number(candidate.launch_delta) || 0) / 10;
        if (!existing || score(row) > score(existing)) deduped.set(key, row);
        return deduped;
      }, new Map())
      .values(),
  ];
  const brandOptions = brands
    .map((brand) => `<option value="${escapeHtml(brand.key)}">${escapeHtml(brand.label)}</option>`)
    .join("");
  const storeOptionHtml = [...storeOptions.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`)
    .join("");
  const rowHtml = rows
    .map(
      (row) => `<tr data-matrix-row data-brand="${escapeHtml(row.brand_key)}" data-direction="${escapeHtml(
        row.direction
      )}" data-store="${escapeHtml(row.store_key)}" data-significant="${row.significant ? "true" : "false"}" data-unresolved="${
        row.direction === "unresolved" ? "true" : "false"
      }">
        <td><strong>${escapeHtml(row.brand_label)}</strong></td>
        <td><a href="#${escapeHtml(row.model_id)}">${escapeHtml(row.model_label)}</a></td>
        <td>${escapeHtml(row.sku)}</td>
        <td>${escapeHtml(row.store_label)}</td>
        <td class="num">${formatInr(row.current_price)}</td>
        <td class="num delta ${escapeHtml(row.direction)}">${formatSignedInr(row.recent_delta)}</td>
        <td class="num delta ${escapeHtml(classifyDelta(row.launch_delta))}">${formatSignedInr(row.launch_delta)}</td>
        <td>${escapeHtml(row.last_move)}</td>
        <td><span class="matrix-read ${escapeHtml(row.direction)}">${escapeHtml(row.read)}</span></td>
      </tr>`
    )
    .join("");
  return `<section class="matrix-panel" id="price-action-matrix">
    <div class="matrix-head">
      <div>
        <span class="eyebrow">价格动作矩阵</span>
        <h2>按机型看当前最值得盯的价格动作</h2>
      </div>
      <strong class="matrix-count" data-matrix-count>${rows.length}/${rows.length}</strong>
    </div>
    <div class="matrix-controls" aria-label="价格动作筛选">
      <div class="segmented" data-direction-group>
        <button type="button" class="active" data-filter-direction="all">全部</button>
        <button type="button" data-filter-direction="up">上调</button>
        <button type="button" data-filter-direction="down">下调</button>
        <button type="button" data-filter-direction="flat">稳定</button>
        <button type="button" data-filter-direction="unresolved">待补</button>
      </div>
      <label>品牌<select data-filter-brand><option value="all">全部品牌</option>${brandOptions}</select></label>
      <label>商城<select data-filter-store><option value="all">全部商城</option>${storeOptionHtml}</select></label>
      <label class="toggle"><input type="checkbox" data-filter-significant />只看显著动作</label>
    </div>
    <div class="matrix-scroll">
      <table class="matrix-table">
        <thead>
          <tr>
            <th>品牌</th>
            <th>机型</th>
            <th>SKU</th>
            <th>商城</th>
            <th>当前价</th>
            <th>近30天</th>
            <th>首见以来</th>
            <th>最近动作</th>
            <th>判断</th>
          </tr>
        </thead>
        <tbody>${rowHtml}</tbody>
      </table>
    </div>
  </section>`;
}

function renderTimeline(timeline) {
  const significant = timeline.filter((event) => Math.abs(Number(event.delta_inr) || 0) >= SIGNIFICANT_DELTA_INR);
  const rows = significant.slice(0, MAX_TIMELINE_ROWS);
  if (!rows.length) return '<p class="warn">暂无超过阈值的调价节点。</p>';
  let lastMonth = "";
  return rows
    .map((event) => {
      const month = formatDate(event.timestamp_iso).slice(0, 7);
      const monthHead = month !== lastMonth ? `<h3>${escapeHtml(month)}</h3>` : "";
      lastMonth = month;
      const direction = classifyDelta(event.delta_inr);
      const market = isNearMarketEvent(event.timestamp_iso) ? '<em>大促附近</em>' : "";
      return `${monthHead}<a class="timeline-row ${direction}" href="#${escapeHtml(event.model_id)}">
        <span>${formatShortDate(event.timestamp_iso)}</span>
        <strong>${escapeHtml(event.brand_label)} · ${escapeHtml(eventModelLabel(event))}<small>${escapeHtml(event.sku)}</small></strong>
        <b>${formatSignedInr(event.delta_inr)}${market}</b>
      </a>`;
    })
    .join("");
}

function renderVariant(variant, options = {}) {
  const analysis = variant.analysis || analyzeVariant(variant);
  const direction = analysis.recent_direction;
  const historyLink = variant.history_page_url
    ? `<a href="${escapeHtml(variant.history_page_url)}">历史页</a>`
    : "历史页缺失";
  const sameSkuLinks = variant.same_sku_candidates || [];
  const sameSkuMeta =
    sameSkuLinks.length > 1
      ? `<details class="submeta sku-links"><summary>同 SKU 颜色/链接（${sameSkuLinks.length}）</summary><div>${sameSkuLinks
          .map((candidate) => `<a href="${escapeHtml(candidate.product_url)}">${escapeHtml(candidate.title)}</a>`)
          .join(" / ")}</div></details>`
      : "";
  return `<section class="variant${options.secondary ? " secondary" : ""}">
    <div class="variant-head">
      <div><strong>${escapeHtml(variant.sku)}</strong> <span>${escapeHtml(variant.title)}</span></div>
      <div><a href="${escapeHtml(variant.product_url)}">${escapeHtml(variant.store || "Flipkart")}</a></div>
    </div>
    <div class="metrics">
      <div><span>历史最新价</span><b>${formatInr(analysis.latest_history_price_inr)}</b></div>
      <div><span>商城当前价</span><b>${formatInr(variant.current_store_price_inr)}</b></div>
      <div><span>近${RECENT_WINDOW_DAYS}天变化</span><b>${formatSignedInr(analysis.recent_delta_inr)} <small>${formatPct(
        analysis.recent_delta_pct
      )}</small></b></div>
      <div><span>从首见价变化</span><b>${formatSignedInr(analysis.launch_delta_inr)} <small>${formatPct(
        analysis.launch_delta_pct
      )}</small></b></div>
      <div><span>历史区间</span><b>${formatInr(variant.lowest_price_inr)} - ${formatInr(variant.highest_price_inr)}</b></div>
    </div>
    <div class="meta">代表判断：${directionLabel(direction)}；调价点：${analysis.price_change_count}；首见：${formatDate(
      analysis.first_price_at
    )}；来源：${escapeHtml(variant.price_source || "-")} · 商城：${escapeHtml(variant.store || "Flipkart")} · ${historyLink}</div>
    ${sameSkuMeta}
    ${chartSvg(variant.raw_price_points)}
    ${renderEventTable(variant)}
  </section>`;
}

function renderModel(model) {
  const rep = model.representative_variant;
  if (!rep) {
    return `<article class="model-card" id="${escapeHtml(model.id)}">
      <div class="model-head"><div><h3>${escapeHtml(model.query)}</h3><p>${escapeHtml(model.status)} · 0 SKU · 待人工确认链接</p></div></div>
      <p class="warn">未找到严格匹配。前 5 个可见候选：${escapeHtml(
        model.top_unmatched_candidates.map((c) => `${c.title || "-"} ${formatInr(c.price)}`).join(" / ")
      )}</p>
    </article>`;
  }
  const analysis = rep.analysis;
  const otherSku = model.hidden_variants || [];
  const modelLabel = modelLabelFromTitle(rep.title, model.query);
  return `<article class="model-card" id="${escapeHtml(model.id)}">
    <div class="model-head">
      <div>
        <h3>${escapeHtml(modelLabel)}</h3>
        <p>${escapeHtml(model.query)} · 主显 SKU：${escapeHtml(rep.sku)}；其余 ${otherSku.length} 个 SKU 已折叠。</p>
      </div>
      <span class="chip ${escapeHtml(analysis.recent_direction)}">${directionLabel(analysis.recent_direction)} ${formatSignedInr(
        analysis.recent_delta_inr
      )}</span>
    </div>
    ${renderVariant(rep)}
    ${
      otherSku.length
        ? `<details class="fold"><summary>展开其他 SKU（${otherSku.length}）</summary>${otherSku
            .map((variant) => renderVariant(variant, { secondary: true }))
            .join("")}</details>`
        : ""
    }
  </article>`;
}

function renderBrandGroup(brand) {
  const latest = brand.latest_event
    ? `${formatDate(brand.latest_event.timestamp_iso)} ${formatSignedInr(brand.latest_event.delta_inr)}`
    : "暂无";
  const biggestIncrease = brand.biggest_increase
    ? `${formatShortDate(brand.biggest_increase.timestamp_iso)} ${formatSignedInr(brand.biggest_increase.delta_inr)}`
    : "-";
  const biggestDecrease = brand.biggest_decrease
    ? `${formatShortDate(brand.biggest_decrease.timestamp_iso)} ${formatSignedInr(brand.biggest_decrease.delta_inr)}`
    : "-";
  const openAttr = brand.attention_level !== "低" ? " open" : "";
  return `<details class="brand-section attention-${escapeHtml(brand.attention_level)}" id="brand-${escapeHtml(brand.brand_key)}"${openAttr}>
    <summary>
      <span>${escapeHtml(brand.brand_label)} · ${escapeHtml(brand.headline)}</span>
      <b>${escapeHtml(brand.attention_level)}关注</b>
    </summary>
    <div class="brand-body">
      <div class="brand-brief">
        <div>
          <p><strong>快速判断：</strong>${escapeHtml(brand.inference)}</p>
          <p class="tags">${renderTagList(brand.strategy_tags)}</p>
          <p class="meta">这是基于近 ${RECENT_WINDOW_DAYS} 天代表 SKU 的调价方向、幅度和 5 月印度电商活动窗口做的推断，不等同于品牌官方原因。</p>
        </div>
        <ul>
          <li>机型 ${brand.model_count} 个，SKU ${brand.variant_count} 个；主视图按机型计数，不让同一机型多个 SKU 重复占位。</li>
          <li>近 ${RECENT_WINDOW_DAYS} 天：上调 ${brand.up_models} / 下调 ${brand.down_models} / 稳定 ${brand.flat_models}。</li>
          <li>品牌净变化：${formatSignedInr(brand.net_recent_delta_inr)}；最新动作：${latest}。</li>
          <li>最大上调：${biggestIncrease}；最大下调：${biggestDecrease}。</li>
          <li>待补链接/未严格命中：${brand.unresolved_models} 个。</li>
        </ul>
      </div>
      ${brand.models.map(renderModel).join("")}
    </div>
  </details>`;
}

async function build() {
  const historyRows = loadHistoryRows();
  const liveObservationsByPid = loadLiveObservations();
  const priceBeforeCache = loadPriceBeforeCache();
  const priceBeforeStats = {
    cache_hits: 0,
    fetch_attempts: 0,
    fetched: 0,
    failures: 0,
    skipped_by_budget: 0,
    errors: [],
  };
  const items = [];
  for (const spec of WATCHLIST) {
    const payload = loadJson(spec.file);
    const candidates = payload?.candidates || [];
    const exact = dedupeVariants(candidates.filter((row) => exactMatch(spec, row)));
    const variants = [];
    for (const row of exact) {
      const sku = extractSku(row);
      const history = matchHistory(row, sku, spec, historyRows);
      const live = liveObservationsByPid.get(extractPid(row.product_url));
      const priceBefore = await resolvePriceBefore(row, priceBeforeCache, priceBeforeStats);
      const preferredHistory = priceBefore || history;
      const historyStatus = priceBefore
        ? "pricebefore_history_found"
        : live
          ? "live_summary_found"
          : history
            ? "cached_history_found"
            : "missing_history";
      variants.push({
        sku,
        title: displayTitleFromRow(row),
        store: row.store_name || "Flipkart",
        store_key: row.store_key || "flipkart",
        product_url: row.product_url,
        current_store_price_inr: row.current_store_price_inr,
        rating_count: row.rating_count,
        availability: row.availability,
        listing_rank: row.listing_rank,
        same_sku_candidates: row.same_sku_candidates || [candidateOption(row)],
        pricehistory_live_status: live
          ? "live_current_chrome_verified_2026-05-23"
          : priceBefore
            ? "not_needed_pricebefore_history_found"
            : "blocked_cloudflare_turnstile_observed_2026-05-23",
        cached_history_status: historyStatus,
        pricehistory_page_url: live?.pricehistory_page_url || history?.pricehistory_page_url || "",
        pricebefore_page_url: priceBefore?.pricebefore_page_url || "",
        history_page_url: priceBefore?.pricebefore_page_url || live?.pricehistory_page_url || history?.pricehistory_page_url || "",
        history_source_file: priceBefore
          ? PRICEBEFORE_CACHE_FILE
          : live
            ? LIVE_OBSERVATION_FILE
            : history?.history_file || "",
        price_source: priceBefore?.price_source || (live ? "pricehistory_current_chrome_summary" : history?.price_source || ""),
        history_source_note: priceBefore
          ? "PriceBefore page daily chart data parsed from product HTML."
          : live?.history_source_note || "",
        first_seen_price_at: preferredHistory?.first_seen_price_at || live?.lowest_price_at || "",
        first_seen_price_inr: preferredHistory?.first_seen_price_inr ?? live?.lowest_price_inr ?? null,
        lowest_price_inr: preferredHistory?.lowest_price_inr ?? live?.lowest_price_inr ?? null,
        highest_price_inr: preferredHistory?.highest_price_inr ?? live?.highest_price_inr ?? null,
        average_price_inr: preferredHistory?.average_price_inr ?? live?.average_price_inr ?? null,
        price_tracking_days: live?.price_tracking_days ?? null,
        highest_price_at: live?.highest_price_at || "",
        price_change_events: preferredHistory?.price_change_events || [],
        raw_price_points: preferredHistory?.raw_price_points || [],
      });
    }
    items.push({
      query: spec.query,
      family_key: familyKeyFromQuery(spec.query),
      status: variants.length ? "store_exact_match" : "no_exact_store_match",
      variant_count: variants.length,
      variants,
      top_unmatched_candidates: candidates
        .slice(0, 5)
        .map((row) => ({
          title: row.candidate_name,
          price: row.current_store_price_inr,
          rank: row.listing_rank,
          reason: "visible_but_not_exact_model_match",
        })),
    });
  }

  const totals = {
    watchlist: items.length,
    exact_match_models: items.filter((item) => item.variant_count > 0).length,
    exact_match_variants: items.reduce((sum, item) => sum + item.variant_count, 0),
    variants_with_pricebefore_history: items.flatMap((item) => item.variants).filter((v) => v.cached_history_status === "pricebefore_history_found").length,
    variants_with_cached_history: items.flatMap((item) => item.variants).filter((v) => v.cached_history_status === "cached_history_found").length,
    variants_with_live_summary: items.flatMap((item) => item.variants).filter((v) => v.cached_history_status === "live_summary_found").length,
    pricehistory_live_blocked: items
      .flatMap((item) => item.variants)
      .some((v) => v.cached_history_status !== "pricebefore_history_found" && v.pricehistory_live_status !== "live_current_chrome_verified_2026-05-23"),
    pricebefore_fetch: priceBeforeStats,
  };

  const payload = {
    generated_at: new Date().toISOString(),
    workflow: "manual_list_store_link_then_pricebefore",
    constraints: {
      market: "India",
      category: "phones",
      price_band_inr: [20000, 50000],
      store_priority: ["flipkart", "amazon"],
      sku_policy: "RAM+ROM variants separate; colors merged",
      primary_history_source: "PriceBefore product page daily chart data",
      fallback_history_source: "cached PriceHistory artifacts and one manual Chrome summary",
      live_observation_file: `00_Inbox/${LIVE_OBSERVATION_FILE}`,
      pricebefore_cache_file: `00_Inbox/${PRICEBEFORE_CACHE_FILE}`,
    },
    totals,
    analysis: buildAnalysis(items),
    items,
  };

  const jsonPath = path.join(INBOX, `manual-pricehistory-watchlist-${REPORT_TAG}-report.json`);
  const htmlPath = path.join(INBOX, `manual-pricehistory-watchlist-${REPORT_TAG}-report.html`);
  savePriceBeforeCache(priceBeforeCache);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(htmlPath, renderHtml(payload).replace(/[ \t]+$/gm, ""), "utf8");
  console.log(`Saved ${jsonPath}`);
  console.log(`Saved ${htmlPath}`);
}

function renderHtml(payload) {
  const analysis = payload.analysis || buildAnalysis(payload.items);
  const brandCards = analysis.brand_groups
    .map(
      (brand) => `<a class="brand-card" href="#brand-${escapeHtml(brand.brand_key)}">
        <span>${escapeHtml(brand.brand_label)} · ${escapeHtml(brand.attention_level)}关注</span>
        <b>${escapeHtml(brand.headline)}</b>
        <small>${brand.model_count} 个机型 · ${brand.variant_count} 个 SKU · 净变化 ${formatSignedInr(brand.net_recent_delta_inr)}</small>
        <em>上调 ${brand.up_models} / 下调 ${brand.down_models} / 稳定 ${brand.flat_models} · 待补 ${brand.unresolved_models}</em>
      </a>`
    )
    .join("");
  const marketContext = analysis.market_context
    .map(
      (event) => `<li><strong>${escapeHtml(event.label)}</strong> ${escapeHtml(event.start)} - ${escapeHtml(event.end)}：${escapeHtml(
        event.note
      )} <a href="${escapeHtml(event.source_url)}">${escapeHtml(event.source_label)}</a></li>`
    )
    .join("");
  const brandSections = analysis.brand_groups.map(renderBrandGroup).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>手动清单价格监控 ${REPORT_TAG}</title>
  <style>
    :root{
      --page:#f4f6f8;
      --paper:#ffffff;
      --paper-soft:#f8fafc;
      --ink:#101828;
      --muted:#667085;
      --line:#d9e1ea;
      --line-soft:#edf1f6;
      --blue:#2156d9;
      --blue-soft:#eef4ff;
      --red:#b42318;
      --red-soft:#fff1f0;
      --amber:#a65f00;
      --amber-soft:#fff7e6;
      --green:#067647;
      --green-soft:#ecfdf3;
      --shadow:0 14px 32px rgba(16,24,40,.07);
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      background:var(--page);
      color:var(--ink);
      font-family:"Aptos","Avenir Next","Noto Sans SC","PingFang SC",sans-serif;
      font-size:15px;
      line-height:1.5;
    }
    h1,h2,h3,p{letter-spacing:0}
    a{color:var(--blue);text-decoration:none}
    a:hover{text-decoration:underline}
    html{scroll-behavior:smooth}
    header{
      padding:28px 34px 26px;
      background:var(--paper);
      border-bottom:1px solid var(--line);
      box-shadow:0 1px 0 rgba(16,24,40,.03);
    }
    h1{margin:0 0 14px;font-size:30px;line-height:1.1;font-weight:850}
    .summary{
      display:grid;
      grid-template-columns:repeat(5,minmax(130px,1fr));
      gap:10px;
    }
    .summary div,.metrics div,.context{
      border:1px solid var(--line);
      border-radius:8px;
      padding:12px;
      background:var(--paper-soft);
    }
    .summary div{
      min-height:82px;
      border-left:4px solid var(--blue);
    }
    .summary span,.metrics span,.meta,.submeta,small{
      display:block;
      color:var(--muted);
      font-size:13px;
    }
    .summary b,.metrics b{font-size:22px;line-height:1.18}
    .exec-panel{
      display:grid;
      grid-template-columns:minmax(0,1.25fr) minmax(280px,.7fr);
      gap:14px;
      margin-top:18px;
      align-items:start;
    }
    .exec-copy,.exec-metrics,.priority-list{
      border:1px solid var(--line);
      border-radius:8px;
      background:var(--paper);
      padding:16px;
      box-shadow:var(--shadow);
    }
    .exec-copy{border-left:5px solid var(--blue)}
    .eyebrow{
      display:block;
      color:var(--blue);
      font-weight:850;
      font-size:12px;
    }
    .exec-copy h2{
      font-size:28px;
      line-height:1.16;
      margin:6px 0 12px;
      max-width:980px;
    }
    .exec-copy ol{
      margin:0;
      padding-left:21px;
      color:#344054;
      line-height:1.58;
    }
    .exec-copy li{margin:6px 0}
    .exec-metrics{
      display:grid;
      grid-template-columns:1fr;
      gap:0;
      box-shadow:none;
      background:var(--paper-soft);
    }
    .exec-metrics div{
      border:0;
      border-radius:0;
      border-bottom:1px solid var(--line);
      padding:0 0 10px;
      background:transparent;
    }
    .exec-metrics div+div{padding-top:10px}
    .exec-metrics div:last-child{border-bottom:0;padding-bottom:0}
    .exec-metrics span{display:block;color:var(--muted);font-size:12px}
    .exec-metrics b{font-size:18px}
    .priority-list{
      display:grid;
      grid-template-columns:repeat(3,minmax(0,1fr));
      gap:8px;
      grid-column:1 / -1;
      box-shadow:none;
      background:var(--paper-soft);
    }
    .priority-brand{
      display:block;
      color:var(--ink);
      border:1px solid var(--line-soft);
      border-radius:8px;
      padding:10px;
      background:var(--paper);
    }
    .priority-brand span,.priority-brand small{display:block;color:var(--muted);font-size:12px}
    .priority-brand b{display:block;margin:2px 0 4px}
    .brand-strip{
      display:grid;
      grid-template-columns:repeat(7,minmax(142px,1fr));
      gap:10px;
      margin-top:18px;
    }
    .brand-card{
      display:block;
      min-height:116px;
      border:1px solid var(--line);
      border-radius:8px;
      padding:12px;
      background:var(--paper-soft);
      color:var(--ink);
      transition:transform .15s ease,border-color .15s ease,background-color .15s ease;
    }
    .brand-card:hover{
      transform:translateY(-1px);
      border-color:#b9c7da;
      background:var(--paper);
      text-decoration:none;
    }
    .brand-card span{display:block;color:#475467;font-weight:750}
    .brand-card b{display:block;margin:5px 0;font-size:18px;line-height:1.24}
    .brand-card small,.brand-card em{display:block;color:var(--muted);font-size:12px;font-style:normal}
    .layout{
      max-width:1400px;
      margin:0 auto;
      padding:22px 24px 34px;
      display:grid;
      grid-template-columns:minmax(0,1fr) 320px;
      gap:18px;
    }
    main{min-width:0}
    aside{
      position:sticky;
      top:16px;
      align-self:start;
      background:var(--paper);
      border:1px solid var(--line);
      border-radius:8px;
      padding:14px;
      max-height:calc(100vh - 32px);
      overflow:auto;
      box-shadow:var(--shadow);
    }
    aside h2{font-size:18px;margin:0 0 10px}
    aside h3{
      font-size:12px;
      color:var(--muted);
      margin:14px 0 6px;
      padding-top:6px;
      border-top:1px solid var(--line-soft);
    }
    aside h3:first-of-type{border-top:0;padding-top:0}
    .timeline-row{
      display:grid;
      grid-template-columns:44px minmax(0,1fr) auto;
      gap:8px;
      align-items:center;
      border-left:4px solid #cbd5e1;
      border-radius:0 8px 8px 0;
      padding:8px;
      color:var(--ink);
      background:var(--paper-soft);
      margin-bottom:6px;
    }
    .timeline-row:hover{text-decoration:none;background:var(--blue-soft)}
    .timeline-row.up{border-left-color:var(--red)}
    .timeline-row.down{border-left-color:var(--blue)}
    .timeline-row.flat{border-left-color:var(--muted)}
    .timeline-row span,.timeline-row b{font-size:12px}
    .timeline-row strong{
      min-width:0;
      font-size:12px;
      font-weight:700;
      overflow-wrap:anywhere;
    }
    .timeline-row small{font-size:11px;line-height:1.25}
    .timeline-row em{display:block;color:var(--amber);font-style:normal;font-size:11px}
    .brand-section{
      background:var(--paper);
      border:1px solid var(--line);
      border-radius:8px;
      margin-bottom:18px;
      overflow:hidden;
      box-shadow:0 8px 22px rgba(16,24,40,.045);
    }
    .brand-section>summary{
      cursor:pointer;
      padding:17px 20px;
      font-size:23px;
      line-height:1.2;
      font-weight:850;
      list-style:none;
      display:flex;
      justify-content:space-between;
      gap:16px;
      align-items:center;
      background:var(--paper);
    }
    .brand-section>summary span{min-width:0}
    .brand-section>summary b{
      font-size:13px;
      border:1px solid var(--line);
      border-radius:999px;
      padding:5px 11px;
      background:var(--paper-soft);
      white-space:nowrap;
      font-weight:800;
    }
    .attention-高>summary{border-top:4px solid var(--red)}
    .attention-高>summary b{color:var(--red);background:var(--red-soft);border-color:#fecdca}
    .attention-中>summary{border-top:4px solid var(--amber)}
    .attention-中>summary b{color:var(--amber);background:var(--amber-soft);border-color:#fedf89}
    .attention-低>summary{border-top:4px solid #98a2b3}
    .brand-section>summary::-webkit-details-marker{display:none}
    .brand-body{border-top:1px solid var(--line-soft);padding:18px 20px 20px}
    .brand-brief{
      display:grid;
      grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);
      gap:14px;
      margin-bottom:16px;
      padding:14px;
      border:1px solid var(--line-soft);
      border-radius:8px;
      background:var(--paper-soft);
    }
    .brand-brief p{margin:0;line-height:1.58}
    .brand-brief ul{margin:0;padding-left:19px}
    .brand-brief li{margin:4px 0}
    .model-card{
      border-top:1px solid var(--line-soft);
      padding-top:18px;
      margin-top:18px;
      scroll-margin-top:20px;
    }
    .model-card:first-of-type{border-top:0;padding-top:0}
    .model-head{
      display:flex;
      justify-content:space-between;
      gap:16px;
      margin-bottom:10px;
      align-items:flex-start;
    }
    .model-head h3{margin:0;font-size:22px;line-height:1.24}
    .model-head p{margin:5px 0 0;color:var(--muted)}
    .chip{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      white-space:nowrap;
      border:1px solid var(--line);
      border-radius:999px;
      padding:5px 11px;
      font-size:13px;
      font-weight:800;
      background:var(--paper-soft);
    }
    .chip.up{color:var(--red);background:var(--red-soft);border-color:#fecdca}
    .chip.down{color:var(--blue);background:var(--blue-soft);border-color:#b2ccff}
    .chip.flat{color:#475467;background:#f2f4f7;border-color:#d0d5dd}
    .tag{
      display:inline-flex;
      align-items:center;
      border:1px solid var(--line);
      border-radius:999px;
      padding:3px 8px;
      margin:0 6px 6px 0;
      background:var(--paper);
      color:#475467;
      font-size:12px;
    }
    .variant{
      border:1px solid var(--line);
      border-radius:8px;
      padding:14px;
      background:var(--paper);
    }
    .variant.secondary{margin-top:10px;background:var(--paper-soft)}
    .variant-head{
      display:flex;
      justify-content:space-between;
      gap:16px;
      align-items:flex-start;
    }
    .variant-head strong{font-size:17px}
    .variant-head span{color:#475467}
    .submeta{margin:-4px 0 10px}
    .sku-links summary{cursor:pointer;color:var(--muted)}
    .sku-links div{margin-top:6px;line-height:1.5}
    .metrics{
      display:grid;
      grid-template-columns:repeat(5,minmax(122px,1fr));
      gap:10px;
      margin:12px 0;
    }
    .metrics div{
      min-height:92px;
      background:var(--paper-soft);
    }
    .chart{
      width:100%;
      height:230px;
      background:var(--paper);
      border:1px solid var(--line);
      border-radius:8px;
    }
    .chart line{stroke:#d0d7e2}
    .chart-event-window{fill:var(--amber);opacity:.14}
    .chart path{fill:none;stroke:var(--blue);stroke-width:3}
    .chart text{font-size:12px;fill:var(--muted)}
    .chart circle{fill:var(--blue)}
    .chart-point.up{fill:var(--red)}
    .chart-point.down{fill:var(--blue)}
    .chart-point.flat{fill:#98a2b3}
    table{
      width:100%;
      border-collapse:separate;
      border-spacing:0;
      margin-top:10px;
      overflow:hidden;
      border:1px solid var(--line-soft);
      border-radius:8px;
    }
    th,td{border-bottom:1px solid var(--line-soft);text-align:left;padding:8px 10px}
    th{background:var(--paper-soft);font-size:13px}
    tr:last-child td{border-bottom:0}
    .warn{
      color:var(--amber);
      background:var(--amber-soft);
      border:1px solid #fedf89;
      border-radius:8px;
      padding:10px;
    }
    .context{
      margin:0 0 18px;
      background:var(--paper);
    }
    .context h2{font-size:18px;margin:0 0 8px}
    .context ul{margin:0;padding-left:18px;color:#475467}
    .context li{margin:5px 0}
    .matrix-panel{
      background:var(--paper);
      border:1px solid var(--line);
      border-radius:8px;
      margin:0 0 18px;
      overflow:hidden;
      box-shadow:0 8px 22px rgba(16,24,40,.045);
    }
    .matrix-head{
      display:flex;
      justify-content:space-between;
      gap:14px;
      align-items:flex-start;
      padding:16px 18px 12px;
    }
    .matrix-head h2{margin:4px 0 0;font-size:22px;line-height:1.2}
    .matrix-count{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:72px;
      border:1px solid var(--line);
      border-radius:999px;
      padding:5px 11px;
      background:var(--paper-soft);
      font-size:13px;
    }
    .matrix-controls{
      display:flex;
      align-items:center;
      flex-wrap:wrap;
      gap:10px;
      padding:0 18px 14px;
    }
    .segmented{
      display:inline-flex;
      min-height:34px;
      border:1px solid var(--line);
      border-radius:8px;
      overflow:hidden;
      background:var(--paper-soft);
    }
    .segmented button{
      min-width:56px;
      border:0;
      border-right:1px solid var(--line);
      padding:7px 10px;
      background:transparent;
      color:var(--ink);
      font:inherit;
      font-size:13px;
      cursor:pointer;
    }
    .segmented button:last-child{border-right:0}
    .segmented button.active{background:var(--ink);color:#fff}
    .matrix-controls label{
      display:inline-flex;
      align-items:center;
      gap:6px;
      min-height:34px;
      color:var(--muted);
      font-size:13px;
    }
    .matrix-controls select{
      min-height:34px;
      border:1px solid var(--line);
      border-radius:8px;
      padding:0 28px 0 10px;
      background:var(--paper);
      color:var(--ink);
      font:inherit;
      font-size:13px;
    }
    .toggle{
      border:1px solid var(--line);
      border-radius:8px;
      padding:0 10px;
      background:var(--paper-soft);
    }
    .toggle input{margin:0}
    .matrix-scroll{
      overflow:auto;
      border-top:1px solid var(--line-soft);
    }
    .matrix-table{
      min-width:1020px;
      margin:0;
      border:0;
      border-radius:0;
      background:var(--paper);
    }
    .matrix-table th{
      position:sticky;
      top:0;
      z-index:1;
      background:#f1f5f9;
      white-space:nowrap;
    }
    .matrix-table td{vertical-align:top}
    .matrix-table .num{
      text-align:right;
      font-variant-numeric:tabular-nums;
      white-space:nowrap;
    }
    .matrix-table tr:hover td{background:var(--blue-soft)}
    .delta.up{color:var(--red);font-weight:800}
    .delta.down{color:var(--blue);font-weight:800}
    .delta.flat{color:var(--muted)}
    .delta.unresolved{color:var(--amber)}
    .matrix-read{
      display:inline-block;
      max-width:240px;
      border:1px solid var(--line);
      border-radius:999px;
      padding:3px 8px;
      background:var(--paper-soft);
      color:#475467;
      font-size:12px;
      line-height:1.35;
    }
    .matrix-read.up{color:var(--red);background:var(--red-soft);border-color:#fecdca}
    .matrix-read.down{color:var(--blue);background:var(--blue-soft);border-color:#b2ccff}
    .matrix-read.unresolved{color:var(--amber);background:var(--amber-soft);border-color:#fedf89}
    .model-card.is-focus{
      outline:3px solid rgba(33,86,217,.22);
      outline-offset:6px;
      border-radius:8px;
    }
    .fold{margin-top:10px}
    .fold summary{
      cursor:pointer;
      color:var(--blue);
      font-weight:800;
      padding:4px 0;
    }
    @media(max-width:1120px){
      .layout{display:block}
      aside{position:static;margin-bottom:18px}
      .brand-strip{grid-template-columns:repeat(2,minmax(140px,1fr))}
      .exec-panel{grid-template-columns:1fr}
      .priority-list{grid-template-columns:1fr}
      .priority-list{grid-column:auto}
    }
    @media(max-width:760px){
      header{padding:22px 18px}
      .layout{padding:18px}
      .summary,.metrics,.brand-brief{grid-template-columns:1fr}
      .matrix-head{display:block}
      .variant-head,.model-head,.brand-section>summary{display:block}
      .chip{margin-top:10px}
      .brand-strip{grid-template-columns:1fr}
    }
  </style>
</head>
<body>
  <header>
    <h1>手动清单价格监控</h1>
    <div class="summary">
      <div><span>清单机型</span><b>${payload.totals.watchlist}</b></div>
      <div><span>严格命中机型</span><b>${payload.totals.exact_match_models}</b></div>
      <div><span>SKU 命中</span><b>${payload.totals.exact_match_variants}</b></div>
      <div><span>PriceBefore 历史</span><b>${payload.totals.variants_with_pricebefore_history}</b></div>
      <div><span>其他缓存/摘要</span><b>${payload.totals.variants_with_cached_history + payload.totals.variants_with_live_summary}</b></div>
    </div>
    ${renderExecutivePanel(analysis.executive)}
    <div class="brand-strip">${brandCards}</div>
  </header>
  <div class="layout">
    <main>
      ${renderActionMatrix(analysis)}
      <section class="context">
        <h2>市场背景信号</h2>
        <ul>${marketContext}</ul>
      </section>
      ${brandSections}
    </main>
    <aside>
      <h2>最近调价时间轴</h2>
      ${renderTimeline(analysis.timeline)}
    </aside>
  </div>
  <script>
    (() => {
      const rows = [...document.querySelectorAll("[data-matrix-row]")];
      const count = document.querySelector("[data-matrix-count]");
      const state = { direction: "all", brand: "all", store: "all", significant: false };

      function applyFilters() {
        let visible = 0;
        for (const row of rows) {
          const directionMatch =
            state.direction === "all" ||
            row.dataset.direction === state.direction ||
            (state.direction === "unresolved" && row.dataset.unresolved === "true");
          const brandMatch = state.brand === "all" || row.dataset.brand === state.brand;
          const storeMatch = state.store === "all" || row.dataset.store === state.store;
          const significantMatch = !state.significant || row.dataset.significant === "true";
          const show = directionMatch && brandMatch && storeMatch && significantMatch;
          row.hidden = !show;
          if (show) visible += 1;
        }
        if (count) count.textContent = visible + "/" + rows.length;
      }

      document.querySelectorAll("[data-filter-direction]").forEach((button) => {
        button.addEventListener("click", () => {
          state.direction = button.dataset.filterDirection || "all";
          document.querySelectorAll("[data-filter-direction]").forEach((item) => item.classList.toggle("active", item === button));
          applyFilters();
        });
      });

      document.querySelector("[data-filter-brand]")?.addEventListener("change", (event) => {
        state.brand = event.target.value;
        applyFilters();
      });

      document.querySelector("[data-filter-store]")?.addEventListener("change", (event) => {
        state.store = event.target.value;
        applyFilters();
      });

      document.querySelector("[data-filter-significant]")?.addEventListener("change", (event) => {
        state.significant = event.target.checked;
        applyFilters();
      });

      function focusModelFromHash() {
        const id = decodeURIComponent(location.hash || "").slice(1);
        document.querySelectorAll(".model-card.is-focus").forEach((node) => node.classList.remove("is-focus"));
        if (!id) return;
        const target = document.getElementById(id);
        if (target?.classList.contains("model-card")) {
          target.classList.add("is-focus");
          window.setTimeout(() => target.classList.remove("is-focus"), 2600);
        }
      }

      window.addEventListener("hashchange", focusModelFromHash);
      applyFilters();
      focusModelFromHash();
    })();
  </script>
</body>
</html>`;
}

build().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
