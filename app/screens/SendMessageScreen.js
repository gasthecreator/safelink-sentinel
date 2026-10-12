// app/screens/SendMessageScreen.js
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Switch,
  SafeAreaView,
  ScrollView,
  Alert,
} from "react-native";
import * as Animatable from "react-native-animatable";
import LinearGradient from "react-native-linear-gradient";
import { resolveAlertLocation } from "../services/location/resolveLocation";
import { listPlaces } from "../services/location/PlaceStore";
import { describeLocationOutcome, describePosition } from "../services/location/position";

const PRIORITIES = ["critical", "high", "normal", "low"];

const PRIORITY_COLORS = {
  critical: "#EF4444",
  high: "#F97316",
  normal: "#10B981",
  low: "#3B82F6",
};

// GPS has no position: let the sender choose rather than guessing for them.
function askNoFix(fix) {
  const why =
    fix.reason === "denied"
      ? "Location permission was declined."
      : "The phone could not get a GPS fix. Try near a window or outdoors.";
  return new Promise((resolve) => {
    Alert.alert(
      "No GPS position",
      `${why}\n\nYou can send without a position, or use a place you saved earlier.`,
      [
        { text: "Send without position", onPress: () => resolve("send") },
        { text: "Use a saved place", onPress: () => resolve("places") },
        { text: "Cancel", style: "cancel", onPress: () => resolve("cancel") },
      ],
      { cancelable: true, onDismiss: () => resolve("cancel") }
    );
  });
}

