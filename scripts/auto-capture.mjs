#!/usr/bin/env node

/**
 * Turn-end capture for Grok.
 *
 * Registered on Stop, StopFailure, and StopCancelled so a genuine completion,
 * an API error, and an interrupt/cancel all land in the same OV session, with
 * the termination reason recorded on the captured turn.
 *
 * Prefers hook fields (prompt cache + lastAssistantMessage). Falls back to
 * ~/.grok/sessions/<cwd>/<id>/chat_history.jsonl.
 *
 * Stop is a gate: this script never blocks. It exits 0 with empty stdout.
 */

import { isPluginEnabled, loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";
import { normalizeHookInput, parseHookInput, readHookStdinSync } from "./grok-payload.mjs";
import { extractUserQuery, readLatestTurnFromSession } from "./grok-transcript.mjs";
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
import {
  classifyTurnEnd,
  formatTurnEndMarker,
  isSessionEndStop,
  subagentSuffix,
} from "./lib/turn-end.mjs";
import { shouldCaptureText } from "./shared/capture-utils.mjs";

function allowStop() {
  // Gate events: empty stdout, exit 0. additionalContext would keep the agent working.
}

function promptStateName(sessionId) {
  return `grok-last-prompt-${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

function captureStateName(sessionId) {
  return `grok-capture-${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
}

async function main() {
  if (!isPluginEnabled()) {
    allowStop();
    return;
  }

  const cfg = loadConfig();
  const { log, logError } = createLogger("auto-capture");
  const fetchJSON = makeFetchJSON(cfg, "captureTimeoutMs");

  if (!cfg.autoCapture) {
    log("skip", { reason: "autoCapture disabled" });
    allowStop();
    return;
  }

  if (await maybeDetach(cfg, { approve: allowStop })) return;

  const input = normalizeHookInput(parseHookInput(readHookStdinSync()));
  const meta = classifyTurnEnd(input);
  if (isSessionEndStop(input, meta)) {
    log("skip", { reason: `stop_${meta.reason}` });
    allowStop();
    return;
  }
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

  const ovSessionId = deriveOvSessionId(input.sessionId, subagentSuffix(input));
  const captureState = readJsonState(captureStateName(input.sessionId)) || {};
  if (input.promptId && captureState.lastPromptId === input.promptId) {
    log("skip", { reason: "already_captured", promptId: input.promptId, event: meta.event });
    allowStop();
    return;
  }

  const cached = readJsonState(promptStateName(input.sessionId)) || {};
  const fromTranscript = readLatestTurnFromSession(input.sessionId, input.cwd);
  const cachedPromptId = String(cached.promptId || "").trim();
  // A cancelled report can land after the next UserPromptSubmit, which
  // overwrites grok-last-prompt-*.json (and the latest transcript turn).
  // Pairing that newer user text with this turn's assistant output pollutes
  // memory. Missing a user message is a valid downgrade; a mismatched one is not.
  const promptCacheFresh = !input.promptId || !cachedPromptId
    || input.promptId === cachedPromptId;
  const userText = promptCacheFresh
    ? (extractUserQuery(cached.prompt || "") || cached.prompt || fromTranscript.prompt)
    : "";
  let assistantText = input.lastAssistantMessage || fromTranscript.assistant;
  const marker = formatTurnEndMarker(meta);
  if (meta.outcome !== "completed") {
    assistantText = assistantText ? `${assistantText}\n\n${marker}` : marker;
  }

  const userVerdict = shouldCaptureText(userText, "user", cfg);
  const assistantVerdict = cfg.captureAssistantTurns === false && meta.outcome === "completed"
    ? { shouldCapture: false, reason: "disabled", text: "" }
    : shouldCaptureText(assistantText, "assistant", cfg);

  if (!userVerdict.shouldCapture && !assistantVerdict.shouldCapture) {
    log("skip", {
      reason: "no_signal",
      event: meta.event,
      user: userVerdict.reason,
      assistant: assistantVerdict.reason,
    });
    allowStop();
    return;
  }

  const effectivePeer = getEffectivePeerId(cfg);
  const messages = [];
  if (userVerdict.shouldCapture) {
    messages.push({ role: "user", content: userVerdict.text });
  }
  if (assistantVerdict.shouldCapture) {
    messages.push({ role: "assistant", content: assistantVerdict.text });
  } else if (meta.outcome !== "completed") {
    messages.push({ role: "assistant", content: marker });
  }

  try {
    for (const payload of messages) {
      const res = await addMessage(fetchJSON, ovSessionId, {
        ...payload,
        peer_id: effectivePeer.peerId,
      });
      if (!res.ok) logError("addMessage", res.error || res);
    }
    const commit = await commitSession(fetchJSON, ovSessionId, {
      peer_id: effectivePeer.peerId,
    });
    if (!commit.ok) logError("commitSession", commit.error || commit);
    writeJsonState(captureStateName(input.sessionId), {
      lastPromptId: input.promptId,
      ovSessionId,
      captured: messages.map((m) => m.role),
      event: meta.event,
      outcome: meta.outcome,
      reason: meta.reason,
    });
    writeJsonState("last-capture.json", {
      grok_session_id: input.sessionId,
      ov_session_id: ovSessionId,
      roles: messages.map((m) => m.role),
      event: meta.event,
      outcome: meta.outcome,
      reason: meta.reason,
      peer_id: effectivePeer.peerId,
      cwd: input.cwd,
    });
    log("captured", {
      ovSessionId,
      roles: messages.map((m) => m.role),
      event: meta.event,
      outcome: meta.outcome,
      reason: meta.reason,
      peer: effectivePeer.peerId,
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
