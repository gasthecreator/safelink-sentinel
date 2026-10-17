// app/screens/NavigationScreen.js
// Directions to the sender of an alert, worked out on the phone from an offline map pack.
// No internet. Start from GPS, a saved place, or typed coordinates; walk or drive.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Vibration, AccessibilityInfo, useWindowDimensions } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import RouteMap from "../components/RouteMap";
import { findPackFor } from "../services/navigation/packs";
import { route as computeRoute } from "../services/navigation/router";
import { formatDistance, formatDuration } from "../services/navigation/mapView";
import { useUnits } from "../services/units/UnitStore";
import { getCurrentUnits } from "../services/units/units";
import { getPositionForAlert, watchPositionUpdates } from "../services/location/LocationService";
import { startFollowing, update as followUpdate, canReroute, markRerouted } from "../services/navigation/follow";
import {
  keepAwake, speak, stopSpeaking, isSpeechAvailable, createAnnouncer, loadVoicePreference, saveVoicePreference,
  startBackground, stopBackground, askNotificationPermission,
} from "../services/navigation/guidance";
import { listPlaces } from "../services/location/PlaceStore";
import { parseCoordinates } from "../services/location/places";
import { sanitizePosition, describePosition } from "../services/location/position";
import RoadReportStore from "../services/roads/RoadReportStore";
import { describeKind } from "../services/roads/reports";
import { t, tp } from "../services/i18n/i18n";
import { useLanguage } from "../services/i18n/LanguageStore";

