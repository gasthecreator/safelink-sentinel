// src/components/dashboard/RescueDetailModal.jsx

import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import { updateHelpRequestStatus } from "../../api/helpRequestApi";
import "./RescueDetailModal.css";

// Custom icons
const volunteerIcon = L.divIcon({
  className: "custom-marker volunteer-marker",
  html: `<div class="marker-pin volunteer-pin"></div><span>You</span>`,
  iconSize: [30, 42],
  iconAnchor: [15, 42],
});

const rescueIcon = L.divIcon({
  className: "custom-marker rescue-marker",
  html: `<div class="marker-pin rescue-pin"></div><span>Rescue</span>`,
  iconSize: [30, 42],
  iconAnchor: [15, 42],
});

// Component to fit map bounds
function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [bounds, map]);
  return null;
}

export default function RescueDetailModal({ rescue, onClose, volunteerLocation, onStatusUpdate }) {
  const [route, setRoute] = useState([]);
  const [loading, setLoading] = useState(true);
  const [address, setAddress] = useState("");
  const [markingArrived, setMarkingArrived] = useState(false);
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    if (rescue && volunteerLocation && rescue.latitude && rescue.longitude) {
      calculateRoute();
      reverseGeocode();
    } else {
      setLoading(false);
    }
    
    // Check if this request is already fulfilled
    if (rescue && rescue.status === "fulfilled") {
      setArrived(true);
    }
  }, [rescue, volunteerLocation]);
  
  const handleMarkArrived = async () => {
    // Only allow marking as arrived for help requests
    if (rescue.type !== "HELP_REQUEST" || !rescue.id) {
      return;
    }
    
    setMarkingArrived(true);
    try {
      await updateHelpRequestStatus(rescue.id, "fulfilled");
      setArrived(true);
      
      // Notify parent to refresh data
      if (onStatusUpdate) {
        onStatusUpdate();
      }
      
      // Close modal after a short delay to show success
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error) {
      console.error("Error marking as arrived:", error);
      alert("Failed to mark as arrived. Please try again.");
    } finally {
      setMarkingArrived(false);
    }
  };

  const calculateRoute = async () => {
    try {
      const start = [volunteerLocation.lat, volunteerLocation.lng];
      const end = [rescue.latitude, rescue.longitude];
      
      // Create route coordinates - for now, straight line
      // In production, integrate with OSRM, Mapbox Directions API, or Google Directions API
      const routeCoords = [
        [start[0], start[1]],
        [end[0], end[1]]
      ];
      
      setRoute(routeCoords);
      setLoading(false);
    } catch (error) {
      console.error("Route calculation error:", error);
      setLoading(false);
    }
  };

  const reverseGeocode = async () => {
    try {
      // Reverse geocoding to get address
      // Using OpenStreetMap Nominatim API
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${rescue.latitude}&lon=${rescue.longitude}&zoom=18&addressdetails=1`
      );
      const data = await response.json();
      
      if (data.address) {
        const addr = data.address;
        const addressParts = [
          addr.house_number,
          addr.road,
          addr.neighbourhood || addr.suburb,
          addr.city || addr.town,
          addr.state,
          addr.postcode,
        ].filter(Boolean);
        setAddress(addressParts.join(", ") || "Address not available");
      } else {
        setAddress(`${rescue.latitude.toFixed(6)}, ${rescue.longitude.toFixed(6)}`);
      }
    } catch (error) {
      console.error("Geocoding error:", error);
      setAddress(`${rescue.latitude.toFixed(6)}, ${rescue.longitude.toFixed(6)}`);
    }
  };

  if (!rescue) return null;

  const rescueLocation = rescue.latitude && rescue.longitude
    ? [rescue.latitude, rescue.longitude]
    : null;

  const bounds = volunteerLocation && rescueLocation
    ? [[volunteerLocation.lat, volunteerLocation.lng], rescueLocation]
    : rescueLocation
    ? [rescueLocation, rescueLocation]
    : null;

  const center = rescueLocation || [37.7749, -122.4194];

  return (
    <div className="rescueModalOverlay" onClick={onClose}>
      <div className="rescueModal" onClick={(e) => e.stopPropagation()}>
        <button className="rescueModal__close" onClick={onClose}>
          ×
        </button>

        <div className="rescueModal__header">
          <h2>Rescue Route Navigation</h2>
          <p className="rescueModal__subtitle">
            Navigate to the person in need
          </p>
        </div>

        <div className="rescueModal__content">
          <div className="rescueModal__info">
            {rescue.priority && (
              <div className="infoCard">
                <div className="infoCard__label">Priority</div>
                <div className="infoCard__value">
                  <span className={`priorityBadge priorityBadge--${(rescue.priority || "Normal").toLowerCase()}`}>
                    {rescue.priority}
                  </span>
                </div>
              </div>
            )}
            
            {rescue.natureOfHelp && (
              <div className="infoCard">
                <div className="infoCard__label">Nature of Help</div>
                <div className="infoCard__value">{rescue.natureOfHelp}</div>
              </div>
            )}
            
            {rescue.message && (
              <div className="infoCard infoCard--full">
                <div className="infoCard__label">Message</div>
                <div className="infoCard__value" style={{ fontSize: "14px", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
                  {rescue.message}
                </div>
              </div>
            )}

            {rescue.distanceKm && (
              <div className="infoCard">
                <div className="infoCard__label">Distance</div>
                <div className="infoCard__value">{rescue.distanceKm.toFixed(2)} km</div>
              </div>
            )}

            {rescue.etaMinutes && (
              <div className="infoCard">
                <div className="infoCard__label">Estimated Time</div>
                <div className="infoCard__value">{rescue.etaMinutes} minutes</div>
              </div>
            )}

            <div className="infoCard infoCard--full">
              <div className="infoCard__label">Rescue Location</div>
              <div className="infoCard__value infoCard__address">
                📍 {address || "Calculating address..."}
              </div>
            </div>

            <div className="infoCard">
              <div className="infoCard__label">Time</div>
              <div className="infoCard__value">
                {new Date(rescue.timestamp).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="rescueModal__map">
            {loading ? (
              <div className="mapLoading">
                <div className="spinner" /> Calculating route...
              </div>
            ) : (
              <MapContainer
                center={center}
                zoom={13}
                scrollWheelZoom={true}
                className="rescueModal__mapContainer"
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution="© OpenStreetMap contributors"
                />
                
                {bounds && <FitBounds bounds={bounds} />}

                {volunteerLocation && (
                  <Marker position={[volunteerLocation.lat, volunteerLocation.lng]} icon={volunteerIcon}>
                    <Popup>
                      <strong>Your Location</strong>
                      <br />
                      Starting point
                    </Popup>
                  </Marker>
                )}

                {rescueLocation && (
                  <Marker position={rescueLocation} icon={rescueIcon}>
                    <Popup>
                      <strong>Rescue Location</strong>
                      <br />
                      {address || "Person in need"}
                    </Popup>
                  </Marker>
                )}

                {route.length >= 2 && volunteerLocation && (
                  <Polyline
                    positions={route}
                    color="#3B82F6"
                    weight={5}
                    opacity={0.8}
                    dashArray="15, 10"
                  />
                )}
              </MapContainer>
            )}
          </div>
        </div>

        <div className="rescueModal__actions">
          {rescue.type === "HELP_REQUEST" && !arrived && (
            <button
              className="btn btn--success"
              onClick={handleMarkArrived}
              disabled={markingArrived}
              style={{
                background: "#10b981",
                color: "white",
              }}
            >
              {markingArrived ? "Marking..." : "✓ Mark as Arrived"}
            </button>
          )}
          
          {arrived && (
            <div className="arrivedStatus">
              ✓ Arrived at destination
            </div>
          )}
          
          <button
            className="btn btn--secondary"
            onClick={() => {
              if (rescueLocation) {
                window.open(
                  `https://www.google.com/maps/dir/?api=1&destination=${rescueLocation[0]},${rescueLocation[1]}`,
                  "_blank"
                );
              }
            }}
          >
            Open in Google Maps
          </button>
          <button className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

