#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { fetchPriceBeforeHistoryByUrl } = require("./pricebefore_history");

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
const DEFAULT_PM_BRIEF_DELTA_INR = 1000;
const DEFAULT_PM_BRIEF_DELTA_PCT = 5;
const DEFAULT_PM_FRESH_OBS_DAYS = 7;

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
  "zephyr",
  "slipstream",
  "silhouette",
  "arctic",
  "cyber",
  "star",
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

function curlRequest(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = options.headers || {};
  const timeoutSec = Math.max(5, Math.ceil(FETCH_TIMEOUT_MS / 1000));
  const args = [
    "-L",
    "-sS",
    "--compressed",
    "--connect-timeout",
    "5",
    "--max-time",
    String(timeoutSec),
    "-X",
    method,
    url,
  ];
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    args.push("-H", `${key}: ${value}`);
  }
  if (options.body !== undefined && options.body !== null) {
    args.push("--data-raw", String(options.body));
  }
  args.push("-w", "\n__CURL_STATUS__:%{http_code}");
  const result = spawnSync("curl", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: FETCH_TIMEOUT_MS + 8000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(normalizeSpace(result.stderr) || `curl_exit_${result.status}`);
  }
  const text = String(result.stdout || "");
  const marker = "\n__CURL_STATUS__:";
  const idx = text.lastIndexOf(marker);
  if (idx < 0) {
    return { status: 0, bodyText: text };
  }
  return {
    status: Number(text.slice(idx + marker.length).trim()) || 0,
    bodyText: text.slice(0, idx),
  };
}

async function apiRequest(url, options) {
  const ctrl = new AbortController();
  const timeoutMs = FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      cache: "no-cache",
      ...options,
      headers: {
        Auth: makeAuthToken(),
        Accept: "application/json",
        ...(options.headers || {}),
      },
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    try {
      const curlRes = curlRequest(url, {
        method: options && options.method ? options.method : "GET",
        headers: {
          Auth: makeAuthToken(),
          Accept: "application/json",
          ...(options && options.headers ? options.headers : {}),
        },
        body: options && options.body !== undefined ? options.body : undefined,
      });
      const text = curlRes.bodyText;
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (parseErr) {
        data = null;
      }
      return {
        ok: curlRes.status >= 200 && curlRes.status < 300,
        status: curlRes.status,
        data,
        rawText: text,
      };
    } catch (curlErr) {
      if (err && err.name === "AbortError") {
        throw new Error(`fetch_timeout_${timeoutMs}ms`);
      }
      throw curlErr;
    }
  }
  clearTimeout(timer);
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

async function apiPostAbsolute(baseUrl, pathname, formFields) {
  const root = normalizeSpace(baseUrl).replace(/\/+$/, "");
  return apiRequest(`${root}${pathname}`, {
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
    try {
      const curlRes = curlRequest(url, {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!(curlRes.status >= 200 && curlRes.status < 300)) {
        throw new Error(`HTTP ${curlRes.status} for ${url}`);
      }
      return curlRes.bodyText;
    } catch (curlErr) {
      if (err && err.name === "AbortError") {
        throw new Error(`fetch_timeout_${timeoutMs}ms`);
      }
      throw curlErr;
    }
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

function candidateModelGroupKey(candidate) {
  if (!candidate) return "";
  return (
    normalizeSpace(candidate.launch_model_key) ||
    modelGroupKeyFromTitle(candidate.launch_model_name || "") ||
    modelGroupKeyFromTitle(candidate.candidate_name || candidate.raw_line || "") ||
    modelGroupKeyFromTitle(candidate.product_url || "")
  );
}

function candidateVariantLabel(candidate) {
  if (!candidate) return "STD";
  return extractVariantSignature(
    `${candidate.candidate_name || ""} ${candidate.raw_line || ""}`,
    candidate.product_url || ""
  );
}

function productVariantLabel(product) {
  if (!product) return "STD";
  return (
    normalizeSpace(product.variant_label) ||
    extractVariantSignature(
      `${product.candidate_name || product.source_model_name || product.launch_model_name || ""}`,
      `${product.slug || ""} ${product.product_url || ""}`
    )
  );
}

function storageLabelFromVariant(variantLabel) {
  const text = String(variantLabel || "").toUpperCase();
  const match = text.match(/(\d{2,4})(GB|TB)(?!.*\d{2,4}(GB|TB))/);
  if (!match) return "";
  return `${Number(match[1])}${match[2]}`;
}

function candidateStorageLabel(candidate) {
  return storageLabelFromVariant(candidateVariantLabel(candidate));
}

function productStorageLabel(product) {
  return storageLabelFromVariant(productVariantLabel(product));
}

function skuStatus(variantLabel) {
  const label = String(variantLabel || "");
  if (label.startsWith("RAM_UNKNOWN+")) return "needs_review";
  if (label === "STD") return "unknown";
  return "confirmed";
}

function skuStatusLabel(status) {
  const value = String(status || "");
  if (value === "confirmed") return "已确认";
  if (value === "needs_review") return "待补规格";
  if (value === "unknown") return "未知";
  return value || "-";
}

function skuStatusRank(status) {
  const value = String(status || "");
  if (value === "confirmed") return 0;
  if (value === "needs_review") return 1;
  return 2;
}

function currentPriceBasisLabel(value) {
  const text = normalizeSpace(value);
  if (!text) return "-";
  if (text === "forward_monitoring_backbone") return "前向监测";
  if (text === "candidate_file_bootstrap") return "候选池引导";
  if (text === "history_current") return "历史当前价";
  if (text === "flipkart_affiliate_api") return "Flipkart 联盟接口";
  if (text === "browser_flipkart_search") return "候选池快照";
  if (text.startsWith("flipkart_")) return "Flipkart 当前抓取";
  if (text.includes("candidate")) return "候选池快照";
  return humanizeModelKey(text);
}

function displaySku(product) {
  const label = String(product && product.variant_label || "");
  if (label.startsWith("RAM_UNKNOWN+")) {
    return `${label.replace(/^RAM_UNKNOWN\+/, "")}（RAM 待补）`;
  }
  return label || "-";
}

function historySourceLabel(value) {
  const text = normalizeSpace(value);
  if (!text) return "-";
  if (text.startsWith("pricehistory_web_recovery_seed")) return "网页恢复历史";
  if (text.startsWith("smartprix_recovery_seed")) return "Smartprix 恢复历史";
  if (text.startsWith("pricebefore")) return "PriceBefore 历史";
  if (text.startsWith("pricehistory_app")) return "PriceHistory 历史";
  if (text.startsWith("local_resolution_cache")) return "本地历史缓存";
  if (text.startsWith("pricehistory_django")) return "PriceHistory 后端历史";
  return humanizeModelKey(text);
}

function historySourceConfidence(value) {
  const text = normalizeSpace(value);
  if (!text) return "低";
  if (text.startsWith("smartprix_recovery_seed")) return "中";
  if (text.startsWith("pricehistory_web_recovery_seed")) return "中";
  if (text.startsWith("pricebefore")) return "高";
  if (text.startsWith("pricehistory_app")) return "高";
  if (text.startsWith("pricehistory_django")) return "高";
  if (text.startsWith("local_resolution_cache")) return "中";
  return "中";
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

function canonicalStoreProductUrl(inputUrl, opts = {}) {
  const parsed = parseUrlSafe(inputUrl);
  if (!parsed) return ensureHttpUrl(inputUrl);
  const storeKey = normalizeStoreKey(parsed.hostname);
  const pathName = parsed.pathname.replace(/\/+$/, "");
  const keepPid = opts.keepPid !== false;
  if (storeKey === "flipkart") {
    const base = `https://www.flipkart.com${pathName}`;
    const pid = normalizeSpace(parsed.searchParams.get("pid"));
    if (keepPid && pid) {
      return `${base}?pid=${encodeURIComponent(pid)}`;
    }
    return base;
  }
  if (storeKey === "amazon") {
    const asinMatch = pathName.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{8,12})/i);
    if (asinMatch) {
      return `https://www.amazon.in/dp/${asinMatch[1].toUpperCase()}`;
    }
    return `https://www.amazon.in${pathName}`;
  }
  return `${parsed.protocol}//${parsed.hostname}${pathName}`;
}

function productUrlVariants(inputUrl) {
  const raw = ensureHttpUrl(inputUrl);
  if (!raw) return [];
  const parsed = parseUrlSafe(raw);
  if (!parsed) return [raw];
  const storeKey = normalizeStoreKey(parsed.hostname);
  const variants = [raw, canonicalStoreProductUrl(raw, { keepPid: true }), canonicalStoreProductUrl(raw, { keepPid: false })];
  if (storeKey === "flipkart") {
    const pid = normalizeSpace(parsed.searchParams.get("pid"));
    if (pid) {
      variants.push(`https://www.flipkart.com/search?q=${encodeURIComponent(pid)}`);
    }
  }
  return dedupeStrings(variants.filter(Boolean));
}

function productIdentityFromUrl(url) {
  const parsed = parseUrlSafe(url);
  if (!parsed) return normalizeSpace(url);
  const pid = parsed.searchParams.get("pid");
  if (pid) return `${normalizeStoreKey(parsed.hostname)}::${pid}`;
  if (parsed.pathname.replace(/\/+$/, "") === "/search") {
    const q = normalizeSpace(parsed.searchParams.get("q"));
    if (q) return `${normalizeStoreKey(parsed.hostname)}::search::${q}`;
  }
  return `${normalizeStoreKey(parsed.hostname)}::${parsed.pathname.replace(/\/+$/, "")}`;
}

function candidateFamilyKey(candidate) {
  const storeKey = normalizeStoreKey(
    candidate && (candidate.store_key || candidate.store_name || candidate.product_url)
  );
  const modelKey = candidateModelGroupKey(candidate);
  const variantLabel = candidateVariantLabel(candidate);
  const familyKey = [storeKey, modelKey, variantLabel].join("::");
  if (storeKey && modelKey) return familyKey;
  return productIdentityFromUrl(candidate && candidate.product_url);
}

function candidateStorageFamilyKey(candidate) {
  const storeKey = normalizeStoreKey(
    candidate && (candidate.store_key || candidate.store_name || candidate.product_url)
  );
  const modelKey = candidateModelGroupKey(candidate);
  const storageLabel = candidateStorageLabel(candidate);
  if (storeKey && modelKey && storageLabel) {
    return [storeKey, modelKey, storageLabel].join("::");
  }
  return "";
}

function productFamilyKey(product) {
  const storeKey = normalizeStoreKey(
    product && (product.store_key || product.store_name || product.product_url)
  );
  const modelKey =
    normalizeSpace(product && product.variant_group_key) ||
    modelGroupKeyFromTitle(
      (product && (product.source_model_name || product.launch_model_name || product.candidate_name)) ||
        ""
    ) ||
    modelGroupKeyFromTitle((product && product.slug) || "");
  const variantLabel = productVariantLabel(product);
  const familyKey = [storeKey, modelKey, variantLabel].join("::");
  if (storeKey && modelKey) return familyKey;
  return productIdentityFromUrl(product && product.product_url);
}

function productStorageFamilyKey(product) {
  const storeKey = normalizeStoreKey(
    product && (product.store_key || product.store_name || product.product_url)
  );
  const modelKey =
    normalizeSpace(product && product.variant_group_key) ||
    modelGroupKeyFromTitle(
      (product && (product.source_model_name || product.launch_model_name || product.candidate_name)) ||
        ""
    ) ||
    modelGroupKeyFromTitle((product && product.slug) || "");
  const storageLabel = productStorageLabel(product);
  if (storeKey && modelKey && storageLabel) {
    return [storeKey, modelKey, storageLabel].join("::");
  }
  return "";
}

function extractFlipkartCandidatesFromMarkdown(markdown, meta) {
  const out = [];
  const seen = new Set();
  const lines = String(markdown || "").split(/\r?\n/);
  const observedAt = new Date().toISOString();
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
        current_store_observed_at: observedAt,
        current_store_price_basis: meta.source || "flipkart_search",
        current_store_source_file: null,
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
    current_store_observed_at: new Date().toISOString(),
    current_store_price_basis: "flipkart_affiliate_api",
    current_store_source_file: null,
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

function readJsonOrNdjsonMaybe(file) {
  if (!file || !fs.existsSync(file)) return null;
  const resolved = path.resolve(file);
  const text = fs.readFileSync(resolved, "utf8");
  const lower = resolved.toLowerCase();
  if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return JSON.parse(text);
}

function ensureArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.observations)) return payload.observations;
  if (payload && Array.isArray(payload.candidates)) return payload.candidates;
  return [];
}

function normalizeObservationSourceType(value) {
  const text = normalizeText(value).replace(/\s+/g, "_");
  if (text.includes("forward_monitoring_backbone")) return "forward_monitoring_backbone";
  if (text.includes("candidate_file_bootstrap")) return "candidate_file_bootstrap";
  return text || "forward_monitoring_observation";
}

function normalizeForwardObservationRow(row, sourceFile) {
  if (!row || typeof row !== "object") return null;
  const productUrl = ensureHttpUrl(
    row.product_url || row.url || row.link || row.watch_url || row.product_link || ""
  );
  const observedAtRaw =
    row.observed_at || row.checked_at || row.timestamp || row.fetched_at || row.date || "";
  const observedAt = normalizeSpace(observedAtRaw);
  const observedMs = observedAt ? Date.parse(observedAt) : NaN;
  const observedAtIso = Number.isNaN(observedMs) ? "" : new Date(observedMs).toISOString();
  const price = Number(
    String(row.price_inr ?? row.price ?? row.current_price ?? row.detected_price ?? "")
      .replace(/[₹,\s]/g, "")
      .trim()
  );
  if (!productUrl || !observedAtIso || !Number.isFinite(price)) return null;
  const storeKey = normalizeStoreKey(row.store_key || row.store || row.marketplace || productUrl);
  return {
    observed_at: observedAtIso,
    product_url: productUrl,
    canonical_product_url: canonicalStoreProductUrl(productUrl, { keepPid: true }) || productUrl,
    price_inr: price,
    store_key: storeKey,
    availability: normalizeSpace(row.availability || row.stock_status || row.in_stock || "") || null,
    watch_label: normalizeSpace(row.watch_label || row.title || row.candidate_name || row.name || "") || null,
    source_file: sourceFile ? path.resolve(sourceFile) : null,
    source_type: normalizeObservationSourceType(row.source_type || row.source || ""),
  };
}

function observationSourceRank(sourceType) {
  const value = normalizeObservationSourceType(sourceType);
  if (value === "forward_monitoring_backbone") return 2;
  if (value === "candidate_file_bootstrap") return 1;
  return 0;
}

function chooseBetterObservation(prev, next) {
  if (!prev) return next;
  const prevSec = isoToSec(prev.observed_at) || 0;
  const nextSec = isoToSec(next.observed_at) || 0;
  if (nextSec !== prevSec) return nextSec > prevSec ? next : prev;
  const prevRank = observationSourceRank(prev.source_type);
  const nextRank = observationSourceRank(next.source_type);
  if (nextRank !== prevRank) return nextRank > prevRank ? next : prev;
  const prevListed = normalizeText(prev.availability) === "listed" ? 1 : 0;
  const nextListed = normalizeText(next.availability) === "listed" ? 1 : 0;
  if (nextListed !== prevListed) return nextListed > prevListed ? next : prev;
  return prev;
}

function buildForwardObservationIndex(filePath, errors) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      rows: [],
      byIdentity: new Map(),
      totalRows: 0,
      backboneRows: 0,
      bootstrapRows: 0,
    };
  }
  let payload = null;
  try {
    payload = readJsonOrNdjsonMaybe(filePath);
  } catch (err) {
    errors.push(`forward_observation_file_failed ${filePath}: ${String(err.message || err)}`);
    return {
      rows: [],
      byIdentity: new Map(),
      totalRows: 0,
      backboneRows: 0,
      bootstrapRows: 0,
    };
  }
  const rows = ensureArrayPayload(payload)
    .map((row) => normalizeForwardObservationRow(row, filePath))
    .filter(Boolean);
  const byIdentity = new Map();
  for (const row of rows) {
    const variants = productUrlVariants(row.product_url);
    for (const variantUrl of variants) {
      const identity = productIdentityFromUrl(variantUrl);
      if (!identity) continue;
      byIdentity.set(identity, chooseBetterObservation(byIdentity.get(identity), row));
    }
  }
  return {
    rows,
    byIdentity,
    totalRows: rows.length,
    backboneRows: rows.filter((row) => row.source_type === "forward_monitoring_backbone").length,
    bootstrapRows: rows.filter((row) => row.source_type === "candidate_file_bootstrap").length,
  };
}

