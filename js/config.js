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

  // ── Boarding stops ───────────────────────
  // Add or remove stops for your route
  STOPS: [
    { id: "sector5", name: "ESI Hospital", lat: 22.5726, lng: 88.3639 },
    { id: "saltlake", name: "Salt Lake", lat: 22.5780, lng: 88.3570 },
    { id: "parkst", name: "Park Street", lat: 22.5822, lng: 88.3518 },
    { id: "ultadanga", name: "Ultadanga", lat: 22.5858, lng: 88.3462 },
    { id: "shyambazar", name: "Shyambazar", lat: 22.5875, lng: 88.3438 },
    { id: "office", name: "Office", lat: 22.5910, lng: 88.3400 },
  ],

  // ── Time slots ───────────────────────────
  SLOTS: {
    am: { label: "7:30 am", time: "08:30" },
    pm: { label: "6:20 pm", time: "06:50" },
  },

  // ── Bus names ────────────────────────────
  BUSES: {
    1: { name: "Bus 1", emoji: "🚌", capacity: 23 },
    2: { name: "Bus 2", emoji: "🚐", capacity: 23 },
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
    [22.5726, 88.3639],
    [22.5745, 88.3620],
    [22.5762, 88.3600],
    [22.5780, 88.3570],
    [22.5801, 88.3545],
    [22.5822, 88.3518],
    [22.5840, 88.3492],
    [22.5858, 88.3462],
    [22.5875, 88.3438],
    [22.5910, 88.3400],
  ],

  // ── Map defaults ─────────────────────────
  MAP_CENTER: [22.5726, 88.3639],
  MAP_ZOOM: 13,
};
