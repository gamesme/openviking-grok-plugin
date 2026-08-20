#!/usr/bin/env node

/**
 * UserPromptSubmit for Grok.
 *
 * Grok treats this event as observe-only and ignores stdout, so the
 * additionalContext block will not reach the model. We still run recall
 * and write ~/.openviking/last_recall.md so the skill / MCP path can use it.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { isPluginEnabled, loadConfig } from "./config.mjs";
import { createLogger } from "./debug-log.mjs";
import { normalizeHookInput, parseHookInput, readHookStdinSync } from "./grok-payload.mjs";
import { extractUserQuery } from "./grok-transcript.mjs";
import { isBypassed, makeFetchJSON } from "./lib/ov-session.mjs";
import { writeJsonState } from "./lib/state.mjs";
import { getEffectivePeerId } from "./lib/identity.mjs";
import { buildRecallBlock } from "./shared/recall-core.mjs";

function approve(msg) {
  const out = { decision: "approve" };
  if (msg) {
    out.hookSpecificOutput = {
      hookEventName: "UserPromptSubmit",
      additionalContext: msg,
    };
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

function writeLastRecall(content) {
  try {
    const path = join(homedir(), ".openviking", "last_recall.md");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  } catch { /* audit file only */ }
}

function writeLastPrompt(sessionId, promptId, prompt) {
  if (!sessionId || !prompt) return;
  writeJsonState(`grok-last-prompt-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`, {
    sessionId,
    promptId,
    prompt,
  });
}

async function main() {
  if (!isPluginEnabled()) {
    approve();
    return;
  }

  const cfg = loadConfig();
  const { log, logError } = createLogger("auto-recall");
  const fetchJSON = makeFetchJSON(cfg);
  const input = normalizeHookInput(parseHookInput(readHookStdinSync()));
  const query = extractUserQuery(input.prompt) || input.prompt.trim();

  writeLastPrompt(input.sessionId, input.promptId, query);

  if (!cfg.autoRecall) {
    log("skip", { reason: "autoRecall disabled" });
    approve();
    return;
  }
  if (isBypassed(cfg, { sessionId: input.sessionId, cwd: input.cwd })) {
    log("skip", { reason: "bypass_session_pattern" });
    approve();
    return;
  }
  if (!query || query.length < (cfg.minQueryLength || 3)) {
    log("skip", { reason: "short_query", length: query.length });
    approve();
    return;
  }

  const effectivePeer = getEffectivePeerId(cfg);

  try {
    const block = await buildRecallBlock(fetchJSON, cfg, query, {
      actorPeerId: effectivePeer.peerId,
      log,
    });
    if (!block) {
      log("empty", { query: query.slice(0, 80) });
      approve();
      return;
    }
    const msg = [
      block,
      "",
      "Grok does not inject UserPromptSubmit hook stdout. Use OpenViking MCP find/search/read if this block is not already in context.",
    ].join("\n");
    writeLastRecall(msg);
    writeJsonState("last-recall.json", {
      grok_session_id: input.sessionId,
      prompt_id: input.promptId,
      query: query.slice(0, 200),
      bytes: msg.length,
    });
    log("recalled", { bytes: msg.length });
    approve(msg);
  } catch (err) {
    logError("recall", err);
    approve();
  }
}

main().catch((err) => {
  try {
    process.stdout.write(`${JSON.stringify({ decision: "approve" })}\n`);
  } catch { /* ignore */ }
  console.error(err);
  process.exit(0);
});
