"""Risk engine: every order is checked against configurable limits and
structural rules (no shorting, no leverage). Each check is reported
individually so order previews show the agent exactly where it stands.
"""

from .config import HARD_CEILINGS
from .portfolio import PortfolioStore, _utc_now


def check_order(
    store: PortfolioStore,
    side: str,
    asset: str,
    quantity: float,
    price: float,
    current_equity: float,
) -> dict:
    """Return {"approved": bool, "checks": [{name, passed, detail}, ...]}.

    Mutates nothing except tripping the circuit breaker when the daily-loss
    check itself fails (the trip must persist even though the order is
    rejected).
    """
    state = store.state
    limits = state["risk_limits"]
    daily = state["daily"]
    notional = quantity * price
    fee = notional * store.fee_rate
    checks = []

    def add(name: str, passed: bool, detail: str):
        checks.append({"name": name, "passed": passed, "detail": detail})

    # 1. Circuit breaker
    add(
        "circuit_breaker",
        not daily["circuit_breaker_tripped"],
        "trading halted until next UTC day (or reset_portfolio)"
        if daily["circuit_breaker_tripped"]
        else "not tripped",
    )

    # 2. Per-trade max size
    cap = limits["max_trade_notional_usd"]
    add(
        "max_trade_size",
        notional <= cap,
        f"order notional ${notional:,.2f} vs limit ${cap:,.2f}",
    )

    # 3. Funds / inventory (structural: no shorting, no leverage)
    if side == "buy":
        needed = notional + fee
        add(
            "sufficient_cash",
            state["cash"] >= needed,
            f"need ${needed:,.2f} (incl. fee) vs cash ${state['cash']:,.2f}",
        )
    else:
        held = state["positions"].get(asset, {}).get("quantity", 0.0)
        add(
            "sufficient_position",
            held >= quantity,
            f"selling {quantity} {asset} vs held {held} (no shorting)",
        )

    # 4. Concentration (buys only)
    if side == "buy":
        pos_value = state["positions"].get(asset, {}).get("quantity", 0.0) * price
        post_equity = current_equity - fee
        post_value = pos_value + notional
        pct = post_value / post_equity if post_equity > 0 else 1.0
        add(
            "concentration",
            pct <= limits["max_position_pct"],
            f"post-trade {asset} would be {pct:.1%} of equity vs limit "
            f"{limits['max_position_pct']:.0%}",
        )

    # 5. Daily loss limit — trips the breaker as a side effect
    day_start = daily["equity_at_day_start"]
    day_return = (current_equity - day_start) / day_start if day_start > 0 else 0.0
    loss_ok = day_return > -limits["daily_loss_limit_pct"]
    add(
        "daily_loss_limit",
        loss_ok,
        f"day P&L {day_return:+.2%} vs limit -{limits['daily_loss_limit_pct']:.0%}",
    )
    if not loss_ok and not daily["circuit_breaker_tripped"]:
        daily["circuit_breaker_tripped"] = True
        daily["tripped_at"] = _utc_now()
        store.save()

    # 6. Order throttle
    add(
        "order_throttle",
        daily["orders_today"] < limits["max_orders_per_day"],
        f"{daily['orders_today']} orders today vs limit {limits['max_orders_per_day']}",
    )

    return {"approved": all(c["passed"] for c in checks), "checks": checks}


def clamp_limits(requested: dict, current: dict) -> "tuple[dict, list]":
    """Merge requested limit changes into current, clamped to HARD_CEILINGS.

    Returns (new_limits, notes) where notes lists any clamping applied.
    """
    new_limits = dict(current)
    notes = []
    for key, ceiling in HARD_CEILINGS.items():
        if key not in requested or requested[key] is None:
            continue
        value = float(requested[key])
        if value <= 0:
            notes.append(f"{key}: must be positive, ignored")
            continue
        if value > ceiling:
            notes.append(f"{key}: requested {value} clamped to hard ceiling {ceiling}")
            value = ceiling
        if key == "max_orders_per_day":
            value = int(value)
        new_limits[key] = value
    return new_limits, notes
