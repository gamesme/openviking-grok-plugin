import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function withEnv(map, fn) {
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
    return await fn();
  } finally {
    for (const key of keys) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test("string undefined is not treated as GROK_PLUGIN_DATA", async () => {
  const root = mkdtempSync(join(tmpdir(), "ov-state-"));
  await withEnv({
    GROK_PLUGIN_DATA: "undefined",
    CLAUDE_PLUGIN_DATA: "null",
    GROK_HOME: join(root, "grok"),
    OPENVIKING_HOME: join(root, "ov"),
  }, async () => {
    const { resolveStateDir } = await import(`./state.mjs?undef=${Date.now()}`);
    assert.equal(resolveStateDir(), join(root, "grok", "plugin-data", "openviking-memory"));
  });
});

test("GROK_PLUGIN_DATA wins and legacy grok files migrate without dropping the originals", async () => {
  const root = mkdtempSync(join(tmpdir(), "ov-state-"));
  const ovHome = join(root, "ov");
  const grokHome = join(root, "grok");
  const pluginData = join(root, "plugin-data");
  const legacy = join(ovHome, "state");
  mkdirSync(legacy, { recursive: true });

  writeFileSync(join(legacy, "grok-last-prompt-abc.json"), JSON.stringify({
    sessionId: "abc",
    prompt: "keep me",
    ts: 1,
  }));
  writeFileSync(join(legacy, "last-inject.json"), JSON.stringify({
    grok_session_id: "abc",
    ov_session_id: "gk-abc",
    bytes: 12,
    ts: 2,
  }));
  writeFileSync(join(legacy, "last-capture.json"), JSON.stringify({
    cc_session_id: "claude-one",
    ov_session_id: "cc-claude-one",
    ts: 3,
  }));
  writeFileSync(join(legacy, "kimi-unrelated.json"), JSON.stringify({ hello: true }));

  await withEnv({
    OPENVIKING_HOME: ovHome,
    GROK_HOME: grokHome,
    GROK_PLUGIN_DATA: pluginData,
    CLAUDE_PLUGIN_DATA: undefined,
  }, async () => {
    const { migrateLegacyState, readJsonState, resolveStateDir, writeJsonState } = await import(
      `./state.mjs?t=${Date.now()}`
    );
    assert.equal(resolveStateDir(), pluginData);
    const result = migrateLegacyState(pluginData);
    assert.equal(result.copied >= 2, true, `expected grok files copied, got ${result.copied}`);
    assert.equal(JSON.parse(readFileSync(join(legacy, "grok-last-prompt-abc.json"), "utf8")).prompt, "keep me");
    const prompt = readJsonState("grok-last-prompt-abc.json");
    assert.equal(prompt.prompt, "keep me");
    const inject = readJsonState("last-inject.json");
    assert.equal(inject.grok_session_id, "abc");
    const capture = readJsonState("last-capture.json");
    assert.equal(capture, null);
    writeJsonState("last-capture.json", {
      grok_session_id: "new",
      ov_session_id: "gk-new",
    });
    const written = JSON.parse(readFileSync(join(pluginData, "last-capture.json"), "utf8"));
    assert.equal(written.ov_session_id, "gk-new");
    assert.equal(
      JSON.parse(readFileSync(join(legacy, "last-capture.json"), "utf8")).ov_session_id,
      "cc-claude-one",
    );
  });
});
