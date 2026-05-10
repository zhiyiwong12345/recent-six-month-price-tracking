#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const API_BASE = "https://django.prixhistory.com";
const APP_BASE = "https://pricehistoryapp.com";
const PRICEHISTORY_APP = "https://pricehistory.app";
const R_JINA_HTTP = "https://r.jina.ai/http://";
const FLIPKART_AFFILIATE_SEARCH =
  "https://affiliate-api.flipkart.net/affiliate/search/json";
const AUTH_SECRET = "8rRaP?pX7sfh5#%FXS423kG%et5qxVeN";

const DEFAULT_STORES = ["flipkart", "amazon"];
const DEFAULT_PREFER_STORES = ["flipkart", "amazon"];
const DEFAULT_IMPACT_START = "2025-07-01";
const HIGH_SENSITIVE_START = "2025-10-01";
const RESTOCK_SENSITIVE_START = "2025-04-01";
const FETCH_TIMEOUT_MS = 12000;

const COLOR_TOKENS = new Set([
  "black",
  "white",
  "blue",
  "red",
  "green",
  "purple",
  "pink",
  "silver",
  "gold",
  "gray",
  "grey",
  "obsidian",
  "graphite",
  "cream",
  "navy",
  "charcoal",
  "lime",
  "sonic",
  "meteorite",
  "phantom",
  "awesome",
  "midnight",
  "starlight",
  "afterglow",
  "twilight",
  "ice",
  "aurora",
  "glacier",
  "cosmic",
  "mocha",
  "pearl",
  "titan",
  "tailored",
  "fabric",
  "pantone",
]);

