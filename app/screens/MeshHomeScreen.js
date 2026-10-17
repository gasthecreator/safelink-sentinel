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
import Outbox from "../services/mesh/Outbox";
import { describePosition } from "../services/location/position";
import { t, N_ } from "../services/i18n/i18n";
import { useLanguage } from "../services/i18n/LanguageStore";

const PRIORITY_WORDS = { critical: N_("critical"), high: N_("high"), normal: N_("normal"), low: N_("low") };

// small buttons stay easy to hit: the touch area is 10 points bigger on every side
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };
// Footer links wrap onto several rows (more so in longer languages): vertical slop would make neighbouring rows overlap,
// so each link carries its own vertical padding and only extends sideways.
const LINK_SLOP = { top: 0, bottom: 0, left: 10, right: 10 };

// Where the sender is: their own words first, then the coordinates if they shared any.
function describeWhere(alert) {
  const position = describePosition(alert.location);
  if (alert.where && position) return `${alert.where} (${position.coords})`;
  return alert.where || position?.text || null;
}

// "5 min ago"-style label; falls back to "Just now" when there is no usable time.
function formatTime(value) {
  const ms = value ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) return t("Just now");
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) return t("Just now");
  if (minutes < 60) return t("{minutes} min ago", { minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? t("{hours} h ago", { hours }) : t("{days} d ago", { days: Math.floor(hours / 24) });
}

export default function MeshHomeScreen({ navigation }) {
  useLanguage(); // re-render in the new language when it is changed
  const [peers, setPeers] = useState([]);
  const [health, setHealth] = useState({ reliabilityScore: "Critical", successRate: 0 });
  const [offlineModal, setOfflineModal] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [waitingCount, setWaitingCount] = useState(0);
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
            successRate: healthData.successRate ?? 0,
          });
        }

        // Load initial alerts
        const reliefRequests = await MeshManager.getAlertFeed();
        if (reliefRequests && Array.isArray(reliefRequests)) {
          setAlerts(reliefRequests);
        }

        // Start peer discovery
        startPeerDiscovery();
      } catch (error) {
        console.error("[MeshHomeScreen] Initialization error:", error);
        // Fallback to simulation mode for web/emulator
        if (!NodeDiscovery.bleAvailable && (Platform.OS === "web" || __DEV__)) {
          console.log("[MeshHomeScreen] No BLE stack - using simulation mode...");
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
      
      // Fallback to simulation (only when there is no BLE stack at all)
      if (__DEV__ && !NodeDiscovery.bleAvailable) {
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
            successRate: healthData.successRate ?? 0,
          });
        }
      });

      // Messages we sent that no one has received yet
      setWaitingCount(Outbox.getStats().ownWaiting);

      // Update alerts
      MeshManager.getAlertFeed().then((reliefRequests) => {
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
      title: alert.title || alert.message || t("Alert"),
      description: alert.description || alert.body || alert.message || "",
      address: alert.address || alert.locationLabel || describeWhere(alert),
      location: alert.location || (alert.latitude && alert.longitude ? {
        latitude: alert.latitude,
        longitude: alert.longitude,
      } : null),
      priority: alert.priority || "normal",
      time: alert.time || formatTime(alert.timestamp || alert.updatedAt || alert.createdAt),
      reliefId: alert.reliefId || null,
      where: alert.where || null,
      // Who to look for with the Bluetooth finder; only alerts from other phones have one.
      senderId: alert.remote ? alert.senderId || alert.requesterId || null : null,
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
            <Text style={styles.appName}>{t("SafeLink Mesh")}</Text>
            <Text style={styles.appSubtitle}>{t("Offline lifeline for your community")}</Text>
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

          {waitingCount > 0 && (
            <Text style={styles.waitingText}>
              {waitingCount} message{waitingCount === 1 ? "" : "s"} waiting. Will send automatically
              when a device comes into range.
            </Text>
          )}

          <View style={styles.quickActions}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t("Quick actions")}</Text>
            
            <Animatable.View animation="fadeInUp" delay={300} duration={800}>
              <View style={styles.actionsRow}>
                <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button"
                  style={[styles.actionCard, styles.actionPrimary]}
                  onPress={handleRequestHelp}
                >
                  <Text style={styles.actionIcon}>🆘</Text>
                  <Text style={styles.actionTitle}>{t("Request help")}</Text>
                  <Text style={styles.actionText}>
                    {t("Send a distress message with your location.")}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button"
                  style={styles.actionCard}
                  onPress={handleSendUpdate}
                >
                  <Text style={styles.actionIcon}>✅</Text>
                  <Text style={styles.actionTitle}>{t("Status update")}</Text>
                  <Text style={styles.actionText}>
                    {t("Let others know you're safe or available to help.")}
                  </Text>
                </TouchableOpacity>
              </View>
            </Animatable.View>

            <Animatable.View animation="fadeInUp" delay={600} duration={800}>
              <View style={styles.actionsRow}>
                <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button"
                  style={styles.actionCardSmall}
                  onPress={handleViewPeers}
                >
                  <Text style={styles.smallTitle}>{t("Nearby devices")}</Text>
                  <Text style={styles.smallText}>{t("{count} connected", { count: peers.length })}</Text>
                </TouchableOpacity>

                <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button"
                  style={styles.actionCardSmall}
                  onPress={handleStressTest}
                >
                  <Text style={styles.smallTitle}>{t("Stress test")}</Text>
                  <Text style={styles.smallText}>{t("Check mesh performance")}</Text>
                </TouchableOpacity>
              </View>
            </Animatable.View>
          </View>

          <NearbyDevices peers={peers} />

          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t("Active alerts & requests")}</Text>
            
            {alerts.length === 0 ? (
              <View style={styles.emptyAlerts}>
                <Text style={styles.emptyText}>{t("No active alerts yet.")}</Text>
                <Text style={styles.emptySubtext}>
                  {t("Send a message or relief request to get started.")}
                </Text>
              </View>
            ) : (
              alerts.slice(0, 10).map((alert) => {
                const formatted = formatAlert(alert);
                if (!formatted) return null;
                
                return (
                  <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button"
                    accessibilityLabel={[
                      t("{priority} priority.", { priority: t(PRIORITY_WORDS[formatted.priority] || PRIORITY_WORDS.normal) }),
                      `${formatted.title}.`,
                      formatted.description || "",
                      formatted.address ? t("Where: {address}.", { address: formatted.address }) : "",
                      formatted.time || "",
                    ].filter(Boolean).join(" ")}
                    accessibilityHint={t("Opens the alert")}
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
                <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel={t("Example alert: medical support needed")}
                  onPress={() =>
                    navigation.navigate("AlertDetail", {
                      alert: {
                        id: "alert-medical-001",
                        title: t("Medical support needed"),
                        description: t("Field clinic in Zone A requires bandages, antibiotics and clean water."),
                        address: t("Zone A camp"),
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
                    title={t("Medical support needed")}
                    body={t("Field clinic in Zone A requires bandages, antibiotics and clean water.")}
                    priority="critical"
                    locationLabel={t("Zone A camp • ~2.3 km")}
                    address={t("Zone A camp")}
                    time={t("2 min ago")}
                  />
                </TouchableOpacity>
                
                <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel={t("Example alert: water needed")}
                  onPress={() =>
                    navigation.navigate("AlertDetail", {
                      alert: {
                        id: "alert-water-001",
                        title: t("Water distribution point"),
                        description: t("Clean water available near the old market for the next 3 hours."),
                        address: t("Old market"),
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
                    title={t("Water distribution point")}
                    body={t("Clean water available near the old market for the next 3 hours.")}
                    priority="normal"
                    locationLabel={t("Old market • ~1.1 km")}
                    address={t("Old market")}
                    time={t("12 min ago")}
                  />
                </TouchableOpacity>
              </>
            )}
          </View>
          <View style={styles.footerLinks}>
            <TouchableOpacity hitSlop={LINK_SLOP} style={styles.footerLink} accessibilityRole="button" onPress={() => navigation.navigate("Nearby")}>
              <Text style={styles.diagnosticsLink}>{t("Find help nearby")}</Text>
            </TouchableOpacity>
            <TouchableOpacity hitSlop={LINK_SLOP} style={styles.footerLink} accessibilityRole="button" onPress={() => navigation.navigate("ReportRoad")}>
              <Text style={styles.diagnosticsLink}>{t("Report a road")}</Text>
            </TouchableOpacity>
            <TouchableOpacity hitSlop={LINK_SLOP} style={styles.footerLink} accessibilityRole="button" onPress={() => navigation.navigate("Places")}>
              <Text style={styles.diagnosticsLink}>{t("Saved places")}</Text>
            </TouchableOpacity>
            <TouchableOpacity hitSlop={LINK_SLOP} style={styles.footerLink} accessibilityRole="button" onPress={() => navigation.navigate("OfflineMaps")}>
              <Text style={styles.diagnosticsLink}>{t("Offline maps")}</Text>
            </TouchableOpacity>
            <TouchableOpacity hitSlop={LINK_SLOP} style={styles.footerLink} accessibilityRole="button" onPress={() => navigation.navigate("Settings")}>
              <Text style={styles.diagnosticsLink}>{t("Settings")}</Text>
            </TouchableOpacity>
            <TouchableOpacity hitSlop={LINK_SLOP} style={styles.footerLink} accessibilityRole="button" onPress={() => navigation.navigate("Diagnostics")}>
              <Text style={styles.diagnosticsLink}>{t("Diagnostics")}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  waitingText: {
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    fontSize: 13,
  },
  footerLinks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", marginTop: 24 },
  footerLink: { paddingVertical: 12 },
  diagnosticsLink: {
    color: "#64748B",
    textAlign: "center",
    fontSize: 13,
    marginHorizontal: 14,
    textDecorationLine: "underline",
  },
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

