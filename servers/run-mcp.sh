#!/bin/sh
# Resolve the proxy next to this script so MCP works even when
# ${GROK_PLUGIN_ROOT} is not expanded in .mcp.json.
# Identity (OPENVIKING_PEER_ID / OPENVIKING_WORKSPACE_PEER) comes from the
# host env, ovcli.conf, or ov.conf — same chain as the official Claude/Codex
# plugins. Do not default a peer here.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$DIR/mcp-proxy.mjs"
