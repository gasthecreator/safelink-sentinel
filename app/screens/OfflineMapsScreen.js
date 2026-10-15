// app/screens/OfflineMapsScreen.js
// Download offline map packs while there is internet, so directions work later without it.
// The list of maps is signed; every download is checked against it before it is used.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import PackStore from "../services/maps/PackStore";
import { fetchCatalog, describeCatalog } from "../services/maps/MapCatalog";
import { listPacks } from "../services/navigation/packs";
import { MAP_CATALOG_PUBLIC_KEY, CONFIRM_DOWNLOAD_ABOVE_BYTES } from "../constants/maps";

const mb = (bytes) => (bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

export default function OfflineMapsScreen() {
  const navigation = useNavigation();
  const [installed, setInstalled] = useState([]);
  const [bundled, setBundled] = useState([]);
  const [free, setFree] = useState(null);
  const [offers, setOffers] = useState(null); // null = not checked yet
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null); // { id, bytes, total }
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const list = await PackStore.installed();
    if (!mounted.current) return;
    setInstalled(list);
    setFree(await PackStore.freeBytes());
    const all = await listPacks();
    if (mounted.current) setBundled(all.filter((p) => p.bundled));
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh().catch((e) => setError(e.message));
    // look for maps and updates when the screen opens (the only time the app contacts the map server on its own)
    if (MAP_CATALOG_PUBLIC_KEY) check(true);
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const check = async (quiet = false) => {
    setChecking(true);
    setError(null);
    try {
      const catalog = await fetchCatalog(PackStore);
      setOffers(describeCatalog(catalog, await PackStore.installed()));
    } catch (err) {
      // opening the screen with no internet is normal, not an error worth shouting about
      setError(quiet ? `Could not check for maps right now (${err.message}) Tap "Check for maps" to try again.` : err.message);
    } finally {
      if (mounted.current) setChecking(false);
    }
  };

  const download = async (entry) => {
    setError(null);
    setActive({ id: entry.id, bytes: 0, total: entry.sizeBytes });
    try {
      await PackStore.install(entry, {
        onProgress: (p) => mounted.current && setActive({ id: entry.id, bytes: p.bytes, total: entry.sizeBytes }),
      });
      if (mounted.current) setOffers(describeCatalog({ packs: offers.map((o) => o.entry) }, await PackStore.installed()));
    } catch (err) {
      if (err.code !== "cancelled") setError(err.message);
    } finally {
      if (mounted.current) {
        setActive(null);
        refresh().catch(() => {});
      }
    }
  };

  const askDownload = (entry) => {
    if (entry.sizeBytes < CONFIRM_DOWNLOAD_ABOVE_BYTES) return download(entry);
    Alert.alert(`Download ${entry.name}?`, `This is ${mb(entry.sizeBytes)}. Wi-Fi is best if mobile data is limited.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Download", onPress: () => download(entry) },
    ]);
    return undefined;
  };

  const askRemove = (e) =>
    Alert.alert(`Delete ${e.name}?`, "Directions in this area will not work offline until you download it again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { await PackStore.remove(e.id); refresh(); } },
    ]);

  const enabled = !!MAP_CATALOG_PUBLIC_KEY;
  const busy = active !== null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Offline maps</Text>
      <Text style={styles.intro}>
        Download maps while you have internet. Later, directions to someone who sent an alert work with no signal at all.
      </Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>On this phone</Text>
        {installed.length === 0 && bundled.length === 0 ? <Text style={styles.empty}>No maps yet.</Text> : null}
        {bundled.map((b) => (
          <View key={b.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{b.name}</Text>
              <Text style={styles.meta}>Built into the app</Text>
            </View>
          </View>
        ))}
        {installed.map((e) => (
          <View key={e.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{e.name}</Text>
              <Text style={styles.meta}>{mb(e.sizeBytes)} · version {e.version}</Text>
              <Text style={styles.meta}>{e.attribution}</Text>
            </View>
            <TouchableOpacity disabled={busy} onPress={() => askRemove(e)}>
              <Text style={[styles.link, { color: "#DC2626" }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        ))}
        {free !== null ? <Text style={styles.meta}>Free space on this phone: {mb(free)}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Available to download</Text>
        {!enabled ? (
          <Text style={styles.empty}>Map downloads are not set up in this version of the app yet.</Text>
        ) : (
          <>
            <TouchableOpacity style={[styles.button, (checking || busy) && styles.disabled]} disabled={checking || busy} onPress={() => check(false)}>
              {checking ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{offers ? "Check again" : "Check for maps"}</Text>}
            </TouchableOpacity>
            {offers && offers.length === 0 ? <Text style={styles.empty}>No maps are listed right now.</Text> : null}
            {(offers || []).map(({ entry, status }) => {
              const mine = active && active.id === entry.id;
              return (
                <View key={entry.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{entry.name}</Text>
                    <Text style={styles.meta}>{mb(entry.sizeBytes)} · version {entry.version}</Text>
                    {mine ? (
                      <Text style={styles.meta}>
                        Downloading… {active.total ? Math.min(100, Math.round((active.bytes / active.total) * 100)) : 0}%
                      </Text>
                    ) : null}
                  </View>
                  {mine ? (
                    <TouchableOpacity onPress={() => PackStore.cancel()}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
                  ) : status === "installed" ? (
                    <Text style={styles.meta}>Installed</Text>
                  ) : (
                    <TouchableOpacity disabled={busy} onPress={() => askDownload(entry)}>
                      <Text style={[styles.link, busy && styles.disabled]}>{status === "update" ? "Update" : "Download"}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <Text style={styles.footnote}>
        Map data © OpenStreetMap contributors (ODbL). Each map is checked against a signed list before it is used.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC", paddingTop: 56, paddingHorizontal: 16 },
  back: { color: "#3B82F6", fontSize: 16, fontWeight: "600", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#0F172A", marginBottom: 6 },
  intro: { color: "#475569", fontSize: 14, lineHeight: 20, marginBottom: 14 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 8 },
  empty: { color: "#64748B", fontSize: 14, marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E2E8F0", marginTop: 8 },
  name: { fontSize: 15, fontWeight: "600", color: "#0F172A" },
  meta: { color: "#64748B", fontSize: 12, marginTop: 2 },
  link: { color: "#3B82F6", fontWeight: "700", fontSize: 15, paddingLeft: 12 },
  button: { backgroundColor: "#10B981", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  disabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  error: { marginTop: 12, color: "#B91C1C", fontSize: 13, lineHeight: 18 },
  footnote: { color: "#64748B", fontSize: 12, lineHeight: 17 },
});
