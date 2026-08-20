#!/usr/bin/env node

/**
 * SubagentStart for Grok.
 *
 * SessionStart does not fire for a subagent's own session. This hook records
 * the isolated OV session id so SubagentStop can capture the child's turns
 * without mixing them into the parent.
 */

import { isPluginEnabled, loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";
import { normalizeHookInput, parseHookInput, readHookStdinSync } from "./grok-payload.mjs";
import { getEffectivePeerId } from "./lib/identity.mjs";
import { deriveOvSessionId, isBypassed } from "./lib/ov-session.mjs";
import { writeJsonState } from "./lib/state.mjs";
import { subagentSuffix } from "./lib/turn-end.mjs";

function stateName(key) {
  return `grok-subagent-${String(key).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

async function main() {
  if (!isPluginEnabled()) return;
  const cfg = loadConfig();
  const { log, logError } = createLogger("subagent-start");
  if (!cfg.autoCapture) {
    log("skip", { reason: "autoCapture disabled" });
    return;
  }

  const input = normalizeHookInput(parseHookInput(readHookStdinSync()));
  if (!input.sessionId) {
    log("skip", { reason: "no sessionId" });
    return;
  }
  if (isBypassed(cfg, { sessionId: input.sessionId, cwd: input.cwd })) {
    log("skip", { reason: "bypass_session_pattern" });
    return;
  }

  const suffix = subagentSuffix(input) || `subagent:${input.subagentType || "child"}`;
  const ovSessionId = deriveOvSessionId(input.sessionId, suffix);
  const effectivePeer = getEffectivePeerId(cfg);
  const record = {
    parentSessionId: input.sessionId,
    agentId: input.agentId,
    subagentType: input.subagentType,
    ovSessionId,
    peerId: effectivePeer.peerId,
    peerSource: effectivePeer.source,
    cwd: input.cwd,
    startedAt: Date.now(),
  };

  try {
    if (input.agentId) writeJsonState(stateName(input.agentId), record);
    writeJsonState(stateName(input.sessionId), record);
  } catch (err) {
    logError("state_write", err);
  }
  log("start", {
    agentId: input.agentId,
    subagentType: input.subagentType,
    ovSessionId,
    peer: effectivePeer.peerId,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(0);
});
