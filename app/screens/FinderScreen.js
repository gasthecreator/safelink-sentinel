// app/screens/FinderScreen.js
// "Find them": follows the sender's Bluetooth signal so you can walk toward them. Works
// only when their phone is within Bluetooth range (tens of metres); further away, use
// their position and note. It reports a coarse band and warmer/colder, not metres,
// because signal strength can't honestly give a distance.

import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import NodeDiscovery from "../services/mesh/NodeDiscovery";
import { RssiTracker, BANDS } from "../services/proximity/RssiTracker";
import { t, N_ } from "../services/i18n/i18n";
import { useLanguage } from "../services/i18n/LanguageStore";

// small buttons stay easy to hit: the touch area is 10 points bigger on every side
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

const BAND_COLORS = { here: "#16A34A", close: "#65A30D", near: "#D97706", far: "#DC2626" };
const TREND_TEXT = {
  warmer: N_("Getting closer ▲"),
  colder: N_("Moving away ▼"),
  steady: N_("No change"),
};

export default function FinderScreen() {
  useLanguage(); // re-render in the new language when it is changed
  const navigation = useNavigation();
  const { alert } = useRoute().params;
  const trackerRef = useRef(new RssiTracker());
  const [view, setView] = useState({ state: "searching" });
  const [available, setAvailable] = useState(null); // null = deciding, false = not in range

  useEffect(() => {
    const tracker = trackerRef.current;
    const stop = NodeDiscovery.startTracking(alert.senderId, (rssi) => tracker.add(rssi));
    setAvailable(!!stop);
    const timer = setInterval(() => setView(tracker.summary()), 700);
    return () => {
      clearInterval(timer);
      stop?.();
    };
  }, [alert.senderId]);

  return (
    <View style={styles.container}>
      <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" onPress={() => navigation.goBack()}>
        <Text style={styles.back}>{t("← Back")}</Text>
      </TouchableOpacity>
      <Text accessibilityRole="header" style={styles.title}>{alert.title ? t("Find \"{name}\"", { name: alert.title }) : t("Find the sender")}</Text>

      {available === false ? (
        <View style={styles.card}>
          <Text style={styles.big}>{t("Not in Bluetooth range yet")}</Text>
          <Text style={styles.body}>
            {t("Their phone hasn't been heard nearby recently. Bluetooth only reaches tens of metres, so use their position or their own words to get closer, and try again when you are near.")}
          </Text>
          {alert.where ? <Text style={styles.note}>{t("They said: {where}", { where: alert.where })}</Text> : null}
        </View>
      ) : (
        <View style={styles.card}>
          {view.state === "tracking" ? (
            <>
              <Text style={[styles.big, { color: BAND_COLORS[view.band.id] }]}>{t(view.band.label)}</Text>
              <Text style={styles.body}>{t(view.band.hint)}</Text>
              <View style={styles.meter}>
                {BANDS.slice()
                  .reverse()
                  .map((b) => (
                    <View
                      key={b.id}
                      style={[
                        styles.meterBar,
                        BANDS.indexOf(b) <= BANDS.indexOf(view.band) && {
                          backgroundColor: BAND_COLORS[view.band.id],
                        },
                      ]}
                    />
                  ))}
              </View>
              <Text style={styles.trend}>{view.trend ? t(TREND_TEXT[view.trend]) : t("Walk a few steps to see the trend")}</Text>
              <Text style={styles.small}>{t("Signal {dbm} dBm", { dbm: view.smoothed })}</Text>
            </>
          ) : view.state === "lost" ? (
            <>
              <Text style={[styles.big, { color: BAND_COLORS.far }]}>{t("Signal lost")}</Text>
              <Text style={styles.body}>
                {t("Their phone hasn't been heard for a few seconds. They may be out of range, or something is blocking the signal. Move and try again.")}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.big}>{t("Listening for their phone...")}</Text>
              <Text style={styles.body}>{t("Keep the app open and stay still for a moment.")}</Text>
            </>
          )}
        </View>
      )}

      <Text style={styles.disclaimer}>
        {t("Signal strength is only a rough guide. Walls, bodies and how a phone is held change it a lot, so trust \"closer / further\" more than the band, and use your eyes and their position.")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220", padding: 20, paddingTop: 60 },
  back: { color: "#38BDF8", fontSize: 16, fontWeight: "600", marginBottom: 14 },
  title: { color: "#F8FAFC", fontSize: 22, fontWeight: "800", marginBottom: 16 },
  card: { backgroundColor: "#111C30", borderRadius: 16, padding: 20 },
  big: { color: "#F8FAFC", fontSize: 32, fontWeight: "800", marginBottom: 6 },
  body: { color: "#CBD5E1", fontSize: 16, lineHeight: 22 },
  note: { color: "#F8FAFC", fontSize: 16, marginTop: 14, fontWeight: "600" },
  meter: { flexDirection: "row", marginVertical: 18 },
  meterBar: { flex: 1, height: 14, borderRadius: 7, backgroundColor: "#1E293B", marginRight: 6 },
  trend: { color: "#F8FAFC", fontSize: 22, fontWeight: "700", marginBottom: 6 },
  small: { color: "#94A3B8", fontSize: 13 },
  disclaimer: { color: "#94A3B8", fontSize: 13, lineHeight: 18, marginTop: 18 },
});
