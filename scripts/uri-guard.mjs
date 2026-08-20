#!/usr/bin/env node

import { buildGuardMessage, findVikingUri } from "./shared/uri-guard.mjs";
import { normalizeHookInput, parseHookInput, readHookStdinSync } from "./grok-payload.mjs";

const TOOL_HINTS = {
  read: {
    tool: "OpenViking MCP read",
    example: (uri) => `read(uris="${uri}")`,
  },
  glob: {
    tool: "OpenViking MCP glob or list",
    example: (uri, input = {}) =>
      `glob(pattern="${String(input.pattern ?? "**/*").replaceAll('"', '\\"')}", uri="${uri}")`,
  },
  grep: {
    tool: "OpenViking MCP grep or search",
    example: (uri, input = {}) =>
      `grep(uri="${uri}", pattern="${String(input.pattern ?? "").replaceAll('"', '\\"')}")`,
  },
};

const TOOL_ALIASES = {
  read: "read",
  read_file: "read",
  glob: "glob",
  listdir: "glob",
  list_dir: "glob",
  grep: "grep",
};

export function classifyTool(name) {
  const key = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return TOOL_ALIASES[key] || "";
}

export function evaluatePreToolUse(input = {}) {
  const normalized = normalizeHookInput(input);
  const kind = classifyTool(normalized.toolName);
  const hint = TOOL_HINTS[kind];
  if (!hint) return {};
  const uri = findVikingUri(normalized.toolInput);
  if (!uri) return {};
  const reason = buildGuardMessage(uri, {
    tool: hint.tool,
    example: hint.example(uri, normalized.toolInput),
  });
  return {
    decision: "deny",
    reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function main() {
  const out = evaluatePreToolUse(parseHookInput(readHookStdinSync()));
  if (Object.keys(out).length > 0) {
    process.stdout.write(`${JSON.stringify(out)}\n`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
