// app/screens/SettingsScreen.js
// Choices that belong to this phone: which units to show distances in.

import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useUnits, setPreference } from "../services/units/UnitStore";
import { formatDistance } from "../services/units/units";
import { eraseMyData } from "../services/privacy/DataWipe";
import { t, N_, LANGUAGES } from "../services/i18n/i18n";
import { useLanguage, setPreference as setLanguagePreference } from "../services/i18n/LanguageStore";

// small buttons stay easy to hit: the touch area is 10 points bigger on every side
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

const CHOICES = [
  ["auto", N_("Automatic"), N_("Follows this phone's region")],
  ["imperial", N_("Miles and feet"), N_("For example 0.4 mi, 300 ft")],
  ["metric", N_("Kilometres and metres"), N_("For example 650 m, 1.2 km")],
];

// Languages are listed by their own names, so someone can find theirs whatever language the app is in now.
const LANGUAGE_CHOICES = [["auto", N_("Automatic"), N_("Follows this phone's language")], ...LANGUAGES.map((l) => [l.code, l.name, null])];

export default function SettingsScreen() {
  const navigation = useNavigation();
  const [units, preference] = useUnits();
  const [, languagePreference] = useLanguage();
  const [erasing, setErasing] = useState(false);
  const [erased, setErased] = useState(null); // a sentence about what just happened

  const confirmErase = (resetIdentity) =>
    Alert.alert(
      resetIdentity ? t("Erase everything and start over?") : t("Erase my data?"),
      resetIdentity
        ? t("This erases your saved places, alerts, messages waiting to be sent, road reports and logs, AND this phone's identity. Other phones will see you as a brand new device, and nobody can send you messages addressed to your old identity. Downloaded maps and settings stay. This cannot be undone.")
        : t("This erases your saved places, received alerts and requests, messages waiting to be sent, road reports, nearby devices and logs from this phone. Your identity, downloaded maps and settings stay. This cannot be undone."),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: resetIdentity ? t("Erase and start over") : t("Erase"),
          style: "destructive",
          onPress: async () => {
            setErasing(true);
            setErased(null);
            const result = await eraseMyData({ resetIdentity });
            setErasing(false);
            setErased(
              result.failures.length
                ? t("Mostly erased, but some things could not be: {things}.", { things: result.failures.slice(0, 3).join("; ") })
                : resetIdentity
                ? t("Everything was erased and this phone has a new identity.")
                : t("Your data was erased from this phone.")
            );
          },
        },
      ]
    );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" onPress={() => navigation.goBack()}>
        <Text style={styles.back}>{t("‹ Back")}</Text>
      </TouchableOpacity>
      <Text accessibilityRole="header" style={styles.title}>{t("Settings")}</Text>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t("Language")}</Text>
        {LANGUAGE_CHOICES.map(([value, label, hint]) => (
          <TouchableOpacity hitSlop={HIT_SLOP}
            key={value}
            style={styles.row}
            onPress={() => setLanguagePreference(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: languagePreference === value }}
            accessibilityLabel={hint ? `${t(label)}. ${t(hint)}` : label}
          >
            <Text style={styles.radio}>{languagePreference === value ? "●" : "○"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{hint ? t(label) : label}</Text>
              {hint ? <Text style={styles.meta}>{t(hint)}</Text> : null}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t("Distances")}</Text>
        {CHOICES.map(([value, label, hint]) => (
          <TouchableOpacity hitSlop={HIT_SLOP}
            key={value}
            style={styles.row}
            onPress={() => setPreference(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: preference === value }}
            accessibilityLabel={`${t(label)}. ${t(hint)}`}
          >
            <Text style={styles.radio}>{preference === value ? "●" : "○"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{t(label)}</Text>
              <Text style={styles.meta}>{t(hint)}</Text>
            </View>
          </TouchableOpacity>
        ))}
        <Text style={styles.meta}>{t("Showing 1,000 metres as {distance}.", { distance: formatDistance(1000, units) })}</Text>
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t("Your data on this phone")}</Text>
        <Text style={styles.meta}>
          {t("Everything stays on this phone unless you attach it to a message. You can erase it here: for example before handing the phone to someone else.")}
        </Text>
        <TouchableOpacity
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityState={{ disabled: erasing }}
          disabled={erasing}
          style={[styles.danger, erasing && { opacity: 0.5 }]}
          onPress={() => confirmErase(false)}
        >
          <Text style={styles.dangerText}>{t("Erase my data")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityState={{ disabled: erasing }}
          disabled={erasing}
          style={[styles.danger, erasing && { opacity: 0.5 }]}
          onPress={() => confirmErase(true)}
        >
          <Text style={styles.dangerText}>{t("Erase everything and get a new identity")}</Text>
        </TouchableOpacity>
        {erased ? <Text accessibilityLiveRegion="polite" style={styles.done}>{erased}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC", paddingTop: 56, paddingHorizontal: 16 },
  back: { color: "#2563EB", fontSize: 16, fontWeight: "600", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#0F172A", marginBottom: 14 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E2E8F0" },
  radio: { fontSize: 20, color: "#2563EB", width: 30 },
  name: { fontSize: 15, fontWeight: "600", color: "#0F172A" },
  meta: { color: "#64748B", fontSize: 12, marginTop: 4 },
  danger: { borderWidth: 1.5, borderColor: "#B91C1C", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, alignItems: "center", marginTop: 12 },
  dangerText: { color: "#B91C1C", fontWeight: "700", fontSize: 15, textAlign: "center" },
  done: { color: "#334155", fontSize: 13, lineHeight: 18, marginTop: 12 },
});
