"""Shared test fixtures: a fake HTTP transport and context builder."""

import json
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from trading_mcp.config import Settings
from trading_mcp.market_data import MarketDataClient
from trading_mcp.server import Context

DEFAULT_PRICES = {"BTCUSDT": 60000.0, "ETHUSDT": 3000.0, "SOLUSDT": 150.0}


class FakeTransport:
    """Serves canned Binance-shaped responses and counts requests."""

    def __init__(self, prices=None, klines_closes=None):
        self.prices = dict(prices or DEFAULT_PRICES)
        self.klines_closes = klines_closes or [100.0 + i for i in range(120)]
        self.calls = []
        self.force_status = None

    def __call__(self, url):
        self.calls.append(url)
        if self.force_status is not None:
            return self.force_status, "{}"
        parsed = urlparse(url)
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        path = parsed.path

        if path.endswith("/ticker/price"):
            symbol = params["symbol"]
            if symbol not in self.prices:
                return 400, '{"code":-1121,"msg":"Invalid symbol."}'
            return 200, json.dumps({"symbol": symbol, "price": str(self.prices[symbol])})

        if path.endswith("/ticker/24hr"):
            if "symbol" in params:
                symbol = params["symbol"]
                if symbol not in self.prices:
                    return 400, '{"code":-1121,"msg":"Invalid symbol."}'
                return 200, json.dumps(self._ticker_row(symbol))
            return 200, json.dumps([self._ticker_row(s) for s in self.prices])

        if path.endswith("/klines"):
            symbol = params["symbol"]
            if symbol not in self.prices:
                return 400, '{"code":-1121,"msg":"Invalid symbol."}'
            limit = int(params.get("limit", 100))
            closes = self.klines_closes[-limit:]
            rows = []
            for i, close in enumerate(closes):
                rows.append(
                    [1700000000000 + i * 3600000, str(close - 1), str(close + 2),
                     str(close - 2), str(close), "1000.0", 0, "0", 0, "0", "0", "0"]
                )
            return 200, json.dumps(rows)

        return 404, "{}"

    def _ticker_row(self, symbol):
        price = self.prices[symbol]
        return {
            "symbol": symbol,
            "lastPrice": str(price),
            "priceChangePercent": "2.5",
            "highPrice": str(price * 1.05),
            "lowPrice": str(price * 0.95),
            "quoteVolume": str(price * 10000),
        }


def make_context(tmp_dir=None, transport=None, starting_cash=10_000.0):
    tmp_dir = tmp_dir or tempfile.mkdtemp()
    settings = Settings(
        state_path=str(Path(tmp_dir) / "state.json"),
        starting_cash=starting_cash,
        api_base="https://fake.test",
        fee_rate=0.001,
    )
    transport = transport or FakeTransport()
    market = MarketDataClient(settings.api_base, transport=transport)
    return Context(settings, market=market), transport
