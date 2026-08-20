import { readFileSync } from "node:fs";

export function readHookStdinSync() {
  try {
    const cached = process.env.OPENVIKING_HOOK_STDIN_CACHE;
    if (cached) return cached;
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function parseHookInput(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function normalizeHookInput(raw = {}) {
  const sessionId = String(
    raw.sessionId
      || raw.session_id
      || process.env.GROK_SESSION_ID
      || "",
  ).trim();
  const cwd = String(
    raw.cwd
      || raw.workspaceRoot
      || raw.workspace_root
      || process.env.GROK_WORKSPACE_ROOT
      || process.env.CLAUDE_PROJECT_DIR
      || "",
  ).trim();
  const prompt = firstString(
    raw.prompt,
    raw.text,
    raw.message,
    raw.userPrompt,
    raw.user_prompt,
  );
  return {
    sessionId,
    cwd,
    prompt,
    promptId: String(raw.promptId || raw.prompt_id || "").trim(),
    source: String(raw.source || raw.sessionStartSource || "startup").trim() || "startup",
    reason: String(raw.reason || "").trim(),
    lastAssistantMessage: firstString(
      raw.lastAssistantMessage,
      raw.last_assistant_message,
    ),
    hookEventName: String(raw.hookEventName || raw.hook_event_name || "").trim(),
    toolName: String(raw.toolName || raw.tool_name || raw.name || raw.tool || "").trim(),
    toolInput: raw.toolInput || raw.tool_input || raw.input || {},
    subagentType: String(raw.subagentType || raw.subagent_type || "").trim(),
    stopHookActive: Boolean(raw.stopHookActive || raw.stop_hook_active),
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}
