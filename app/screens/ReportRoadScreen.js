// app/screens/ReportRoadScreen.js
// Say what you can see on the road where you are: blocked, passable, or a hazard. It goes
// out over the mesh like an alert, and other phones route around blocked roads.

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import RoadReportStore from "../services/roads/RoadReportStore";
import { resolveAlertLocation } from "../services/location/resolveLocation";
import { listPlaces } from "../services/location/PlaceStore";
import { describeLocationOutcome, describePosition } from "../services/location/position";
import { MAX_NOTE } from "../services/roads/reports";
import { t, tp, N_ } from "../services/i18n/i18n";
import { useLanguage } from "../services/i18n/LanguageStore";

// small buttons stay easy to hit: the touch area is 10 points bigger on every side
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

const KINDS = [
  { id: "blocked", label: N_("Blocked"), hint: N_("Cars or people cannot get through here"), color: "#DC2626" },
  { id: "passable", label: N_("Got through"), hint: N_("I just came along here and it is open"), color: "#16A34A" },
  { id: "hazard", label: N_("Hazard"), hint: N_("Flooding, wires down, damage: take care"), color: "#D97706" },
];

// GPS has no position: let the person choose rather than guessing for them.
function askNoFix(fix) {
  const why = fix.reason === "denied" ? t("Location permission was declined.") : t("The phone could not get a GPS fix. Try near a window or outdoors.");
  return new Promise((resolve) => {
    Alert.alert(t("No GPS position"), `${why}\n\n${t("A report needs to say where it is. Use a place you saved earlier, or cancel.")}`, [
      { text: t("Use a saved place"), onPress: () => resolve("places") },
      { text: t("Cancel"), style: "cancel", onPress: () => resolve("cancel") },
    ], { cancelable: true, onDismiss: () => resolve("cancel") });
  });
}

