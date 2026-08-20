import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.mjs";
import { DEFAULT_GROK_PEER_ID, getEffectivePeerId, resolveActorPeer } from "./lib/identity.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function withEnv(map, fn) {
  const keys = Object.keys(map);
  const prev = {};
  for (const key of keys) {
    prev[key] = Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined;
    if (map[key] === undefined) delete process.env[key];
    else process.env[key] = map[key];
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test("hooks.json does not hardcode OPENVIKING_* env", () => {
  const hooks = JSON.parse(readFileSync(join(root, "hooks/hooks.json"), "utf8"));
  const dump = JSON.stringify(hooks);
  assert.equal(dump.includes("OPENVIKING_PEER_ID"), false);
  assert.equal(dump.includes("OPENVIKING_WORKSPACE_PEER"), false);
  assert.equal(dump.includes("\"env\""), false);
});

test("hooks.json covers Grok turn-end and subagent events", () => {
  const hooks = JSON.parse(readFileSync(join(root, "hooks/hooks.json"), "utf8")).hooks;
  for (const event of [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "Stop",
    "StopFailure",
    "StopCancelled",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "SessionEnd",
  ]) {
    assert.ok(hooks[event], `missing ${event}`);
  }
  assert.equal(hooks.PostToolUse, undefined);
});

test(".mcp.json does not hardcode identity env", () => {
  const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
  assert.equal(mcp.openviking.env, undefined);
  assert.equal(JSON.stringify(mcp).includes("OPENVIKING_PEER_ID"), false);
});

test("run-mcp.sh does not set a cwd-derived peer", () => {
  const sh = readFileSync(join(root, "servers/run-mcp.sh"), "utf8");
  assert.equal(/OPENVIKING_WORKSPACE_PEER=/.test(sh), false);
  assert.equal(/deriveWorkspacePeerId/.test(sh), false);
});

test("no Grok adapter imports shared/workspace-peer.mjs", () => {
  const files = [
    "scripts/auto-capture.mjs",
    "scripts/auto-recall.mjs",
    "scripts/session-start.mjs",
    "scripts/session-end.mjs",
    "scripts/pre-compact.mjs",
    "scripts/subagent-start.mjs",
    "scripts/subagent-stop.mjs",
    "scripts/ov-status.mjs",
    "servers/mcp-proxy.mjs",
    "scripts/lib/workspace-peer.mjs",
  ];
  for (const rel of files) {
    const src = readFileSync(join(root, rel), "utf8");
    assert.equal(
      src.includes("shared/workspace-peer.mjs"),
      false,
      `${rel} still imports cwd peer derivation`,
    );
  }
});

test("loadConfig reads OPENVIKING_PEER_ID from env", () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-grok-"));
  const cli = join(dir, "ovcli.conf");
  const ov = join(dir, "ov.conf");
  writeFileSync(cli, JSON.stringify({ url: "http://127.0.0.1:1933" }));
  writeFileSync(ov, JSON.stringify({}));
  withEnv({
    OPENVIKING_PEER_ID: "alice",
    OPENVIKING_WORKSPACE_PEER: "1",
    OPENVIKING_CLI_CONFIG_FILE: cli,
    OPENVIKING_CONFIG_FILE: ov,
  }, () => {
    const cfg = loadConfig();
    assert.equal(cfg.peerId, "alice");
    assert.equal(cfg.workspacePeer, false);
  });
});

test("loadConfig reads plugin.grok from ovcli.conf when env is unset", () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-grok-"));
  const cli = join(dir, "ovcli.conf");
  const ov = join(dir, "ov.conf");
  writeFileSync(cli, JSON.stringify({
    url: "http://127.0.0.1:1933",
    plugin: { grok: { peerId: "from-ovcli", workspacePeer: true } },
  }));
  writeFileSync(ov, JSON.stringify({}));
  withEnv({
    OPENVIKING_PEER_ID: undefined,
    OPENVIKING_WORKSPACE_PEER: undefined,
    OPENVIKING_CLI_CONFIG_FILE: cli,
    OPENVIKING_CONFIG_FILE: ov,
  }, () => {
    const cfg = loadConfig();
    assert.equal(cfg.peerId, "from-ovcli");
    assert.equal(cfg.workspacePeer, false);
  });
});

test("resolveActorPeer defaults to grok and ignores cwd", () => {
  assert.deepEqual(resolveActorPeer({}), { peerId: DEFAULT_GROK_PEER_ID, source: "default" });
  assert.deepEqual(resolveActorPeer({ peerId: "" }), { peerId: "grok", source: "default" });
  const a = getEffectivePeerId({ peerId: "" }, { cwd: "/Users/gamesme/foo" });
  const b = getEffectivePeerId({ peerId: "" }, { cwd: "/tmp/other-project" });
  assert.equal(a.peerId, "grok");
  assert.equal(b.peerId, "grok");
  assert.equal(a.peerId, b.peerId);
});

test("explicit peer still wins", () => {
  assert.deepEqual(resolveActorPeer({ peerId: "alice" }), { peerId: "alice", source: "explicit" });
});
