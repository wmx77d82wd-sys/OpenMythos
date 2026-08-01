"""Tool definitions and handlers.

Each tool is a plain function taking (ctx, args) and returning a JSON-able
dict; the protocol layer serializes it. Handlers raise ToolError for
user-facing failures.
"""

import json

from . import indicators
from .config import HARD_CEILINGS, Settings
from .market_data import (
    VALID_INTERVALS,
    MarketDataClient,
    MarketDataError,
    base_asset,
    normalize_symbol,
)
from .portfolio import PortfolioStore
from .risk import check_order, clamp_limits


class ToolError(Exception):
    pass


class Context:
    def __init__(self, settings: Settings, market: MarketDataClient = None):
        self.settings = settings
        self.market = market or MarketDataClient(settings.api_base)
        self.store = PortfolioStore(settings.state_path, settings.starting_cash, settings.fee_rate)

    def prices_for_positions(self) -> dict:
        prices = {}
        for asset in self.store.state["positions"]:
            try:
                prices[asset] = self.market.get_price(asset)
            except MarketDataError:
                prices[asset] = None
        return {k: v for k, v in prices.items() if v is not None}

    def refresh_day(self) -> None:
        self.store.roll_day_if_needed(self.store.equity(self.prices_for_positions()))


# ---------------------------------------------------------------------------
# handlers


def get_price(ctx: Context, args: dict) -> dict:
    return ctx.market.get_ticker_24h(_require_str(args, "symbol"))


def get_ohlcv(ctx: Context, args: dict) -> dict:
    symbol = _require_str(args, "symbol")
    interval = args.get("interval", "1h")
    limit = args.get("limit", 100)
    candles = ctx.market.get_klines(symbol, interval, limit)
    return {"symbol": normalize_symbol(symbol), "interval": interval, "candles": candles}


def get_market_overview(ctx: Context, args: dict) -> dict:
    sort_by = args.get("sort_by", "volume")
    if sort_by not in ("volume", "gainers", "losers"):
        raise ToolError("sort_by must be one of: volume, gainers, losers")
    return {"sort_by": sort_by, "markets": ctx.market.get_overview(args.get("top_n", 10), sort_by)}


def analyze_market(ctx: Context, args: dict) -> dict:
    symbol = _require_str(args, "symbol")
    interval = args.get("interval", "1h")
    wanted = args.get("indicators", ["sma", "ema", "rsi"])
    periods = args.get("periods", [14, 50])
    candles = ctx.market.get_klines(symbol, interval, 500)
    closes = [c["close"] for c in candles]
    values = {}
    for name in wanted:
        if name not in ("sma", "ema", "rsi"):
            raise ToolError(f"Unknown indicator '{name}'. Available: sma, ema, rsi.")
        fn = getattr(indicators, name)
        values[name] = {str(p): fn(closes, int(p)) for p in periods}
    return {
        "symbol": normalize_symbol(symbol),
        "interval": interval,
        "candles_used": len(closes),
        "latest_close": closes[-1] if closes else None,
        "indicators": values,
        "note": "Raw indicator data only; this server does not give buy/sell advice.",
    }


def get_portfolio(ctx: Context, args: dict) -> dict:
    ctx.refresh_day()
    return ctx.store.snapshot(ctx.prices_for_positions())


def place_order(ctx: Context, args: dict) -> dict:
    symbol = _require_str(args, "symbol")
    side = _require_str(args, "side").lower()
    if side not in ("buy", "sell"):
        raise ToolError("side must be 'buy' or 'sell'")
    amount_usd = args.get("amount_usd")
    quantity = args.get("quantity")
    if (amount_usd is None) == (quantity is None):
        raise ToolError("Provide exactly one of amount_usd or quantity.")
    confirm = bool(args.get("confirm", False))
    reason = args.get("reason")

    asset = base_asset(symbol)
    price = ctx.market.get_price(symbol)
    if quantity is None:
        quantity = float(amount_usd) / price
    quantity = float(quantity)
    if quantity <= 0:
        raise ToolError("Order quantity must be positive.")

    ctx.refresh_day()
    equity = ctx.store.equity(ctx.prices_for_positions())
    report = check_order(ctx.store, side, asset, quantity, price, equity)
    notional = quantity * price
    fee = notional * ctx.store.fee_rate
    preview = {
        "symbol": asset,
        "side": side,
        "quantity": quantity,
        "estimated_price": price,
        "estimated_notional": notional,
        "estimated_fee": fee,
        "risk_report": report,
    }

    if not confirm:
        preview["executed"] = False
        preview["message"] = (
            "PREVIEW ONLY — no order was placed. Re-call with confirm=true to execute."
            if report["approved"]
            else "PREVIEW ONLY — order would be REJECTED by risk checks."
        )
        return preview

    if not report["approved"]:
        failed = [c["name"] for c in report["checks"] if not c["passed"]]
        preview["executed"] = False
        preview["message"] = f"Order rejected by risk checks: {', '.join(failed)}"
        return preview

    if side == "buy":
        trade = ctx.store.apply_buy(asset, quantity, price, reason)
    else:
        trade = ctx.store.apply_sell(asset, quantity, price, reason)
    return {"executed": True, "trade": trade, "risk_report": report}


