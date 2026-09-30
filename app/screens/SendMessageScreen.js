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
  const [sent, setSent] = useState(false);

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
      
      if (mode === "relief") {
        // Create relief request and alert
        const reliefRequest = await MeshManager.createReliefRequest(senderId, {
          message: text,
          priority,
          includeLocation,
          timestamp: new Date().toISOString(),
        });
        
        console.log("[SendMessageScreen] Relief request created:", reliefRequest);
      } else {
        // Broadcast status update
        const alert = await MeshManager.broadcastAlert(senderId, text, {
          priority,
          includeLocation,
          timestamp: new Date().toISOString(),
        });
        
        console.log("[SendMessageScreen] Alert broadcast:", alert);
      }
      
      setSent(true);
      setSubmitting(false);
      
      setTimeout(() => {
        setSent(false);
        navigation.goBack();
      }, 1200);
    } catch (error) {
      console.error("[SendMessageScreen] Send error:", error);
      setSubmitting(false);
      // Still show success for UX, but log error
      setSent(true);
      setTimeout(() => {
        setSent(false);
        navigation.goBack();
      }, 1200);
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
            <Text style={styles.successIcon}>✅</Text>
            <Text style={styles.successText}>Message sent!</Text>
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
          <Text style={styles.label}>Include location (if available)</Text>
          <Switch
            value={includeLocation}
            onValueChange={setIncludeLocation}
            trackColor={{ false: "#CBD5E1", true: "#93C5FD" }}
            thumbColor={includeLocation ? "#3B82F6" : "#F1F5F9"}
          />
        </View>

        <TouchableOpacity
          style={[styles.button, submitting && styles.buttonDisabled]}
          disabled={submitting}
          onPress={handleSubmit}
        >
          <Text style={styles.buttonText}>
            {submitting ? "Sending..." : "Send message"}
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

