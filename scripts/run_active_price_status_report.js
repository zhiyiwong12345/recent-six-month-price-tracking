#!/usr/bin/env node
"use strict";

const fs = require("fs");
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

function consolidateProductsBySku(products) {
  const bySku = new Map();
  for (const product of products || []) {
    const key = [
      product.variant_group_key || product.slug,
      product.price_basis_store_key || product.store_key || "",
      product.variant_label || "STD",
    ].join("::");
    const list = bySku.get(key) || [];
    list.push(product);
    bySku.set(key, list);
  }

  return Array.from(bySku.values()).map((list) => {
    if (list.length === 1) return list[0];
    const primary = list
      .slice()
      .sort((a, b) => {
        const ap = Number(a.current_price_inr);
        const bp = Number(b.current_price_inr);
        if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) return ap - bp;
        return (
          (Number(b.raw_point_count) || 0) - (Number(a.raw_point_count) || 0)
        );
      })[0];
    return {
      ...primary,
      merged_color_variant_count: list.length,
      merged_pricehistory_pages: list
        .map((item) => item.pricehistory_page_url)
        .filter(Boolean),
      selection_hint: {
        ...(primary.selection_hint || {}),
        merged_candidate_names: list
          .map((item) => item.selection_hint && item.selection_hint.candidate_name)
          .filter(Boolean),
      },
    };
  });
}

function main() {
  const args = parseArgs(process.argv);
  const rootDir = path.resolve(__dirname, "..");
  const outDir = args.outDir
    ? path.resolve(String(args.outDir))
    : path.join(rootDir, "00_Inbox");

  const minPrice = Number(args.minPrice || 20000);
  const maxPrice = Number(args.maxPrice || 50000);
  const topN = Number(args.topN || 10);
  const historyMonths = Number(args.historyMonths || 6);
  const stores = String(args.stores || "flipkart,amazon");
  const preferStores = String(args.preferStores || "flipkart,amazon");
  const tag = String(
    args.tag ||
      `${todayTag()}-active-hot-${historyMonths}m-${minPrice / 1000}k-${maxPrice / 1000}k`
  );

  const workflowScript = path.join(rootDir, "scripts", "price_status_workflow.js");
  const htmlScript = path.join(rootDir, "scripts", "generate_price_status_html.js");
  const jsonOut = path.join(outDir, `price-status-active-hot-${tag}.json`);
  const htmlOut = path.join(outDir, `price-status-active-hot-${tag}.html`);

  runNodeScript(workflowScript, [
    "--autoTop",
    "--topN",
    String(topN),
    "--minPrice",
    String(minPrice),
    "--maxPrice",
    String(maxPrice),
    "--stores",
    stores,
    "--preferStores",
    preferStores,
    "--phoneOnly",
    "--out",
    jsonOut,
  ]);

  const report = JSON.parse(fs.readFileSync(jsonOut, "utf8"));
  report.workflow = "active_hot_competitor_price_status";
  report.products = consolidateProductsBySku(report.products);
  report.input = {
    ...(report.input || {}),
    run_mode: "active_hot",
    history_months: historyMonths,
    price_observation: `last_${historyMonths}_months`,
  };
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), "utf8");

  runNodeScript(htmlScript, ["--in", jsonOut, "--out", htmlOut]);

  console.log(`Saved active hot price-status JSON: ${jsonOut}`);
  console.log(`Saved active hot price-status HTML: ${htmlOut}`);
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
