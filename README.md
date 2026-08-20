# OpenViking memory plugin for Grok

Grok-side counterpart of the official Claude Code / Codex memory plugins, and sibling of [openviking-kimi-plugin](https://github.com/gamesme/openviking-kimi-plugin).

It reuses the same `ovcli.conf` credentials, stdio MCP proxy, recall, and session APIs. Session IDs are stored as `gk-<grokSessionId>`.

Peer identity is **fixed to `grok`** unless you explicitly override it:

1. `OPENVIKING_PEER_ID`
2. `~/.openviking/ovcli.conf` (`plugin.grok.peerId`)
3. `~/.openviking/ov.conf` (`grok_code.peerId`)
4. Default: `grok`

Working-directory derivation is not used. Hooks and the MCP proxy share `resolveActorPeer()`.

Hook state lives in `GROK_PLUGIN_DATA` (fallback `~/.grok/plugin-data/openviking-memory`). Grok files previously written to `~/.openviking/state/` are copied once and still readable.

## What works on Grok

- MCP tools via `servers/mcp-proxy.mjs` → OpenViking `/mcp`
- Turn capture on `Stop`, `StopFailure`, and `StopCancelled` (interrupt / API error / completion)
- Subagent capture on `SubagentStart` / `SubagentStop`
- PreCompact / SessionEnd commit
- `viking://` URI guard on Read/Grep/Glob
- `~/.openviking/last_inject.md` and `last_recall.md` written by hooks
- `/ov` status command

## What Grok cannot do yet

Grok ignores hook stdout on `SessionStart`, `UserPromptSubmit`, and `PostToolUse`, so profile/auto-recall cannot be stuffed into the prompt the way Claude and Codex do, and a Claude-style skill-experience `PostToolUse` hook would be dead code here. The skill plus MCP `find`/`search` cover that gap.

## Install

From GitHub:

```bash
grok plugin install gamesme/openviking-grok-plugin --trust
```

Or from a local checkout:

```bash
git clone https://github.com/gamesme/openviking-grok-plugin.git
grok plugin install --trust ./openviking-grok-plugin
```

Then enable it (`[plugins] enabled = ["openviking-memory"]` or Space in `/plugins`) and start a new Grok session.

Credentials come from `~/.openviking/ovcli.conf` (or `OPENVIKING_URL` / `OPENVIKING_API_KEY`). Debug: `OPENVIKING_DEBUG=1`.

## Verify

Run `/ov` to print server health, identity, last inject/recall/capture, and config source.

## Tests

```bash
npm test
```

Offline Node tests, no OpenViking server required.

## License

Apache-2.0 — same as [OpenViking](https://github.com/volcengine/OpenViking).
