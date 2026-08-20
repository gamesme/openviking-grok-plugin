#!/usr/bin/env node

import { isPluginEnabled, loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";
import { normalizeHookInput, parseHookInput, readHookStdinSync } from "./grok-payload.mjs";
import { maybeDetach } from "./lib/async-writer.mjs";
import { commitSession, isBypassed, makeFetchJSON } from "./lib/ov-session.mjs";
import { deriveHarnessSessionId } from "./shared/session-model.mjs";

function approve() {
  process.stdout.write(`${JSON.stringify({ decision: "approve" })}\n`);
}

async function main() {
  if (!isPluginEnabled()) {
    approve();
    return;
  }

  const cfg = loadConfig();
  const { log, logError } = createLogger("session-end");
  const fetchJSON = makeFetchJSON(cfg);

  if (!cfg.autoCapture) {
    log("skip", { reason: "autoCapture disabled" });
    approve();
    return;
  }

  if (await maybeDetach(cfg, { approve })) return;

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

  const ovSessionId = deriveHarnessSessionId("gk-", input.sessionId);
  try {
    const res = await commitSession(fetchJSON, ovSessionId, {});
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
