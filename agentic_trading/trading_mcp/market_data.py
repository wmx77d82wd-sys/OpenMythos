"""Binance public-API client: stdlib HTTP, TTL cache, friendly errors.

The HTTP transport is injectable so tests never touch the network, and the
base URL is configurable (TRADING_MCP_API_BASE) for regions where
api.binance.com is unavailable (e.g. api.binance.us) or for mirrors.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Callable, Optional

VALID_INTERVALS = ("1m", "5m", "15m", "1h", "4h", "1d", "1w")

# (status_code, body_text)
Transport = Callable[[str], "tuple[int, str]"]


class MarketDataError(Exception):
    """Raised for any market-data failure; message is safe to show the agent."""


def _urllib_transport(url: str) -> "tuple[int, str]":
    request = urllib.request.Request(url, headers={"User-Agent": "agentic-trading-mcp/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, OSError) as exc:
        raise MarketDataError(f"Network error reaching market-data API: {exc}") from exc


def normalize_symbol(symbol: str) -> str:
    """Accept 'btc', 'BTC', 'BTC-USD', 'BTC/USDT', 'BTCUSDT' -> 'BTCUSDT'."""
    s = symbol.strip().upper().replace("-", "").replace("/", "")
    for quote in ("USDT", "USD", "BUSD", "USDC"):
        if s.endswith(quote) and len(s) > len(quote):
            return s[: -len(quote)] + "USDT"
    return s + "USDT"


def base_asset(symbol: str) -> str:
    """'BTCUSDT' -> 'BTC' (for portfolio position keys)."""
    s = normalize_symbol(symbol)
    return s[:-4]


class MarketDataClient:
    # Cache TTLs in seconds, per endpoint class.
    PRICE_TTL = 5.0
    KLINES_TTL = 30.0
    OVERVIEW_TTL = 60.0

    def __init__(self, api_base: str, transport: Optional[Transport] = None):
        self.api_base = api_base.rstrip("/")
        self.transport = transport or _urllib_transport
        self._cache: dict = {}

    # -- internals ---------------------------------------------------------

    def _get(self, path: str, params: Optional[dict] = None, ttl: float = 0.0):
        query = ("?" + urllib.parse.urlencode(params)) if params else ""
        url = f"{self.api_base}/api/v3{path}{query}"
        now = time.monotonic()
        if ttl > 0:
            hit = self._cache.get(url)
            if hit and hit[0] > now:
                return hit[1]
        status, body = self.transport(url)
        if status == 429 or status == 418:
            raise MarketDataError("Market-data API rate limit hit; wait a few seconds and retry.")
        if status == 400:
            raise MarketDataError(
                "Unknown symbol or bad request. Use a base asset like BTC, ETH, SOL."
            )
        if status != 200:
            raise MarketDataError(f"Market-data API returned HTTP {status}.")
        try:
            data = json.loads(body)
        except json.JSONDecodeError as exc:
            raise MarketDataError("Market-data API returned invalid JSON.") from exc
        if ttl > 0:
            self._cache[url] = (now + ttl, data)
        return data

    # -- public API --------------------------------------------------------

    def get_price(self, symbol: str) -> float:
        pair = normalize_symbol(symbol)
        data = self._get("/ticker/price", {"symbol": pair}, ttl=self.PRICE_TTL)
        return float(data["price"])

    def get_ticker_24h(self, symbol: str) -> dict:
        pair = normalize_symbol(symbol)
        data = self._get("/ticker/24hr", {"symbol": pair}, ttl=self.PRICE_TTL)
        return {
            "symbol": pair,
            "price": float(data["lastPrice"]),
            "change_24h_pct": float(data["priceChangePercent"]),
            "high_24h": float(data["highPrice"]),
            "low_24h": float(data["lowPrice"]),
            "volume_24h_quote": float(data["quoteVolume"]),
        }

    def get_klines(self, symbol: str, interval: str = "1h", limit: int = 100) -> list:
        if interval not in VALID_INTERVALS:
            raise MarketDataError(f"Invalid interval '{interval}'. Use one of {VALID_INTERVALS}.")
        limit = max(1, min(int(limit), 500))
        pair = normalize_symbol(symbol)
        raw = self._get(
            "/klines", {"symbol": pair, "interval": interval, "limit": limit}, ttl=self.KLINES_TTL
        )
        return [
            {
                "open_time": row[0],
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]),
            }
            for row in raw
        ]

    def get_overview(self, top_n: int = 10, sort_by: str = "volume") -> list:
        top_n = max(1, min(int(top_n), 50))
        rows = self._get("/ticker/24hr", ttl=self.OVERVIEW_TTL)
        usdt = [
            r
            for r in rows
            if r.get("symbol", "").endswith("USDT") and float(r.get("quoteVolume", 0)) > 0
        ]
        if sort_by == "gainers":
            usdt.sort(key=lambda r: float(r["priceChangePercent"]), reverse=True)
        elif sort_by == "losers":
            usdt.sort(key=lambda r: float(r["priceChangePercent"]))
        else:
            usdt.sort(key=lambda r: float(r["quoteVolume"]), reverse=True)
        return [
            {
                "symbol": r["symbol"],
                "price": float(r["lastPrice"]),
                "change_24h_pct": float(r["priceChangePercent"]),
                "volume_24h_quote": float(r["quoteVolume"]),
            }
            for r in usdt[:top_n]
        ]
