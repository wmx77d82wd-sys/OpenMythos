"""End-to-end tool tests plus a run through the MCP stdio protocol layer."""

import io
import json
import unittest

from trading_mcp.protocol import handle_message, run_stdio
from trading_mcp.server import call_tool, list_tools

from .helpers import make_context


class TestToolFlow(unittest.TestCase):
    def setUp(self):
        self.ctx, self.transport = make_context()

    def call(self, name, args=None):
        text, is_error = call_tool(self.ctx, name, args or {})
        return json.loads(text) if not is_error else text, is_error

    def test_preview_does_not_execute(self):
        result, is_error = self.call(
            "place_order", {"symbol": "BTC", "side": "buy", "amount_usd": 500}
        )
        self.assertFalse(is_error)
        self.assertFalse(result["executed"])
        self.assertTrue(result["risk_report"]["approved"])
        portfolio, _ = self.call("get_portfolio")
        self.assertEqual(portfolio["positions"], [])
        self.assertEqual(portfolio["cash"], 10_000.0)

    def test_confirmed_buy_then_history(self):
        result, is_error = self.call(
            "place_order",
            {"symbol": "BTC", "side": "buy", "amount_usd": 600,
             "confirm": True, "reason": "test rationale"},
        )
        self.assertFalse(is_error)
        self.assertTrue(result["executed"])
        portfolio, _ = self.call("get_portfolio")
        self.assertEqual(portfolio["positions"][0]["asset"], "BTC")
        self.assertAlmostEqual(portfolio["cash"], 10_000.0 - 600.0 - 0.6)
        history, _ = self.call("get_trade_history")
        self.assertEqual(history["total"], 1)
        self.assertEqual(history["trades"][0]["reason"], "test rationale")

    def test_rejected_order_not_executed_even_with_confirm(self):
        result, is_error = self.call(
            "place_order",
            {"symbol": "BTC", "side": "buy", "amount_usd": 5_000, "confirm": True},
        )
        self.assertFalse(is_error)
        self.assertFalse(result["executed"])
        self.assertIn("rejected", result["message"])

    def test_both_amount_and_quantity_is_error(self):
        text, is_error = self.call(
            "place_order",
            {"symbol": "BTC", "side": "buy", "amount_usd": 100, "quantity": 0.1},
        )
        self.assertTrue(is_error)

    def test_set_risk_limits_preview_and_confirm(self):
        preview, _ = self.call("set_risk_limits", {"max_trade_notional_usd": 2_000})
        self.assertFalse(preview["changed"])
        applied, _ = self.call(
            "set_risk_limits", {"max_trade_notional_usd": 2_000, "confirm": True}
        )
        self.assertTrue(applied["changed"])
        limits, _ = self.call("get_risk_limits")
        self.assertEqual(limits["limits"]["max_trade_notional_usd"], 2_000)

    def test_analyze_market(self):
        result, is_error = self.call("analyze_market", {"symbol": "eth", "periods": [14]})
        self.assertFalse(is_error)
        self.assertIn("sma", result["indicators"])
        self.assertIsNotNone(result["indicators"]["rsi"]["14"])

    def test_reset_requires_confirm(self):
        self.call("place_order", {"symbol": "BTC", "side": "buy",
                                  "amount_usd": 100, "confirm": True})
        result, _ = self.call("reset_portfolio")
        self.assertFalse(result["reset"])
        result, _ = self.call("reset_portfolio", {"confirm": True})
        self.assertTrue(result["reset"])
        history, _ = self.call("get_trade_history")
        self.assertEqual(history["total"], 0)

    def test_unknown_tool(self):
        text, is_error = self.call("no_such_tool")
        self.assertTrue(is_error)


class TestProtocol(unittest.TestCase):
    def setUp(self):
        self.ctx, _ = make_context()

    def rpc(self, method, params=None, request_id=1):
        message = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            message["params"] = params
        return handle_message(self.ctx, message)

    def test_initialize(self):
        reply = self.rpc("initialize", {"protocolVersion": "2025-06-18"})
        self.assertEqual(reply["result"]["protocolVersion"], "2025-06-18")
        self.assertEqual(reply["result"]["serverInfo"]["name"], "agentic-trading")

    def test_tools_list_shape(self):
        reply = self.rpc("tools/list")
        tools = reply["result"]["tools"]
        self.assertEqual(len(tools), len(list_tools()))
        names = {t["name"] for t in tools}
        self.assertIn("place_order", names)
        for tool in tools:
            self.assertIn("inputSchema", tool)

    def test_tools_call_roundtrip(self):
        reply = self.rpc("tools/call", {"name": "get_price", "arguments": {"symbol": "btc"}})
        content = reply["result"]["content"][0]["text"]
        self.assertFalse(reply["result"]["isError"])
        self.assertEqual(json.loads(content)["price"], 60_000.0)

    def test_notification_gets_no_reply(self):
        reply = handle_message(
            self.ctx, {"jsonrpc": "2.0", "method": "notifications/initialized"}
        )
        self.assertIsNone(reply)

    def test_unknown_method(self):
        reply = self.rpc("resources/list")
        self.assertEqual(reply["error"]["code"], -32601)

    def test_stdio_loop(self):
        stdin = io.StringIO(
            json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                        "params": {"protocolVersion": "2025-06-18"}}) + "\n"
            + json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"
            + json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}) + "\n"
            + "not json\n"
        )
        stdout = io.StringIO()
        run_stdio(self.ctx, stdin=stdin, stdout=stdout)
        lines = [json.loads(l) for l in stdout.getvalue().strip().splitlines()]
        self.assertEqual(len(lines), 3)  # init reply, tools reply, parse error
        self.assertEqual(lines[0]["id"], 1)
        self.assertEqual(lines[1]["id"], 2)
        self.assertEqual(lines[2]["error"]["code"], -32700)


if __name__ == "__main__":
    unittest.main()
