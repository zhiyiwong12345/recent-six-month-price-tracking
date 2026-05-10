# Memory Cost Pass-through Tracker

## 背景与目标

从 `2025 Q3` 开始，内存价格快速上涨。手机厂商已经在售、即将发售、以及仍在补货生产的机型，都可能通过官方调价、促销回撤、渠道价上移、SKU 结构调整等方式把成本压力传导到终端售价。

这个 workflow 的目标不是泛泛做价格历史查询，而是帮助产品经理持续回答：

- 哪些印度在售手机出现了价格上调。
- 具体什么时候调、调了多少、涨幅是多少。
- 上调是否持续，还是短期促销/卖家切换造成的噪声。
- 哪些 SKU 先涨，例如 `12GB+256GB` 是否比 `8GB+128GB` 更敏感。
- 这些动作背后的可能策略：成本传导、库存收缩、促销结束、生命周期管理、发售价重定锚等。

## 已确认的业务口径

- 市场：India。
- 品类：手机，不含平板、配件、耳机等。
- 价格带：`₹20,000-₹50,000`。
- 商城：Flipkart / Amazon India，Flipkart 优先。
- 价格历史：优先基于具体 Flipkart/Amazon 商品链接查询 pricehistory，而不是只用关键词匹配。
- SKU 口径：`RAM+ROM` 是一个 SKU，例如 `8GB+128GB`、`12GB+256GB`。颜色不算独立 SKU，需要合并。
- 成本传导观察起点：`2025-07-01`。
- 全历史曲线保留为背景，近期调价判断从 `2025-07-01` 起单独计算。

## 监控池分层

### 1. 高敏感池

`2025-10-01` 之后在印度上市、当前仍在售、位于 `₹20k-₹50k` 的机型。

这些机型的 launch price 或上市后早期调价最可能已经反映内存成本上涨。

### 2. 补货敏感池

`2025-04-01` 到 `2025-09-30` 上市，且当前仍在 Flipkart/Amazon 上有销量、评分、库存或搜索可见度的机型。

这些机型如果从 `2025 Q4` 开始上调，可能是 `2025 Q3` 新内存订单或持续补货带来的成本传导。

### 3. 对照池

`2025-04-01` 前上市，但现在仍热销或仍在核心价位带销售的机型。

这些机型如果涨价，需要更谨慎解释，可能是库存、渠道、卖家切换、促销结束或生命周期动作，不一定是内存成本主导。

## 当前架构回顾

现有脚本大致分成三类：

- 新品池抓取：`fetch_new_launch_pool.js` 从 91mobiles、Smartprix、Gadgets360 拉新品列表。
- 在售/热销筛选：`screen_new_launch_sellwell.js` 和 `price_status_workflow.js --autoTop` 从商城或 pricehistory deals 数据中筛选候选。
- 价格历史报告：`price_status_workflow.js` 获取 pricehistory 数据，`generate_price_status_html.js` 生成 HTML。

当前实现已经具备几个基础能力：

- 能通过具体商品链接查 pricehistory。
- 能获取 full history 的价格变化点。
- 能在报告里标注价格来源店铺。
- 能初步按颜色合并、按 SKU 保留变体。
- 能生成 HTML 图表和调价表格。

但它还不是合格的 Memory Cost Pass-through Tracker。

## 当前主要矛盾

### 1. 候选池和目标不完全一致

当前 active hot 报告使用 pricehistory deals API 做候选池。这个池更像 pricehistory 自己的商品/优惠数据，不等于 Flipkart/Amazon 当前热销或当前在售榜。

风险：

- 容易选到过期老机型。
- `latest fetched` 可能停留在历史时间。
- 不能稳定代表当前竞争环境。

目标状态：

- 候选池必须回到 Flipkart/Amazon 当前页面或搜索结果。
- pricehistory 只负责价格历史，不负责定义当前 top list。

### 2. 近期窗口和全历史展示混用

当前 HTML 曾把 `6 months` 窗口用于图表和表格，但 Lowest/Highest 又来自全历史，导致“卡片显示历史高低价，图里却只有平线”的矛盾。

目标状态：

- 近期监控视图：从 `2025-07-01` 或指定窗口开始，只判断近期调价。
- 全历史背景视图：从 launch/first seen 开始，展示完整曲线、历史高低、当前历史分位。
- 两个视图必须分开展示，不能混用指标。

