// app/services/mesh/peerTrust.js
// Who a nearby Bluetooth device is, and how far to believe it.
//
// A device that has answered a challenge (see PeerProof) is "verified" for a while. An unverified device that
// claims the ID of a verified one at a different address is NOT allowed to take over that ID's address:
// otherwise anyone could copy a profile and have messages meant for someone else handed to them.

export const VERIFIED_FOR_MS = 10 * 60 * 1000;

/** Is this peer record backed by a recent proof, for the address it currently has? */
export function isVerified(peer, now = Date.now()) {
  return !!peer && typeof peer.verifiedAt === "number" && now - peer.verifiedAt < VERIFIED_FOR_MS && !!peer.bleId;
}

/**
 * A device at `bleId` has read-out profile `profile.id`; `verified` says whether it passed the challenge.
 * Returns what to do with the claim against `existing` (what is currently stored for that id, if anything):
 *   { action: "accept", verifiedAt }   record it (verifiedAt is a time, or null)
 *   { action: "ignore", reason }       leave the existing record alone
 */
export function decideClaim(existing, { bleId, verified }, now = Date.now()) {
  if (verified) return { action: "accept", verifiedAt: now };
  if (existing && isVerified(existing, now) && existing.bleId !== bleId) {
    return { action: "ignore", reason: "another device claims the id of a verified one" };
  }
  // the same device, a brief failure to answer: keep the earlier proof while it is still fresh
  const keep = existing && existing.bleId === bleId && isVerified(existing, now) ? existing.verifiedAt : null;
  return { action: "accept", verifiedAt: keep };
}
