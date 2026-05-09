#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API_BASE = "https://django.prixhistory.com";
const APP_BASE = "https://pricehistoryapp.com";
const PRICEHISTORY_APP = "https://pricehistory.app";
const R_JINA_HTTP = "https://r.jina.ai/http://";
const AUTH_SECRET = "8rRaP?pX7sfh5#%FXS423kG%et5qxVeN";
const MOBILE_CATEGORY = "mobiles";
const DEFAULT_ALLOWED_STORES = ["flipkart", "amazon"];
const DEFAULT_PREFER_STORES = ["flipkart", "amazon"];
const STOP_TOKENS = new Set([
  "5g",
  "4g",
  "mobile",
  "mobiles",
  "phone",
  "smartphone",
  "smartphones",
  "ram",
  "storage",
  "gb",
  "tb",
  "inch",
  "inches",
  "dual",
  "sim",
  "india",
  "with",
  "and",
  "the",
  "new",
]);
const NON_PHONE_HINTS = [
  "tablet",
  "tab ",
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

function splitTokenList(value) {
  if (typeof value !== "string") return [];
  return value
    .split(/[\s,|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupeStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalModelKey(name) {
  return normalizeText(name)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token !== "5g" && token !== "4g")
    .join(" ");
}

function normalizeStoreKey(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return "";
  if (text.includes("flipkart")) return "flipkart";
  if (text.includes("amazon")) return "amazon";
  return text
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureHttpUrl(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return null;
  }
  return trimmed;
}

function parseUrlSafe(input) {
  const value = ensureHttpUrl(input);
  if (!value) return null;
  try {
    return new URL(value);
  } catch (err) {
    return null;
  }
}

function inferStoreKeyFromUrl(inputUrl) {
  const parsed = parseUrlSafe(inputUrl);
  if (!parsed || !parsed.hostname) return "";
  return normalizeStoreKey(parsed.hostname);
}

function resolveStoreKey(storeName, inputUrl) {
  const byName = normalizeStoreKey(storeName);
  if (byName) return byName;
  return inferStoreKeyFromUrl(inputUrl);
}

function cleanMaybeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/&amp;/gi, "&")
    .replace(/[),.;]+$/g, "")
    .trim();
  return ensureHttpUrl(cleaned);
}

