// src/components/dashboard/RescueStatsCards.jsx

import React from "react";
import "./RescueStatsCards.css";

export default function RescueStatsCards({ stats }) {
  const {
    total = 0,
    accepted = 0,
    arrived = 0,
    avgDistance = 0,
    avgETA = 0,
  } = stats || {};

  return (
    <div className="statsGrid">
      <div className="statCard statCard--primary">
        <div className="statCard__label">Total rescue events</div>
        <div className="statCard__value">{total}</div>
        <div className="statCard__sub">
          {accepted} accepted • {arrived} completed
        </div>
      </div>
      <div className="statCard">
        <div className="statCard__label">Average ETA</div>
        <div className="statCard__value">
          {avgETA ? `${avgETA} min` : "—"}
        </div>
        <div className="statCard__sub">From acceptance to arrival</div>
      </div>
      <div className="statCard">
        <div className="statCard__label">Average distance</div>
        <div className="statCard__value">
          {avgDistance ? `${avgDistance} km` : "—"}
        </div>
        <div className="statCard__sub">Volunteer travel distance</div>
      </div>
      <div className="statCard">
        <div className="statCard__label">Completion rate</div>
        <div className="statCard__value">
          {total ? `${Math.round((arrived / total) * 100)}%` : "—"}
        </div>
        <div className="statCard__sub">ARRIVED / total events</div>
      </div>
    </div>
  );
}

