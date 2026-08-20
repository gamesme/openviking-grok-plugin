/**
 * Grok actor-peer resolution.
 *
 * Hard rule: the actor is always peer `grok` unless an operator explicitly
 * sets OPENVIKING_PEER_ID / ovcli.conf plugin.grok.peerId / ov.conf
 * grok_code.peerId. Working-directory derivation is forbidden — it minted
 * peers like `-Users-gamesme` and split memories off peers/grok/.
 *
 * Hooks and the MCP proxy must both call resolveActorPeer so identity cannot
 * drift between the two processes.
 */

export const DEFAULT_GROK_PEER_ID = "grok";

export function resolveActorPeer(cfg = {}) {
  const explicit = String(cfg.peerId || "").trim();
  if (explicit) return { peerId: explicit, source: "explicit" };
  return { peerId: DEFAULT_GROK_PEER_ID, source: "default" };
}

export function getEffectivePeerId(cfg, _ctx = {}) {
  return resolveActorPeer(cfg);
}
