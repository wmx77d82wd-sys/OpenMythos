import unittest

from trading_mcp.market_data import MarketDataClient, MarketDataError, base_asset, normalize_symbol

from .helpers import FakeTransport


class TestSymbolNormalization(unittest.TestCase):
    def test_variants(self):
        for raw in ("btc", "BTC", "BTC-USD", "BTC/USDT", "BTCUSDT", "btcusd"):
            self.assertEqual(normalize_symbol(raw), "BTCUSDT", raw)

    def test_base_asset(self):
        self.assertEqual(base_asset("BTC-USD"), "BTC")
        self.assertEqual(base_asset("sol"), "SOL")


class TestMarketDataClient(unittest.TestCase):
    def setUp(self):
        self.transport = FakeTransport()
        self.client = MarketDataClient("https://fake.test", transport=self.transport)

    def test_get_price(self):
        self.assertEqual(self.client.get_price("btc"), 60_000.0)

    def test_price_cache_avoids_second_request(self):
        self.client.get_price("btc")
        self.client.get_price("BTC")
        self.assertEqual(len(self.transport.calls), 1)

    def test_klines_parse(self):
        candles = self.client.get_klines("eth", "1h", 10)
        self.assertEqual(len(candles), 10)
        self.assertIn("close", candles[0])
        self.assertIsInstance(candles[0]["close"], float)

    def test_invalid_interval(self):
        with self.assertRaises(MarketDataError):
            self.client.get_klines("btc", "3h", 10)

    def test_unknown_symbol_friendly_error(self):
        with self.assertRaises(MarketDataError) as caught:
            self.client.get_price("NOTACOIN")
        self.assertIn("Unknown symbol", str(caught.exception))

    def test_rate_limit_friendly_error(self):
        self.transport.force_status = 429
        with self.assertRaises(MarketDataError) as caught:
            self.client.get_price("btc")
        self.assertIn("rate limit", str(caught.exception))

    def test_overview_sorting(self):
        markets = self.client.get_overview(top_n=3, sort_by="volume")
        volumes = [m["volume_24h_quote"] for m in markets]
        self.assertEqual(volumes, sorted(volumes, reverse=True))


if __name__ == "__main__":
    unittest.main()
