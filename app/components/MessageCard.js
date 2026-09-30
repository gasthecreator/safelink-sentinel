// app/components/MessageCard.js
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import * as Animatable from "react-native-animatable";

const PRIORITY_COLORS = {
  critical: "#EF4444",
  high: "#F97316",
  normal: "#10B981",
  low: "#3B82F6",
};

export default function MessageCard({ 
  title, 
  body, 
  priority, 
  locationLabel, 
  time, 
  location, 
  address,
  onPress,
  navigation 
}) {
  const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.normal;

  const CardContent = (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.priorityDot, { backgroundColor: color }]} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.footer}>
        {locationLabel || address ? (
          <Text style={styles.meta}>📍 {address || locationLabel}</Text>
        ) : null}
        {time ? <Text style={styles.meta}>🕐 {time}</Text> : null}
        {(location || onPress || navigation) && (
          <Text style={styles.navigateHint}>Tap to navigate →</Text>
        )}
      </View>
    </View>
  );

  // If wrapped in TouchableOpacity from parent, just render the card
  if (onPress || (navigation && location)) {
    return (
      <Animatable.View
        animation="fadeInUp"
        duration={800}
        easing="ease-out-cubic"
        useNativeDriver
      >
        {CardContent}
      </Animatable.View>
    );
  }

  return (
    <Animatable.View
      animation="fadeInUp"
      duration={800}
      easing="ease-out-cubic"
      useNativeDriver
    >
      {CardContent}
    </Animatable.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: "#3B82F6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  title: {
    color: "#1E293B",
    fontSize: 14,
    fontWeight: "600",
  },
  body: {
    color: "#475569",
    fontSize: 13,
    marginBottom: 8,
    lineHeight: 20,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  meta: {
    color: "#94A3B8",
    fontSize: 11,
  },
  navigateHint: {
    color: "#3B82F6",
    fontSize: 11,
    fontWeight: "500",
    marginLeft: "auto",
  },
});

