// server/utils/routerAI.js
// Server-side routing AI utilities

class RouterAI {
  constructor() {
    this.peerStats = {};
  }

  // Record delivery outcome for peer
  recordDelivery(peerId, success, latency = 0) {
    if (!this.peerStats[peerId]) {
      this.peerStats[peerId] = {
        successes: 0,
        failures: 0,
        totalLatency: 0,
        avgLatency: 0,
      };
    }

    const stats = this.peerStats[peerId];
    if (success) {
      stats.successes++;
      stats.totalLatency += latency;
      stats.avgLatency = stats.totalLatency / stats.successes;
    } else {
      stats.failures++;
    }

    console.log(`[RouterAI] Updated stats for ${peerId}: ${stats.successes}/${stats.successes + stats.failures}`);
  }

  // Get reliability score for peer (0-1)
  getReliability(peerId) {
    const stats = this.peerStats[peerId];
    if (!stats || (stats.successes + stats.failures) === 0) {
      return 0.5; // Neutral
    }
    return stats.successes / (stats.successes + stats.failures);
  }

  // Recommend best peer for message delivery
  selectBestPeer(availablePeers) {
    if (!availablePeers || availablePeers.length === 0) {
      return null;
    }

    let bestPeer = null;
    let bestScore = -1;

    for (const peer of availablePeers) {
      const reliability = this.getReliability(peer.id);
      const latencyScore = peer.avgLatency ? 1 / (peer.avgLatency + 1) : 0.5;
      const score = reliability * 0.7 + latencyScore * 0.3;

      if (score > bestScore) {
        bestScore = score;
        bestPeer = peer;
      }
    }

    return bestPeer;
  }

  // Get all peer statistics
  getAllStats() {
    return this.peerStats;
  }
}

module.exports = new RouterAI();