def get_trade_history(ctx: Context, args: dict) -> dict:
    limit = max(1, min(int(args.get("limit", 20)), 100))
    offset = max(0, int(args.get("offset", 0)))
    symbol = args.get("symbol")
    trades = list(reversed(ctx.store.state["trades"]))
    if symbol:
        trades = [t for t in trades if t["symbol"] == base_asset(symbol)]
    return {"total": len(trades), "trades": trades[offset : offset + limit]}


def get_risk_limits(ctx: Context, args: dict) -> dict:
    ctx.refresh_day()
    daily = ctx.store.state["daily"]
    return {
        "limits": ctx.store.state["risk_limits"],
        "hard_ceilings": HARD_CEILINGS,
        "orders_today": daily["orders_today"],
        "circuit_breaker_tripped": daily["circuit_breaker_tripped"],
        "tripped_at": daily["tripped_at"],
    }


def set_risk_limits(ctx: Context, args: dict) -> dict:
    confirm = bool(args.get("confirm", False))
    current = ctx.store.state["risk_limits"]
    new_limits, notes = clamp_limits(args, current)
    if new_limits == current:
        return {"changed": False, "limits": current, "notes": notes or ["no changes requested"]}
    if not confirm:
        return {
            "changed": False,
            "message": "PREVIEW ONLY — re-call with confirm=true to apply.",
            "current_limits": current,
            "proposed_limits": new_limits,
            "notes": notes,
        }
    ctx.store.state["risk_limits"] = new_limits
    ctx.store.save()
    return {"changed": True, "limits": new_limits, "notes": notes}


def reset_portfolio(ctx: Context, args: dict) -> dict:
    if not bool(args.get("confirm", False)):
        return {
            "reset": False,
            "message": (
                "PREVIEW ONLY — this wipes all positions, trades, and limits back to "
                "defaults. Re-call with confirm=true to proceed."
            ),
        }
    starting_cash = args.get("starting_cash")
    ctx.store.reset(float(starting_cash) if starting_cash is not None else None)
    return {"reset": True, "cash": ctx.store.state["cash"]}


