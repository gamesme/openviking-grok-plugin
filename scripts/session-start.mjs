#!/usr/bin/env node

/**
 * SessionStart for Grok.
 *
 * Grok ignores hook stdout on SessionStart, so profile/archive cannot be
 * injected the Claude/Codex way. We still:
 *   1. replay pending writes
 *   2. build the profile + resume archive
 *   3. write ~/.openviking/last_inject.md for the skill / /ov command
 *   4. emit additionalContext in case a later Grok build honors it
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { isPluginEnabled, loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";
import { normalizeHookInput, parseHookInput, readHookStdinSync } from "./grok-payload.mjs";
import { getEffectivePeerId } from "./lib/identity.mjs";
import {
  deriveOvSessionId,
  getSessionContext,
  isBypassed,
  makeFetchJSON,
} from "./lib/ov-session.mjs";
import { replayPending } from "./lib/pending-queue.mjs";
import { buildProfileBlock } from "./lib/profile-inject.mjs";
import { writeJsonState } from "./lib/state.mjs";

function approve(additionalContext) {
  const out = { decision: "approve" };
  if (additionalContext) {
    out.hookSpecificOutput = {
      hookEventName: "SessionStart",
      additionalContext,
    };
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

function writeLastInject(content) {
  try {
    const path = join(homedir(), ".openviking", "last_inject.md");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  } catch { /* audit file only */ }
}

function formatArchiveSection(sessionCtx) {
  if (!sessionCtx || typeof sessionCtx !== "object") return null;
  const overview = (sessionCtx.latest_archive_overview || "").trim();
  if (!overview) return null;
  const abstracts = Array.isArray(sessionCtx.pre_archive_abstracts)
    ? sessionCtx.pre_archive_abstracts.filter((a) => typeof a === "string" && a.trim())
    : [];
  const lines = [
    "<session-archive>",
    `  <archive-overview>${overview}</archive-overview>`,
  ];
  for (const abs of abstracts.slice(0, 5)) {
    lines.push(`  <archive-abstract>${abs.trim()}</archive-abstract>`);
  }
  lines.push("</session-archive>");
  return lines.join("\n");
}

async function main() {
  if (!isPluginEnabled()) {
    approve();
    return;
  }

  const cfg = loadConfig();
  const { log, logError } = createLogger("session-start");
  const fetchJSON = makeFetchJSON(cfg);
  const input = normalizeHookInput(parseHookInput(readHookStdinSync()));
  const { sessionId, cwd, source } = input;
  const ovSessionId = sessionId ? deriveOvSessionId(sessionId) : "";
  const effectivePeer = getEffectivePeerId(cfg);

  log("start", { source, sessionId, ovSessionId, peerSource: effectivePeer.source });

  if (isBypassed(cfg, { sessionId, cwd })) {
    log("skip", { reason: "bypass_session_pattern" });
    approve();
    return;
  }

  const health = await fetchJSON("/health");
  if (!health.ok) {
    logError("health_check", "server unreachable");
    approve();
    return;
  }

  try {
    const replayResult = await replayPending(fetchJSON, log);
    if (replayResult.replayed > 0 || replayResult.failed > 0 || replayResult.deferred > 0) {
      log("pending-replay", replayResult);
    }
  } catch (err) {
    logError("pending-replay", err);
  }

  let profile = null;
  if (!cfg.noAutoInject) {
    try {
      profile = await buildProfileBlock(fetchJSON, cfg.profileTokenBudget, effectivePeer.peerId);
    } catch (err) {
      logError("profile_inject", err);
    }
  }

  let archiveSection = null;
  if ((source === "resume" || source === "compact") && ovSessionId) {
    const sessionCtx = await getSessionContext(fetchJSON, ovSessionId, cfg.resumeContextBudget);
    archiveSection = formatArchiveSection(sessionCtx);
  }

  if (source === "resume" || source === "compact") {
    writeJsonState("last-session-event.json", {
      source,
      grok_session_id: sessionId,
      ov_session_id: ovSessionId,
      had_context: Boolean(archiveSection),
    });
  }

  const sections = [];
  if (profile?.block) sections.push(profile.block);
  if (archiveSection) sections.push(archiveSection);
  if (sections.length === 0) {
    log("skip", { reason: "empty_inject" });
    approve();
    return;
  }

  const additionalContext = [
    `<openviking-context source="${source}">`,
    ...sections,
    "</openviking-context>",
    "",
    "Grok does not inject hook stdout on SessionStart. Prefer OpenViking MCP find/search/read, or read ~/.openviking/last_inject.md.",
  ].join("\n");

  writeLastInject(additionalContext);
  writeJsonState("last-inject.json", {
    source,
    grok_session_id: sessionId,
    ov_session_id: ovSessionId,
    bytes: additionalContext.length,
  });
  log("injected", { bytes: additionalContext.length, source });
  approve(additionalContext);
}

main().catch((err) => {
  try {
    process.stdout.write(`${JSON.stringify({ decision: "approve" })}\n`);
  } catch { /* ignore */ }
  console.error(err);
  process.exit(0);
});
