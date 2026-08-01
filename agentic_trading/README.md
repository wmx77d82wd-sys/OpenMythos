# Agentic Trading MCP Server

Connect an AI agent (Claude Code, Claude Desktop, or any MCP client) to a
crypto **paper-trading** server so it can analyze the markets and trade —
with simulated money only.

Inspired by the "agentic trading" features appearing in trading apps
("Connect an AI agent to our MCP so it can analyze the markets and trade —
designed for safety"), this is a self-contained, open implementation of the
server side of that idea.

## Designed for safety

- **Paper trading only.** There are no exchange keys, no real orders, and no
  code path that touches real funds. The portfolio is a local JSON file.
- **Two-phase orders.** `place_order` defaults to a preview: it returns the
  estimated fill and a full risk report without executing. Only
  `confirm=true` executes, and only if every risk check passes.
- **Risk engine on every order:** per-trade size cap, position-concentration
  cap, daily-loss circuit breaker (halts all trading until the next UTC day),
  order-per-day throttle, and structural bans on shorting and leverage.
- **Hard ceilings.** The agent may adjust its own limits via
  `set_risk_limits`, but only below server-side ceilings it can never raise.
- **No advice.** `analyze_market` returns raw indicator data and explicitly
  never emits buy/sell recommendations.

## Requirements

Python ≥ 3.10. **Zero third-party dependencies** — market data uses the
standard library's HTTP client and the MCP stdio protocol is implemented
directly (newline-delimited JSON-RPC 2.0).

## Quick start

```bash
# from the repository root — no install needed:
cd agentic_trading
python -m trading_mcp        # runs the MCP server on stdio

# or install it:
pip install -e agentic_trading/
agentic-trading
```

### Connect Claude Code

```bash
# after `pip install -e agentic_trading/` the console script works anywhere:
claude mcp add agentic-trading -- agentic-trading

# or without installing, point PYTHONPATH at the project directory:
claude mcp add agentic-trading -e PYTHONPATH=/path/to/OpenMythos/agentic_trading -- python -m trading_mcp
```

### Connect Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentic-trading": {
      "command": "python",
      "args": ["-m", "trading_mcp"],
      "cwd": "/path/to/OpenMythos/agentic_trading"
    }
  }
}
```

## Tools

| Tool | Purpose |
|---|---|
| `get_price` | Current price + 24h stats for an asset |
| `get_ohlcv` | OHLCV candles (`1m`–`1w`, up to 500) |
| `get_market_overview` | Top USDT markets by volume / gainers / losers |
| `analyze_market` | Server-side SMA / EMA / RSI over recent candles |
| `get_portfolio` | Cash, positions marked to live prices, equity, P&L |
| `place_order` | Paper market order — preview by default, `confirm=true` to execute |
| `get_trade_history` | Past trades, including the agent's stated `reason` |
| `get_risk_limits` | Current limits, hard ceilings, circuit-breaker status |
| `set_risk_limits` | Adjust limits (clamped to hard ceilings, confirm-gated) |
| `reset_portfolio` | Destructive: wipe back to starting cash (confirm-gated) |

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `TRADING_MCP_STATE_PATH` | `~/.agentic-trading/state.json` | Portfolio state file |
| `TRADING_MCP_STARTING_CASH` | `10000` | Starting simulated cash (USD) |
| `TRADING_MCP_API_BASE` | `https://api.binance.com` | Market-data base URL (e.g. `https://api.binance.us` where binance.com is unavailable) |
| `TRADING_MCP_FEE_RATE` | `0.001` | Simulated taker fee (0.1%) |

Default risk limits (all adjustable via `set_risk_limits`, up to the hard
ceiling in parentheses): max trade $1,000 ($10,000) · max position 25% of
equity (100%) · daily loss limit 5% (50%) · 20 orders/day (100).

## Market data

Live public Binance REST endpoints (`/api/v3/ticker/*`, `/api/v3/klines`) —
no API key required. Responses are cached briefly (price 5s, candles 30s,
overview 60s) and rate-limit responses surface as friendly, retryable
errors.

## Running the tests

```bash
cd agentic_trading
python -m unittest discover -s tests -t .
```

The suite (47 tests) covers indicators, portfolio math and persistence,
every risk rule, market-data parsing/caching/errors (via an injected fake
transport — no network), the full tool flows, and the MCP protocol layer
including a scripted stdio session.

## Example agent prompts

> "What are the top 5 gainers today? Pull the 4h RSI for the top one."

> "Preview a $500 buy of ETH and show me the risk report. If everything
> passes, confirm it and note your reasoning."

> "Show my portfolio and daily P&L. If any position is above 20% of equity,
> trim it back."

## Disclaimer

This is a simulation for experimenting with agentic trading workflows.
It is not investment advice, and it deliberately provides no mechanism for
trading real funds.
