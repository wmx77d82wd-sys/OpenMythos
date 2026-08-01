import unittest

from trading_mcp.indicators import ema, rsi, sma


class TestSMA(unittest.TestCase):
    def test_basic(self):
        self.assertAlmostEqual(sma([1, 2, 3, 4, 5], 5), 3.0)
        self.assertAlmostEqual(sma([1, 2, 3, 4, 5], 2), 4.5)

    def test_insufficient_data(self):
        self.assertIsNone(sma([1, 2], 3))
        self.assertIsNone(sma([], 1))
        self.assertIsNone(sma([1, 2, 3], 0))


class TestEMA(unittest.TestCase):
    def test_matches_hand_computation(self):
        # seed = SMA(1,2,3) = 2; k = 0.5
        # step 4: 4*0.5 + 2*0.5 = 3; step 5: 5*0.5 + 3*0.5 = 4
        self.assertAlmostEqual(ema([1, 2, 3, 4, 5], 3), 4.0)

    def test_insufficient_data(self):
        self.assertIsNone(ema([1, 2], 3))


class TestRSI(unittest.TestCase):
    def test_all_gains_is_100(self):
        closes = list(range(1, 20))
        self.assertAlmostEqual(rsi(closes, 14), 100.0)

    def test_constant_series_no_division_error(self):
        self.assertAlmostEqual(rsi([5.0] * 20, 14), 100.0)

    def test_known_value(self):
        # Canonical Wilder example series (period 14).
        closes = [
            44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
            45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
        ]
        value = rsi(closes, 14)
        self.assertIsNotNone(value)
        self.assertAlmostEqual(value, 70.46, delta=0.1)

    def test_insufficient_data(self):
        self.assertIsNone(rsi([1, 2, 3], 14))


if __name__ == "__main__":
    unittest.main()
