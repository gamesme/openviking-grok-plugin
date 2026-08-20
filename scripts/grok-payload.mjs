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

export function normalizeHookEventName(raw = "", envName = "") {
  const value = String(raw || envName || "").trim();
  if (!value) return "";
  const snake = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
  const map = {
    session_start: "SessionStart",
    user_prompt_submit: "UserPromptSubmit",
    pre_tool_use: "PreToolUse",
    post_tool_use: "PostToolUse",
    post_tool_use_failure: "PostToolUseFailure",
    permission_denied: "PermissionDenied",
    stop: "Stop",
    stop_failure: "StopFailure",
    stop_cancelled: "StopCancelled",
    notification: "Notification",
    subagent_start: "SubagentStart",
    subagent_stop: "SubagentStop",
    subagent_end: "SubagentStop",
    pre_compact: "PreCompact",
    post_compact: "PostCompact",
    session_end: "SessionEnd",
  };
  return map[snake] || value;
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
  const hookEventName = normalizeHookEventName(
    raw.hookEventName || raw.hook_event_name,
    process.env.GROK_HOOK_EVENT,
  );
  return {
    sessionId,
    cwd,
    prompt,
    promptId: String(raw.promptId || raw.prompt_id || "").trim(),
    source: String(raw.source || raw.sessionStartSource || "startup").trim() || "startup",
    reason: String(raw.reason || "").trim(),
    reasonDetails: firstString(raw.reasonDetails, raw.reason_details),
    lastAssistantMessage: firstString(
      raw.lastAssistantMessage,
      raw.last_assistant_message,
    ),
    hookEventName,
    toolName: String(raw.toolName || raw.tool_name || raw.name || raw.tool || "").trim(),
    toolInput: raw.toolInput || raw.tool_input || raw.input || {},
    subagentType: String(raw.subagentType || raw.subagent_type || raw.agentType || raw.agent_type || "").trim(),
    agentId: String(
      raw.agentId
        || raw.agent_id
        || raw.subagentId
        || raw.subagent_id
        || "",
    ).trim(),
    transcriptPath: String(
      raw.transcriptPath
        || raw.transcript_path
        || raw.agentTranscriptPath
        || raw.agent_transcript_path
        || "",
    ).trim(),
    error: String(raw.error || raw.errorType || raw.error_type || "").trim(),
    errorDetails: firstString(raw.errorDetails, raw.error_details),
    cancelledBy: String(raw.cancelledBy || raw.cancelled_by || "").trim(),
    cancelTrigger: String(raw.cancelTrigger || raw.cancel_trigger || "").trim(),
    stopHookActive: Boolean(raw.stopHookActive || raw.stop_hook_active),
    phase: String(raw.phase || "").trim(),
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}
