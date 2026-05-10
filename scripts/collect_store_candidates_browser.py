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
    if re.search(r"captcha|are you a human|verify|unusual traffic", text, re.I):
        print(
            f"Human check detected. Use the opened browser to complete it; waiting {seconds}s...",
            file=sys.stderr,
        )
        page.wait_for_timeout(seconds * 1000)


def main() -> int:
    args = parse_args()
    out_dir = Path(args.outDir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = (
        Path(args.out).resolve()
        if args.out
        else out_dir
        / f"current-store-candidates-{args.store}-{today_tag()}-{args.minPrice}-{args.maxPrice}.json"
    )
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
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        maybe_wait_for_human_check(page, args.manualWaitSeconds)
        for _ in range(max(0, args.scrolls)):
            page.mouse.wheel(0, 1400)
            page.wait_for_timeout(900)
        candidates = page.evaluate(
            extract_script(args.store),
            {"minPrice": args.minPrice, "maxPrice": args.maxPrice, "topN": args.topN},
        )
        context.close()

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
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved candidates JSON: {out_path}")
    print(f"candidates={len(candidates)}")
    if not candidates:
        print("No candidates extracted. The page may still be blocked or the selectors changed.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ImportError as exc:
        print(f"Playwright is not installed for this Python: {exc}", file=sys.stderr)
        print("Install Python Playwright or run with the bundled Python that has it.", file=sys.stderr)
        raise SystemExit(2)
