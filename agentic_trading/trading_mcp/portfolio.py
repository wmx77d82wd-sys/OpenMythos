"""Paper-trading portfolio persisted to a single JSON state file.

State is written atomically (tmp file + os.replace). All money math is float —
acceptable for simulation; display values are rounded at the tool layer.
"""

import datetime
import json
import os
from pathlib import Path

from .config import DEFAULT_RISK_LIMITS

SCHEMA_VERSION = 1


def _utc_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _utc_date() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


class PortfolioStore:
    def __init__(self, path: str, starting_cash: float, fee_rate: float = 0.001):
        self.path = Path(path)
        self.starting_cash = starting_cash
        self.fee_rate = fee_rate
        self.state = self._load()

    # -- persistence -------------------------------------------------------

    def _default_state(self, starting_cash=None) -> dict:
        cash = self.starting_cash if starting_cash is None else starting_cash
        return {
            "schema_version": SCHEMA_VERSION,
            "created_at": _utc_now(),
            "base_currency": "USD",
            "starting_cash": cash,
            "cash": cash,
            "positions": {},
            "trades": [],
            "risk_limits": dict(DEFAULT_RISK_LIMITS),
            "daily": {
                "date": _utc_date(),
                "equity_at_day_start": cash,
                "realized_pnl_today": 0.0,
                "orders_today": 0,
                "circuit_breaker_tripped": False,
                "tripped_at": None,
            },
        }

    def _load(self) -> dict:
        if self.path.exists():
            with open(self.path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        return self._default_state()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self.state, fh, indent=2)
        os.replace(tmp, self.path)

    def reset(self, starting_cash=None) -> None:
        self.state = self._default_state(starting_cash)
        self.save()

    # -- daily rollover ----------------------------------------------------

    def roll_day_if_needed(self, current_equity: float) -> None:
        """On the first touch of a new UTC day, reset daily counters.

        A tripped circuit breaker clears at rollover — losses are measured
        per-day, so a new day starts with a clean slate.
        """
        today = _utc_date()
        if self.state["daily"]["date"] != today:
            self.state["daily"] = {
                "date": today,
                "equity_at_day_start": current_equity,
                "realized_pnl_today": 0.0,
                "orders_today": 0,
                "circuit_breaker_tripped": False,
                "tripped_at": None,
            }
            self.save()

    # -- valuation ---------------------------------------------------------

    def equity(self, prices: dict) -> float:
        """Cash plus positions marked to the given {base_asset: price} map."""
        total = self.state["cash"]
        for asset, pos in self.state["positions"].items():
            price = prices.get(asset)
            if price is not None:
                total += pos["quantity"] * price
            else:
                total += pos["cost_basis"]
        return total

    def snapshot(self, prices: dict) -> dict:
        positions = []
        for asset, pos in sorted(self.state["positions"].items()):
            price = prices.get(asset)
            market_value = pos["quantity"] * price if price is not None else None
            unrealized = (
                market_value - pos["cost_basis"] if market_value is not None else None
            )
            positions.append(
                {
                    "asset": asset,
                    "quantity": pos["quantity"],
                    "avg_entry_price": pos["avg_entry_price"],
                    "cost_basis": pos["cost_basis"],
                    "current_price": price,
                    "market_value": market_value,
                    "unrealized_pnl": unrealized,
                }
            )
        equity = self.equity(prices)
        daily = self.state["daily"]
        return {
            "base_currency": self.state["base_currency"],
            "cash": self.state["cash"],
            "positions": positions,
            "equity": equity,
            "total_pnl": equity - self.state["starting_cash"],
            "daily_pnl": equity - daily["equity_at_day_start"],
            "circuit_breaker_tripped": daily["circuit_breaker_tripped"],
        }

    # -- trade application (validation happens in the risk engine) ----------

    def apply_buy(self, asset: str, quantity: float, price: float, reason=None) -> dict:
        notional = quantity * price
        fee = notional * self.fee_rate
        self.state["cash"] -= notional + fee
        pos = self.state["positions"].get(asset)
        if pos is None:
            self.state["positions"][asset] = {
                "quantity": quantity,
                "avg_entry_price": price,
                "cost_basis": notional,
                "opened_at": _utc_now(),
                "updated_at": _utc_now(),
            }
        else:
            new_qty = pos["quantity"] + quantity
            pos["cost_basis"] += notional
            pos["avg_entry_price"] = pos["cost_basis"] / new_qty
            pos["quantity"] = new_qty
            pos["updated_at"] = _utc_now()
        return self._record_trade("buy", asset, quantity, price, notional, fee, None, reason)

    def apply_sell(self, asset: str, quantity: float, price: float, reason=None) -> dict:
        pos = self.state["positions"][asset]
        notional = quantity * price
        fee = notional * self.fee_rate
        cost_removed = pos["avg_entry_price"] * quantity
        realized = notional - cost_removed - fee
        self.state["cash"] += notional - fee
        pos["quantity"] -= quantity
        pos["cost_basis"] -= cost_removed
        pos["updated_at"] = _utc_now()
        if pos["quantity"] <= 1e-12:
            del self.state["positions"][asset]
        self.state["daily"]["realized_pnl_today"] += realized
        return self._record_trade("sell", asset, quantity, price, notional, fee, realized, reason)

    def _record_trade(self, side, asset, quantity, price, notional, fee, realized, reason) -> dict:
        trade = {
            "id": f"t-{len(self.state['trades']) + 1:06d}",
            "timestamp": _utc_now(),
            "symbol": asset,
            "side": side,
            "quantity": quantity,
            "price": price,
            "notional": notional,
            "fee": fee,
            "realized_pnl": realized,
            "reason": reason,
            "cash_after": self.state["cash"],
        }
        self.state["trades"].append(trade)
        self.state["daily"]["orders_today"] += 1
        self.save()
        return trade
