// app/screens/PeerListScreen.js
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as Animatable from "react-native-animatable";
import LinearGradient from "react-native-linear-gradient";

export default function PeerListScreen() {
  const [peers, setPeers] = useState([
    { id: "11:22:33:44:55:66", name: "Alpha Node", rssi: -45, distance: "1.2" },
    { id: "77:88:99:AA:BB:CC", name: "Bravo Node", rssi: -62, distance: "3.8" },
    { id: "DE:AD:BE:EF:FE:ED", name: "Charlie Node", rssi: -78, distance: "8.5" },
  ]);
  const navigation = useNavigation();

  const renderPeer = ({ item, index }) => {
    const strength =
      item.rssi >= -60 ? "#10B981" : item.rssi >= -75 ? "#F59E0B" : "#EF4444";

    return (
      <Animatable.View
        animation="fadeInRight"
        delay={index * 150}
        duration={600}
      >
        <View style={styles.peerRow}>
          <View style={styles.peerLeft}>
            <Text style={[styles.deviceIcon, { color: strength }]}>📱</Text>
            <View>
              <Text style={styles.peerName}>{item.name || "Unknown Node"}</Text>
              <Text style={styles.meta}>
                ID: {item.id.substring(0, 6)}...  |  {item.distance ? `${item.distance}m` : "N/A"}
              </Text>
            </View>
          </View>
          <Text style={[styles.rssi, { color: strength }]}>{item.rssi} dBm</Text>
        </View>
      </Animatable.View>
    );
  };

  return (
    <LinearGradient
      colors={["#F8FAFC", "#E0E7FF"]}
      style={styles.container}
    >
      <Text style={styles.title}>Connected Devices</Text>
      <Text style={styles.subtitle}>
        These are nearby SafeLink nodes currently within your mesh range.
      </Text>
      {peers.length === 0 ? (
        <Text style={styles.empty}>No connected devices detected.</Text>
      ) : (
        <FlatList
          data={peers}
          renderItem={({ item, index }) => renderPeer({ item, index })}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.backButton}
      >
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 18,
    paddingTop: 50,
  },
  title: {
    color: "#1E293B",
    fontSize: 24,
    fontWeight: "700",
  },
  subtitle: {
    color: "#64748B",
    fontSize: 13,
    marginBottom: 20,
    marginTop: 4,
  },
  peerRow: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  peerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  deviceIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  peerName: {
    color: "#1E293B",
    fontSize: 15,
    fontWeight: "600",
  },
  meta: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 4,
  },
  rssi: {
    fontSize: 13,
    fontWeight: "600",
  },
  empty: {
    color: "#94A3B8",
    fontSize: 14,
    marginTop: 40,
    textAlign: "center",
  },
  backButton: {
    marginTop: 20,
    alignSelf: "center",
    borderWidth: 2,
    borderColor: "#3B82F6",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: "#FFFFFF",
  },
  backText: {
    color: "#3B82F6",
    fontWeight: "700",
    fontSize: 15,
  },
});

