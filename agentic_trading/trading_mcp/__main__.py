"""Entry point: `python -m trading_mcp` runs the MCP server on stdio."""

from .config import Settings
from .protocol import run_stdio
from .server import Context


def main() -> None:
    run_stdio(Context(Settings.from_env()))


if __name__ == "__main__":
    main()
