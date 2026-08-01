import tempfile
import unittest
from pathlib import Path

from trading_mcp.config import HARD_CEILINGS
from trading_mcp.portfolio import PortfolioStore
from trading_mcp.risk import check_order, clamp_limits


def failed_names(report):
    return [c["name"] for c in report["checks"] if not c["passed"]]


class TestRiskEngine(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.store = PortfolioStore(
            str(Path(self.tmp) / "state.json"), 10_000.0, fee_rate=0.001
        )

    def test_clean_buy_passes_all_checks(self):
        report = check_order(self.store, "buy", "BTC", 0.01, 60_000.0, 10_000.0)
        self.assertTrue(report["approved"])
        self.assertEqual(failed_names(report), [])

    def test_oversize_trade_rejected(self):
        report = check_order(self.store, "buy", "BTC", 0.05, 60_000.0, 10_000.0)
        self.assertFalse(report["approved"])
        self.assertIn("max_trade_size", failed_names(report))

    def test_insufficient_cash_rejected(self):
        self.store.state["cash"] = 100.0
        self.store.state["risk_limits"]["max_position_pct"] = 1.0
        report = check_order(self.store, "buy", "BTC", 0.01, 60_000.0, 10_000.0)
        self.assertIn("sufficient_cash", failed_names(report))

    def test_oversell_rejected_no_shorting(self):
        report = check_order(self.store, "sell", "BTC", 0.5, 60_000.0, 10_000.0)
        self.assertIn("sufficient_position", failed_names(report))

    def test_concentration_rejected(self):
        # 25% cap: a $999 buy on $3000 equity is ~33%
        report = check_order(self.store, "buy", "SOL", 6.66, 150.0, 3_000.0)
        self.assertIn("concentration", failed_names(report))

    def test_daily_loss_trips_breaker_and_persists(self):
        # equity down 6% vs 5% limit
        report = check_order(self.store, "buy", "BTC", 0.001, 60_000.0, 9_400.0)
        self.assertIn("daily_loss_limit", failed_names(report))
        self.assertTrue(self.store.state["daily"]["circuit_breaker_tripped"])
        reloaded = PortfolioStore(self.store.path, 10_000.0)
        self.assertTrue(reloaded.state["daily"]["circuit_breaker_tripped"])
        # subsequent order fails the breaker check too
        report2 = check_order(self.store, "buy", "BTC", 0.001, 60_000.0, 10_000.0)
        self.assertIn("circuit_breaker", failed_names(report2))

    def test_order_throttle(self):
        self.store.state["daily"]["orders_today"] = 20
        report = check_order(self.store, "buy", "BTC", 0.001, 60_000.0, 10_000.0)
        self.assertIn("order_throttle", failed_names(report))


class TestClampLimits(unittest.TestCase):
    def test_clamped_to_hard_ceiling(self):
        current = {"max_trade_notional_usd": 1_000.0, "max_position_pct": 0.25,
                   "daily_loss_limit_pct": 0.05, "max_orders_per_day": 20}
        new, notes = clamp_limits({"max_trade_notional_usd": 999_999.0}, current)
        self.assertEqual(
            new["max_trade_notional_usd"], HARD_CEILINGS["max_trade_notional_usd"]
        )
        self.assertTrue(any("clamped" in n for n in notes))

    def test_non_positive_ignored(self):
        current = {"max_trade_notional_usd": 1_000.0, "max_position_pct": 0.25,
                   "daily_loss_limit_pct": 0.05, "max_orders_per_day": 20}
        new, notes = clamp_limits({"max_position_pct": -1}, current)
        self.assertEqual(new["max_position_pct"], 0.25)
        self.assertTrue(any("ignored" in n for n in notes))


if __name__ == "__main__":
    unittest.main()
