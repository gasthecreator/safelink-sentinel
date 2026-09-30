// app/components/NearbyDevices.js
import React from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import * as Animatable from "react-native-animatable";

function PeerRow({ peer, index }) {
  const strength =
    peer.rssi >= -60 ? "Strong" : peer.rssi >= -75 ? "Medium" : "Weak";
  
  const strengthColor = 
    peer.rssi >= -60 ? "#10B981" : peer.rssi >= -75 ? "#F59E0B" : "#EF4444";

  return (
    <Animatable.View
      animation="fadeInRight"
      delay={index * 150}
      duration={600}
    >
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <View style={[styles.deviceDot, { backgroundColor: strengthColor }]} />
          <View>
            <Text style={styles.name}>{peer.name || "Unknown device"}</Text>
            <Text style={styles.meta}>
              {strength} • {peer.distance ? `${peer.distance}m` : "distance n/a"}
            </Text>
          </View>
        </View>
        <Text style={styles.rssi}>{peer.rssi} dBm</Text>
      </View>
    </Animatable.View>
  );
}

export default function NearbyDevices({ peers }) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Nearby devices</Text>
        <Text style={styles.count}>{peers.length} connected</Text>
      </View>
      {peers.length === 0 ? (
        <Text style={styles.empty}>
          No nearby devices yet. Keep the app open to join a mesh.
        </Text>
      ) : (
        <FlatList
          data={peers}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <PeerRow peer={item} index={index} />}
          scrollEnabled={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 18,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    alignItems: "center",
  },
  title: {
    color: "#1E3A8A",
    fontSize: 15,
    fontWeight: "600",
  },
  count: {
    color: "#64748B",
    fontSize: 12,
  },
  empty: {
    color: "#94A3B8",
    fontSize: 13,
    marginTop: 6,
    textAlign: "center",
    padding: 20,
  },
  row: {
    paddingVertical: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomColor: "#E2E8F0",
    borderBottomWidth: 1,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  deviceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  name: {
    color: "#1E293B",
    fontSize: 14,
    fontWeight: "500",
  },
  meta: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 2,
  },
  rssi: {
    color: "#94A3B8",
    fontSize: 12,
  },
});

