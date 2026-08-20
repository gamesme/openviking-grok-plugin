import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHookInput, parseHookInput } from "./grok-payload.mjs";
import { classifyTool, evaluatePreToolUse } from "./uri-guard.mjs";
import {
  extractUserQuery,
  latestUserPromptFromHistory,
  parseChatHistory,
} from "./grok-transcript.mjs";

test("normalizeHookInput reads Grok camelCase", () => {
  const n = normalizeHookInput({
    sessionId: "abc",
    workspaceRoot: "/tmp/proj",
    lastAssistantMessage: "done",
    promptId: "p1",
    reason: "end_turn",
  });
  assert.equal(n.sessionId, "abc");
  assert.equal(n.cwd, "/tmp/proj");
  assert.equal(n.lastAssistantMessage, "done");
  assert.equal(n.promptId, "p1");
  assert.equal(n.reason, "end_turn");
});

test("normalizeHookInput also accepts Claude snake_case", () => {
  const n = normalizeHookInput({ session_id: "x", cwd: "/src", prompt: "hi" });
  assert.equal(n.sessionId, "x");
  assert.equal(n.cwd, "/src");
  assert.equal(n.prompt, "hi");
});

test("extractUserQuery pulls inner text", () => {
  assert.equal(extractUserQuery("<user_query>\nhello world\n</user_query>"), "hello world");
});

test("latest user prompt skips system reminders", () => {
  const entries = parseChatHistory([
    JSON.stringify({ type: "user", content: [{ type: "text", text: "<system-reminder>nope</system-reminder>" }], synthetic_reason: "system_reminder" }),
    JSON.stringify({ type: "user", content: [{ type: "text", text: "<user_query>real question</user_query>" }] }),
  ].join("\n"));
  assert.equal(latestUserPromptFromHistory(entries), "real question");
});

test("uri-guard denies viking:// on read_file", () => {
  const out = evaluatePreToolUse({
    toolName: "read_file",
    toolInput: { target_file: "viking://user/memories/profile.md" },
  });
  assert.equal(out.decision, "deny");
  assert.match(out.reason, /viking:\/\//);
});

test("uri-guard ignores local paths", () => {
  const out = evaluatePreToolUse({
    toolName: "read_file",
    toolInput: { target_file: "/tmp/foo.md" },
  });
  assert.deepEqual(out, {});
});

test("classifyTool maps Grok names", () => {
  assert.equal(classifyTool("read_file"), "read");
  assert.equal(classifyTool("list_dir"), "glob");
  assert.equal(classifyTool("Grep"), "grep");
});

test("parseHookInput tolerates empty", () => {
  assert.deepEqual(parseHookInput(""), {});
  assert.deepEqual(parseHookInput("{"), {});
});
