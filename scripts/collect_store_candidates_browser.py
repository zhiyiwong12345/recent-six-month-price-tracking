#!/usr/bin/env python3
"""Collect live store candidates with a headed browser.

This is a semi-automatic collector for cases where Flipkart/Amazon page fetches
block server-side scraping. It opens a real browser, lets the user solve any
human check manually, extracts visible product cards, and writes a candidate
JSON that run_memory_cost_pass_through_report.js can consume via --candidateFile.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode


def import_playwright():
    try:
        from playwright.sync_api import sync_playwright

        return sync_playwright
    except Exception:
        alt = (
            Path.home()
            / ".local/share/uv/python/cpython-3.11.15-macos-aarch64-none/bin/python3.11"
        )
        if Path(sys.executable) != alt and alt.exists():
            os.execv(str(alt), [str(alt), __file__, *sys.argv[1:]])
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        default="store_candidates",
        choices=["store_candidates", "pricehistory_search", "pricehistory_probe"],
    )
    parser.add_argument("--store", default="flipkart", choices=["flipkart", "amazon"])
    parser.add_argument("--query", default="mobile phone")
    parser.add_argument("--minPrice", type=int, default=20000)
    parser.add_argument("--maxPrice", type=int, default=50000)
    parser.add_argument("--topN", type=int, default=30)
    parser.add_argument("--outDir", default="00_Inbox")
    parser.add_argument("--out", default="")
    parser.add_argument("--profileDir", default="")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--channel", default="chrome")
    parser.add_argument("--manualWaitSeconds", type=int, default=120)
    parser.add_argument("--scrolls", type=int, default=6)
    parser.add_argument("--candidateFile", default="")
    parser.add_argument("--searchDelayMs", type=int, default=2200)
    parser.add_argument("--captureDir", default="")
    return parser.parse_args()


def today_tag() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def build_url(args: argparse.Namespace) -> str:
    if args.store == "amazon":
        # Amazon p_36 uses paise.
        params = {
            "k": args.query,
            "i": "electronics",
            "rh": f"p_36:{args.minPrice * 100}-{args.maxPrice * 100}",
        }
        return "https://www.amazon.in/s?" + urlencode(params)

    params = {
        "q": args.query,
        "sid": "tyy,4io",
        "sort": "popularity",
    }
    return (
        "https://www.flipkart.com/search?"
        + urlencode(params)
        + f"&p%5B%5D=facets.price_range.from%3D{args.minPrice}"
        + f"&p%5B%5D=facets.price_range.to%3D{args.maxPrice}"
    )


COLOR_TOKENS = {
    "black",
    "white",
    "blue",
    "red",
    "green",
    "purple",
    "pink",
    "silver",
    "gold",
    "gray",
    "grey",
    "obsidian",
    "graphite",
    "cream",
    "navy",
    "charcoal",
    "lime",
    "sonic",
    "meteorite",
    "phantom",
    "awesome",
    "midnight",
    "starlight",
    "afterglow",
    "twilight",
    "ice",
    "aurora",
    "glacier",
    "zephyr",
    "slipstream",
    "silhouette",
    "arctic",
    "cyber",
    "star",
    "cosmic",
    "mocha",
    "pearl",
    "titan",
    "pantone",
    "reserve",
    "prismatic",
    "velvet",
    "flowing",
    "matte",
    "steel",
    "light",
    "onyx",
    "crimson",
    "transorange",
    "icy",
    "prism",
    "frost",
    "glacier",
}


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def text_tokens(value: str) -> list[str]:
    return [x for x in normalize_text(value).split() if x]


def extract_variant_label(name: str, raw_line: str, product_url: str) -> str:
    text = f"{name or ''} {raw_line or ''} {product_url or ''}".lower()
    plus = re.search(r"(\d{1,2})\s*gb\s*(?:ram)?\s*(?:\+|plus|\|)\s*(\d{2,4})\s*(gb|tb)", text)
    if plus:
        return f"{int(plus.group(1))}GB+{int(plus.group(2))}{plus.group(3).upper()}"
    ram = re.search(r"(\d{1,2})\s*gb\s*ram", text)
    rom = re.search(r"(\d{2,4})\s*(gb|tb)\s*rom", text) or re.search(
        r"(?:\(|\s)(\d{2,4})\s*(gb|tb)(?:\)|\s|$)", text
    )
    if ram and rom:
        return f"{int(ram.group(1))}GB+{int(rom.group(1))}{rom.group(2).upper()}"
    if rom:
        return f"RAM_UNKNOWN+{int(rom.group(1))}{rom.group(2).upper()}"
    return "STD"


def storage_label(variant_label: str) -> str:
    match = re.search(r"(\d{2,4})(GB|TB)(?!.*\d{2,4}(GB|TB))", str(variant_label or "").upper())
    return f"{int(match.group(1))}{match.group(2)}" if match else ""


def model_group_key(name: str) -> str:
    tokens = text_tokens(name)
    keep: list[str] = []
    for idx, token in enumerate(tokens):
        nxt = tokens[idx + 1] if idx + 1 < len(tokens) else ""
        if re.fullmatch(r"\d{1,4}", token) and nxt in {"gb", "tb", "mb"}:
            break
        if re.fullmatch(r"\d{1,4}(gb|tb|mb)", token):
            break
        if token in {"ram", "rom", "storage"}:
            break
        keep.append(token)
    while len(keep) > 1 and keep[-1] in COLOR_TOKENS:
        keep.pop()
    keep = [t for t in keep if t not in {"5g", "4g"} and t not in COLOR_TOKENS]
    return "-".join(keep)


def simplified_query(name: str) -> str:
    tokens = [t for t in text_tokens(name) if t not in COLOR_TOKENS]
    compact: list[str] = []
    for idx, token in enumerate(tokens):
        nxt = tokens[idx + 1] if idx + 1 < len(tokens) else ""
        compact.append(token)
        if re.fullmatch(r"\d{1,4}", token) and nxt in {"gb", "tb"}:
            compact.append(nxt)
            break
        if re.fullmatch(r"\d{1,4}(gb|tb)", token):
            break
    return " ".join(compact) or name


def load_candidates(candidate_file: str) -> list[dict]:
    if not candidate_file:
        return []
    parsed = json.loads(Path(candidate_file).read_text(encoding="utf-8"))
    if isinstance(parsed, list):
        rows = parsed
    else:
        rows = parsed.get("candidates") or parsed.get("products") or []
    out = []
    for row in rows:
        name = (row.get("candidate_name") or row.get("title") or row.get("name") or "").strip()
        product_url = (row.get("product_url") or row.get("url") or "").strip()
        if not name or not product_url:
            continue
        out.append(
            {
                "candidate_name": name,
                "raw_line": (row.get("raw_line") or row.get("card_text") or name).strip(),
                "product_url": product_url,
                "store_key": row.get("store_key") or row.get("store") or "",
                "store_name": row.get("store_name") or row.get("store") or "",
                "variant_label": extract_variant_label(
                    name, row.get("raw_line") or row.get("card_text") or "", product_url
                ),
                "variant_group_key": model_group_key(name),
            }
        )
    return out


def load_pricehistory_probe_targets(candidate_file: str) -> list[dict]:
    if not candidate_file:
        return []
    parsed = json.loads(Path(candidate_file).read_text(encoding="utf-8"))
    if isinstance(parsed, list):
        rows = parsed
    else:
        rows = parsed.get("products") or parsed.get("candidates") or []
    out = []
    for row in rows:
        pricehistory_page_url = (
            row.get("pricehistory_page_url") or row.get("href") or row.get("page_url") or ""
        ).strip()
        product_url = (row.get("product_url") or row.get("url") or "").strip()
        candidate_name = (
            row.get("candidate_name") or row.get("title") or row.get("name") or row.get("slug") or ""
        ).strip()
        if not candidate_name:
            continue
        if not pricehistory_page_url and row.get("slug"):
            slug = str(row.get("slug")).strip().strip("/")
            if slug:
                pricehistory_page_url = f"https://pricehistory.app/p/{slug}"
        if not pricehistory_page_url:
            continue
        out.append(
            {
                "candidate_name": candidate_name,
                "product_url": product_url,
                "pricehistory_page_url": pricehistory_page_url,
                "variant_group_key": row.get("variant_group_key") or model_group_key(candidate_name),
                "variant_label": row.get("variant_label") or extract_variant_label(candidate_name, row.get("raw_line") or "", product_url),
            }
        )
    return out


def pricehistory_search_url(query: str) -> str:
    return "https://pricehistory.app/search?" + urlencode({"q": query})


def pricehistory_extract_script() -> str:
    return r"""
    () => {
      const uniq = new Set();
      const out = [];
      const anchors = [...document.querySelectorAll('a[href*="/p/"]')];
      for (const anchor of anchors) {
        const href = anchor.href || "";
        if (!href || uniq.has(href)) continue;
        uniq.add(href);
        const card = anchor.closest('article, li, section, div');
        const cardText = ((card && card.innerText) || anchor.innerText || anchor.textContent || "").replace(/\s+/g, " ").trim();
        const text = ((anchor.textContent || "").trim()) || cardText;
        out.push({ href, text, card_text: cardText });
        if (out.length >= 20) break;
      }
      return out;
    }
    """


def result_score(candidate: dict, result: dict) -> int:
    target = normalize_text(
        f"{candidate.get('candidate_name', '')} {candidate.get('variant_label', '')}"
    )
    result_text = normalize_text(
        f"{result.get('text', '')} {result.get('card_text', '')} {result.get('href', '')}"
    )
    score = 0
    for token in text_tokens(target):
        if token in COLOR_TOKENS:
            continue
        if token in result_text:
            score += 3 if re.search(r"\d", token) else 1
    storage = storage_label(candidate.get("variant_label", ""))
    if storage and storage.lower() in result_text:
        score += 5
    if normalize_text(candidate.get("candidate_name", "")) in result_text:
        score += 8
    return score


def extract_script(store: str) -> str:
    if store == "amazon":
        return r"""
        ({minPrice, maxPrice, topN}) => {
          const parsePrice = (text) => {
            const m = String(text || "").match(/(?:₹|INR|Rs\.?)\s*([0-9][0-9,]+)/i);
            return m ? Number(m[1].replace(/,/g, "")) : null;
          };
          const out = [];
          const cards = [...document.querySelectorAll('div[data-component-type="s-search-result"]')];
          for (const card of cards) {
            const link = card.querySelector('h2 a[href]');
            const titleNode = card.querySelector('h2 span');
            const priceNode = card.querySelector('.a-price .a-offscreen, .a-price-whole');
            const title = (titleNode && titleNode.textContent || link && link.textContent || "").trim();
            const href = link ? link.href : "";
            const price = parsePrice(priceNode && priceNode.textContent || card.innerText);
            if (!title || !href || !Number.isFinite(price)) continue;
            if (price < minPrice || price > maxPrice) continue;
        out.push({
          source: "browser_amazon_search",
          store_key: "amazon",
          store_name: "Amazon",
          candidate_name: title,
          raw_line: (card.innerText || "").replace(/\s+/g, " ").trim(),
          product_url: href,
              current_store_price_inr: price,
              rating: null,
              rating_count: null,
              availability: /currently unavailable/i.test(card.innerText) ? "unavailable" : "listed",
              listing_rank: out.length + 1,
            });
            if (out.length >= topN) break;
          }
          return out;
        }
        """

    return r"""
    ({minPrice, maxPrice, topN}) => {
      const parsePrice = (text) => {
        const m = String(text || "").match(/(?:₹|INR|Rs\.?)\s*([0-9][0-9,]+)/i);
        return m ? Number(m[1].replace(/,/g, "")) : null;
      };
      const pidFromUrl = (url) => {
        try { return new URL(url).searchParams.get("pid") || url; } catch { return url; }
      };
      const titleFromCard = (card, anchor) => {
        const titleFromHref = () => {
          try {
            const path = decodeURIComponent(new URL(anchor.href).pathname);
            const beforeProduct = path.split('/p/')[0].split('/').filter(Boolean).pop() || "";
            return beforeProduct.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
          } catch {
            return "";
          }
        };
        const titled = card.querySelector('[title]');
        const title = titled && titled.getAttribute('title');
        if (title && title.trim().length > 6 && !/add to compare/i.test(title)) return title.trim();
        const candidates = [...card.querySelectorAll('a, div')].map((n) => (n.textContent || "").trim());
        const textTitle = candidates.find((t) =>
          t.length > 10 && !t.includes("₹") && !/ratings?|add to compare/i.test(t)
        );
        if (textTitle) return textTitle;
        const anchorTitle = (anchor.textContent || "").trim();
        if (anchorTitle && !/add to compare/i.test(anchorTitle)) return anchorTitle;
        return titleFromHref();
      };
      const out = [];
      const seen = new Set();
      const anchors = [...document.querySelectorAll('a[href*="/p/"]')];
      for (const anchor of anchors) {
        const href = anchor.href;
        if (!href || href.includes('/product-reviews/')) continue;
        const key = pidFromUrl(href);
        if (seen.has(key)) continue;
        const card = anchor.closest('div[data-id]') || anchor.closest('._75nlfW') || anchor.closest('._1AtVbE') || anchor.parentElement;
        if (!card) continue;
        const text = card.innerText || "";
        const title = titleFromCard(card, anchor);
        const price = parsePrice(text);
        if (!title || !Number.isFinite(price)) continue;
        if (price < minPrice || price > maxPrice) continue;
        const ratingMatch = text.match(/([0-5](?:\.[0-9])?)\s*★/);
        const ratingCountMatch = text.match(/([0-9][0-9,]*)\s+Ratings/i);
        seen.add(key);
        out.push({
          source: "browser_flipkart_search",
          store_key: "flipkart",
          store_name: "Flipkart",
          candidate_name: title,
          raw_line: text.replace(/\s+/g, " ").trim(),
          product_url: href,
          current_store_price_inr: price,
          rating: ratingMatch ? Number(ratingMatch[1]) : null,
          rating_count: ratingCountMatch ? Number(ratingCountMatch[1].replace(/,/g, "")) : null,
          availability: /currently unavailable/i.test(text) ? "unavailable" : "listed",
          listing_rank: out.length + 1,
        });
        if (out.length >= topN) break;
      }
      return out;
    }
    """


def maybe_wait_for_human_check(page, seconds: int) -> None:
    text = ""
    try:
        text = page.locator("body").inner_text(timeout=5000)
    except Exception:
        return
    if re.search(
        r"captcha|are you a human|verify|unusual traffic|just a moment|enable javascript and cookies to continue",
        text,
        re.I,
    ):
        print(
            f"Human check detected. Use the opened browser to complete it; waiting {seconds}s...",
            file=sys.stderr,
        )
        page.wait_for_timeout(seconds * 1000)


def page_diagnostic_script() -> str:
    return r"""
    () => {
      const body = ((document.body && document.body.innerText) || "").replace(/\s+/g, " ").trim();
      const title = document.title || "";
      const combined = `${title} ${body}`.toLowerCase();
      const nextNode = document.querySelector('#__NEXT_DATA__');
      let nextData = null;
      try {
        nextData = nextNode ? JSON.parse(nextNode.textContent || "null") : null;
      } catch (err) {
        nextData = null;
      }
      const pageProps = nextData && nextData.props && nextData.props.pageProps ? nextData.props.pageProps : null;
      const ogProduct = pageProps && pageProps.ogProduct ? pageProps.ogProduct : null;
      const anchors = [...document.querySelectorAll('a[href*="/p/"], a[href*="/product/"]')]
        .slice(0, 12)
        .map((anchor) => ({
          href: anchor.href || "",
          text: ((anchor.textContent || "").replace(/\s+/g, " ").trim()),
        }));
      return {
        page_url: location.href,
        title,
        challenge_detected: /captcha|are you a human|verify|unusual traffic|just a moment|enable javascript and cookies to continue|security check/i.test(combined),
        login_required: /log in|sign in/.test(combined),
        not_found: /404 page not found|page not found|doesn.t exist/.test(combined),
        search_shell_visible: /enter name or paste the product link|search price history/.test(combined),
        body_excerpt: body.slice(0, 800),
        next_data_present: !!nextNode,
        api_url: (pageProps && pageProps.apiUrl) || "",
        og_slug: (ogProduct && ogProduct.slug) || "",
        og_url: (ogProduct && ogProduct.url) || "",
        og_store: (ogProduct && ogProduct.store && ogProduct.store.name) || "",
        og_name: (ogProduct && (ogProduct.name || ogProduct.product_name)) || "",
        anchors,
      };
    }
    """


def slug_from_pricehistory_url(url: str) -> str:
    if "/p/" not in str(url):
        return ""
    return str(url).split("/p/", 1)[1].split("?", 1)[0].strip().strip("/")


def collect_pricehistory_probes(page, args: argparse.Namespace) -> list[dict]:
    targets = load_pricehistory_probe_targets(args.candidateFile)
    out = []
    for idx, target in enumerate(targets[: args.topN], start=1):
        page_url = target["pricehistory_page_url"]
        page.goto(page_url, wait_until="domcontentloaded", timeout=60000)
        maybe_wait_for_human_check(page, args.manualWaitSeconds)
        page.wait_for_timeout(args.searchDelayMs)
        diagnostic = page.evaluate(page_diagnostic_script())
        out.append(
            {
                "candidate_name": target["candidate_name"],
                "product_url": target.get("product_url", ""),
                "pricehistory_page_url": page_url,
                "variant_group_key": target.get("variant_group_key", ""),
                "variant_label": target.get("variant_label", ""),
                "slug_hint": slug_from_pricehistory_url(page_url),
                "probe_rank": idx,
                "diagnostic": diagnostic,
            }
        )
    return out


def collect_pricehistory_products(page, args: argparse.Namespace) -> list[dict]:
    candidates = load_candidates(args.candidateFile)
    products: list[dict] = []
    for idx, candidate in enumerate(candidates[: args.topN], start=1):
        queries = [candidate["candidate_name"]]
        alt = simplified_query(candidate["candidate_name"])
        if alt and alt not in queries:
            queries.append(alt)
        best = None
        for query in queries:
            page.goto(pricehistory_search_url(query), wait_until="domcontentloaded", timeout=60000)
            maybe_wait_for_human_check(page, args.manualWaitSeconds)
            page.wait_for_timeout(args.searchDelayMs)
            diagnostic = page.evaluate(page_diagnostic_script())
            if diagnostic.get("challenge_detected") or diagnostic.get("login_required"):
                best = {
                    "href": "",
                    "text": "",
                    "card_text": "",
                    "diagnostic": diagnostic,
                }
                break
            results = page.evaluate(pricehistory_extract_script())
            if not results:
                continue
            ranked = sorted(
                ((result_score(candidate, row), row) for row in results),
                key=lambda x: x[0],
                reverse=True,
            )
            if ranked and ranked[0][0] > 0:
                best = ranked[0][1]
                break
        if not best:
            continue
        href = best.get("href", "")
        diagnostic = best.get("diagnostic") or {}
        if not href:
            products.append(
                {
                    "candidate_name": candidate["candidate_name"],
                    "raw_line": candidate.get("raw_line") or candidate["candidate_name"],
                    "product_url": candidate["product_url"],
                    "store_key": candidate.get("store_key") or args.store,
                    "store_name": candidate.get("store_name") or args.store.title(),
                    "variant_group_key": candidate.get("variant_group_key") or model_group_key(candidate["candidate_name"]),
                    "variant_label": candidate.get("variant_label") or "STD",
                    "probe_status": "blocked_or_empty",
                    "probe_diagnostic": diagnostic,
                    "selection_hint": {"query": query},
                }
            )
            continue
        slug = href.split("/p/", 1)[1] if "/p/" in href else ""
        slug = slug.split("?", 1)[0].strip("/")
        if not slug:
            continue
        products.append(
            {
                "candidate_name": candidate["candidate_name"],
                "raw_line": candidate.get("raw_line") or candidate["candidate_name"],
                "product_url": candidate["product_url"],
                "store_key": candidate.get("store_key") or args.store,
                "store_name": candidate.get("store_name") or args.store.title(),
                "variant_group_key": candidate.get("variant_group_key") or model_group_key(candidate["candidate_name"]),
                "variant_label": candidate.get("variant_label") or "STD",
                "sku_status": "needs_review"
                if str(candidate.get("variant_label") or "").startswith("RAM_UNKNOWN+")
                else ("confirmed" if candidate.get("variant_label") not in {"", "STD"} else "unknown"),
                "slug": slug,
                "pricehistory_page_url": href,
                "selection_hint": {
                    "query": query,
                    "result_text": best.get("text", ""),
                    "result_card_text": best.get("card_text", ""),
                    "browser_rank": idx,
                },
                "probe_status": "matched",
                "probe_diagnostic": diagnostic,
            }
        )
    return products


def main() -> int:
    args = parse_args()
    out_dir = Path(args.outDir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    if args.mode in {"pricehistory_search", "pricehistory_probe"}:
        default_name = f"pricehistory-browser-search-{args.store}-{today_tag()}.json"
    else:
        default_name = (
            f"current-store-candidates-{args.store}-{today_tag()}-{args.minPrice}-{args.maxPrice}.json"
        )
    out_path = Path(args.out).resolve() if args.out else out_dir / default_name
    profile_dir = (
        Path(args.profileDir).resolve()
        if args.profileDir
        else out_dir / f".browser-profile-{args.store}"
    )
    profile_dir.mkdir(parents=True, exist_ok=True)

    sync_playwright = import_playwright()
    url = build_url(args)
    with sync_playwright() as p:
        launch_kwargs = {
            "headless": args.headless,
            "viewport": {"width": 1440, "height": 1000},
        }
        if args.channel:
            launch_kwargs["channel"] = args.channel
        try:
            context = p.chromium.launch_persistent_context(str(profile_dir), **launch_kwargs)
        except Exception as first_error:
            if args.channel:
                raise RuntimeError(
                    "Failed to launch the requested browser channel. "
                    "Try --channel '' to use bundled Chromium after running "
                    "`playwright install chromium`, or pass a fresh --profileDir "
                    "if Chrome reports profile/session locking."
                ) from first_error
            context = p.chromium.launch_persistent_context(str(profile_dir), **launch_kwargs)
        page = context.pages[0] if context.pages else context.new_page()
        if args.mode == "pricehistory_search":
            candidates = collect_pricehistory_products(page, args)
            payload = {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": "browser_pricehistory_search",
                "store": args.store,
                "candidate_file": str(Path(args.candidateFile).resolve()) if args.candidateFile else "",
                "products": candidates,
                "stats": {
                    "products": len(candidates),
                    "matched": sum(1 for row in candidates if row.get("probe_status") == "matched"),
                    "blocked_or_empty": sum(1 for row in candidates if row.get("probe_status") == "blocked_or_empty"),
                },
            }
        elif args.mode == "pricehistory_probe":
            candidates = collect_pricehistory_probes(page, args)
            payload = {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": "browser_pricehistory_probe",
                "store": args.store,
                "candidate_file": str(Path(args.candidateFile).resolve()) if args.candidateFile else "",
                "products": candidates,
                "stats": {
                    "products": len(candidates),
                    "challenge_detected": sum(
                        1 for row in candidates if (row.get("diagnostic") or {}).get("challenge_detected")
                    ),
                    "next_data_present": sum(
                        1 for row in candidates if (row.get("diagnostic") or {}).get("next_data_present")
                    ),
                    "not_found": sum(
                        1 for row in candidates if (row.get("diagnostic") or {}).get("not_found")
                    ),
                },
            }
        else:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            maybe_wait_for_human_check(page, args.manualWaitSeconds)
            for _ in range(max(0, args.scrolls)):
                page.mouse.wheel(0, 1400)
                page.wait_for_timeout(900)
            candidates = page.evaluate(
                extract_script(args.store),
                {"minPrice": args.minPrice, "maxPrice": args.maxPrice, "topN": args.topN},
            )
            payload = {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": f"browser_{args.store}_search",
                "store": args.store,
                "query": args.query,
                "min_price": args.minPrice,
                "max_price": args.maxPrice,
                "url": url,
                "candidates": candidates,
                "stats": {"candidates": len(candidates)},
            }
        context.close()
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved browser JSON: {out_path}")
    if args.mode == "pricehistory_search":
        print(f"products={len(candidates)}")
    else:
        print(f"candidates={len(candidates)}")
    if not candidates:
        print("No rows extracted. The page may still be blocked or the selectors changed.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ImportError as exc:
        print(f"Playwright is not installed for this Python: {exc}", file=sys.stderr)
        print("Install Python Playwright or run with the bundled Python that has it.", file=sys.stderr)
        raise SystemExit(2)
