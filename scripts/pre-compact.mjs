#!/usr/bin/env node

import { isPluginEnabled, loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";
import { normalizeHookInput, parseHookInput, readHookStdinSync } from "./grok-payload.mjs";
import { getEffectivePeerId } from "./lib/identity.mjs";
import { commitSession, deriveOvSessionId, isBypassed, makeFetchJSON } from "./lib/ov-session.mjs";

function approve() {
  process.stdout.write(`${JSON.stringify({ decision: "approve" })}\n`);
}

async function main() {
  if (!isPluginEnabled()) {
    approve();
    return;
  }

  const cfg = loadConfig();
  const { log, logError } = createLogger("pre-compact");
  const fetchJSON = makeFetchJSON(cfg);

  if (!cfg.autoCapture) {
    log("skip", { reason: "autoCapture disabled" });
    approve();
    return;
  }

  const input = normalizeHookInput(parseHookInput(readHookStdinSync()));
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

  const ovSessionId = deriveOvSessionId(input.sessionId);
  const peerId = getEffectivePeerId(cfg).peerId;
  try {
    const res = await commitSession(fetchJSON, ovSessionId, { peer_id: peerId });
    if (!res.ok) logError("commitSession", res.error || res);
    else log("committed", { ovSessionId });
  } catch (err) {
    logError("commit", err);
  }
  approve();
}

main().catch(() => {
  try {
    process.stdout.write(`${JSON.stringify({ decision: "approve" })}\n`);
  } catch { /* ignore */ }
  process.exit(0);
});
