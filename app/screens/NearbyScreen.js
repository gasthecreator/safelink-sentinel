// app/screens/NearbyScreen.js
// "Find help nearby": the nearest hospital, clinic, pharmacy, fire station, police, shelter, assembly
// point or drinking water, taken from the offline map on this phone (no internet). Tapping one opens
// directions to it.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { getPositionForAlert } from "../services/location/LocationService";
import { listPlaces } from "../services/location/PlaceStore";
import { sanitizePosition } from "../services/location/position";
import { findPackFor } from "../services/navigation/packs";
import { placeKinds, nearestPlaces } from "../services/navigation/places";
import { formatDistance } from "../services/units/units";
import { useUnits } from "../services/units/UnitStore";

export default function NearbyScreen() {
  const navigation = useNavigation();
  useUnits(); // re-render if the units setting changes
  const [position, setPosition] = useState(null);
  const [locating, setLocating] = useState(true);
  const [saved, setSaved] = useState([]);
  const [pack, setPack] = useState(undefined); // undefined = looking, null = none covers you
  const [kind, setKind] = useState(null);

  const locate = useCallback(async () => {
    setLocating(true);
    const fix = await getPositionForAlert();
    setPosition(fix.position);
    setLocating(false);
  }, []);

  useEffect(() => {
    locate();
    listPlaces().then(setSaved).catch(() => {});
  }, [locate]);

  useEffect(() => {
    if (!position) {
      setPack(undefined);
      return;
    }
    let live = true;
    findPackFor([position]).then((r) => live && setPack(r.pack));
    return () => {
      live = false;
    };
  }, [position]);

  const kinds = useMemo(() => (pack ? placeKinds(pack) : []), [pack]);
  useEffect(() => {
    if (kinds.length && !kinds.some((k) => k.kind === kind)) setKind(kinds[0].kind);
  }, [kinds, kind]);
  const results = useMemo(() => (pack && position && kind ? nearestPlaces(pack, position, kind, { limit: 6 }) : []), [pack, position, kind]);

  const go = (place) =>
    navigation.navigate("Navigation", {
      alert: {
        id: `place-${place.kind}-${place.latitude}-${place.longitude}`,
        title: place.name,
        subtitle: place.label,
        location: sanitizePosition({ latitude: place.latitude, longitude: place.longitude, accuracyM: 25, source: "place", label: place.name }),
      },
    });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <TouchableOpacity onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back">
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Find help nearby</Text>
      <Text style={styles.intro}>The nearest places from the offline map on this phone. No internet needed.</Text>

      {locating ? (
        <View style={styles.card}>
          <ActivityIndicator />
          <Text style={styles.meta}>Getting your position...</Text>
        </View>
      ) : !position ? (
        <View style={styles.card}>
          <Text style={styles.name}>No position yet</Text>
          <Text style={styles.meta}>GPS has no fix (indoors?) or location is off. Try again, or start from a saved place.</Text>
          <TouchableOpacity style={styles.button} onPress={locate} accessibilityRole="button">
            <Text style={styles.buttonText}>Try GPS again</Text>
          </TouchableOpacity>
          {saved.map((p) => (
            <TouchableOpacity key={p.id} style={styles.row} onPress={() => setPosition(sanitizePosition(p))} accessibilityRole="button">
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.link}>Use</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : pack === undefined ? (
        <View style={styles.card}><ActivityIndicator /></View>
      ) : pack === null ? (
        <View style={styles.card}>
          <Text style={styles.name}>No offline map for where you are</Text>
          <Text style={styles.meta}>Download one while you have internet, and this will work without it.</Text>
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate("OfflineMaps")} accessibilityRole="button">
            <Text style={styles.buttonText}>Get offline maps</Text>
          </TouchableOpacity>
        </View>
      ) : kinds.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.name}>This map has no places in it</Text>
          <Text style={styles.meta}>
            "{pack.name}" was made before places were included. Download an updated map to find hospitals, shelters and water.
          </Text>
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate("OfflineMaps")} accessibilityRole="button">
            <Text style={styles.buttonText}>Get offline maps</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.chips}>
            {kinds.map((k) => (
              <TouchableOpacity
                key={k.kind}
                style={[styles.chip, kind === k.kind && styles.chipActive]}
                onPress={() => setKind(k.kind)}
                accessibilityRole="button"
                accessibilityState={{ selected: kind === k.kind }}
                accessibilityLabel={`${k.plural}, ${k.count} in this map`}
              >
                <Text style={[styles.chipText, kind === k.kind && styles.chipTextActive]}>{k.plural} ({k.count})</Text>
              </TouchableOpacity>
            ))}
          </View>
          {results.map((p, i) => (
            <TouchableOpacity
              key={`${p.latitude},${p.longitude},${i}`}
              style={styles.card}
              onPress={() => go(p)}
              accessibilityRole="button"
              accessibilityLabel={`${p.name}, ${formatDistance(p.distanceM)} to the ${p.direction}. Get directions.`}
            >
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.meta}>
                {p.label} · {formatDistance(p.distanceM)} {p.direction}
              </Text>
              <Text style={styles.link}>Get directions ›</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.footnote}>
            Distances are in a straight line. Places come from OpenStreetMap, which volunteers keep up to date: a place may
            have closed or be missing, so call or check if you can. {pack.attribution}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC", paddingTop: 56, paddingHorizontal: 16 },
  back: { color: "#3B82F6", fontSize: 16, fontWeight: "600", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#0F172A", marginBottom: 6 },
  intro: { color: "#475569", fontSize: 14, lineHeight: 20, marginBottom: 14 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E2E8F0", marginTop: 8 },
  name: { fontSize: 16, fontWeight: "700", color: "#0F172A" },
  meta: { color: "#64748B", fontSize: 13, lineHeight: 18, marginTop: 4 },
  link: { color: "#3B82F6", fontWeight: "700", fontSize: 14, marginTop: 8 },
  button: { backgroundColor: "#10B981", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, marginBottom: 8, backgroundColor: "#fff" },
  chipActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  chipText: { color: "#334155", fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  footnote: { color: "#64748B", fontSize: 12, lineHeight: 17, marginTop: 4 },
});
