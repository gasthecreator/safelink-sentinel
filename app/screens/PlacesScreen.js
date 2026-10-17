// app/screens/PlacesScreen.js
// Names for places the user can use as their position when GPS has no fix (indoors,
// no sky view). Saved on this phone only; nothing is sent unless one is attached to an alert.

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { listPlaces, addPlace, removePlace, MAX_PLACES } from "../services/location/PlaceStore";
import { parseCoordinates } from "../services/location/places";
import { getPositionForAlert } from "../services/location/LocationService";
import { describePosition, describeLocationOutcome } from "../services/location/position";
import { t } from "../services/i18n/i18n";
import { useLanguage } from "../services/i18n/LanguageStore";

// small buttons stay easy to hit: the touch area is 10 points bigger on every side
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

export default function PlacesScreen() {
  useLanguage(); // re-render in the new language when it is changed
  const navigation = useNavigation();
  const [places, setPlaces] = useState([]);
  const [name, setName] = useState("");
  const [coords, setCoords] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const refresh = useCallback(async () => setPlaces(await listPlaces()), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveCurrent = async () => {
    setBusy(true);
    setMessage(t("Getting your location..."));
    try {
      const fix = await getPositionForAlert();
      if (!fix.position) {
        const why = {
          denied: t("Could not save: location permission was declined."),
          unavailable: t("Could not save: no GPS fix. Try near a window or outdoors."),
          timeout: t("Could not save: no GPS fix in time."),
        };
        setMessage(why[fix.reason] || t("Could not save: no position."));
        return;
      }
      await addPlace({ name, position: fix.position, kind: "gps" });
      setName("");
      setMessage(
        fix.stale ? t("Saved, using an older position (no fresh GPS fix).") : t("Saved your current location.")
      );
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveTyped = async () => {
    const position = parseCoordinates(coords);
    if (!position) {
      setMessage(t("Could not read those coordinates. Use decimal degrees like \"30.5, -92.2\"."));
      return;
    }
    setBusy(true);
    try {
      await addPlace({ name, position, kind: "manual" });
      setName("");
      setCoords("");
      setMessage(t("Saved."));
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (place) =>
    Alert.alert(t("Delete this place?"), place.name, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Delete"),
        style: "destructive",
        onPress: async () => {
          await removePlace(place.id);
          refresh();
        },
      },
    ]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{t("← Back")}</Text>
        </TouchableOpacity>
        <Text accessibilityRole="header" style={styles.title}>{t("Saved places")}</Text>
        <Text style={styles.intro}>
          {t("Name places you can use as your position when GPS can't get a fix, such as indoors. Save them while you have a fix. They stay on this phone and are only shared when you attach one to a message.")}
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>{t("Name")}</Text>
          <TextInput
            accessibilityLabel={t("Name for this place")}
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t("e.g. School shelter")}
            placeholderTextColor="#64748B"
            maxLength={60}
          />
          <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={saveCurrent}>
            <Text style={styles.buttonText}>{t("Save my current location")}</Text>
          </TouchableOpacity>

          <Text style={[styles.label, { marginTop: 16 }]}>{t("Or type coordinates (decimal degrees)")}</Text>
          <TextInput
            accessibilityLabel={t("Coordinates, latitude then longitude")}
            style={styles.input}
            value={coords}
            onChangeText={setCoords}
            placeholder="30.5, -92.2"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button"
            style={[styles.button, styles.secondary, busy && styles.disabled]}
            disabled={busy}
            onPress={saveTyped}
          >
            <Text style={[styles.buttonText, styles.secondaryText]}>{t("Save typed coordinates")}</Text>
          </TouchableOpacity>
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </View>

        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t("Your places ({count}/{max})", { count: places.length, max: MAX_PLACES })}
        </Text>
        {places.length === 0 ? (
          <Text style={styles.empty}>{t("No saved places yet.")}</Text>
        ) : (
          places.map((place) => {
            const d = describePosition({ ...place, source: null });
            return (
              <View key={place.id} style={styles.place}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeName}>{place.name}</Text>
                  <Text style={styles.placeMeta}>
                    {d.coords}
                    {d.accuracy ? `  ${d.accuracy}` : ""}
                    {place.kind === "manual" ? `  ${t("typed in")}` : ""}
                  </Text>
                </View>
                <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" onPress={() => confirmDelete(place)}>
                  <Text style={styles.delete}>{t("Delete")}</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC", paddingTop: 56, paddingHorizontal: 16 },
  back: { color: "#2563EB", fontSize: 16, fontWeight: "600", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#0F172A", marginBottom: 6 },
  intro: { color: "#475569", fontSize: 14, lineHeight: 20, marginBottom: 14 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 16 },
  label: { color: "#334155", fontWeight: "600", fontSize: 13, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 10,
    color: "#0F172A",
  },
  button: { backgroundColor: "#047857", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  secondary: { backgroundColor: "#E2E8F0" },
  disabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondaryText: { color: "#0F172A" },
  message: { marginTop: 12, color: "#B45309", fontSize: 13, lineHeight: 18 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 8 },
  empty: { color: "#64748B", fontSize: 14 },
  place: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  placeName: { fontSize: 16, fontWeight: "700", color: "#0F172A" },
  placeMeta: { fontSize: 12.5, color: "#64748B", marginTop: 2 },
  delete: { color: "#DC2626", fontWeight: "600", padding: 8 },
});
