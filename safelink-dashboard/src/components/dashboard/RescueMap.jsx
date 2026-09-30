// src/components/dashboard/RescueMap.jsx

import React from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./RescueMap.css";

// Fix for default marker icons in React Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

export default function RescueMap({ rescues, onMarkerClick }) {
  if (!rescues || rescues.length === 0) {
    return (
      <div className="mapContainer mapContainer--empty">
        <p>No rescue locations recorded yet.</p>
      </div>
    );
  }

  // Find first rescue with coordinates
  const first = rescues.find(r => r.latitude && r.longitude);
  
  if (!first) {
    return (
      <div className="mapContainer mapContainer--empty">
        <p>No rescue locations with coordinates recorded yet.</p>
      </div>
    );
  }

  const center = {
    lat: first.latitude || 37.7749,
    lng: first.longitude || -122.4194,
  };

  // Custom marker icons
  const getMarkerIcon = (type) => {
    const color = type === "HELP_REQUEST" ? "#ef4444" : "#3b82f6";
    return L.divIcon({
      className: "custom-map-marker",
      html: `<div style="
        width: 24px;
        height: 24px;
        background: ${color};
        border: 3px solid white;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      "></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 24],
    });
  };

  return (
    <div className="mapContainer">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={12}
        scrollWheelZoom={true}
        className="mapContainer__map"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap contributors"
        />
        {rescues
          .filter(r => r.latitude && r.longitude)
          .map((r) => (
            <Marker
              key={r.id}
              position={[r.latitude, r.longitude]}
              icon={getMarkerIcon(r.type)}
              eventHandlers={{
                click: () => {
                  if (onMarkerClick) {
                    onMarkerClick(r);
                  }
                },
              }}
            >
              <Popup>
                <div style={{ minWidth: "200px" }}>
                  <strong style={{ display: "block", marginBottom: "8px" }}>
                    {r.type === "HELP_REQUEST" ? "Help Request" : r.type}
                  </strong>
                  {r.natureOfHelp && (
                    <div style={{ marginBottom: "8px", fontSize: "13px", color: "#1e293b", fontWeight: "600" }}>
                      {r.natureOfHelp}
                    </div>
                  )}
                  {r.distanceKm && (
                    <div style={{ marginBottom: "4px", fontSize: "12px" }}>
                      📍 {r.distanceKm.toFixed(1)} km away
                    </div>
                  )}
                  {r.etaMinutes && (
                    <div style={{ marginBottom: "4px", fontSize: "12px" }}>
                      ⏱️ ETA: {r.etaMinutes} min
                    </div>
                  )}
                  <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>
                    {new Date(r.timestamp).toLocaleString()}
                  </div>
                  {onMarkerClick && (
                    <button
                      onClick={() => onMarkerClick(r)}
                      style={{
                        marginTop: "8px",
                        padding: "6px 12px",
                        background: "#3b82f6",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        width: "100%",
                        fontSize: "12px",
                        fontWeight: "600",
                      }}
                    >
                      View Route
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
      </MapContainer>
    </div>
  );
}

