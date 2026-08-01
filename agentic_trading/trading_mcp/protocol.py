"""Minimal MCP server over stdio: newline-delimited JSON-RPC 2.0.

Implements the subset of the Model Context Protocol needed for tool use:
initialize, notifications/initialized, ping, tools/list, tools/call.
Zero third-party dependencies, so the server runs on any Python >= 3.10.
"""

import json
import sys

from . import __version__
from .server import Context, call_tool, list_tools

SUPPORTED_PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INTERNAL_ERROR = -32603


def _response(request_id, result=None, error=None) -> dict:
    message = {"jsonrpc": "2.0", "id": request_id}
    if error is not None:
        message["error"] = error
    else:
        message["result"] = result
    return message


def handle_message(ctx: Context, message: dict):
    """Handle one JSON-RPC message; return a response dict or None (notification)."""
    request_id = message.get("id")
    method = message.get("method")

    if method is None or message.get("jsonrpc") != "2.0":
        if request_id is None:
            return None
        return _response(request_id, error={"code": INVALID_REQUEST, "message": "Invalid request"})

    is_notification = request_id is None and method.startswith("notifications/")
    if is_notification:
        return None

    try:
        if method == "initialize":
            client_version = message.get("params", {}).get("protocolVersion")
            version = (
                client_version
                if client_version in SUPPORTED_PROTOCOL_VERSIONS
                else SUPPORTED_PROTOCOL_VERSIONS[0]
            )
            return _response(
                request_id,
                {
                    "protocolVersion": version,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "agentic-trading", "version": __version__},
                    "instructions": (
                        "Paper-trading crypto server. All orders are simulated; no real "
                        "funds exist. place_order requires confirm=true to execute and "
                        "is guarded by risk limits and a daily-loss circuit breaker."
                    ),
                },
            )
        if method == "ping":
            return _response(request_id, {})
        if method == "tools/list":
            return _response(request_id, {"tools": list_tools()})
        if method == "tools/call":
            params = message.get("params", {})
            text, is_error = call_tool(ctx, params.get("name", ""), params.get("arguments", {}))
            return _response(
                request_id,
                {"content": [{"type": "text", "text": text}], "isError": is_error},
            )
        return _response(
            request_id, error={"code": METHOD_NOT_FOUND, "message": f"Method not found: {method}"}
        )
    except Exception as exc:  # never let one request kill the server
        return _response(request_id, error={"code": INTERNAL_ERROR, "message": str(exc)})


def run_stdio(ctx: Context, stdin=None, stdout=None) -> None:
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            reply = _response(None, error={"code": PARSE_ERROR, "message": "Parse error"})
        else:
            reply = handle_message(ctx, message)
        if reply is not None:
            stdout.write(json.dumps(reply) + "\n")
            stdout.flush()
