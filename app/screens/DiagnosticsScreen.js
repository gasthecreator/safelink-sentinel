// app/screens/DiagnosticsScreen.js
// Live status of the mesh stack plus the recent log, with a Share button.
// Exists because iOS Release builds show no console: when a device test fails,
// this screen is the only way to see why.

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import NodeDiscovery from "../services/mesh/NodeDiscovery";
import Outbox from "../services/mesh/Outbox";
import BlePeripheral from "../services/ble/BlePeripheral";
import IdentityManager from "../services/crypto/IdentityManager";
import { isSecure } from "../services/crypto/SecureStore";
import {
  getEntries,
  subscribe,
  clearEntries,
  formatEntry,
  toText,
} from "../services/diagnostics/LogBuffer";
import { t, N_ } from "../services/i18n/i18n";
import { useLanguage } from "../services/i18n/LanguageStore";

// small buttons stay easy to hit: the touch area is 10 points bigger on every side
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

const yesNo = (value) => (value ? N_("yes") : N_("no"));

async function collectStatus() {
  const peers = NodeDiscovery.getPeers();
  const stats = Outbox.getStats();
  let deviceId = "unavailable";
  try {
    deviceId = (await IdentityManager.getDeviceId()).slice(0, 12);
  } catch {}
  return [
    [N_("Platform"), `${Platform.OS} ${Platform.Version}`],
    [N_("Device ID"), deviceId],
    [N_("Keys in secure storage"), yesNo(isSecure)],
    [N_("BLE stack present"), yesNo(NodeDiscovery.bleAvailable)],
    [N_("Bluetooth ready (permissions + powered on)"), yesNo(NodeDiscovery.ready)],
    [N_("Scanning now"), yesNo(NodeDiscovery.scanning)],
    [N_("Peripheral module linked"), yesNo(BlePeripheral.linked)],
    [
      N_("Advertising"),
      `${BlePeripheral.state}${BlePeripheral.detail ? ` (${BlePeripheral.detail})` : ""}`,
    ],
    [N_("Nearby devices"), String(peers.length)],
    ...peers.map((p) => [`  ${p.name}`, `${p.id.slice(0, 8)}  ${p.rssi} dBm`]),
    [N_("Messages waiting for someone in range"), String(stats.ownWaiting)],
    [N_("Messages delivered to at least one device"), String(stats.ownDelivered)],
    [N_("Messages being relayed for others"), String(stats.relaying)],
  ];
}

export default function DiagnosticsScreen() {
  useLanguage(); // re-render in the new language when it is changed
  const navigation = useNavigation();
  const [status, setStatus] = useState([]);
  const [lines, setLines] = useState(() => getEntries().slice(-300));

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const next = await collectStatus();
      if (alive) setStatus(next);
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    const unsubscribe = subscribe(() => setLines(getEntries().slice(-300)));
    return () => {
      alive = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  const shareLogs = useCallback(async () => {
    const header = status.map(([k, v]) => `${k}: ${v}`).join("\n");
    try {
      await Share.share({ message: `${header}\n\n--- log ---\n${toText()}` });
    } catch {}
  }, [status]);

  return (
    <View style={styles.container}>
      <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" onPress={() => navigation.goBack()}>
        <Text style={styles.back}>{t("← Back")}</Text>
      </TouchableOpacity>
      <Text accessibilityRole="header" style={styles.title}>{t("Diagnostics")}</Text>

      <View style={styles.card}>
        {status.map(([label, value], i) => (
          <View key={`${label}-${i}`} style={styles.row}>
            <Text style={styles.label}>{t(label)}</Text>
            <Text style={styles.value}>{t(value)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" style={styles.button} onPress={shareLogs}>
          <Text style={styles.buttonText}>{t("Share status and log")}</Text>
        </TouchableOpacity>
        <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" style={[styles.button, styles.secondary]} onPress={clearEntries}>
          <Text style={[styles.buttonText, styles.secondaryText]}>{t("Clear log")}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.log} contentContainerStyle={{ padding: 10 }}>
        {lines.length === 0 ? (
          <Text style={styles.logEmpty}>{t("No log lines yet.")}</Text>
        ) : (
          lines.map((entry, i) => (
            <Text
              key={`${entry.time}-${i}`}
              style={[
                styles.logLine,
                entry.level === "error" && styles.logError,
                entry.level === "warn" && styles.logWarn,
              ]}
            >
              {formatEntry(entry)}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC", paddingTop: 56, paddingHorizontal: 16 },
  back: { color: "#2563EB", fontSize: 16, fontWeight: "600", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#0F172A", marginBottom: 10 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  label: { color: "#475569", fontSize: 13, flex: 1, paddingRight: 8 },
  value: { color: "#0F172A", fontSize: 13, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  buttons: { flexDirection: "row", marginBottom: 10 },
  button: {
    backgroundColor: "#047857",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  secondary: { backgroundColor: "#E2E8F0" },
  buttonText: { color: "#fff", fontWeight: "700" },
  secondaryText: { color: "#0F172A" },
  log: { flex: 1, backgroundColor: "#0B1220", borderRadius: 10, marginBottom: 20 },
  logLine: { color: "#CBD5E1", fontSize: 10.5, fontFamily: MONO, marginBottom: 2 },
  logWarn: { color: "#FBBF24" },
  logError: { color: "#F87171" },
  logEmpty: { color: "#94A3B8", fontSize: 12 },
});
