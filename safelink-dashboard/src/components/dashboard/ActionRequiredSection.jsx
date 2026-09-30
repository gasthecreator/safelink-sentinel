// src/components/dashboard/ActionRequiredSection.jsx

import React from "react";
import "./ActionRequiredSection.css";

export default function ActionRequiredSection({ requests, onRequestClick }) {
  if (!requests || requests.length === 0) {
    return null;
  }

  return (
    <div className="actionRequiredSection">
      <div className="actionRequiredSection__header">
        <h3 className="actionRequiredSection__title">
          🚨 Action Required
        </h3>
        <span className="actionRequiredSection__badge">{requests.length}</span>
      </div>
      <div className="actionRequiredSection__list">
        {requests.slice(0, 5).map((request) => (
          <div
            key={request.id}
            className="actionRequiredCard"
            onClick={() => {
              if (onRequestClick) {
                // Convert help request to rescue format for modal
                const rescueFormat = {
                  id: request.id,
                  type: "HELP_REQUEST",
                  alertId: request.id,
                  natureOfHelp: request.natureOfHelp,
                  message: request.message,
                  latitude: request.latitude,
                  longitude: request.longitude,
                  address: request.address,
                  timestamp: request.timestamp,
                  status: request.status,
                };
                onRequestClick(rescueFormat);
              }
            }}
          >
            <div className="actionRequiredCard__header">
              <span className="actionRequiredCard__nature">
                {request.natureOfHelp || "Help Needed"}
              </span>
              <span className="actionRequiredCard__time">
                {new Date(request.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p className="actionRequiredCard__message">
              {request.message.length > 100
                ? request.message.substring(0, 100) + "..."
                : request.message}
            </p>
            {request.address && (
              <div className="actionRequiredCard__location">
                📍 {request.address}
              </div>
            )}
            {request.latitude && request.longitude && (
              <div className="actionRequiredCard__coords" style={{ marginTop: "4px", fontSize: "11px", color: "#94a3b8" }}>
                {request.latitude.toFixed(4)}, {request.longitude.toFixed(4)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

