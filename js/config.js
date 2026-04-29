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

  // ── Route path (GPX-derived Kolkata coords) ──
  // Simplified from a recorded Budge Budge to New Town track
  ROUTE_PATH: [
    [22.49406884294416, 88.21721261214395],
    [22.505320025897326, 88.24628858646493],
    [22.508066417075366, 88.26070377894136],
    [22.512630516675657, 88.26799662614552],
    [22.513871719908185, 88.2748067687353],
    [22.515404497657677, 88.27888998961143],
    [22.515050196593688, 88.2882600484414],
    [22.51765412246027, 88.29851401888347],
    [22.512403709818827, 88.32197487315577],
    [22.527067315335845, 88.32586603981287],
    [22.52536688882723, 88.33092317063038],
    [22.533878533320127, 88.33200399218543],
    [22.535371170616823, 88.33345960295058],
    [22.539022253415144, 88.33369012622464],
    [22.540689407067838, 88.33465365288528],
    [22.539950981788884, 88.33673373193129],
    [22.541767080371002, 88.34591709574741],
    [22.541058768873306, 88.36068715755371],
    [22.543195373547317, 88.36610839695834],
    [22.540926914591655, 88.36828870106677],
    [22.540074953334102, 88.37026953261014],
    [22.539076446351164, 88.3777027075722],
    [22.541743482602094, 88.38514149277336],
    [22.541531659568943, 88.38878555166163],
    [22.543158372482708, 88.3960255212502],
    [22.543000967414592, 88.39817524568608],
    [22.54861091300521, 88.40060158037807],
    [22.552166583983247, 88.40508114200308],
    [22.55303994897032, 88.4089299722722],
    [22.555246963405164, 88.41163693492449],
    [22.557937862425533, 88.41190834512769],
    [22.55987711153892, 88.41399187192354],
    [22.576123559602735, 88.42254982683838],
    [22.573131678274418, 88.42128940741242],
    [22.569465707120298, 88.42924965295187],
    [22.568877848591942, 88.43066982903962],
    [22.57202938572809, 88.43227650058112],
    [22.57038545985, 88.43582214239744]
  ],

  // ── Map defaults ─────────────────────────
  MAP_CENTER: [22.535108385642072, 88.32656492215528],
  MAP_ZOOM: 10.8,
};
