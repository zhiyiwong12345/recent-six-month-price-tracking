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
  const topN = Number(args.topN || 20);
  const maxPages = Number(args.maxPages || 220);
  const minMatchScore = Number(args.minMatchScore || 0.35);
  const minRatingCount = Number(args.minRatingCount || 0);
  const maxFallbackRequests = Number(args.maxFallbackRequests || 20);
  const stores = String(args.stores || "flipkart,amazon");
  const preferStores = String(args.preferStores || "flipkart,amazon");
  const tag = String(args.tag || "3m-20k-40k");

  const fetchScript = path.join(rootDir, "scripts", "fetch_new_launch_pool.js");
  const screenScript = path.join(rootDir, "scripts", "screen_new_launch_sellwell.js");

  const poolJson = path.join(outDir, `new-launch-pool-last-${months}-months-${tag}.json`);
  const shortlistJson = path.join(outDir, `new-launch-sellwell-${tag}.json`);
  const shortlistHtml = path.join(outDir, `new-launch-sellwell-${tag}.html`);

  runNodeScript(fetchScript, [
    "--months",
    String(months),
    "--out",
    poolJson,
  ]);

  runNodeScript(screenScript, [
    "--in",
    poolJson,
    "--out",
    shortlistJson,
    "--htmlOut",
    shortlistHtml,
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
  ]);

  console.log(`Saved pool: ${poolJson}`);
  console.log(`Saved shortlist JSON: ${shortlistJson}`);
  console.log(`Saved shortlist HTML: ${shortlistHtml}`);
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
