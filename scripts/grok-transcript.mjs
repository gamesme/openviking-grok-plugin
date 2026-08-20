import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i;

export function grokHome() {
  const raw = process.env.GROK_HOME && process.env.GROK_HOME.trim()
    ? process.env.GROK_HOME
    : join(homedir(), ".grok");
  return raw.replace(/^~(?=$|\/)/, homedir());
}

export function grokSessionDir(sessionId, cwd = "") {
  if (!sessionId) return "";
  const encoded = encodeURIComponent(cwd || process.env.GROK_WORKSPACE_ROOT || process.cwd());
  return join(grokHome(), "sessions", encoded, sessionId);
}

export function grokChatHistoryPath(sessionId, cwd = "") {
  const dir = grokSessionDir(sessionId, cwd);
  return dir ? join(dir, "chat_history.jsonl") : "";
}

export function extractUserQuery(text) {
  const match = String(text || "").match(USER_QUERY_RE);
  return match ? match[1].trim() : "";
}

function flattenContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function parseChatHistory(content) {
  return String(content || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function latestUserPromptFromHistory(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type !== "user") continue;
    if (entry.synthetic_reason) continue;
    const text = flattenContent(entry.content);
    const query = extractUserQuery(text);
    if (query) return query;
    const trimmed = text.trim();
    if (trimmed && !trimmed.startsWith("<system-reminder>")) return trimmed;
  }
  return "";
}

export function latestAssistantTextFromHistory(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type !== "assistant") continue;
    const text = flattenContent(entry.content).trim();
    if (text) return text;
  }
  return "";
}

export function readLatestTurnFromSession(sessionId, cwd = "") {
  const path = grokChatHistoryPath(sessionId, cwd);
  if (!path) return { prompt: "", assistant: "" };
  try {
    const entries = parseChatHistory(readFileSync(path, "utf8"));
    return {
      prompt: latestUserPromptFromHistory(entries),
      assistant: latestAssistantTextFromHistory(entries),
    };
  } catch {
    return { prompt: "", assistant: "" };
  }
}
