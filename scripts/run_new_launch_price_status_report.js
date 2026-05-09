#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

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

function runNodeScript(scriptPath, scriptArgs) {
  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Failed: ${path.basename(scriptPath)} ${scriptArgs.join(" ")}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  const rootDir = path.resolve(__dirname, "..");
  const outDir = args.outDir
    ? path.resolve(String(args.outDir))
    : path.join(rootDir, "00_Inbox");

  const months = Number(args.months || 3);
  const minPrice = Number(args.minPrice || 20000);
  const maxPrice = Number(args.maxPrice || 40000);
  const topN = Number(args.topN || 10);
  const maxPages = Number(args.maxPages || 220);
  const minMatchScore = Number(args.minMatchScore || 0.35);
  const minRatingCount = Number(args.minRatingCount || 0);
  const maxFallbackRequests = Number(args.maxFallbackRequests || 20);
  const stores = String(args.stores || "flipkart,amazon");
  const preferStores = String(args.preferStores || "flipkart,amazon");
  const tag = String(
    args.tag || `${todayTag()}-latest${months}m-${minPrice / 1000}k-${maxPrice / 1000}k`
  );

  const pipelineScript = path.join(rootDir, "scripts", "run_new_launch_pipeline.js");
  const priceReportScript = path.join(rootDir, "scripts", "build_new_launch_price_report.js");
  const htmlScript = path.join(rootDir, "scripts", "generate_price_status_html.js");

  const shortlistJson = path.join(outDir, `new-launch-sellwell-${tag}.json`);
  const priceStatusJson = path.join(
    outDir,
    `price-status-new-launch-sellwell-${tag}.json`
  );
  const priceStatusHtml = path.join(
    outDir,
    `price-status-new-launch-sellwell-${tag}.html`
  );

  runNodeScript(pipelineScript, [
    "--months",
    String(months),
    "--minPrice",
    String(minPrice),
    "--maxPrice",
    String(maxPrice),
    "--topN",
    String(topN),
    "--maxPages",
    String(maxPages),
    "--minMatchScore",
    String(minMatchScore),
    "--minRatingCount",
    String(minRatingCount),
    "--maxFallbackRequests",
    String(maxFallbackRequests),
    "--stores",
    stores,
    "--preferStores",
    preferStores,
    "--tag",
    tag,
    "--outDir",
    outDir,
  ]);

  runNodeScript(priceReportScript, [
    "--in",
    shortlistJson,
    "--out",
    priceStatusJson,
  ]);

  runNodeScript(htmlScript, [
    "--in",
    priceStatusJson,
    "--out",
    priceStatusHtml,
  ]);

  console.log(`Saved final price-status JSON: ${priceStatusJson}`);
  console.log(`Saved final price-status HTML: ${priceStatusHtml}`);
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
