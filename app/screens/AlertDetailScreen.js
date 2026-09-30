// app/screens/AlertDetailScreen.js

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  Alert,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import Geolocation from "@react-native-community/geolocation";
import { useRoute, useNavigation } from "@react-navigation/native";

import {
  distanceKm,
  estimateETA,
  formatETAMinutes,
  getRouteBetweenPoints,
} from "../utils/GeoUtils.js";
import RescueLogger from "../services/storage/RescueLogger.js";
import AlertManager from "../services/mesh/AlertManager.js";

const HELPER_ID = "device-volunteer"; // later: replace with real identity

export default function AlertDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { alert } = route.params;

  const [currentLocation, setCurrentLocation] = useState(null);
  const [routeCoords, setRouteCoords] = useState([]);
  const [distance, setDistance] = useState(null);
  const [etaMinutes, setEtaMinutes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    loadRoute();
  }, []);

  const loadRoute = async () => {
    try {
      setLoading(true);

      // Request location permission
      if (Platform.OS === "android") {
        const { PermissionsAndroid } = require("react-native");
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert(
            "Location Permission",
            "Location permission is required for navigation. You can still view the destination."
          );
          setLoading(false);
          if (alert.location) {
            setCurrentLocation(alert.location);
          }
          return;
        }
      }

      // Get current position
      Geolocation.getCurrentPosition(
        async (position) => {
          const coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          setCurrentLocation(coords);

          if (alert.location) {
            const distKm = distanceKm(coords, alert.location);
            setDistance(distKm);
            setEtaMinutes(estimateETA(distKm, "walk"));

            const line = await getRouteBetweenPoints(coords, alert.location);
            setRouteCoords(line);
          }

          setLoading(false);
        },
        (error) => {
          console.error("Location error:", error);
          Alert.alert(
            "Location Permission",
            "Location permission is required for navigation. You can still view the destination."
          );
          setLoading(false);
          // Show destination only if location denied
          if (alert.location) {
            setCurrentLocation(alert.location);
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        }
      );
    } catch (err) {
      console.error("Map error:", err);
      setLoading(false);
      if (alert.location) {
        setCurrentLocation(alert.location);
      }
    }
  };

  const openExternalMap = () => {
    const { latitude, longitude } = alert.location;
    let url;

    if (Platform.OS === "ios") {
      url = `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=w`;
    } else {
      url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=walking`;
    }

    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) {
          return Linking.openURL(url);
        } else {
          // Fallback to web version
          const webUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
          return Linking.openURL(webUrl);
        }
      })
      .catch((err) => {
        console.error("Error opening maps:", err);
        Alert.alert("Error", "Unable to open maps application.");
      });
  };

  const handleAcceptRescue = async () => {
    if (!distance) {
      Alert.alert("Error", "Distance information not available.");
      return;
    }

    try {
      setAccepted(true);

      await RescueLogger.logStartRescue({
        alertId: alert.id,
        reliefId: alert.reliefId || null,
        helperId: HELPER_ID,
        distanceKm: distance,
        etaMinutes,
      });

      // Mark relief as "partial" if linked
      if (alert.reliefId && AlertManager.markReliefStatus) {
        try {
          await AlertManager.markReliefStatus(alert.reliefId, "partial");
        } catch (err) {
          console.error("Error marking relief status:", err);
        }
      }

      Alert.alert("Rescue Accepted", "You have accepted this rescue mission. Safe travels!");
    } catch (err) {
      console.error("Error accepting rescue:", err);
      setAccepted(false);
      Alert.alert("Error", "Failed to accept rescue. Please try again.");
    }
  };

  const handleArrived = async () => {
    try {
      setArrived(true);

      await RescueLogger.logArrival({
        alertId: alert.id,
        reliefId: alert.reliefId || null,
        helperId: HELPER_ID,
      });

      if (alert.reliefId && AlertManager.markReliefStatus) {
        try {
          await AlertManager.markReliefStatus(alert.reliefId, "fulfilled");
        } catch (err) {
          console.error("Error marking relief status:", err);
        }
      }

      Alert.alert("Arrival Logged", "Thank you for your service! Your arrival has been logged.");
    } catch (err) {
      console.error("Error logging arrival:", err);
      setArrived(false);
      Alert.alert("Error", "Failed to log arrival. Please try again.");
    }
  };

  if (loading && !alert.location) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#38BDF8" />
        <Text style={styles.loadingText}>Preparing rescue route...</Text>
      </View>
    );
  }

  const etaLabel = etaMinutes != null ? formatETAMinutes(etaMinutes) : "N/A";
  const distanceLabel =
    distance != null ? `${distance.toFixed(1)} km away` : "Distance unknown";

  // Determine map region to fit both locations
  const mapRegion = (() => {
    if (currentLocation && alert.location) {
      // Calculate center between two points
      const centerLat = (currentLocation.latitude + alert.location.latitude) / 2;
      const centerLng = (currentLocation.longitude + alert.location.longitude) / 2;
      
      // Calculate appropriate delta to show both points
      const latDelta = Math.max(
        Math.abs(currentLocation.latitude - alert.location.latitude) * 2.5,
        0.01
      );
      const lngDelta = Math.max(
        Math.abs(currentLocation.longitude - alert.location.longitude) * 2.5,
        0.01
      );
      
      return {
        latitude: centerLat,
        longitude: centerLng,
        latitudeDelta: Math.max(latDelta, 0.05),
        longitudeDelta: Math.max(lngDelta, 0.05),
      };
    } else if (alert.location) {
      return {
        latitude: alert.location.latitude,
        longitude: alert.location.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    return null;
  })();

  if (!mapRegion) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>No location data available for this alert.</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={mapRegion}
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {currentLocation && (
          <Marker
            coordinate={{
              latitude: currentLocation.latitude,
              longitude: currentLocation.longitude,
            }}
            title="You"
            description="Current position"
            pinColor="#22C55E"
          />
        )}

        <Marker
          coordinate={alert.location}
          title="Rescue location"
          description={alert.address}
          pinColor="#EF4444"
        />

        {routeCoords.length >= 2 && currentLocation && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#3B82F6"
            strokeWidth={5}
            lineDashPattern={[10, 5]}
          />
        )}
      </MapView>

      <View style={styles.infoCard}>
        <View style={styles.header}>
          <Text style={styles.title}>{alert.title || "Rescue Alert"}</Text>
          {alert.priority && (
            <View style={[styles.priorityBadge, styles[`priorityBadge--${alert.priority}`]]}>
              <Text style={styles.priorityText}>{alert.priority.toUpperCase()}</Text>
            </View>
          )}
        </View>
        <Text style={styles.description}>{alert.description || "No description available"}</Text>
        <View style={styles.addressContainer}>
          <Text style={styles.addressLabel}>📍 Location</Text>
          <Text style={styles.address}>{alert.address || "Address not available"}</Text>
          {alert.location && (
            <Text style={styles.coordinates}>
              {alert.location.latitude.toFixed(6)}, {alert.location.longitude.toFixed(6)}
            </Text>
          )}
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Distance</Text>
            <Text style={styles.statValue}>{distanceLabel}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>ETA (walk)</Text>
            <Text style={styles.statValue}>{etaLabel}</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          {!accepted ? (
            <TouchableOpacity
              style={[styles.button, styles.acceptButton]}
              onPress={handleAcceptRescue}
            >
              <Text style={styles.buttonText}>Accept rescue</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.statusPill}>
              <Text style={styles.statusText}>Rescue accepted</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, styles.mapsButton]}
            onPress={openExternalMap}
          >
            <Text style={styles.buttonText}>Open in Google Maps</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.arrivedButton,
            arrived && { backgroundColor: "#16A34A" },
          ]}
          onPress={handleArrived}
          disabled={arrived === true}
        >
          <Text style={styles.arrivedText}>
            {arrived ? "Arrival logged ✅" : "Mark as arrived"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backLink}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backText}>← Back to alerts</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  map: { flex: 1 },
  infoCard: {
    backgroundColor: "#FFFFFF",
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  title: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "700",
    flex: 1,
    marginRight: 12,
  },
  priorityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  "priorityBadge--critical": {
    backgroundColor: "#FEE2E2",
  },
  "priorityBadge--high": {
    backgroundColor: "#FEF3C7",
  },
  "priorityBadge--normal": {
    backgroundColor: "#D1FAE5",
  },
  "priorityBadge--low": {
    backgroundColor: "#DBEAFE",
  },
  priorityText: {
    color: "#1F2937",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  description: {
    color: "#475569",
    marginBottom: 16,
    fontSize: 14,
    lineHeight: 20,
  },
  addressContainer: {
    backgroundColor: "#F8FAFC",
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  addressLabel: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  address: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  coordinates: {
    color: "#94A3B8",
    fontSize: 11,
    fontFamily: "monospace",
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  statLabel: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "700",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  button: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  acceptButton: {
    backgroundColor: "#F97316",
  },
  mapsButton: {
    backgroundColor: "#3B82F6",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 0.3,
  },
  arrivedButton: {
    marginTop: 0,
    backgroundColor: "#10B981",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: "#10B981",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  arrivedText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  statusPill: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#FEF3C7",
    borderWidth: 2,
    borderColor: "#F97316",
  },
  statusText: {
    color: "#92400E",
    fontSize: 13,
    fontWeight: "700",
  },
  backLink: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    alignItems: "center",
  },
  backText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "600",
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    color: "#64748B",
    marginTop: 12,
    fontSize: 14,
    fontWeight: "500",
  },
  errorText: {
    color: "#DC2626",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 24,
    fontWeight: "500",
  },
  backButton: {
    backgroundColor: "#3B82F6",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  backButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
});
