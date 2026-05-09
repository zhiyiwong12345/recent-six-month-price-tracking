#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

function runNodeScript(scriptPath, scriptArgs) {
  const cmd = process.execPath;
  const result = spawnSync(cmd, [scriptPath, ...scriptArgs], {
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Failed: ${path.basename(scriptPath)} ${scriptArgs.join(" ")}`);
  }
}

function loadCount(jsonPath) {
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    return Array.isArray(data.products) ? data.products.length : 0;
  } catch (err) {
    return 0;
  }
}

function writeIndexHtml(indexPath, payload) {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Price Status Bundled Reports</title>
  <style>
    body{margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;background:#f5f7fb;color:#0f172a}
    .wrap{max-width:920px;margin:24px auto;padding:0 14px}
    .card{background:#fff;border:1px solid #dbe3ee;border-radius:10px;padding:14px 16px;margin-top:12px}
    h1{margin:0 0 8px 0;font-size:24px}
    p{margin:4px 0;color:#475569}
    a{color:#2563eb;text-decoration:none}
    .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
    .row strong{font-size:18px}
    code{font-size:12px;background:#f1f5f9;padding:2px 6px;border-radius:6px}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <h1>Price Status 双报告</h1>
      <p>生成时间：${payload.generatedAt}</p>
      <p>范围：₹${payload.minPrice} - ₹${payload.maxPrice} | 手机 | 商城：${payload.stores}</p>
    </section>
    <section class="card">
      <div class="row">
        <strong>在售 Top${payload.topN}</strong>
        <code>${payload.instockCount} products</code>
      </div>
      <p><a href="${payload.instockHtmlName}" target="_blank" rel="noreferrer">${payload.instockHtmlName}</a></p>
      <p><a href="${payload.instockJsonName}" target="_blank" rel="noreferrer">${payload.instockJsonName}</a></p>
    </section>
    <section class="card">
      <div class="row">
        <strong>最新上市 Top${payload.topN}</strong>
        <code>${payload.latestCount} products</code>
      </div>
      <p><a href="${payload.latestHtmlName}" target="_blank" rel="noreferrer">${payload.latestHtmlName}</a></p>
      <p><a href="${payload.latestJsonName}" target="_blank" rel="noreferrer">${payload.latestJsonName}</a></p>
    </section>
  </main>
</body>
</html>`;
  fs.writeFileSync(indexPath, html, "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  const rootDir = path.resolve(__dirname, "..");
  const outDir = args.outDir
    ? path.resolve(String(args.outDir))
    : path.join(rootDir, "00_Inbox");
  const locale = String(args.locale || "en-in").toLowerCase();
  const minPrice = Number(args.minPrice || 20000);
  const maxPrice = Number(args.maxPrice || 40000);
  const topN = Number(args.topN || 10);
  const stores = String(args.stores || "flipkart,amazon");
  const preferStores = String(args.preferStores || "flipkart,amazon");
  const maxPages = Number(args.maxPages || 120);
  const latestPool = Number(args.latestPool || Math.max(160, topN * 20));
  const tag = String(args.tag || "20k-40k");

  fs.mkdirSync(outDir, { recursive: true });

  const workflowScript = path.join(rootDir, "scripts", "price_status_workflow.js");
  const htmlScript = path.join(rootDir, "scripts", "generate_price_status_html.js");

  const instockJson = path.join(outDir, `price-status-top${topN}-instock-${tag}.json`);
  const instockHtml = path.join(outDir, `price-status-top${topN}-instock-${tag}.html`);
  const latestJson = path.join(outDir, `price-status-top${topN}-latest-launch-${tag}.json`);
  const latestHtml = path.join(outDir, `price-status-top${topN}-latest-launch-${tag}.html`);
  const indexHtml = path.join(outDir, `price-status-bundle-top${topN}-${tag}.html`);

  runNodeScript(workflowScript, [
    "--autoTop",
    "--topN",
    String(topN),
    "--minPrice",
    String(minPrice),
    "--maxPrice",
    String(maxPrice),
    "--locale",
    locale,
    "--stores",
    stores,
    "--preferStores",
    preferStores,
    "--maxPages",
    String(maxPages),
    "--out",
    instockJson,
  ]);
  runNodeScript(htmlScript, ["--in", instockJson, "--out", instockHtml]);

  runNodeScript(workflowScript, [
    "--latestTop",
    "--topN",
    String(topN),
    "--latestPool",
    String(latestPool),
    "--minPrice",
    String(minPrice),
    "--maxPrice",
    String(maxPrice),
    "--locale",
    locale,
    "--stores",
    stores,
    "--preferStores",
    preferStores,
    "--maxPages",
    String(maxPages),
    "--out",
    latestJson,
  ]);
  runNodeScript(htmlScript, ["--in", latestJson, "--out", latestHtml]);

  writeIndexHtml(indexHtml, {
    generatedAt: new Date().toISOString(),
    minPrice,
    maxPrice,
    topN,
    stores,
    instockCount: loadCount(instockJson),
    latestCount: loadCount(latestJson),
    instockJsonName: path.basename(instockJson),
    instockHtmlName: path.basename(instockHtml),
    latestJsonName: path.basename(latestJson),
    latestHtmlName: path.basename(latestHtml),
  });

  console.log(`Saved bundle index: ${indexHtml}`);
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
