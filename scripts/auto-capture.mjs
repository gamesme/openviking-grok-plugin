#!/usr/bin/env node

/**
 * Stop hook for Grok: capture the latest user + assistant turn into a
 * persistent OpenViking session (`gk-<grokSessionId>`).
 *
 * Prefers hook fields (prompt cache + lastAssistantMessage). Falls back to
 * ~/.grok/sessions/<cwd>/<id>/chat_history.jsonl.
 */

import { isPluginEnabled, loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";
import { normalizeHookInput, parseHookInput, readHookStdinSync } from "./grok-payload.mjs";
import { extractUserQuery, readLatestTurnFromSession } from "./grok-transcript.mjs";
import { maybeDetach } from "./lib/async-writer.mjs";
import {
  addMessage,
  commitSession,
  isBypassed,
  makeFetchJSON,
} from "./lib/ov-session.mjs";
import { readJsonState, writeJsonState } from "./lib/state.mjs";
import { getEffectivePeerId } from "./lib/workspace-peer.mjs";
import { shouldCaptureText } from "./shared/capture-utils.mjs";
import { deriveHarnessSessionId } from "./shared/session-model.mjs";

function approve() {
  process.stdout.write(`${JSON.stringify({ decision: "approve" })}\n`);
}

function promptStateName(sessionId) {
  return `grok-last-prompt-${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

function captureStateName(sessionId) {
  return `grok-capture-${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

async function main() {
  if (!isPluginEnabled()) {
    approve();
    return;
  }

  const cfg = loadConfig();
  const { log, logError } = createLogger("auto-capture");
  const fetchJSON = makeFetchJSON(cfg, "captureTimeoutMs");

  if (!cfg.autoCapture) {
    log("skip", { reason: "autoCapture disabled" });
    approve();
    return;
  }

  if (await maybeDetach(cfg, { approve })) return;

  const input = normalizeHookInput(parseHookInput(readHookStdinSync()));
  if (input.reason && input.reason !== "end_turn") {
    log("skip", { reason: `stop_${input.reason}` });
    approve();
    return;
  }
  if (!input.sessionId) {
    log("skip", { reason: "no sessionId" });
    approve();
    return;
  }
  if (isBypassed(cfg, { sessionId: input.sessionId, cwd: input.cwd })) {
    log("skip", { reason: "bypass_session_pattern" });
    approve();
    return;
  }

  const ovSessionId = deriveHarnessSessionId("gk-", input.sessionId);
  const captureState = readJsonState(captureStateName(input.sessionId)) || {};
  if (input.promptId && captureState.lastPromptId === input.promptId) {
    log("skip", { reason: "already_captured", promptId: input.promptId });
    approve();
    return;
  }

  const cached = readJsonState(promptStateName(input.sessionId)) || {};
  const fromTranscript = readLatestTurnFromSession(input.sessionId, input.cwd);
  const userText = extractUserQuery(cached.prompt || "")
    || cached.prompt
    || fromTranscript.prompt;
  const assistantText = input.lastAssistantMessage || fromTranscript.assistant;

  const userVerdict = shouldCaptureText(userText, "user", cfg);
  const assistantVerdict = cfg.captureAssistantTurns === false
    ? { shouldCapture: false, reason: "disabled", text: "" }
    : shouldCaptureText(assistantText, "assistant", cfg);

  if (!userVerdict.shouldCapture && !assistantVerdict.shouldCapture) {
    log("skip", {
      reason: "no_signal",
      user: userVerdict.reason,
      assistant: assistantVerdict.reason,
    });
    approve();
    return;
  }

  const effectivePeer = getEffectivePeerId(cfg, {
    sessionId: input.sessionId,
    cwd: input.cwd,
  });
  const messages = [];
  if (userVerdict.shouldCapture) {
    messages.push({ role: "user", content: userVerdict.text });
  }
  if (assistantVerdict.shouldCapture) {
    messages.push({ role: "assistant", content: assistantVerdict.text });
  }

  try {
    for (const payload of messages) {
      const res = await addMessage(fetchJSON, ovSessionId, {
        ...payload,
        ...(effectivePeer.peerId ? { peer_id: effectivePeer.peerId } : {}),
      });
      if (!res.ok) logError("addMessage", res.error || res);
    }
    const commit = await commitSession(fetchJSON, ovSessionId, {
      ...(effectivePeer.peerId ? { peer_id: effectivePeer.peerId } : {}),
    });
    if (!commit.ok) logError("commitSession", commit.error || commit);
    writeJsonState(captureStateName(input.sessionId), {
      lastPromptId: input.promptId,
      ovSessionId,
      captured: messages.map((m) => m.role),
    });
    writeJsonState("last-capture.json", {
      grok_session_id: input.sessionId,
      ov_session_id: ovSessionId,
      roles: messages.map((m) => m.role),
    });
    log("captured", { ovSessionId, roles: messages.map((m) => m.role) });
  } catch (err) {
    logError("capture", err);
  }
  approve();
}

main().catch((err) => {
  try {
    process.stdout.write(`${JSON.stringify({ decision: "approve" })}\n`);
  } catch { /* ignore */ }
  console.error(err);
  process.exit(0);
});
