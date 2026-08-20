# OpenViking memory plugin for Grok

Grok-side counterpart of the official Claude Code / Codex memory plugins, and sibling of [openviking-kimi-plugin](https://github.com/gamesme/openviking-kimi-plugin).

It reuses the same `ovcli.conf` credentials, stdio MCP proxy, recall, and session APIs. Session IDs are stored as `gk-<grokSessionId>`.

Peer identity is **not** hardcoded. Same chain as the [official Claude / Codex plugins](https://github.com/volcengine/OpenViking/tree/main/examples):

1. `OPENVIKING_*` environment variables (`OPENVIKING_PEER_ID`, `OPENVIKING_WORKSPACE_PEER`, …)
2. `~/.openviking/ovcli.conf` (`plugin.grok` overrides `plugin`)
3. `~/.openviking/ov.conf` (`grok_code` section)
4. Workspace-path derivation, unless `OPENVIKING_WORKSPACE_PEER=0`

On Grok, a typical host config is `[shell_environment_policy.set]` in `~/.grok/config.toml`.

## What works on Grok

- MCP tools via `servers/mcp-proxy.mjs` → OpenViking `/mcp`
- Stop / PreCompact / SessionEnd capture and commit
- `viking://` URI guard on Read/Grep/Glob
- `~/.openviking/last_inject.md` and `last_recall.md` written by hooks
- `/ov` status command

## What Grok cannot do yet

Grok ignores hook stdout on `SessionStart` and `UserPromptSubmit`, so profile/auto-recall cannot be stuffed into the prompt the way Claude and Codex do. The skill plus MCP `find`/`search` cover that gap.

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

Credentials come from `~/.openviking/ovcli.conf` (or `OPENVIKING_*` env vars). Debug: `OPENVIKING_DEBUG=1`.

## Verify

Run `/ov` to print server health, identity, last inject/recall/capture, and config source.

## Tests

```bash
npm test
```

Offline Node tests, no OpenViking server required.

## License

Apache-2.0 — same as [OpenViking](https://github.com/volcengine/OpenViking).
