"""Environment-driven settings and non-negotiable risk ceilings."""

import os
from dataclasses import dataclass, field
from pathlib import Path

# Server-side ceilings the agent can never raise via set_risk_limits.
HARD_CEILINGS = {
    "max_trade_notional_usd": 10_000.0,
    "max_position_pct": 1.0,
    "daily_loss_limit_pct": 0.50,
    "max_orders_per_day": 100,
}

DEFAULT_RISK_LIMITS = {
    "max_trade_notional_usd": 1_000.0,
    "max_position_pct": 0.25,
    "daily_loss_limit_pct": 0.05,
    "max_orders_per_day": 20,
}


def _default_state_path() -> str:
    return str(Path.home() / ".agentic-trading" / "state.json")


@dataclass
class Settings:
    state_path: str = field(default_factory=_default_state_path)
    starting_cash: float = 10_000.0
    api_base: str = "https://api.binance.com"
    fee_rate: float = 0.001

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            state_path=os.environ.get("TRADING_MCP_STATE_PATH", _default_state_path()),
            starting_cash=float(os.environ.get("TRADING_MCP_STARTING_CASH", "10000")),
            api_base=os.environ.get("TRADING_MCP_API_BASE", "https://api.binance.com"),
            fee_rate=float(os.environ.get("TRADING_MCP_FEE_RATE", "0.001")),
        )