export default function SendMessageScreen({ route, navigation }) {
  const mode = route.params?.mode || "status";
  const [text, setText] = useState("");
  const [priority, setPriority] = useState("normal");
  const [includeLocation, setIncludeLocation] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [source, setSource] = useState("gps"); // "gps" or "place"
  const [places, setPlaces] = useState([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const [where, setWhere] = useState("");
  const [sent, setSent] = useState(false);
  const [resultText, setResultText] = useState("Message sent!");
  const [delivered, setDelivered] = useState(true);

  // Saved places can change on the Places screen, so reload when coming back here.
  useEffect(() => {
    const load = () => listPlaces().then(setPlaces).catch(() => {});
    load();
    return navigation.addListener("focus", load);
  }, [navigation]);

  const title = mode === "relief" ? "Request help" : "Send status update";
  const placeholder =
    mode === "relief"
      ? "Describe what you need, how many people are affected, and any urgent risks."
      : "Example: I'm safe at the school shelter, I can help with first aid.";

  const onAutoPriority = () => {
    // Simple auto-detection
    const lower = text.toLowerCase();
    if (lower.includes("emergency") || lower.includes("urgent")) {
      setPriority("critical");
    } else if (lower.includes("need") || lower.includes("help")) {
      setPriority("high");
    } else {
      setPriority("normal");
    }
  };

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    
    try {
      // Import MeshManager dynamically to avoid circular deps
      const MeshManager = (await import("../services/mesh/MeshManager")).default;
      const IdentityManager = (await import("../services/crypto/IdentityManager")).default;
      
      // Get sender ID
      const senderId = await IdentityManager.getMyId();
      
      // Work out the position to attach. GPS needs no internet, but a first fix can
      // take a while, so the button says what it is doing. If GPS has no fix the
      // user decides what to do; a failure here never silently drops the message.
      const place = places.find((p) => p.id === selectedPlaceId);
      if (includeLocation && source === "place" && !place) {
        Alert.alert("Choose a place", "Pick one of your saved places, or switch back to GPS.");
        setSubmitting(false);
        return;
      }
      if (includeLocation && source === "gps") setLocating(true);
      let resolved;
      try {
        resolved = await resolveAlertLocation(
          { include: includeLocation, source, place },
          { onNoFix: askNoFix }
        );
      } finally {
        setLocating(false);
      }
      if (resolved.cancelled) {
        if (resolved.switchToPlaces) setSource("place");
        setSubmitting(false);
        return;
      }
      const fix = resolved.fix;
      const position = fix?.position || null;

      let summary;
      if (mode === "relief") {
        // Create relief request and alert
        const result = await MeshManager.createReliefRequest(senderId, {
          title: text.split("\n")[0].slice(0, 80),
          description: text,
          priority,
          location: position,
          where,
        });
        summary = result?.summary;
        console.log("[SendMessageScreen] Relief request created:", result?.request?.id);
      } else {
        // Broadcast status update
        summary = await MeshManager.broadcastAlert(senderId, text, { priority, position, where });
        console.log("[SendMessageScreen] Alert broadcast:", summary);
      }

      // Report what actually happened. Messages are kept and sent to anyone who
      // comes into range later, so "nobody here yet" is not a failure, but it is
      // also not delivery, and the screen must say which one it is.
      const reached = summary?.success || 0;
      const ok = reached > 0;
      setDelivered(ok);
      const deliveryText = ok
        ? `Delivered to ${reached} nearby device${reached === 1 ? "" : "s"}. It will also go to devices that come into range later.`
        : summary?.queued
        ? "Not delivered yet: no one is in range. It is saved and will be sent automatically when a device comes into range (kept for 24 hours)."
        : "No nearby devices in range. Nothing was sent.";
      setResultText(includeLocation ? `${deliveryText} ${describeLocationOutcome(fix)}` : deliveryText);
      setSent(true);
      setSubmitting(false);

      setTimeout(() => {
        setSent(false);
        if (ok) navigation.goBack();
      }, ok ? 3500 : 6000);
    } catch (error) {
      console.error("[SendMessageScreen] Send error:", error);
      setSubmitting(false);
      setDelivered(false);
      setResultText("Something went wrong. Your message was not sent.");
      setSent(true);
      setTimeout(() => setSent(false), 4000);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={["#F8FAFC", "#E0E7FF"]}
        style={styles.gradientContainer}
      >
        <ScrollView style={styles.container}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>
          Your message will travel across nearby devices, even without the internet.
        </Text>

        {sent && (
          <Animatable.View
            animation="bounceIn"
            duration={600}
            iterationCount={1}
            style={styles.successContainer}
          >
            <Text style={styles.successIcon}>{delivered ? "✅" : "⚠️"}</Text>
            <Text style={[styles.successText, !delivered && { color: "#B45309" }]}>{resultText}</Text>
          </Animatable.View>
        )}

        <TextInput
          style={styles.input}
          editable={!submitting}
          multiline
          placeholder={placeholder}
          placeholderTextColor="#94A3B8"
          value={text}
          onChangeText={setText}
        />

        <View style={styles.row}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.pillRow}>
            {PRIORITIES.map((p) => (
              <TouchableOpacity
                key={p}
                disabled={submitting}
                onPress={() => setPriority(p)}
                style={[
                  styles.pill,
                  priority === p && { 
                    backgroundColor: PRIORITY_COLORS[p],
                    borderColor: PRIORITY_COLORS[p]
                  },
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    priority === p && styles.pillTextActive,
                  ]}
                >
                  {p}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Include my location</Text>
          <Switch
            value={includeLocation}
            onValueChange={setIncludeLocation}
            trackColor={{ false: "#CBD5E1", true: "#93C5FD" }}
            thumbColor={includeLocation ? "#3B82F6" : "#F1F5F9"}
          />
        </View>
        {includeLocation ? (
          <>
            <View style={styles.sourceRow}>
              {[
                ["gps", "GPS"],
                ["place", "A saved place"],
              ].map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.sourceChip, source === value && styles.sourceChipActive]}
                  onPress={() => setSource(value)}
                >
                  <Text style={[styles.sourceChipText, source === value && styles.sourceChipTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {source === "place" ? (
              <View style={styles.placesBox}>
                {places.length === 0 ? (
                  <Text style={styles.locationNote}>
                    You have no saved places yet. Save one while you have a GPS fix.
                  </Text>
                ) : (
                  places.map((place) => {
                    const chosen = place.id === selectedPlaceId;
                    return (
                      <TouchableOpacity
                        key={place.id}
                        style={[styles.placeRow, chosen && styles.placeRowChosen]}
                        onPress={() => setSelectedPlaceId(place.id)}
                      >
                        <Text style={styles.placeRowName}>
                          {chosen ? "● " : "○ "}
                          {place.name}
                        </Text>
                        <Text style={styles.placeRowMeta}>{describePosition(place)?.coords}</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
                <TouchableOpacity onPress={() => navigation.navigate("Places")}>
                  <Text style={styles.manageLink}>Manage saved places</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <Text style={styles.locationNote}>
              {source === "gps"
                ? "Uses GPS, which works without internet. Every nearby phone that receives your message can see where you are."
                : "Uses the place you choose. Every nearby phone that receives your message can see it."}
            </Text>
          </>
        ) : (
          <Text style={styles.locationNote}>Your message will be sent without a position.</Text>
        )}

        <Text style={styles.label}>Where are you? (optional)</Text>
        <TextInput
          style={styles.whereInput}
          value={where}
          onChangeText={setWhere}
          placeholder="e.g. 2nd floor, behind the pharmacy"
          maxLength={200}
          editable={!submitting}
        />

        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          disabled={submitting}
          onPress={handleSubmit}
        >
          <Text style={styles.buttonText}>
            {locating ? "Getting your location..." : submitting ? "Sending..." : "Send message"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onAutoPriority} disabled={!text.trim()}>
          <Text style={styles.autoLink}>
            🤖 Auto-detect priority from message
          </Text>
        </TouchableOpacity>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sourceRow: { flexDirection: "row", marginBottom: 10 },
  sourceChip: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginRight: 8,
    backgroundColor: "#fff",
  },
  sourceChipActive: { backgroundColor: "#3B82F6", borderColor: "#3B82F6" },
  sourceChipText: { color: "#334155", fontWeight: "600" },
  sourceChipTextActive: { color: "#fff" },
  placesBox: { marginBottom: 6 },
  placeRow: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  placeRowChosen: { borderColor: "#3B82F6", backgroundColor: "#EFF6FF" },
  placeRowName: { fontSize: 15, fontWeight: "600", color: "#0F172A" },
  placeRowMeta: { fontSize: 12, color: "#64748B", marginTop: 2 },
  manageLink: { color: "#3B82F6", fontSize: 13, marginVertical: 6, textDecorationLine: "underline" },
  whereInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 16,
    color: "#0F172A",
  },
  locationNote: { color: "#64748B", fontSize: 12.5, marginTop: -6, marginBottom: 14, lineHeight: 17 },
  safeArea: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  gradientContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 16,
  },
  backButton: {
    marginBottom: 12,
  },
  backText: {
    color: "#3B82F6",
    fontSize: 16,
    fontWeight: "600",
  },
  title: {
    color: "#1E293B",
    fontSize: 24,
    fontWeight: "700",
  },
  subtitle: {
    color: "#64748B",
    fontSize: 13,
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 18,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#E2E8F0",
    color: "#1E293B",
    padding: 14,
    fontSize: 14,
    minHeight: 140,
    textAlignVertical: "top",
  },
  row: {
    marginTop: 18,
  },
  label: {
    color: "#1E293B",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
  },
  pillText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "500",
  },
  pillTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  button: {
    backgroundColor: "#10B981",
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 28,
    shadowColor: "#10B981",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  autoLink: {
    color: "#3B82F6",
    fontSize: 13,
    marginTop: 16,
    textAlign: "center",
  },
  successContainer: {
    alignItems: "center",
    marginVertical: 10,
  },
  successIcon: {
    fontSize: 60,
    marginBottom: 8,
  },
  successText: {
    color: "#10B981",
    fontSize: 16,
    fontWeight: "700",
  },
});

