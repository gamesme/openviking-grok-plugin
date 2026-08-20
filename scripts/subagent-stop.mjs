#!/usr/bin/env node

/**
 * SubagentStop for Grok.
 *
 * Fires once, in the subagent, as a stop gate. Capture the child's transcript
 * into the isolated OV session created at SubagentStart. Never block the stop.
 */

import { readFileSync } from "node:fs";

import { isPluginEnabled, loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";
import { normalizeHookInput, parseHookInput, readHookStdinSync } from "./grok-payload.mjs";
import {
  extractTurnsFromHistory,
  parseChatHistory,
  readTurnsFromSession,
} from "./grok-transcript.mjs";
import { maybeDetach } from "./lib/async-writer.mjs";
import { getEffectivePeerId } from "./lib/identity.mjs";
import {
  addMessage,
  commitSession,
  deriveOvSessionId,
  isBypassed,
  makeFetchJSON,
} from "./lib/ov-session.mjs";
import { readJsonState, writeJsonState } from "./lib/state.mjs";
import { classifyTurnEnd, formatTurnEndMarker, subagentSuffix } from "./lib/turn-end.mjs";
import { shouldCaptureText } from "./shared/capture-utils.mjs";

function allowStop() {}

function stateName(key) {
  return `grok-subagent-${String(key).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

function loadStartState(input) {
  if (input.agentId) {
    const byAgent = readJsonState(stateName(input.agentId));
    if (byAgent?.ovSessionId) return byAgent;
  }
  if (input.sessionId) {
    const bySession = readJsonState(stateName(input.sessionId));
    if (bySession?.ovSessionId) return bySession;
  }
  return null;
}

function readTurns(input) {
  if (input.transcriptPath) {
    try {
      return extractTurnsFromHistory(parseChatHistory(readFileSync(input.transcriptPath, "utf8")));
    } catch { /* fall through to grok session files */ }
  }
  return readTurnsFromSession(input.sessionId, input.cwd);
}

async function main() {
  if (!isPluginEnabled()) {
    allowStop();
    return;
  }

  const cfg = loadConfig();
  const { log, logError } = createLogger("subagent-stop");
  if (!cfg.autoCapture) {
    log("skip", { reason: "autoCapture disabled" });
    allowStop();
    return;
  }

  if (await maybeDetach(cfg, { approve: allowStop })) return;

  const input = normalizeHookInput(parseHookInput(readHookStdinSync()));
  if (!input.sessionId) {
    log("skip", { reason: "no sessionId" });
    allowStop();
    return;
  }
  if (isBypassed(cfg, { sessionId: input.sessionId, cwd: input.cwd })) {
    log("skip", { reason: "bypass_session_pattern" });
    allowStop();
    return;
  }

  const start = loadStartState(input);
  const suffix = subagentSuffix({
    agentId: input.agentId || start?.agentId,
    subagentType: input.subagentType || start?.subagentType,
  }) || "subagent";
  const ovSessionId = start?.ovSessionId || deriveOvSessionId(input.sessionId, suffix);
  const effectivePeer = getEffectivePeerId(cfg);
  const peerId = start?.peerId || effectivePeer.peerId;
  const meta = classifyTurnEnd({ ...input, hookEventName: input.hookEventName || "SubagentStop" });
  const turns = readTurns(input);

  const messages = [];
  for (const turn of turns) {
    const verdict = shouldCaptureText(turn.text, turn.role, cfg);
    if (verdict.shouldCapture) messages.push({ role: turn.role, content: verdict.text });
  }
  if (input.lastAssistantMessage) {
    const last = shouldCaptureText(input.lastAssistantMessage, "assistant", cfg);
    const already = messages.some((m) => m.role === "assistant" && m.content === last.text);
    if (last.shouldCapture && !already) {
      messages.push({ role: "assistant", content: last.text });
    }
  }
  if (messages.length === 0 && (input.lastAssistantMessage || input.prompt)) {
    const marker = formatTurnEndMarker({ ...meta, event: "SubagentStop" });
    messages.push({ role: "assistant", content: marker });
  }

  if (messages.length === 0) {
    log("skip", { reason: "no_turns", ovSessionId });
    allowStop();
    return;
  }

  const fetchJSON = makeFetchJSON(cfg, "captureTimeoutMs");
  try {
    for (const payload of messages) {
      const res = await addMessage(fetchJSON, ovSessionId, { ...payload, peer_id: peerId });
      if (!res.ok) logError("addMessage", res.error || res);
    }
    const commit = await commitSession(fetchJSON, ovSessionId, { peer_id: peerId });
    if (!commit.ok) logError("commitSession", commit.error || commit);
    writeJsonState("last-capture.json", {
      grok_session_id: input.sessionId,
      ov_session_id: ovSessionId,
      roles: messages.map((m) => m.role),
      event: "SubagentStop",
      outcome: "completed",
      reason: input.reason || "end_turn",
      subagentType: input.subagentType || start?.subagentType || "",
      peer_id: peerId,
    });
    log("captured", {
      ovSessionId,
      turns: messages.length,
      peer: peerId,
      subagentType: input.subagentType,
    });
  } catch (err) {
    logError("capture", err);
  }
  allowStop();
}

main().catch((err) => {
  try { allowStop(); } catch { /* ignore */ }
  console.error(err);
  process.exit(0);
});
