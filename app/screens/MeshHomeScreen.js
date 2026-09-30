// app/screens/MeshHomeScreen.js
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  SafeAreaView,
  Platform,
} from "react-native";
import * as Animatable from "react-native-animatable";
import LinearGradient from "react-native-linear-gradient";
import ConnectionStatus from "../components/ConnectionStatus";
import NearbyDevices from "../components/NearbyDevices";
import MessageCard from "../components/MessageCard";
import OfflineSyncModal from "../components/OfflineSyncModal";
import MeshManager from "../services/mesh/MeshManager";
import NodeDiscovery from "../services/mesh/NodeDiscovery";

export default function MeshHomeScreen({ navigation }) {
  const [peers, setPeers] = useState([]);
  const [health, setHealth] = useState({ reliabilityScore: "Good", successRate: 94 });
  const [offlineModal, setOfflineModal] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [alerts, setAlerts] = useState([]);
  const [isScanning, setIsScanning] = useState(false);

  const handleRequestHelp = () => {
    navigation.navigate("SendMessage", { mode: "relief" });
  };

  const handleSendUpdate = () => {
    navigation.navigate("SendMessage", { mode: "status" });
  };

  const handleViewPeers = () => {
    navigation.navigate("PeerList");
  };

  const handleStressTest = () => {
    navigation.navigate("StressTest");
  };

  // Initialize mesh networking
  useEffect(() => {
    const initializeMesh = async () => {
      try {
        console.log("[MeshHomeScreen] Initializing mesh network...");
        await MeshManager.init();
        
        // Load initial health data
        const healthData = await MeshManager.getHealthSnapshot();
        if (healthData) {
          setHealth({
            reliabilityScore: healthData.reliabilityScore || "Good",
            successRate: healthData.successRate || 94,
          });
        }

        // Load initial alerts
        const reliefRequests = await MeshManager.getOpenReliefRequests();
        if (reliefRequests && Array.isArray(reliefRequests)) {
          setAlerts(reliefRequests);
        }

        // Start peer discovery
        startPeerDiscovery();
      } catch (error) {
        console.error("[MeshHomeScreen] Initialization error:", error);
        // Fallback to simulation mode for web/emulator
        if (Platform.OS === "web" || __DEV__) {
          console.log("[MeshHomeScreen] Using simulation mode...");
          const simulatedPeers = await NodeDiscovery.simulateDiscovery?.();
          if (simulatedPeers) {
            setPeers(simulatedPeers);
          }
        }
      }
    };

    initializeMesh();
  }, []);

  // Start peer discovery
  const startPeerDiscovery = async () => {
    try {
      setIsScanning(true);
      
      // Try real discovery first
      if (Platform.OS !== "web") {
        await NodeDiscovery.startDiscovery();
        
        // Set up listener for new peers
        NodeDiscovery.onPeerDiscovered?.((peer) => {
          setPeers((prev) => {
            const exists = prev.find((p) => p.id === peer.id);
            if (!exists) {
              return [...prev, peer];
            }
            return prev;
          });
        });
      } else {
        // Simulation mode for web
        const simulatedPeers = await NodeDiscovery.simulateDiscovery?.();
        if (simulatedPeers) {
          setPeers(simulatedPeers);
        }
      }

      // Update peers from cache
      const currentPeers = MeshManager.getPeers();
      if (currentPeers && currentPeers.length > 0) {
        setPeers(currentPeers);
      }

      setIsScanning(false);
    } catch (error) {
      console.error("[MeshHomeScreen] Discovery error:", error);
      setIsScanning(false);
      
      // Fallback to simulation
      if (__DEV__) {
        const simulatedPeers = await NodeDiscovery.simulateDiscovery?.();
        if (simulatedPeers) {
          setPeers(simulatedPeers);
        }
      }
    }
  };

  // Refresh peers periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const currentPeers = MeshManager.getPeers();
      if (currentPeers) {
        setPeers(currentPeers);
      }
      
      // Update health
      MeshManager.getHealthSnapshot().then((healthData) => {
        if (healthData) {
          setHealth({
            reliabilityScore: healthData.reliabilityScore || "Good",
            successRate: healthData.successRate || 94,
          });
        }
      });

      // Update alerts
      MeshManager.getOpenReliefRequests().then((reliefRequests) => {
        if (reliefRequests && Array.isArray(reliefRequests)) {
          setAlerts(reliefRequests);
        }
      });
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, []);

  // Format alert for display
  const formatAlert = (alert) => {
    if (!alert) return null;
    
    return {
      id: alert.id || `alert-${Date.now()}`,
      title: alert.title || alert.message || "Alert",
      description: alert.description || alert.body || alert.message || "",
      address: alert.address || alert.locationLabel || "Location unknown",
      location: alert.location || (alert.latitude && alert.longitude ? {
        latitude: alert.latitude,
        longitude: alert.longitude,
      } : null),
      priority: alert.priority || "normal",
      time: alert.time || alert.timestamp || "Just now",
      reliefId: alert.reliefId || null,
    };
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={["#F8FAFC", "#E0E7FF"]}
        style={styles.container}
      >
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
        <OfflineSyncModal visible={offlineModal} queuedCount={queuedCount} />
        
        <View style={styles.header}>
          <View>
            <Text style={styles.appName}>SafeLink Mesh</Text>
            <Text style={styles.appSubtitle}>Offline lifeline for your community</Text>
          </View>
          <Animatable.Text
            animation="pulse"
            easing="ease-in-out"
            iterationCount="infinite"
            duration={1800}
            style={styles.logo}
          >
            🔗
          </Animatable.Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          <ConnectionStatus health={health} peersCount={peers.length} />

          <View style={styles.quickActions}>
            <Text style={styles.sectionTitle}>Quick actions</Text>
            
            <Animatable.View animation="fadeInUp" delay={300} duration={800}>
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionCard, styles.actionPrimary]}
                  onPress={handleRequestHelp}
                >
                  <Text style={styles.actionIcon}>🆘</Text>
                  <Text style={styles.actionTitle}>Request help</Text>
                  <Text style={styles.actionText}>
                    Send a distress message with your location.
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionCard}
                  onPress={handleSendUpdate}
                >
                  <Text style={styles.actionIcon}>✅</Text>
                  <Text style={styles.actionTitle}>Status update</Text>
                  <Text style={styles.actionText}>
                    Let others know you're safe or available to help.
                  </Text>
                </TouchableOpacity>
              </View>
            </Animatable.View>

            <Animatable.View animation="fadeInUp" delay={600} duration={800}>
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.actionCardSmall}
                  onPress={handleViewPeers}
                >
                  <Text style={styles.smallTitle}>Nearby devices</Text>
                  <Text style={styles.smallText}>{peers.length} connected</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionCardSmall}
                  onPress={handleStressTest}
                >
                  <Text style={styles.smallTitle}>Stress test</Text>
                  <Text style={styles.smallText}>Check mesh performance</Text>
                </TouchableOpacity>
              </View>
            </Animatable.View>
          </View>

          <NearbyDevices peers={peers} />

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active alerts & requests</Text>
            
            {alerts.length === 0 ? (
              <View style={styles.emptyAlerts}>
                <Text style={styles.emptyText}>No active alerts yet.</Text>
                <Text style={styles.emptySubtext}>
                  Send a message or relief request to get started.
                </Text>
              </View>
            ) : (
              alerts.slice(0, 10).map((alert) => {
                const formatted = formatAlert(alert);
                if (!formatted || !formatted.location) return null;
                
                return (
                  <TouchableOpacity
                    key={formatted.id}
                    onPress={() =>
                      navigation.navigate("AlertDetail", {
                        alert: formatted,
                      })
                    }
                  >
                    <MessageCard
                      title={formatted.title}
                      body={formatted.description}
                      priority={formatted.priority}
                      locationLabel={formatted.address}
                      address={formatted.address}
                      time={formatted.time}
                    />
                  </TouchableOpacity>
                );
              })
            )}
            
            {/* Fallback example alerts if no real data */}
            {alerts.length === 0 && __DEV__ && (
              <>
                <TouchableOpacity
                  onPress={() =>
                    navigation.navigate("AlertDetail", {
                      alert: {
                        id: "alert-medical-001",
                        title: "Medical support needed",
                        description: "Field clinic in Zone A requires bandages, antibiotics and clean water.",
                        address: "Zone A camp",
                        location: {
                          latitude: 37.7749,
                          longitude: -122.4194,
                        },
                        priority: "critical",
                        reliefId: null,
                      },
                    })
                  }
                >
                  <MessageCard
                    title="Medical support needed"
                    body="Field clinic in Zone A requires bandages, antibiotics and clean water."
                    priority="critical"
                    locationLabel="Zone A camp • ~2.3 km"
                    address="Zone A camp"
                    time="2 min ago"
                  />
                </TouchableOpacity>
                
                <TouchableOpacity
                  onPress={() =>
                    navigation.navigate("AlertDetail", {
                      alert: {
                        id: "alert-water-001",
                        title: "Water distribution point",
                        description: "Clean water available near the old market for the next 3 hours.",
                        address: "Old market",
                        location: {
                          latitude: 37.7849,
                          longitude: -122.4094,
                        },
                        priority: "normal",
                        reliefId: null,
                      },
                    })
                  }
                >
                  <MessageCard
                    title="Water distribution point"
                    body="Clean water available near the old market for the next 3 hours."
                    priority="normal"
                    locationLabel="Old market • ~1.1 km"
                    address="Old market"
                    time="12 min ago"
                  />
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    paddingTop: 10,
  },
  appName: {
    color: "#1E3A8A",
    fontSize: 24,
    fontWeight: "700",
  },
  appSubtitle: {
    color: "#64748B",
    fontSize: 13,
    marginTop: 3,
  },
  logo: {
    fontSize: 36,
  },
  scroll: {
    flex: 1,
  },
  quickActions: {
    marginTop: 18,
  },
  sectionTitle: {
    color: "#1E293B",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  actionCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginRight: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  actionPrimary: {
    backgroundColor: "#DBEAFE",
    borderWidth: 2,
    borderColor: "#3B82F6",
  },
  actionIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  actionTitle: {
    color: "#1E293B",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  actionText: {
    color: "#64748B",
    fontSize: 12,
    lineHeight: 16,
  },
  actionCardSmall: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    marginRight: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  smallTitle: {
    color: "#1E293B",
    fontSize: 13,
    fontWeight: "600",
  },
  smallText: {
    color: "#64748B",
    fontSize: 11,
    marginTop: 4,
  },
  section: {
    marginTop: 20,
    marginBottom: 20,
  },
  emptyAlerts: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginTop: 8,
  },
  emptyText: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  emptySubtext: {
    color: "#94A3B8",
    fontSize: 12,
    textAlign: "center",
  },
});

