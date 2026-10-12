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

const yesNo = (value) => (value ? "yes" : "no");

async function collectStatus() {
  const peers = NodeDiscovery.getPeers();
  const stats = Outbox.getStats();
  let deviceId = "unavailable";
  try {
    deviceId = (await IdentityManager.getDeviceId()).slice(0, 12);
  } catch {}
  return [
    ["Platform", `${Platform.OS} ${Platform.Version}`],
    ["Device ID", deviceId],
    ["Keys in secure storage", yesNo(isSecure)],
    ["BLE stack present", yesNo(NodeDiscovery.bleAvailable)],
    ["Bluetooth ready (permissions + powered on)", yesNo(NodeDiscovery.ready)],
    ["Scanning now", yesNo(NodeDiscovery.scanning)],
    ["Peripheral module linked", yesNo(BlePeripheral.linked)],
    [
      "Advertising",
      `${BlePeripheral.state}${BlePeripheral.detail ? ` (${BlePeripheral.detail})` : ""}`,
    ],
    ["Nearby devices", String(peers.length)],
    ...peers.map((p) => [`  ${p.name}`, `${p.id.slice(0, 8)}  ${p.rssi} dBm`]),
    ["Messages waiting for someone in range", String(stats.ownWaiting)],
    ["Messages delivered to at least one device", String(stats.ownDelivered)],
    ["Messages being relayed for others", String(stats.relaying)],
  ];
}

export default function DiagnosticsScreen() {
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
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Diagnostics</Text>

      <View style={styles.card}>
        {status.map(([label, value], i) => (
          <View key={`${label}-${i}`} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.button} onPress={shareLogs}>
          <Text style={styles.buttonText}>Share status + log</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.secondary]} onPress={clearEntries}>
          <Text style={[styles.buttonText, styles.secondaryText]}>Clear log</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.log} contentContainerStyle={{ padding: 10 }}>
        {lines.length === 0 ? (
          <Text style={styles.logEmpty}>No log lines yet.</Text>
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
  back: { color: "#3B82F6", fontSize: 16, fontWeight: "600", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#0F172A", marginBottom: 10 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  label: { color: "#475569", fontSize: 13, flex: 1, paddingRight: 8 },
  value: { color: "#0F172A", fontSize: 13, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  buttons: { flexDirection: "row", marginBottom: 10 },
  button: {
    backgroundColor: "#10B981",
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