const NON_PHONE_HINTS = [
  "tablet",
  " tab ",
  "ipad",
  "watch",
  "laptop",
  "notebook",
  "mouse",
  "keyboard",
  "earbuds",
  "earphones",
  "headset",
  "speaker",
  "router",
  "printer",
  "charger",
  "adapter",
  "cable",
  "cover",
  "case",
  "protector",
];

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

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function splitTokenList(value) {
  if (typeof value !== "string") return [];
  return value
    .split(/[\s,|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitQueryList(value) {
  if (typeof value !== "string") return [];
  return value
    .split(/[|,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupeStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function ensureHttpUrl(value) {
  const text = normalizeSpace(value);
  if (!/^https?:\/\//i.test(text)) return null;
  return text;
}

function parseUrlSafe(value) {
  try {
    return new URL(value);
  } catch (err) {
    return null;
  }
}

function fmtInr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `INR ${Math.round(n).toLocaleString("en-IN")}`;
}

function fmtPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return escapeHtml(value);
  return d.toISOString().slice(0, 10);
}

function dateToSec(value) {
  const ms = Date.parse(`${String(value || "").slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function isoToSec(value) {
  const ms = Date.parse(value || "");
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function timestampToIso(sec) {
  return new Date(Number(sec) * 1000).toISOString();
}

function todayTag() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function normalizeStoreKey(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("flipkart")) return "flipkart";
  if (text.includes("amazon")) return "amazon";
  return text
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveStoreKey(storeName, inputUrl) {
  const fromName = normalizeStoreKey(storeName);
  if (fromName) return fromName;
  const parsed = parseUrlSafe(inputUrl || "");
  return parsed ? normalizeStoreKey(parsed.hostname) : "";
}

function buildStorePriorityMap(preferStores) {
  const map = new Map();
  preferStores.forEach((store, idx) => map.set(normalizeStoreKey(store), idx));
  return map;
}

function storePriorityRank(storeKey, priorityMap) {
  const key = normalizeStoreKey(storeKey);
  return priorityMap.has(key) ? priorityMap.get(key) : 999;
}

function makeAuthToken() {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(AUTH_SECRET, "utf8"),
    iv
  );
  const encrypted = Buffer.concat([
    cipher.update(new Date().toUTCString(), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

async function apiRequest(url, options) {
  const response = await fetch(url, {
    cache: "no-cache",
    ...options,
    headers: {
      Auth: makeAuthToken(),
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = null;
  }
  return { ok: response.ok, status: response.status, data, rawText: text };
}

async function apiPost(pathname, formFields) {
  return apiRequest(`${API_BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(formFields).toString(),
  });
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timeoutMs = FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-cache",
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      throw new Error(`fetch_timeout_${timeoutMs}ms`);
    }
    throw err;
  }
  clearTimeout(timer);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

async function fetchJsonPlain(url, options) {
  const ctrl = new AbortController();
  const timeoutMs = FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-cache",
      ...options,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
        ...(options && options.headers ? options.headers : {}),
      },
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      throw new Error(`fetch_timeout_${timeoutMs}ms`);
    }
    throw err;
  }
  clearTimeout(timer);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    throw new Error(`invalid_json_http_${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return data;
}

function cleanMaybeUrl(value) {
  let text = String(value || "").trim();
  text = text.replace(/[)\],.]+$/g, "");
  text = text.replace(/&amp;/g, "&");
  return ensureHttpUrl(text);
}

function parseInrNumber(text) {
  const normalized = String(text || "").replace(/\u00a0/g, " ");
  const match =
    normalized.match(/INR\s*([0-9][0-9,]+)/i) ||
    normalized.match(/Rs\.?\s*([0-9][0-9,]+)/i) ||
    normalized.match(/₹\s*([0-9][0-9,]+)/i);
  if (!match) return null;
  const value = Number(String(match[1]).replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function looksLikeNonPhone(name) {
  const text = ` ${normalizeText(name)} `;
  return NON_PHONE_HINTS.some((hint) => text.includes(hint));
}

function normalizeModelSearchQuery(name) {
  return normalizeSpace(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(5g|4g|mobile|phone|smartphone)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalModelKey(name) {
  return normalizeText(name)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token !== "5g" && token !== "4g")
    .join(" ");
}

function modelGroupKeyFromTitle(title) {
  const tokens = normalizeText(title)
    .split(/\s+/)
    .filter(Boolean);
  const keep = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = tokens[i + 1] || "";
    if (/^\d{1,4}$/.test(token) && /^(gb|tb|mb)$/.test(next)) break;
    if (/^\d{1,4}(gb|tb|mb)$/.test(token)) break;
    if (token === "ram" || token === "rom" || token === "storage") break;
    keep.push(token);
  }
  while (keep.length > 1 && COLOR_TOKENS.has(keep[keep.length - 1])) {
    keep.pop();
  }
  return keep
    .filter((token) => token !== "5g" && token !== "4g" && !COLOR_TOKENS.has(token))
    .join("-");
}

function extractVariantSignature(title, slugOrUrl) {
  const text = `${String(title || "")} ${String(slugOrUrl || "")}`.toLowerCase();
  const plus =
    text.match(/(\d{1,2})\s*gb\s*(?:ram)?\s*(?:\+|plus)\s*(\d{2,4})\s*(gb|tb)/i) ||
    text.match(/(\d{1,2})\s*gb\s*ram[^0-9]+(\d{2,4})\s*(gb|tb)\s*rom/i);
  if (plus) {
    return `${Number(plus[1])}GB+${Number(plus[2])}${String(plus[3]).toUpperCase()}`;
  }

  const ram =
    text.match(/(?:^|[^0-9])(\d{1,2})\s*gb\s*ram\b/i) ||
    text.match(/(?:^|[^0-9])(\d{1,2})\s*gb\s*\|\s*\d{2,4}\s*gb\b/i);
  const rom =
    text.match(/(?:^|[^0-9])(\d{2,4})\s*(gb|tb)\s*rom\b/i) ||
    text.match(/(?:^|[^0-9])(\d{2,4})[-\s]*(gb|tb)(?:[^a-z0-9]|$)/i);

  if (ram && rom) {
    return `${Number(ram[1])}GB+${Number(rom[1])}${String(rom[2]).toUpperCase()}`;
  }
  if (rom) {
    return `RAM_UNKNOWN+${Number(rom[1])}${String(rom[2]).toUpperCase()}`;
  }
  return "STD";
}

function skuStatus(variantLabel) {
  const label = String(variantLabel || "");
  if (label.startsWith("RAM_UNKNOWN+")) return "needs_review";
  if (label === "STD") return "unknown";
  return "confirmed";
}

function skuStatusLabel(status) {
  const value = String(status || "");
  if (value === "confirmed") return "Confirmed";
  if (value === "needs_review") return "Needs review";
  if (value === "unknown") return "Unknown";
  return value || "-";
}

function skuStatusRank(status) {
  const value = String(status || "");
  if (value === "confirmed") return 0;
  if (value === "needs_review") return 1;
  return 2;
}

function displaySku(product) {
  const label = String(product && product.variant_label || "");
  if (label.startsWith("RAM_UNKNOWN+")) {
    return `${label.replace(/^RAM_UNKNOWN\+/, "")} (RAM needs review)`;
  }
  return label || "-";
}

function humanizeModelKey(key) {
  return normalizeSpace(
    String(key || "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function displayProductName(product) {
  const model =
    normalizeSpace(product && product.source_model_name) ||
    normalizeSpace(product && product.launch_model_name) ||
    humanizeModelKey(product && product.variant_group_key) ||
    normalizeSpace(product && product.candidate_name) ||
    normalizeSpace(product && product.slug);
  const sku = displaySku(product);
  return sku && sku !== "STD" && sku !== "-" ? `${model} - ${sku}` : model;
}

function productIdentityFromUrl(url) {
  const parsed = parseUrlSafe(url);
  if (!parsed) return normalizeSpace(url);
  const pid = parsed.searchParams.get("pid");
  if (pid) return `${normalizeStoreKey(parsed.hostname)}::${pid}`;
  return `${normalizeStoreKey(parsed.hostname)}::${parsed.pathname.replace(/\/+$/, "")}`;
}

function extractFlipkartCandidatesFromMarkdown(markdown, meta) {
  const out = [];
  const seen = new Set();
  const lines = String(markdown || "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = normalizeSpace(rawLine);
    if (!line.includes("flipkart.com/") || !line.toLowerCase().includes("/p/")) {
      continue;
    }
    const price = parseInrNumber(line);
    if (!Number.isFinite(price)) continue;
    if (price < meta.minPrice || price > meta.maxPrice) continue;

    const urlMatches = line.match(/https?:\/\/www\.flipkart\.com\/[^)\s]+/gi) || [];
    if (!urlMatches.length) continue;

    const unavailable = /currently unavailable|coming soon/i.test(line);
    const ratingMatch = line.match(/\b([0-5](?:\.[0-9])?)\b/);
    const rating = ratingMatch ? Number(ratingMatch[1]) : null;
    const ratingCountMatch = line.match(/([0-9][0-9,]*)\s*Ratings/i);
    const ratingCount = ratingCountMatch
      ? Number(String(ratingCountMatch[1]).replace(/,/g, ""))
      : null;

    for (const rawUrl of urlMatches) {
      const productUrl = cleanMaybeUrl(rawUrl);
      if (!productUrl) continue;
      const identity = productIdentityFromUrl(productUrl);
      if (seen.has(identity)) continue;
      seen.add(identity);

      let candidateName = line
        .replace(/\!\[[^\]]*\]\([^)]+\)/g, " ")
        .replace(/\[[^\]]*\]\([^)]+\)/g, " ")
        .replace(/https?:\/\/www\.flipkart\.com\/[^\s]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      const addToCompare = candidateName.toLowerCase().indexOf("add to compare");
      if (addToCompare >= 0) {
        candidateName = candidateName.slice(addToCompare + "add to compare".length).trim();
      }
      candidateName = candidateName
        .replace(/\b[0-5](?:\.[0-9])?\b[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!candidateName) candidateName = meta.query || "Flipkart mobile";
      if (looksLikeNonPhone(candidateName)) continue;

      out.push({
        source: meta.source,
        store_key: "flipkart",
        store_name: "Flipkart",
        candidate_name: candidateName,
        raw_line: line,
        product_url: productUrl,
        current_store_price_inr: price,
        rating: Number.isFinite(rating) ? rating : null,
        rating_count: Number.isFinite(ratingCount) ? ratingCount : null,
        availability: unavailable ? "unavailable" : "listed",
        listing_rank: out.length + 1,
        launch_model_key: meta.launchModelKey || null,
        launch_model_name: meta.launchModelName || null,
        launch_date_iso: meta.launchDateIso || null,
        launch_sources: meta.launchSources || [],
      });
    }
  }
  return out;
}

function flipkartAffiliateCredentials() {
  const id =
    process.env.FLIPKART_AFFILIATE_ID ||
    process.env.FK_AFFILIATE_ID ||
    process.env.FK_AFFILIATE_TRACKING_ID ||
    "";
  const token =
    process.env.FLIPKART_AFFILIATE_TOKEN ||
    process.env.FK_AFFILIATE_TOKEN ||
    process.env.FK_AFFILIATE_API_TOKEN ||
    "";
  return {
    id: normalizeSpace(id),
    token: normalizeSpace(token),
  };
}

function parseAffiliatePrice(priceBlock) {
  if (Number.isFinite(Number(priceBlock))) return Number(priceBlock);
  if (!priceBlock || typeof priceBlock !== "object") return null;
  const value =
    Number(priceBlock.amount) ||
    Number(priceBlock.value) ||
    Number(priceBlock.price) ||
    null;
  return Number.isFinite(value) ? value : null;
}

function affiliateProductToCandidate(item, meta) {
  const base =
    (item && item.productBaseInfoV1) ||
    (item && item.productBaseInfo) ||
    (item && item.productBaseInfoV2) ||
    item ||
    {};
  const title = normalizeSpace(base.title || base.productTitle || base.name);
  const productUrl = ensureHttpUrl(base.productUrl || base.url || "");
  const price =
    parseAffiliatePrice(base.flipkartSellingPrice) ||
    parseAffiliatePrice(base.flipkartSpecialPrice) ||
    parseAffiliatePrice(base.sellingPrice) ||
    parseAffiliatePrice(base.maximumRetailPrice);
  if (!title || !productUrl || !Number.isFinite(price)) return null;
  if (price < meta.minPrice || price > meta.maxPrice) return null;
  if (looksLikeNonPhone(title)) return null;
  return {
    source: "flipkart_affiliate_api",
    store_key: "flipkart",
    store_name: "Flipkart",
    candidate_name: title,
    raw_line: title,
    product_url: productUrl,
    current_store_price_inr: price,
    rating: null,
    rating_count: null,
    availability: base.inStock === false ? "unavailable" : "listed",
    listing_rank: meta.rank,
    launch_model_key: meta.launchModelKey || null,
    launch_model_name: meta.launchModelName || null,
    launch_date_iso: meta.launchDateIso || null,
    launch_sources: meta.launchSources || [],
  };
}

async function fetchFlipkartAffiliateCandidates(query, opts) {
  const creds = flipkartAffiliateCredentials();
  if (!creds.id || !creds.token || opts.disableAffiliate) {
    return { candidates: [], skipped: true, reason: "missing_flipkart_affiliate_credentials" };
  }
  const params = new URLSearchParams({
    query,
    resultCount: String(Math.min(10, Math.max(1, opts.resultCount || 10))),
  });
  const url = `${FLIPKART_AFFILIATE_SEARCH}?${params.toString()}`;
  const data = await fetchJsonPlain(url, {
    headers: {
      "Fk-Affiliate-Id": creds.id,
      "Fk-Affiliate-Token": creds.token,
    },
  });
  const rows = Array.isArray(data.productInfoList)
    ? data.productInfoList
    : Array.isArray(data.products)
      ? data.products
      : [];
  const candidates = [];
  for (const item of rows) {
    const candidate = affiliateProductToCandidate(item, {
      ...opts,
      rank: candidates.length + 1,
    });
    if (candidate) candidates.push(candidate);
  }
  return { candidates, skipped: false, reason: null };
}

function buildFlipkartSearchUrl(query, minPrice, maxPrice, page, sort) {
  const params = new URLSearchParams({
    q: query,
    sid: "tyy,4io",
    sort: sort || "popularity",
    page: String(page || 1),
  });
  return (
    `https://www.flipkart.com/search?${params.toString()}` +
    `&p%5B%5D=facets.price_range.from%3D${encodeURIComponent(String(minPrice))}` +
    `&p%5B%5D=facets.price_range.to%3D${encodeURIComponent(String(maxPrice))}`
  );
}

async function fetchFlipkartSearchCandidates(query, opts) {
  const all = [];
  for (let page = 1; page <= opts.maxPages; page += 1) {
    const flipkartUrl = buildFlipkartSearchUrl(
      query,
      opts.minPrice,
      opts.maxPrice,
      page,
      opts.sort || "popularity"
    );
    const proxyUrl = `${R_JINA_HTTP}${flipkartUrl.replace(/^https?:\/\//i, "")}`;
    try {
      const markdown = await fetchText(proxyUrl);
      all.push(
        ...extractFlipkartCandidatesFromMarkdown(markdown, {
          ...opts,
          query,
          source: opts.source || "flipkart_search",
        })
      );
    } catch (err) {
      opts.errors.push(`flipkart_search ${query} page=${page}: ${String(err.message || err)}`);
    }
  }
  return all;
}

function readJsonMaybe(file) {
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runNodeScript(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Failed: ${path.basename(scriptPath)} ${args.join(" ")}`);
  }
}

function launchPoolCacheCandidates(outDir, requestedMonths) {
  if (!fs.existsSync(outDir)) return [];
  return fs
    .readdirSync(outDir)
    .filter((name) => /^memory-launch-pool-.*\.json$/.test(name) || /^new-launch-pool.*\.json$/.test(name))
    .map((name) => {
      const file = path.join(outDir, name);
      let meta = null;
      try {
        meta = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {
        meta = null;
      }
      const windowMonths = Number(meta && meta.window_months);
      const isWorkflowCache = /^memory-launch-pool-.*\.json$/.test(name);
      const monthCompatible =
        !Number.isFinite(windowMonths) || windowMonths >= requestedMonths;
      return {
        file,
        mtimeMs: fs.statSync(file).mtimeMs,
        isWorkflowCache,
        monthCompatible,
        windowMonths: Number.isFinite(windowMonths) ? windowMonths : null,
      };
    })
    .filter((row) => row.monthCompatible)
    .sort((a, b) => {
      if (a.isWorkflowCache !== b.isWorkflowCache) return a.isWorkflowCache ? -1 : 1;
      return b.mtimeMs - a.mtimeMs;
    });
}

function loadOrBuildLaunchPool(rootDir, outDir, args, tag) {
  const launchPoolArg = args.launchPool ? path.resolve(String(args.launchPool)) : "";
  if (launchPoolArg) {
    const source = readJsonMaybe(launchPoolArg);
    if (!source) throw new Error(`Missing launch pool: ${launchPoolArg}`);
    return { source, file: launchPoolArg, generated: false };
  }

  const months = Number(args.launchMonths || 14);
  const cacheCandidates = launchPoolCacheCandidates(outDir, months);
  const cached = cacheCandidates[0] ? cacheCandidates[0].file : null;
  const maxCacheAgeDays = Number(args.launchPoolMaxAgeDays || 7);
  const cachedAgeDays = cached
    ? Math.floor((Date.now() - fs.statSync(cached).mtimeMs) / 86400000)
    : null;
  if (args.refreshLaunchPool !== true && args.refreshLaunchPool !== "true") {
    if (
      cached &&
      Number.isFinite(cachedAgeDays) &&
      cachedAgeDays <= maxCacheAgeDays
    ) {
      return {
        source: JSON.parse(fs.readFileSync(cached, "utf8")),
        file: cached,
        generated: false,
        error: null,
        cached: true,
        cache_age_days: cachedAgeDays,
        cache_policy: `matched_window_months_at_least_${months}`,
      };
    }
  }

  const launchFile = path.join(outDir, `memory-launch-pool-${tag}.json`);
  try {
    runNodeScript(path.join(rootDir, "scripts", "fetch_new_launch_pool.js"), [
      "--months",
      String(months),
      "--out",
      launchFile,
    ]);
    return {
      source: JSON.parse(fs.readFileSync(launchFile, "utf8")),
      file: launchFile,
      generated: true,
      error: null,
      cached: false,
    };
  } catch (err) {
    if (cached) {
      return {
        source: JSON.parse(fs.readFileSync(cached, "utf8")),
        file: cached,
        generated: false,
        error: `launch_pool_refresh_failed_using_cache: ${String(
          err && err.message ? err.message : err
        )}`,
        cached: true,
        cache_age_days: cachedAgeDays,
        cache_policy: `refresh_failed_matched_window_months_at_least_${months}`,
      };
    }
    return {
      source: { models: [], source_errors: [String(err && err.message ? err.message : err)] },
      file: launchFile,
      generated: false,
      error: String(err && err.message ? err.message : err),
      cached: false,
    };
  }
}

function modelLaunchRows(launchPool) {
  return Array.isArray(launchPool && launchPool.models) ? launchPool.models : [];
}

function classifyLaunchDate(launchDateIso) {
  const day = String(launchDateIso || "").slice(0, 10);
  if (!day) return "control_or_unknown";
  if (day >= HIGH_SENSITIVE_START) return "high_sensitive";
  if (day >= RESTOCK_SENSITIVE_START) return "restock_sensitive";
  return "control";
}

function scoreCandidate(candidate) {
  const ratingCount = Number(candidate.rating_count) || 0;
  const rating = Number(candidate.rating) || 0;
  const rankBoost = Math.max(0, 100 - (Number(candidate.listing_rank) || 100)) / 100;
  const ratingScore = Math.log10(ratingCount + 10) * 12 + rating * 8;
  return Number((ratingScore + rankBoost * 10).toFixed(4));
}

function dedupeCandidates(candidates, priorityMap) {
  const byIdentity = new Map();
  for (const candidate of candidates) {
    const identity = productIdentityFromUrl(candidate.product_url);
    const prev = byIdentity.get(identity);
    const curScore = scoreCandidate(candidate);
    if (!prev) {
      byIdentity.set(identity, { ...candidate, sellwell_score: curScore });
      continue;
    }
    if (candidate.pre_resolved_product && !prev.pre_resolved_product) {
      byIdentity.set(identity, { ...candidate, sellwell_score: curScore });
      continue;
    }
    const prevRank = storePriorityRank(prev.store_key, priorityMap);
    const curRank = storePriorityRank(candidate.store_key, priorityMap);
    if (curRank < prevRank || (curRank === prevRank && curScore > prev.sellwell_score)) {
      byIdentity.set(identity, { ...candidate, sellwell_score: curScore });
    }
  }
  return Array.from(byIdentity.values());
}

function latestMatchingFile(outDir, regex) {
  if (!fs.existsSync(outDir)) return null;
  const files = fs
    .readdirSync(outDir)
    .filter((name) => regex.test(name))
    .map((name) => {
      const file = path.join(outDir, name);
      return { file, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0] ? files[0].file : null;
}

function candidatesFromNewLaunchShortlist(report, minPrice, maxPrice) {
  const out = [];
  for (const row of report && Array.isArray(report.shortlist) ? report.shortlist : []) {
    for (const entry of Array.isArray(row.entries) ? row.entries : []) {
      const productUrl = ensureHttpUrl(entry.product_url);
      const price = Number(entry.current_price_inr || entry.price_inr);
      if (!productUrl || !Number.isFinite(price)) continue;
      if (price < minPrice || price > maxPrice) continue;
      out.push({
        source: "local_new_launch_shortlist_fallback",
        store_key: normalizeStoreKey(entry.store_key || ""),
        store_name: entry.store_name || entry.store_key || "",
        candidate_name: entry.candidate_name || row.model_name,
        product_url: productUrl,
        current_store_price_inr: price,
        rating: Number.isFinite(Number(entry.rating)) ? Number(entry.rating) : null,
        rating_count: Number.isFinite(Number(entry.rating_count))
          ? Number(entry.rating_count)
          : null,
        availability: "listed",
        listing_rank: out.length + 1,
        launch_model_key: row.model_key || null,
        launch_model_name: row.model_name || null,
        launch_date_iso: row.launch_date_iso || null,
        launch_sources: row.sources || [],
      });
    }
  }
  return out;
}

function candidatesFromPriceStatusReport(report, minPrice, maxPrice) {
  const out = [];
  for (const product of report && Array.isArray(report.products) ? report.products : []) {
    const productUrl = ensureHttpUrl(product.product_url);
    const price = Number(product.current_price_inr);
    if (!productUrl || !Number.isFinite(price)) continue;
    if (price < minPrice || price > maxPrice) continue;
    out.push({
      source: "local_price_status_fallback",
      store_key: normalizeStoreKey(product.price_basis_store_key || product.store_key || ""),
      store_name: product.price_basis_store_name || product.store_name || "",
      candidate_name:
        (product.selection_hint && product.selection_hint.candidate_name) ||
        product.candidate_name ||
        product.slug,
      product_url: productUrl,
      current_store_price_inr: price,
      rating: null,
      rating_count: null,
      availability: "listed",
      listing_rank: out.length + 1,
      launch_model_key: product.variant_group_key || null,
      launch_model_name: null,
      launch_date_iso: product.launch_date_iso || null,
      launch_sources: [],
      pre_resolved_product: product,
    });
  }
  return out;
}

function loadLocalFallbackCandidates(outDir, minPrice, maxPrice, errors) {
  const explicitFiles = [
    latestMatchingFile(outDir, /^new-launch-sellwell-.*\.json$/),
    latestMatchingFile(outDir, /^price-status-new-launch-sellwell-.*\.json$/),
    latestMatchingFile(outDir, /^price-status-active-hot-.*\.json$/),
  ].filter(Boolean);
  const out = [];
  for (const file of explicitFiles) {
    try {
      const report = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(report.shortlist)) {
        out.push(...candidatesFromNewLaunchShortlist(report, minPrice, maxPrice));
      } else if (Array.isArray(report.products)) {
        out.push(...candidatesFromPriceStatusReport(report, minPrice, maxPrice));
      }
    } catch (err) {
      errors.push(`local_fallback_failed ${file}: ${String(err.message || err)}`);
    }
  }
  return out;
}

async function collectStoreCandidates(launchModels, opts) {
  const errors = [];
  const providerStats = {
    flipkart_affiliate_api: { attempted: 0, candidates: 0, skipped: 0, errors: 0 },
    flipkart_page_scrape: { attempted: 0, candidates: 0, errors: 0 },
    local_fallback: { candidates: 0, used: false },
  };
  const candidates = [];
  const broadQueries = splitQueryList(opts.broadQueries).length
    ? splitQueryList(opts.broadQueries)
    : ["mobile phone", "5g mobile"];

  for (const query of broadQueries) {
    providerStats.flipkart_affiliate_api.attempted += 1;
    try {
      const affiliate = await fetchFlipkartAffiliateCandidates(query, {
        ...opts,
        resultCount: 10,
      });
      if (affiliate.skipped) {
        providerStats.flipkart_affiliate_api.skipped += 1;
      } else {
        providerStats.flipkart_affiliate_api.candidates += affiliate.candidates.length;
        candidates.push(...affiliate.candidates);
      }
    } catch (err) {
      providerStats.flipkart_affiliate_api.errors += 1;
      errors.push(`flipkart_affiliate ${query}: ${String(err.message || err)}`);
    }
    providerStats.flipkart_page_scrape.attempted += 1;
    const before = candidates.length;
    const errorBefore = errors.length;
    candidates.push(
      ...(await fetchFlipkartSearchCandidates(query, {
        minPrice: opts.minPrice,
        maxPrice: opts.maxPrice,
        maxPages: opts.maxBroadPages,
        sort: "popularity",
        source: "flipkart_current_popularity",
        errors,
      }))
    );
    providerStats.flipkart_page_scrape.candidates += candidates.length - before;
    providerStats.flipkart_page_scrape.errors += errors.length - errorBefore;
  }

  const launchLimit = Math.max(0, opts.maxLaunchSearches);
  const launchRows = launchModels
    .slice()
    .sort((a, b) =>
      String(b.first_launch_date_iso || "").localeCompare(String(a.first_launch_date_iso || ""))
    )
    .slice(0, launchLimit);

  for (const model of launchRows) {
    const query = normalizeModelSearchQuery(model.model_name);
    if (!query) continue;
    providerStats.flipkart_affiliate_api.attempted += 1;
    try {
      const affiliate = await fetchFlipkartAffiliateCandidates(query, {
        ...opts,
        resultCount: 10,
        launchModelKey: model.model_key || canonicalModelKey(model.model_name),
        launchModelName: model.model_name,
        launchDateIso: model.first_launch_date_iso || null,
        launchSources: model.sources || [],
      });
      if (affiliate.skipped) {
        providerStats.flipkart_affiliate_api.skipped += 1;
      } else {
        providerStats.flipkart_affiliate_api.candidates += affiliate.candidates.length;
        candidates.push(...affiliate.candidates);
      }
    } catch (err) {
      providerStats.flipkart_affiliate_api.errors += 1;
      errors.push(`flipkart_affiliate ${query}: ${String(err.message || err)}`);
    }
    providerStats.flipkart_page_scrape.attempted += 1;
    const before = candidates.length;
    const errorBefore = errors.length;
    candidates.push(
      ...(await fetchFlipkartSearchCandidates(query, {
        minPrice: opts.minPrice,
        maxPrice: opts.maxPrice,
        maxPages: opts.maxPagesPerLaunchModel,
        sort: "relevance",
        source: "flipkart_launch_model_search",
        launchModelKey: model.model_key || canonicalModelKey(model.model_name),
        launchModelName: model.model_name,
        launchDateIso: model.first_launch_date_iso || null,
        launchSources: model.sources || [],
        errors,
      }))
    );
    providerStats.flipkart_page_scrape.candidates += candidates.length - before;
    providerStats.flipkart_page_scrape.errors += errors.length - errorBefore;
  }

  const deduped = dedupeCandidates(candidates, opts.priorityMap)
    .filter((c) => !looksLikeNonPhone(c.candidate_name))
    .sort((a, b) => {
      const poolDiff =
        poolRank(classifyLaunchDate(a.launch_date_iso)) -
        poolRank(classifyLaunchDate(b.launch_date_iso));
      if (poolDiff !== 0) return poolDiff;
      if (b.sellwell_score !== a.sellwell_score) return b.sellwell_score - a.sellwell_score;
      return (Number(a.listing_rank) || 999) - (Number(b.listing_rank) || 999);
    });

  return { candidates: deduped, errors, providerStats };
}

function poolRank(pool) {
  if (pool === "high_sensitive") return 0;
  if (pool === "restock_sensitive") return 1;
  if (pool === "control") return 2;
  return 3;
}

async function getSlugFromProductUrl(productUrl) {
  const url = ensureHttpUrl(productUrl);
  if (!url) return { ok: false, error: "invalid_store_url" };
  const res = await apiPost("/api/product/history/getSlugFromUrl", { purl: url });
  if (!res.ok || !res.data || !res.data.slug) {
    return {
      ok: false,
      error:
        (res.data && res.data.detail && String(res.data.detail)) ||
        `slug_resolve_failed_http_${res.status}`,
    };
  }
  return { ok: true, slug: String(res.data.slug), country_code: res.data.country_code || null };
}

function summarizeDjangoHistory(slug, raw, candidate) {
  const historyEntries = Object.entries(raw.history || {})
    .map(([sec, price]) => ({
      timestamp_sec: Number(sec),
      timestamp_iso: timestampToIso(Number(sec)),
      price_inr: Number(price),
    }))
    .filter((item) => Number.isFinite(item.timestamp_sec) && Number.isFinite(item.price_inr))
    .sort((a, b) => a.timestamp_sec - b.timestamp_sec);

  const currentPrice = Number(raw.price);
  const currentTs = isoToSec(raw.price_fetched_at);
  const lastHistory = historyEntries[historyEntries.length - 1] || null;
  if (
    Number.isFinite(currentTs) &&
    Number.isFinite(currentPrice) &&
    (!lastHistory || lastHistory.timestamp_sec < currentTs)
  ) {
    historyEntries.push({
      timestamp_sec: currentTs,
      timestamp_iso: timestampToIso(currentTs),
      price_inr: currentPrice,
      synthetic_current: true,
    });
  }

  const events = compressEvents(historyEntries);
  const prices = historyEntries.map((entry) => entry.price_inr);
  const storeUrl = raw.url || candidate.product_url || null;
  const storeName = (raw.store && (raw.store.name || raw.store.slug)) || raw.store_name || candidate.store_name || null;

  return {
    slug,
    product_url: storeUrl,
    store_name: storeName,
    store_key: resolveStoreKey(storeName, storeUrl),
    store_product_code: raw.pid || null,
    pricehistory_page_url: `${APP_BASE}/product/${slug}`,
    price_source: "django_prixhistory",
    current_price_inr: Number.isFinite(currentPrice) ? currentPrice : candidate.current_store_price_inr,
    current_price_fetched_at: raw.price_fetched_at || null,
    first_seen_price_at: events[0] ? events[0].timestamp_iso : null,
    first_seen_price_inr: events[0] ? events[0].price_inr : null,
    lowest_price_inr: Number.isFinite(Number(raw.lowest_price))
      ? Number(raw.lowest_price)
      : prices.length ? Math.min(...prices) : null,
    highest_price_inr: Number.isFinite(Number(raw.highest_price))
      ? Number(raw.highest_price)
      : prices.length ? Math.max(...prices) : null,
    average_price_inr: Number.isFinite(Number(raw.average_price)) ? Number(raw.average_price) : null,
    price_change_events: events,
    raw_price_points: historyEntries,
    raw_point_count: historyEntries.length,
  };
}

async function fetchDjangoHistoryByUrl(candidate) {
  const slugRes = await getSlugFromProductUrl(candidate.product_url);
  if (!slugRes.ok || !slugRes.slug) {
    return { ok: false, error: slugRes.error || "slug_resolve_failed" };
  }
  const historyRes = await apiPost("/api/product/history/updateFromSlug", { slug: slugRes.slug });
  if (!historyRes.ok || !historyRes.data) {
    return { ok: false, error: `history_update_failed_http_${historyRes.status}` };
  }
  return {
    ok: true,
    product: summarizeDjangoHistory(slugRes.slug, historyRes.data, candidate),
  };
}

async function searchPriceHistoryCodeByUrl(productUrl) {
  const url = ensureHttpUrl(productUrl);
  if (!url) return { ok: false, error: "invalid_store_url" };
  const response = await fetch(`${PRICEHISTORY_APP}/api/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ url }),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = null;
  }
  if (!response.ok || !data || !data.status || !data.code) {
    return {
      ok: false,
      error:
        (data && data.message && String(data.message)) ||
        `pricehistory_search_failed_http_${response.status}`,
    };
  }
  return { ok: true, code: String(data.code), name: data.name ? String(data.name) : null };
}

