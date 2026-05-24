"use strict";

const { spawnSync } = require("child_process");

const PRICEBEFORE_BASE = "https://pricebefore.com";
const MONTHS = new Map([
  ["jan", 0],
  ["feb", 1],
  ["mar", 2],
  ["apr", 3],
  ["may", 4],
  ["jun", 5],
  ["jul", 6],
  ["aug", 7],
  ["sep", 8],
  ["oct", 9],
  ["nov", 10],
  ["dec", 11],
]);

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#8377;/g, "₹")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "));
}

function parsePriceBeforeDate(value) {
  const text = normalizeSpace(value);
  const match = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS.get(match[2].slice(0, 3).toLowerCase());
  const year = Number(match[3]);
  if (!Number.isInteger(day) || month == null || !Number.isInteger(year)) return null;
  return new Date(Date.UTC(year, month, day, 0, 0, 0)).toISOString();
}

function extractAttr(html, attr) {
  const match = String(html || "").match(new RegExp(`${attr}=["']([^"']+)["']`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function extractCanonicalUrl(html, sourceUrl) {
  const match = String(html || "").match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
  const href = match ? extractAttr(match[0], "href") : "";
  if (!href) return sourceUrl || "";
  try {
    return new URL(href, sourceUrl || PRICEBEFORE_BASE).toString();
  } catch (err) {
    return href;
  }
}

function extractTitle(html) {
  const h1 = String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return normalizeSpace(stripTags(h1[1]));
  const title = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? normalizeSpace(stripTags(title[1]).replace(/^Price History of\s+/i, "")) : "";
}

function extractStoreUrl(html) {
  const buyLink = String(html || "").match(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*(?:Buy on|View details on)[\s\S]*?<\/a>/i);
  if (buyLink) return decodeHtml(buyLink[1]);
  const anyStore = String(html || "").match(/href=["'](https:\/\/www\.(?:flipkart|amazon)\.[^"']+)["']/i);
  return anyStore ? decodeHtml(anyStore[1]) : "";
}

function resolveStoreKey(storeName, storeUrl) {
  const text = `${storeName || ""} ${storeUrl || ""}`.toLowerCase();
  if (text.includes("flipkart")) return "flipkart";
  if (text.includes("amazon")) return "amazon";
  return "";
}

function extractStoreProductCode(storeUrl) {
  try {
    const url = new URL(storeUrl);
    return url.searchParams.get("pid") || url.searchParams.get("asin") || "";
  } catch (err) {
    const pid = String(storeUrl || "").match(/[?&]pid=([^&]+)/i);
    return pid ? decodeURIComponent(pid[1]) : "";
  }
}

function extractPriceBeforeData(html) {
  const match = String(html || "").match(/var\s+data\s*=\s*(\{[\s\S]*?\});\s*var\s+ctx\b/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    return null;
  }
}

function compressEvents(points) {
  const events = [];
  for (const point of points || []) {
    const price = Number(point.price_inr);
    const ts = Number(point.timestamp_sec);
    if (!Number.isFinite(price) || !Number.isFinite(ts)) continue;
    const prev = events[events.length - 1];
    if (!prev || prev.price_inr !== price) {
      events.push({
        timestamp_sec: ts,
        timestamp_iso: point.timestamp_iso,
        price_inr: price,
      });
    }
  }
  return events;
}

function parsePriceBeforeProductPage(html, sourceUrl, candidate = {}) {
  const data = extractPriceBeforeData(html);
  if (!data || !Array.isArray(data.dates) || !Array.isArray(data.prices)) {
    return { ok: false, error: "pricebefore_dataset_missing" };
  }

  const points = data.dates
    .map((date, idx) => {
      const timestampIso = parsePriceBeforeDate(date);
      const price = Number(data.prices[idx]);
      if (!timestampIso || !Number.isFinite(price)) return null;
      return {
        timestamp_sec: Math.floor(Date.parse(timestampIso) / 1000),
        timestamp_iso: timestampIso,
        price_inr: price,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp_sec - b.timestamp_sec);

  if (!points.length) return { ok: false, error: "pricebefore_points_missing" };

  const title = extractTitle(html) || candidate.candidate_name || "";
  const pageUrl = extractCanonicalUrl(html, sourceUrl);
  const imageTag = String(html || "").match(/<img[^>]+id=["']product-img["'][^>]*>/i);
  const seller = imageTag ? extractAttr(imageTag[0], "data-seller") : "";
  const storeUrl = extractStoreUrl(html) || candidate.product_url || "";
  const storeKey = resolveStoreKey(seller || candidate.store_name, storeUrl);
  const prices = points.map((point) => point.price_inr);
  const events = compressEvents(points);
  const currentPrice = points[points.length - 1].price_inr;

  return {
    ok: true,
    product: {
      title,
      slug: pageUrl ? pageUrl.split("/").pop().replace(/\.html$/i, "") : null,
      product_url: storeUrl || candidate.product_url || "",
      store_name: storeKey ? storeKey[0].toUpperCase() + storeKey.slice(1) : candidate.store_name || "",
      store_key: storeKey,
      store_product_code: extractStoreProductCode(storeUrl || candidate.product_url),
      pricebefore_page_url: pageUrl,
      pricehistory_page_url: pageUrl,
      price_source: "pricebefore",
      current_price_inr: currentPrice,
      current_price_fetched_at: points[points.length - 1].timestamp_iso,
      first_seen_price_at: events[0] ? events[0].timestamp_iso : points[0].timestamp_iso,
      first_seen_price_inr: events[0] ? events[0].price_inr : points[0].price_inr,
      lowest_price_inr: Math.min(...prices),
      highest_price_inr: Math.max(...prices),
      average_price_inr: Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length),
      price_change_events: events,
      raw_price_points: points,
      raw_point_count: points.length,
    },
  };
}

function buildPriceBeforeSearchUrl(storeProductUrl) {
  const url = new URL("/search/", PRICEBEFORE_BASE);
  url.searchParams.set("q", normalizeSpace(storeProductUrl));
  return url;
}

function fetchTextViaCurl(url, options = {}) {
  const timeoutSec = Math.max(5, Math.ceil(Number(options.timeoutMs || 15000) / 1000));
  const result = spawnSync(
    "curl",
    [
      "-L",
      "-sS",
      "--compressed",
      "--connect-timeout",
      "5",
      "--max-time",
      String(timeoutSec),
      "-A",
      "Mozilla/5.0",
      String(url),
      "-w",
      "\n__CURL_STATUS__:%{http_code}",
    ],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: timeoutSec * 1000 + 5000,
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(normalizeSpace(result.stderr) || `curl_exit_${result.status}`);
  }
  const output = String(result.stdout || "");
  const marker = "\n__CURL_STATUS__:";
  const idx = output.lastIndexOf(marker);
  const status = idx >= 0 ? Number(output.slice(idx + marker.length).trim()) : 0;
  const bodyText = idx >= 0 ? output.slice(0, idx) : output;
  if (!(status >= 200 && status < 300)) {
    throw new Error(`HTTP ${status} for ${url}`);
  }
  return bodyText;
}

async function fetchPriceBeforeHistoryByUrl(candidate, options = {}) {
  const storeUrl = normalizeSpace(options.productUrl || candidate.product_url);
  if (!/^https?:\/\//i.test(storeUrl)) {
    return { ok: false, error: "invalid_store_url" };
  }
  const searchUrl = buildPriceBeforeSearchUrl(storeUrl).toString();
  const fetchText = options.fetchText || ((url) => fetchTextViaCurl(url, options));
  try {
    const html = await fetchText(searchUrl);
    const parsed = parsePriceBeforeProductPage(html, searchUrl, {
      ...candidate,
      product_url: storeUrl,
    });
    if (!parsed.ok) return parsed;
    parsed.product.resolve_strategy = "pricebefore_store_url_search";
    return parsed;
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
    };
  }
}

module.exports = {
  buildPriceBeforeSearchUrl,
  compressEvents,
  fetchPriceBeforeHistoryByUrl,
  fetchTextViaCurl,
  parsePriceBeforeDate,
  parsePriceBeforeProductPage,
};
