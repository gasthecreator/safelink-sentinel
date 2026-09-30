// app/components/OfflineSyncModal.js
import React from "react";
import { Modal, View, Text, StyleSheet, ActivityIndicator } from "react-native";

export default function OfflineSyncModal({ visible, queuedCount }) {
  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.title}>Offline mode</Text>
          <Text style={styles.text}>
            Your messages are safely stored on this device and will sync
            automatically when another SafeLink device is nearby.
          </Text>
          <Text style={styles.counter}>
            Queued messages: <Text style={styles.counterStrong}>{queuedCount}</Text>
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  box: {
    backgroundColor: "#FFFFFF",
    padding: 24,
    borderRadius: 20,
    width: "85%",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    color: "#1E293B",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 16,
    marginBottom: 8,
  },
  text: {
    color: "#64748B",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
    lineHeight: 20,
  },
  counter: {
    marginTop: 16,
    color: "#475569",
    fontSize: 14,
  },
  counterStrong: {
    color: "#F97316",
    fontWeight: "700",
    fontSize: 16,
  },
});