function parseInrNumber(text) {
  const m = String(text || "").match(/₹\s*([0-9,]+)/);
  if (!m) return null;
  const v = Number(String(m[1]).replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

function normalizeModelSearchQuery(name) {
  return String(name || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(5g|4g)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDateTimeToIsoWithIndiaOffset(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = text.replace(" ", "T");
  const withOffset = `${normalized}+05:30`;
  const ms = Date.parse(withOffset);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function buildStorePriorityMap(storePreference) {
  const map = new Map();
  for (let i = 0; i < storePreference.length; i += 1) {
    const key = normalizeStoreKey(storePreference[i]);
    if (!key || map.has(key)) continue;
    map.set(key, i);
  }
  return map;
}

function storePriorityRank(storeKey, priorityMap) {
  const key = normalizeStoreKey(storeKey);
  if (!key) return 1e6;
  if (priorityMap.has(key)) return priorityMap.get(key);
  return 1e5;
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

async function apiGetAbsolute(url) {
  return apiRequest(url, { method: "GET", cache: "no-cache" });
}

async function apiPost(pathname, formFields) {
  return apiRequest(`${API_BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(formFields).toString(),
  });
}

function looksLikeNonPhone(name) {
  const text = normalizeText(name);
  return NON_PHONE_HINTS.some((w) => text.includes(w));
}

function extractModelTokens(name) {
  return normalizeText(name)
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !STOP_TOKENS.has(t));
}

function tokenizeSet(name) {
  return new Set(
    normalizeText(name)
      .split(/\s+/)
      .filter(Boolean)
  );
}

function buildLaunchPattern(model) {
  const modelName = String(model.model_name || "");
  const coreName = modelName.split("(")[0].trim();
  const tokens = extractModelTokens(modelName);
  const coreTokens = extractModelTokens(coreName);
  const brand = tokens[0] || "";
  const numericTokens = tokens.filter((t) => /\d/.test(t));
  const coreNumericTokens = coreTokens.filter((t) => /\d/.test(t));
  const weightedTokens = tokens.map((t, idx) => {
    let weight = 1;
    if (idx === 0) weight += 1;
    if (/\d/.test(t)) weight += 1;
    if (t.length >= 4) weight += 0.3;
    return { token: t, weight };
  });
  const totalWeight = weightedTokens.reduce((s, x) => s + x.weight, 0) || 1;
  return {
    model_key: canonicalModelKey(model.model_name || model.model_key),
    model_name: model.model_name,
    launch_date_iso: model.first_launch_date_iso || null,
    sources: model.sources || [],
    brand,
    numericTokens,
    core_tokens: coreTokens,
    core_numeric_tokens: coreNumericTokens,
    weightedTokens,
    totalWeight,
    normalized_model_text: normalizeText(model.model_name),
  };
}

function mergeLaunchPatterns(patterns) {
  const byKey = new Map();
  for (const pattern of patterns) {
    if (!pattern || !pattern.model_key) continue;
    const prev = byKey.get(pattern.model_key);
    if (!prev) {
      byKey.set(pattern.model_key, { ...pattern, sources: [...(pattern.sources || [])] });
      continue;
    }
    if (
      pattern.launch_date_iso &&
      (!prev.launch_date_iso || pattern.launch_date_iso < prev.launch_date_iso)
    ) {
      prev.launch_date_iso = pattern.launch_date_iso;
    }
    if (
      String(pattern.model_name || "").length < String(prev.model_name || "").length
    ) {
      prev.model_name = pattern.model_name;
    }
    for (const source of pattern.sources || []) {
      if (!prev.sources.includes(source)) prev.sources.push(source);
    }
  }
  return Array.from(byKey.values());
}

function scoreCandidateToPattern(candidateName, pattern) {
  const set = tokenizeSet(candidateName);
  if (!pattern.brand || !set.has(pattern.brand)) {
    return {
      score: 0,
      matched_tokens: 0,
      matched_numeric_tokens: 0,
      reason: "brand_miss",
    };
  }
  if (
    Array.isArray(pattern.core_numeric_tokens) &&
    pattern.core_numeric_tokens.length > 0 &&
    !pattern.core_numeric_tokens.some((t) => set.has(t))
  ) {
    return {
      score: 0,
      matched_tokens: 0,
      matched_numeric_tokens: 0,
      reason: "core_numeric_miss",
    };
  }
  const coreNonBrandTokens = (pattern.core_tokens || []).filter((t) => t !== pattern.brand);
  if (coreNonBrandTokens.length > 0 && !coreNonBrandTokens.some((t) => set.has(t))) {
    return {
      score: 0,
      matched_tokens: 0,
      matched_numeric_tokens: 0,
      reason: "core_token_miss",
    };
  }
  let gotWeight = 0;
  let matchedTokens = 0;
  let matchedNumeric = 0;
  let matchedNonBrand = 0;
  for (const x of pattern.weightedTokens) {
    if (set.has(x.token)) {
      gotWeight += x.weight;
      matchedTokens += 1;
      if (x.token !== pattern.brand) {
        matchedNonBrand += 1;
      }
      if (/\d/.test(x.token)) {
        matchedNumeric += 1;
      }
    }
  }
  if (matchedNonBrand === 0) {
    return {
      score: 0,
      matched_tokens: matchedTokens,
      matched_numeric_tokens: matchedNumeric,
      reason: "only_brand",
    };
  }
  const rawScore = gotWeight / pattern.totalWeight;
  const numericCoverage = pattern.numericTokens.length
    ? matchedNumeric / pattern.numericTokens.length
    : 1;
  const phraseMatch = normalizeText(candidateName).includes(pattern.normalized_model_text)
    ? 1
    : 0;
  let score = rawScore * 0.72 + numericCoverage * 0.23 + phraseMatch * 0.05;
  if (pattern.numericTokens.length > 0 && matchedNumeric === 0) {
    score *= 0.6;
  }
  return {
    score: Number(score.toFixed(4)),
    matched_tokens: matchedTokens,
    matched_numeric_tokens: matchedNumeric,
    reason: "ok",
  };
}

function extractVariantSignature(candidateName, candidateSlug) {
  const text = `${String(candidateName || "")} ${String(candidateSlug || "")}`.toLowerCase();
  const pairs = Array.from(text.matchAll(/(\d{1,4})\s*(gb|tb)\b/gi)).map((m) => ({
    value: Number(m[1]),
    unit: String(m[2] || "").toUpperCase(),
  }));
  if (!pairs.length) return "STD";

  const ramHint =
    text.match(/(?:^|[^0-9])(\d{1,2})\s*gb\s*ram\b/i) ||
    text.match(/(?:^|[^0-9])(\d{1,2})\s*gb\s*\+\s*\d{2,4}\s*gb\b/i);
  const ramGb = ramHint ? Number(ramHint[1]) : null;
  let storage = null;
  const romHint = text.match(/(?:^|[^0-9])(\d{2,4})\s*gb\s*rom\b/i);
  if (romHint) {
    storage = { value: Number(romHint[1]), unit: "GB" };
  }
  for (const p of pairs) {
    if (storage) break;
    if (p.unit === "TB") {
      if (!storage || storage.unit !== "TB" || p.value > storage.value) {
        storage = p;
      }
      continue;
    }
    if (p.value >= 32) {
      if (!storage || (storage.unit === "GB" && p.value > storage.value)) {
        storage = p;
      }
    }
  }
  if (!storage) {
    storage = pairs.reduce((best, p) => {
      if (!best) return p;
      const bestScore = best.unit === "TB" ? best.value * 1024 : best.value;
      const curScore = p.unit === "TB" ? p.value * 1024 : p.value;
      return curScore > bestScore ? p : best;
    }, null);
  }
  if (ramGb && storage) {
    return `${ramGb}GB+${storage.value}${storage.unit}`;
  }
  if (storage) {
    return `RAM_UNKNOWN+${storage.value}${storage.unit}`;
  }
  return "STD";
}

function dealToCandidate(deal) {
  if (!deal || !deal.product || !deal.product.slug) return null;
  const fullName = String(deal.product.name || "");
  const matchName = fullName.split("|")[0].trim() || fullName;
  const productUrl = String(deal.url || "").trim() || null;
  const storeName = (deal.store && deal.store.name) || "";
  return {
    slug: deal.product.slug,
    name: fullName,
    match_name: matchName,
    rating: Number(deal.product.rating),
    rating_count: Number(deal.product.rating_count),
    price_inr: Number(deal.price),
    updated_at: deal.updated_at || null,
    product_url: productUrl,
    store_name: storeName,
    store_key: resolveStoreKey(storeName, productUrl),
  };
}

async function fetchDealsCandidates(opts) {
  const allowStores = new Set(opts.allowedStores.map((s) => normalizeStoreKey(s)));
  let url =
    `${API_BASE}/api/product/deals?` +
    new URLSearchParams({
      locale: opts.locale,
      category: MOBILE_CATEGORY,
    }).toString();
  const out = [];
  const seen = new Set();
  let page = 0;
  while (url && page < opts.maxPages) {
    page += 1;
    const result = await apiGetAbsolute(url);
    if (!result.ok || !result.data) break;
    const rows = Array.isArray(result.data.results) ? result.data.results : [];
    for (const row of rows) {
      const c = dealToCandidate(row);
      if (!c) continue;
      if (allowStores.size && !allowStores.has(c.store_key)) continue;
      if (!Number.isFinite(c.price_inr)) continue;
      if (c.price_inr < opts.minPrice || c.price_inr > opts.maxPrice) continue;
      if (looksLikeNonPhone(c.name)) continue;
      const key = `${c.store_key}::${c.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    url = result.data.next || null;
  }
  return out;
}

async function fetchFlipkartCandidatesByModel(modelName, opts) {
  const query = normalizeModelSearchQuery(modelName);
  if (!query) return [];
  const url = `${R_JINA_HTTP}www.flipkart.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { method: "GET", cache: "no-cache" });
  if (!res.ok) return [];
  const text = await res.text();
  const lines = String(text || "").split("\n");
  const out = [];
  const seen = new Set();
  for (const lineRaw of lines) {
    const line = String(lineRaw || "");
    if (!line.includes("flipkart.com/")) continue;
    if (!line.toLowerCase().includes("/p/")) continue;
    const urlMatches = line.match(/https?:\/\/www\.flipkart\.com\/[^)\s]+/gi) || [];
    const price = parseInrNumber(line);
    if (!Number.isFinite(price)) continue;
    if (price < opts.minPrice || price > opts.maxPrice) continue;

    const ratingMatch = line.match(/\b([0-5](?:\.[0-9])?)\b/);
    const rating = ratingMatch ? Number(ratingMatch[1]) : null;
    const rcMatch = line.match(/([0-9][0-9,]*)\s*Ratings/i);
    const ratingCount = rcMatch
      ? Number(String(rcMatch[1]).replace(/,/g, ""))
      : null;
    const unavailable = /currently unavailable|coming soon/i.test(line);

    for (const rawUrl of urlMatches) {
      const productUrl = cleanMaybeUrl(rawUrl);
      if (!productUrl) continue;
      const parsed = parseUrlSafe(productUrl);
      const pid = parsed ? parsed.searchParams.get("pid") || "" : "";
      const uniq = pid || productUrl.split("?")[0];
      if (!uniq || seen.has(uniq)) continue;
      seen.add(uniq);

      let candidateName = line
        .replace(/\!\[[^\]]*\]\([^)]+\)/g, " ")
        .replace(/\[[^\]]*\]\([^)]+\)/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const idx = candidateName.toLowerCase().indexOf("add to compare");
      if (idx >= 0) {
        candidateName = candidateName
          .slice(idx + "add to compare".length)
          .trim();
      }
      candidateName = candidateName
        .replace(/\b[0-5](?:\.[0-9])?\b[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!candidateName) {
        candidateName = modelName;
      }

      out.push({
        slug: "",
        name: candidateName,
        match_name: candidateName,
        rating: Number.isFinite(rating) ? rating : 0,
        rating_count: Number.isFinite(ratingCount) ? ratingCount : 0,
        price_inr: price,
        updated_at: null,
        product_url: productUrl,
        store_name: "Flipkart",
        store_key: "flipkart",
        from_fallback_search: true,
        unavailable,
      });
      if (out.length >= (opts.maxPerModel || 8)) {
        return out;
      }
    }
  }
  return out;
}

function parseIsoToSec(iso) {
  const ms = Date.parse(iso || "");
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function escapeHtml(value) {
  const text = String(value == null ? "" : value);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function matchReasonRank(reason) {
  const key = String(reason || "");
  if (key === "ok") return 5;
  if (key === "core_numeric_miss") return 4;
  if (key === "core_token_miss") return 3;
  if (key === "only_brand") return 2;
  if (key === "brand_miss") return 1;
  return 0;
}

function sellwellScore(candidate, nowSec) {
  const rc = Math.max(0, Number(candidate.rating_count) || 0);
  const rating = Math.max(0, Number(candidate.rating) || 0);
  const updatedSec = parseIsoToSec(candidate.updated_at) || nowSec - 120 * 86400;
  const ageDays = Math.max(0, Math.floor((nowSec - updatedSec) / 86400));
  const recency = Math.max(0, 1 - ageDays / 45);
  return Number((Math.log10(rc + 1) * 2 + rating + recency).toFixed(4));
}

async function getSlugFromProductUrl(productUrl) {
  const url = ensureHttpUrl(productUrl);
  if (!url) {
    return { ok: false, error: "invalid_store_url" };
  }
  const res = await apiPost("/api/product/history/getSlugFromUrl", { purl: url });
  if (!res.ok || !res.data || !res.data.slug) {
    return {
      ok: false,
      error:
        (res.data && res.data.detail && String(res.data.detail)) ||
        `slug_resolve_failed_http_${res.status}`,
    };
  }
  return {
    ok: true,
    slug: String(res.data.slug),
    country_code: res.data.country_code || null,
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
  return {
    ok: true,
    code: String(data.code),
    name: data.name ? String(data.name) : null,
  };
}

function decodePriceHistoryPageDataset(html) {
  const source = String(html || "");
  const keyMatch = source.match(/let\s+CachedKey\s*=\s*'([^']+)'/);
  const dsMatch = source.match(/var\s+PagePriceHistoryDataSet\s*=\s*\"([^\"]+)\"/);
  if (!keyMatch || !dsMatch) {
    return null;
  }
  const key = keyMatch[1];
  const encoded = dsMatch[1];
  let bin = "";
  try {
    bin = Buffer.from(encoded, "base64").toString("binary");
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

async function fetchPriceHistoryAppProductData(code) {
  const pageUrl = `${PRICEHISTORY_APP}/p/${encodeURIComponent(String(code || "").trim())}`;
  const response = await fetch(pageUrl, { method: "GET", cache: "no-cache" });
  if (!response.ok) return null;
  const html = await response.text();
  const data = decodePriceHistoryPageDataset(html);
  if (!data || !data.Price) return null;
  return { code: String(code), page_url: pageUrl, data };
}

async function enrichCandidateByLinkFirst(candidate) {
  const storeUrl = ensureHttpUrl(candidate && candidate.product_url ? candidate.product_url : "");
  let slug = String(candidate && candidate.slug ? candidate.slug : "").trim();
  let resolutionMethod = "deal_slug";
  let resolutionError = null;

  if (storeUrl) {
    const slugRes = await getSlugFromProductUrl(storeUrl);
    if (slugRes.ok && slugRes.slug) {
      slug = slugRes.slug;
      resolutionMethod = "store_url";
    } else if (slugRes.error) {
      resolutionError = slugRes.error;
    }
  }
  if (slug) {
    const historyRes = await apiPost("/api/product/history/updateFromSlug", { slug });
    if (historyRes.ok && historyRes.data) {
      const historyStoreUrl = historyRes.data.url || null;
      return {
        slug,
        resolved_by: resolutionMethod,
        resolved_from_url: storeUrl || null,
        resolve_error: resolutionError,
        product_url: historyStoreUrl || storeUrl,
        store_key: resolveStoreKey(
          historyRes.data.store_name || candidate.store_name || "",
          historyStoreUrl || storeUrl
        ),
        store_product_code: historyRes.data.pid || null,
        current_price_inr: Number(historyRes.data.price),
        current_price_fetched_at: historyRes.data.price_fetched_at || null,
        first_seen_price_at:
          Object.keys(historyRes.data.history || {})
            .map((k) => Number(k))
            .filter((v) => Number.isFinite(v))
            .sort((a, b) => a - b)
            .map((sec) => new Date(sec * 1000).toISOString())[0] || null,
        pricehistory_page_url: `${APP_BASE}/product/${slug}`,
      };
    }
  }

  if (!storeUrl) return null;
  const searchRes = await searchPriceHistoryCodeByUrl(storeUrl);
  if (!searchRes.ok || !searchRes.code) {
    return null;
  }
  const phProduct = await fetchPriceHistoryAppProductData(searchRes.code);
  if (!phProduct || !phProduct.data || !phProduct.data.Price) {
    return null;
  }
  const priceBlock = phProduct.data.Price || {};
  const priceSeries =
    (phProduct.data.History &&
      Array.isArray(phProduct.data.History.Price) &&
      phProduct.data.History.Price) ||
    [];
  const firstPoint = priceSeries
    .filter((x) => x && x.x)
    .sort((a, b) => String(a.x).localeCompare(String(b.x)))[0];
  return {
    slug: searchRes.code,
    resolved_by: "pricehistory_app_url_search",
    resolved_from_url: storeUrl,
    resolve_error: resolutionError,
    product_url: storeUrl,
    store_key: resolveStoreKey(candidate.store_name || "", storeUrl),
    store_product_code:
      (phProduct.data.Main && phProduct.data.Main.ListingId) || null,
    current_price_inr: Number(priceBlock.Price),
    current_price_fetched_at:
      parseDateTimeToIsoWithIndiaOffset(priceBlock.UpdatedOn) ||
      String(priceBlock.UpdatedOn || "") ||
      null,
    first_seen_price_at: firstPoint && firstPoint.x ? `${firstPoint.x}T00:00:00.000Z` : null,
    pricehistory_page_url: phProduct.page_url,
  };
}

function renderHtml(report) {
  const rows = Array.isArray(report.shortlist) ? report.shortlist : [];
  const nearMisses = Array.isArray(report.debug && report.debug.near_misses)
    ? report.debug.near_misses
    : [];
  const poolPreview = Array.isArray(report.launch_pool_preview)
    ? report.launch_pool_preview
    : [];
  const items = rows
    .map((row, i) => {
      const entries = (row.entries || [])
        .map(
          (e) => `<tr>
  <td>${escapeHtml(e.store_key || "-")}</td>
  <td>${escapeHtml(e.variant_signature || "-")}</td>
  <td>${escapeHtml(e.candidate_name || "-")}</td>
  <td>${Number.isFinite(e.price_inr) ? `₹${Math.round(e.price_inr).toLocaleString("en-IN")}` : "-"}</td>
  <td>${Number.isFinite(e.rating) ? e.rating.toFixed(1) : "-"}</td>
  <td>${Number.isFinite(e.rating_count) ? e.rating_count : "-"}</td>
  <td>${Number.isFinite(e.match_score) ? e.match_score.toFixed(4) : "-"}</td>
  <td>${e.sellwell_score}</td>
  <td>${escapeHtml(e.resolved_by || "-")}</td>
  <td>${e.product_url ? `<a href="${escapeHtml(e.product_url)}" target="_blank" rel="noreferrer">Store</a>` : "-"}</td>
  <td>${e.pricehistory_page_url ? `<a href="${escapeHtml(e.pricehistory_page_url)}" target="_blank" rel="noreferrer">History</a>` : "-"}</td>
</tr>`
        )
        .join("");
      return `<section class="card">
  <h3>${i + 1}. ${escapeHtml(row.model_name)} <code>${escapeHtml(row.launch_date_iso || "-")}</code></h3>
  <p>Sources: ${escapeHtml(row.sources.join(", "))} | Best score: ${row.best_sellwell_score}</p>
  <div class="wrap"><table>
    <thead><tr><th>Store</th><th>Variant</th><th>Matched Listing</th><th>Price</th><th>Rating</th><th>Rating Count</th><th>Match</th><th>Sellwell</th><th>Basis</th><th>Store Link</th><th>History</th></tr></thead>
    <tbody>${entries}</tbody>
  </table></div>
</section>`;
    })
    .join("\n");

  const nearMissRows = nearMisses
    .map(
      (x, i) => `<tr>
  <td>${i + 1}</td>
  <td>${escapeHtml(x.model_name || "-")}</td>
  <td>${escapeHtml(x.launch_date_iso || "-")}</td>
  <td>${escapeHtml(x.candidate_name || "-")}</td>
  <td>${escapeHtml(x.candidate_store || "-")}</td>
  <td>${Number.isFinite(x.candidate_price_inr) ? `₹${Math.round(x.candidate_price_inr).toLocaleString("en-IN")}` : "-"}</td>
  <td>${Number.isFinite(x.match_score) ? x.match_score.toFixed(4) : "-"}</td>
  <td>${escapeHtml(x.match_reason || "-")}</td>
</tr>`
    )
    .join("");

  const poolRows = poolPreview
    .map(
      (x, i) => `<tr>
  <td>${i + 1}</td>
  <td>${escapeHtml(x.model_name || "-")}</td>
  <td>${escapeHtml(x.launch_date_iso || "-")}</td>
  <td>${escapeHtml(Array.isArray(x.sources) ? x.sources.join(", ") : "-")}</td>
  <td>${Number.isFinite(x.source_count) ? x.source_count : "-"}</td>
</tr>`
    )
    .join("");

  const emptyState = rows.length
    ? ""
    : `<section class="card">
  <h3>No shortlist rows under current filter</h3>
  <p>Current filter: ₹${report.input.min_price}-${report.input.max_price}, stores=${escapeHtml(
        report.input.stores.join(", ")
      )}, minMatchScore=${report.input.min_match_score}. This usually means those launches do not yet have clear in-store listings in range, or listing titles are still too different.</p>
</section>`;

  const nearMissSection = nearMissRows
    ? `<section class="card">
  <h3>Near-Miss Match Diagnostics</h3>
  <div class="wrap"><table>
    <thead><tr><th>#</th><th>Launch Model</th><th>Launch Date</th><th>Closest Store Listing</th><th>Store</th><th>Price</th><th>Match Score</th><th>Reason</th></tr></thead>
    <tbody>${nearMissRows}</tbody>
  </table></div>
</section>`
    : "";

  const poolSection = `<section class="card">
  <h3>Launch Pool (Recent ${poolPreview.length} models)</h3>
  <div class="wrap"><table>
    <thead><tr><th>#</th><th>Model</th><th>Launch Date</th><th>Sources</th><th>Source Count</th></tr></thead>
    <tbody>${poolRows}</tbody>
  </table></div>
</section>`;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>New Launch Sellwell Screening</title>
<style>
body{margin:0;background:#f4f7fb;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a}
.page{max-width:1200px;margin:20px auto;padding:0 14px}
.top,.card{background:#fff;border:1px solid #dbe3ee;border-radius:10px;padding:12px 14px;margin-top:12px}
h1{margin:0 0 8px 0}.top p{margin:4px 0;color:#475569}.card h3{margin:0 0 8px 0}
code{font-size:12px;color:#334155}.wrap{overflow:auto;border:1px solid #e2e8f0;border-radius:8px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px;border-bottom:1px solid #eef2f7;text-align:left;white-space:nowrap}
th{background:#f8fafc;position:sticky;top:0}
</style></head>
<body><main class="page">
<section class="top">
<h1>New Launch Sellwell Screening</h1>
<p>Generated: ${escapeHtml(report.generated_at)}</p>
<p>Window: ${escapeHtml(report.input.window_months)} months | Stores: ${escapeHtml(
    report.input.stores.join(", ")
  )} | Range: ₹${report.input.min_price}-${report.input.max_price}</p>
<p>Shortlist: ${report.stats.shortlist_models} models</p>
<p>Stats: launch=${report.stats.launch_models} | candidates=${report.stats.deals_candidates} | matched_rows=${report.stats.matched_rows}</p>
</section>
${emptyState}
${items}
${nearMissSection}
${poolSection}
</main></body></html>`;
}

async function main() {
  const args = parseArgs(process.argv);
  const inFile = args.in
    ? path.resolve(String(args.in))
    : path.resolve(process.cwd(), "00_Inbox/new-launch-pool-last-3-months.json");
  const outFile = args.out
    ? path.resolve(String(args.out))
    : path.resolve(process.cwd(), "00_Inbox/new-launch-sellwell-screening.json");
  const htmlOut = args.htmlOut
    ? path.resolve(String(args.htmlOut))
    : outFile.replace(/\.json$/i, ".html");

  const locale = String(args.locale || "en-in").toLowerCase();
  const minPrice = Number(args.minPrice || 20000);
  const maxPrice = Number(args.maxPrice || 40000);
  const topN = Number(args.topN || 20);
  const maxPages = Number(args.maxPages || 200);
  const minMatchScore = Number(args.minMatchScore || 0.35);
  const minRatingCount = Number(args.minRatingCount || 0);
  const maxFallbackRequests = Number(args.maxFallbackRequests || 20);
  const allowedStores = dedupeStrings(
    (splitTokenList(String(args.stores || "")).length
      ? splitTokenList(String(args.stores || ""))
      : DEFAULT_ALLOWED_STORES
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

  const launchPool = JSON.parse(fs.readFileSync(inFile, "utf8"));
  const launchModels = Array.isArray(launchPool.models) ? launchPool.models : [];
  const patterns = mergeLaunchPatterns(launchModels.map((m) => buildLaunchPattern(m)));
  const nowSec = Math.floor(Date.now() / 1000);

  const candidates = await fetchDealsCandidates({
    locale,
    minPrice,
    maxPrice,
    allowedStores,
    maxPages,
  });

  const matched = [];
  const bestByPattern = new Map();
  const modelKeyWithDealMatch = new Set();
  for (const c of candidates) {
    let bestPattern = null;
    let bestScoreObj = null;
    for (const p of patterns) {
      const scoreObj = scoreCandidateToPattern(c.match_name || c.name, p);
      const s = scoreObj.score;
      const prev = bestByPattern.get(p.model_key);
      if (
        !prev ||
        s > prev.match_score ||
        (s === prev.match_score &&
          matchReasonRank(scoreObj.reason) > matchReasonRank(prev.match_reason))
      ) {
        bestByPattern.set(p.model_key, {
          model_key: p.model_key,
          model_name: p.model_name,
          launch_date_iso: p.launch_date_iso || null,
          candidate_name: c.name,
          candidate_store: c.store_key,
          candidate_price_inr: c.price_inr,
          match_score: Number(s.toFixed(4)),
          match_reason: scoreObj.reason || "",
          matched_tokens: scoreObj.matched_tokens || 0,
          matched_numeric_tokens: scoreObj.matched_numeric_tokens || 0,
        });
      }
      if (!bestScoreObj || s > bestScoreObj.score) {
        bestScoreObj = scoreObj;
        bestPattern = p;
      }
    }
    if (!bestPattern || !bestScoreObj || bestScoreObj.score < minMatchScore) continue;
    modelKeyWithDealMatch.add(bestPattern.model_key);
    const score = sellwellScore(c, nowSec);
    if ((Number(c.rating_count) || 0) < minRatingCount) continue;
    const variantSignature = extractVariantSignature(c.match_name || c.name, c.slug);
    matched.push({
      ...c,
      variant_signature: variantSignature,
      match_score: Number(bestScoreObj.score.toFixed(4)),
      match_reason: bestScoreObj.reason || "",
      matched_tokens: bestScoreObj.matched_tokens || 0,
      matched_numeric_tokens: bestScoreObj.matched_numeric_tokens || 0,
      sellwell_score: score,
      launch_model_key: bestPattern.model_key,
      launch_model_name: bestPattern.model_name,
      launch_date_iso: bestPattern.launch_date_iso,
      launch_sources: bestPattern.sources,
    });
  }

  let flipkart_fallback_requests = 0;
  let flipkart_fallback_candidates = 0;
  const fallbackModels = patterns
    .slice()
    .sort((a, b) =>
      String(b.launch_date_iso || "").localeCompare(String(a.launch_date_iso || ""))
    )
    .filter((p) => !modelKeyWithDealMatch.has(p.model_key));

  for (const p of fallbackModels) {
    if (matched.length >= Math.max(topN * 6, 80)) {
      break;
    }
    if (flipkart_fallback_requests >= maxFallbackRequests) {
      break;
    }
    flipkart_fallback_requests += 1;
    const fbCandidates = await fetchFlipkartCandidatesByModel(p.model_name, {
      minPrice,
      maxPrice,
      maxPerModel: 8,
    });
    flipkart_fallback_candidates += fbCandidates.length;
    for (const c of fbCandidates) {
      const scoreObj = scoreCandidateToPattern(c.match_name || c.name, p);
      if (!scoreObj || scoreObj.score < minMatchScore) {
        continue;
      }
      const score = sellwellScore(c, nowSec);
      const variantSignature = extractVariantSignature(c.match_name || c.name, c.slug);
      matched.push({
        ...c,
        variant_signature: variantSignature,
        match_score: Number(scoreObj.score.toFixed(4)),
        match_reason: scoreObj.reason || "",
        matched_tokens: scoreObj.matched_tokens || 0,
        matched_numeric_tokens: scoreObj.matched_numeric_tokens || 0,
        sellwell_score: score,
        launch_model_key: p.model_key,
        launch_model_name: p.model_name,
        launch_date_iso: p.launch_date_iso,
        launch_sources: p.sources,
      });
      const prev = bestByPattern.get(p.model_key);
      if (!prev || scoreObj.score > prev.match_score) {
        bestByPattern.set(p.model_key, {
          model_key: p.model_key,
          model_name: p.model_name,
          launch_date_iso: p.launch_date_iso || null,
          candidate_name: c.name,
          candidate_store: c.store_key,
          candidate_price_inr: c.price_inr,
          match_score: Number(scoreObj.score.toFixed(4)),
          match_reason: scoreObj.reason || "",
          matched_tokens: scoreObj.matched_tokens || 0,
          matched_numeric_tokens: scoreObj.matched_numeric_tokens || 0,
        });
      }
    }
  }

  const bestPerStoreVariantByModel = new Map();
  for (const row of matched) {
    const variantKey = String(row.variant_signature || "STD");
    const key = `${row.launch_model_key}::${row.store_key}::${variantKey}`;
    const prev = bestPerStoreVariantByModel.get(key);
    if (!prev) {
      bestPerStoreVariantByModel.set(key, row);
      continue;
    }
    if (row.sellwell_score > prev.sellwell_score) {
      bestPerStoreVariantByModel.set(key, row);
      continue;
    }
    if (
      row.sellwell_score === prev.sellwell_score &&
      String(row.updated_at || "") > String(prev.updated_at || "")
    ) {
      bestPerStoreVariantByModel.set(key, row);
    }
  }

  const byModel = new Map();
  for (const row of bestPerStoreVariantByModel.values()) {
    const list = byModel.get(row.launch_model_key) || [];
    list.push(row);
    byModel.set(row.launch_model_key, list);
  }

  const shortlist = [];
  for (const [modelKey, list] of byModel.entries()) {
    const sortedEntries = list
      .slice()
      .sort((a, b) => {
        const rankDiff =
          storePriorityRank(a.store_key, priorityMap) -
          storePriorityRank(b.store_key, priorityMap);
        if (rankDiff !== 0) return rankDiff;
        const variantDiff = String(a.variant_signature || "").localeCompare(
          String(b.variant_signature || "")
        );
        if (variantDiff !== 0) return variantDiff;
        if (b.sellwell_score !== a.sellwell_score) {
          return b.sellwell_score - a.sellwell_score;
        }
        return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
      });
    const bestScore = Math.max(...sortedEntries.map((x) => x.sellwell_score));
    shortlist.push({
      model_key: modelKey,
      model_name: sortedEntries[0].launch_model_name,
      launch_date_iso: sortedEntries[0].launch_date_iso || null,
      sources: sortedEntries[0].launch_sources || [],
      best_sellwell_score: Number(bestScore.toFixed(4)),
      entries: sortedEntries.map((x) => ({
        store_key: x.store_key,
        store_name: x.store_name,
        slug: x.slug,
        candidate_name: x.name,
        variant_signature: x.variant_signature || "STD",
        price_inr: x.price_inr,
        rating: Number.isFinite(x.rating) ? x.rating : null,
        rating_count: Number.isFinite(x.rating_count) ? x.rating_count : null,
        updated_at: x.updated_at,
        match_score: x.match_score,
        sellwell_score: x.sellwell_score,
        product_url: x.product_url || null,
        resolved_by: x.product_url ? "deal_url" : "deal_slug",
      })),
    });
  }

  shortlist.sort((a, b) => {
    const scoreDiff = b.best_sellwell_score - a.best_sellwell_score;
    if (scoreDiff !== 0) return scoreDiff;
    return String(b.launch_date_iso || "").localeCompare(String(a.launch_date_iso || ""));
  });

  const finalRows = shortlist.slice(0, topN);
  let enriched_rows = 0;
  let resolved_by_store_url_rows = 0;
  for (const row of finalRows) {
    for (const entry of row.entries) {
      const extra = await enrichCandidateByLinkFirst(entry);
      if (!extra) continue;
      enriched_rows += 1;
      if (extra.resolved_by === "store_url") {
        resolved_by_store_url_rows += 1;
      }
      entry.slug = extra.slug || entry.slug;
      entry.resolved_by = extra.resolved_by || entry.resolved_by || "deal_slug";
      entry.resolved_from_url = extra.resolved_from_url || null;
      entry.resolve_error = extra.resolve_error || null;
      entry.product_url = extra.product_url;
      entry.store_key = extra.store_key || entry.store_key;
      entry.store_product_code = extra.store_product_code;
      entry.current_price_inr = extra.current_price_inr;
      entry.current_price_fetched_at = extra.current_price_fetched_at;
      entry.first_seen_price_at = extra.first_seen_price_at || null;
      entry.pricehistory_page_url = extra.pricehistory_page_url;
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    workflow: "new_launch_sellwell_screening",
    input: {
      in_file: inFile,
      window_months: launchPool.window_months || null,
      match_mode: "link_first",
      locale,
      min_price: minPrice,
      max_price: maxPrice,
      top_n: topN,
      stores: allowedStores,
      prefer_stores: preferStores,
      max_pages: maxPages,
      min_match_score: minMatchScore,
      min_rating_count: minRatingCount,
      max_fallback_requests: maxFallbackRequests,
    },
    stats: {
      launch_models: launchModels.length,
      deals_candidates: candidates.length,
      matched_rows: matched.length,
      matched_models: shortlist.length,
      shortlist_models: finalRows.length,
      enriched_rows,
      resolved_by_store_url_rows,
      flipkart_fallback_requests,
      flipkart_fallback_candidates,
    },
    launch_pool_preview: launchModels
      .slice()
      .sort((a, b) =>
        String(b.first_launch_date_iso || "").localeCompare(String(a.first_launch_date_iso || ""))
      )
      .slice(0, 120)
      .map((m) => ({
        model_name: m.model_name,
        launch_date_iso: m.first_launch_date_iso || null,
        sources: m.sources || [],
        source_count: Number(m.source_count) || 0,
      })),
    debug: {
      near_misses: Array.from(bestByPattern.values())
        .sort((a, b) => {
          if (b.match_score !== a.match_score) return b.match_score - a.match_score;
          const reasonDiff = matchReasonRank(b.match_reason) - matchReasonRank(a.match_reason);
          if (reasonDiff !== 0) return reasonDiff;
          return String(b.launch_date_iso || "").localeCompare(String(a.launch_date_iso || ""));
        })
        .slice(0, 40),
    },
    shortlist: finalRows,
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(htmlOut, renderHtml(report), "utf8");
  console.log(`Saved JSON: ${outFile}`);
  console.log(`Saved HTML: ${htmlOut}`);
  console.log(
    `launch_models=${report.stats.launch_models}, matched_models=${report.stats.matched_models}, shortlist=${report.stats.shortlist_models}`
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
