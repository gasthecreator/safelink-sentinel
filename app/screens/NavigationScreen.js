// app/screens/NavigationScreen.js
// Directions to the sender of an alert, worked out on the phone from an offline map pack.
// No internet. Start from GPS, a saved place, or typed coordinates; walk or drive.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Vibration, useWindowDimensions } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import RouteMap from "../components/RouteMap";
import { findPackFor } from "../services/navigation/packs";
import { route as computeRoute } from "../services/navigation/router";
import { formatDistance, formatDuration } from "../services/navigation/mapView";
import { getPositionForAlert, watchPositionUpdates } from "../services/location/LocationService";
import { startFollowing, update as followUpdate, canReroute, markRerouted } from "../services/navigation/follow";
import {
  keepAwake, speak, stopSpeaking, isSpeechAvailable, createAnnouncer, loadVoicePreference, saveVoicePreference,
} from "../services/navigation/guidance";
import { listPlaces } from "../services/location/PlaceStore";
import { parseCoordinates } from "../services/location/places";
import { sanitizePosition, describePosition } from "../services/location/position";
import RoadReportStore from "../services/roads/RoadReportStore";
import { describeKind } from "../services/roads/reports";

const closureKey = (c) => [c.kind, c.latitude, c.longitude, c.radiusM, c.disputed || false];

