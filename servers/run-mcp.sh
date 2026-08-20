#!/bin/sh
# Resolve the proxy next to this script so MCP works even when
# ${GROK_PLUGIN_ROOT} is not expanded in .mcp.json.
# Do not derive a peer from cwd — that mints a new actor per workspace.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export OPENVIKING_WORKSPACE_PEER="${OPENVIKING_WORKSPACE_PEER:-0}"
export OPENVIKING_PEER_ID="${OPENVIKING_PEER_ID:-grok}"
exec node "$DIR/mcp-proxy.mjs"
