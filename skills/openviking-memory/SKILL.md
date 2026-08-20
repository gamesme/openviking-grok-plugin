---
name: openviking-memory
description: Use OpenViking long-term memory and viking:// resources. Trigger when the user mentions memory, recall, remember, preferences, prior sessions, OpenViking, ov, viking://, or asks what they said before.
---

Grok cannot inject OpenViking hook stdout on SessionStart or UserPromptSubmit. Do not wait for an auto-injected memory block.

Actor peer is always `grok` unless the operator explicitly sets `OPENVIKING_PEER_ID` / `ovcli.conf` `plugin.grok.peerId`. Never derive a peer from the working directory.

When the user asks about themselves, preferences, prior decisions, or anything stored in OpenViking:

1. Prefer OpenViking MCP tools: `find`, `search`, `read`, `remember`, `list`, `tree`.
2. If MCP is unavailable, run `ov find`, `ov read`, `ov tree` via the shell.
3. Optionally read `~/.openviking/last_inject.md` and `~/.openviking/last_recall.md` — hooks write those even when Grok discards hook stdout.

`viking://` paths are not local files. Never Read/Grep/Glob them on disk; use OpenViking MCP `read` / `grep` / `glob`.

To persist a new fact, call MCP `remember` or `ov add-memory`. Do not ask the user to re-explain something already in OpenViking.
