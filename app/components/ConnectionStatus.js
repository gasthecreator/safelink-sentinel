// app/components/ConnectionStatus.js
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, AccessibilityInfo } from "react-native";
import * as Animatable from "react-native-animatable";

export default function ConnectionStatus({ health, peersCount }) {
  // the status dot pulses for ever; people who asked their phone for less motion do not get that
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub && sub.remove && sub.remove();
  }, []);
  const status = health?.reliabilityScore || "Good";
  const successRate = health?.successRate || 0;
  
  let color = "#10B981"; // green
  if (status === "Warning") color = "#F59E0B";
  if (status === "Critical") color = "#EF4444";

  const summary =
    status === "Critical" ? "Unstable connection" : status === "Warning" ? "Some delays" : "Connected and stable";
  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`Mesh network: ${summary}. ${peersCount} ${peersCount === 1 ? "device" : "devices"} nearby. ${successRate} percent of messages delivered.`}
    >
      <View style={styles.left}>
        <Animatable.View
          animation={reduceMotion ? undefined : "pulse"}
          iterationCount="infinite"
          duration={1500}
          easing="ease-in-out"
          style={[
            styles.dot,
            {
              backgroundColor: color,
              shadowColor: color,
              shadowOpacity: 0.8,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 0 },
            },
          ]}
        />
        <View>
          <Text style={styles.title}>Mesh Network</Text>
          <Text style={styles.subtitle}>
            {status === "Critical"
              ? "Unstable connection"
              : status === "Warning"
              ? "Some delays"
              : "Connected and stable"}
          </Text>
        </View>
      </View>
      <View style={styles.right}>
        <View style={styles.badge}>
          <Text style={styles.badgeIcon}>👥</Text>
          <Text style={styles.badgeText}>{peersCount} devices</Text>
        </View>
        <Text style={styles.meta}>{successRate}% delivery</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "#1E3A8A",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "space-between",
    // with very large text the two halves go on separate lines instead of being cut off
    flexWrap: "wrap",
    rowGap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 10,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  subtitle: {
    color: "#BFDBFE",
    fontSize: 12,
    marginTop: 2,
  },
  right: {
    alignItems: "flex-end",
  },
  badge: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  badgeIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  meta: {
    color: "#93C5FD",
    fontSize: 11,
    marginTop: 4,
  },
});

