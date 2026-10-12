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

export default function PlacesScreen() {
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
    setMessage("Getting your location...");
    try {
      const fix = await getPositionForAlert();
      if (!fix.position) {
        setMessage(describeLocationOutcome(fix).replace("Sent without", "Could not save: no position."));
        return;
      }
      await addPlace({ name, position: fix.position, kind: "gps" });
      setName("");
      setMessage(
        fix.stale ? "Saved, using an older position (no fresh GPS fix)." : "Saved your current location."
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
      setMessage('Could not read those coordinates. Use decimal degrees like "30.5, -92.2".');
      return;
    }
    setBusy(true);
    try {
      await addPlace({ name, position, kind: "manual" });
      setName("");
      setCoords("");
      setMessage("Saved.");
      await refresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (place) =>
    Alert.alert("Delete this place?", place.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
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
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Saved places</Text>
        <Text style={styles.intro}>
          Name places you can use as your position when GPS can't get a fix, such as indoors. Save them
          while you have a fix. They stay on this phone and are only shared when you attach one to a
          message.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. School shelter"
            maxLength={60}
          />
          <TouchableOpacity style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={saveCurrent}>
            <Text style={styles.buttonText}>Save my current location</Text>
          </TouchableOpacity>

          <Text style={[styles.label, { marginTop: 16 }]}>Or type coordinates (decimal degrees)</Text>
          <TextInput
            style={styles.input}
            value={coords}
            onChangeText={setCoords}
            placeholder="30.5, -92.2"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[styles.button, styles.secondary, busy && styles.disabled]}
            disabled={busy}
            onPress={saveTyped}
          >
            <Text style={[styles.buttonText, styles.secondaryText]}>Save typed coordinates</Text>
          </TouchableOpacity>
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </View>

        <Text style={styles.sectionTitle}>
          Your places ({places.length}/{MAX_PLACES})
        </Text>
        {places.length === 0 ? (
          <Text style={styles.empty}>No saved places yet.</Text>
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
                    {place.kind === "manual" ? "  typed in" : ""}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => confirmDelete(place)}>
                  <Text style={styles.delete}>Delete</Text>
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
  back: { color: "#3B82F6", fontSize: 16, fontWeight: "600", marginBottom: 6 },
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
  button: { backgroundColor: "#10B981", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
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
