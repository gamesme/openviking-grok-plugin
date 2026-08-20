#!/bin/sh
# Resolve the proxy next to this script so MCP works even when
# ${GROK_PLUGIN_ROOT} is not expanded in .mcp.json.
# Identity is resolved by mcp-proxy.mjs via the same resolveActorPeer()
# used by hooks: explicit env/config, otherwise peer `grok`. Never cwd.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$DIR/mcp-proxy.mjs"
