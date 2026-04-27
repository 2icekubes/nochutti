// ─────────────────────────────────────────────
// NoChutti — Configuration
// Edit this file to customise your shuttle
// ─────────────────────────────────────────────

export const CONFIG = {

  // ── Group join code ──────────────────────
  // Change this to whatever you want.
  // Share it with your riders on WhatsApp.
  JOIN_CODE: "2026",

  // ── Driver PINs ──────────────────────────
  DRIVER_PINS: {
    driver1: "1234",   // Bus 1 driver PIN
    driver2: "5678",   // Bus 2 driver PIN
  },

  // ── Driver UPI IDs ───────────────────────
  // Used for pre-filled WhatsApp pay messages
  DRIVER_UPI: {
    driver1: "driver1@upi",
    driver2: "driver2@upi",
  },

  // ── Auto-deduct ride on check-in ─────────
  // Set to true to deduct 1 ride automatically when rider checks in
  OLA_MAPS_API_KEY: "lEIPoIKxIOHHivZxI18cGP6cnQT5Yv6xkDA0ZeCK",
  OLA_STYLE_URL: "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json?key=0.4.0",

  AUTO_DEDUCT_ON_CHECKIN: false,

  // ── Proximity alert threshold (km) ───────
  // Notification fires when bus is within this distance of rider's stop
  PROXIMITY_ALERT_KM: 1.0,

  // ── First stop proximity for "started" ───
  // "Bus started" notification only fires if bus is within this km of first stop
  ROUTE_START_RADIUS_KM: 2.0,

  // ── Boarding stops ───────────────────────
  // Add or remove stops for your route
  STOPS: [
    { id: "esi_hospital", name: "ESI Hospital", lat: 22.4941, lng: 88.2192 },
    { id: "bata_more", name: "Bata More", lat: 22.4991, lng: 88.2312 },
    { id: "usha_factory", name: "Usha Factory", lat: 22.5037, lng: 88.2425 },
    { id: "jalkhura", name: "Jalkhura", lat: 22.5056, lng: 88.2483 },
    { id: "jolkol", name: "Jolkol", lat: 22.5092, lng: 88.2624 },
    { id: "rampur_bumper", name: "Rampur Bumper", lat: 22.5154, lng: 88.2789 },
    { id: "benepukur", name: "Benepukur", lat: 22.5111, lng: 88.2803 },
    { id: "gopalpur", name: "Gopalpur", lat: 22.5148, lng: 88.2861 },
    { id: "sarkarpool", name: "Sarkarpool", lat: 22.5160, lng: 88.2889 },
    { id: "jinjira_bazar", name: "Jinjira Bazar", lat: 22.5174, lng: 88.2979 },
    { id: "cesc_taratala", name: "CESC Taratala", lat: 22.5121, lng: 88.3215 },
    { id: "nicco_park", name: "Nicco Park", lat: 22.5710, lng: 88.4205 },
    { id: "techno_india", name: "Techno India", lat: 22.5761, lng: 88.4270 },
    { id: "swasthya_bhawan", name: "Swasthya Bhawan", lat: 22.5714, lng: 88.4288 },
    { id: "ashram_more", name: "Ashram More", lat: 22.5692, lng: 88.4299 },
    { id: "sdf", name: "SDF", lat: 22.5686, lng: 88.4319 },
    { id: "college_more", name: "College More", lat: 22.5747, lng: 88.4337 },
    { id: "wipro", name: "Wipro", lat: 22.5698, lng: 88.4342 },
    { id: "philips_more", name: "Philips More", lat: 22.5782, lng: 88.4355 },
    { id: "rs_software", name: "RS Software", lat: 22.5806, lng: 88.4371 },
    { id: "oxford", name: "Oxford", lat: 22.5811, lng: 88.4642 },
    { id: "narkel_bagan", name: "Narkel Bagan", lat: 22.5787, lng: 88.4729 },
    { id: "tata_medical", name: "Tata Medical Center", lat: 22.5773, lng: 88.4800 },
    { id: "unitech_gate_2", name: "Unitech Gate 2", lat: 22.5769, lng: 88.4830 },
    { id: "dlf_2", name: "DLF 2", lat: 22.5781, lng: 88.4867 },
    { id: "tcs_gp", name: "TCS GP", lat: 22.5816, lng: 88.4874 },
    { id: "ecospace", name: "Ecospace", lat: 22.5858, lng: 88.4899 }
  ],

  // ── Time slots ───────────────────────────
  SLOTS: {
    am: { label: "7:30 am", time: "08:30" },
    pm: { label: "6:20 pm", time: "06:50" },
  },

  // ── Bus names ────────────────────────────
  BUSES: {
    1: { name: "Bus 1", emoji: "🚌", capacity: 24 },
    2: { name: "Bus 2", emoji: "🚐", capacity: 24 },
  },

  // ── Ride packs (₹) ───────────────────────
  PACKS: [
    { rides: 5, amount: 650 },
    { rides: 20, amount: 2550 },
    { rides: 40, amount: 4000, best: true },
  ],

  // ── Demo route (Kolkata coords) ──────────
  // Used when Firebase is not yet configured
  DEMO_ROUTE: [
    [22.4941, 88.2192],
    [22.4991, 88.2312],
    [22.5037, 88.2425],
    [22.5056, 88.2483],
    [22.5092, 88.2624],
    [22.5154, 88.2789],
    [22.5111, 88.2803],
    [22.5148, 88.2861],
    [22.5160, 88.2889],
    [22.5174, 88.2979],
    [22.5121, 88.3215],
    [22.5710, 88.4205],
    [22.5761, 88.4270],
    [22.5714, 88.4288],
    [22.5692, 88.4299],
    [22.5686, 88.4319],
    [22.5747, 88.4337],
    [22.5698, 88.4342],
    [22.5782, 88.4355],
    [22.5806, 88.4371],
    [22.5811, 88.4642],
    [22.5787, 88.4729],
    [22.5773, 88.4800],
    [22.5769, 88.4830],
    [22.5781, 88.4867],
    [22.5816, 88.4874],
    [22.5858, 88.4899]
  ],

  // ── Map defaults ─────────────────────────
  MAP_CENTER: [22.5121, 88.3215],
  MAP_ZOOM: 12,
};