function lookupForwardObservation(candidate, observationIndex) {
  if (!candidate || !observationIndex || !observationIndex.byIdentity) return null;
  for (const url of candidate.url_variants || productUrlVariants(candidate.product_url)) {
    const hit = observationIndex.byIdentity.get(productIdentityFromUrl(url));
    if (hit) return hit;
  }
  return null;
}

function applyForwardObservationToCandidate(candidate, observation) {
  if (!candidate || !observation) return candidate;
  const currentObservedSec = isoToSec(candidate.current_store_observed_at);
  const nextObservedSec = isoToSec(observation.observed_at);
  if (Number.isFinite(currentObservedSec) && Number.isFinite(nextObservedSec) && currentObservedSec > nextObservedSec) {
    return candidate;
  }
  return {
    ...candidate,
    current_store_price_inr: observation.price_inr,
    availability: observation.availability || candidate.availability,
    current_store_observed_at: observation.observed_at,
    current_store_price_basis: observation.source_type,
    current_store_source_file: observation.source_file || null,
    current_store_watch_label: observation.watch_label || null,
  };
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
  const compatibleCaches = cacheCandidates.filter((row) => row.monthCompatible);
  const partialCaches = cacheCandidates.filter((row) => !row.monthCompatible);
  const cached = compatibleCaches[0] ? compatibleCaches[0].file : null;
  const partialCached = !cached && partialCaches[0] ? partialCaches[0].file : null;
  const partialWindowMonths = partialCaches[0] ? partialCaches[0].windowMonths : null;
  const maxCacheAgeDays = Number(args.launchPoolMaxAgeDays || 7);
  const cachedAgeDays = cached
    ? Math.floor((Date.now() - fs.statSync(cached).mtimeMs) / 86400000)
    : null;
  const partialCachedAgeDays = partialCached
    ? Math.floor((Date.now() - fs.statSync(partialCached).mtimeMs) / 86400000)
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
        status: "cached",
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
      status: "generated",
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
        status: "cached_refresh_failed",
      };
    }
    if (partialCached) {
      return {
        source: JSON.parse(fs.readFileSync(partialCached, "utf8")),
        file: partialCached,
        generated: false,
        error: `launch_pool_partial_cache_used_requested_${months}_months_found_${String(
          partialWindowMonths || "unknown"
        )}_months: ${String(err && err.message ? err.message : err)}`,
        cached: true,
        cache_age_days: partialCachedAgeDays,
        cache_policy: `refresh_failed_partial_window_${String(partialWindowMonths || "unknown")}_of_requested_${months}`,
        partial: true,
        status: "partial_cache",
      };
    }
    return {
      source: { models: [], source_errors: [String(err && err.message ? err.message : err)] },
      file: launchFile,
      generated: false,
      error: String(err && err.message ? err.message : err),
      cached: false,
      status: "unavailable",
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

function classifySensitivityPool(launchDateIso, firstSeenPriceAt) {
  const launchPool = classifyLaunchDate(launchDateIso);
  if (launchDateIso && launchPool !== "control_or_unknown") {
    return { pool: launchPool, basis: "launch_pool" };
  }
  const firstSeenPool = classifyLaunchDate(firstSeenPriceAt);
  if (firstSeenPriceAt && firstSeenPool !== "control_or_unknown") {
    return { pool: firstSeenPool, basis: "pricehistory_first_seen_proxy" };
  }
  return { pool: "control_or_unknown", basis: "unknown" };
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
    const identity = candidateFamilyKey(candidate) || productIdentityFromUrl(candidate.product_url);
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

function chooseBetterLaunchModel(prev, next) {
  if (!prev) return next;
  const prevSources = Array.isArray(prev.sources) ? prev.sources.length : 0;
  const nextSources = Array.isArray(next.sources) ? next.sources.length : 0;
  if (nextSources !== prevSources) return nextSources > prevSources ? next : prev;
  const prevDate = String(prev.first_launch_date_iso || "");
  const nextDate = String(next.first_launch_date_iso || "");
  return nextDate > prevDate ? next : prev;
}

function buildLaunchModelIndex(launchModels) {
  const byKey = new Map();
  for (const row of launchModels || []) {
    const keys = dedupeStrings(
      [
        normalizeSpace(row.model_key),
        modelGroupKeyFromTitle(row.model_name || ""),
        canonicalModelKey(row.model_name || ""),
      ].filter(Boolean)
    );
    for (const key of keys) {
      byKey.set(key, chooseBetterLaunchModel(byKey.get(key), row));
    }
  }
  return byKey;
}

function matchLaunchModel(candidate, launchIndex) {
  if (!candidate || !launchIndex || !launchIndex.size) return null;
  const keys = dedupeStrings(
    [
      normalizeSpace(candidate.launch_model_key),
      candidate.variant_group_key || candidateModelGroupKey(candidate),
      canonicalModelKey(candidate.candidate_name || ""),
      canonicalModelKey(candidate.raw_line || ""),
    ].filter(Boolean)
  );
  for (const key of keys) {
    const exact = launchIndex.get(key);
    if (exact) return exact;
  }
  const familyKey = candidate.variant_group_key || candidateModelGroupKey(candidate);
  if (!familyKey) return null;
  const normalizedFamily = normalizeText(familyKey);
  for (const [key, row] of launchIndex.entries()) {
    const normalizedKey = normalizeText(key);
    if (
      normalizedKey === normalizedFamily ||
      normalizedKey.startsWith(`${normalizedFamily} `) ||
      normalizedFamily.startsWith(`${normalizedKey} `)
    ) {
      return row;
    }
  }
  return null;
}

function applyLaunchModelContext(candidates, launchModels) {
  const launchIndex = buildLaunchModelIndex(launchModels);
  return (candidates || []).map((candidate) => {
    const match = matchLaunchModel(candidate, launchIndex);
    if (!match) return candidate;
    const next = {
      ...candidate,
      launch_model_key: candidate.launch_model_key || match.model_key || null,
      launch_model_name: candidate.launch_model_name || match.model_name || null,
      launch_date_iso: candidate.launch_date_iso || match.first_launch_date_iso || null,
      launch_sources:
        Array.isArray(candidate.launch_sources) && candidate.launch_sources.length
          ? candidate.launch_sources
          : Array.isArray(match.sources)
            ? match.sources
            : [],
    };
    next.variant_group_key = candidateModelGroupKey(next);
    next.variant_label = next.variant_label || candidateVariantLabel(next);
    next.sku_status = skuStatus(next.variant_label);
    return next;
  });
}

function resolutionCacheFiles(outDir) {
  if (!fs.existsSync(outDir)) return [];
  return fs
    .readdirSync(outDir)
    .filter(
      (name) =>
        /^(memory-cost-pass-through|price-status-).+\.json$/.test(name) ||
        /^pricehistory-browser-search-.*\.json$/.test(name) ||
        /^new-launch-sellwell-.*\.json$/.test(name)
    )
    .map((name) => {
      const file = path.join(outDir, name);
      return { file, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 30);
}

function registryProductItems(registry) {
  if (Array.isArray(registry)) {
    return registry.flatMap((item) =>
      Array.isArray(item && item.variants) && item.variants.length ? item.variants : [item]
    );
  }
  if (registry && Array.isArray(registry.products)) {
    return registry.products.flatMap((item) =>
      Array.isArray(item && item.variants) && item.variants.length ? item.variants : [item]
    );
  }
  if (registry && Array.isArray(registry.entries)) {
    return registry.entries.flatMap((item) =>
      Array.isArray(item && item.variants) && item.variants.length ? item.variants : [item]
    );
  }
  return [];
}

function resolutionCacheProductItems(report) {
  if (report && Array.isArray(report.products)) {
    return report.products.flatMap((item) =>
      Array.isArray(item && item.variants) && item.variants.length ? item.variants : [item]
    );
  }
  const items = [];
  for (const row of report && Array.isArray(report.shortlist) ? report.shortlist : []) {
    for (const entry of Array.isArray(row.entries) ? row.entries : []) {
      if (!entry || !entry.product_url || !entry.pricehistory_page_url) continue;
      items.push({
        ...entry,
        candidate_name: entry.candidate_name || row.model_name || entry.slug || "",
        variant_group_key: row.model_key || modelGroupKeyFromTitle(row.model_name || ""),
        launch_model_name: row.model_name || null,
        launch_date_iso: row.launch_date_iso || null,
        launch_sources: row.sources || [],
      });
    }
  }
  return items;
}

function cacheProductRank(product, fileMtimeMs) {
  return isoToSec(product && product.current_price_fetched_at) || Math.floor(fileMtimeMs / 1000);
}

function cacheProductCompleteness(product) {
  if (!product) return 0;
  let score = 0;
  if (normalizeSpace(product.first_seen_price_at)) score += 3;
  if (Number.isFinite(Number(product.lowest_price_inr))) score += 1;
  if (Number.isFinite(Number(product.highest_price_inr))) score += 1;
  if (Array.isArray(product.price_change_events) && product.price_change_events.length) {
    score += 3;
  }
  if (Array.isArray(product.raw_price_points) && product.raw_price_points.length) {
    score += 2;
  }
  if (normalizeSpace(product.current_price_fetched_at)) score += 1;
  if (normalizeSpace(product.pricehistory_page_url)) score += 1;
  return score;
}

function cacheProductSlug(product) {
  const direct = normalizeSpace(product && product.slug);
  if (direct) return direct;
  const pageUrl = ensureHttpUrl(product && product.pricehistory_page_url);
  const parsed = parseUrlSafe(pageUrl || "");
  if (!parsed) return "";
  if (parsed.hostname.includes("pricehistoryapp.com") && parsed.pathname.startsWith("/product/")) {
    return normalizeSpace(parsed.pathname.replace(/^\/product\//, ""));
  }
  return "";
}

function chooseBetterCacheProduct(prev, next, nextRank) {
  if (!prev) return { product: next, rank: nextRank };
  const prevCompleteness = cacheProductCompleteness(prev.product);
  const nextCompleteness = cacheProductCompleteness(next);
  if (nextCompleteness !== prevCompleteness) {
    return nextCompleteness > prevCompleteness
      ? { product: next, rank: nextRank }
      : prev;
  }
  if (nextRank > prev.rank) return { product: next, rank: nextRank };
  return prev;
}

function loadResolutionCache(outDir, registryFile) {
  const byIdentity = new Map();
  const byFamily = new Map();
  const byStorageFamily = new Map();
  const sources = [];
  const recoverySeedFile = registryFile
    ? path.join(path.dirname(path.resolve(registryFile)), "pricehistory_recovery_seed.json")
    : "";
  if (registryFile && fs.existsSync(registryFile)) {
    sources.push({
      file: path.resolve(registryFile),
      mtimeMs: 0,
      sourceType: "registry",
    });
  }
  if (recoverySeedFile && fs.existsSync(recoverySeedFile)) {
    sources.push({
      file: path.resolve(recoverySeedFile),
      mtimeMs: fs.statSync(recoverySeedFile).mtimeMs,
      sourceType: "recovery_seed",
    });
  }
  for (const fileInfo of resolutionCacheFiles(outDir)) {
    sources.push({ ...fileInfo, sourceType: "report_cache" });
  }
  let registryEntries = 0;
  for (const { file, mtimeMs, sourceType } of sources) {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      parsed = null;
    }
    const items =
      sourceType === "registry"
        ? registryProductItems(parsed)
        : resolutionCacheProductItems(parsed);
    if (sourceType === "registry") {
      registryEntries += items.length;
    }
    for (const product of items) {
      const productUrl = ensureHttpUrl(product && product.product_url);
      const slug = cacheProductSlug(product);
      if (!productUrl && !slug) continue;
      const enriched = {
        ...product,
        slug: slug || product.slug || null,
      };
      const rank = cacheProductRank(enriched, mtimeMs);
      const identity = productUrl ? productIdentityFromUrl(productUrl) : "";
      const family = productFamilyKey(enriched);
      const storageFamily = productStorageFamilyKey(enriched);
      if (identity) {
        byIdentity.set(identity, chooseBetterCacheProduct(byIdentity.get(identity), enriched, rank));
      }
      if (family) {
        byFamily.set(family, chooseBetterCacheProduct(byFamily.get(family), enriched, rank));
      }
      if (storageFamily) {
        byStorageFamily.set(
          storageFamily,
          chooseBetterCacheProduct(byStorageFamily.get(storageFamily), enriched, rank)
        );
      }
    }
  }
  return { byIdentity, byFamily, byStorageFamily, registryEntries };
}

function lookupResolutionCache(candidate, resolutionCache) {
  if (!candidate || !resolutionCache) return null;
  for (const url of candidate.url_variants || productUrlVariants(candidate.product_url)) {
    const hit = resolutionCache.byIdentity.get(productIdentityFromUrl(url));
    if (hit && hit.product) {
      return { matchType: "identity", product: hit.product };
    }
  }
  const family = candidateFamilyKey(candidate);
  const familyHit = family ? resolutionCache.byFamily.get(family) : null;
  if (familyHit && familyHit.product) {
    return { matchType: "family", product: familyHit.product };
  }
  const storageFamily = candidateStorageFamilyKey(candidate);
  const storageHit = storageFamily ? resolutionCache.byStorageFamily.get(storageFamily) : null;
  if (storageHit && storageHit.product) {
    return { matchType: "family_storage", product: storageHit.product };
  }
  return null;
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
  const generatedAt = normalizeSpace(report && report.generated_at) || null;
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
        current_store_observed_at: generatedAt,
        current_store_price_basis: "local_new_launch_shortlist_fallback",
        current_store_source_file: null,
      });
    }
  }
  return out;
}

function candidatesFromPriceStatusReport(report, minPrice, maxPrice) {
  const out = [];
  const generatedAt = normalizeSpace(report && report.generated_at) || null;
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
      current_store_observed_at: generatedAt,
      current_store_price_basis: "local_price_status_fallback",
      current_store_source_file: null,
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

function createProviderStats() {
  return {
    candidate_file: { attempted: 0, candidates: 0, errors: 0, used: false },
    flipkart_affiliate_api: { attempted: 0, candidates: 0, skipped: 0, errors: 0 },
    flipkart_page_scrape: { attempted: 0, candidates: 0, errors: 0 },
    forward_monitoring_observations: { attempted: 0, candidates: 0, matched: 0, errors: 0, used: false },
    local_fallback: { candidates: 0, used: false },
  };
}

function emptyStoreCollection() {
  return {
    candidates: [],
    errors: [],
    providerStats: createProviderStats(),
  };
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < String(text || "").length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  const nonEmpty = rows.filter((cells) => cells.some((cell) => normalizeSpace(cell)));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0].map((header) => normalizeText(header).replace(/\s+/g, "_"));
  return nonEmpty.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = cells[idx] || "";
    });
    return obj;
  });
}

function rowValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return "";
}

function candidateFromInputRow(row, idx, minPrice, maxPrice, sourceName) {
  const productUrl = ensureHttpUrl(
    rowValue(row, ["product_url", "url", "link", "store_link", "product_link", "href"])
  );
  const name = normalizeSpace(
    rowValue(row, ["candidate_name", "title", "name", "product_name", "model", "model_name"])
  );
  const rawPrice = rowValue(row, [
    "current_store_price_inr",
    "current_price_inr",
    "price_inr",
    "price",
    "current_price",
  ]);
  const price = Number(String(rawPrice).replace(/[^0-9.]/g, "")) || parseInrNumber(rawPrice);
  if (!productUrl || !name || !Number.isFinite(price)) return null;
  if (price < minPrice || price > maxPrice) return null;
  if (looksLikeNonPhone(name)) return null;
  const storeKey = normalizeStoreKey(
    rowValue(row, ["store_key", "store", "source_store", "marketplace"]) || productUrl
  );
  const candidate = {
    source: sourceName || "candidate_file",
    store_key: storeKey,
    store_name: rowValue(row, ["store_name", "store", "marketplace"]) || storeKey,
    candidate_name: name,
    raw_line: rowValue(row, ["raw_line", "raw_text", "text", "card_text"]) || name,
    product_url: productUrl,
    current_store_price_inr: price,
    rating: Number.isFinite(Number(rowValue(row, ["rating", "stars"])))
      ? Number(rowValue(row, ["rating", "stars"]))
      : null,
    rating_count: Number.isFinite(Number(String(rowValue(row, ["rating_count", "ratings", "review_count"])).replace(/,/g, "")))
      ? Number(String(rowValue(row, ["rating_count", "ratings", "review_count"])).replace(/,/g, ""))
      : null,
    availability: rowValue(row, ["availability", "stock_status"]) || "listed",
    listing_rank: Number(rowValue(row, ["listing_rank", "rank", "position"])) || idx + 1,
    launch_model_key: rowValue(row, ["launch_model_key", "model_key"]) || null,
    launch_model_name: rowValue(row, ["launch_model_name", "model_name"]) || null,
    launch_date_iso: rowValue(row, ["launch_date_iso", "launch_date"]) || null,
    launch_sources: [],
    current_store_observed_at: rowValue(row, ["observed_at", "current_store_observed_at", "fetched_at", "generated_at"]) || null,
    current_store_price_basis: sourceName || "candidate_file",
    current_store_source_file: null,
  };
  candidate.canonical_product_url = canonicalStoreProductUrl(productUrl, { keepPid: true });
  candidate.url_variants = productUrlVariants(productUrl);
  candidate.variant_group_key = candidateModelGroupKey(candidate);
  candidate.variant_label = candidateVariantLabel(candidate);
  candidate.sku_status = skuStatus(candidate.variant_label);
  return candidate;
}

function loadCandidateFileCandidates(filePath, minPrice, maxPrice, errors) {
  const resolved = path.resolve(filePath);
  const text = fs.readFileSync(resolved, "utf8");
  const ext = path.extname(resolved).toLowerCase();
  let rows = [];
  let sourceName = "candidate_file";
  let generatedAt = null;
  if (ext === ".csv") {
    rows = parseCsvRows(text);
    sourceName = "candidate_csv";
  } else {
    const parsed = JSON.parse(text);
    sourceName = parsed.source || parsed.workflow || "candidate_json";
    generatedAt = normalizeSpace(parsed.generated_at || parsed.generatedAt || "") || null;
    rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.candidates)
        ? parsed.candidates
        : Array.isArray(parsed.products)
          ? parsed.products
          : [];
  }
  const out = [];
  for (const row of rows) {
    const candidate = candidateFromInputRow(
      generatedAt && row && typeof row === "object" && !row.generated_at
        ? { ...row, generated_at: generatedAt }
        : row,
      out.length,
      minPrice,
      maxPrice,
      sourceName
    );
    if (candidate) {
      candidate.current_store_source_file = resolved;
    }
    if (candidate) out.push(candidate);
  }
  if (!out.length) {
    errors.push(`candidate_file_no_valid_rows: ${resolved}`);
  }
  return out;
}