export default function ReportRoadScreen() {
  useLanguage(); // re-render in the new language when it is changed
  const navigation = useNavigation();
  const [kind, setKind] = useState(null);
  const [note, setNote] = useState("");
  const [source, setSource] = useState("gps");
  const [places, setPlaces] = useState([]);
  const [placeId, setPlaceId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    listPlaces().then(setPlaces).catch(() => {});
  }, []);

  const send = async () => {
    if (!kind) return;
    const place = places.find((p) => p.id === placeId);
    if (source === "place" && !place) {
      Alert.alert(t("Choose a place"), t("Pick one of your saved places, or switch back to GPS."));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      // A report is only useful with a position, so unlike an alert it is never sent without one.
      const resolved = await resolveAlertLocation({ include: true, source, place }, { onNoFix: source === "gps" ? askNoFix : undefined });
      if (resolved.cancelled) {
        if (resolved.switchToPlaces) setSource("place");
        return;
      }
      const position = resolved.fix?.position;
      if (!position) {
        const why = {
          denied: t("Not sent: location permission was declined."),
          unavailable: t("Not sent: no GPS fix. Try near a window or outdoors."),
          timeout: t("Not sent: no GPS fix in time."),
          no_place: t("Not sent: no saved place was chosen."),
        };
        setResult({ ok: false, text: why[resolved.fix && resolved.fix.reason] || t("Not sent: no position.") });
        return;
      }
      const summary = await RoadReportStore.publish({ kind, position, note });
      const reached = summary.success || 0;
      setResult({
        ok: true,
        text:
          (reached > 0
            ? tp(
                "Shared with {count} nearby device. It will also go to devices that come into range later.",
                "Shared with {count} nearby devices. It will also go to devices that come into range later.",
                reached
              )
            : t("Saved. No one is in range yet; it will be sent when a device comes into range.")) +
          ` ${describeLocationOutcome(resolved.fix)} ${t("Your own directions already avoid it.")}`,
      });
      setNote("");
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" onPress={() => navigation.goBack()}>
        <Text style={styles.back}>{t("← Back")}</Text>
      </TouchableOpacity>
      <Text accessibilityRole="header" style={styles.title}>{t("Report a road")}</Text>
      <Text style={styles.intro}>
        {t("Tell people nearby what you can see where you are. Phones that hear it will route around a blocked road. Only report what you have seen yourself: other people may rely on it.")}
      </Text>

      <Text style={styles.label}>{t("What is it like here?")}</Text>
      {KINDS.map((k) => (
        <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityState={{ selected: kind === k.id }} accessibilityLabel={`${t(k.label)}. ${t(k.hint)}`} key={k.id} style={[styles.kind, kind === k.id && { borderColor: k.color, backgroundColor: "#111C30" }]} onPress={() => setKind(k.id)}>
          <Text style={[styles.kindLabel, { color: k.color }]}>{kind === k.id ? "● " : "○ "}{t(k.label)}</Text>
          <Text style={styles.kindHint}>{t(k.hint)}</Text>
        </TouchableOpacity>
      ))}

      <Text style={styles.label}>Note (optional)</Text>
      <TextInput accessibilityLabel={t("Note about the road, optional")} style={styles.input} value={note} onChangeText={setNote} maxLength={MAX_NOTE} placeholder={t("e.g. Tree across both lanes")} placeholderTextColor="#94A3B8" />

      <Text style={styles.label}>{t("Where")}</Text>
      <View style={styles.row}>
        {[["gps", t("Here (GPS)")], ["place", t("A saved place")]].map(([v, l]) => (
          <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityState={{ selected: source === v }} key={v} style={[styles.chip, source === v && styles.chipActive]} onPress={() => setSource(v)}>
            <Text style={[styles.chipText, source === v && styles.chipTextActive]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {source === "place" ? (
        places.length === 0 ? (
          <Text style={styles.hint}>{t("No saved places yet. Save one from Saved places on the home screen.")}</Text>
        ) : (
          places.map((p) => (
            <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityState={{ selected: p.id === placeId }} key={p.id} style={[styles.place, p.id === placeId && styles.placeActive]} onPress={() => setPlaceId(p.id)}>
              <Text style={styles.placeName}>{p.id === placeId ? "● " : "○ "}{p.name}</Text>
              <Text style={styles.hint}>{describePosition(p)?.coords}</Text>
            </TouchableOpacity>
          ))
        )
      ) : null}
      <Text style={styles.hint}>{t("Every nearby phone that hears this can see where you are.")}</Text>

      <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" style={[styles.button, (!kind || busy) && styles.disabled]} disabled={!kind || busy} onPress={send}>
        <Text style={styles.buttonText}>{busy ? t("Working...") : t("Send report")}</Text>
      </TouchableOpacity>
      {result ? <Text style={[styles.result, !result.ok && { color: "#F87171" }]}>{result.text}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220", paddingHorizontal: 20, paddingTop: 60 },
  back: { color: "#38BDF8", fontSize: 16, fontWeight: "600", marginBottom: 12 },
  title: { color: "#F8FAFC", fontSize: 26, fontWeight: "800", marginBottom: 6 },
  intro: { color: "#94A3B8", fontSize: 14, lineHeight: 20, marginBottom: 6 },
  label: { color: "#CBD5E1", fontSize: 14, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  kind: { borderWidth: 2, borderColor: "#1E293B", borderRadius: 12, padding: 14, marginBottom: 8 },
  kindLabel: { fontSize: 18, fontWeight: "800" },
  kindHint: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
  input: { backgroundColor: "#111C30", color: "#F8FAFC", borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: "#334155" },
  row: { flexDirection: "row" },
  chip: { borderWidth: 1, borderColor: "#334155", borderRadius: 18, paddingVertical: 7, paddingHorizontal: 14, marginRight: 8 },
  chipActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  chipText: { color: "#CBD5E1", fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  place: { backgroundColor: "#111C30", borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: "#1E293B" },
  placeActive: { borderColor: "#2563EB" },
  placeName: { color: "#F8FAFC", fontSize: 15, fontWeight: "600" },
  hint: { color: "#94A3B8", fontSize: 12.5, marginTop: 6 },
  button: { backgroundColor: "#15803D", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 20 },
  disabled: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  result: { color: "#86EFAC", fontSize: 14, lineHeight: 20, marginTop: 14 },
});
