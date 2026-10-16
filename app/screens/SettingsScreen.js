// app/screens/SettingsScreen.js
// Choices that belong to this phone: which units to show distances in.

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useUnits, setPreference } from "../services/units/UnitStore";
import { formatDistance } from "../services/units/units";

const CHOICES = [
  ["auto", "Automatic", "Follows this phone's region"],
  ["imperial", "Miles and feet", "For example 0.4 mi, 300 ft"],
  ["metric", "Kilometres and metres", "For example 650 m, 1.2 km"],
];

export default function SettingsScreen() {
  const navigation = useNavigation();
  const [units, preference] = useUnits();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.back}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Distances</Text>
        {CHOICES.map(([value, label, hint]) => (
          <TouchableOpacity
            key={value}
            style={styles.row}
            onPress={() => setPreference(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: preference === value }}
            accessibilityLabel={`${label}. ${hint}`}
          >
            <Text style={styles.radio}>{preference === value ? "●" : "○"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{label}</Text>
              <Text style={styles.meta}>{hint}</Text>
            </View>
          </TouchableOpacity>
        ))}
        <Text style={styles.meta}>Showing 1,000 metres as {formatDistance(1000, units)}.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC", paddingTop: 56, paddingHorizontal: 16 },
  back: { color: "#3B82F6", fontSize: 16, fontWeight: "600", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#0F172A", marginBottom: 14 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E2E8F0" },
  radio: { fontSize: 20, color: "#3B82F6", width: 30 },
  name: { fontSize: 15, fontWeight: "600", color: "#0F172A" },
  meta: { color: "#64748B", fontSize: 12, marginTop: 4 },
});