// small buttons stay easy to hit: the touch area is 10 points bigger on every side
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

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
  const [units] = useUnits(); // re-renders (and re-words the route) when the units setting changes
  const [language] = useLanguage(); // likewise for the language
  const leftNoteText = useRef(null); // the "you left the route" note, so it can be cleared once the new route is in
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
  const [voiceAvailable, setVoiceAvailable] = useState(null); // null until the phone has answered
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

  // With a screen reader (TalkBack / VoiceOver) running, instructions go through it, so there is one
  // voice, in the person's own speech settings, rather than two talking over each other.
  const screenReader = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then((on) => { screenReader.current = on; }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", (on) => { screenReader.current = on; });
    return () => sub && sub.remove && sub.remove();
  }, []);
  const say = useCallback((text) => {
    if (!text) return;
    if (screenReader.current) AccessibilityInfo.announceForAccessibility(text);
    else if (voiceRef.current) speak(text);
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
    return { kind: "routed", pack, result: computeRoute(pack, routeStart, destination, { mode, avoid, formatDistance: (m) => formatDistance(m, units) }) };
    // `language` is not read in here, but the route text comes from t(), which reads a module global: recompute when it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination, routeStart, found, mode, closures, avoidOn, units, language]);

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
      announcer.current = createAnnouncer({ mode, units: getCurrentUnits() });
      // "Starting directions" once, "New route" after leaving the route; a quiet recalculation
      // (road reports changed) says nothing
      if (!startedSpeaking.current) say(announcer.current.start(result));
      else if (rerouted.current) say(announcer.current.start(result, { rerouted: true }));
      startedSpeaking.current = true;
      rerouted.current = false;
      lastAnnounced.current = -1;
      setLiveNote((n) => (n && n === leftNoteText.current ? null : n));
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
      leftNoteText.current = t("You left the route. Working out a new one...");
      setLiveNote(leftNoteText.current);
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
      setLiveNote(reason === "denied" ? t("Location permission was turned off, so directions cannot follow you.") : t("Lost the GPS signal. Directions will continue when it returns."))
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
    // let directions carry on with the screen locked (the screen stays on while this screen is open
    // anyway; this is for when you lock the phone or switch apps)
    let active = true; // do not start the service if Stop was pressed while the permission question was up
    askNotificationPermission().then(() => active && startBackground());
    return () => {
      active = false;
      keepAwake(false);
      stopBackground();
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
      <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" onPress={() => navigation.goBack()}>
        <Text style={styles.back}>{t("← Back")}</Text>
      </TouchableOpacity>
      <Text accessibilityRole="header" style={styles.title}>{alert.title ? t("Directions to \"{name}\"", { name: alert.title }) : t("Directions to them")}</Text>
      {alert.subtitle ? <Text style={styles.where}>{t(alert.subtitle)}</Text> : null}
      {alert.where ? <Text style={styles.where}>{t("They said: {where}", { where: alert.where })}</Text> : null}
      <Text style={styles.note}>
        {t("Worked out on this phone from an offline map, with no internet. It follows the roads in the map and cannot know about closures, damage or flooding.")}
      </Text>

      {!destination ? (
        <Card><Text style={styles.big}>{t("No position to navigate to")}</Text>
          <Text style={styles.body}>{t("This alert did not include where the sender is. Use their own words above.")}</Text>
        </Card>
      ) : (
        <>
          <Text style={styles.label}>{t("Start from")}</Text>
          <View style={styles.row}>
            {[["gps", t("GPS")], ["place", t("Saved place")], ["typed", t("Typed")]].map(([v, l]) => (
              <Chip key={v} label={l} active={source === v} onPress={() => setSource(v)} />
            ))}
          </View>

          {source === "gps" ? (
            <Text style={styles.body}>
              {gps.state === "loading" ? t("Getting your position...")
                : gps.state === "ok" ? t("Your position: {position}{older}", { position: describePosition(gps.fix.position).text, older: gps.fix.stale ? ` ${t("(older fix)")}` : "" })
                : t("No GPS position. Choose a saved place or type coordinates.")}
              {gps.state !== "loading" ? "  " : ""}
            </Text>
          ) : null}
          {source === "gps" && gps.state !== "loading" ? (
            <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" onPress={readGps}><Text style={styles.link}>{t("Try GPS again")}</Text></TouchableOpacity>
          ) : null}

          {source === "place" ? (
            places.length === 0 ? (
              <Text style={styles.body}>{t("No saved places yet. Save one from the home screen's Saved places.")}</Text>
            ) : (
              places.map((p) => (
                <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityState={{ selected: p.id === placeId }} key={p.id} style={[styles.place, p.id === placeId && styles.placeActive]} onPress={() => setPlaceId(p.id)}>
                  <Text style={styles.placeName}>{p.id === placeId ? "● " : "○ "}{p.name}</Text>
                </TouchableOpacity>
              ))
            )
          ) : null}

          {source === "typed" ? (
            <View>
              <TextInput
                accessibilityLabel={t("Your starting point as coordinates, latitude then longitude")}
                style={styles.input}
                value={typed}
                onChangeText={setTyped}
                placeholder="32.5266, -92.7165"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" style={styles.button} onPress={applyTyped}><Text style={styles.buttonText}>{t("Use these coordinates")}</Text></TouchableOpacity>
              {typedError ? <Text style={styles.error}>{typedError}</Text> : null}
            </View>
          ) : null}

          {closures.some((c) => c.kind === "blocked") ? (
            <>
              <Text style={styles.label}>{t("Road reports from people nearby")}</Text>
              <View style={styles.row}>
                <Chip label={t("Avoid reported closures")} active={avoidOn} onPress={() => setAvoidOn(true)} />
                <Chip label={t("Ignore them")} active={!avoidOn} onPress={() => setAvoidOn(false)} />
              </View>
            </>
          ) : null}

          <Text style={styles.label}>{t("Travelling")}</Text>
          <View style={styles.row}>
            <Chip label={t("On foot")} active={mode === "walk"} onPress={() => setMode("walk")} />
            <Chip label={t("By car")} active={mode === "drive"} onPress={() => setMode("drive")} />
          </View>
        </>
      )}

      {outcome.kind === "no_start" && destination ? (
        <Card><Text style={styles.big}>{t("Where are you starting from?")}</Text>
          <Text style={styles.body}>{t("Pick a start above to see the route.")}</Text></Card>
      ) : null}

      {outcome.kind === "no_pack" ? (
        <Card>
          <Text style={styles.big}>{t("No offline map for this area")}</Text>
          <Text style={styles.body}>
            {outcome.partial
              ? `${t("The \"{name}\" map covers only one of the two places.", { name: outcome.partial.name })} `
              : `${t("None of the maps on this phone cover these places.")} `}
            {t("Download a map for this area while you have internet, or use their position and the Maps button on the alert instead.")}
          </Text>
          <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" style={[styles.button, { marginTop: 12 }]} onPress={() => navigation.navigate("OfflineMaps")}>
            <Text style={styles.buttonText}>{t("Get offline maps")}</Text>
          </TouchableOpacity>
        </Card>
      ) : null}

      {result && !result.ok ? (
        <Card>
          <Text style={styles.big}>{result.reason === "blocked_by_reports" ? t("Reported closures block the way") : t("No route")}</Text>
          <Text style={styles.body}>{result.message}</Text>
          {result.reason === "blocked_by_reports" ? (
            <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" style={[styles.button, { marginTop: 12 }]} onPress={() => setAvoidOn(false)}>
              <Text style={styles.buttonText}>{t("Show the route anyway")}</Text>
            </TouchableOpacity>
          ) : null}
        </Card>
      ) : null}

      {result && result.ok ? (
        <>
          <Card>
            <Text style={styles.big}>{formatDistance(result.distanceM)}</Text>
            <Text style={styles.body}>
              {t("About {time} {how}", { time: formatDuration(result.durationS), how: mode === "walk" ? t("on foot") : t("by car") })} · {outcome.pack.name}
            </Text>
          </Card>
          {result.warnings.map((w) => (
            <Text key={w} style={styles.warn}>{w}</Text>
          ))}
          {result.detour && result.detour.closures.length ? (
            <Text style={styles.detour}>
              {tp(
                "Going around {count} reported closure: about {distance} and {time} longer.",
                "Going around {count} reported closures: about {distance} and {time} longer.",
                result.detour.closures.length,
                { distance: formatDistance(Math.max(0, result.detour.extraM)), time: formatDuration(Math.max(0, result.detour.extraS)) }
              )}
            </Text>
          ) : null}
          {result.hazardsOnRoute && result.hazardsOnRoute.length ? (
            <Text style={styles.warn}>
              {t("Hazard reported near this route: {notes}.", { notes: result.hazardsOnRoute.map((h) => h.note || t("take care")).join("; ") })}
            </Text>
          ) : null}
          {live ? (
            <LivePanel progress={progress} note={liveNote} onStop={stopLive} voice={voiceAvailable ? { on: voiceOn, toggle: toggleVoice } : null} noVoice={voiceAvailable === false} />
          ) : source === "gps" && gps.state === "ok" ? (
            <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" style={[styles.button, { marginBottom: 12 }]} onPress={startLive}>
              <Text style={styles.buttonText}>{t("Start live directions")}</Text>
            </TouchableOpacity>
          ) : null}
          <RouteMap graph={outcome.pack} route={result} you={live && livePos ? livePos : routeStart} them={destination} closures={closures} width={mapWidth} height={300} />
          {closures.length ? (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.label}>{t("Road reports in force")}</Text>
              {closures.map((c, i) => (
                <Text key={i} style={styles.reportLine}>
                  {c.kind === "blocked" ? "✕" : "!"} {describeKind(c.kind)}{c.note ? `: ${c.note}` : ""}{" "}
                  ({t("{minutes} min ago", { minutes: Math.max(1, Math.round((Date.now() - c.reportedAt) / 60000)) })}
                  {c.reporters > 1 ? `, ${t("{count} phones", { count: c.reporters })}` : ""}{c.disputed ? `, ${t("disputed")}` : ""})
                </Text>
              ))}
            </View>
          ) : null}
          <Text style={styles.label}>{t("Directions")}</Text>
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
            <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" style={[styles.button, { marginTop: 18 }]} onPress={() => navigation.navigate("Finder", { alert })}>
              <Text style={styles.buttonText}>{t("Close by? Find them by Bluetooth")}</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.attribution}>{t("Map data {attribution}", { attribution: outcome.pack.attribution })}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const LivePanel = ({ progress, note, onStop, voice, noVoice }) => (
  <View style={styles.live}>
    {progress && progress.arrived ? (
      <Text style={styles.liveBig}>{t("You have arrived")}</Text>
    ) : progress && progress.endOfRoad ? (
      <>
        <Text style={styles.liveBig}>{t("End of the mapped road")}</Text>
        {progress.toTarget ? (
          <Text style={styles.liveText}>They are about {formatDistance(progress.toTarget.distanceM)} {progress.toTarget.direction} of here, off the roads in the map.</Text>
        ) : null}
        <Text style={styles.liveSmall}>{t("Use Find them by Bluetooth to close the last stretch.")}</Text>
      </>
    ) : progress && progress.next ? (
      <>
        <Text style={styles.liveBig}>{progress.next.inM > 0 ? t("In {distance}", { distance: formatDistance(progress.next.inM) }) : t("Now")}</Text>
        <Text style={styles.liveText}>{progress.next.final ? t("End of the mapped road") : progress.next.text}</Text>
        <Text style={styles.liveSmall}>
          {t("{distance} to go · about {time}", { distance: formatDistance(progress.remainingM), time: formatDuration(progress.remainingS) })}
          {progress.ignored ? ` · ${t("waiting for a better GPS fix")}` : ""}
        </Text>
      </>
    ) : (
      <Text style={styles.liveText}>{t("Waiting for your position...")}</Text>
    )}
    {note ? <Text style={styles.liveNote}>{note}</Text> : null}
    <Text style={styles.liveSmall}>{t("The screen stays on while directions are live, and they keep going if you lock the phone.")}</Text>
    {voice ? (
      <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityState={{ checked: voice.on }} accessibilityLabel={voice.on ? t("Spoken directions are on. Double tap to turn off.") : t("Spoken directions are off. Double tap to turn on.")} onPress={voice.toggle}>
        <Text style={styles.link}>{voice.on ? t("Voice on: tap to turn off") : t("Voice off: tap to turn on")}</Text>
      </TouchableOpacity>
    ) : noVoice ? (
      <Text style={styles.liveSmall}>{t("This phone has no voice for this language, so the directions stay on screen only.")}</Text>
    ) : null}
    <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" style={[styles.button, styles.stop]} onPress={onStop}>
      <Text style={styles.buttonText}>{t("Stop")}</Text>
    </TouchableOpacity>
  </View>
);

const Card = ({ children }) => <View style={styles.card}>{children}</View>;
const Chip = ({ label, active, onPress }) => (
  <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityState={{ selected: !!active }} style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
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
  button: { backgroundColor: "#15803D", borderRadius: 12, padding: 14, alignItems: "center" },
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
  attribution: { color: "#94A3B8", fontSize: 12, marginTop: 18, textAlign: "center" },
});
