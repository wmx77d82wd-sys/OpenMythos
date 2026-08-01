"""Pure technical-indicator functions. Return None when there is not enough data."""

from typing import Optional, Sequence


def sma(closes: Sequence[float], period: int) -> Optional[float]:
    if period <= 0 or len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def ema(closes: Sequence[float], period: int) -> Optional[float]:
    if period <= 0 or len(closes) < period:
        return None
    k = 2.0 / (period + 1)
    value = sum(closes[:period]) / period
    for close in closes[period:]:
        value = close * k + value * (1 - k)
    return value


def rsi(closes: Sequence[float], period: int = 14) -> Optional[float]:
    """Wilder-smoothed RSI."""
    if period <= 0 or len(closes) < period + 1:
        return None
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        delta = closes[i] - closes[i - 1]
        if delta >= 0:
            gains += delta
        else:
            losses -= delta
    avg_gain = gains / period
    avg_loss = losses / period
    for i in range(period + 1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gain = delta if delta > 0 else 0.0
        loss = -delta if delta < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)