def _require_str(args: dict, key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ToolError(f"Missing required string argument '{key}'.")
    return value


# ---------------------------------------------------------------------------
# registry: name -> (handler, description, JSON Schema, read_only)

_SYMBOL = {"type": "string", "description": "Asset symbol, e.g. BTC, ETH, SOL (quote defaults to USDT)"}
_CONFIRM = {
    "type": "boolean",
    "default": False,
    "description": "False returns a preview only; true executes.",
}
_INTERVAL = {"type": "string", "enum": list(VALID_INTERVALS), "default": "1h"}

TOOLS = {
    "get_price": (
        get_price,
        "Get the current price and 24h stats for a crypto asset.",
        {"type": "object", "properties": {"symbol": _SYMBOL}, "required": ["symbol"]},
        True,
    ),
    "get_ohlcv": (
        get_ohlcv,
        "Get OHLCV candles for a crypto asset.",
        {
            "type": "object",
            "properties": {
                "symbol": _SYMBOL,
                "interval": _INTERVAL,
                "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 100},
            },
            "required": ["symbol"],
        },
        True,
    ),
    "get_market_overview": (
        get_market_overview,
        "List top USDT markets by volume, or top gainers/losers over 24h.",
        {
            "type": "object",
            "properties": {
                "top_n": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
                "sort_by": {
                    "type": "string",
                    "enum": ["volume", "gainers", "losers"],
                    "default": "volume",
                },
            },
        },
        True,
    ),
    "analyze_market": (
        analyze_market,
        "Compute technical indicators (SMA/EMA/RSI) server-side for an asset. "
        "Returns raw data only, never trading advice.",
        {
            "type": "object",
            "properties": {
                "symbol": _SYMBOL,
                "interval": _INTERVAL,
                "indicators": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["sma", "ema", "rsi"]},
                    "default": ["sma", "ema", "rsi"],
                },
                "periods": {
                    "type": "array",
                    "items": {"type": "integer", "minimum": 2, "maximum": 400},
                    "default": [14, 50],
                },
            },
            "required": ["symbol"],
        },
        True,
    ),
    "get_portfolio": (
        get_portfolio,
        "Get the paper-trading portfolio: cash, positions marked to live prices, "
        "equity, and P&L.",
        {"type": "object", "properties": {}},
        True,
    ),
    "place_order": (
        place_order,
        "Place a PAPER (simulated) market order. Without confirm=true this only "
        "returns a preview with a full risk report; nothing is executed. All "
        "orders pass through risk checks (size, concentration, daily loss "
        "circuit breaker, throttle). No real money is ever involved.",
        {
            "type": "object",
            "properties": {
                "symbol": _SYMBOL,
                "side": {"type": "string", "enum": ["buy", "sell"]},
                "amount_usd": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "description": "Order size in USD (provide this OR quantity, not both)",
                },
                "quantity": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "description": "Order size in asset units (provide this OR amount_usd)",
                },
                "confirm": _CONFIRM,
                "reason": {
                    "type": "string",
                    "description": "The agent's rationale for this trade; stored in history.",
                },
            },
            "required": ["symbol", "side"],
        },
        False,
    ),
    "get_trade_history": (
        get_trade_history,
        "List past paper trades, newest first.",
        {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                "offset": {"type": "integer", "minimum": 0, "default": 0},
                "symbol": {"type": "string", "description": "Optional filter by asset"},
            },
        },
        True,
    ),
    "get_risk_limits": (
        get_risk_limits,
        "Show current risk limits, hard ceilings, and circuit-breaker status.",
        {"type": "object", "properties": {}},
        True,
    ),
    "set_risk_limits": (
        set_risk_limits,
        "Adjust risk limits (clamped to server-side hard ceilings the agent can "
        "never exceed). Preview without confirm=true.",
        {
            "type": "object",
            "properties": {
                "max_trade_notional_usd": {"type": "number", "exclusiveMinimum": 0},
                "max_position_pct": {"type": "number", "exclusiveMinimum": 0, "maximum": 1},
                "daily_loss_limit_pct": {"type": "number", "exclusiveMinimum": 0, "maximum": 0.5},
                "max_orders_per_day": {"type": "integer", "minimum": 1, "maximum": 100},
                "confirm": _CONFIRM,
            },
        },
        False,
    ),
    "reset_portfolio": (
        reset_portfolio,
        "DESTRUCTIVE: wipe the paper portfolio back to starting cash and default "
        "limits. Also the only way to clear a tripped circuit breaker before the "
        "next UTC day. Requires confirm=true.",
        {
            "type": "object",
            "properties": {
                "confirm": _CONFIRM,
                "starting_cash": {"type": "number", "exclusiveMinimum": 0},
            },
        },
        False,
    ),
}


def list_tools() -> list:
    result = []
    for name, (_, description, schema, read_only) in TOOLS.items():
        result.append(
            {
                "name": name,
                "description": description,
                "inputSchema": schema,
                "annotations": {"readOnlyHint": read_only, "destructiveHint": name == "reset_portfolio"},
            }
        )
    return result


def call_tool(ctx: Context, name: str, args: dict) -> "tuple[str, bool]":
    """Return (text, is_error) for a tools/call request."""
    entry = TOOLS.get(name)
    if entry is None:
        return f"Unknown tool: {name}", True
    handler = entry[0]
    try:
        return json.dumps(handler(ctx, args or {}), indent=2), False
    except (ToolError, MarketDataError) as exc:
        return f"Error: {exc}", True
    except (KeyError, TypeError, ValueError) as exc:
        return f"Error: invalid arguments ({exc})", True
