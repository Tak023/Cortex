#!/usr/bin/env python3
"""
One-shot JSON bridge for Cortex Jarvis live grounding.

Usage:
  uv run --directory RivalSearchMCP python cortex_bridge.py "<query>" [auto|news|web]

Prints a single JSON object to stdout:
  { "ok": true, "provider": "rival-search", "hits": [ {title,url,snippet}, ... ], "notes": [] }
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from typing import Any, Dict, List


def _hit(title: str, url: str | None = None, snippet: str = "") -> Dict[str, str]:
    return {
        "title": (title or "Result").strip()[:220],
        "url": (url or "").strip(),
        "snippet": (snippet or title or "").strip()[:400],
    }


def _news_hits(articles: List[Any], limit: int = 8) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for a in articles or []:
        if not isinstance(a, dict):
            continue
        title = str(a.get("title") or "").strip()
        if not title:
            continue
        desc = re.sub(r"<[^>]+>", " ", str(a.get("description") or ""))
        desc = re.sub(r"\s+", " ", desc).strip()
        src = a.get("source") or a.get("platform") or ""
        snippet = desc or (f"Source: {src}" if src else title)
        out.append(_hit(title, a.get("url"), snippet))
        if len(out) >= limit:
            break
    return out


def _web_hits(results: Dict[str, Any], limit: int = 8) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    per_engine = (results or {}).get("results") or {}
    for _engine, engine_data in per_engine.items():
        if not isinstance(engine_data, dict):
            continue
        if engine_data.get("status") not in (None, "success"):
            # still try to read results if present
            pass
        for r in engine_data.get("results") or []:
            if not isinstance(r, dict):
                continue
            title = str(r.get("title") or "").strip()
            if not title:
                continue
            snippet = str(
                r.get("description") or r.get("snippet") or r.get("full_content") or title
            )
            snippet = re.sub(r"\s+", " ", snippet).strip()[:400]
            out.append(_hit(title, r.get("url") or r.get("real_url"), snippet))
            if len(out) >= limit:
                return out
    return out


def _dedupe(hits: List[Dict[str, str]]) -> List[Dict[str, str]]:
    seen = set()
    out = []
    for h in hits:
        key = re.sub(r"[^a-z0-9]+", " ", h["title"].lower()).strip()[:90]
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(h)
    return out


NEWS_RE = re.compile(
    r"\b(news|headline|headlines|breaking|today|latest|what\s+happened|current\s+events)\b",
    re.I,
)


async def run(query: str, mode: str = "auto") -> Dict[str, Any]:
    from rival_search_mcp.core.news import NewsAggregator
    from rival_search_mcp.tools.multi_search import get_orchestrator

    notes: List[str] = []
    hits: List[Dict[str, str]] = []
    providers: List[str] = []

    use_news = mode in ("news", "auto") and (mode == "news" or NEWS_RE.search(query))
    use_web = mode in ("web", "auto")

    if use_news:
        try:
            agg = NewsAggregator()
            # Prefer fresher window for temporal questions
            tr = "day" if re.search(r"\b(today|tonight|breaking|latest)\b", query, re.I) else "week"
            articles = await agg.search_news(
                query=query,
                max_results=8,
                language="en",
                country="US",
                time_range=tr,  # type: ignore[arg-type]
            )
            nh = _news_hits(articles, 8)
            if nh:
                hits.extend(nh)
                providers.append("news_aggregation")
            else:
                notes.append("news_aggregation: empty")
        except Exception as e:
            notes.append(f"news_aggregation: {e}")

    if use_web and (mode == "web" or len(hits) < 4):
        try:
            orch = get_orchestrator()
            results = await orch.search_all_engines(
                query=query,
                num_results=4,
                extract_content=False,
                follow_links=False,
                max_depth=1,
            )
            wh = _web_hits(results, 8)
            if wh:
                hits.extend(wh)
                providers.append("web_search")
            else:
                notes.append("web_search: empty")
        except Exception as e:
            notes.append(f"web_search: {e}")

    hits = _dedupe(hits)[:10]
    return {
        "ok": bool(hits),
        "provider": "+".join(providers) if providers else "rival-search",
        "providerLabel": "rival-search",
        "hits": hits,
        "notes": notes,
        "query": query,
    }


def main() -> int:
    query = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    mode = (sys.argv[2] if len(sys.argv) > 2 else "auto").strip().lower() or "auto"
    if not query:
        print(json.dumps({"ok": False, "hits": [], "notes": ["empty query"], "provider": "rival-search"}))
        return 1
    try:
        data = asyncio.run(run(query, mode))
        print(json.dumps(data, ensure_ascii=False))
        return 0 if data.get("ok") else 2
    except Exception as e:
        print(json.dumps({"ok": False, "hits": [], "notes": [str(e)], "provider": "rival-search"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
