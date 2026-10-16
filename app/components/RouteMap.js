// app/components/RouteMap.js
// A simple offline road map: the pack's roads in grey, the route in blue, and where you
// and they are. It is drawn straight from the routing pack, so it needs no map tiles and
// no internet. It shows roads only (no buildings, terrain or labels).

import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import Svg, { Line, Polyline, Circle, Text as SvgText } from "react-native-svg";
import { projector, pickRoads, scaleBar, formatDistance } from "../services/navigation/mapView";

// small buttons stay easy to hit: the touch area is 10 points bigger on every side
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

const ROUTE = "#2563EB";
const ROAD = "#94A3B8";
const MAJOR = "#64748B";

export default function RouteMap({ graph, route, you, them, closures = [], width = 340, height = 300 }) {
  const [zoom, setZoom] = useState(1);

  const view = useMemo(() => {
    const points = [you, them, ...(route?.geometry || []).map(([latitude, longitude]) => ({ latitude, longitude }))].filter(Boolean);
    return projector(points, { width, height, zoom, pad: 28 });
  }, [route, you, them, width, height, zoom]);

  const roads = useMemo(() => pickRoads(graph, view.bounds, 1800), [graph, view.bounds]);
  const bar = scaleBar(view.metersPerPixel);
  const xy = (lat, lon) => view.project(lat, lon);

  const youXY = you && xy(you.latitude, you.longitude);
  const themXY = them && xy(them.latitude, them.longitude);
  const routePts = (route?.geometry || []).map(([la, lo]) => xy(la, lo));

  return (
    <View>
      <View
        style={[styles.frame, { width, height }]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={route ? `Map of the route from you to them, ${formatDistance(route.distanceM)} long. The turn-by-turn directions below say the same in words.` : "Map of the roads around you and them."}
      >
        <Svg width={width} height={height}>
          {roads.map((r) => {
            const a = xy(r.a[0], r.a[1]);
            const b = xy(r.b[0], r.b[1]);
            return (
              <Line key={r.key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={r.major ? MAJOR : ROAD} strokeWidth={r.major ? 2 : 1} />
            );
          })}
          {/* where you really are, to the nearest road: a dashed connector */}
          {route && you ? (
            <Line {...dash(youXY, xy(route.start.latitude, route.start.longitude))} />
          ) : null}
          {route && them ? (
            <Line {...dash(themXY, xy(route.end.latitude, route.end.longitude))} />
          ) : null}
          {routePts.length > 1 ? (
            <Polyline
              points={routePts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={ROUTE}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {closures.map((c, i) => {
            const at = xy(c.latitude, c.longitude);
            if (at.x < -20 || at.x > width + 20 || at.y < -20 || at.y > height + 20) return null;
            const blocked = c.kind === "blocked";
            const color = blocked ? "#DC2626" : "#D97706";
            const radius = Math.max(9, c.radiusM / view.metersPerPixel);
            return (
              <React.Fragment key={`closure-${i}`}>
                <Circle cx={at.x} cy={at.y} r={radius} fill={color} fillOpacity={0.14} stroke={color} strokeWidth={1.5} strokeDasharray="3,3" />
                {blocked ? (
                  <>
                    <Line x1={at.x - 6} y1={at.y - 6} x2={at.x + 6} y2={at.y + 6} stroke={color} strokeWidth={3} strokeLinecap="round" />
                    <Line x1={at.x - 6} y1={at.y + 6} x2={at.x + 6} y2={at.y - 6} stroke={color} strokeWidth={3} strokeLinecap="round" />
                  </>
                ) : (
                  <SvgText x={at.x} y={at.y + 5} fontSize={16} fontWeight="bold" fill={color} textAnchor="middle">!</SvgText>
                )}
              </React.Fragment>
            );
          })}
          {youXY ? <Marker at={youXY} color="#16A34A" label="You" /> : null}
          {themXY ? <Marker at={themXY} color="#DC2626" label="Them" /> : null}
          {/* north arrow and scale bar */}
          <SvgText x={width - 22} y={20} fontSize={12} fontWeight="bold" fill="#334155" textAnchor="middle">N ↑</SvgText>
          <Line x1={12} y1={height - 14} x2={12 + bar.pixels} y2={height - 14} stroke="#334155" strokeWidth={3} />
          <SvgText x={12} y={height - 20} fontSize={11} fill="#334155">{bar.label}</SvgText>
        </Svg>
      </View>
      <View style={styles.controls}>
        <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Zoom out" style={styles.btn} onPress={() => setZoom((z) => Math.max(0.5, z / 1.6))}>
          <Text style={styles.btnText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Zoom in" style={styles.btn} onPress={() => setZoom((z) => Math.min(8, z * 1.6))}>
          <Text style={styles.btnText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Fit the whole route on the map" style={styles.btn} onPress={() => setZoom(1)}>
          <Text style={styles.btnText}>Fit</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function dash(a, b) {
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: ROUTE, strokeWidth: 2, strokeDasharray: "4,4" };
}

function Marker({ at, color, label }) {
  return (
    <>
      <Circle cx={at.x} cy={at.y} r={9} fill="#fff" />
      <Circle cx={at.x} cy={at.y} r={6.5} fill={color} />
      <SvgText x={at.x} y={at.y - 13} fontSize={12} fontWeight="bold" fill={color} textAnchor="middle">
        {label}
      </SvgText>
    </>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: "#F1F5F9", borderRadius: 12, overflow: "hidden", alignSelf: "center" },
  controls: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  btn: { backgroundColor: "#E2E8F0", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 16, marginHorizontal: 4 },
  btnText: { fontSize: 16, fontWeight: "700", color: "#0F172A" },
});