// A buzz is a nicety: if the phone refuses it, directions carry on.
const buzz = (pattern) => {
  try {
    Vibration.vibrate(pattern);
  } catch {
    // no vibration available
  }
};

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
  const [closures, setClosures] = useState([]);
  const [avoidOn, setAvoidOn] = useState(true);
  // live directions: follow the phone along the route, re-route if it leaves it
  const [live, setLive] = useState(false);
  const [liveOrigin, setLiveOrigin] = useState(null);
  const [livePos, setLivePos] = useState(null);
  const [progress, setProgress] = useState(null);
  const [liveNote, setLiveNote] = useState(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const voiceRef = useRef(true);
  const announcer = useRef(createAnnouncer({ mode: "walk" }));
  const rerouted = useRef(false);
  const startedSpeaking = useRef(false);
  const follower = useRef(null);
  const lastPos = useRef(null);
  const lastAnnounced = useRef(-1);
  // bumped when the screen comes back into view, so maps downloaded meanwhile are picked up
  const [mapsVersion, setMapsVersion] = useState(0);
  useEffect(() => navigation.addListener("focus", () => setMapsVersion((v) => v + 1)), [navigation]);

  const readGps = async () => {
    setGps({ state: "loading" });
    const fix = await getPositionForAlert();
    setGps(fix.position ? { state: "ok", fix } : { state: "none", fix });
  };
  useEffect(() => {
    readGps();
    listPlaces().then(setPlaces).catch(() => {});
    // road reports from people nearby: kept current, since they expire and new ones arrive
    // only replace the list when it really changed: a new list means a new route is worked out
    const refresh = () => setClosures((prev) => {
      const next = RoadReportStore.closures();
      return JSON.stringify(prev.map(closureKey)) === JSON.stringify(next.map(closureKey)) ? prev : next;
    });
    RoadReportStore.init().then(refresh).catch(() => {});
    const unsubscribe = RoadReportStore.subscribe(refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    loadVoicePreference().then((on) => {
      voiceRef.current = on;
      setVoiceOn(on);
    });
    isSpeechAvailable().then(setVoiceAvailable);
  }, []);

  const say = useCallback((text) => {
    if (text && voiceRef.current) speak(text);
  }, []);

  const toggleVoice = () => {
    const next = !voiceOn;
    voiceRef.current = next;
    setVoiceOn(next);
    saveVoicePreference(next);
    if (!next) stopSpeaking();
  };

  const start = useMemo(() => {
    if (source === "gps") return gps.state === "ok" ? gps.fix.position : null;
    if (source === "place") return sanitizePosition(places.find((p) => p.id === placeId));
    return typedPoint;
  }, [source, gps, places, placeId, typedPoint]);

  const routeStart = live ? liveOrigin : start;
  const [found, setFound] = useState({ loading: true, pack: null, partial: null });
  useEffect(() => {
    if (!routeStart || !destination) {
      setFound({ loading: false, pack: null, partial: null });
      return undefined;
    }
    let live = true;
    setFound((f) => ({ ...f, loading: true }));
    findPackFor([routeStart, destination]).then((r) => {
      if (live) setFound({ loading: false, ...r });
    });
    return () => {
      live = false;
    };
  }, [routeStart, destination, mapsVersion]);

  const outcome = useMemo(() => {
    if (!destination) return { kind: "no_destination" };
    if (!routeStart) return { kind: "no_start" };
    if (found.loading) return { kind: "loading" };
    const { pack, partial } = found;
    if (!pack) return { kind: "no_pack", partial };
    // Blocked roads are only routed around if the person wants that; hazards are always listed.
    const avoid = avoidOn ? closures : closures.filter((c) => c.kind === "hazard");
    return { kind: "routed", pack, result: computeRoute(pack, routeStart, destination, { mode, avoid }) };
  }, [destination, routeStart, found, mode, closures, avoidOn]);

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

  // a new route (first one, or after a re-route) restarts the follower from its beginning
  useEffect(() => {
    if (live && result && result.ok) {
      follower.current = startFollowing(result);
      announcer.current = createAnnouncer({ mode });
      // "Starting directions" once, "New route" after leaving the route; a quiet recalculation
      // (road reports changed) says nothing
      if (!startedSpeaking.current) say(announcer.current.start(result));
      else if (rerouted.current) say(announcer.current.start(result, { rerouted: true }));
      startedSpeaking.current = true;
      rerouted.current = false;
      lastAnnounced.current = -1;
      setLiveNote((n) => (n && n.startsWith("You left") ? null : n));
      if (lastPos.current) {
        // show where you are on the new route straight away, without waiting for the next fix
        const res = followUpdate(follower.current, lastPos.current, destination);
        follower.current = res.state;
        setProgress(res);
      } else {
        setProgress(null);
      }
    }
  }, [live, result]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFix = useCallback((position) => {
    lastPos.current = position;
    setLivePos(position);
    if (!follower.current) return;
    const res = followUpdate(follower.current, position, destination);
    const prevState = follower.current;
    follower.current = res.state;
    setProgress(res);
    if (res.ignored) return;
    say(announcer.current.update(res));
    if (res.arrived || res.endOfRoad) {
      if (lastAnnounced.current !== "end") buzz([0, 400, 200, 400]);
      lastAnnounced.current = "end";
      return;
    }
    if (res.next && res.next.inM <= 30 && res.next.index !== lastAnnounced.current && res.next.index < prevState.prep.route.steps.length - 1) {
      lastAnnounced.current = res.next.index;
      buzz(200);
    }
    if (res.offRoute && canReroute(res.state)) {
      follower.current = markRerouted(res.state);
      setLiveNote("You left the route. Working out a new one...");
      rerouted.current = true;
      say(announcer.current.offRoute());
      buzz([0, 150, 100, 150]);
      setLiveOrigin(position);
    }
  }, [destination, say]);

  useEffect(() => {
    if (!live) return undefined;
    setLiveNote(null);
    return watchPositionUpdates(onFix, (reason) =>
      setLiveNote(reason === "denied" ? "Location permission was turned off, so directions cannot follow you." : "Lost the GPS signal. Directions will continue when it returns.")
    );
  }, [live, onFix]);

  // road reports changed while navigating: work the route out again from where you are now
  useEffect(() => {
    if (live && lastPos.current) setLiveOrigin(lastPos.current);
  }, [closures, avoidOn, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // the screen stays on while directions are live, and is let go of when they stop or the screen closes
  useEffect(() => {
    if (!live) return undefined;
    keepAwake(true);
    return () => {
      keepAwake(false);
      stopSpeaking();
    };
  }, [live]);

  const startLive = () => {
    lastPos.current = start;
    setLivePos(start);
    setLiveOrigin(start);
    setLiveNote(null);
    startedSpeaking.current = false;
    rerouted.current = false;
    setLive(true);
  };
  const stopLive = () => {
    if (lastPos.current) setGps({ state: "ok", fix: { position: lastPos.current, stale: false } });
    setLive(false);
    setProgress(null);
    follower.current = null;
  };

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

          {closures.some((c) => c.kind === "blocked") ? (
            <>
              <Text style={styles.label}>Road reports from people nearby</Text>
              <View style={styles.row}>
                <Chip label="Avoid reported closures" active={avoidOn} onPress={() => setAvoidOn(true)} />
                <Chip label="Ignore them" active={!avoidOn} onPress={() => setAvoidOn(false)} />
              </View>
            </>
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
            Download a map for this area while you have internet, or use their position and the Maps button on the alert instead.
          </Text>
          <TouchableOpacity style={[styles.button, { marginTop: 12 }]} onPress={() => navigation.navigate("OfflineMaps")}>
            <Text style={styles.buttonText}>Get offline maps</Text>
          </TouchableOpacity>
        </Card>
      ) : null}

      {result && !result.ok ? (
        <Card>
          <Text style={styles.big}>{result.reason === "blocked_by_reports" ? "Reported closures block the way" : "No route"}</Text>
          <Text style={styles.body}>{result.message}</Text>
          {result.reason === "blocked_by_reports" ? (
            <TouchableOpacity style={[styles.button, { marginTop: 12 }]} onPress={() => setAvoidOn(false)}>
              <Text style={styles.buttonText}>Show the route anyway</Text>
            </TouchableOpacity>
          ) : null}
        </Card>
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
            <Text key={w} style={styles.warn}>{w}</Text>
          ))}
          {result.detour && result.detour.closures.length ? (
            <Text style={styles.detour}>
              Going around {result.detour.closures.length} reported closure{result.detour.closures.length === 1 ? "" : "s"}:
              {" "}about {formatDistance(Math.max(0, result.detour.extraM))} and {formatDuration(Math.max(0, result.detour.extraS))} longer.
            </Text>
          ) : null}
          {result.hazardsOnRoute && result.hazardsOnRoute.length ? (
            <Text style={styles.warn}>
              Hazard reported near this route: {result.hazardsOnRoute.map((h) => h.note || "take care").join("; ")}.
            </Text>
          ) : null}
          {live ? (
            <LivePanel progress={progress} note={liveNote} onStop={stopLive} voice={voiceAvailable ? { on: voiceOn, toggle: toggleVoice } : null} />
          ) : source === "gps" && gps.state === "ok" ? (
            <TouchableOpacity style={[styles.button, { marginBottom: 12 }]} onPress={startLive}>
              <Text style={styles.buttonText}>Start live directions</Text>
            </TouchableOpacity>
          ) : null}
          <RouteMap graph={outcome.pack} route={result} you={live && livePos ? livePos : routeStart} them={destination} closures={closures} width={mapWidth} height={300} />
          {closures.length ? (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.label}>Road reports in force</Text>
              {closures.map((c, i) => (
                <Text key={i} style={styles.reportLine}>
                  {c.kind === "blocked" ? "✕" : "!"} {describeKind(c.kind)}{c.note ? `: ${c.note}` : ""}{" "}
                  ({Math.max(1, Math.round((Date.now() - c.reportedAt) / 60000))} min ago
                  {c.reporters > 1 ? `, ${c.reporters} phones` : ""}{c.disputed ? ", disputed" : ""})
                </Text>
              ))}
            </View>
          ) : null}
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

const LivePanel = ({ progress, note, onStop, voice }) => (
  <View style={styles.live}>
    {progress && progress.arrived ? (
      <Text style={styles.liveBig}>You have arrived</Text>
    ) : progress && progress.endOfRoad ? (
      <>
        <Text style={styles.liveBig}>End of the mapped road</Text>
        {progress.toTarget ? (
          <Text style={styles.liveText}>They are about {formatDistance(progress.toTarget.distanceM)} {progress.toTarget.direction} of here, off the roads in the map.</Text>
        ) : null}
        <Text style={styles.liveSmall}>Use Find them by Bluetooth to close the last stretch.</Text>
      </>
    ) : progress && progress.next ? (
      <>
        <Text style={styles.liveBig}>{progress.next.inM > 0 ? `In ${formatDistance(progress.next.inM)}` : "Now"}</Text>
        <Text style={styles.liveText}>{progress.next.final ? "End of the mapped road" : progress.next.text}</Text>
        <Text style={styles.liveSmall}>
          {formatDistance(progress.remainingM)} to go · about {formatDuration(progress.remainingS)}
          {progress.ignored ? " · waiting for a better GPS fix" : ""}
        </Text>
      </>
    ) : (
      <Text style={styles.liveText}>Waiting for your position...</Text>
    )}
    {note ? <Text style={styles.liveNote}>{note}</Text> : null}
    <Text style={styles.liveSmall}>The screen stays on while directions are live.</Text>
    {voice ? (
      <TouchableOpacity onPress={voice.toggle}>
        <Text style={styles.link}>{voice.on ? "Voice on: tap to turn off" : "Voice off: tap to turn on"}</Text>
      </TouchableOpacity>
    ) : null}
    <TouchableOpacity style={[styles.button, styles.stop]} onPress={onStop}>
      <Text style={styles.buttonText}>Stop</Text>
    </TouchableOpacity>
  </View>
);

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
  detour: { color: "#93C5FD", fontSize: 14, marginBottom: 8 },
  reportLine: { color: "#CBD5E1", fontSize: 13, marginBottom: 4 },
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
  live: { backgroundColor: "#0F2A4A", borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#2563EB" },
  liveBig: { color: "#F8FAFC", fontSize: 28, fontWeight: "800" },
  liveText: { color: "#F8FAFC", fontSize: 19, fontWeight: "600", marginVertical: 4 },
  liveSmall: { color: "#94A3B8", fontSize: 13, marginTop: 4 },
  liveNote: { color: "#FBBF24", fontSize: 14, marginTop: 8 },
  stop: { backgroundColor: "#DC2626", marginTop: 12 },
  attribution: { color: "#64748B", fontSize: 12, marginTop: 18, textAlign: "center" },
});
