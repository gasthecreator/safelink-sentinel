// app/screens/SendMessageScreen.js
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Switch,
  SafeAreaView,
  ScrollView,
} from "react-native";
import * as Animatable from "react-native-animatable";
import LinearGradient from "react-native-linear-gradient";
import { getPositionForAlert } from "../services/location/LocationService";
import { describeLocationOutcome } from "../services/location/position";

const PRIORITIES = ["critical", "high", "normal", "low"];

const PRIORITY_COLORS = {
  critical: "#EF4444",
  high: "#F97316",
  normal: "#10B981",
  low: "#3B82F6",
};

export default function SendMessageScreen({ route, navigation }) {
  const mode = route.params?.mode || "status";
  const [text, setText] = useState("");
  const [priority, setPriority] = useState("normal");
  const [includeLocation, setIncludeLocation] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [sent, setSent] = useState(false);
  const [resultText, setResultText] = useState("Message sent!");
  const [delivered, setDelivered] = useState(true);

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
      
      // GPS needs no internet, but it can take a while to get a first fix, so the
      // button says what it is doing. A failure here never stops the message.
      let fix = null;
      if (includeLocation) {
        setLocating(true);
        try {
          fix = await getPositionForAlert();
        } finally {
          setLocating(false);
        }
      }
      const position = fix?.position || null;

      let summary;
      if (mode === "relief") {
        // Create relief request and alert
        const result = await MeshManager.createReliefRequest(senderId, {
          title: text.split("\n")[0].slice(0, 80),
          description: text,
          priority,
          location: position,
        });
        summary = result?.summary;
        console.log("[SendMessageScreen] Relief request created:", result?.request?.id);
      } else {
        // Broadcast status update
        summary = await MeshManager.broadcastAlert(senderId, text, { priority, position });
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
        <Text style={styles.locationNote}>
          {includeLocation
            ? "Uses GPS, which works without internet. Every nearby phone that receives your message can see where you are."
            : "Your message will be sent without a location."}
        </Text>

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

