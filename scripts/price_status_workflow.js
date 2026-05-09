#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API_BASE = "https://django.prixhistory.com";
const APP_BASE = "https://pricehistoryapp.com";
const MOBILE_CATEGORY = "mobiles";
const AUTH_SECRET = "8rRaP?pX7sfh5#%FXS423kG%et5qxVeN";
const DEFAULT_ALLOWED_STORES = ["flipkart", "amazon"];
const DEFAULT_STORE_PREFERENCE = ["flipkart", "amazon"];
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
  "white",
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
]);
const ACCESSORY_HINTS = [
  "cable",
  "charger",
  "adapter",
  "cover",
  "case",
  "skin",
  "protector",
  "tempered",
  "earbuds",
  "headset",
  "holder",
  "stand",
  "mount",
  "tripod",
  "watch",
];
const NON_PHONE_HINTS = [
  "tablet",
  "tab ",
  "ipad",
  "laptop",
  "notebook",
  "smartwatch",
  "tv",
  "television",
  "monitor",
  "mouse",
  "keyboard",
  "powerbank",
  "power bank",
  "earbuds",
  "earphones",
  "headset",
  "speaker",
  "tripod",
  "stabilizer",
  "drone",
  "printer",
  "router",
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
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

function nowUtcString() {
  return new Date().toUTCString();
}

function makeAuthToken() {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(AUTH_SECRET, "utf8"),
    iv
  );
  const encrypted = Buffer.concat([
    cipher.update(nowUtcString(), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

async function apiRequest(url, options) {
  const auth = makeAuthToken();
  const headers = {
    Auth: auth,
    Accept: "application/json",
    ...(options.headers || {}),
  };
  const response = await fetch(url, {
    cache: "no-cache",
    ...options,
    headers,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    rawText: text,
  };
}

async function apiPost(pathname, formFields) {
  const body = new URLSearchParams(formFields).toString();
  return apiRequest(`${API_BASE}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

async function apiGetAbsolute(url) {
  return apiRequest(url, { method: "GET" });
}

function ensureHttpUrl(input) {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return null;
  }
  return trimmed;
}

function splitListArg(value) {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitTokenList(value) {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/[\s,|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupeStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeStoreKey(value) {
  const text = String(value || "").toLowerCase();
  if (!text) {
    return "";
  }
  if (text.includes("flipkart")) {
    return "flipkart";
  }
  if (text.includes("amazon")) {
    return "amazon";
  }
  if (text.includes("croma")) {
    return "croma";
  }
  if (text.includes("myntra")) {
    return "myntra";
  }
  if (text.includes("ajio")) {
    return "ajio";
  }
  return text
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferStoreKeyFromUrl(inputUrl) {
  const parsed = parseUrlSafe(inputUrl);
  if (!parsed || !parsed.hostname) {
    return "";
  }
  return normalizeStoreKey(parsed.hostname);
}

function resolveStoreKey(storeName, inputUrl) {
  const byName = normalizeStoreKey(storeName);
  if (byName) {
    return byName;
  }
  return inferStoreKeyFromUrl(inputUrl);
}

function buildStorePriorityMap(storePreference) {
  const map = new Map();
  const order = Array.isArray(storePreference) ? storePreference : [];
  for (let i = 0; i < order.length; i += 1) {
    const key = normalizeStoreKey(order[i]);
    if (!key || map.has(key)) {
      continue;
    }
    map.set(key, i);
  }
  return map;
}

function storePriorityRank(storeKey, priorityMap) {
  const key = normalizeStoreKey(storeKey);
  if (!key) {
    return 1e6;
  }
  if (priorityMap.has(key)) {
    return priorityMap.get(key);
  }
  return 1e5;
}

function parseUrlSafe(input) {
  const url = ensureHttpUrl(input);
  if (!url) {
    return null;
  }
  try {
    return new URL(url);
  } catch (err) {
    return null;
  }
}

function normalizeSlugToken(slug) {
  return String(slug || "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

function inferSlugCandidatesFromUrl(inputUrl) {
  const parsed = parseUrlSafe(inputUrl);
  if (!parsed) {
    return [];
  }
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  if (pathParts.length < 2) {
    return [];
  }
  const head = pathParts[0].toLowerCase();
  const tail = pathParts[1];
  if (!tail) {
    return [];
  }

  const candidates = [];
  if (head === "product" || head === "embed") {
    candidates.push(normalizeSlugToken(tail));
  } else if (head === "p") {
    const full = normalizeSlugToken(tail);
    if (full) {
      candidates.push(full);
    }
    const parts = full.split("-").filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (
        (/[a-z]/.test(last) && /\d/.test(last)) ||
        /^[a-z0-9]{7,12}$/.test(last)
      ) {
        parts.pop();
      }
      const stripped = parts.join("-");
      if (stripped) {
        candidates.push(stripped);
      }
    }
  }
  return dedupeStrings(candidates);
}

function extractVariantGroupKey(slug, modelQuery) {
  if (modelQuery) {
    return normalizeText(modelQuery)
      .split(/\s+/)
      .filter((token) => token !== "5g" && token !== "4g")
      .join("-");
  }
  const raw = normalizeSlugToken(slug);
  const parts = raw.split("-").filter(Boolean);
  const keep = [];
  for (let i = 0; i < parts.length; i += 1) {
    const token = parts[i];
    const next = parts[i + 1] || "";
    if (/^\d+(gb|tb|mb)$/i.test(token)) {
      break;
    }
    if (/^\d{2,4}$/i.test(token) && /^(gb|tb|mb)$/i.test(next)) {
      break;
    }
    if (token === "ram" || token === "rom") {
      break;
    }
    keep.push(token);
  }
  while (keep.length > 1 && COLOR_TOKENS.has(keep[keep.length - 1])) {
    keep.pop();
  }
  const compact = keep.filter(
    (token) => token !== "5g" && token !== "4g" && !COLOR_TOKENS.has(token)
  );
  return compact.join("-") || keep.join("-") || raw;
}

function extractVariantLabel(slug, storeCode) {
  const raw = normalizeSlugToken(slug);
  const text = `${raw} ${String(storeCode || "").toLowerCase()}`;
  const ram =
    text.match(/(?:^|-|\s)(\d{1,2})\s*gb[-\s]*ram(?:-|\s|$)/i) ||
    text.match(/(?:^|-|\s)(\d{1,2})\s*gb[-\s]*(?:\+|plus)[-\s]*\d{2,4}\s*gb/i);
  const rom =
    text.match(/(?:^|-|\s)(\d{2,4})[-\s]*gb[-\s]*rom(?:-|\s|$)/i) ||
    text.match(/(?:^|-|\s)(\d{2,4})[-\s]*(gb|tb)(?:-|\s|$)/i);
  if (ram && rom) {
    return `${ram[1]}GB+${rom[1]}${String(rom[2] || "GB").toUpperCase()}`;
  }
  if (rom) {
    return `RAM_UNKNOWN+${rom[1]}${String(rom[2] || "GB").toUpperCase()}`;
  }
  if (storeCode) {
    return String(storeCode);
  }
  return raw;
}

async function getSlugFromProductUrl(productUrl) {
  const url = ensureHttpUrl(productUrl);
  if (!url) {
    return {
      ok: false,
      error: "Invalid URL: must start with http:// or https://",
    };
  }
  const result = await apiPost("/api/product/history/getSlugFromUrl", {
    purl: url,
  });
  if (!result.ok || !result.data || !result.data.slug) {
    return {
      ok: false,
      error:
        (result.data && result.data.detail) ||
        `Unable to resolve slug (HTTP ${result.status})`,
      detail: result.data && result.data.detail ? String(result.data.detail) : "",
    };
  }
  return {
    ok: true,
    slug: String(result.data.slug),
    countryCode: result.data.country_code || null,
  };
}

async function getHistoryBySlug(slug) {
  const result = await apiPost("/api/product/history/updateFromSlug", { slug });
  if (!result.ok || !result.data) {
    return {
      ok: false,
      error: `Unable to fetch history for slug=${slug} (HTTP ${result.status})`,
    };
  }
  return {
    ok: true,
    data: result.data,
  };
}

function timestampToIso(sec) {
  return new Date(sec * 1000).toISOString();
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getModelTokens(model) {
  return normalizeText(model)
    .split(/\s+/)
    .filter(Boolean);
}

function scoreModelMatch(model, candidateName) {
  const tokens = getModelTokens(model);
  if (tokens.length === 0) {
    return 0;
  }
  const target = normalizeText(candidateName);
  for (const token of tokens) {
    if (/\d/.test(token) && !target.includes(token)) {
      return 0;
    }
  }
  let hit = 0;
  for (const token of tokens) {
    if (target.includes(token)) {
      hit += 1;
    }
  }
  return hit / tokens.length;
}

function looksLikeAccessory(candidateName) {
  const text = normalizeText(candidateName);
  return ACCESSORY_HINTS.some((word) => text.includes(word));
}

function looksLikeNonPhone(candidateName) {
  const text = normalizeText(candidateName);
  return NON_PHONE_HINTS.some((word) => text.includes(word));
}

function isLikelyPhoneCandidate(candidate) {
  const text = normalizeText(candidate && candidate.name ? candidate.name : "");
  if (!text) {
    return false;
  }
  if (looksLikeAccessory(text) || looksLikeNonPhone(text)) {
    return false;
  }
  return true;
}

function isStrongModelMatch(model, candidateName, score) {
  if (!Number.isFinite(score) || score <= 0) {
    return false;
  }
  if (looksLikeAccessory(candidateName) || looksLikeNonPhone(candidateName)) {
    return false;
  }
  const tokens = getModelTokens(model);
  const minScore = tokens.length >= 3 ? 0.66 : tokens.length === 2 ? 0.51 : 1;
  return score >= minScore;
}

function modelFamilyKeyFromSlug(slug) {
  return extractVariantGroupKey(slug, "");
}

function pickUniqueModelCandidates(candidates, limit, storePriorityMap) {
  const byFamily = new Map();
  for (const candidate of candidates) {
    const key = modelFamilyKeyFromSlug(candidate.slug) || candidate.slug;
    if (!key) {
      continue;
    }
    const prev = byFamily.get(key);
    if (!prev) {
      byFamily.set(key, candidate);
      continue;
    }
    const prevRank = storePriorityRank(prev.store_key, storePriorityMap);
    const curRank = storePriorityRank(candidate.store_key, storePriorityMap);
    if (curRank < prevRank) {
      byFamily.set(key, candidate);
      continue;
    }
    if (curRank === prevRank) {
      const prevUpdated = String(prev.updated_at || "");
      const curUpdated = String(candidate.updated_at || "");
      if (curUpdated > prevUpdated) {
        byFamily.set(key, candidate);
      }
    }
  }

  return Array.from(byFamily.values())
    .sort((a, b) => {
      const rankDiff =
        storePriorityRank(a.store_key, storePriorityMap) -
        storePriorityRank(b.store_key, storePriorityMap);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    })
    .slice(0, Math.max(1, limit));
}

function parseIsoToTimestampSec(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return null;
  }
  return Math.floor(ms / 1000);
}

function summarizeHistory(slug, raw) {
  const historyEntries = Object.entries(raw.history || {})
    .map(([sec, price]) => ({
      timestamp_sec: Number(sec),
      timestamp_iso: timestampToIso(Number(sec)),
      price_inr: Number(price),
    }))
    .filter((item) => Number.isFinite(item.timestamp_sec))
    .sort((a, b) => a.timestamp_sec - b.timestamp_sec);

  const currentPrice = Number(raw.price);
  const currentTs = parseIsoToTimestampSec(raw.price_fetched_at);
  if (
    Number.isFinite(currentTs) &&
    Number.isFinite(currentPrice) &&
    (historyEntries.length === 0 ||
      historyEntries[historyEntries.length - 1].timestamp_sec < currentTs)
  ) {
    historyEntries.push({
      timestamp_sec: currentTs,
      timestamp_iso: timestampToIso(currentTs),
      price_inr: currentPrice,
    });
  }

  const priceChanges = [];
  for (let i = 0; i < historyEntries.length; i += 1) {
    const row = historyEntries[i];
    const prev = priceChanges[priceChanges.length - 1];
    if (!prev || prev.price_inr !== row.price_inr) {
      priceChanges.push(row);
    }
  }

  const stablePhases = [];
  for (let i = 0; i < priceChanges.length; i += 1) {
    const start = priceChanges[i];
    const end = priceChanges[i + 1] || null;
    const durationDays =
      end && end.timestamp_sec > start.timestamp_sec
        ? Math.floor((end.timestamp_sec - start.timestamp_sec) / 86400)
        : null;
    stablePhases.push({
      price_inr: start.price_inr,
      start_at_iso: start.timestamp_iso,
      end_at_iso: end ? end.timestamp_iso : null,
      duration_days: durationDays,
      next_price_inr: end ? end.price_inr : null,
    });
  }

  const firstSeen = historyEntries[0] || null;
  const storeName =
    (raw.store && (raw.store.name || raw.store.slug)) ||
    raw.store_name ||
    null;
  const resolvedStoreKey = resolveStoreKey(storeName, raw.url || "");

  return {
    slug,
    product_url: raw.url || null,
    store_name: storeName,
    store_key: resolvedStoreKey || null,
    store_product_code: raw.pid || null,
    pricehistory_page_url: `${APP_BASE}/product/${slug}`,
    pricehistory_embed_chart_url: `${APP_BASE}/embed/${slug}`,
    current_price_inr: Number.isFinite(currentPrice) ? currentPrice : null,
    current_price_fetched_at: raw.price_fetched_at || null,
    lowest_price_inr: Number(raw.lowest_price),
    highest_price_inr: Number(raw.highest_price),
    average_price_inr: Number(raw.average_price),
    first_seen_price_at: firstSeen ? firstSeen.timestamp_iso : null,
    first_seen_price_inr: firstSeen ? firstSeen.price_inr : null,
    price_change_events: priceChanges,
    stable_price_phases: stablePhases,
    raw_point_count: historyEntries.length,
  };
}

function dealToCandidate(deal) {
  if (!deal || !deal.product || !deal.product.slug) {
    return null;
  }
  const storeName = (deal.store && deal.store.name) || null;
  const productUrl = deal.url || null;
  return {
    slug: deal.product.slug,
    name: deal.product.name || "",
    price_inr: Number(deal.price),
    updated_at: deal.updated_at || null,
    store: storeName,
    store_key: resolveStoreKey(storeName, productUrl),
    product_url: productUrl,
  };
}

async function fetchMobileCandidates(options) {
  const {
    locale,
    minPrice,
    maxPrice,
    maxPages,
    wantCount,
    model,
    allowedStoreKeys,
    storePriorityMap,
    phoneOnly,
  } = options;
  const allowSet = new Set(
    (Array.isArray(allowedStoreKeys) ? allowedStoreKeys : [])
      .map((s) => normalizeStoreKey(s))
      .filter(Boolean)
  );
  const priorityMap = storePriorityMap || new Map();

  let url =
    `${API_BASE}/api/product/deals?` +
    new URLSearchParams({
      locale,
      category: MOBILE_CATEGORY,
    }).toString();

  const seen = new Set();
  const out = [];
  let page = 0;

  while (url && page < maxPages) {
    page += 1;
    const result = await apiGetAbsolute(url);
    if (!result.ok || !result.data) {
      break;
    }
    const rows = Array.isArray(result.data.results) ? result.data.results : [];
    for (const deal of rows) {
      const candidate = dealToCandidate(deal);
      if (!candidate) {
        continue;
      }
      if (!Number.isFinite(candidate.price_inr)) {
        continue;
      }
      if (candidate.price_inr < minPrice || candidate.price_inr > maxPrice) {
        continue;
      }
      if (phoneOnly && !isLikelyPhoneCandidate(candidate)) {
        continue;
      }
      if (allowSet.size > 0 && !allowSet.has(candidate.store_key)) {
        continue;
      }
      if (seen.has(candidate.slug)) {
        continue;
      }
      if (model) {
        const score = scoreModelMatch(model, candidate.name);
        if (!isStrongModelMatch(model, candidate.name, score)) {
          continue;
        }
        candidate.match_score = score;
      }
      seen.add(candidate.slug);
      out.push(candidate);
    }
    if (out.length >= wantCount) {
      break;
    }
    url = result.data.next || null;
  }

  if (model) {
    out.sort((a, b) => {
      const scoreDiff = (b.match_score || 0) - (a.match_score || 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      const rankDiff =
        storePriorityRank(a.store_key, priorityMap) -
        storePriorityRank(b.store_key, priorityMap);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
  } else {
    out.sort((a, b) => {
      const rankDiff =
        storePriorityRank(a.store_key, priorityMap) -
        storePriorityRank(b.store_key, priorityMap);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
  }

  return out;
}

async function collectBySlug(slug) {
  const history = await getHistoryBySlug(slug);
  if (!history.ok) {
    return {
      ok: false,
      slug,
      error: history.error,
    };
  }
  return {
    ok: true,
    slug,
    summary: summarizeHistory(slug, history.data),
  };
}

async function collectByUrl(productUrl) {
  const url = ensureHttpUrl(productUrl);
  if (!url) {
    return {
      ok: false,
      error: `Invalid URL: ${String(productUrl || "")}`,
    };
  }

  const guessedSlugs = inferSlugCandidatesFromUrl(url);
  for (const guessed of guessedSlugs) {
    const attempt = await collectBySlug(guessed);
    if (attempt.ok) {
      attempt.summary.resolved_from_url = {
        source_url: url,
        method: "url_slug_hint",
        slug: guessed,
      };
      return attempt;
    }
  }

  const slugResult = await getSlugFromProductUrl(url);
  if (!slugResult.ok) {
    return {
      ok: false,
      error: `${slugResult.error} (url=${url})`,
    };
  }

  const finalTry = await collectBySlug(slugResult.slug);
  if (!finalTry.ok) {
    return finalTry;
  }
  finalTry.summary.resolved_from_url = {
    source_url: url,
    method: "api_getSlugFromUrl",
    slug: slugResult.slug,
  };
  return finalTry;
}

function enrichStoreBasis(summary, candidate, storePriorityMap) {
  const fromSummaryKey = resolveStoreKey(summary.store_name, summary.product_url);
  const fromCandidateKey = candidate ? resolveStoreKey(candidate.store, candidate.product_url) : "";
  const storeKey = fromSummaryKey || fromCandidateKey || null;
  const storeName =
    summary.store_name ||
    (candidate && candidate.store ? String(candidate.store) : null) ||
    null;
  summary.store_key = storeKey;
  summary.store_name = storeName;
  summary.price_basis_store_key = storeKey;
  summary.price_basis_store_name = storeName;
  summary.price_basis_preference_rank =
    storeKey && storePriorityMap
      ? storePriorityRank(storeKey, storePriorityMap)
      : null;
}

function isSummaryPriceInRange(summary, minPrice, maxPrice) {
  const price = Number(summary && summary.current_price_inr);
  if (!Number.isFinite(price)) {
    return false;
  }
  return price >= minPrice && price <= maxPrice;
}

async function main() {
  const args = parseArgs(process.argv);

  const locale = String(args.locale || "en-in").toLowerCase();
  const minPrice = Number(args.minPrice || 20000);
  const maxPrice = Number(args.maxPrice || 50000);
  const topN = Number(args.topN || 10);
  const maxPages = Number(args.maxPages || 40);
  const autoTop = Boolean(args.autoTop);
  const latestTop = Boolean(args.latestTop);
  const model = args.model ? String(args.model).trim() : "";
  const slugArg = args.slug ? String(args.slug).trim() : "";
  const urlArg = args.url ? String(args.url).trim() : "";
  const urlsArg = splitListArg(args.urls);
  const storeAllowArg = splitTokenList(String(args.stores || ""));
  const storePreferArg = splitTokenList(String(args.preferStores || ""));
  const phoneOnly = args.phoneOnly === false || args.phoneOnly === "false" ? false : true;
  const allowedStores = dedupeStrings(
    (storeAllowArg.length ? storeAllowArg : DEFAULT_ALLOWED_STORES)
      .map((s) => normalizeStoreKey(s))
      .filter(Boolean)
  );
  const preferredStores = dedupeStrings(
    (storePreferArg.length ? storePreferArg : DEFAULT_STORE_PREFERENCE)
      .map((s) => normalizeStoreKey(s))
      .filter(Boolean)
  );
  const storePriorityMap = buildStorePriorityMap(preferredStores);
  const latestPoolRaw = Number(args.latestPool || Math.max(120, topN * 20));
  const latestPool =
    Number.isFinite(latestPoolRaw) && latestPoolRaw > topN
      ? Math.floor(latestPoolRaw)
      : Math.max(120, topN * 20);
  const variantCountRaw = Number(args.variantCount || Math.min(4, topN));
  const variantCount =
    Number.isFinite(variantCountRaw) && variantCountRaw > 0
      ? Math.floor(variantCountRaw)
      : Math.max(1, Math.min(4, topN));
  const outFile = args.out ? String(args.out) : "";
  const urlList = dedupeStrings([urlArg, ...urlsArg].filter(Boolean));
  const runMode = slugArg
    ? "slug"
    : urlList.length
      ? "url"
      : model
        ? "model"
        : autoTop
          ? "auto_top"
          : latestTop
            ? "latest_top"
            : "unknown";

  if (!slugArg && urlList.length === 0 && !model && !autoTop && !latestTop) {
    throw new Error(
      "No input. Use one of: --slug, --url/--urls, --model, --autoTop, or --latestTop."
    );
  }

  const report = {
    generated_at: new Date().toISOString(),
    locale,
    workflow: "price_status_update",
    input: {
      run_mode: runMode,
      slug: slugArg || null,
      url: urlArg || null,
      urls: urlList.length ? urlList : null,
      model: model || null,
      auto_top: autoTop,
      latest_top: latestTop,
      min_price: minPrice,
      max_price: maxPrice,
      top_n: topN,
      variant_count: variantCount,
      latest_pool: latestPool,
      phone_only: phoneOnly,
      stores: allowedStores,
      prefer_stores: preferredStores,
    },
    products: [],
    errors: [],
  };

  if (slugArg) {
    const one = await collectBySlug(slugArg);
    if (one.ok) {
      one.summary.variant_group_key = extractVariantGroupKey(one.summary.slug, model);
      one.summary.variant_label = extractVariantLabel(
        one.summary.slug,
        one.summary.store_product_code
      );
      enrichStoreBasis(one.summary, null, storePriorityMap);
      report.products.push(one.summary);
    } else {
      report.errors.push(one.error);
    }
  } else if (urlList.length > 0) {
    for (const url of urlList) {
      const one = await collectByUrl(url);
      if (one.ok) {
        one.summary.variant_group_key = extractVariantGroupKey(one.summary.slug, model);
        one.summary.variant_label = extractVariantLabel(
          one.summary.slug,
          one.summary.store_product_code
        );
        enrichStoreBasis(one.summary, null, storePriorityMap);
        report.products.push(one.summary);
      } else {
        report.errors.push(one.error);
      }
    }
    if (report.products.length === 1) {
      report.input.slug = report.products[0].slug;
    }
  } else if (model) {
    const candidates = await fetchMobileCandidates({
      locale,
      minPrice,
      maxPrice,
      maxPages,
      wantCount: Math.max(24, topN * 3),
      model,
      allowedStoreKeys: allowedStores,
      storePriorityMap,
      phoneOnly,
    });
    if (candidates.length === 0) {
      report.errors.push(
        `No mobile candidates matched model="${model}" in ${minPrice}-${maxPrice}.`
      );
    } else {
      const selected = candidates.slice(0, Math.max(1, variantCount));
      if (selected[0]) {
        report.input.slug = selected[0].slug;
      }
      for (const candidate of selected) {
        const one = await collectBySlug(candidate.slug);
        if (one.ok) {
          one.summary.match_hint = {
            matched_model_query: model,
            match_score: candidate.match_score || null,
            candidate_name: candidate.name,
            candidate_price_inr: candidate.price_inr,
            candidate_updated_at: candidate.updated_at,
            candidate_store: candidate.store || null,
            candidate_store_key: candidate.store_key || null,
          };
          one.summary.variant_group_key = extractVariantGroupKey(
            one.summary.slug,
            model
          );
          one.summary.variant_label = extractVariantLabel(
            one.summary.slug,
            one.summary.store_product_code
          );
          enrichStoreBasis(one.summary, candidate, storePriorityMap);
          report.products.push(one.summary);
        } else {
          report.errors.push(one.error);
        }
      }
    }
  } else if (autoTop) {
    const candidates = await fetchMobileCandidates({
      locale,
      minPrice,
      maxPrice,
      maxPages,
      wantCount: Math.max(topN * 6, 80),
      model: "",
      allowedStoreKeys: allowedStores,
      storePriorityMap,
      phoneOnly,
    });
    const selected = pickUniqueModelCandidates(
      candidates,
      Math.max(topN * 4, topN),
      storePriorityMap
    );
    for (const candidate of selected) {
      if (report.products.length >= topN) {
        break;
      }
      const one = await collectBySlug(candidate.slug);
      if (one.ok) {
        if (!isSummaryPriceInRange(one.summary, minPrice, maxPrice)) {
          continue;
        }
        one.summary.selection_hint = {
          source: "deals_api",
          candidate_name: candidate.name,
          candidate_price_inr: candidate.price_inr,
          candidate_updated_at: candidate.updated_at,
          candidate_store: candidate.store,
          candidate_store_key: candidate.store_key || null,
          preferred_store_rank: storePriorityRank(
            candidate.store_key,
            storePriorityMap
          ),
        };
        one.summary.variant_group_key = extractVariantGroupKey(one.summary.slug, "");
        one.summary.variant_label = extractVariantLabel(
          one.summary.slug,
          one.summary.store_product_code
        );
        enrichStoreBasis(one.summary, candidate, storePriorityMap);
        report.products.push(one.summary);
      } else {
        report.errors.push(one.error);
      }
    }
  } else if (latestTop) {
    const candidates = await fetchMobileCandidates({
      locale,
      minPrice,
      maxPrice,
      maxPages,
      wantCount: latestPool,
      model: "",
      allowedStoreKeys: allowedStores,
      storePriorityMap,
      phoneOnly,
    });
    const preselected = pickUniqueModelCandidates(
      candidates,
      latestPool,
      storePriorityMap
    );
    const latestRows = [];
    for (const candidate of preselected) {
      const one = await collectBySlug(candidate.slug);
      if (!one.ok) {
        report.errors.push(one.error);
        continue;
      }
      if (!isSummaryPriceInRange(one.summary, minPrice, maxPrice)) {
        continue;
      }
      const firstSeenTs = parseIsoToTimestampSec(one.summary.first_seen_price_at);
      latestRows.push({
        candidate,
        firstSeenTs: Number.isFinite(firstSeenTs) ? firstSeenTs : 0,
        summary: one.summary,
      });
    }
    latestRows.sort((a, b) => {
      const tsDiff = b.firstSeenTs - a.firstSeenTs;
      if (tsDiff !== 0) {
        return tsDiff;
      }
      const rankDiff =
        storePriorityRank(a.candidate.store_key, storePriorityMap) -
        storePriorityRank(b.candidate.store_key, storePriorityMap);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return String(b.candidate.updated_at || "").localeCompare(
        String(a.candidate.updated_at || "")
      );
    });
    for (const row of latestRows.slice(0, topN)) {
      row.summary.selection_hint = {
        source: "deals_api_latest",
        candidate_name: row.candidate.name,
        candidate_price_inr: row.candidate.price_inr,
        candidate_updated_at: row.candidate.updated_at,
        candidate_store: row.candidate.store,
        candidate_store_key: row.candidate.store_key || null,
        preferred_store_rank: storePriorityRank(
          row.candidate.store_key,
          storePriorityMap
        ),
      };
      row.summary.variant_group_key = extractVariantGroupKey(row.summary.slug, "");
      row.summary.variant_label = extractVariantLabel(
        row.summary.slug,
        row.summary.store_product_code
      );
      enrichStoreBasis(row.summary, row.candidate, storePriorityMap);
      report.products.push(row.summary);
    }
  }

  report.products = dedupeStrings(report.products.map((p) => p.slug))
    .map((slug) => report.products.find((p) => p.slug === slug))
    .filter(Boolean);

  const json = JSON.stringify(report, null, 2);
  if (outFile) {
    const absPath = path.resolve(outFile);
    fs.writeFileSync(absPath, json, "utf8");
    console.log(`Saved report: ${absPath}`);
  } else {
    console.log(json);
  }

  if (report.products.length > 0) {
    console.error(
      `Done. products=${report.products.length}, errors=${report.errors.length}`
    );
  } else {
    console.error(`Done with no product output. errors=${report.errors.length}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
