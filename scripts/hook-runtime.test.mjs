import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function startMockOv() {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
      requests.push({
        method: req.method,
        url: req.url,
        body,
        peer: req.headers["x-openviking-actor-peer"] || body.peer_id || "",
      });
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/health") {
        res.end(JSON.stringify({ status: "ok", result: { healthy: true } }));
        return;
      }
      res.end(JSON.stringify({ status: "ok", result: { ok: true } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function runHook(script, payload, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, script)], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (d) => stdout.push(d));
    child.stderr.on("data", (d) => stderr.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function harnessEnv(mockUrl, pluginData, extra = {}) {
  const confDir = mkdtempSync(join(tmpdir(), "ov-conf-"));
  const cli = join(confDir, "ovcli.conf");
  const ov = join(confDir, "ov.conf");
  mkdirSync(join(confDir, "ovhome"), { recursive: true });
  mkdirSync(join(confDir, "grokhome"), { recursive: true });
  writeFileSync(cli, JSON.stringify({ url: mockUrl, api_key: "test" }));
  writeFileSync(ov, JSON.stringify({}));
  return {
    OPENVIKING_MEMORY_ENABLED: "1",
    OPENVIKING_URL: mockUrl,
    OPENVIKING_API_KEY: "test",
    OPENVIKING_PEER_ID: "",
    OPENVIKING_WORKSPACE_PEER: "1",
    OPENVIKING_WRITE_PATH_ASYNC: "0",
    OPENVIKING_AUTO_CAPTURE: "1",
    OPENVIKING_DEBUG: "0",
    OPENVIKING_CLI_CONFIG_FILE: cli,
    OPENVIKING_CONFIG_FILE: ov,
    OPENVIKING_HOME: join(confDir, "ovhome"),
    GROK_HOME: join(confDir, "grokhome"),
    GROK_PLUGIN_DATA: pluginData,
    ...extra,
  };
}

const SIGNAL = "Acceptance probe: rewrite grok hook adapter so interrupted turns persist into peers/grok.";

test("Stop capture posts peer grok from two different cwds", async () => {
  const mock = await startMockOv();
  try {
    for (const cwd of ["/tmp/project-a", "/Users/gamesme/other-repo"]) {
      const pluginData = mkdtempSync(join(tmpdir(), "ov-pdata-"));
      const result = await runHook("scripts/auto-capture.mjs", {
        hookEventName: "stop",
        sessionId: `sess-${cwd.replace(/[^a-z0-9]+/gi, "-")}`,
        promptId: `p-${cwd.length}`,
        cwd,
        reason: "end_turn",
        lastAssistantMessage: "Captured a completed Grok turn for the adapter rewrite.",
      }, harnessEnv(mock.url, pluginData));
      assert.equal(result.code, 0, result.stderr);
      const last = JSON.parse(readFileSync(join(pluginData, "last-capture.json"), "utf8"));
      assert.equal(last.peer_id, "grok");
      assert.equal(last.cwd, cwd);
      assert.equal(last.event, "Stop");
      assert.equal(last.outcome, "completed");
      assert.match(last.ov_session_id, /^gk-/);
    }
    const posted = mock.requests.filter((r) => r.url.includes("/messages"));
    assert.ok(posted.length >= 2);
    for (const req of posted) {
      assert.equal(req.body.peer_id, "grok");
    }
  } finally {
    await mock.close();
  }
});

test("StopCancelled records termination reason and still posts to OV", async () => {
  const mock = await startMockOv();
  const pluginData = mkdtempSync(join(tmpdir(), "ov-pdata-"));
  mkdirSync(pluginData, { recursive: true });
  const sessionId = "interrupt-sess";
  writeFileSync(join(pluginData, `grok-last-prompt-${sessionId}.json`), JSON.stringify({
    sessionId,
    promptId: "p-int",
    prompt: SIGNAL,
  }));
  try {
    const result = await runHook("scripts/auto-capture.mjs", {
      hookEventName: "stop_cancelled",
      sessionId,
      promptId: "p-int",
      cwd: "/tmp/interrupt",
      reason: "user_interrupt",
      cancelledBy: "user",
      cancelTrigger: "ctrl_c",
      lastAssistantMessage: "I was halfway through explaining the capture path.",
    }, harnessEnv(mock.url, pluginData));
    assert.equal(result.code, 0, result.stderr);
    const last = JSON.parse(readFileSync(join(pluginData, "last-capture.json"), "utf8"));
    assert.equal(last.event, "StopCancelled");
    assert.equal(last.outcome, "cancelled");
    assert.equal(last.reason, "user_interrupt");
    assert.equal(last.peer_id, "grok");
    const assistant = mock.requests.find((r) => r.url.includes("/messages") && r.body.role === "assistant");
    assert.ok(assistant, `messages=${JSON.stringify(mock.requests)}`);
    assert.match(assistant.body.content, /openviking-turn-end/);
    assert.match(assistant.body.content, /event=StopCancelled/);
    assert.match(assistant.body.content, /reason=user_interrupt/);
  } finally {
    await mock.close();
  }
});

test("StopFailure records error class", async () => {
  const mock = await startMockOv();
  const pluginData = mkdtempSync(join(tmpdir(), "ov-pdata-"));
  const sessionId = "fail-sess";
  writeFileSync(join(pluginData, `grok-last-prompt-${sessionId}.json`), JSON.stringify({
    sessionId,
    promptId: "p-fail",
    prompt: SIGNAL,
  }));
  try {
    const result = await runHook("scripts/auto-capture.mjs", {
      hookEventName: "stop_failure",
      sessionId,
      promptId: "p-fail",
      cwd: "/tmp/fail",
      error: "rate_limit",
      errorDetails: "429 capacity",
      lastAssistantMessage: "The model hit a rate limit mid-turn.",
    }, harnessEnv(mock.url, pluginData));
    assert.equal(result.code, 0, result.stderr);
    const last = JSON.parse(readFileSync(join(pluginData, "last-capture.json"), "utf8"));
    assert.equal(last.event, "StopFailure");
    assert.equal(last.outcome, "failed");
    assert.equal(last.reason, "rate_limit");
    const assistant = mock.requests.find((r) => r.url.includes("/messages") && r.body.role === "assistant");
    assert.ok(assistant);
    assert.match(assistant.body.content, /event=StopFailure/);
    assert.match(assistant.body.content, /reason=rate_limit/);
  } finally {
    await mock.close();
  }
});

test("session-end Stop is skipped", async () => {
  const mock = await startMockOv();
  const pluginData = mkdtempSync(join(tmpdir(), "ov-pdata-"));
  try {
    const result = await runHook("scripts/auto-capture.mjs", {
      hookEventName: "stop",
      sessionId: "ending",
      reason: "shutdown",
      lastAssistantMessage: SIGNAL,
    }, harnessEnv(mock.url, pluginData));
    assert.equal(result.code, 0, result.stderr);
    assert.equal(mock.requests.filter((r) => r.url.includes("/messages")).length, 0);
  } finally {
    await mock.close();
  }
});

test("SubagentStart + SubagentStop isolate the OV session", async () => {
  const mock = await startMockOv();
  const pluginData = mkdtempSync(join(tmpdir(), "ov-pdata-"));
  const historyDir = mkdtempSync(join(tmpdir(), "ov-hist-"));
  const transcript = join(historyDir, "chat.jsonl");
  writeFileSync(transcript, [
    JSON.stringify({ type: "user", content: [{ type: "text", text: `<user_query>${SIGNAL}</user_query>` }] }),
    JSON.stringify({ type: "assistant", content: [{ type: "text", text: "Subagent finished the isolated capture." }] }),
  ].join("\n"));
  try {
    const start = await runHook("scripts/subagent-start.mjs", {
      hookEventName: "subagent_start",
      sessionId: "parent-sess",
      agentId: "child-42",
      subagentType: "explore",
      cwd: "/tmp/parent",
    }, harnessEnv(mock.url, pluginData));
    assert.equal(start.code, 0, start.stderr);
    const stop = await runHook("scripts/subagent-stop.mjs", {
      hookEventName: "subagent_stop",
      sessionId: "parent-sess",
      agentId: "child-42",
      subagentType: "explore",
      cwd: "/tmp/parent",
      transcriptPath: transcript,
      lastAssistantMessage: "Subagent finished the isolated capture.",
    }, harnessEnv(mock.url, pluginData));
    assert.equal(stop.code, 0, stop.stderr);
    const last = JSON.parse(readFileSync(join(pluginData, "last-capture.json"), "utf8"));
    assert.equal(last.event, "SubagentStop");
    assert.match(last.ov_session_id, /__subagent-child-42$/);
    assert.equal(last.peer_id, "grok");
    const messages = mock.requests.filter((r) => r.url.includes("/messages"));
    assert.ok(messages.length >= 1);
    assert.ok(messages.every((m) => m.body.peer_id === "grok"));
  } finally {
    await mock.close();
  }
});

test("malformed stdin fail-opens with exit 0", async () => {
  const pluginData = mkdtempSync(join(tmpdir(), "ov-pdata-"));
  const result = await runHook("scripts/auto-capture.mjs", {}, {
    ...harnessEnv("http://127.0.0.1:1", pluginData),
  });
  // empty payload, no sessionId → skip, still 0
  assert.equal(result.code, 0, result.stderr);
});
