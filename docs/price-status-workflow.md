# 价格状态更新 Workflow（Price Status Update）

这个 workflow 用于：

1. 输入单个机型（商品链接 / 机型名）后，返回最新价格与历史价格变化。
2. 自动更新印度 `20k-50k` 在售手机的 topN（默认 10 个）。
3. 支持 `latestTop`（按首次出现价格时间排序，提取最新上市 topN）。
4. 支持商城过滤与优先级（例如 `Flipkart 优先`）。

## 脚本位置

`/Users/nothing/Documents/New project/scripts/price_status_workflow.js`

## 2026-05-23 数据源更新

当前价格历史的优先级已经调整为：

1. `PriceBefore`：主历史源。用 Flipkart/Amazon 商品链接访问 `https://pricebefore.com/search/?q=<商品链接>`，命中商品页后直接解析页面里的 `var data = { dates, prices }` 每日价格数组。
2. 本地缓存：避免每次重复访问 PriceBefore。手动清单报告会写入 `00_Inbox/manual-pricebefore-history-cache-2026-05-23.json`。
3. 旧 PriceHistory / PriceHistory.app 缓存：只作为兜底，不再作为无人值守主链路。

这次切换解决了之前两个核心问题：

- `pricehistory.app` 会触发 Cloudflare / Turnstile，无法稳定无人值守抓取。
- 旧报告有时只有 `current / lowest / highest`，但没有完整日线点，导致图里看不出持续价格阶段。

PriceBefore 页面目前能直接解析出连续日线，因此报告可以显示从首见价开始的完整价格曲线和调价事件。

## 运行方式

### 1) 用商品链接（Flipkart/Amazon）跑单机型

```bash
node /Users/nothing/Documents/New\ project/scripts/price_status_workflow.js \
  --url 'https://www.flipkart.com/nothing-phone-3a-white-128-gb/p/itm49557c5a65f9c?pid=MOBH8G3PK4RZFYAA'
```

### 2) 直接用 slug 跑单机型

```bash
node /Users/nothing/Documents/New\ project/scripts/price_status_workflow.js \
  --slug 'nothing-phone-3a-white-128-gb'
```

### 3) 用机型名（从 20k-50k 移动端候选中匹配）

```bash
node /Users/nothing/Documents/New\ project/scripts/price_status_workflow.js \
  --model 'Nothing Phone 3a'
```

### 4) 自动拉取印度 mobiles 20k-50k top10

```bash
node /Users/nothing/Documents/New\ project/scripts/price_status_workflow.js \
  --autoTop --topN 10 --minPrice 20000 --maxPrice 50000 --locale en-in \
  --stores flipkart,amazon --preferStores flipkart,amazon
```

### 5) 最新上市 top10（按发售时间倒序）

```bash
node /Users/nothing/Documents/New\ project/scripts/price_status_workflow.js \
  --latestTop --topN 10 --latestPool 160 \
  --minPrice 20000 --maxPrice 40000 --locale en-in \
  --stores flipkart,amazon --preferStores flipkart,amazon \
  --out /Users/nothing/Documents/New\ project/00_Inbox/price-status-latest10.json
```

### 6) 输出到文件

```bash
node /Users/nothing/Documents/New\ project/scripts/price_status_workflow.js \
  --autoTop --topN 10 --out /Users/nothing/Documents/New\ project/00_Inbox/price-status.json
```

## 输出字段说明（核心）

- `current_price_inr`：当前价格
- `first_seen_price_at` / `first_seen_price_inr`：首次出现价格的时间与价格
- `price_change_events`：调价事件（时间点 + 价格）
- `stable_price_phases`：稳定价格阶段（开始、结束、持续天数、下一次价格）
- `pricebefore_page_url` / `history_page_url`：PriceBefore 商品历史页
- `pricehistory_page_url`：旧 PriceHistory 兜底历史页
- `product_url`：当前购买链接（通常是 Flipkart/Amazon）

## 可视化报告（从发售开始调价图）

先生成 JSON，再转 HTML：

```bash
node /Users/nothing/Documents/New\ project/scripts/price_status_workflow.js \
  --autoTop --topN 10 --minPrice 20000 --maxPrice 50000 --locale en-in \
  --out /Users/nothing/Documents/New\ project/00_Inbox/price-status-top10.json

node /Users/nothing/Documents/New\ project/scripts/generate_price_status_html.js \
  --in /Users/nothing/Documents/New\ project/00_Inbox/price-status-top10.json \
  --out /Users/nothing/Documents/New\ project/00_Inbox/price-status-top10.html
```

HTML 报告会包含：

- 每个机型从首条价格到当前的完整调价曲线图（阶梯线，能显示持续期）
- 当前价 / 上一档价格 / 变化幅度
- 全量调价时间表（含每次 delta）
- 明确标注该价格基于哪个商城（Flipkart / Amazon）

## 一键双报告（在售Top10 + 最新上市Top10）

```bash
node /Users/nothing/Documents/New\ project/scripts/run_price_status_reports.js \
  --topN 10 --minPrice 20000 --maxPrice 40000 \
  --stores flipkart,amazon --preferStores flipkart,amazon \
  --outDir /Users/nothing/Documents/New\ project/00_Inbox
```

## 备注

- 新主链路会优先用商品链接查 PriceBefore；旧链路里的 `getSlugFromUrl` / `updateFromSlug` 只作为兜底。
- 如果 PriceBefore 没有该商品页，报告会保留商城当前价并标记为待补历史。
- `--model` 模式是从 mobiles 20k-50k 候选中做名称匹配，不是全网搜索。
