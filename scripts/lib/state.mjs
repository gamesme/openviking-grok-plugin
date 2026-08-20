/**
 * Plugin-private runtime state.
 *
 * Writes go to GROK_PLUGIN_DATA (official plugin-writable dir). When that env
 * is unset (MCP proxy, /ov, tests), fall back to
 * ~/.grok/plugin-data/openviking-memory.
 *
 * Existing grok files under ~/.openviking/state/ are copied once into the new
 * dir (never deleted) and remain readable as a fallback so a restart cannot
 * drop capture/prompt cursors.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PLUGIN_NAME = "openviking-memory";
const POINTER_NAME = ".state-dir";
const MIGRATION_MARKER = ".migrated-from-openviking-state";

const SHARED_LAST_FILES = new Set([
  "last-inject.json",
  "last-recall.json",
  "last-capture.json",
  "last-session-event.json",
]);

function grokHome() {
  const raw = process.env.GROK_HOME && process.env.GROK_HOME.trim()
    ? process.env.GROK_HOME
    : join(homedir(), ".grok");
  return raw.replace(/^~(?=$|\/)/, homedir());
}

function ovHome() {
  const raw = process.env.OPENVIKING_HOME && process.env.OPENVIKING_HOME.trim()
    ? process.env.OPENVIKING_HOME
    : join(homedir(), ".openviking");
  return raw.replace(/^~(?=$|\/)/, homedir());
}

export function getLegacyStateDir() {
  return join(ovHome(), "state");
}

function fallbackStateDir() {
  return join(grokHome(), "plugin-data", PLUGIN_NAME);
}

function envStateDir() {
  const raw = String(process.env.GROK_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || "").trim();
  if (!raw || raw === "undefined" || raw === "null") return "";
  const expanded = raw.replace(/^~(?=$|\/)/, homedir());
  if (!expanded.startsWith("/")) return "";
  return expanded;
}

function readPointer() {
  try {
    const parsed = JSON.parse(readFileSync(join(fallbackStateDir(), POINTER_NAME), "utf8"));
    return String(parsed?.dir || "").trim();
  } catch {
    return "";
  }
}

function writePointer(dir) {
  const fallback = fallbackStateDir();
  if (!dir || dir === fallback) return;
  try {
    mkdirSync(fallback, { recursive: true });
    const target = join(fallback, POINTER_NAME);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ dir, ts: Date.now() }));
    renameSync(tmp, target);
  } catch { /* best effort */ }
}

export function resolveStateDir() {
  const fromEnv = envStateDir();
  if (fromEnv) {
    writePointer(fromEnv);
    return fromEnv;
  }
  return readPointer() || fallbackStateDir();
}

export function looksLikeGrokPayload(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.grok_session_id) return true;
  const ovId = parsed.ov_session_id || parsed.ovSessionId || "";
  return typeof ovId === "string" && ovId.startsWith("gk-");
}

function grokOwnedLegacyName(name) {
  return name.startsWith("grok-") || SHARED_LAST_FILES.has(name);
}

let migratedFor = "";

export function migrateLegacyState(destDir) {
  if (!destDir || migratedFor === destDir) return { copied: 0, skipped: true };
  migratedFor = destDir;
  const legacyDir = getLegacyStateDir();
  if (!existsSync(legacyDir)) return { copied: 0 };
  mkdirSync(destDir, { recursive: true });
  const marker = join(destDir, MIGRATION_MARKER);
  if (existsSync(marker)) return { copied: 0, already: true };
  let names = [];
  try {
    names = readdirSync(legacyDir);
  } catch {
    return { copied: 0 };
  }
  let copied = 0;
  for (const name of names) {
    if (!name.endsWith(".json") || name.endsWith(".tmp")) continue;
    if (!grokOwnedLegacyName(name)) continue;
    const src = join(legacyDir, name);
    const dest = join(destDir, name);
    if (existsSync(dest)) continue;
    if (SHARED_LAST_FILES.has(name)) {
      try {
        if (!looksLikeGrokPayload(JSON.parse(readFileSync(src, "utf8")))) continue;
      } catch {
        continue;
      }
    }
    try {
      copyFileSync(src, dest);
      copied += 1;
    } catch { /* keep the original */ }
  }
  try {
    writeFileSync(marker, JSON.stringify({
      ts: Date.now(),
      copied,
      from: legacyDir,
    }));
  } catch { /* ignore */ }
  return { copied };
}

function activeDir() {
  const dir = resolveStateDir();
  migrateLegacyState(dir);
  try {
    mkdirSync(dir, { recursive: true });
  } catch { /* write will fail visibly */ }
  return dir;
}

export function statePath(name) {
  return join(activeDir(), name);
}

export function writeJsonState(name, payload) {
  const target = join(activeDir(), name);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ ...payload, ts: payload?.ts ?? Date.now() }));
    renameSync(tmp, target);
  } catch { /* next hook / /ov tolerate missing files */ }
}

export function readJsonState(name, { maxAgeMs } = {}) {
  const dir = activeDir();
  const candidates = [join(dir, name), join(getLegacyStateDir(), name)];
  for (const [index, path] of candidates.entries()) {
    let raw;
    try {
      raw = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (maxAgeMs && typeof parsed?.ts === "number" && Date.now() - parsed.ts > maxAgeMs) {
      continue;
    }
    if (index === 1 && SHARED_LAST_FILES.has(name) && !looksLikeGrokPayload(parsed)) {
      continue;
    }
    return parsed;
  }
  return null;
}
