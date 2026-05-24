const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parsePriceBeforeProductPage,
  buildPriceBeforeSearchUrl,
} = require("../scripts/pricebefore_history");

const fixtureHtml = `<!doctype html>
<html>
<head>
  <title>Price History of OPPO Reno15c 5G</title>
  <link rel="canonical" href="https://www.pricebefore.com/oppo-reno15c-5g-afterglow-pink-256-p877730.html"/>
</head>
<body>
  <h1>OPPO Reno15c 5G (Afterglow Pink, 256 GB)</h1>
  <img id="product-img" data-seller="flipkart" src="phone.jpg" />
  <div class="js-product-price">&#8377;41,999</div>
  <a title="Go to shop" href="https://www.flipkart.com/oppo-reno15c-5g-afterglow-pink-256-gb/p/itmc54a5df4d2236?pid=MOBHGZZ93FJ7QFPX">Buy on Flipkart</a>
  <script>
    var data = {"dates":["23 Feb 2026","24 Feb 2026","07 Mar 2026","08 Apr 2026"],"prices":[34999,34999,37999,41999],"lowestPrices":[34999,34999,34999,34999],"highestPrices":[41999,41999,41999,41999],"yAxisTicksMin":20000};
    var ctx = document.getElementById('price_history_chart');
  </script>
  <script>
  gtag('event', 'view_item', {
    currency: 'INR',
    value: 1,
    items: [
      {"item_id":877730,"item_name":"OPPO Reno15c 5G","item_category":"Mobile Phones","item_brand":"OPPO","price":41999,"affiliation":"Flipkart"}
    ]
  });
  </script>
</body>
</html>`;

test("builds a PriceBefore search URL from a store product URL", () => {
  const storeUrl = "https://www.flipkart.com/vivo-t5x-5g-cyber-green-128-gb/p/itm7?pid=MOBHH69NGFZAYK6M";
  const url = buildPriceBeforeSearchUrl(storeUrl);

  assert.equal(url.toString(), "https://pricebefore.com/search/?q=https%3A%2F%2Fwww.flipkart.com%2Fvivo-t5x-5g-cyber-green-128-gb%2Fp%2Fitm7%3Fpid%3DMOBHH69NGFZAYK6M");
});

test("parses daily prices and price-change events from a PriceBefore product page", () => {
  const product = parsePriceBeforeProductPage(
    fixtureHtml,
    "https://www.pricebefore.com/oppo-reno15c-5g-afterglow-pink-256-p877730.html",
    {
      candidate_name: "OPPO Reno15c 5G (Afterglow Pink, 256 GB)",
      current_store_price_inr: 41999,
    }
  );

  assert.equal(product.ok, true);
  assert.equal(product.product.title, "OPPO Reno15c 5G (Afterglow Pink, 256 GB)");
  assert.equal(product.product.store_key, "flipkart");
  assert.equal(product.product.store_product_code, "MOBHGZZ93FJ7QFPX");
  assert.equal(product.product.price_source, "pricebefore");
  assert.equal(product.product.pricebefore_page_url, "https://www.pricebefore.com/oppo-reno15c-5g-afterglow-pink-256-p877730.html");
  assert.equal(product.product.first_seen_price_at, "2026-02-23T00:00:00.000Z");
  assert.equal(product.product.first_seen_price_inr, 34999);
  assert.equal(product.product.current_price_inr, 41999);
  assert.equal(product.product.lowest_price_inr, 34999);
  assert.equal(product.product.highest_price_inr, 41999);
  assert.equal(product.product.average_price_inr, 37499);
  assert.deepEqual(
    product.product.price_change_events.map((event) => ({
      date: event.timestamp_iso.slice(0, 10),
      price: event.price_inr,
    })),
    [
      { date: "2026-02-23", price: 34999 },
      { date: "2026-03-07", price: 37999 },
      { date: "2026-04-08", price: 41999 },
    ]
  );
  assert.equal(product.product.raw_price_points.length, 4);
});
