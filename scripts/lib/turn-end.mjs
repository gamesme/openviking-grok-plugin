/**
 * Classify Grok turn-end events so Stop / StopFailure / StopCancelled capture
 * the same turn shape, with a recorded termination reason.
 */

export function classifyTurnEnd(input = {}) {
  const event = String(input.hookEventName || "Stop").trim() || "Stop";
  if (event === "StopFailure") {
    return {
      event,
      outcome: "failed",
      reason: input.error || "unknown",
      details: input.errorDetails || "",
      cancelledBy: "",
      cancelTrigger: "",
    };
  }
  if (event === "StopCancelled") {
    return {
      event,
      outcome: "cancelled",
      reason: input.reason || "unknown",
      details: input.reasonDetails || "",
      cancelledBy: input.cancelledBy || "",
      cancelTrigger: input.cancelTrigger || "",
    };
  }
  return {
    event: event || "Stop",
    outcome: "completed",
    reason: input.reason || "end_turn",
    details: "",
    cancelledBy: "",
    cancelTrigger: "",
  };
}

export function isSessionEndStop(input = {}, meta = classifyTurnEnd(input)) {
  if (meta.event !== "Stop") return false;
  const reason = meta.reason || "";
  return reason !== "" && reason !== "end_turn";
}

export function formatTurnEndMarker(meta) {
  const parts = [
    `[openviking-turn-end event=${meta.event} outcome=${meta.outcome} reason=${meta.reason}`,
  ];
  if (meta.cancelledBy) parts.push(`cancelledBy=${meta.cancelledBy}`);
  if (meta.cancelTrigger) parts.push(`cancelTrigger=${meta.cancelTrigger}`);
  if (meta.details) parts.push(`details=${oneLine(meta.details)}`);
  return `${parts.join(" ")}]`;
}

function oneLine(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 1000);
}

export function subagentSuffix(input = {}) {
  if (!input.subagentType && !input.agentId) return "";
  const id = input.agentId || input.subagentType || "subagent";
  return `subagent:${id}`;
}