async function collectStoreCandidates(launchModels, opts) {
  const errors = [];
  const providerStats = createProviderStats();
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

async function fetchDjangoHistoryBySlug(slug, candidate) {
  const normalizedSlug = normalizeSpace(slug);
  if (!normalizedSlug) return { ok: false, error: "missing_slug" };
  const historyRes = await apiPost("/api/product/history/updateFromSlug", { slug: normalizedSlug });
  if (!historyRes.ok || !historyRes.data) {
    return { ok: false, error: `history_update_failed_http_${historyRes.status}` };
  }
  return {
    ok: true,
    product: summarizeDjangoHistory(normalizedSlug, historyRes.data, candidate),
  };
}

async function fetchDjangoHistoryByUrl(candidate, productUrlOverride) {
  const productUrl = productUrlOverride || candidate.product_url;
  const slugRes = await getSlugFromProductUrl(productUrl);
  if (!slugRes.ok || !slugRes.slug) {
    return { ok: false, error: slugRes.error || "slug_resolve_failed" };
  }
  return fetchDjangoHistoryBySlug(slugRes.slug, {
    ...candidate,
    product_url: productUrl,
  });
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

function decodeLegacyNextData(html) {
  const source = String(html || "");
  const match = source.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    return null;
  }
}

function stripPriceHistoryShortCode(value) {
  const text = normalizeSpace(value);
  if (!text) return "";
  return text.replace(/-[A-Za-z0-9]{6,12}$/, "");
}

function legacyPriceHistoryPageCandidates(pageUrl) {
  const parsed = parseUrlSafe(pageUrl || "");
  if (!parsed) return [];
  const urls = [];
  if (
    parsed.hostname.includes("pricehistoryapp.com") &&
    parsed.pathname.startsWith("/product/")
  ) {
    urls.push(`${APP_BASE}${parsed.pathname}`);
  }
  if (parsed.hostname.includes("pricehistory.app") && parsed.pathname.startsWith("/p/")) {
    const encodedSlug = normalizeSpace(parsed.pathname.replace(/^\/p\//, ""));
    const decodedSlug = decodeURIComponent(encodedSlug);
    const stripped = stripPriceHistoryShortCode(decodedSlug);
    if (decodedSlug) {
      urls.push(`${APP_BASE}/product/${encodeURIComponent(decodedSlug)}`);
    }
    if (stripped) {
      urls.push(`${APP_BASE}/product/${encodeURIComponent(stripped)}`);
    }
  }
  return dedupeStrings(urls);
}

async function fetchLegacyProductHistoryByPageUrl(pageUrl, candidate) {
  const normalizedUrl = ensureHttpUrl(pageUrl);
  if (!normalizedUrl) {
    return { ok: false, error: "invalid_legacy_pricehistory_page_url" };
  }
  const html = await fetchText(normalizedUrl);
  const nextData = decodeLegacyNextData(html);
  const pageProps =
    nextData && nextData.props && nextData.props.pageProps ? nextData.props.pageProps : null;
  const ogProduct = pageProps && pageProps.ogProduct ? pageProps.ogProduct : null;
  const canonicalSlug = normalizeSpace(ogProduct && ogProduct.slug);
  const apiUrl = normalizeSpace((pageProps && pageProps.apiUrl) || API_BASE);
  if (!canonicalSlug) {
    return { ok: false, error: "legacy_next_data_missing_slug" };
  }
  const historyRes = await apiPostAbsolute(apiUrl, "/api/product/history/updateFromSlug", {
    slug: canonicalSlug,
  });
  if (!historyRes.ok || !historyRes.data) {
    return {
      ok: false,
      error:
        historyRes.rawText && normalizeSpace(historyRes.rawText)
          ? `legacy_history_failed_http_${historyRes.status}:${normalizeSpace(historyRes.rawText).slice(0, 120)}`
          : `legacy_history_failed_http_${historyRes.status}`,
    };
  }
  const product = summarizeDjangoHistory(canonicalSlug, historyRes.data, {
    ...candidate,
    product_url:
      normalizeSpace(historyRes.data.url) ||
      normalizeSpace(ogProduct && ogProduct.url) ||
      candidate.product_url,
    store_name:
      normalizeSpace(ogProduct && ogProduct.store && ogProduct.store.name) ||
      candidate.store_name,
  });
  product.pricehistory_page_url = `${APP_BASE}/product/${canonicalSlug}`;
  product.price_source = `${product.price_source || "django_prixhistory"}_legacy_page`;
  return { ok: true, product };
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

async function fetchPriceHistoryAppByCode(code, candidate) {
  const normalizedCode = normalizeSpace(code);
  if (!normalizedCode) {
    return { ok: false, error: "missing_pricehistory_code" };
  }
  const pageUrl = `${PRICEHISTORY_APP}/p/${encodeURIComponent(normalizedCode)}`;
  const html = await fetchText(pageUrl);
  const data = decodePriceHistoryPageDataset(html);
  if (!data || !data.Price) {
    return { ok: false, error: "pricehistory_app_dataset_missing" };
  }
  return {
    ok: true,
    product: pageHistoryProduct(normalizedCode, pageUrl, data, candidate),
  };
}

async function fetchPriceHistoryAppByUrl(candidate, productUrlOverride) {
  const searchRes = await searchPriceHistoryCodeByUrl(productUrlOverride || candidate.product_url);
  if (!searchRes.ok || !searchRes.code) {
    return { ok: false, error: searchRes.error || "pricehistory_app_search_failed" };
  }
  return fetchPriceHistoryAppByCode(searchRes.code, {
    ...candidate,
    product_url: productUrlOverride || candidate.product_url,
  });
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

async function safeResolveAttempt(fn) {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function summarizeAttempt(method, input, result) {
  const status = result && result.ok ? "ok" : "failed";
  return `${method}(${input})=${status}${result && result.error ? `:${result.error}` : ""}`;
}

async function resolvePriceHistory(candidate, resolverCtx = {}) {
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
  const attempts = [];
  const resolutionCache = resolverCtx.resolutionCache || null;
  const cacheHit = lookupResolutionCache(candidate, resolutionCache);
  const urlVariants = candidate.url_variants || productUrlVariants(candidate.product_url);
  if (resolverCtx.cacheOnly && cacheHit && cacheHit.product) {
    return {
      ok: true,
      product: {
        ...cacheHit.product,
        slug: cacheProductSlug(cacheHit.product) || cacheHit.product.slug || null,
        resolve_strategy: `local_cache_${cacheHit.matchType}`,
        resolved_from_cache: true,
        price_source: `${cacheHit.product.price_source || "local_resolution_cache"}_cached`,
      },
    };
  }
  if (resolverCtx.cacheOnly) {
    return {
      ok: false,
      error: `${candidate.candidate_name}: cache_only_no_resolution_cache_match`,
    };
  }
  for (const productUrl of urlVariants) {
    const priceBefore = await safeResolveAttempt(() =>
      fetchPriceBeforeHistoryByUrl(
        { ...candidate, product_url: productUrl },
        { timeoutMs: FETCH_TIMEOUT_MS }
      )
    );
    attempts.push(summarizeAttempt("pricebefore_search", productUrl, priceBefore));
    if (priceBefore.ok) {
      priceBefore.product.resolve_strategy = "pricebefore_store_url_search";
      return priceBefore;
    }
  }
  if (cacheHit && cacheHit.product && cacheProductSlug(cacheHit.product)) {
    const cachedSlug = cacheProductSlug(cacheHit.product);
    const refreshBySlug = await safeResolveAttempt(() =>
      fetchDjangoHistoryBySlug(cachedSlug, candidate)
    );
    attempts.push(summarizeAttempt(`cache_slug_${cacheHit.matchType}`, cachedSlug, refreshBySlug));
    if (refreshBySlug.ok) {
      refreshBySlug.product.resolve_strategy = `cache_slug_refresh_${cacheHit.matchType}`;
      return refreshBySlug;
    }
    const appByCode = await safeResolveAttempt(() =>
      fetchPriceHistoryAppByCode(cachedSlug, candidate)
    );
    attempts.push(summarizeAttempt(`cache_code_${cacheHit.matchType}`, cachedSlug, appByCode));
    if (appByCode.ok) {
      appByCode.product.resolve_strategy = `cache_code_refresh_${cacheHit.matchType}`;
      appByCode.product.resolve_warning = refreshBySlug.error || null;
      return appByCode;
    }
    for (const legacyPageUrl of legacyPriceHistoryPageCandidates(cacheHit.product.pricehistory_page_url)) {
      const legacyByPage = await safeResolveAttempt(() =>
        fetchLegacyProductHistoryByPageUrl(legacyPageUrl, candidate)
      );
      attempts.push(
        summarizeAttempt(`legacy_page_${cacheHit.matchType}`, legacyPageUrl, legacyByPage)
      );
      if (legacyByPage.ok) {
        legacyByPage.product.resolve_strategy = `legacy_page_refresh_${cacheHit.matchType}`;
        legacyByPage.product.resolve_warning =
          [refreshBySlug.error, appByCode.error].filter(Boolean).join(" | ") || null;
        return legacyByPage;
      }
    }
  }

  for (const productUrl of urlVariants) {
    const django = await safeResolveAttempt(() =>
      fetchDjangoHistoryByUrl(candidate, productUrl)
    );
    attempts.push(summarizeAttempt("store_url", productUrl, django));
    if (django.ok) {
      django.product.resolve_strategy = "store_url";
      return django;
    }
  }
  if (resolverCtx.enablePricehistorySearch) {
    for (const productUrl of urlVariants) {
      const app = await safeResolveAttempt(() =>
        fetchPriceHistoryAppByUrl(candidate, productUrl)
      );
      attempts.push(summarizeAttempt("pricehistory_search", productUrl, app));
      if (app.ok) {
        app.product.resolve_strategy = "pricehistory_url_search";
        return app;
      }
    }
  }

  if (cacheHit && cacheHit.product) {
    return {
      ok: true,
      product: {
        ...cacheHit.product,
        slug: cacheProductSlug(cacheHit.product) || cacheHit.product.slug || null,
        resolve_strategy: `local_cache_${cacheHit.matchType}`,
        resolve_warning: attempts.join(" | "),
        resolved_from_cache: true,
        price_source: `${cacheHit.product.price_source || "local_resolution_cache"}_cached`,
      },
    };
  }
  return {
    ok: false,
    error: `${candidate.candidate_name}: ${attempts.join(" | ") || "pricehistory_resolve_failed"}`,
  };
}

function unresolvedCandidateRow(candidate, error) {
  return {
    candidate_name: candidate.candidate_name || "",
    product_url: candidate.product_url || "",
    store_key: candidate.store_key || "",
    store_name: candidate.store_name || "",
    current_store_price_inr: Number(candidate.current_store_price_inr) || null,
    listing_rank: Number(candidate.listing_rank) || null,
    variant_group_key: candidate.variant_group_key || candidateModelGroupKey(candidate),
    variant_label: candidate.variant_label || candidateVariantLabel(candidate),
    sku_status: candidate.sku_status || skuStatus(candidate.variant_label || candidateVariantLabel(candidate)),
    raw_line: candidate.raw_line || "",
    resolution_error: error || "",
  };
}

function mergeCandidateContext(product, candidate) {
  const title = normalizeSpace(
    candidate.candidate_name || product.fallback_title || product.slug
  );
  const variantLabel = extractVariantSignature(
    `${title} ${candidate.raw_line || ""}`,
    `${product.slug} ${product.product_url}`
  );
  const groupKey =
    candidate.launch_model_key ||
    modelGroupKeyFromTitle(candidate.launch_model_name || title) ||
    modelGroupKeyFromTitle(product.slug);
  const launchDateIso = candidate.launch_date_iso || null;
  const sensitivity = classifySensitivityPool(launchDateIso, product.first_seen_price_at);
  return {
    ...product,
    candidate_name: title,
    current_store_price_inr: candidate.current_store_price_inr,
    current_store_observed_at: candidate.current_store_observed_at || null,
    current_store_price_basis: candidate.current_store_price_basis || null,
    current_store_source_file: candidate.current_store_source_file || null,
    current_store_watch_label: candidate.current_store_watch_label || null,
    listing_rank: candidate.listing_rank || null,
    rating: candidate.rating,
    rating_count: candidate.rating_count,
    sellwell_score: candidate.sellwell_score,
    availability: candidate.availability,
    source: candidate.source,
    launch_model_name: candidate.launch_model_name || null,
    launch_date_iso: launchDateIso,
    launch_sources: candidate.launch_sources || [],
    sensitivity_pool: sensitivity.pool,
    sensitivity_basis: sensitivity.basis,
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

function compareProductsForRanking(a, b) {
  const statusDiff =
    statusRank(a.memory_analysis && a.memory_analysis.status) -
    statusRank(b.memory_analysis && b.memory_analysis.status);
  if (statusDiff !== 0) return statusDiff;
  const poolDiff = poolRank(a.sensitivity_pool) - poolRank(b.sensitivity_pool);
  if (poolDiff !== 0) return poolDiff;
  const skuDiff = skuStatusRank(a.sku_status) - skuStatusRank(b.sku_status);
  if (skuDiff !== 0) return skuDiff;
  return (Number(b.sellwell_score) || 0) - (Number(a.sellwell_score) || 0);
}

function modelFamilyDisplayName(product) {
  return (
    normalizeSpace(product && product.launch_model_name) ||
    normalizeSpace(product && product.source_model_name) ||
    humanizeModelKey(product && product.variant_group_key) ||
    normalizeSpace(product && product.candidate_name) ||
    normalizeSpace(product && product.slug) ||
    "Unknown model"
  );
}

function familySkuStatus(variants) {
  const statuses = dedupeStrings((variants || []).map((item) => item.sku_status).filter(Boolean));
  if (!statuses.length) return "unknown";
  if (statuses.every((status) => status === "confirmed")) return "confirmed";
  if (statuses.some((status) => status === "needs_review")) return "needs_review";
  return "unknown";
}

function bestSensitivityPool(variants) {
  return (variants || [])
    .map((item) => item.sensitivity_pool || "control_or_unknown")
    .sort((a, b) => poolRank(a) - poolRank(b))[0] || "control_or_unknown";
}

function bestSensitivityBasis(variants) {
  const ranked = (variants || [])
    .slice()
    .sort((a, b) => poolRank(a.sensitivity_pool) - poolRank(b.sensitivity_pool));
  return normalizeSpace(ranked[0] && ranked[0].sensitivity_basis) || "unknown";
}

function buildModelFamilies(products, priorityMap) {
  const byFamily = new Map();
  for (const product of products || []) {
    const key = normalizeSpace(product.variant_group_key || product.slug || product.candidate_name);
    const list = byFamily.get(key) || [];
    list.push(product);
    byFamily.set(key, list);
  }

  return Array.from(byFamily.entries()).map(([familyKey, list]) => {
    const variants = list.slice().sort(compareProductsForRanking);
    const primary = variants[0];
    const launchCarrier =
      variants.find((item) => normalizeSpace(item.launch_date_iso)) || primary;
    return {
      ...primary,
      family_key: familyKey,
      family_name: modelFamilyDisplayName(primary),
      family_variant_count: variants.length,
      sensitivity_pool: bestSensitivityPool(variants),
      sensitivity_basis: bestSensitivityBasis(variants),
      launch_date_iso: launchCarrier.launch_date_iso || null,
      launch_model_name: launchCarrier.launch_model_name || primary.launch_model_name || null,
      launch_sources:
        Array.isArray(launchCarrier.launch_sources) && launchCarrier.launch_sources.length
          ? launchCarrier.launch_sources
          : primary.launch_sources || [],
      sku_status: familySkuStatus(variants),
      variant_labels: dedupeStrings(variants.map((item) => displaySku(item)).filter(Boolean)),
      variants,
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
  const historyCurrentPrice = Number(product.current_price_inr);
  const liveStorePrice = Number(product.current_store_price_inr);
  const liveStoreBasis = normalizeSpace(product.current_store_price_basis) || "live_store";
  const currentPrice = Number.isFinite(liveStorePrice)
    ? liveStorePrice
    : Number.isFinite(historyCurrentPrice)
      ? historyCurrentPrice
      : null;
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
    current_price_basis: Number.isFinite(liveStorePrice) ? liveStoreBasis : "history_current",
    history_current_price_inr: Number.isFinite(historyCurrentPrice) ? historyCurrentPrice : null,
    live_store_price_inr: Number.isFinite(liveStorePrice) ? liveStorePrice : null,
    live_store_observed_at: normalizeSpace(product.current_store_observed_at) || null,
    live_store_availability: normalizeSpace(product.availability) || null,
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
    variant_products: 0,
    multi_variant_models: 0,
    sustained_increase: 0,
    possible_increase: 0,
    current_above_baseline: 0,
    no_increase_detected: 0,
    insufficient_history: 0,
    stale_history: 0,
    history_backfill_pending: 0,
    sku_needs_review: 0,
    high_sensitive: 0,
    restock_sensitive: 0,
    control: 0,
    control_or_unknown: 0,
  };
  for (const product of products) {
    const variants = Array.isArray(product.variants) && product.variants.length
      ? product.variants
      : [product];
    summary.variant_products += variants.length;
    if (variants.length > 1) summary.multi_variant_models += 1;
    const status = String(product.memory_analysis && product.memory_analysis.status || "");
    if (status.includes("sustained_increase")) summary.sustained_increase += 1;
    else if (status.includes("possible_increase")) summary.possible_increase += 1;
    else if (status.includes("current_above_baseline")) summary.current_above_baseline += 1;
    else if (status.includes("no_increase_detected")) summary.no_increase_detected += 1;
    else if (status.includes("insufficient")) summary.insufficient_history += 1;
    if (product.memory_analysis && product.memory_analysis.stale_history) {
      summary.stale_history += 1;
    }
    if (productHistoryBackfillPending(product)) {
      summary.history_backfill_pending += 1;
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
  const liveProviders = ["candidate_file", "flipkart_affiliate_api", "flipkart_page_scrape"];
  return liveProviders.reduce(
    (sum, name) => sum + (Number(providerStats && providerStats[name] && providerStats[name].candidates) || 0),
    0
  );
}

function variantHasUsableHistory(product) {
  return Boolean(
    Number(product && product.raw_point_count) > 0 ||
      (Array.isArray(product && product.raw_price_points) && product.raw_price_points.length > 0) ||
      normalizeSpace(product && product.first_seen_price_at)
  );
}

function productHasUsableHistory(product) {
  const variants =
    Array.isArray(product && product.variants) && product.variants.length
      ? product.variants
      : [product];
  return variants.some((variant) => variantHasUsableHistory(variant));
}

function productHistoryBackfillPending(product) {
  return Boolean(product && !productHasUsableHistory(product));
}

function buildDataHealth(report) {
  const providerStats = (report.stats && report.stats.provider_stats) || {};
  const liveCandidates = providerLiveCandidateCount(providerStats);
  const fallbackUsed = Boolean(providerStats.local_fallback && providerStats.local_fallback.used);
  const products = Number(report.stats && report.stats.products) || 0;
  const cachedHistoryProducts = Number(report.stats && report.stats.cached_history_products) || 0;
  const storeCandidates = Number(report.stats && report.stats.store_candidates) || 0;
  const candidateModelGroups = Number(report.stats && report.stats.candidate_model_groups) || 0;
  const launchPoolStatus = String(report.input && report.input.launch_pool_status || "");
  const launchPoolPartial = Boolean(report.input && report.input.launch_pool_partial);
  const expectedProducts = Math.min(
    Number(report.input && report.input.top_n) || candidateModelGroups || storeCandidates,
    candidateModelGroups || storeCandidates || Number(report.input && report.input.top_n) || 0
  );
  const insufficientHistory = Number(report.summary && report.summary.insufficient_history) || 0;
  const staleHistories = Number(report.summary && report.summary.stale_history) || 0;
  const historyBackfillPending = Number(report.summary && report.summary.history_backfill_pending) || 0;
  const skuNeedsReview = Number(report.summary && report.summary.sku_needs_review) || 0;
  const controlOrUnknown = Number(report.summary && report.summary.control_or_unknown) || 0;
  const unresolvedCandidates = Number(report.stats && report.stats.unresolved_candidates) || 0;
  const allStale = products > 0 && staleHistories === products;
  const allSensitivityUnknown = products > 0 && controlOrUnknown === products;
  const underResolved =
    liveCandidates > 0 && expectedProducts > 0 && products < expectedProducts;
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
  if (underResolved) {
    blockers.push(
      `Only ${products} of ${expectedProducts} live candidates resolved to usable price histories.`
    );
  }
  if (allStale) {
    blockers.push("All price histories are stale against the configured freshness threshold.");
  }
  if (insufficientHistory > 0) {
    blockers.push(
      `${insufficientHistory} 个已建档机型仍缺可用历史，在补齐前只能作为观察名单使用。`
    );
  }
  if (skuNeedsReview > 0) {
    blockers.push("部分 SKU 的 RAM/ROM 仍待补，需人工复核。");
  }
  if (allSensitivityUnknown) {
    blockers.push("所有机型仍落在 control_or_unknown 敏感池，解释力度有限。");
  }
  if (historyBackfillPending > 0) {
    blockers.push(
      `${historyBackfillPending} 个机型虽然已建档，但仍需要补历史回填。`
    );
  }
  if (unresolvedCandidates > 0) {
    blockers.push(
      `${unresolvedCandidates} 个候选机型仍需要补 PriceHistory 映射。`
    );
  }
  if (launchPoolPartial || launchPoolStatus === "partial_cache") {
    blockers.push("新品池回退到了较小缓存窗口，敏感度标签仅部分可用。");
  } else if (launchPoolStatus === "unavailable") {
    blockers.push("新品池当前不可用，上市敏感度标签缺失。");
  }

  let status = "healthy";
  if (products <= 0) {
    status = "failed";
  } else if (
    liveCandidates <= 0 ||
    fallbackUsed ||
    allStale ||
    underResolved ||
    insufficientHistory > 0 ||
    skuNeedsReview >= Math.max(1, Math.ceil(products / 2)) ||
    allSensitivityUnknown ||
    historyBackfillPending > 0 ||
    unresolvedCandidates > 0 ||
    launchPoolPartial ||
    launchPoolStatus === "unavailable"
  ) {
    status = "degraded";
  }

  return {
    status,
    label:
      status === "healthy"
        ? "健康"
        : status === "degraded"
          ? "降级"
          : "失败",
    official_top10: status === "healthy",
    live_current_store_candidates: liveCandidates,
    fallback_used: fallbackUsed,
    all_histories_stale: allStale,
    blockers,
  };
}

function buildScraplingStyleContract(report) {
  const providerStats = (report.stats && report.stats.provider_stats) || {};
  const dataHealth = report.data_health || buildDataHealth(report);
  const providers = [
    {
      name: "candidate_file",
      role: "静态候选源",
      owns: "预先采集好的当前商城候选文件。",
      status: providerStats.candidate_file && providerStats.candidate_file.used ? "已使用" : "可用",
      candidates: Number(providerStats.candidate_file && providerStats.candidate_file.candidates) || 0,
    },
    {
      name: "flipkart_affiliate_api",
      role: "静态候选源",
      owns: "有联盟凭证时的 Flipkart 候选发现。",
      status:
        providerStats.flipkart_affiliate_api && providerStats.flipkart_affiliate_api.skipped
          ? "已跳过"
          : "已尝试",
      candidates: Number(providerStats.flipkart_affiliate_api && providerStats.flipkart_affiliate_api.candidates) || 0,
    },
    {
      name: "flipkart_page_scrape",
      role: "浏览器或页面抓取",
      owns: "从 Flipkart 页面或搜索结果提取当前候选。",
      status:
        providerStats.flipkart_page_scrape && providerStats.flipkart_page_scrape.errors
          ? "降级"
          : "已尝试",
      candidates: Number(providerStats.flipkart_page_scrape && providerStats.flipkart_page_scrape.candidates) || 0,
    },
    {
      name: "forward_monitoring_observations",
      role: "当前价观测器",
      owns: "本地直连商城价格观测，可覆盖过旧的候选快照价。",
      status:
        providerStats.forward_monitoring_observations &&
        providerStats.forward_monitoring_observations.used
          ? "已使用"
          : providerStats.forward_monitoring_observations &&
              providerStats.forward_monitoring_observations.attempted
            ? "可用"
            : "未加载",
      candidates:
        Number(
          providerStats.forward_monitoring_observations &&
            providerStats.forward_monitoring_observations.matched
        ) || 0,
    },
    {
      name: "local_fallback",
      role: "兜底抓取器",
      owns: "仅用于观察名单连续性，不能单独证明正式当前 Top10。",
      status: providerStats.local_fallback && providerStats.local_fallback.used ? "已使用" : "未使用",
      candidates: Number(providerStats.local_fallback && providerStats.local_fallback.candidates) || 0,
    },
    {
      name: "pricehistory_registry",
      role: "解析缓存",
      owns: "已知商城链接到 PriceHistory 的映射，以及缓存历史恢复。",
      status: Number(report.stats && report.stats.registry_entries) > 0 ? "可用" : "为空",
      candidates: Number(report.stats && report.stats.registry_entries) || 0,
    },
    {
      name: "pricehistory_live_resolution",
      role: "历史抓取器",
      owns: "基于链接的 PriceHistory 解析与完整历史载荷提取。",
      status: Number(report.stats && report.stats.unresolved_candidates) > 0 ? "降级" : "已解析",
      candidates: Number(report.stats && report.stats.resolved_products_before_sku_merge) || 0,
    },
  ];

  return {
    intent: "面向内存成本传导监测器的抓取器 -> 响应 -> 健康度契约。",
    response_contract: [
      "候选机型身份与商城链接",
      "抓取器或 provider 名称",
      "当前价来源与观测时间",
      "PriceHistory 页面链接或未解析原因",
      "原始价格点与历史新鲜度",
      "SKU 归一状态",
      "data_health 状态与阻塞项",
      "JSON/HTML 产物路径",
    ],
    providers,
    gates: {
      hard_failure: [
        "进程非零退出",
        "products <= 0",
        "缺最终 JSON 或 HTML 产物",
        "data_health.status == failed",
      ],
      degraded_not_official_top10: [
        "使用了本地 fallback",
        "仍有 unresolved 候选",
        "历史全部偏旧",
        "解析出的候选数低于预期 topN 或机型组数",
        "SKU 或上市敏感度仍待复核",
      ],
    },
    current_health: {
      status: dataHealth.status,
      official_top10: Boolean(dataHealth.official_top10),
      live_current_store_candidates: Number(dataHealth.live_current_store_candidates) || 0,
      fallback_used: Boolean(dataHealth.fallback_used),
      blockers: dataHealth.blockers || [],
    },
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
  if (value.includes("sustained_increase")) return "持续上调";
  if (value.includes("possible_increase")) return "疑似上调";
  if (value.includes("current_above_baseline")) return "当前高于基准";
  if (value.includes("no_increase_detected")) return "未见明显上调";
  if (value.includes("insufficient")) return "历史不足";
  return value || "-";
}

function daysBetweenIso(laterIso, earlierIso) {
  const later = isoToSec(laterIso);
  const earlier = isoToSec(earlierIso);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return null;
  return Math.max(0, Math.floor((later - earlier) / 86400));
}

function availabilityLabel(value) {
  const text = normalizeText(value);
  if (!text) return "-";
  if (text.includes("out_of_stock") || text.includes("out of stock")) return "缺货";
  if (text.includes("unavailable")) return "不可售";
  if (text.includes("listed")) return "在售";
  return humanizeModelKey(text);
}

function sensitivityPoolLabel(value) {
  const text = normalizeText(value);
  if (!text) return "-";
  if (text === "high_sensitive") return "高敏感";
  if (text === "restock_sensitive") return "补货敏感";
  if (text === "control_or_unknown") return "对照/待定";
  return humanizeModelKey(text);
}

function movementDirectionLabel(direction) {
  if (direction === "up") return "高于基准价";
  if (direction === "down") return "低于基准价";
  if (direction === "flat") return "无明显变化";
  return "历史不足";
}

function currentSignalReason(product, signal) {
  const analysis = product.memory_analysis || {};
  const availability = normalizeText(analysis.live_store_availability || product.availability || "");
  const stale = Boolean(signal && signal.stale_history);
  if (!signal || signal.direction === "missing") {
    return "还没有可用基准价，这个机型仍需要补历史或补映射后才能判断价格动作。";
  }
  if (signal.direction === "up") {
    if (availability.includes("out_of_stock") || availability.includes("unavailable")) {
      return "当前价格高于基准价，但链接处于缺货或不可售状态，更像卖家或库存状态变化，不一定是干净的市场调价。";
    }
    if (product.sensitivity_pool === "high_sensitive") {
      return stale
        ? "方向上看像是早期机型的上调，但支持这个判断的历史已经偏旧。"
        : "更像早期机型的正式上调，是当前最值得关注的成本传导信号。";
    }
    if (product.sensitivity_pool === "restock_sensitive") {
      return stale
        ? "方向上看像是补货敏感机型的上调，但支持这个判断的历史已经偏旧。"
        : "更像补货敏感机型的上调，可能与补货批次或渠道重定价有关。";
    }
    return stale
      ? "当前价格高于基准价，但因为历史偏旧，建议只作为方向性信号理解。"
      : "当前价格高于基准价，可能反映渠道重定价，建议继续看后续观测是否延续。";
  }
  if (signal.direction === "down") {
    if (availability.includes("out_of_stock") || availability.includes("unavailable")) {
      return "当前价格低于基准价，但链接并非正常在售，未必能当成有效的市场降价动作。";
    }
    if (product.sensitivity_pool === "restock_sensitive" || product.sensitivity_pool === "high_sensitive") {
      return stale
        ? "方向上更像促销、清库存或渠道修正，但支持这个判断的历史已经偏旧。"
        : "更像促销、清库存或渠道修正，不太像成本传导。";
    }
    return stale
      ? "当前价格低于基准价，但支持这个判断的历史已经偏旧。"
      : "当前价格低于基准价，更像促销或上市后的常规降价。";
  }
  return stale
    ? "相对基准价没有明显变化，但支持这个判断的历史已经偏旧。"
    : "相对基准价没有明显变化。";
}

function deriveCurrentSignal(product, opts) {
  const analysis = product.memory_analysis || {};
  const current = Number(analysis.current_price_inr);
  const baseline = Number(analysis.baseline_price_inr);
  const delta = Number(analysis.current_vs_baseline_inr);
  const pct = Number(analysis.current_vs_baseline_pct);
  const absDelta = Math.abs(delta);
  const absPct = Math.abs(pct);
  const meetsThreshold =
    (Number.isFinite(absDelta) && absDelta >= opts.minDeltaInr) ||
    (Number.isFinite(absPct) && absPct >= opts.minDeltaPct);
  const observationAt = normalizeSpace(
    analysis.live_store_observed_at || product.current_store_observed_at || ""
  ) || null;
  const observationAgeDays = observationAt
    ? daysBetweenIso(opts.generatedAt, observationAt)
    : null;
  const freshObservation =
    Number.isFinite(observationAgeDays) && observationAgeDays <= opts.freshObservationDays;
  let direction = "missing";
  if (Number.isFinite(current) && Number.isFinite(baseline)) {
    if (meetsThreshold && delta > 0) direction = "up";
    else if (meetsThreshold && delta < 0) direction = "down";
    else direction = "flat";
  }
  const signal = {
    direction,
    label: movementDirectionLabel(direction),
    current_price_inr: Number.isFinite(current) ? current : null,
    baseline_price_inr: Number.isFinite(baseline) ? baseline : null,
    delta_inr: Number.isFinite(delta) ? delta : null,
    delta_pct: Number.isFinite(pct) ? pct : null,
    magnitude_score:
      Number.isFinite(absDelta) && Number.isFinite(absPct)
        ? absDelta + absPct * 100
        : Number.isFinite(absDelta)
          ? absDelta
          : 0,
    current_price_basis: currentPriceBasisLabel(
      analysis.current_price_basis || product.current_store_price_basis
    ),
    current_price_basis_key: normalizeSpace(
      analysis.current_price_basis || product.current_store_price_basis || ""
    ) || null,
    current_observed_at: observationAt,
    current_observation_age_days: observationAgeDays,
    fresh_observation: freshObservation,
    stale_history: Boolean(analysis.stale_history),
    availability: availabilityLabel(analysis.live_store_availability || product.availability),
    sensitivity_pool: product.sensitivity_pool || "control_or_unknown",
    first_material_increase_at: analysis.first_significant_increase_at || null,
  };
  signal.reason = currentSignalReason(product, signal);
  return signal;
}

function signalStrength(product, signal) {
  if (!signal || signal.direction === "missing") {
    return { level: "待补", label: "待补", note: "历史不足" };
  }
  const basisKey = normalizeSpace(signal.current_price_basis_key || "");
  const historyConfidence = historySourceConfidence(product && product.price_source);
  const fresh = Boolean(signal.fresh_observation);
  const stale = Boolean(signal.stale_history);
  const liveUnavailable = /缺货|不可售/.test(String(signal.availability || ""));

  if (stale) {
    return { level: "弱", label: "弱", note: "历史偏旧" };
  }
  if (fresh && historyConfidence === "高" && basisKey === "forward_monitoring_backbone") {
    return { level: "强", label: "强", note: "直接观测 + 高可信历史" };
  }
  if (fresh && historyConfidence !== "低" && !liveUnavailable) {
    return { level: "强", label: "强", note: "当前价新鲜，历史可用" };
  }
  if (fresh || historyConfidence === "中") {
    return { level: "中", label: "中", note: liveUnavailable ? "当前缺货，谨慎解读" : "可作为方向性信号" };
  }
  return { level: "弱", label: "弱", note: "主要依赖恢复历史" };
}

function latestRelevantTransition(product, direction, opts) {
  const analysis = product.memory_analysis || {};
  const transitions = Array.isArray(analysis.recent_transitions) ? analysis.recent_transitions : [];
  const filtered = transitions.filter((item) => {
    const delta = Number(item.delta_inr);
    const pct = Number(item.delta_pct);
    const matchesDirection = direction === "up" ? delta > 0 : delta < 0;
    if (!matchesDirection) return false;
    const absDelta = Math.abs(delta);
    const absPct = Math.abs(pct);
    return (
      (Number.isFinite(absDelta) && absDelta >= opts.minDeltaInr) ||
      (Number.isFinite(absPct) && absPct >= opts.minDeltaPct)
    );
  });
  if (!filtered.length) return null;
  return filtered.sort((a, b) => {
    if (b.timestamp_sec !== a.timestamp_sec) return b.timestamp_sec - a.timestamp_sec;
    return Math.abs(Number(b.delta_inr) || 0) - Math.abs(Number(a.delta_inr) || 0);
  })[0];
}

function briefRow(product, opts) {
  const signal = deriveCurrentSignal(product, opts);
  const strength = signalStrength(product, signal);
  const transition = latestRelevantTransition(product, signal.direction, opts);
  return {
    family_name: modelFamilyDisplayName(product),
    status_label: signal.label,
    direction: signal.direction,
    current_price_inr: signal.current_price_inr,
    baseline_price_inr: signal.baseline_price_inr,
    delta_inr: signal.delta_inr,
    delta_pct: signal.delta_pct,
    current_price_basis: signal.current_price_basis,
    current_observed_at: signal.current_observed_at,
    current_observation_age_days: signal.current_observation_age_days,
    fresh_observation: signal.fresh_observation,
    stale_history: signal.stale_history,
    availability: signal.availability,
    sensitivity_pool: signal.sensitivity_pool,
    strength_label: strength.label,
    strength_note: strength.note,
    history_source_label: historySourceLabel(product.price_source || ""),
    history_source_confidence: historySourceConfidence(product.price_source || ""),
    reason: signal.reason,
    product_url: product.product_url || "",
    pricehistory_page_url: product.pricehistory_page_url || "",
    first_material_increase_at: signal.first_material_increase_at,
    latest_material_transition_at: transition ? transition.timestamp_iso : null,
    latest_material_transition_delta_inr: transition ? transition.delta_inr : null,
  };
}

function sortBriefRowsByMagnitude(rows) {
  return rows.slice().sort((a, b) => {
    const aMag = Math.abs(Number(a.delta_inr) || 0);
    const bMag = Math.abs(Number(b.delta_inr) || 0);
    if (bMag !== aMag) return bMag - aMag;
    return (isoToSec(b.current_observed_at) || 0) - (isoToSec(a.current_observed_at) || 0);
  });
}

function buildPmBrief(report, opts) {
  const products = report.products || [];
  const rows = products.map((product) => briefRow(product, opts));
  const upCount = rows.filter((row) => row.direction === "up").length;
  const downCount = rows.filter((row) => row.direction === "down").length;
  const flatCount = rows.filter((row) => row.direction === "flat").length;
  const notableUps = sortBriefRowsByMagnitude(rows.filter((row) => row.direction === "up")).slice(0, 3);
  const notableDowns = sortBriefRowsByMagnitude(rows.filter((row) => row.direction === "down")).slice(0, 3);
  const latestObserved = rows
    .filter((row) => row.current_observed_at)
    .sort((a, b) => {
      const timeDiff = (isoToSec(b.current_observed_at) || 0) - (isoToSec(a.current_observed_at) || 0);
      if (timeDiff !== 0) return timeDiff;
      return Math.abs(Number(b.delta_inr) || 0) - Math.abs(Number(a.delta_inr) || 0);
    })
    .slice(0, 5);
  const missingHistory = rows
    .filter((row) => row.direction === "missing")
    .slice(0, 4);
  let tone = "整体偏平稳";
  if (upCount > downCount) tone = "整体偏上调";
  else if (downCount > upCount) tone = "整体偏下调";
  else if (upCount || downCount) tone = "整体分化";
  const headline = `整体判断：${tone}。上调 ${upCount} 个，下调 ${downCount} 个，平稳 ${flatCount} 个，仍缺历史 ${missingHistory.length} 个。`;
  const takeaways = [];
  if (rows.length) {
    if (upCount > downCount) {
      takeaways.push(
        `今天整体更像成本传导带来的上调盘面：当前有 ${upCount} 个机型高于基准价，低于基准价的有 ${downCount} 个。`
      );
    } else if (downCount > upCount) {
      takeaways.push(
        `今天整体更像促销或渠道修正盘面：当前有 ${downCount} 个机型低于基准价，高于基准价的有 ${upCount} 个。`
      );
    } else {
      takeaways.push(
        `今天盘面更分化：上调 ${upCount} 个，下调 ${downCount} 个，另外 ${flatCount} 个机型暂未见明显动作。`
      );
    }
  }
  if (notableUps[0]) {
    const row = notableUps[0];
    takeaways.push(
      `重点上调：${row.family_name} 当前较基准价高 ${fmtInr(row.delta_inr)}（${fmtPct(row.delta_pct)}），最近观测时间为 ${fmtDate(row.current_observed_at)}。${row.reason}`
    );
  }
  if (notableDowns[0]) {
    const row = notableDowns[0];
    takeaways.push(
      `重点下调：${row.family_name} 当前较基准价低 ${fmtInr(Math.abs(Number(row.delta_inr) || 0))}（${fmtPct(Math.abs(Number(row.delta_pct) || 0))}），最近观测时间为 ${fmtDate(row.current_observed_at)}。${row.reason}`
    );
  }
  if (missingHistory.length) {
    takeaways.push(
      `覆盖提醒：仍有 ${missingHistory.length} 个机型缺可用历史，今天的结论更适合做方向性判断，不宜当成完整盘点。`
    );
  }
  return {
    headline,
    takeaways,
    rows,
    notable_ups: notableUps,
    notable_downs: notableDowns,
    latest_observed: latestObserved,
    missing_history: missingHistory,
    counts: {
      up: rows.filter((row) => row.direction === "up").length,
      down: rows.filter((row) => row.direction === "down").length,
      flat: rows.filter((row) => row.direction === "flat").length,
      missing: rows.filter((row) => row.direction === "missing").length,
      fresh_observed: rows.filter((row) => row.fresh_observation).length,
    },
  };
}

function strategyNote(product) {
  const signal = deriveCurrentSignal(product, {
    minDeltaInr: DEFAULT_PM_BRIEF_DELTA_INR,
    minDeltaPct: DEFAULT_PM_BRIEF_DELTA_PCT,
    freshObservationDays: DEFAULT_PM_FRESH_OBS_DAYS,
    generatedAt: new Date().toISOString(),
  });
  return signal.reason;
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
    return `<svg viewBox="0 0 ${w} ${h}" role="img"><text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#64748b" font-size="13">暂无价格历史</text></svg>`;
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
    ? `<line x1="${xMap(markerSec).toFixed(2)}" y1="${p.t}" x2="${xMap(markerSec).toFixed(2)}" y2="${h - p.b}" stroke="#dc2626" stroke-dasharray="4 4"/><text x="${xMap(markerSec).toFixed(2)}" y="${p.t + 12}" text-anchor="middle" fill="#dc2626" font-size="10">影响窗口起点</text>`
    : "";
  const labels = [valid[0], valid[Math.floor(valid.length / 2)], valid[valid.length - 1]]
    .filter(Boolean)
    .filter((event, idx, arr) =>
      arr.findIndex((candidate) => candidate.timestamp_sec === event.timestamp_sec) === idx
    )
    .map((e) => `<text x="${xMap(e.timestamp_sec).toFixed(2)}" y="${h - 10}" text-anchor="middle" fill="#64748b" font-size="10">${escapeHtml(fmtDate(e.timestamp_iso))}</text>`)
    .join("");
  const flatNote = flatPrice
    ? `<text x="${w - p.r}" y="${p.t + 14}" text-anchor="end" fill="#64748b" font-size="11">期间价格基本平稳</text>`
    : "";
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(opts.label || "价格图")}">
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
  const pmSignal = deriveCurrentSignal(product, {
    minDeltaInr: Number(report.input.pm_brief_delta_inr || DEFAULT_PM_BRIEF_DELTA_INR),
    minDeltaPct: Number(report.input.pm_brief_delta_pct || DEFAULT_PM_BRIEF_DELTA_PCT),
    freshObservationDays: Number(report.input.pm_fresh_observation_days || DEFAULT_PM_FRESH_OBS_DAYS),
    generatedAt: report.generated_at,
  });
  const variants = Array.isArray(product.variants) && product.variants.length
    ? product.variants
    : [product];
  const impact = observedPriceEvents(product, impactEvents(product, report.input.impact_start));
  const full = observedPriceEvents(product, product.price_change_events || []);
  const status = pmSignal.label;
  const statusClass =
    pmSignal.direction === "up"
      ? "risk"
      : pmSignal.direction === "down"
        ? "watch"
        : pmSignal.direction === "missing"
          ? "stale"
          : statusClassName(analysis.status, analysis.stale_history);
  const displayName = modelFamilyDisplayName(product);
  const sku = displaySku(product);
  const rawName = normalizeSpace(product.candidate_name || product.slug);
  const liveCurrent =
    Number.isFinite(analysis.live_store_price_inr) ? analysis.live_store_price_inr : product.current_store_price_inr;
  const historyCurrent =
    Number.isFinite(analysis.history_current_price_inr)
      ? analysis.history_current_price_inr
      : product.current_price_inr;
  const liveBasis = currentPriceBasisLabel(analysis.current_price_basis || product.current_store_price_basis);
  const liveObservedAt = analysis.live_store_observed_at || product.current_store_observed_at || null;
  const variantRows = variants
    .map((variant) => {
      const a = variant.memory_analysis || {};
      const live = Number.isFinite(a.live_store_price_inr)
        ? a.live_store_price_inr
        : variant.current_store_price_inr;
      const history = Number.isFinite(a.history_current_price_inr)
        ? a.history_current_price_inr
        : variant.current_price_inr;
      const basis = currentPriceBasisLabel(a.current_price_basis || variant.current_store_price_basis);
      return `<tr>
<td>${escapeHtml(displaySku(variant))}</td>
<td>${escapeHtml(variant.store_name || variant.store_key || "-")}</td>
<td>${escapeHtml(fmtInr(live))}</td>
<td>${escapeHtml(fmtInr(history))}</td>
<td>${escapeHtml(fmtInr(a.baseline_price_inr))}</td>
      <td>${escapeHtml(fmtInr(a.current_vs_baseline_inr))}</td>
      <td>${escapeHtml(statusLabel(a.status))}</td>
      <td>${escapeHtml(fmtDate(a.first_significant_increase_at))}</td>
      <td>${escapeHtml(basis)}</td>
      <td><a href="${escapeHtml(variant.product_url || "#")}" target="_blank" rel="noreferrer">商城</a> | <a href="${escapeHtml(variant.pricehistory_page_url || "#")}" target="_blank" rel="noreferrer">历史</a></td>
</tr>`;
    })
    .join("");
  const recentRows = (analysis.recent_transitions || [])
    .map((t) => `<tr>
<td>${escapeHtml(fmtDate(t.timestamp_iso))}</td>
<td>${escapeHtml(fmtInr(t.from_price_inr))}</td>
<td>${escapeHtml(fmtInr(t.to_price_inr))}</td>
<td>${escapeHtml(fmtInr(t.delta_inr))}</td>
<td>${escapeHtml(fmtPct(t.delta_pct))}</td>
</tr>`)
    .join("");
  const backfillPending = productHistoryBackfillPending(product);
  return `<section class="card">
<div class="card-head">
  <div>
    <h2 title="${escapeHtml(rawName)}">${idx + 1}. ${escapeHtml(displayName)}</h2>
    <p>${escapeHtml(sensitivityPoolLabel(product.sensitivity_pool))}（${escapeHtml(product.sensitivity_basis || "未知")}） | ${escapeHtml(String(variants.length))} 个 SKU | SKU ${escapeHtml(skuStatusLabel(product.sku_status))} | ${escapeHtml(product.store_name || product.store_key || "-")}</p>
  </div>
  <span class="status ${statusClass}">${escapeHtml(status)}</span>
</div>
<div class="metrics">
  <div><span>当前商城价</span><strong>${escapeHtml(fmtInr(liveCurrent))}</strong></div>
  <div><span>历史当前价</span><strong>${escapeHtml(fmtInr(historyCurrent))}</strong></div>
  <div><span>基准价</span><strong>${escapeHtml(fmtInr(analysis.baseline_price_inr))}</strong></div>
  <div><span>相对基准价</span><strong>${escapeHtml(fmtInr(analysis.current_vs_baseline_inr))} (${escapeHtml(fmtPct(analysis.current_vs_baseline_pct))})</strong></div>
  <div><span>首次明显上调</span><strong>${escapeHtml(fmtDate(analysis.first_significant_increase_at))}</strong></div>
  <div><span>持续天数</span><strong>${Number.isFinite(analysis.sustained_days) ? analysis.sustained_days : "-"}</strong></div>
  <div><span>数据年龄</span><strong>${Number.isFinite(analysis.data_age_days) ? `${analysis.data_age_days} 天` : "-"}</strong></div>
</div>
<p class="note">${escapeHtml(pmSignal.reason)}</p>
${backfillPending ? `<p class="note">历史回填仍在处理中：这个机型已经建档，但当前报告还没有拿到足够完整的历史载荷。</p>` : ""}
<div class="charts">
  <div>
    <h3>${escapeHtml(report.input.impact_start)} 以来的影响窗口</h3>
    <div class="chart">${chartSvg(impact, { label: "影响窗口价格图", markerSec: dateToSec(report.input.impact_start), color: "#dc2626" })}</div>
  </div>
  <div>
    <h3>完整生命周期</h3>
    <div class="chart">${chartSvg(full, { label: "完整生命周期价格图", markerSec: dateToSec(report.input.impact_start), color: "#2563eb" })}</div>
  </div>
</div>
<div class="meta">
  <span>上市时间：${escapeHtml(fmtDate(product.launch_date_iso))}</span>
  <span>首次见价：${escapeHtml(fmtDate(product.first_seen_price_at))}</span>
  <span>敏感度依据：${escapeHtml(product.sensitivity_basis || "-")}</span>
  <span>最低价：${escapeHtml(fmtInr(product.lowest_price_inr))}</span>
  <span>最高价：${escapeHtml(fmtInr(product.highest_price_inr))}</span>
  <span>历史来源：${escapeHtml(historySourceLabel(product.price_source || "-"))}（${escapeHtml(historySourceConfidence(product.price_source || "-"))}）</span>
  <span>当前价来源：${escapeHtml(liveBasis)}</span>
  <span>当前价观测时间：${escapeHtml(fmtDate(liveObservedAt))}</span>
  <span>在售状态：${escapeHtml(availabilityLabel(analysis.live_store_availability || product.availability || "-"))}</span>
  <span>SKU 数：${escapeHtml(String(variants.length))}</span>
  <a href="${escapeHtml(product.product_url || "#")}" target="_blank" rel="noreferrer">商城链接</a>
  <a href="${escapeHtml(product.pricehistory_page_url || "#")}" target="_blank" rel="noreferrer">历史链接</a>
</div>
${variantRows ? `<div class="table-wrap"><table><thead><tr><th>SKU</th><th>商城</th><th>当前商城价</th><th>历史当前价</th><th>基准价</th><th>价差</th><th>状态</th><th>首次明显上调</th><th>当前价来源</th><th>链接</th></tr></thead><tbody>${variantRows}</tbody></table></div>` : ""}
${recentRows ? `<div class="table-wrap"><table><thead><tr><th>时间</th><th>从</th><th>到</th><th>变动额</th><th>变动幅度</th></tr></thead><tbody>${recentRows}</tbody></table></div>` : ""}
</section>`;
}

function renderBriefRows(rows) {
  return rows
    .map(
      (row) => `<tr>
<td>${escapeHtml(row.family_name || "-")}</td>
<td>${escapeHtml(fmtInr(row.current_price_inr))}</td>
<td>${escapeHtml(fmtInr(row.baseline_price_inr))}</td>
<td>${escapeHtml(fmtInr(row.delta_inr))} (${escapeHtml(fmtPct(row.delta_pct))})</td>
<td>${escapeHtml(fmtDate(row.current_observed_at || row.latest_material_transition_at))}</td>
<td>${escapeHtml(row.availability || "-")}</td>
<td>${escapeHtml(row.strength_label || "-")} / ${escapeHtml(row.history_source_confidence || "-")}</td>
<td title="${escapeHtml(row.reason || "")}">${escapeHtml((row.reason || "-").slice(0, 120))}</td>
</tr>`
    )
    .join("");
}

function renderLatestObservedRows(rows) {
  return rows
    .map(
      (row) => `<tr>
<td>${escapeHtml(row.family_name || "-")}</td>
<td>${escapeHtml(fmtInr(row.current_price_inr))}</td>
<td>${escapeHtml(row.current_price_basis || "-")}</td>
<td>${escapeHtml(fmtDate(row.current_observed_at))}</td>
<td>${escapeHtml(row.availability || "-")}</td>
<td>${escapeHtml(row.status_label || "-")} / ${escapeHtml(row.strength_label || "-")}</td>
</tr>`
    )
    .join("");
}

function renderMissingHistoryRows(rows) {
  return rows
    .map(
      (row) => `<tr>
<td>${escapeHtml(row.family_name || "-")}</td>
<td>${escapeHtml(row.current_price_basis || "-")}</td>
<td>${escapeHtml(fmtDate(row.current_observed_at))}</td>
<td>${escapeHtml(row.availability || "-")}</td>
<td title="${escapeHtml(row.reason || "")}">${escapeHtml((row.reason || "-").slice(0, 120))}</td>
</tr>`
    )
    .join("");
}

function renderTakeaways(items) {
  return items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function renderHtml(report) {
  const products = report.products || [];
  const needsMapping = report.needs_mapping || [];
  const summary = report.summary || {};
  const dataHealth = report.data_health || buildDataHealth(report);
  const brief = report.pm_brief || buildPmBrief(report, {
    minDeltaInr: Number(report.input.pm_brief_delta_inr || DEFAULT_PM_BRIEF_DELTA_INR),
    minDeltaPct: Number(report.input.pm_brief_delta_pct || DEFAULT_PM_BRIEF_DELTA_PCT),
    freshObservationDays: Number(report.input.pm_fresh_observation_days || DEFAULT_PM_FRESH_OBS_DAYS),
    generatedAt: report.generated_at,
  });
  const providers = (report.stats && report.stats.provider_stats) || {};
  const contract = report.scrapling_style_contract || buildScraplingStyleContract({ ...report, data_health: dataHealth });
  const providerRows = Object.entries(providers)
    .map(([name, stats]) => `<tr>
<td>${escapeHtml(name)}</td>
<td>${escapeHtml(String(stats.attempted ?? "-"))}</td>
<td>${escapeHtml(String(stats.candidates ?? 0))}</td>
<td>${escapeHtml(String(stats.skipped ?? "-"))}</td>
<td>${escapeHtml(String(stats.errors ?? "-"))}</td>
<td>${stats.used === true ? "是" : stats.used === false ? "否" : escapeHtml(String(stats.used ?? "-"))}</td>
</tr>`)
    .join("");
  const contractRows = (contract.providers || [])
    .map((provider) => `<tr>
<td>${escapeHtml(provider.name)}</td>
<td>${escapeHtml(provider.role)}</td>
<td>${escapeHtml(provider.status)}</td>
<td>${escapeHtml(String(provider.candidates ?? 0))}</td>
<td>${escapeHtml(provider.owns)}</td>
</tr>`)
    .join("");
  const rows = products
    .map((product) => {
      const a = product.memory_analysis || {};
      return `<tr>
<td title="${escapeHtml(product.candidate_name || product.slug)}">${escapeHtml(modelFamilyDisplayName(product))}</td>
<td>${escapeHtml(sensitivityPoolLabel(product.sensitivity_pool || "-"))}</td>
<td>${escapeHtml(String((product.variants || []).length || 1))}</td>
<td>${escapeHtml(skuStatusLabel(product.sku_status))}</td>
<td>${escapeHtml(statusLabel(a.status))}</td>
<td>${escapeHtml(fmtInr(Number.isFinite(a.live_store_price_inr) ? a.live_store_price_inr : product.current_store_price_inr || product.current_price_inr))}</td>
<td>${escapeHtml(fmtInr(a.baseline_price_inr))}</td>
<td>${escapeHtml(fmtInr(a.current_vs_baseline_inr))}</td>
<td>${escapeHtml(fmtDate(a.first_significant_increase_at))}</td>
<td>${Number.isFinite(a.sustained_days) ? a.sustained_days : "-"}</td>
<td>${a.stale_history ? "是" : "否"}</td>
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
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>内存成本传导监测报告</title>
<style>
:root{--bg:#f6f8fb;--card:#fff;--text:#111827;--muted:#64748b;--border:#dbe3ef;--blue:#2563eb;--red:#dc2626;--green:#047857;--amber:#b45309}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif}
.page{max-width:1260px;margin:24px auto;padding:0 16px}
.top,.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:14px}
h1{margin:0 0 8px;font-size:26px} h2{margin:0;font-size:20px;line-height:1.25} h3{margin:14px 0 8px;font-size:15px}
p{margin:4px 0;color:var(--muted)}
.takeaways{margin:10px 0 0 18px;padding:0;color:#1e293b}
.takeaways li{margin:6px 0;line-height:1.45}
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
  <h1>内存成本传导监测报告</h1>
  <p>生成时间：${escapeHtml(report.generated_at)} | 影响窗口起点：${escapeHtml(report.input.impact_start)} | 价格带：INR ${escapeHtml(report.input.min_price)}-${escapeHtml(report.input.max_price)}</p>
  <p>${escapeHtml(brief.headline)}</p>
  ${brief.takeaways && brief.takeaways.length ? `<ul class="takeaways">${renderTakeaways(brief.takeaways)}</ul>` : ""}
  <div class="summary">
    <div><span>纳入监测机型</span><strong>${summary.products || 0}</strong></div>
    <div><span>高于基准价</span><strong>${brief.counts.up || 0}</strong></div>
    <div><span>低于基准价</span><strong>${brief.counts.down || 0}</strong></div>
    <div><span>暂无明显变化</span><strong>${brief.counts.flat || 0}</strong></div>
    <div><span>新鲜观测</span><strong>${brief.counts.fresh_observed || 0}</strong></div>
    <div><span>缺历史</span><strong>${brief.counts.missing || 0}</strong></div>
    <div><span>待补映射</span><strong>${report.stats.unresolved_candidates || 0}</strong></div>
    <div><span>前向监测命中</span><strong>${report.stats.forward_monitoring_candidate_matches || 0}</strong></div>
  </div>
</section>
<section class="card">
  <h2>重点上调机型</h2>
  <p>当前价相对基准价高出至少 INR ${escapeHtml(String(report.input.pm_brief_delta_inr || DEFAULT_PM_BRIEF_DELTA_INR))}，或高出 ${escapeHtml(String(report.input.pm_brief_delta_pct || DEFAULT_PM_BRIEF_DELTA_PCT))}% 的机型。</p>
  ${brief.notable_ups.length ? `<div class="table-wrap"><table><thead><tr><th>机型</th><th>当前价</th><th>基准价</th><th>价差</th><th>最近观测</th><th>在售状态</th><th>信号强度</th><th>判断</th></tr></thead><tbody>${renderBriefRows(brief.notable_ups)}</tbody></table></div>` : `<p>当前视图里没有明确的上调信号。</p>`}
</section>
<section class="card">
  <h2>重点下调机型</h2>
  <p>当前价明显低于基准价的机型，这类更像促销、渠道修正或库存动作，不一定是成本传导。</p>
  ${brief.notable_downs.length ? `<div class="table-wrap"><table><thead><tr><th>机型</th><th>当前价</th><th>基准价</th><th>价差</th><th>最近观测</th><th>在售状态</th><th>信号强度</th><th>判断</th></tr></thead><tbody>${renderBriefRows(brief.notable_downs)}</tbody></table></div>` : `<p>当前视图里没有明确的下调信号。</p>`}
</section>
<section class="card">
  <h2>最新价观察层</h2>
  <p>这里展示今天进入报告的最新价格观测，用来判断当前盘面是否偏上调或偏下调。</p>
  ${brief.latest_observed.length ? `<div class="table-wrap"><table><thead><tr><th>机型</th><th>当前价</th><th>价格来源</th><th>观测时间</th><th>在售状态</th><th>信号</th></tr></thead><tbody>${renderLatestObservedRows(brief.latest_observed)}</tbody></table></div>` : `<p>今天没有加载到可用的当前价格观测。</p>`}
</section>
<section class="card">
  <h2>覆盖缺口</h2>
  <p>这里列的是今天还不能干净下结论的机型，主要原因是缺历史、缺映射或规格待补。</p>
  ${brief.missing_history.length ? `<div class="table-wrap"><table><thead><tr><th>机型</th><th>当前价来源</th><th>观测时间</th><th>在售状态</th><th>缺口说明</th></tr></thead><tbody>${renderMissingHistoryRows(brief.missing_history)}</tbody></table></div>` : `<p>当前视图中的机型都至少有可用基准价。</p>`}
  ${needsMapping.length ? `<div class="table-wrap"><table><thead><tr><th>机型</th><th>SKU</th><th>商城价</th><th>榜单顺位</th><th>商城链接</th><th>原因</th></tr></thead><tbody>${needsMapping.map((item) => `<tr><td title="${escapeHtml(item.candidate_name || "")}">${escapeHtml(item.candidate_name || "-")}</td><td>${escapeHtml(displaySku(item))}</td><td>${escapeHtml(fmtInr(item.current_store_price_inr))}</td><td>${escapeHtml(String(item.listing_rank || "-"))}</td><td><a href="${escapeHtml(item.product_url || "#")}" target="_blank" rel="noreferrer">商城</a></td><td title="${escapeHtml(item.resolution_error || "")}">${escapeHtml(String(item.resolution_error || "").slice(0, 140) || "-")}</td></tr>`).join("")}</tbody></table></div>` : ""}
</section>
<details class="card">
  <summary>诊断信息</summary>
  <div class="health ${healthClass}">
    <div>
      <span>数据健康度</span>
      <strong>${escapeHtml(dataHealth.label)}</strong>
      <p>${dataHealth.official_top10 ? "这是正式的当前 Top10 视图" : "这仍是方向性观察名单，还不是正式当前 Top10"}</p>
    </div>
    <div>
      <p>实时商城候选：${escapeHtml(String(dataHealth.live_current_store_candidates || 0))} | 是否使用本地兜底：${dataHealth.fallback_used ? "是" : "否"}</p>
      ${blockerRows ? `<ul>${blockerRows}</ul>` : ""}
      ${errorRows ? `<details><summary>错误与告警</summary><ul>${errorRows}</ul></details>` : ""}
    </div>
  </div>
  <div class="summary">
    <div><span>SKU 数</span><strong>${summary.variant_products || 0}</strong></div>
    <div><span>多 SKU 机型</span><strong>${summary.multi_variant_models || 0}</strong></div>
    <div><span>持续上调</span><strong>${summary.sustained_increase || 0}</strong></div>
    <div><span>疑似上调</span><strong>${summary.possible_increase || 0}</strong></div>
    <div><span>历史偏旧</span><strong>${summary.stale_history || 0}</strong></div>
    <div><span>待回填</span><strong>${summary.history_backfill_pending || 0}</strong></div>
    <div><span>前向观测行数</span><strong>${report.stats.forward_monitoring_observation_rows || 0}</strong></div>
    <div><span>骨干观测行数</span><strong>${report.stats.forward_monitoring_backbone_rows || 0}</strong></div>
  </div>
  <h3>候选来源</h3>
  <div class="table-wrap"><table><thead><tr><th>Provider</th><th>尝试次数</th><th>候选数</th><th>跳过</th><th>错误数</th><th>是否使用</th></tr></thead><tbody>${providerRows}</tbody></table></div>
  <h3>抓取契约</h3>
  <p>${escapeHtml(contract.intent || "")}</p>
  <div class="table-wrap"><table><thead><tr><th>抓取器</th><th>角色</th><th>状态</th><th>数量</th><th>负责内容</th></tr></thead><tbody>${contractRows}</tbody></table></div>
</details>
<details class="card">
  <summary>完整机型明细（${products.length}）</summary>
  ${products.map((product, idx) => renderProductCard(product, idx, report)).join("\n")}
</details>
</main>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv);
  const debugProgress = args.debugProgress === true || args.debugProgress === "true";
  const debug = (...parts) => {
    if (debugProgress) console.error("[debug]", ...parts);
  };
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
  const needsMappingOut = path.join(outDir, `memory-cost-pass-through-needs-mapping-${tag}.json`);
  const registryFile = args.registryFile
    ? path.resolve(String(args.registryFile))
    : path.join(rootDir, "config", "pricehistory_registry.json");
  const forwardObservationFile = args.forwardObservationsFile
    ? path.resolve(String(args.forwardObservationsFile))
    : path.join(rootDir, "data", "forward-monitoring", "current-price-observations.ndjson");
  const enablePricehistorySearch =
    args.enablePricehistorySearch === true || args.enablePricehistorySearch === "true";
  const cacheOnly = args.cacheOnly === true || args.cacheOnly === "true";

  const launchPool = loadOrBuildLaunchPool(rootDir, outDir, args, tag);
  debug("launch-pool-loaded", launchPool.status || "unknown");
  const launchModels = modelLaunchRows(launchPool.source);
  const resolutionCache = loadResolutionCache(outDir, registryFile);
  debug("resolution-cache-loaded", JSON.stringify({
    registryEntries: resolutionCache.registryEntries || 0,
    identity: resolutionCache.byIdentity.size,
    family: resolutionCache.byFamily.size,
    storageFamily: resolutionCache.byStorageFamily.size,
  }));

  const skipStoreFetch = args.skipStoreFetch === true || args.skipStoreFetch === "true";
  const store = skipStoreFetch
    ? emptyStoreCollection()
    : await collectStoreCandidates(launchModels, {
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
  const candidateFile = args.candidateFile || args.candidateJson || args.candidateCsv;
  if (candidateFile) {
    store.providerStats.candidate_file.attempted += 1;
    try {
      const fileCandidates = loadCandidateFileCandidates(candidateFile, minPrice, maxPrice, errors);
      if (fileCandidates.length) {
        store.candidates = dedupeCandidates([...fileCandidates, ...store.candidates], priorityMap);
        store.providerStats.candidate_file.used = true;
        store.providerStats.candidate_file.candidates = fileCandidates.length;
      }
    } catch (err) {
      store.providerStats.candidate_file.errors += 1;
      errors.push(`candidate_file_failed ${candidateFile}: ${String(err.message || err)}`);
    }
  }
  store.candidates = applyLaunchModelContext(store.candidates, launchModels);
  store.candidates = dedupeCandidates(store.candidates, priorityMap);
  debug("candidates-ready", store.candidates.length);
  const forwardObservationIndex = buildForwardObservationIndex(forwardObservationFile, errors);
  debug("forward-observations-loaded", JSON.stringify({
    totalRows: forwardObservationIndex.totalRows,
    backboneRows: forwardObservationIndex.backboneRows,
    bootstrapRows: forwardObservationIndex.bootstrapRows,
  }));
  store.providerStats.forward_monitoring_observations.attempted = fs.existsSync(forwardObservationFile) ? 1 : 0;
  store.providerStats.forward_monitoring_observations.candidates = forwardObservationIndex.totalRows;
  let forwardObservationMatches = 0;
  if (forwardObservationIndex.rows.length) {
    store.candidates = store.candidates.map((candidate) => {
      const match = lookupForwardObservation(candidate, forwardObservationIndex);
      if (!match) return candidate;
      forwardObservationMatches += 1;
      return applyForwardObservationToCandidate(candidate, match);
    });
    store.providerStats.forward_monitoring_observations.used = forwardObservationMatches > 0;
    store.providerStats.forward_monitoring_observations.matched = forwardObservationMatches;
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
  if (forwardObservationIndex.rows.length) {
    store.candidates = store.candidates.map((candidate) => {
      const match = lookupForwardObservation(candidate, forwardObservationIndex);
      return match ? applyForwardObservationToCandidate(candidate, match) : candidate;
    });
  }
  const candidateBudget = Math.max(topN * 4, Number(args.candidateBudget || topN * 4));
  debug("candidate-budget", candidateBudget);
  const products = [];
  const unresolvedCandidates = [];
  for (const candidate of store.candidates.slice(0, candidateBudget)) {
    if (products.length >= topN * 2) break;
    if (!stores.includes(candidate.store_key)) continue;
    try {
      const resolved = await resolvePriceHistory(candidate, {
        resolutionCache,
        enablePricehistorySearch,
        cacheOnly,
      });
      if (!resolved.ok) {
        errors.push(resolved.error);
        unresolvedCandidates.push(unresolvedCandidateRow(candidate, resolved.error));
        continue;
      }
      const product = mergeCandidateContext(resolved.product, candidate);
      const currentRangePrice = Number.isFinite(Number(product.current_store_price_inr))
        ? Number(product.current_store_price_inr)
        : Number(product.current_price_inr);
      if (
        Number.isFinite(currentRangePrice) &&
        (currentRangePrice < minPrice || currentRangePrice > maxPrice)
      ) {
        continue;
      }
      products.push(product);
    } catch (err) {
      const errText = `${candidate.candidate_name}: ${String(err.message || err)}`;
      errors.push(errText);
      unresolvedCandidates.push(unresolvedCandidateRow(candidate, errText));
    }
  }
  debug("resolved-products-before-merge", products.length, "unresolved", unresolvedCandidates.length);

  const candidateModelGroups = dedupeStrings(
    store.candidates
      .map(
        (candidate) =>
          candidate.variant_group_key ||
          candidate.launch_model_key ||
          candidateModelGroupKey(candidate) ||
          ""
      )
      .filter(Boolean)
  ).length;

  const consolidatedVariants = consolidateBySku(products, priorityMap)
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
    .sort(compareProductsForRanking);
  debug("consolidated-variants", consolidatedVariants.length);

  const consolidated = buildModelFamilies(consolidatedVariants, priorityMap)
    .map((family) => ({
      ...family,
      memory_analysis: family.memory_analysis || {},
    }))
    .sort(compareProductsForRanking)
    .slice(0, topN);
  debug("consolidated-families", consolidated.length);

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
      candidate_file: candidateFile ? path.resolve(String(candidateFile)) : null,
      forward_observation_file: fs.existsSync(forwardObservationFile) ? forwardObservationFile : null,
      registry_file: fs.existsSync(registryFile) ? registryFile : null,
      enable_pricehistory_search: enablePricehistorySearch,
      cache_only: cacheOnly,
      needs_mapping_file: unresolvedCandidates.length ? needsMappingOut : null,
      skip_store_fetch: skipStoreFetch,
      launch_pool_requested_months: Number(args.launchMonths || 14),
      launch_pool_file: launchPool.file,
      launch_pool_generated: launchPool.generated,
      launch_pool_cached: Boolean(launchPool.cached),
      launch_pool_cache_age_days: Number.isFinite(launchPool.cache_age_days)
        ? launchPool.cache_age_days
        : null,
      launch_pool_cache_policy: launchPool.cache_policy || null,
      launch_pool_status: launchPool.status || null,
      launch_pool_partial: Boolean(launchPool.partial),
      pm_brief_delta_inr: Number(args.pmBriefDeltaInr || DEFAULT_PM_BRIEF_DELTA_INR),
      pm_brief_delta_pct: Number(args.pmBriefDeltaPct || DEFAULT_PM_BRIEF_DELTA_PCT),
      pm_fresh_observation_days: Number(args.pmFreshObservationDays || DEFAULT_PM_FRESH_OBS_DAYS),
    },
    stats: {
      launch_models: launchModels.length,
      store_candidates: store.candidates.length,
      candidate_model_groups: candidateModelGroups || store.candidates.length,
      candidate_budget: candidateBudget,
      resolved_products_before_sku_merge: products.length,
      resolved_variants_after_sku_merge: consolidatedVariants.length,
      products: consolidated.length,
      cached_history_products: consolidatedVariants.filter((product) => product.resolved_from_cache).length,
      registry_entries: resolutionCache.registryEntries || 0,
      forward_monitoring_observation_rows: forwardObservationIndex.totalRows,
      forward_monitoring_backbone_rows: forwardObservationIndex.backboneRows,
      forward_monitoring_bootstrap_rows: forwardObservationIndex.bootstrapRows,
      forward_monitoring_candidate_matches: forwardObservationMatches,
      unresolved_candidates: unresolvedCandidates.length,
      errors: errors.length,
      provider_stats: store.providerStats,
    },
    summary: buildSummary(consolidated),
    products: consolidated,
    needs_mapping: unresolvedCandidates.slice(0, candidateBudget),
    errors,
  };
  report.pm_brief = buildPmBrief(report, {
    minDeltaInr: Number(report.input.pm_brief_delta_inr || DEFAULT_PM_BRIEF_DELTA_INR),
    minDeltaPct: Number(report.input.pm_brief_delta_pct || DEFAULT_PM_BRIEF_DELTA_PCT),
    freshObservationDays: Number(report.input.pm_fresh_observation_days || DEFAULT_PM_FRESH_OBS_DAYS),
    generatedAt: report.generated_at,
  });
  report.data_health = buildDataHealth(report);
  report.official_top10 = Boolean(report.data_health && report.data_health.official_top10);
  report.scrapling_style_contract = buildScraplingStyleContract(report);
  debug("report-built", JSON.stringify({
    products: report.stats.products,
    unresolved: report.stats.unresolved_candidates,
    forwardMatches: report.stats.forward_monitoring_candidate_matches,
  }));

  if (unresolvedCandidates.length) {
    fs.writeFileSync(
      needsMappingOut,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          workflow: "memory_cost_pass_through_tracker_needs_mapping",
          input: {
            candidate_file: candidateFile ? path.resolve(String(candidateFile)) : null,
            registry_file: fs.existsSync(registryFile) ? registryFile : null,
            impact_start: impactStart,
          },
          stats: {
            unresolved_candidates: unresolvedCandidates.length,
          },
          candidates: unresolvedCandidates,
        },
        null,
        2
      ),
      "utf8"
    );
  }
  debug("writing-json", jsonOut);
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), "utf8");
  debug("writing-html", htmlOut);
  fs.writeFileSync(htmlOut, renderHtml(report), "utf8");
  debug("done");
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
