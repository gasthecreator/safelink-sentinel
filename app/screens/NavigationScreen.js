// app/screens/NavigationScreen.js
// Directions to the sender of an alert, worked out on the phone from an offline map pack.
// No internet. Start from GPS, a saved place, or typed coordinates; walk or drive.

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, useWindowDimensions } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import RouteMap from "../components/RouteMap";
import { findPackFor } from "../services/navigation/packs";
import { route as computeRoute } from "../services/navigation/router";
import { formatDistance, formatDuration } from "../services/navigation/mapView";
import { getPositionForAlert } from "../services/location/LocationService";
import { listPlaces } from "../services/location/PlaceStore";
import { parseCoordinates } from "../services/location/places";
import { sanitizePosition, describePosition } from "../services/location/position";

export default function NavigationScreen() {
  const navigation = useNavigation();
  const { alert } = useRoute().params;
  const { width: screenWidth } = useWindowDimensions();
  const mapWidth = Math.min(screenWidth - 40, 420);

  const destination = useMemo(() => sanitizePosition(alert.location), [alert.location]);
  const [mode, setMode] = useState("walk");
  const [source, setSource] = useState("gps"); // gps | place | typed
  const [gps, setGps] = useState({ state: "loading" });
  const [places, setPlaces] = useState([]);
  const [placeId, setPlaceId] = useState(null);
  const [typed, setTyped] = useState("");
  const [typedPoint, setTypedPoint] = useState(null);
  const [typedError, setTypedError] = useState(null);

  const readGps = async () => {
    setGps({ state: "loading" });
    const fix = await getPositionForAlert();
    setGps(fix.position ? { state: "ok", fix } : { state: "none", fix });
  };
  useEffect(() => {
    readGps();
    listPlaces().then(setPlaces).catch(() => {});
  }, []);

  const start = useMemo(() => {
    if (source === "gps") return gps.state === "ok" ? gps.fix.position : null;
    if (source === "place") return sanitizePosition(places.find((p) => p.id === placeId));
    return typedPoint;
  }, [source, gps, places, placeId, typedPoint]);

  const outcome = useMemo(() => {
    if (!destination) return { kind: "no_destination" };
    if (!start) return { kind: "no_start" };
    const { pack, partial } = findPackFor([start, destination]);
    if (!pack) return { kind: "no_pack", partial };
    return { kind: "routed", pack, result: computeRoute(pack, start, destination, { mode }) };
  }, [destination, start, mode]);

  const applyTyped = () => {
    const p = parseCoordinates(typed);
    if (!p) {
      setTypedPoint(null);
      setTypedError('Could not read that. Use decimal degrees like "32.5266, -92.7165".');
      return;
    }
    setTypedError(null);
    setTypedPoint(sanitizePosition(p));
  };

  const result = outcome.kind === "routed" ? outcome.result : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 48 }}>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Directions to {alert.title ? `"${alert.title}"` : "them"}</Text>
      {alert.where ? <Text style={styles.where}>They said: {alert.where}</Text> : null}
      <Text style={styles.note}>
        Worked out on this phone from an offline map, with no internet. It follows the roads in the
        map and cannot know about closures, damage or flooding.
      </Text>

      {!destination ? (
        <Card><Text style={styles.big}>No position to navigate to</Text>
          <Text style={styles.body}>This alert did not include where the sender is. Use their own words above.</Text>
        </Card>
      ) : (
        <>
          <Text style={styles.label}>Start from</Text>
          <View style={styles.row}>
            {[["gps", "GPS"], ["place", "Saved place"], ["typed", "Typed"]].map(([v, l]) => (
              <Chip key={v} label={l} active={source === v} onPress={() => setSource(v)} />
            ))}
          </View>

          {source === "gps" ? (
            <Text style={styles.body}>
              {gps.state === "loading" ? "Getting your position..."
                : gps.state === "ok" ? `Your position: ${describePosition(gps.fix.position).text}${gps.fix.stale ? " (older fix)" : ""}`
                : "No GPS position. Choose a saved place or type coordinates."}
              {gps.state !== "loading" ? "  " : ""}
            </Text>
          ) : null}
          {source === "gps" && gps.state !== "loading" ? (
            <TouchableOpacity onPress={readGps}><Text style={styles.link}>Try GPS again</Text></TouchableOpacity>
          ) : null}

          {source === "place" ? (
            places.length === 0 ? (
              <Text style={styles.body}>No saved places yet. Save one from the home screen's Saved places.</Text>
            ) : (
              places.map((p) => (
                <TouchableOpacity key={p.id} style={[styles.place, p.id === placeId && styles.placeActive]} onPress={() => setPlaceId(p.id)}>
                  <Text style={styles.placeName}>{p.id === placeId ? "● " : "○ "}{p.name}</Text>
                </TouchableOpacity>
              ))
            )
          ) : null}

          {source === "typed" ? (
            <View>
              <TextInput
                style={styles.input}
                value={typed}
                onChangeText={setTyped}
                placeholder="32.5266, -92.7165"
                placeholderTextColor="#64748B"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.button} onPress={applyTyped}><Text style={styles.buttonText}>Use these coordinates</Text></TouchableOpacity>
              {typedError ? <Text style={styles.error}>{typedError}</Text> : null}
            </View>
          ) : null}

          <Text style={styles.label}>Travelling</Text>
          <View style={styles.row}>
            <Chip label="On foot" active={mode === "walk"} onPress={() => setMode("walk")} />
            <Chip label="By car" active={mode === "drive"} onPress={() => setMode("drive")} />
          </View>
        </>
      )}

      {outcome.kind === "no_start" && destination ? (
        <Card><Text style={styles.big}>Where are you starting from?</Text>
          <Text style={styles.body}>Pick a start above to see the route.</Text></Card>
      ) : null}

      {outcome.kind === "no_pack" ? (
        <Card>
          <Text style={styles.big}>No offline map for this area</Text>
          <Text style={styles.body}>
            {outcome.partial
              ? `The "${outcome.partial.name}" map covers only one of the two places. `
              : "None of the maps on this phone cover these places. "}
            Use their position and the Maps button on the alert instead.
          </Text>
        </Card>
      ) : null}

      {result && !result.ok ? (
        <Card><Text style={styles.big}>No route</Text><Text style={styles.body}>{result.message}</Text></Card>
      ) : null}

      {result && result.ok ? (
        <>
          <Card>
            <Text style={styles.big}>{formatDistance(result.distanceM)}</Text>
            <Text style={styles.body}>
              About {formatDuration(result.durationS)} {mode === "walk" ? "on foot" : "by car"} · {outcome.pack.name}
            </Text>
          </Card>
          {result.warnings.map((w) => (
            <Text key={w} style={styles.warn}>{w} The first or last part is off the map.</Text>
          ))}
          <RouteMap graph={outcome.pack} route={result} you={start} them={destination} width={mapWidth} height={300} />
          <Text style={styles.label}>Directions</Text>
          {result.steps.map((s, i) => (
            <View key={i} style={styles.step}>
              <Text style={styles.stepNum}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepText}>{s.text}</Text>
                {s.distanceM > 0 ? <Text style={styles.stepDist}>{formatDistance(s.distanceM)}</Text> : null}
              </View>
            </View>
          ))}
          {alert.senderId ? (
            <TouchableOpacity style={[styles.button, { marginTop: 18 }]} onPress={() => navigation.navigate("Finder", { alert })}>
              <Text style={styles.buttonText}>Close by? Find them by Bluetooth</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.attribution}>Map data {outcome.pack.attribution}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const Card = ({ children }) => <View style={styles.card}>{children}</View>;
const Chip = ({ label, active, onPress }) => (
  <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220", paddingHorizontal: 20, paddingTop: 60 },
  back: { color: "#38BDF8", fontSize: 16, fontWeight: "600", marginBottom: 12 },
  title: { color: "#F8FAFC", fontSize: 22, fontWeight: "800", marginBottom: 6 },
  where: { color: "#F8FAFC", fontSize: 15, fontWeight: "600", marginBottom: 6 },
  note: { color: "#94A3B8", fontSize: 13, lineHeight: 18, marginBottom: 14 },
  label: { color: "#CBD5E1", fontSize: 14, fontWeight: "700", marginTop: 14, marginBottom: 8 },
  row: { flexDirection: "row", flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: "#334155", borderRadius: 18, paddingVertical: 7, paddingHorizontal: 14, marginRight: 8, marginBottom: 6 },
  chipActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  chipText: { color: "#CBD5E1", fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  card: { backgroundColor: "#111C30", borderRadius: 14, padding: 16, marginVertical: 12 },
  big: { color: "#F8FAFC", fontSize: 26, fontWeight: "800", marginBottom: 4 },
  body: { color: "#CBD5E1", fontSize: 15, lineHeight: 21 },
  warn: { color: "#FBBF24", fontSize: 13, marginBottom: 8 },
  error: { color: "#F87171", fontSize: 13, marginTop: 8 },
  link: { color: "#38BDF8", fontSize: 14, marginTop: 6, textDecorationLine: "underline" },
  place: { backgroundColor: "#111C30", borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: "#1E293B" },
  placeActive: { borderColor: "#2563EB" },
  placeName: { color: "#F8FAFC", fontSize: 15, fontWeight: "600" },
  input: { backgroundColor: "#111C30", color: "#F8FAFC", borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: "#334155", marginBottom: 8 },
  button: { backgroundColor: "#16A34A", borderRadius: 12, padding: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  step: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1E293B" },
  stepNum: { color: "#38BDF8", fontWeight: "800", width: 28, fontSize: 16 },
  stepText: { color: "#F8FAFC", fontSize: 16 },
  stepDist: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
  attribution: { color: "#64748B", fontSize: 12, marginTop: 18, textAlign: "center" },
});
