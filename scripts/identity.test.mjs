import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.mjs";

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

test(".mcp.json does not hardcode identity env", () => {
  const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
  assert.equal(mcp.openviking.env, undefined);
  assert.equal(JSON.stringify(mcp).includes("OPENVIKING_PEER_ID"), false);
});

test("run-mcp.sh does not default PEER_ID to grok", () => {
  const sh = readFileSync(join(root, "servers/run-mcp.sh"), "utf8");
  assert.equal(/OPENVIKING_PEER_ID=.*grok/.test(sh), false);
  assert.equal(/OPENVIKING_WORKSPACE_PEER=/.test(sh), false);
});

test("loadConfig reads OPENVIKING_PEER_ID from env", () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-grok-"));
  const cli = join(dir, "ovcli.conf");
  const ov = join(dir, "ov.conf");
  writeFileSync(cli, JSON.stringify({ url: "http://127.0.0.1:1933" }));
  writeFileSync(ov, JSON.stringify({}));
  withEnv({
    OPENVIKING_PEER_ID: "alice",
    OPENVIKING_WORKSPACE_PEER: "0",
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
    plugin: { grok: { peerId: "from-ovcli", workspacePeer: false } },
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

test("loadConfig does not default peerId to grok", () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-grok-"));
  const cli = join(dir, "ovcli.conf");
  const ov = join(dir, "ov.conf");
  writeFileSync(cli, JSON.stringify({ url: "http://127.0.0.1:1933" }));
  writeFileSync(ov, JSON.stringify({}));
  withEnv({
    OPENVIKING_PEER_ID: undefined,
    OPENVIKING_WORKSPACE_PEER: undefined,
    OPENVIKING_CLI_CONFIG_FILE: cli,
    OPENVIKING_CONFIG_FILE: ov,
  }, () => {
    const cfg = loadConfig();
    assert.equal(cfg.peerId, "");
  });
});
