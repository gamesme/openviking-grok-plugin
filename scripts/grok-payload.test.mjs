import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHookEventName, normalizeHookInput, parseHookInput } from "./grok-payload.mjs";
import { classifyTurnEnd, formatTurnEndMarker, isSessionEndStop } from "./lib/turn-end.mjs";
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

test("normalizeHookEventName maps snake_case and aliases", () => {
  assert.equal(normalizeHookEventName("stop_cancelled"), "StopCancelled");
  assert.equal(normalizeHookEventName("StopFailure"), "StopFailure");
  assert.equal(normalizeHookEventName("subagent_end"), "SubagentStop");
  assert.equal(normalizeHookEventName("", "stop_failure"), "StopFailure");
});

test("normalizeHookInput reads StopCancelled / StopFailure fields", () => {
  const cancelled = normalizeHookInput({
    hookEventName: "stop_cancelled",
    sessionId: "s1",
    reason: "user_interrupt",
    cancelledBy: "user",
    cancelTrigger: "ctrl_c",
    lastAssistantMessage: "halfway",
    subagentType: "explore",
    agentId: "child-1",
  });
  assert.equal(cancelled.hookEventName, "StopCancelled");
  assert.equal(cancelled.reason, "user_interrupt");
  assert.equal(cancelled.cancelledBy, "user");
  assert.equal(cancelled.cancelTrigger, "ctrl_c");
  assert.equal(cancelled.agentId, "child-1");
  assert.equal(cancelled.subagentType, "explore");

  const failed = normalizeHookInput({
    hookEventName: "StopFailure",
    error: "rate_limit",
    errorDetails: "429 too many requests",
  });
  assert.equal(failed.hookEventName, "StopFailure");
  assert.equal(failed.error, "rate_limit");
  assert.equal(failed.errorDetails, "429 too many requests");
});

test("classifyTurnEnd distinguishes completed / cancelled / failed", () => {
  const done = classifyTurnEnd({ hookEventName: "Stop", reason: "end_turn" });
  assert.equal(done.outcome, "completed");
  assert.equal(isSessionEndStop({ hookEventName: "Stop", reason: "shutdown" }), true);
  assert.equal(isSessionEndStop({ hookEventName: "Stop", reason: "end_turn" }), false);

  const cancelled = classifyTurnEnd({
    hookEventName: "StopCancelled",
    reason: "user_interrupt",
    cancelledBy: "user",
    cancelTrigger: "esc",
  });
  assert.equal(cancelled.outcome, "cancelled");
  assert.match(formatTurnEndMarker(cancelled), /event=StopCancelled/);
  assert.match(formatTurnEndMarker(cancelled), /reason=user_interrupt/);

  const failed = classifyTurnEnd({ hookEventName: "StopFailure", error: "rate_limit" });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.reason, "rate_limit");
});

