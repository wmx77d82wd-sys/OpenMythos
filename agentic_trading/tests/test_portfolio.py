import json
import tempfile
import unittest
from pathlib import Path

from trading_mcp.portfolio import PortfolioStore


class TestPortfolioStore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = str(Path(self.tmp) / "state.json")
        self.store = PortfolioStore(self.path, 10_000.0, fee_rate=0.001)

    def test_fresh_state_defaults(self):
        state = self.store.state
        self.assertEqual(state["cash"], 10_000.0)
        self.assertEqual(state["positions"], {})
        self.assertEqual(state["daily"]["orders_today"], 0)
        self.assertFalse(state["daily"]["circuit_breaker_tripped"])

    def test_buy_updates_average_cost_across_two_buys(self):
        self.store.apply_buy("BTC", 0.01, 60_000.0)
        self.store.apply_buy("BTC", 0.01, 70_000.0)
        pos = self.store.state["positions"]["BTC"]
        self.assertAlmostEqual(pos["quantity"], 0.02)
        self.assertAlmostEqual(pos["avg_entry_price"], 65_000.0)
        self.assertAlmostEqual(pos["cost_basis"], 1_300.0)
        # cash: 10000 - 600 - 0.6 - 700 - 0.7
        self.assertAlmostEqual(self.store.state["cash"], 8_698.7)

    def test_sell_realizes_pnl_and_clears_position(self):
        self.store.apply_buy("BTC", 0.01, 60_000.0)
        trade = self.store.apply_sell("BTC", 0.01, 66_000.0)
        # realized = 660 - 600 - fee(0.66)
        self.assertAlmostEqual(trade["realized_pnl"], 59.34)
        self.assertNotIn("BTC", self.store.state["positions"])
        self.assertAlmostEqual(
            self.store.state["daily"]["realized_pnl_today"], 59.34
        )

    def test_save_is_atomic_and_reloadable(self):
        self.store.apply_buy("ETH", 1.0, 3_000.0)
        with open(self.path, "r", encoding="utf-8") as fh:
            on_disk = json.load(fh)
        self.assertIn("ETH", on_disk["positions"])
        self.assertFalse(Path(self.path + ".tmp").exists())
        reloaded = PortfolioStore(self.path, 10_000.0)
        self.assertAlmostEqual(reloaded.state["cash"], self.store.state["cash"])

    def test_equity_marks_to_prices(self):
        self.store.apply_buy("BTC", 0.01, 60_000.0)
        equity = self.store.equity({"BTC": 70_000.0})
        # cash 10000-600-0.6 + 0.01*70000
        self.assertAlmostEqual(equity, 9_399.4 + 700.0)

    def test_day_rollover_resets_counters_and_breaker(self):
        self.store.apply_buy("BTC", 0.01, 60_000.0)
        self.store.state["daily"]["date"] = "2000-01-01"
        self.store.state["daily"]["circuit_breaker_tripped"] = True
        self.store.roll_day_if_needed(9_500.0)
        daily = self.store.state["daily"]
        self.assertEqual(daily["orders_today"], 0)
        self.assertFalse(daily["circuit_breaker_tripped"])
        self.assertAlmostEqual(daily["equity_at_day_start"], 9_500.0)

    def test_reset(self):
        self.store.apply_buy("BTC", 0.01, 60_000.0)
        self.store.reset(starting_cash=5_000.0)
        self.assertEqual(self.store.state["cash"], 5_000.0)
        self.assertEqual(self.store.state["positions"], {})
        self.assertEqual(self.store.state["trades"], [])


if __name__ == "__main__":
    unittest.main()
