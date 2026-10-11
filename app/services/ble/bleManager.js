// app/services/ble/bleManager.js
// One shared react-native-ble-plx manager for scanning (NodeDiscovery) and
// connecting/writing (BleTransport). Creating several managers fights over the
// same radio, so everything goes through this accessor.

import { Platform } from "react-native";

let manager = null;
let attempted = false;

/** Returns the shared BleManager, or null where BLE is unavailable (web, simulators without the native module). */
export function getBleManager() {
  if (attempted) return manager;
  attempted = true;
  if (Platform.OS === "web") return null;
  try {
    const { BleManager } = require("react-native-ble-plx");
    manager = new BleManager();
  } catch (error) {
    console.log("[SafeLink][BLE] react-native-ble-plx unavailable:", error?.message);
    manager = null;
  }
  return manager;
}
