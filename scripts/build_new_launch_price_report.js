#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

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

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function ensureHttpUrl(value) {
  const text = normalizeSpace(value);
  if (!/^https?:\/\//i.test(text)) return null;
  return text;
}

function storeNameFromKey(storeKey) {
  const key = String(storeKey || "").toLowerCase();
  if (key === "flipkart") return "Flipkart";
  if (key === "amazon") return "Amazon";
  return normalizeSpace(storeKey) || "Unknown";
}

function toIndiaIso(value) {
  const text = normalizeSpace(value);
  if (!text) return null;
  const normalized = text.replace(" ", "T");
  const withOffset = `${normalized}+05:30`;
  const ms = Date.parse(withOffset);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeVariantGroupKey(modelName) {
  return normalizeSpace(modelName)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(5g|4g)\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function formatModelName(value) {
  const clean = normalizeSpace(value).replace(/\b(5g|4g)\b/gi, "").trim();
  if (!clean) return "Unknown model";
  return clean
    .split(/\s+/)
    .map((part) => {
      if (/^[A-Z0-9]+$/.test(part)) return part;
      if (/^(oppo|vivo|iqoo)$/i.test(part)) return part.toUpperCase() === "IQOO" ? "iQOO" : part.toLowerCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
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

async function fetchPriceHistoryPageData(pageUrl) {
  const response = await fetch(pageUrl, { method: "GET", cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const html = await response.text();
  const data = decodePriceHistoryPageDataset(html);
  if (!data || !data.Price) {
    throw new Error("Missing PagePriceHistoryDataSet");
  }
  return data;
}

function slugFromPageUrl(pageUrl) {
  return String(pageUrl || "")
    .replace(/\/+$/, "")
    .split("/")
    .pop();
}

function compressPricePoints(points) {
  const out = [];
  let prevPrice = null;
  for (const point of points) {
    const price = Number(point && point.y);
    const day = normalizeSpace(point && point.x);
    if (!day || !Number.isFinite(price)) continue;
    if (out.length === 0 || price !== prevPrice) {
      const ms = Date.parse(`${day}T00:00:00Z`);
      if (Number.isNaN(ms)) continue;
      out.push({
        timestamp_sec: Math.floor(ms / 1000),
        timestamp_iso: new Date(ms).toISOString(),
        price_inr: price,
      });
      prevPrice = price;
    }
  }
  return out;
}

function normalizeDailyPricePoints(points, currentFetchedAt) {
  const byDay = new Map();
  for (const point of points || []) {
    const price = Number(point && point.y);
    const day = normalizeSpace(point && point.x);
    if (!day || !Number.isFinite(price)) continue;
    const ms = Date.parse(`${day}T00:00:00Z`);
    if (Number.isNaN(ms)) continue;
    const sec = Math.floor(ms / 1000);
    byDay.set(sec, {
      timestamp_sec: sec,
      timestamp_iso: new Date(ms).toISOString(),
      price_inr: price,
    });
  }
  const out = Array.from(byDay.values()).sort(
    (a, b) => a.timestamp_sec - b.timestamp_sec
  );
  if (out.length === 1 && currentFetchedAt) {
    const fetchedMs = Date.parse(currentFetchedAt);
    if (!Number.isNaN(fetchedMs)) {
      const fetchedDayMs = Date.parse(
        new Date(fetchedMs).toISOString().slice(0, 10) + "T00:00:00Z"
      );
      const fetchedSec = Math.floor(fetchedDayMs / 1000);
      if (Number.isFinite(fetchedSec) && fetchedSec > out[0].timestamp_sec) {
        out.push({
          timestamp_sec: fetchedSec,
          timestamp_iso: new Date(fetchedDayMs).toISOString(),
          price_inr: out[0].price_inr,
        });
      }
    }
  }
  return out;
}

function averagePrice(points) {
  if (!points.length) return null;
  const total = points.reduce((sum, point) => sum + Number(point.price_inr), 0);
  return Math.round(total / points.length);
}

function buildProduct(row, entry, pageUrl, data) {
  const rawPoints =
    data.History && Array.isArray(data.History.Price) ? data.History.Price : [];
  const currentFetchedAt = toIndiaIso(data.Price && data.Price.UpdatedOn) || null;
  const dailyPoints = normalizeDailyPricePoints(rawPoints, currentFetchedAt);
  const events = compressPricePoints(dailyPoints);
  const allPrices = rawPoints
    .map((point) => Number(point && point.y))
    .filter((value) => Number.isFinite(value));
  const first = events[0] || null;
  const latest = events[events.length - 1] || null;
  const title =
    normalizeSpace((data.Main && data.Main.ProductName) || entry.candidate_name) ||
    normalizeSpace(row.model_name) ||
    path.basename(pageUrl);

  const slug = slugFromPageUrl(pageUrl);
  const storeKey = String(entry.store_key || "").toLowerCase() || "flipkart";
  const storeName = storeNameFromKey(storeKey);
  const currentPrice =
    Number(data.Price && data.Price.Price) ||
    (latest ? latest.price_inr : Number(entry.price_inr));

  return {
    slug,
    product_url: ensureHttpUrl(entry.product_url) || null,
    store_name: storeName,
    store_key: storeKey,
    store_product_code:
      (data.Main && data.Main.ListingId) || entry.store_product_code || null,
    pricehistory_page_url: pageUrl,
    pricehistory_embed_chart_url: null,
    current_price_inr: Number.isFinite(currentPrice) ? currentPrice : null,
    current_price_fetched_at: currentFetchedAt,
    lowest_price_inr: allPrices.length ? Math.min(...allPrices) : null,
    highest_price_inr: allPrices.length ? Math.max(...allPrices) : null,
    average_price_inr: dailyPoints.length ? averagePrice(dailyPoints) : null,
    first_seen_price_at: first ? first.timestamp_iso : null,
    first_seen_price_inr: first ? first.price_inr : null,
    price_change_events: events,
    daily_price_points: dailyPoints,
    raw_point_count: rawPoints.length,
    variant_group_key:
      normalizeVariantGroupKey(row.model_name) || normalizeVariantGroupKey(title),
    variant_label:
      normalizeSpace(entry.variant_signature) ||
      normalizeSpace((data.Main && data.Main.Color) || "") ||
      null,
    sku_status: String(entry.variant_signature || "").startsWith("RAM_UNKNOWN+")
      ? "ram_unknown"
      : "ok",
    price_basis_store_key: storeKey,
    price_basis_store_name: storeName,
    price_basis_preference_rank: storeKey === "flipkart" ? 0 : 1,
    selection_hint: {
      candidate_name: title,
      candidate_store: storeName,
      candidate_store_key: storeKey,
    },
    source_model_name: row.model_name,
    launch_date_iso: row.launch_date_iso || null,
  };
}

function mergeDailySeries(products) {
  const byDay = new Map();
  for (const product of products) {
    const points = Array.isArray(product.daily_price_points)
      ? product.daily_price_points
      : [];
    for (const point of points) {
      const sec = Number(point.timestamp_sec);
      const price = Number(point.price_inr);
      if (!Number.isFinite(sec) || !Number.isFinite(price)) continue;
      const prev = byDay.get(sec);
      if (!prev || price < prev.price_inr) {
        byDay.set(sec, {
          timestamp_sec: sec,
          timestamp_iso: point.timestamp_iso,
          price_inr: price,
        });
      }
    }
  }
  return Array.from(byDay.values()).sort((a, b) => a.timestamp_sec - b.timestamp_sec);
}

function consolidateProductsBySku(products) {
  const bySku = new Map();
  for (const product of products) {
    const key = [
      product.variant_group_key || product.source_model_name || product.slug,
      product.store_key || "",
      product.variant_label || "STD",
    ].join("::");
    const list = bySku.get(key) || [];
    list.push(product);
    bySku.set(key, list);
  }

  return Array.from(bySku.values()).map((list) => {
    const dailyPoints = mergeDailySeries(list);
    const events = compressPricePoints(dailyPoints);
    const prices = dailyPoints.map((point) => point.price_inr);
    const latest = dailyPoints[dailyPoints.length - 1] || null;
    const first = dailyPoints[0] || null;
    const primary = list
      .slice()
      .sort((a, b) => {
        const ap = Number(a.current_price_inr);
        const bp = Number(b.current_price_inr);
        if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) return ap - bp;
        return String(b.current_price_fetched_at || "").localeCompare(
          String(a.current_price_fetched_at || "")
        );
      })[0];
    const modelName = formatModelName(primary.source_model_name || primary.variant_group_key);
    const variantLabel = primary.variant_label || "STD";
    return {
      ...primary,
      selection_hint: {
        ...(primary.selection_hint || {}),
        candidate_name: `${modelName} - ${variantLabel}`,
      },
      current_price_inr: latest ? latest.price_inr : primary.current_price_inr,
      lowest_price_inr: prices.length ? Math.min(...prices) : primary.lowest_price_inr,
      highest_price_inr: prices.length ? Math.max(...prices) : primary.highest_price_inr,
      average_price_inr: prices.length ? averagePrice(dailyPoints) : primary.average_price_inr,
      first_seen_price_at: first ? first.timestamp_iso : primary.first_seen_price_at,
      first_seen_price_inr: first ? first.price_inr : primary.first_seen_price_inr,
      price_change_events: events,
      daily_price_points: dailyPoints,
      raw_point_count: list.reduce((sum, item) => sum + (Number(item.raw_point_count) || 0), 0),
      merged_color_variant_count: list.length,
      merged_pricehistory_pages: list
        .map((item) => item.pricehistory_page_url)
        .filter(Boolean),
    };
  });
}

function uniqueEntries(shortlist) {
  const out = [];
  const seen = new Set();
  for (const row of shortlist) {
    const entries = Array.isArray(row.entries) ? row.entries : [];
    for (const entry of entries) {
      const pageUrl = ensureHttpUrl(entry.pricehistory_page_url);
      if (!pageUrl || seen.has(pageUrl)) continue;
      seen.add(pageUrl);
      out.push({ row, entry, pageUrl });
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const inFile = args.in ? path.resolve(String(args.in)) : "";
  if (!inFile) {
    throw new Error("Missing --in <new-launch-sellwell.json>");
  }

  const outFile = args.out
    ? path.resolve(String(args.out))
    : inFile.replace(/\.json$/i, "-price-report.json");
  const htmlDir = args.htmlDir ? path.resolve(String(args.htmlDir)) : "";

  const source = JSON.parse(fs.readFileSync(inFile, "utf8"));
  const shortlist = Array.isArray(source.shortlist) ? source.shortlist : [];
  const items = uniqueEntries(shortlist);
  const report = {
    generated_at: new Date().toISOString(),
    locale: "IN",
    workflow: "new_launch_price_status_from_pricehistory_app",
    input: {
      source_report: inFile,
      shortlist_models: shortlist.length,
      unique_variants: items.length,
    },
    products: [],
    errors: [],
  };

  for (const item of items) {
    try {
      const slug = slugFromPageUrl(item.pageUrl);
      let data = null;
      if (htmlDir) {
        const htmlFile = path.join(htmlDir, `${slug}.html`);
        const html = fs.readFileSync(htmlFile, "utf8");
        data = decodePriceHistoryPageDataset(html);
        if (!data || !data.Price) {
          throw new Error(`Missing PagePriceHistoryDataSet in ${htmlFile}`);
        }
      } else {
        data = await fetchPriceHistoryPageData(item.pageUrl);
      }
      report.products.push(buildProduct(item.row, item.entry, item.pageUrl, data));
    } catch (err) {
      report.errors.push(
        `${item.pageUrl}: ${String(err && err.message ? err.message : err)}`
      );
    }
  }

  report.products = consolidateProductsBySku(report.products);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  console.log(`Saved report: ${outFile}`);
  console.log(
    `products=${report.products.length}, errors=${report.errors.length}, input_variants=${items.length}`
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
