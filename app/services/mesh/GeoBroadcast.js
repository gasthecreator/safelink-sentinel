// app/services/mesh/GeoBroadcast.js
// Alerts and relief requests: published once as a signed broadcast and held in
// the Outbox, so they reach everyone nearby now and anyone who arrives later.

import Outbox from "./Outbox.js";
import { sanitizePosition, sanitizeText } from "../location/position.js";

class GeoBroadcast {
  /**
   * Publish a broadcast. The area (center/radiusKm) travels in the message
   * metadata so receivers can judge relevance; the radio range itself is the
   * delivery boundary.
   *
   * Options: { center, radiusKm, priority, extraMeta, position, where, store = true }
   * `where` is a free-text note from the sender ("2nd floor, behind the pharmacy").
   * `position` is the sender's { latitude, longitude, accuracyM, fixedAt }; it is
   * validated and, if credible, sent along so receivers can find the sender.
   * `store: false` sends only to whoever is in range right now.
   * Returns { totalTargets, success, failed, queued, id }.
   */
  async broadcast(senderId, content, options = {}) {
    const {
      center = null,
      radiusKm = null,
      priority = "normal",
      extraMeta = {},
      position = null,
      where = null,
      store = true,
    } = options;
    const cleanPosition = sanitizePosition(position);
    const cleanWhere = sanitizeText(where);

    const meta = {
      priority,
      ...extraMeta,
      ...(center ? { center } : {}),
      ...(radiusKm != null ? { radiusKm } : {}),
      ...(cleanPosition ? { position: cleanPosition } : {}),
      ...(cleanWhere ? { where: cleanWhere } : {}),
    };
    // Urgent messages are allowed to travel further.
    const ttl = priority === "critical" || priority === "high" ? 6 : 4;

    const summary = await Outbox.publish(content, meta, { ttl, store });
    console.log(
      `[SafeLink][Geo] 📣 ${priority.toUpperCase()} broadcast: sent to ${summary.success}/${summary.totalTargets} in range` +
        (summary.queued ? ", kept for later arrivals" : "")
    );
    return summary;
  }

  // standard radius helper
  async broadcastToRadius(senderId, content, center, radiusKm, meta = {}, priority = "normal") {
    return this.broadcast(senderId, content, { center, radiusKm, priority, extraMeta: meta });
  }

  // broadcast to everyone (no filter)
  async broadcastToAll(senderId, content, meta = {}, priority = "normal") {
    return this.broadcast(senderId, content, { extraMeta: meta, priority });
  }
}

export default new GeoBroadcast();
