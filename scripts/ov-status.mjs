#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isPluginEnabled, loadConfig } from "./config.mjs";
import { makeFetchJSON } from "./lib/ov-session.mjs";
import { getEffectivePeerId } from "./lib/identity.mjs";
import { resolveStateDir, readJsonState } from "./lib/state.mjs";

function fmtAge(ts) {
  if (!ts) return "never";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${Math.max(0, sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function fileInfo(path) {
  if (!existsSync(path)) return "missing";
  try {
    const st = statSync(path);
    return `${st.size} B, ${fmtAge(st.mtimeMs)}`;
  } catch {
    return "unreadable";
  }
}

async function main() {
  if (!isPluginEnabled()) {
    console.log("OpenViking plugin: DISABLED (OPENVIKING_MEMORY_ENABLED=0 or no ovcli.conf)");
    return;
  }

  const cfg = loadConfig();
  const fetchJSON = makeFetchJSON(cfg, "timeoutMs");
  const t0 = Date.now();
  const health = await fetchJSON("/health");
  console.log(`OpenViking — ${cfg.baseUrl}  (${health.ok ? "ok" : "fail"} /health ${Date.now() - t0}ms)`);
  const peer = getEffectivePeerId(cfg);
  console.log(`Identity: account=${cfg.accountId || "(unset)"}  user=${cfg.userId || "(server-resolved)"}`);
  console.log(`Harness: grok  peer=${peer.peerId} (${peer.source})  session prefix: gk-`);
  console.log(`State dir: ${resolveStateDir()}`);
  console.log("");
  console.log(`autoRecall=${cfg.autoRecall}  autoCapture=${cfg.autoCapture}  noAutoInject=${cfg.noAutoInject}`);
  console.log("");

  const lastInject = join(homedir(), ".openviking", "last_inject.md");
  const lastRecall = join(homedir(), ".openviking", "last_recall.md");
  console.log(`last_inject.md: ${fileInfo(lastInject)}`);
  console.log(`last_recall.md: ${fileInfo(lastRecall)}`);

  const injectState = readJsonState("last-inject.json");
  const recallState = readJsonState("last-recall.json");
  const captureState = readJsonState("last-capture.json");
  if (injectState) console.log(`last inject: ${fmtAge(injectState.ts)}  ${injectState.source || ""}  ${injectState.bytes || 0} B`);
  if (recallState) console.log(`last recall: ${fmtAge(recallState.ts)}  ${recallState.query || ""}`);
  if (captureState) console.log(`last capture: ${fmtAge(captureState.ts)}  ${captureState.ov_session_id || ""}`);

  try {
    const raw = readFileSync(join(homedir(), ".openviking", "ovcli.conf"), "utf8");
    JSON.parse(raw);
    console.log("config: ~/.openviking/ovcli.conf");
  } catch {
    console.log("config: ovcli.conf missing or invalid");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
