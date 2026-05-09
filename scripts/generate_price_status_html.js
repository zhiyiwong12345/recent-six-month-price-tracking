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

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtInr(v) {
  if (!Number.isFinite(v)) return "-";
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

function fmtPct(v) {
  if (!Number.isFinite(v)) return "-";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtIso(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return escapeHtml(iso);
  return d.toLocaleString("en-GB", { hour12: false });
}

function safeEvents(product) {
  const events = Array.isArray(product.price_change_events)
    ? product.price_change_events
    : [];
  return events
    .map((e) => ({
      timestamp_sec: Number(e.timestamp_sec),
      timestamp_iso: e.timestamp_iso,
      price_inr: Number(e.price_inr),
    }))
    .filter(
      (e) => Number.isFinite(e.timestamp_sec) && Number.isFinite(e.price_inr)
    )
    .sort((a, b) => a.timestamp_sec - b.timestamp_sec);
}

function safeChartEvents(product) {
  const daily = Array.isArray(product.daily_price_points)
    ? product.daily_price_points
    : [];
  const chartEvents = daily.length ? daily : product.price_change_events;
  return safeEvents({ price_change_events: chartEvents });
}

function historyWindowMonths(report) {
  const value = Number(
    report &&
      report.input &&
      (report.input.history_months || report.input.price_observation_months)
  );
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isoToSec(value) {
  const ms = Date.parse(value || "");
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function applyHistoryWindow(events, product, report) {
  const months = historyWindowMonths(report);
  if (!months || !Array.isArray(events) || events.length === 0) {
    return Array.isArray(events) ? events : [];
  }

  const generatedSec = isoToSec(report.generated_at);
  const fetchedSec = isoToSec(product && product.current_price_fetched_at);
  const lastEventSec = events[events.length - 1].timestamp_sec;
  const endSec = generatedSec || fetchedSec || lastEventSec;
  if (!Number.isFinite(endSec)) return events;

  const cutoffSec = endSec - Math.max(1, months) * 31 * 86400;
  const out = [];
  const before = events.filter((e) => e.timestamp_sec <= cutoffSec).pop();
  const inside = events.filter(
    (e) => e.timestamp_sec > cutoffSec && e.timestamp_sec <= endSec
  );

  if (before) {
    out.push({
      timestamp_sec: cutoffSec,
      timestamp_iso: new Date(cutoffSec * 1000).toISOString(),
      price_inr: before.price_inr,
    });
  }
  out.push(...inside);

  if (out.length === 0) {
    return [];
  }

  const last = out[out.length - 1];
  if (last.timestamp_sec < endSec) {
    out.push({
      timestamp_sec: endSec,
      timestamp_iso: new Date(endSec * 1000).toISOString(),
      price_inr: last.price_inr,
    });
  } else if (out.length === 1) {
    out.push({
      timestamp_sec: last.timestamp_sec + 86400,
      timestamp_iso: new Date((last.timestamp_sec + 86400) * 1000).toISOString(),
      price_inr: last.price_inr,
    });
  }

  return out
    .filter(
      (e, idx, arr) =>
        idx === 0 ||
        e.timestamp_sec !== arr[idx - 1].timestamp_sec ||
        e.price_inr !== arr[idx - 1].price_inr
    )
    .sort((a, b) => a.timestamp_sec - b.timestamp_sec);
}

function countPriceTransitions(events) {
  let count = 0;
  for (let i = 1; i < events.length; i += 1) {
    if (events[i].price_inr !== events[i - 1].price_inr) {
      count += 1;
    }
  }
  return count;
}

function expandToStepEvents(events) {
  if (!Array.isArray(events) || events.length <= 1) {
    return Array.isArray(events) ? events : [];
  }
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

function getProductTitle(product) {
  return (
    (product.selection_hint && product.selection_hint.candidate_name) ||
    (product.match_hint && product.match_hint.candidate_name) ||
    product.slug
  );
}

function getStoreBasis(product) {
  const name =
    product.price_basis_store_name ||
    product.store_name ||
    (product.selection_hint && product.selection_hint.candidate_store) ||
    null;
  const key =
    product.price_basis_store_key ||
    product.store_key ||
    (product.selection_hint && product.selection_hint.candidate_store_key) ||
    null;
  const prettyKey = key ? String(key).toUpperCase() : null;
  if (name && prettyKey) {
    return `${name} (${prettyKey})`;
  }
  return name || prettyKey || "-";
}

function pickColor(idx) {
  const palette = [
    "#2563eb",
    "#7c3aed",
    "#0f766e",
    "#b45309",
    "#be123c",
    "#334155",
  ];
  return palette[idx % palette.length];
}

function buildChartSvg(events) {
  const w = 980;
  const h = 280;
  const p = { l: 62, r: 20, t: 20, b: 36 };
  const innerW = w - p.l - p.r;
  const innerH = h - p.t - p.b;

  if (!events.length) {
    return `<svg viewBox="0 0 ${w} ${h}" role="img"><text x="${
      w / 2
    }" y="${h / 2}" text-anchor="middle" fill="#6b7280" font-size="14">No history</text></svg>`;
  }

  const xs = events.map((e) => e.timestamp_sec);
  const ys = events.map((e) => e.price_inr);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minYRaw = Math.min(...ys);
  const maxYRaw = Math.max(...ys);
  const spanY = Math.max(1, maxYRaw - minYRaw);
  const minY = minYRaw - spanY * 0.08;
  const maxY = maxYRaw + spanY * 0.08;
  const yRange = Math.max(1, maxY - minY);
  const xRange = Math.max(1, maxX - minX);

  const xMap = (x) => p.l + ((x - minX) / xRange) * innerW;
  const yMap = (y) => p.t + (1 - (y - minY) / yRange) * innerH;

  const lineEvents = expandToStepEvents(events);
  const pts = lineEvents.map(
    (e) => `${xMap(e.timestamp_sec)},${yMap(e.price_inr)}`
  );
  const line = pts.join(" ");

  const yTicks = 5;
  const yGrid = [];
  for (let i = 0; i < yTicks; i += 1) {
    const t = i / (yTicks - 1);
    const y = p.t + t * innerH;
    const val = maxY - t * yRange;
    yGrid.push(
      `<line x1="${p.l}" y1="${y.toFixed(2)}" x2="${w - p.r}" y2="${y.toFixed(
        2
      )}" stroke="#e5e7eb" stroke-width="1"/>`
    );
    yGrid.push(
      `<text x="${p.l - 8}" y="${(y + 4).toFixed(
        2
      )}" text-anchor="end" fill="#6b7280" font-size="11">${fmtInr(val)}</text>`
    );
  }

  const start = events[0];
  const end = events[events.length - 1];
  const mid = events[Math.floor(events.length / 2)];
  const xLabels = [
    { x: xMap(start.timestamp_sec), text: fmtIso(start.timestamp_iso) },
    { x: xMap(mid.timestamp_sec), text: fmtIso(mid.timestamp_iso) },
    { x: xMap(end.timestamp_sec), text: fmtIso(end.timestamp_iso) },
  ];

  const lastX = xMap(end.timestamp_sec);
  const lastY = yMap(end.price_inr);

  return `
<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Price history chart">
  <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>
  ${yGrid.join("")}
  <line x1="${p.l}" y1="${h - p.b}" x2="${w - p.r}" y2="${h - p.b}" stroke="#d1d5db" stroke-width="1"/>
  <polyline fill="none" stroke="#2563eb" stroke-width="2.2" points="${line}"/>
  <circle cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(
    2
  )}" r="4.5" fill="#2563eb"/>
  ${xLabels
    .map(
      (l) =>
        `<text x="${l.x.toFixed(2)}" y="${h - 10}" text-anchor="middle" fill="#6b7280" font-size="10">${escapeHtml(
          l.text
        )}</text>`
    )
    .join("")}
</svg>`;
}

function buildGroupChartSvg(lines) {
  const w = 980;
  const h = 300;
  const p = { l: 62, r: 20, t: 20, b: 42 };
  const innerW = w - p.l - p.r;
  const innerH = h - p.t - p.b;

  const validLines = lines.filter((line) => line.events.length > 0);
  if (!validLines.length) {
    return `<svg viewBox="0 0 ${w} ${h}" role="img"><text x="${
      w / 2
    }" y="${h / 2}" text-anchor="middle" fill="#6b7280" font-size="14">No history</text></svg>`;
  }

  const allEvents = validLines
    .flatMap((line) => line.events)
    .sort((a, b) => a.timestamp_sec - b.timestamp_sec);
  const xs = allEvents.map((e) => e.timestamp_sec);
  const ys = allEvents.map((e) => e.price_inr);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minYRaw = Math.min(...ys);
  const maxYRaw = Math.max(...ys);
  const spanY = Math.max(1, maxYRaw - minYRaw);
  const minY = minYRaw - spanY * 0.08;
  const maxY = maxYRaw + spanY * 0.08;
  const yRange = Math.max(1, maxY - minY);
  const xRange = Math.max(1, maxX - minX);

  const xMap = (x) => p.l + ((x - minX) / xRange) * innerW;
  const yMap = (y) => p.t + (1 - (y - minY) / yRange) * innerH;

  const yTicks = 5;
  const yGrid = [];
  for (let i = 0; i < yTicks; i += 1) {
    const t = i / (yTicks - 1);
    const y = p.t + t * innerH;
    const val = maxY - t * yRange;
    yGrid.push(
      `<line x1="${p.l}" y1="${y.toFixed(2)}" x2="${w - p.r}" y2="${y.toFixed(
        2
      )}" stroke="#e5e7eb" stroke-width="1"/>`
    );
    yGrid.push(
      `<text x="${p.l - 8}" y="${(y + 4).toFixed(
        2
      )}" text-anchor="end" fill="#6b7280" font-size="11">${fmtInr(val)}</text>`
    );
  }

  const start = allEvents[0];
  const mid = allEvents[Math.floor(allEvents.length / 2)];
  const end = allEvents[allEvents.length - 1];
  const xLabels = [
    { x: xMap(start.timestamp_sec), text: fmtIso(start.timestamp_iso) },
    { x: xMap(mid.timestamp_sec), text: fmtIso(mid.timestamp_iso) },
    { x: xMap(end.timestamp_sec), text: fmtIso(end.timestamp_iso) },
  ];

  const paths = validLines
    .map((line) => {
      const lineEvents = expandToStepEvents(line.events);
      const points = lineEvents
        .map((e) => `${xMap(e.timestamp_sec)},${yMap(e.price_inr)}`)
        .join(" ");
      const last = line.events[line.events.length - 1];
      return `<polyline fill="none" stroke="${line.color}" stroke-width="2.2" points="${points}"/>
  <circle cx="${xMap(last.timestamp_sec).toFixed(2)}" cy="${yMap(last.price_inr).toFixed(
        2
      )}" r="3.8" fill="${line.color}"/>`;
    })
    .join("");

  return `
<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Variant comparison chart">
  <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>
  ${yGrid.join("")}
  <line x1="${p.l}" y1="${h - p.b}" x2="${w - p.r}" y2="${h - p.b}" stroke="#d1d5db" stroke-width="1"/>
  ${paths}
  ${xLabels
    .map(
      (l) =>
        `<text x="${l.x.toFixed(2)}" y="${h - 12}" text-anchor="middle" fill="#6b7280" font-size="10">${escapeHtml(
          l.text
        )}</text>`
    )
    .join("")}
</svg>`;
}

function groupProductsByVariant(products) {
  const groups = new Map();
  for (const product of products) {
    const key = String(product.variant_group_key || product.slug || "").trim();
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(product);
    groups.set(key, list);
  }
  return Array.from(groups.entries())
    .map(([key, list]) => ({ key, products: list }))
    .sort((a, b) => b.products.length - a.products.length);
}

function renderVariantGroup(group, idx, report) {
  if (!Array.isArray(group.products) || group.products.length < 2) {
    return "";
  }
  const lines = group.products.map((product, i) => {
    const events = applyHistoryWindow(safeChartEvents(product), product, report);
    const latest = events[events.length - 1];
    const label = String(
      product.variant_label || product.store_product_code || getProductTitle(product)
    );
    const storeBasis = getStoreBasis(product);
    return {
      label,
      storeBasis,
      color: pickColor(i),
      events,
      currentPrice: latest ? latest.price_inr : Number(product.current_price_inr),
      product,
    };
  });

  const legendRows = lines
    .map(
      (line) => `<div class="legend-item">
  <span class="swatch" style="background:${line.color}"></span>
  <span>${escapeHtml(line.label)}</span>
  <code>${escapeHtml(line.storeBasis)}</code>
  <strong>${escapeHtml(fmtInr(line.currentPrice))}</strong>
</div>`
    )
    .join("");

  return `
<section class="card group-card">
  <div class="card-head">
    <h2>Variant Comparison ${idx + 1}: ${escapeHtml(group.key)}</h2>
    <code>${group.products.length} variants</code>
  </div>
  <div class="chart-wrap">
    ${buildGroupChartSvg(lines)}
  </div>
  <div class="legend-grid">${legendRows}</div>
</section>`;
}

function renderProduct(product, idx, report) {
  const allEvents = safeEvents(product);
  const events = applyHistoryWindow(allEvents, product, report);
  const chartEvents = applyHistoryWindow(safeChartEvents(product), product, report);
  const transitionCount = countPriceTransitions(events);
  const first = events[0] || null;
  const latest = events[events.length - 1] || null;
  const previous = events.length >= 2 ? events[events.length - 2] : null;
  const delta = previous ? latest.price_inr - previous.price_inr : null;
  const deltaPct =
    previous && previous.price_inr !== 0
      ? (delta / previous.price_inr) * 100
      : null;
  const timelineRows = events
    .map((e, i) => {
      const prev = i > 0 ? events[i - 1] : null;
      const d = prev ? e.price_inr - prev.price_inr : null;
      return `<tr>
  <td>${i + 1}</td>
  <td>${escapeHtml(fmtIso(e.timestamp_iso))}</td>
  <td>${escapeHtml(fmtInr(e.price_inr))}</td>
  <td>${prev ? escapeHtml(`${d > 0 ? "+" : ""}${Math.round(d)}`) : "-"}</td>
</tr>`;
    })
    .join("");

  const title = getProductTitle(product);
  const storeBasis = getStoreBasis(product);
  const variantHint = product.variant_label
    ? `<span>Variant: ${escapeHtml(String(product.variant_label))}</span>`
    : "";
  const skuHint =
    product.sku_status === "ram_unknown"
      ? `<span>SKU status: RAM unknown</span>`
      : "";
  const mergedHint = Number(product.merged_color_variant_count) > 1
    ? `<span>Colors merged: ${Number(product.merged_color_variant_count)}</span>`
    : "";

  return `
<section class="card">
  <div class="card-head">
    <h2>${idx + 1}. ${escapeHtml(title)}</h2>
    <code>${escapeHtml(product.slug || "")}</code>
  </div>
  <div class="metrics">
    <div class="metric"><span>Current</span><strong>${fmtInr(
      product.current_price_inr
    )}</strong></div>
    <div class="metric"><span>Previous</span><strong>${fmtInr(
      previous ? previous.price_inr : NaN
    )}</strong></div>
    <div class="metric"><span>Change</span><strong class="${
      Number.isFinite(delta) ? (delta < 0 ? "down" : delta > 0 ? "up" : "") : ""
    }">${Number.isFinite(delta) ? `${delta > 0 ? "+" : ""}${Math.round(delta)} (${fmtPct(deltaPct)})` : "-"}</strong></div>
    <div class="metric"><span>First Seen</span><strong>${fmtIso(
      allEvents[0] ? allEvents[0].timestamp_iso : product.first_seen_price_at
    )}</strong></div>
    <div class="metric"><span>Lowest</span><strong>${fmtInr(
      Number(product.lowest_price_inr)
    )}</strong></div>
    <div class="metric"><span>Highest</span><strong>${fmtInr(
      Number(product.highest_price_inr)
    )}</strong></div>
  </div>
  <div class="chart-wrap">
    ${buildChartSvg(chartEvents)}
  </div>
  <div class="meta">
    <span>Chart points: ${chartEvents.length}</span>
    <span>Price changes: ${transitionCount}</span>
    <span>Price Basis: ${escapeHtml(storeBasis)}</span>
    ${variantHint}
    ${skuHint}
    ${mergedHint}
    <span>Latest fetched: ${escapeHtml(fmtIso(product.current_price_fetched_at))}</span>
    <a href="${escapeHtml(product.pricehistory_page_url || "#")}" target="_blank" rel="noreferrer">PriceHistory Page</a>
    <a href="${escapeHtml(product.product_url || "#")}" target="_blank" rel="noreferrer">Store Link</a>
  </div>
  <div class="timeline">
    <h3>Full Price Change Timeline (From Launch)</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>#</th><th>Time</th><th>Price (INR)</th><th>Delta</th></tr>
        </thead>
        <tbody>${timelineRows}</tbody>
      </table>
    </div>
  </div>
</section>`;
}

function renderHtml(report) {
  const products = Array.isArray(report.products) ? report.products : [];
  const errors = Array.isArray(report.errors) ? report.errors : [];
  const grouped = groupProductsByVariant(products);
  const groupedHtml = grouped.map((g, i) => renderVariantGroup(g, i, report)).join("\n");
  const productHtml = products.map((p, i) => renderProduct(p, i, report)).join("\n");
  const errorHtml = errors.length
    ? `<section class="errors"><h2>Errors</h2><ul>${errors
        .map((e) => `<li>${escapeHtml(e)}</li>`)
        .join("")}</ul></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Price Status Report</title>
  <style>
    :root{
      --bg:#f3f6fb;--text:#0f172a;--muted:#64748b;--card:#ffffff;
      --border:#e2e8f0;--blue:#2563eb;--up:#b91c1c;--down:#047857;
    }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif}
    .page{max-width:1200px;margin:24px auto;padding:0 14px}
    .top{background:var(--card);border:1px solid var(--border);padding:18px 18px 14px;border-radius:10px}
    .top h1{margin:0 0 8px 0;font-size:24px}
    .top p{margin:2px 0;color:var(--muted)}
    .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-top:14px}
    .card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
    .card-head h2{margin:0;font-size:20px;line-height:1.25}
    .card-head code{font-size:12px;color:#334155;word-break:break-all}
    .metrics{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px;margin-top:12px}
    .metric{border:1px solid var(--border);border-radius:8px;padding:8px 10px;background:#f8fafc}
    .metric span{display:block;color:var(--muted);font-size:12px}
    .metric strong{display:block;margin-top:4px;font-size:15px}
    .metric .up{color:var(--up)} .metric .down{color:var(--down)}
    .chart-wrap{border:1px solid var(--border);border-radius:8px;overflow:auto;background:#fff;margin-top:12px}
    .chart-wrap svg{display:block;width:100%;min-width:880px;height:auto}
    .meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;font-size:13px;color:var(--muted)}
    .meta a{color:var(--blue);text-decoration:none}
    .timeline{margin-top:12px}
    .timeline h3{margin:0 0 8px 0;font-size:16px}
    .table-wrap{max-height:320px;overflow:auto;border:1px solid var(--border);border-radius:8px}
    .group-card .legend-grid{margin-top:10px;display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:8px}
    .legend-item{display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;background:#f8fafc;font-size:13px}
    .legend-item code{font-size:11px;color:#475569}
    .legend-item strong{margin-left:auto}
    .swatch{width:10px;height:10px;border-radius:999px;display:inline-block;flex:0 0 auto}
    table{width:100%;border-collapse:collapse;font-size:13px}
    thead th{position:sticky;top:0;background:#f8fafc;border-bottom:1px solid var(--border);text-align:left;padding:8px}
    tbody td{border-bottom:1px solid #eef2f7;padding:7px 8px;white-space:nowrap}
    .errors{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px;margin-top:14px}
    @media (max-width:960px){.metrics{grid-template-columns:repeat(2,minmax(120px,1fr));}.group-card .legend-grid{grid-template-columns:1fr;}}
  </style>
</head>
<body>
  <main class="page">
    <section class="top">
      <h1>Price Status Report</h1>
      <p>Generated: ${escapeHtml(fmtIso(report.generated_at))}</p>
      <p>Locale: ${escapeHtml(report.locale || "-")} | Products: ${
    products.length
  } | Errors: ${errors.length}</p>
      <p>Mode: ${escapeHtml(String(report.input?.run_mode || "-"))} | Stores: ${escapeHtml(
    Array.isArray(report.input?.stores) ? report.input.stores.join(", ") : "-"
  )} | Phone only: ${escapeHtml(String(report.input?.phone_only ?? "-"))}</p>
      <p>Range: ${escapeHtml(
        String(report.input?.min_price ?? "-")
      )} - ${escapeHtml(String(report.input?.max_price ?? "-"))} INR</p>
      <p>Observation window: ${escapeHtml(
        historyWindowMonths(report) ? `${historyWindowMonths(report)} months` : "All history"
      )}</p>
    </section>
    ${errorHtml}
    ${groupedHtml}
    ${productHtml}
  </main>
</body>
</html>`;
}

function main() {
  const args = parseArgs(process.argv);
  const inFile = args.in ? path.resolve(String(args.in)) : "";
  if (!inFile) {
    throw new Error("Missing --in <report.json>");
  }
  const outFile = args.out
    ? path.resolve(String(args.out))
    : inFile.replace(/\.json$/i, "") + ".html";

  const report = JSON.parse(fs.readFileSync(inFile, "utf8"));
  const html = renderHtml(report);
  fs.writeFileSync(outFile, html, "utf8");
  console.log(`Saved HTML report: ${outFile}`);
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