### 3. 调价动作没有和价格噪声区分

电商价格会因为短促销、银行 offer、卖家切换、库存状态等频繁波动。单个价格点变化不能直接等同于厂商调价。

目标状态：

- 定义有效上调：相对上一个稳定平台价上涨，并持续超过最小天数，或在多次抓取中保持。
- 保留短期波动，但标记为 `noise / promo / seller volatility`。
- 报告里区分 `price increase detected` 与 `temporary fluctuation`。

### 4. 每天 top10 漂移会削弱追踪价值

如果每天只重新抓当天 top10，监控对象会不断变化，难以判断同一机型连续几周的调价行为。

目标状态：

- 建立持久监控池。
- 新机型可加入，旧机型标记为退出观察或低优先级，而不是直接消失。
- 每日报告既有新发现，也有固定池的连续追踪。

## 目标架构

### Layer 1: Product Universe

合并两个来源：

- 新品来源：91mobiles Latest Mobiles、Smartprix、Gadgets360。
- 当前商城来源：Flipkart/Amazon India 的手机搜索、榜单、排序页、可用商品页。

输出统一候选字段：

- model name
- launch date
- source site
- listing source
- store
- product URL
- current price
- availability
- rating / rating count
- raw title

### Layer 2: Candidate Classification

按上市时间和当前在售状态分层：

- `high_sensitive`: launch date >= `2025-10-01`
- `restock_sensitive`: `2025-04-01` <= launch date <= `2025-09-30`
- `control`: launch date < `2025-04-01` but currently hot/selling

同时执行：

- 手机品类过滤。
- `₹20k-₹50k` 当前价格过滤。
- Flipkart 优先，Amazon 兜底。
- 颜色合并。
- SKU 拆分与校验。

### Layer 3: Price History Collection

对每个 store product URL：

- 使用 link-first 方式查询 pricehistory。
- 保存完整价格历史。
- 保存 pricehistory page URL、store URL、store basis。
- 如果 pricehistory 当前数据过期，需要显式标记 `stale_history`，不要伪造成当前价格稳定。

### Layer 4: Price Event Detection

从完整历史中计算两套输出：

- Full lifecycle facts:
  - first seen price
  - full history lowest/highest
  - current vs historical percentile
  - full price timeline

- Memory pass-through facts:
  - baseline price before `2025-07-01`
  - first increase after `2025-07-01`
  - increase amount and percentage
  - duration of increased price
  - whether current price still reflects the increase
  - SKU-level synchronization

### Layer 5: Report and Interpretation

报告应该按 PM 决策方式组织：

- Executive summary: 本期新增涨价、持续涨价、疑似噪声、无变化。
- Watchlist table: 机型、SKU、池子、当前价、基准价、涨幅、涨价日期、持续天数、数据来源。
- SKU comparison: 同机型不同 SKU 的价格曲线和涨价状态。
- Full lifecycle appendix: 完整历史曲线和调价点。
- Strategy notes: 成本传导/促销结束/库存收缩/生命周期动作/发售价重定锚，带置信度。

## 下一步代码调整计划

确认方案后再改代码，优先级如下：

1. 重构报告口径：近期调价视图和全历史背景视图分离。
2. 修正 stale 数据处理：如果 pricehistory 最后真实点早于观察窗口，不画成当前稳定平线。
3. 把观察起点从简单 `6 months` 改为明确的 `2025-07-01`，同时保留可配置窗口。
4. 重做候选池：Flipkart/Amazon 当前在售和热销作为 top list 来源，pricehistory 不再决定 top list。
5. 建立持久监控池：每日新增、保留、退出观察都可追踪。
6. 强化 SKU 解析：`RAM+ROM` 必须优先从标题、规格、URL、PID 映射中确认；只有 ROM 时标记 `RAM_UNKNOWN`，不能当成完整 SKU。
7. 增加调价事件判定：区分真实持续上调与短期波动。
8. 更新自动化：每天输出 Memory Cost Pass-through Report，而不是泛用 top10 price status。

## 当前不做的事

- 不直接用关键词搜索替代商品链接。
- 不把颜色当 SKU。
- 不用 pricehistory deals API 直接代表当前商城 top10。
- 不把全历史高低价和近期窗口图表混在同一指标组里。
- 不在没有真实近期价格点时人为画出“当前稳定”的结论。