function decodePriceHistoryPageDataset(html) {
  const source = String(html || "");
  const keyMatch = source.match(/let\s+CachedKey\s*=\s*'([^']+)'/);
  const dsMatch = source.match(/var\s+PagePriceHistoryDataSet\s*=\s*\"([^\"]+)\"/);
  if (!keyMatch || !dsMatch) return null;
  const key = keyMatch[1];
  let bin = "";
  try {
    bin = Buffer.from(dsMatch[1], "base64").toString("binary");
  } catch (err) {
    return null;
  }
  let decrypted = "";
  for (let i = 0; i < bin.length; i += 1) {
    decrypted += String.fromCharCode(
      bin.charCodeAt(i) ^ key.charCodeAt(i % key.length)
    );
  }
  try {
    return JSON.parse(decrypted);
  } catch (err) {
    return null;
  }
}

function toIndiaIso(value) {
  const text = normalizeSpace(value);
  if (!text) return null;
  const normalized = text.replace(" ", "T");
  const ms = Date.parse(`${normalized}+05:30`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function pageHistoryProduct(code, pageUrl, data, candidate) {
  const rawPoints =
    data.History && Array.isArray(data.History.Price) ? data.History.Price : [];
  const points = rawPoints
    .map((point) => {
      const day = normalizeSpace(point && point.x);
      const price = Number(point && point.y);
      const ms = Date.parse(`${day}T00:00:00Z`);
      if (!day || !Number.isFinite(price) || Number.isNaN(ms)) return null;
      return {
        timestamp_sec: Math.floor(ms / 1000),
        timestamp_iso: new Date(ms).toISOString(),
        price_inr: price,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp_sec - b.timestamp_sec);
  const currentFetchedAt = toIndiaIso(data.Price && data.Price.UpdatedOn);
  const currentPrice = Number(data.Price && data.Price.Price);
  if (points.length && currentFetchedAt && Number.isFinite(currentPrice)) {
    const fetchedSec = isoToSec(currentFetchedAt);
    const last = points[points.length - 1];
    if (Number.isFinite(fetchedSec) && fetchedSec > last.timestamp_sec) {
      points.push({
        timestamp_sec: fetchedSec,
        timestamp_iso: timestampToIso(fetchedSec),
        price_inr: currentPrice,
        synthetic_current: true,
      });
    }
  }

  const events = compressEvents(points);
  const prices = points.map((p) => p.price_inr);
  const title =
    normalizeSpace((data.Main && data.Main.ProductName) || candidate.candidate_name) ||
    code;
  const storeKey = resolveStoreKey(candidate.store_name, candidate.product_url);
  return {
    slug: code,
    product_url: candidate.product_url,
    store_name: candidate.store_name,
    store_key: storeKey,
    store_product_code: (data.Main && data.Main.ListingId) || null,
    pricehistory_page_url: pageUrl,
    price_source: "pricehistory_app",
    current_price_inr: Number.isFinite(currentPrice) ? currentPrice : candidate.current_store_price_inr,
    current_price_fetched_at: currentFetchedAt,
    first_seen_price_at: events[0] ? events[0].timestamp_iso : null,
    first_seen_price_inr: events[0] ? events[0].price_inr : null,
    lowest_price_inr: prices.length ? Math.min(...prices) : null,
    highest_price_inr: prices.length ? Math.max(...prices) : null,
    average_price_inr: prices.length
      ? Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length)
      : null,
    price_change_events: events,
    raw_price_points: points,
    raw_point_count: points.length,
    fallback_title: title,
  };
}

async function fetchPriceHistoryAppByUrl(candidate) {
  const searchRes = await searchPriceHistoryCodeByUrl(candidate.product_url);
  if (!searchRes.ok || !searchRes.code) {
    return { ok: false, error: searchRes.error || "pricehistory_app_search_failed" };
  }
  const pageUrl = `${PRICEHISTORY_APP}/p/${encodeURIComponent(searchRes.code)}`;
  const html = await fetchText(pageUrl);
  const data = decodePriceHistoryPageDataset(html);
  if (!data || !data.Price) {
    return { ok: false, error: "pricehistory_app_dataset_missing" };
  }
  return {
    ok: true,
    product: pageHistoryProduct(searchRes.code, pageUrl, data, candidate),
  };
}

function compressEvents(points) {
  const out = [];
  for (const point of points || []) {
    const price = Number(point.price_inr);
    const ts = Number(point.timestamp_sec);
    if (!Number.isFinite(price) || !Number.isFinite(ts)) continue;
    const prev = out[out.length - 1];
    if (!prev || prev.price_inr !== price) {
      out.push({
        timestamp_sec: ts,
        timestamp_iso: point.timestamp_iso || timestampToIso(ts),
        price_inr: price,
      });
    }
  }
  return out;
}

async function resolvePriceHistory(candidate) {
  if (candidate && candidate.pre_resolved_product) {
    return {
      ok: true,
      product: {
        ...candidate.pre_resolved_product,
        price_source:
          candidate.pre_resolved_product.price_source || "local_price_status_report",
      },
    };
  }
  const django = await fetchDjangoHistoryByUrl(candidate);
  if (django.ok) {
    return django;
  }
  const app = await fetchPriceHistoryAppByUrl(candidate);
  if (app.ok) {
    app.product.resolve_warning = django.error || null;
    return app;
  }
  return {
    ok: false,
    error: `${candidate.candidate_name}: ${django.error}; ${app.error}`,
  };
}

function mergeCandidateContext(product, candidate) {
  const title = normalizeSpace(
    candidate.candidate_name || product.fallback_title || product.slug
  );
  const variantLabel = extractVariantSignature(title, `${product.slug} ${product.product_url}`);
  const groupKey =
    candidate.launch_model_key ||
    modelGroupKeyFromTitle(candidate.launch_model_name || title) ||
    modelGroupKeyFromTitle(product.slug);
  const launchDateIso = candidate.launch_date_iso || null;
  return {
    ...product,
    candidate_name: title,
    current_store_price_inr: candidate.current_store_price_inr,
    listing_rank: candidate.listing_rank || null,
    rating: candidate.rating,
    rating_count: candidate.rating_count,
    sellwell_score: candidate.sellwell_score,
    availability: candidate.availability,
    source: candidate.source,
    launch_model_name: candidate.launch_model_name || null,
    launch_date_iso: launchDateIso,
    launch_sources: candidate.launch_sources || [],
    sensitivity_pool: classifyLaunchDate(launchDateIso),
    variant_group_key: groupKey,
    variant_label: variantLabel,
    sku_status: skuStatus(variantLabel),
  };
}

function consolidateBySku(products, priorityMap) {
  const bySku = new Map();
  for (const product of products) {
    const key = [
      product.variant_group_key || product.slug,
      product.store_key || "",
      product.variant_label || "STD",
    ].join("::");
    const list = bySku.get(key) || [];
    list.push(product);
    bySku.set(key, list);
  }

  return Array.from(bySku.values()).map((list) => {
    const primary = list
      .slice()
      .sort((a, b) => {
        const storeDiff =
          storePriorityRank(a.store_key, priorityMap) -
          storePriorityRank(b.store_key, priorityMap);
        if (storeDiff !== 0) return storeDiff;
        const fetchedDiff =
          (isoToSec(b.current_price_fetched_at) || 0) -
          (isoToSec(a.current_price_fetched_at) || 0);
        if (fetchedDiff !== 0) return fetchedDiff;
        return (Number(b.sellwell_score) || 0) - (Number(a.sellwell_score) || 0);
      })[0];
    return {
      ...primary,
      merged_color_variant_count: list.length,
      merged_pricehistory_pages: dedupeStrings(
        list.map((item) => item.pricehistory_page_url).filter(Boolean)
      ),
      merged_candidate_names: dedupeStrings(
        list.map((item) => item.candidate_name).filter(Boolean)
      ),
    };
  });
}

function eventAtOrBefore(events, sec) {
  return (events || []).filter((event) => event.timestamp_sec <= sec).pop() || null;
}

function lastObservationSec(product) {
  const fetched = isoToSec(product.current_price_fetched_at);
  if (Number.isFinite(fetched)) return fetched;
  const events = product.price_change_events || [];
  return events.length ? events[events.length - 1].timestamp_sec : null;
}

function analyzeMemoryImpact(product, opts) {
  const impactSec = dateToSec(opts.impactStart);
  const events = (product.price_change_events || [])
    .filter((event) => Number.isFinite(event.timestamp_sec) && Number.isFinite(event.price_inr))
    .sort((a, b) => a.timestamp_sec - b.timestamp_sec);
  const observationSec = lastObservationSec(product);
  const staleAfterDays = opts.staleAfterDays;
  const generatedSec = isoToSec(opts.generatedAt);
  const lastRealEvent = events[events.length - 1] || null;
  const dataAgeDays =
    Number.isFinite(observationSec) && Number.isFinite(generatedSec)
      ? Math.floor((generatedSec - observationSec) / 86400)
      : null;
  const staleHistory = Number.isFinite(dataAgeDays) && dataAgeDays > staleAfterDays;

  if (!events.length || !Number.isFinite(impactSec)) {
    return {
      status: "insufficient_history",
      confidence: "low",
      stale_history: staleHistory,
      data_age_days: dataAgeDays,
      impact_start: opts.impactStart,
    };
  }

  const baseline = eventAtOrBefore(events, impactSec) || events[0];
  const inside = events.filter((event) => event.timestamp_sec >= impactSec);
  const transitions = [];
  let prev = baseline;
  for (const cur of inside) {
    if (!prev || cur.timestamp_sec === prev.timestamp_sec) {
      prev = cur;
      continue;
    }
    const delta = cur.price_inr - prev.price_inr;
    const deltaPct = prev.price_inr ? (delta / prev.price_inr) * 100 : null;
    transitions.push({
      timestamp_sec: cur.timestamp_sec,
      timestamp_iso: cur.timestamp_iso,
      from_price_inr: prev.price_inr,
      to_price_inr: cur.price_inr,
      delta_inr: delta,
      delta_pct: deltaPct,
    });
    prev = cur;
  }

  const increases = transitions.filter((t) => t.delta_inr > 0);
  const significantIncreases = increases.filter(
    (t) =>
      t.delta_inr >= opts.minIncreaseInr &&
      Number.isFinite(t.delta_pct) &&
      t.delta_pct >= opts.minIncreasePct
  );
  const firstSignificant = significantIncreases[0] || null;
  const currentPrice = Number(product.current_price_inr);
  const currentVsBaseline = Number.isFinite(currentPrice)
    ? currentPrice - baseline.price_inr
    : null;
  const currentVsBaselinePct =
    Number.isFinite(currentVsBaseline) && baseline.price_inr
      ? (currentVsBaseline / baseline.price_inr) * 100
      : null;

  let sustainedDays = null;
  if (firstSignificant) {
    const nextLower = transitions.find(
      (t) =>
        t.timestamp_sec > firstSignificant.timestamp_sec &&
        t.to_price_inr < firstSignificant.to_price_inr
    );
    const endSec =
      nextLower && nextLower.timestamp_sec
        ? nextLower.timestamp_sec
        : Number.isFinite(observationSec)
          ? observationSec
          : lastRealEvent.timestamp_sec;
    sustainedDays = Math.max(
      0,
      Math.floor((endSec - firstSignificant.timestamp_sec) / 86400)
    );
  }

  let status = "no_increase_detected";
  let confidence = staleHistory ? "low" : "medium";
  if (firstSignificant) {
    status =
      Number.isFinite(sustainedDays) && sustainedDays >= opts.minSustainDays
        ? "sustained_increase"
        : "possible_increase";
    confidence =
      status === "sustained_increase" && !staleHistory ? "high" : "medium";
  } else if (Number.isFinite(currentVsBaseline) && currentVsBaseline > 0) {
    status = "current_above_baseline";
  }
  if (staleHistory) {
    status = `${status}_stale`;
  }

  return {
    status,
    confidence,
    impact_start: opts.impactStart,
    baseline_price_inr: baseline.price_inr,
    baseline_at: baseline.timestamp_iso,
    current_price_inr: Number.isFinite(currentPrice) ? currentPrice : null,
    current_vs_baseline_inr: currentVsBaseline,
    current_vs_baseline_pct: currentVsBaselinePct,
    first_significant_increase_at: firstSignificant ? firstSignificant.timestamp_iso : null,
    first_significant_increase_delta_inr: firstSignificant
      ? firstSignificant.delta_inr
      : null,
    first_significant_increase_delta_pct: firstSignificant
      ? firstSignificant.delta_pct
      : null,
    sustained_days: sustainedDays,
    increase_event_count: increases.length,
    significant_increase_count: significantIncreases.length,
    stale_history: staleHistory,
    data_age_days: dataAgeDays,
    last_observed_at: Number.isFinite(observationSec)
      ? timestampToIso(observationSec)
      : null,
    recent_transitions: transitions.slice(-8),
  };
}

function buildSummary(products) {
  const summary = {
    products: products.length,
    sustained_increase: 0,
    possible_increase: 0,
    current_above_baseline: 0,
    no_increase_detected: 0,
    stale_history: 0,
    sku_needs_review: 0,
    high_sensitive: 0,
    restock_sensitive: 0,
    control: 0,
    control_or_unknown: 0,
  };
  for (const product of products) {
    const status = String(product.memory_analysis && product.memory_analysis.status || "");
    if (status.includes("sustained_increase")) summary.sustained_increase += 1;
    else if (status.includes("possible_increase")) summary.possible_increase += 1;
    else if (status.includes("current_above_baseline")) summary.current_above_baseline += 1;
    else if (status.includes("no_increase_detected")) summary.no_increase_detected += 1;
    if (product.memory_analysis && product.memory_analysis.stale_history) {
      summary.stale_history += 1;
    }
    if (product.sku_status && product.sku_status !== "confirmed") {
      summary.sku_needs_review += 1;
    }
    if (summary[product.sensitivity_pool] !== undefined) {
      summary[product.sensitivity_pool] += 1;
    }
  }
  return summary;
}

function providerLiveCandidateCount(providerStats) {
  return Object.entries(providerStats || {})
    .filter(([name]) => name !== "local_fallback")
    .reduce((sum, [, stats]) => sum + (Number(stats && stats.candidates) || 0), 0);
}

function buildDataHealth(report) {
  const providerStats = (report.stats && report.stats.provider_stats) || {};
  const liveCandidates = providerLiveCandidateCount(providerStats);
  const fallbackUsed = Boolean(providerStats.local_fallback && providerStats.local_fallback.used);
  const products = Number(report.stats && report.stats.products) || 0;
  const staleHistories = Number(report.summary && report.summary.stale_history) || 0;
  const allStale = products > 0 && staleHistories === products;
  const blockers = [];

  if (products <= 0) {
    blockers.push("No resolved products made it into the report.");
  }
  if (liveCandidates <= 0) {
    blockers.push("No live current-store candidates were collected.");
  }
  if (fallbackUsed) {
    blockers.push("Local fallback candidates were used, so ranking is watchlist context rather than current top sellers.");
  }
  if (allStale) {
    blockers.push("All price histories are stale against the configured freshness threshold.");
  }
  if (Number(report.summary && report.summary.sku_needs_review) > 0) {
    blockers.push("Some SKUs have unknown RAM/storage and need manual review.");
  }

  let status = "healthy";
  if (products <= 0) {
    status = "failed";
  } else if (liveCandidates <= 0 || fallbackUsed || allStale) {
    status = "degraded";
  }

  return {
    status,
    label:
      status === "healthy"
        ? "Healthy"
        : status === "degraded"
          ? "Degraded"
          : "Failed",
    official_top10: status === "healthy",
    live_current_store_candidates: liveCandidates,
    fallback_used: fallbackUsed,
    all_histories_stale: allStale,
    blockers,
  };
}

function statusClassName(status, staleHistory) {
  const value = String(status || "");
  if (staleHistory) return "stale";
  if (value.includes("sustained_increase") || value.includes("possible_increase")) return "risk";
  if (value.includes("current_above_baseline")) return "watch";
  if (value.includes("insufficient")) return "stale";
  return "ok";
}

function statusLabel(status) {
  const value = String(status || "");
  if (value.includes("sustained_increase")) return "Sustained increase";
  if (value.includes("possible_increase")) return "Possible increase";
  if (value.includes("current_above_baseline")) return "Above baseline";
  if (value.includes("no_increase_detected")) return "No increase";
  if (value.includes("insufficient")) return "Insufficient history";
  return value || "-";
}

function strategyNote(product) {
  const analysis = product.memory_analysis || {};
  if (analysis.stale_history) {
    return "History source is stale; use this row as watchlist context, not as current pricing evidence.";
  }
  if (String(analysis.status || "").includes("sustained_increase")) {
    if (product.sensitivity_pool === "high_sensitive") {
      return "Likely launch-price or early-cycle cost pass-through candidate.";
    }
    if (product.sensitivity_pool === "restock_sensitive") {
      return "Likely restock-cycle cost pass-through candidate if inventory remains active.";
    }
    return "Potential channel or lifecycle repricing; validate against availability and seller changes.";
  }
  if (String(analysis.status || "").includes("possible_increase")) {
    return "Monitor for persistence; current evidence may still be promotion or seller volatility.";
  }
  return "No clear memory-cost pass-through signal in the observation window.";
}

function expandToStepEvents(events) {
  if (!Array.isArray(events) || events.length <= 1) return Array.isArray(events) ? events : [];
  const out = [events[0]];
  for (let i = 1; i < events.length; i += 1) {
    const prev = events[i - 1];
    const cur = events[i];
    out.push({
      timestamp_sec: cur.timestamp_sec,
      timestamp_iso: cur.timestamp_iso,
      price_inr: prev.price_inr,
    });
    out.push(cur);
  }
  return out;
}

function observedPriceEvents(product, events) {
  const valid = (events || [])
    .filter((e) => Number.isFinite(e.timestamp_sec) && Number.isFinite(e.price_inr))
    .sort((a, b) => a.timestamp_sec - b.timestamp_sec);
  if (!valid.length) return valid;
  const observationSec = lastObservationSec(product);
  const last = valid[valid.length - 1];
  if (Number.isFinite(observationSec) && observationSec > last.timestamp_sec) {
    return [
      ...valid,
      {
        timestamp_sec: observationSec,
        timestamp_iso: timestampToIso(observationSec),
        price_inr: last.price_inr,
        synthetic_observation: true,
      },
    ];
  }
  return valid;
}

function chartSvg(events, opts) {
  const w = 960;
  const h = opts.height || 250;
  const p = { l: 72, r: 24, t: 20, b: 34 };
  const valid = (events || [])
    .filter((e) => Number.isFinite(e.timestamp_sec) && Number.isFinite(e.price_inr))
    .sort((a, b) => a.timestamp_sec - b.timestamp_sec);
  if (!valid.length) {
    return `<svg viewBox="0 0 ${w} ${h}" role="img"><text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#64748b" font-size="13">No price history</text></svg>`;
  }
  const xs = valid.map((e) => e.timestamp_sec);
  const ys = valid.map((e) => e.price_inr);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minYRaw = Math.min(...ys);
  const maxYRaw = Math.max(...ys);
  const flatPrice = minYRaw === maxYRaw;
  const spanY = flatPrice
    ? Math.max(1000, Math.round(minYRaw * 0.02))
    : Math.max(1, maxYRaw - minYRaw);
  const minY = minYRaw - spanY * 0.08;
  const maxY = maxYRaw + spanY * 0.08;
  const xRange = Math.max(1, maxX - minX);
  const yRange = Math.max(1, maxY - minY);
  const innerW = w - p.l - p.r;
  const innerH = h - p.t - p.b;
  const xMap = (x) => p.l + ((x - minX) / xRange) * innerW;
  const yMap = (y) => p.t + (1 - (y - minY) / yRange) * innerH;
  const line = expandToStepEvents(valid)
    .map((e) => `${xMap(e.timestamp_sec).toFixed(2)},${yMap(e.price_inr).toFixed(2)}`)
    .join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = p.t + t * innerH;
    const value = maxY - t * yRange;
    return `<line x1="${p.l}" y1="${y.toFixed(2)}" x2="${w - p.r}" y2="${y.toFixed(2)}" stroke="#e2e8f0"/>
<text x="${p.l - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="#64748b" font-size="11">${escapeHtml(fmtInr(value))}</text>`;
  });
  const markerSec = opts.markerSec;
  const marker = Number.isFinite(markerSec) && markerSec >= minX && markerSec <= maxX
    ? `<line x1="${xMap(markerSec).toFixed(2)}" y1="${p.t}" x2="${xMap(markerSec).toFixed(2)}" y2="${h - p.b}" stroke="#dc2626" stroke-dasharray="4 4"/><text x="${xMap(markerSec).toFixed(2)}" y="${p.t + 12}" text-anchor="middle" fill="#dc2626" font-size="10">impact start</text>`
    : "";
  const labels = [valid[0], valid[Math.floor(valid.length / 2)], valid[valid.length - 1]]
    .filter(Boolean)
    .filter((event, idx, arr) =>
      arr.findIndex((candidate) => candidate.timestamp_sec === event.timestamp_sec) === idx
    )
    .map((e) => `<text x="${xMap(e.timestamp_sec).toFixed(2)}" y="${h - 10}" text-anchor="middle" fill="#64748b" font-size="10">${escapeHtml(fmtDate(e.timestamp_iso))}</text>`)
    .join("");
  const flatNote = flatPrice
    ? `<text x="${w - p.r}" y="${p.t + 14}" text-anchor="end" fill="#64748b" font-size="11">flat observed price</text>`
    : "";
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(opts.label || "Price chart")}">
<rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/>
${ticks.join("")}
${marker}
<line x1="${p.l}" y1="${h - p.b}" x2="${w - p.r}" y2="${h - p.b}" stroke="#cbd5e1"/>
<polyline fill="none" stroke="${opts.color || "#2563eb"}" stroke-width="2.4" points="${line}"/>
${flatNote}
${labels}
</svg>`;
}

function impactEvents(product, impactStart) {
  const impactSec = dateToSec(impactStart);
  const events = product.price_change_events || [];
  if (!Number.isFinite(impactSec)) return events;
  const before = eventAtOrBefore(events, impactSec);
  const inside = events.filter((event) => event.timestamp_sec >= impactSec);
  const out = [];
  if (before) {
    out.push({
      timestamp_sec: impactSec,
      timestamp_iso: timestampToIso(impactSec),
      price_inr: before.price_inr,
    });
  }
  out.push(...inside);
  return compressEvents(out);
}

function renderProductCard(product, idx, report) {
  const analysis = product.memory_analysis || {};
  const impact = observedPriceEvents(product, impactEvents(product, report.input.impact_start));
  const full = observedPriceEvents(product, product.price_change_events || []);
  const status = statusLabel(analysis.status);
  const statusClass = statusClassName(analysis.status, analysis.stale_history);
  const displayName = displayProductName(product);
  const sku = displaySku(product);
  const rawName = normalizeSpace(product.candidate_name || product.slug);
  const recentRows = (analysis.recent_transitions || [])
    .map((t) => `<tr>
<td>${escapeHtml(fmtDate(t.timestamp_iso))}</td>
<td>${escapeHtml(fmtInr(t.from_price_inr))}</td>
<td>${escapeHtml(fmtInr(t.to_price_inr))}</td>
<td>${escapeHtml(fmtInr(t.delta_inr))}</td>
<td>${escapeHtml(fmtPct(t.delta_pct))}</td>
</tr>`)
    .join("");
  return `<section class="card">
<div class="card-head">
  <div>
    <h2 title="${escapeHtml(rawName)}">${idx + 1}. ${escapeHtml(displayName)}</h2>
    <p>${escapeHtml(product.sensitivity_pool)} | ${escapeHtml(sku)} | SKU ${escapeHtml(skuStatusLabel(product.sku_status))} | ${escapeHtml(product.store_name || product.store_key || "-")}</p>
  </div>
  <span class="status ${statusClass}">${escapeHtml(status)}</span>
</div>
<div class="metrics">
  <div><span>Current</span><strong>${escapeHtml(fmtInr(product.current_price_inr))}</strong></div>
  <div><span>Baseline</span><strong>${escapeHtml(fmtInr(analysis.baseline_price_inr))}</strong></div>
  <div><span>Current vs Baseline</span><strong>${escapeHtml(fmtInr(analysis.current_vs_baseline_inr))} (${escapeHtml(fmtPct(analysis.current_vs_baseline_pct))})</strong></div>
  <div><span>First Increase</span><strong>${escapeHtml(fmtDate(analysis.first_significant_increase_at))}</strong></div>
  <div><span>Sustained Days</span><strong>${Number.isFinite(analysis.sustained_days) ? analysis.sustained_days : "-"}</strong></div>
  <div><span>Data Age</span><strong>${Number.isFinite(analysis.data_age_days) ? `${analysis.data_age_days}d` : "-"}</strong></div>
</div>
<p class="note">${escapeHtml(strategyNote(product))}</p>
<div class="charts">
  <div>
    <h3>Impact View Since ${escapeHtml(report.input.impact_start)}</h3>
    <div class="chart">${chartSvg(impact, { label: "Impact view", markerSec: dateToSec(report.input.impact_start), color: "#dc2626" })}</div>
  </div>
  <div>
    <h3>Full Lifecycle</h3>
    <div class="chart">${chartSvg(full, { label: "Full lifecycle", markerSec: dateToSec(report.input.impact_start), color: "#2563eb" })}</div>
  </div>
</div>
<div class="meta">
  <span>Launch: ${escapeHtml(fmtDate(product.launch_date_iso))}</span>
  <span>First seen: ${escapeHtml(fmtDate(product.first_seen_price_at))}</span>
  <span>Lowest: ${escapeHtml(fmtInr(product.lowest_price_inr))}</span>
  <span>Highest: ${escapeHtml(fmtInr(product.highest_price_inr))}</span>
  <span>History source: ${escapeHtml(product.price_source || "-")}</span>
  <span>Colors merged: ${escapeHtml(String(product.merged_color_variant_count || 1))}</span>
  <a href="${escapeHtml(product.product_url || "#")}" target="_blank" rel="noreferrer">Store link</a>
  <a href="${escapeHtml(product.pricehistory_page_url || "#")}" target="_blank" rel="noreferrer">Price history</a>
</div>
${recentRows ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>From</th><th>To</th><th>Delta</th><th>Delta %</th></tr></thead><tbody>${recentRows}</tbody></table></div>` : ""}
</section>`;
}

function renderHtml(report) {
  const products = report.products || [];
  const summary = report.summary || {};
  const dataHealth = report.data_health || buildDataHealth(report);
  const providers = (report.stats && report.stats.provider_stats) || {};
  const providerRows = Object.entries(providers)
    .map(([name, stats]) => `<tr>
<td>${escapeHtml(name)}</td>
<td>${escapeHtml(String(stats.attempted ?? "-"))}</td>
<td>${escapeHtml(String(stats.candidates ?? 0))}</td>
<td>${escapeHtml(String(stats.skipped ?? "-"))}</td>
<td>${escapeHtml(String(stats.errors ?? "-"))}</td>
<td>${escapeHtml(String(stats.used ?? "-"))}</td>
</tr>`)
    .join("");
  const rows = products
    .map((product) => {
      const a = product.memory_analysis || {};
      return `<tr>
<td title="${escapeHtml(product.candidate_name || product.slug)}">${escapeHtml(displayProductName(product))}</td>
<td>${escapeHtml(product.sensitivity_pool || "-")}</td>
<td>${escapeHtml(displaySku(product))}</td>
<td>${escapeHtml(skuStatusLabel(product.sku_status))}</td>
<td>${escapeHtml(statusLabel(a.status))}</td>
<td>${escapeHtml(fmtInr(product.current_price_inr))}</td>
<td>${escapeHtml(fmtInr(a.baseline_price_inr))}</td>
<td>${escapeHtml(fmtInr(a.current_vs_baseline_inr))}</td>
<td>${escapeHtml(fmtDate(a.first_significant_increase_at))}</td>
<td>${Number.isFinite(a.sustained_days) ? a.sustained_days : "-"}</td>
<td>${a.stale_history ? "yes" : "no"}</td>
</tr>`;
    })
    .join("");
  const healthClass = `health-${String(dataHealth.status || "failed")}`;
  const blockerRows = (dataHealth.blockers || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const errorRows = (report.errors || [])
    .slice(0, 8)
    .map((err) => `<li>${escapeHtml(err)}</li>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Memory Cost Pass-through Report</title>
<style>
:root{--bg:#f6f8fb;--card:#fff;--text:#111827;--muted:#64748b;--border:#dbe3ef;--blue:#2563eb;--red:#dc2626;--green:#047857;--amber:#b45309}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif}
.page{max-width:1260px;margin:24px auto;padding:0 16px}
.top,.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:14px}
h1{margin:0 0 8px;font-size:26px} h2{margin:0;font-size:20px;line-height:1.25} h3{margin:14px 0 8px;font-size:15px}
p{margin:4px 0;color:var(--muted)}
.summary{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px;margin-top:12px}
.summary div,.metrics div{border:1px solid var(--border);background:#f8fafc;border-radius:8px;padding:10px}
.summary span,.metrics span{display:block;color:var(--muted);font-size:12px}.summary strong,.metrics strong{display:block;font-size:18px;margin-top:4px}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.status{white-space:nowrap;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:700;background:#eef2ff;color:#3730a3}
.status.risk{background:#fee2e2;color:#991b1b}.status.ok{background:#dcfce7;color:#166534}.status.stale{background:#fef3c7;color:#92400e}.status.watch{background:#ffedd5;color:#9a3412}
.health{display:grid;grid-template-columns:minmax(190px,260px) 1fr;gap:12px;margin-top:12px;border:1px solid var(--border);border-radius:8px;padding:12px;background:#f8fafc}
.health strong{display:block;font-size:22px}.health span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.health-healthy{border-color:#bbf7d0;background:#f0fdf4}.health-degraded{border-color:#fde68a;background:#fffbeb}.health-failed{border-color:#fecaca;background:#fef2f2}
.health ul{margin:6px 0 0 18px;padding:0;color:#334155}.health li{margin:3px 0}
.metrics{display:grid;grid-template-columns:repeat(6,minmax(130px,1fr));gap:8px;margin-top:12px}
.note{color:#334155;background:#f8fafc;border-left:3px solid var(--blue);padding:8px 10px;margin-top:10px}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.chart{border:1px solid var(--border);border-radius:8px;overflow:auto;background:#fff}.chart svg{display:block;width:100%;min-width:720px;height:auto}
.meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;color:var(--muted);font-size:13px}.meta a{color:var(--blue);text-decoration:none}
.table-wrap{margin-top:10px;max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:8px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px;border-bottom:1px solid #edf2f7;text-align:left;white-space:nowrap}thead th{position:sticky;top:0;background:#f8fafc}
@media (max-width:980px){.summary,.metrics,.charts{grid-template-columns:1fr 1fr}}@media (max-width:640px){.summary,.metrics,.charts{grid-template-columns:1fr}.card-head{display:block}}
</style>
</head>
<body>
<main class="page">
<section class="top">
  <h1>Memory Cost Pass-through Report</h1>
  <p>Generated: ${escapeHtml(report.generated_at)} | Impact start: ${escapeHtml(report.input.impact_start)} | Range: INR ${escapeHtml(report.input.min_price)}-${escapeHtml(report.input.max_price)}</p>
  <p>Store source: Flipkart current candidates first; Pricehistory is used only for historical price lookup.</p>
  <div class="health ${healthClass}">
    <div>
      <span>Data Health</span>
      <strong>${escapeHtml(dataHealth.label)}</strong>
      <p>${dataHealth.official_top10 ? "Official current top10 view" : "Watchlist context, not an official current top10"}</p>
    </div>
    <div>
      <p>Live current-store candidates: ${escapeHtml(String(dataHealth.live_current_store_candidates || 0))} | Local fallback used: ${dataHealth.fallback_used ? "yes" : "no"}</p>
      ${blockerRows ? `<ul>${blockerRows}</ul>` : ""}
      ${errorRows ? `<details><summary>Errors and warnings</summary><ul>${errorRows}</ul></details>` : ""}
    </div>
  </div>
  <div class="summary">
    <div><span>Products</span><strong>${summary.products || 0}</strong></div>
    <div><span>Sustained increases</span><strong>${summary.sustained_increase || 0}</strong></div>
    <div><span>Possible increases</span><strong>${summary.possible_increase || 0}</strong></div>
    <div><span>Above baseline</span><strong>${summary.current_above_baseline || 0}</strong></div>
    <div><span>No increase</span><strong>${summary.no_increase_detected || 0}</strong></div>
    <div><span>Stale histories</span><strong>${summary.stale_history || 0}</strong></div>
    <div><span>SKU review</span><strong>${summary.sku_needs_review || 0}</strong></div>
  </div>
</section>
<section class="card">
  <h2>${dataHealth.official_top10 ? "Current Top Watchlist" : "Fallback Watchlist"}</h2>
  <div class="table-wrap"><table><thead><tr><th>Model</th><th>Pool</th><th>SKU</th><th>SKU Quality</th><th>Status</th><th>Current</th><th>Baseline</th><th>Delta</th><th>First increase</th><th>Sustained days</th><th>Stale</th></tr></thead><tbody>${rows}</tbody></table></div>
</section>
<section class="card">
  <h2>Candidate Providers</h2>
  <div class="table-wrap"><table><thead><tr><th>Provider</th><th>Attempted</th><th>Candidates</th><th>Skipped</th><th>Errors</th><th>Used</th></tr></thead><tbody>${providerRows}</tbody></table></div>
</section>
${products.map((product, idx) => renderProductCard(product, idx, report)).join("\n")}
</main>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv);
  const rootDir = path.resolve(__dirname, "..");
  loadEnvFile(path.join(rootDir, ".env"));
  if (args.envFile) {
    loadEnvFile(path.resolve(String(args.envFile)));
  }
  const outDir = args.outDir ? path.resolve(String(args.outDir)) : path.join(rootDir, "00_Inbox");
  fs.mkdirSync(outDir, { recursive: true });

  const minPrice = Number(args.minPrice || 20000);
  const maxPrice = Number(args.maxPrice || 50000);
  const topN = Number(args.topN || 10);
  const tag = String(
    args.tag || `${todayTag()}-memory-cost-${minPrice / 1000}k-${maxPrice / 1000}k`
  );
  const impactStart = String(args.impactStart || DEFAULT_IMPACT_START).slice(0, 10);
  const stores = dedupeStrings(
    (splitTokenList(String(args.stores || "")).length
      ? splitTokenList(String(args.stores || ""))
      : DEFAULT_STORES
    )
      .map((s) => normalizeStoreKey(s))
      .filter(Boolean)
  );
  const preferStores = dedupeStrings(
    (splitTokenList(String(args.preferStores || "")).length
      ? splitTokenList(String(args.preferStores || ""))
      : DEFAULT_PREFER_STORES
    )
      .map((s) => normalizeStoreKey(s))
      .filter(Boolean)
  );
  const priorityMap = buildStorePriorityMap(preferStores);

  const jsonOut = path.join(outDir, `memory-cost-pass-through-${tag}.json`);
  const htmlOut = path.join(outDir, `memory-cost-pass-through-${tag}.html`);

  const launchPool = loadOrBuildLaunchPool(rootDir, outDir, args, tag);
  const launchModels = modelLaunchRows(launchPool.source);

  const store = await collectStoreCandidates(launchModels, {
    minPrice,
    maxPrice,
    maxBroadPages: Number(args.maxBroadPages || 1),
    maxLaunchSearches: Number(args.maxLaunchSearches || 8),
    maxPagesPerLaunchModel: Number(args.maxPagesPerLaunchModel || 1),
    broadQueries: String(args.broadQueries || "mobile phone|5g mobile"),
    priorityMap,
    disableAffiliate: args.disableAffiliate === true || args.disableAffiliate === "true",
  });

  const errors = [...store.errors];
  if (launchPool.error) {
    errors.push(`launch_pool_unavailable: ${launchPool.error}`);
  }
  if (
    store.candidates.length === 0 &&
    args.allowLocalFallback !== false &&
    args.allowLocalFallback !== "false"
  ) {
    const fallbackCandidates = loadLocalFallbackCandidates(outDir, minPrice, maxPrice, errors);
    if (fallbackCandidates.length) {
      store.candidates = dedupeCandidates(fallbackCandidates, priorityMap);
      store.providerStats.local_fallback.used = true;
      store.providerStats.local_fallback.candidates = store.candidates.length;
      errors.push(
        `store_candidate_fallback_used: current Flipkart fetch returned zero candidates; loaded ${store.candidates.length} local fallback candidates`
      );
    }
  }
  const candidateBudget = Math.max(topN * 4, Number(args.candidateBudget || topN * 4));
  const products = [];
  for (const candidate of store.candidates.slice(0, candidateBudget)) {
    if (products.length >= topN * 2) break;
    if (!stores.includes(candidate.store_key)) continue;
    try {
      const resolved = await resolvePriceHistory(candidate);
      if (!resolved.ok) {
        errors.push(resolved.error);
        continue;
      }
      const product = mergeCandidateContext(resolved.product, candidate);
      if (
        Number.isFinite(Number(product.current_price_inr)) &&
        (Number(product.current_price_inr) < minPrice ||
          Number(product.current_price_inr) > maxPrice)
      ) {
        continue;
      }
      products.push(product);
    } catch (err) {
      errors.push(`${candidate.candidate_name}: ${String(err.message || err)}`);
    }
  }

  const consolidated = consolidateBySku(products, priorityMap)
    .map((product) => ({
      ...product,
      memory_analysis: analyzeMemoryImpact(product, {
        impactStart,
        generatedAt: new Date().toISOString(),
        minIncreaseInr: Number(args.minIncreaseInr || 500),
        minIncreasePct: Number(args.minIncreasePct || 2),
        minSustainDays: Number(args.minSustainDays || 7),
        staleAfterDays: Number(args.staleAfterDays || 45),
      }),
    }))
    .sort((a, b) => {
      const statusDiff =
        statusRank(a.memory_analysis && a.memory_analysis.status) -
        statusRank(b.memory_analysis && b.memory_analysis.status);
      if (statusDiff !== 0) return statusDiff;
      const poolDiff = poolRank(a.sensitivity_pool) - poolRank(b.sensitivity_pool);
      if (poolDiff !== 0) return poolDiff;
      const skuDiff = skuStatusRank(a.sku_status) - skuStatusRank(b.sku_status);
      if (skuDiff !== 0) return skuDiff;
      return (Number(b.sellwell_score) || 0) - (Number(a.sellwell_score) || 0);
    })
    .slice(0, topN);

  const report = {
    generated_at: new Date().toISOString(),
    workflow: "memory_cost_pass_through_tracker",
    input: {
      min_price: minPrice,
      max_price: maxPrice,
      top_n: topN,
      stores,
      prefer_stores: preferStores,
      impact_start: impactStart,
      high_sensitive_start: HIGH_SENSITIVE_START,
      restock_sensitive_start: RESTOCK_SENSITIVE_START,
      launch_pool_file: launchPool.file,
      launch_pool_generated: launchPool.generated,
      launch_pool_cached: Boolean(launchPool.cached),
      launch_pool_cache_age_days: Number.isFinite(launchPool.cache_age_days)
        ? launchPool.cache_age_days
        : null,
      launch_pool_cache_policy: launchPool.cache_policy || null,
    },
    stats: {
      launch_models: launchModels.length,
      store_candidates: store.candidates.length,
      candidate_budget: candidateBudget,
      resolved_products_before_sku_merge: products.length,
      products: consolidated.length,
      errors: errors.length,
      provider_stats: store.providerStats,
    },
    summary: buildSummary(consolidated),
    products: consolidated,
    errors,
  };
  report.data_health = buildDataHealth(report);

  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(htmlOut, renderHtml(report), "utf8");
  console.log(`Saved memory tracker JSON: ${jsonOut}`);
  console.log(`Saved memory tracker HTML: ${htmlOut}`);
  console.log(
    `products=${report.stats.products}, candidates=${report.stats.store_candidates}, errors=${report.stats.errors}`
  );
}

function statusRank(status) {
  const value = String(status || "");
  if (value.includes("sustained_increase") && !value.includes("stale")) return 0;
  if (value.includes("possible_increase") && !value.includes("stale")) return 1;
  if (value.includes("current_above_baseline") && !value.includes("stale")) return 2;
  if (value.includes("sustained_increase")) return 3;
  if (value.includes("possible_increase")) return 4;
  if (value.includes("current_above_baseline")) return 5;
  if (value.includes("no_increase_detected")) return 6;
  return 9;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
