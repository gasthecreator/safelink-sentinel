// src/components/dashboard/RescueTable.jsx

import React from "react";
import "./RescueTable.css";

export default function RescueTable({ rescues, onRowClick }) {
  const rows = [...(rescues || [])]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 20);

  if (rows.length === 0) {
    return (
      <div className="tableWrapper">
        <p className="tableEmpty">No rescue activity yet.</p>
      </div>
    );
  }

  return (
    <div className="tableWrapper">
      <table className="rescueTable">
        <thead>
          <tr>
            <th>Time</th>
            <th>Priority</th>
            <th>Nature of Help Required</th>
            <th>Helper</th>
            <th>Distance</th>
            <th>ETA</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr 
              key={r.id} 
              className={r.latitude && r.longitude ? "rescueTable__row--clickable" : ""}
              onClick={() => {
                if (r.latitude && r.longitude && onRowClick) {
                  onRowClick(r);
                }
              }}
            >
              <td>{new Date(r.timestamp).toLocaleString()}</td>
              <td>
                <span className={`priorityBadge priorityBadge--${(r.priority || "Normal").toLowerCase()}`}>
                  {r.priority || "Normal"}
                </span>
              </td>
              <td className="rescueTable__nature">
                {r.natureOfHelp || (r.message ? (r.message.length > 30 ? r.message.substring(0, 27) + "..." : r.message) : r.alertId) || "—"}
              </td>
              <td>{r.helperId || "—"}</td>
              <td>
                {r.distanceKm ? `${r.distanceKm.toFixed(1)} km` : "—"}
              </td>
              <td>
                {r.etaMinutes ? `${r.etaMinutes} min` : r.type === "ARRIVED" ? "0 min" : "—"}
              </td>
              <td>
                {r.latitude && r.longitude ? (
                  <button 
                    className="rescueTable__actionBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onRowClick) onRowClick(r);
                    }}
                  >
                    View Route
                  </button>
                ) : (
                  <span className="rescueTable__noLocation">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

