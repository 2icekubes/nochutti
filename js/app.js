// ─────────────────────────────────────────────
// NoChutti — App Logic
// ─────────────────────────────────────────────
// 1. Import YOUR custom setup from your config file
import { db, firebaseReady } from './firebase-config.js';

// 2. Import GOOGLE'S database tools directly from their web address

import { ref, onValue, set, get, child, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { CONFIG } from './config.js';

// ── State ─────────────────────────────────────
const S = {
  user: null,          // { name, stop, role, id }
  bus: 1,              // active bus tab
  slot: 'am',
  broadcasting: false,
  watchId: null,
  riderBroadcasting: false,  // rider location sharing
  riderWatchId: null,
  riders: {},          // id → rider
  checkins: {},        // "YYYY-MM-DD" → { bus1: Set<id>, bus2: Set<id> }
  busPositions: {},    // busN → { lat, lng, ts }
  selectedRider: null,
  selectedPack: null,
  demoStep: { 1: 0, 2: 5 },
  demoInterval: null,
  notifiedEvents: [],
  driverInfo: { 1: null, 2: null },
};

const DB_READY = () => firebaseReady && db;
const dbOnValue = (path, cb) => {
  if (!DB_READY()) return () => {};
  return onValue(ref(db, path), cb);
};
const dbSet = (path, value) => DB_READY() ? set(ref(db, path), value) : Promise.resolve();
const dbUpdateValues = (values) => DB_READY() ? update(ref(db), values) : Promise.resolve();
const dbRemove = (path) => DB_READY() ? set(ref(db, path), null) : Promise.resolve();

function initDriverInfoListeners() {
  [1, 2].forEach(n => {
    dbOnValue(`driverInfo/driver${n}`, snap => {
      S.driverInfo[n] = snap.val()?.name || '—';
      updateBusPopup(n);
    });
  });
}

// ── Demo riders ───────────────────────────────
const DEMO_RIDERS = {
  r001: { name:'Rahul Roy',      stop:'Sector 5',    rides:3, maxRides:5,  payments:[], checkedIn: true,  busToday:1 },
  };

// ── Helpers ───────────────────────────────────
const $ = id => document.getElementById(id);
const initials = n => n.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
};
const fmtDate = s => new Date(s).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});

const AV_COLORS = [
  ['rgba(74,222,128,.18)','#4ade80'],
  ['rgba(96,165,250,.18)','#60a5fa'],
  ['rgba(251,191,36,.18)','#fbbf24'],
  ['rgba(248,113,113,.18)','#f87171'],
  ['rgba(167,139,250,.18)','#a78bfa'],
  ['rgba(251,146,60,.18)','#fb923c'],
];
const avColor = id => AV_COLORS[[...id].reduce((s,c)=>s+c.charCodeAt(0),0) % AV_COLORS.length];

function rideColor(rides) {
  if (rides === 0) return ['c-r','f-r'];
  if (rides <= 2) return ['c-a','f-a'];
  return ['c-g','f-g'];
}

// ── Toast ─────────────────────────────────────
let _tt;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_tt);
  _tt = setTimeout(()=>t.classList.remove('show'), 2800);
}
window.toast = toast;

function showNotification(text) {
  const el = $('in-app-notification');
  if (!el) return;
  $('ian-text').textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 5000);
}

// ── Map ───────────────────────────────────────
let map, busMarkers = {};

function initMap() {
  map = L.map('map', { zoomControl:false, attributionControl:false,
    center: CONFIG.MAP_CENTER, zoom: CONFIG.MAP_ZOOM });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(map);

  L.polyline(CONFIG.DEMO_ROUTE, { color: '#4ade80', weight: 4, opacity: 0.8 }).addTo(map);

  // Stop markers
  let stopMarkers = {};
  CONFIG.STOPS.forEach(s => {
    stopMarkers[s.id] = _makeStopMarker(s, 0).addTo(map);
  });
  window._stopMarkers = stopMarkers;

  // Bus markers for both buses
  [1, 2].forEach(n => {
    const bus = CONFIG.BUSES[n];
    const icon = L.divIcon({
      html:`<div id="busmarker-${n}" style="width:38px;height:38px;border-radius:50%;background:#4ade80;border:3px solid #0d1f0f;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 14px rgba(74,222,128,.45)">${bus.emoji}</div>`,
      iconSize:[38,38], iconAnchor:[19,19], className:''
    });
    busMarkers[n] = L.marker(CONFIG.MAP_CENTER, { icon, opacity: 0 }).addTo(map);
    updateBusPopup(n);
  });
}

// Creates a stop marker icon sized/coloured by rider count
function _makeStopMarker(s, count) {
  const hasRiders = count > 0;
  const size = hasRiders ? 14 : 10;
  const bg = hasRiders ? '#4ade80' : '#555';
  const glow = hasRiders ? ';box-shadow:0 0 0 3px rgba(74,222,128,0.4)' : '';
  const icon = L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:2px solid #0d1f0f${glow}"></div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2], className: ''
  });
  return L.marker([s.lat, s.lng], { icon });
}

function updateBusPopup(busN) {

  if (!busMarkers[busN]) return;
  const bus = CONFIG.BUSES[busN];

  const driverName = S.user?.role === `driver${busN}`
    ? S.user.name
    : S.driverInfo[busN] || '—';

  const popupContent = (name) => `
    <div style="text-align:center;min-width:80px;line-height:1.2">
      <div style="font-size:18px;margin-bottom:2px">${bus.emoji}</div>
      <b style="color:var(--t0);font-size:12px">${bus.name}</b><br>
      <span style="color:#aaa;font-size:10px">Driver: ${name}</span>
    </div>`;

  busMarkers[busN].bindPopup(popupContent(driverName));
}

function moveBus(busN, lat, lng) {
  if (!busMarkers[busN]) return;
  busMarkers[busN].setLatLng([lat, lng]);
  busMarkers[busN].setOpacity(1);
  S.busPositions[busN] = { lat, lng, ts: Date.now() };
  updateStatusBadges();
  if (busN === S.bus) updateETA(lat, lng);
  checkProximity(busN, lat, lng);

  // Pulse the bus marker icon if this driver is broadcasting
  const isMyBus = S.user?.role === `driver${busN}` && S.broadcasting;
  const el = document.getElementById(`busmarker-${busN}`);
  if (el) el.classList.toggle('bus-live-pulse', isMyBus);
}

function hideBus(busN) {
  if (busMarkers[busN]) busMarkers[busN].setOpacity(0);
  delete S.busPositions[busN];
  updateStatusBadges();
  if (S.bus === busN) {
    const el = $('eta-text');
    if (el) el.textContent = 'Trip yet to start';
  }
}

function checkProximity(busN, lat, lng) {
  if (S.user?.role?.startsWith('driver')) return;
  if (busN !== S.bus) return;

  const stop = CONFIG.STOPS.find(s => s.id === S.user?.stop) || CONFIG.STOPS.find(s => s.name === S.user?.stop);
  if (!stop) return;

  const d = Math.sqrt(Math.pow((lat - stop.lat) * 111, 2) + Math.pow((lng - stop.lng) * 111, 2));

  // "Bus started" only fires if bus is near the first route stop
  const firstStop = CONFIG.STOPS[0];
  const distFromFirst = Math.sqrt(Math.pow((lat - firstStop.lat) * 111, 2) + Math.pow((lng - firstStop.lng) * 111, 2));
  const startKey = `bus${busN}_started_${today()}`;
  if (distFromFirst < (CONFIG.ROUTE_START_RADIUS_KM || 2.0) && !S.notifiedEvents.includes(startKey)) {
    S.notifiedEvents.push(startKey);
    showNotification(`Bus ${busN} has started its route!`);
  }

  // Approach alert uses configurable threshold
  const approachKey = `bus${busN}_approach_${today()}`;
  if (d < (CONFIG.PROXIMITY_ALERT_KM || 1.0) && !S.notifiedEvents.includes(approachKey)) {
    S.notifiedEvents.push(approachKey);
    showNotification(`Bus ${busN} is approaching your stop!`);
  }
}

function updateETA(lat, lng) {
  const el = $('eta-text');
  if (!el) return;

  if (S.user?.role?.startsWith('driver')) {
    const isBroadcastingThisBus = S.broadcasting && parseInt(S.user.role.slice(-1)) === S.bus;
    el.textContent = isBroadcastingThisBus ? `Broadcasting Bus ${S.bus}` : `Bus ${S.bus} · ${CONFIG.SLOTS[S.slot].label}`;
    return;
  }

  const pos = S.busPositions[S.bus];
  if (!pos || Date.now() - pos.ts > 30 * 60 * 1000) {
    el.textContent = 'Trip yet to start';
    return;
  }

  const stop = CONFIG.STOPS.find(s => s.id === S.user?.stop) ||
               CONFIG.STOPS.find(s => s.name === S.user?.stop);
  if (!stop) return;
  const d = Math.sqrt(Math.pow((lat - stop.lat) * 111, 2) + Math.pow((lng - stop.lng) * 111, 2));
  if (d < 0.05) { el.textContent = `Bus ${S.bus} is at your stop! 🎉`; return; }
  // Slot-aware speed: AM rush = 18 km/h, PM rush = 22 km/h
  const speed = S.slot === 'am' ? 18 : 22;
  const mins = Math.max(1, Math.round(d / speed * 60));
  el.textContent = `Bus ${S.bus} · ~${mins} min to ${stop.name}`;
}

function updateStatusBadges() {
  [1,2].forEach(n => {
    const el = $(`b${n}-status`);
    if (!el) return;
    const pos = S.busPositions[n];
    if (pos) {
      const age = (Date.now() - pos.ts) / 1000;
      el.textContent = age < 30 ? 'Live' : `${Math.round(age/60)}m ago`;
      $(`badge-bus${n}`).style.borderColor = age < 30 ? 'var(--grn)' : 'var(--bdr2)';
    } else {
      el.textContent = 'Offline';
    }
  });
}

// ── Demo simulation ───────────────────────────
function startDemo() {
  clearInterval(S.demoInterval);
  const route = CONFIG.DEMO_ROUTE;
  // Bus 1 and bus 2 at different positions
  moveBus(1, ...route[S.demoStep[1]]);
  moveBus(2, ...route[S.demoStep[2]]);

  S.demoInterval = setInterval(() => {
    S.demoStep[1] = (S.demoStep[1] + 1) % route.length;
    S.demoStep[2] = (S.demoStep[2] + 1) % route.length;
    moveBus(1, ...route[S.demoStep[1]]);
    moveBus(2, ...route[S.demoStep[2]]);
  }, 4500);
}

// ── Firebase listeners ────────────────────────
function listenBusPositions() {
  if (!DB_READY()) { startDemo(); return; }
  [1,2].forEach(n => {
    dbOnValue(`bus${n}/position`, snap => {
      const d = snap.val();
      if (d?.lat && d?.ts && Date.now() - d.ts < 30 * 60 * 1000) {
        moveBus(n, d.lat, d.lng);
      } else {
        hideBus(n);
      }
    });
  });
}

function sweepMidnight() {
  const d = today();
  const updates = {};
  let needsWrite = false;
  Object.entries(S.riders).forEach(([id, r]) => {
    if (r.checkedIn && r.lastCheckin !== d) {
      r.checkedIn = false;
      r.busToday = null;
      r.onboarded = false;
      if (DB_READY()) {
        updates[`riders/${id}/checkedIn`] = false;
        updates[`riders/${id}/busToday`] = null;
        updates[`riders/${id}/onboarded`] = false;
        needsWrite = true;
      }
    }
  });
  if (needsWrite) dbUpdateValues(updates).catch(err => console.warn('sweepMidnight error:', err));
}

function listenRiders() {
  if (!DB_READY()) {
    S.riders = DEMO_RIDERS;
    sweepMidnight();
    renderRiders(); renderWallet(); updateOccupancy(); updateCheckinBtn(); updateStopPopups();
    return;
  }
  dbOnValue('riders', snap => {
    S.riders = snap.val() || {};
    sweepMidnight();
    renderRiders(); renderWallet(); updateOccupancy(); updateCheckinBtn(); updateStopPopups();
  });
}

// ── Stop popup counts ──────────────────────────
function updateStopPopups(openAll) {
  const stopMarkers = window._stopMarkers;
  if (!stopMarkers) return;
  const busN = S.user?.role?.startsWith('driver') ? parseInt(S.user.role.slice(-1)) : null;

  CONFIG.STOPS.forEach(s => {
    const old = stopMarkers[s.id];
    if (!old) return;

    const count = Object.values(S.riders).filter(r =>
      r.checkedIn && (r.stop === s.name || r.stop === s.id) &&
      (busN === null || r.busToday === busN)
    ).length;

    const popupHtml = `
      <div style="text-align:center;min-width:60px;line-height:1.2">
        <b style="color:var(--t0);font-size:11px">${s.name}</b><br>
        <span style="font-size:16px;font-weight:700;color:${count > 0 ? '#4ade80' : '#aaa'};display:inline-block;margin:2px 0">${count}</span><br>
        <span style="color:#aaa;font-size:10px">rider${count !== 1 ? 's' : ''} today</span>
      </div>`;

    // Swap marker icon to reflect count (remove old, add new)
    const wasOpen = old.isPopupOpen();
    old.remove();
    const fresh = _makeStopMarker(s, count).bindPopup(popupHtml).addTo(map);
    stopMarkers[s.id] = fresh;
    if ((openAll && count > 0) || wasOpen) fresh.openPopup();
  });
}

let riderMarkers = {};
function listenRiderPositions() {
  if (!DB_READY()) return;
  if (!S.user?.role?.startsWith('driver')) return;

  dbOnValue('riderPositions', snap => {
    const data = snap.val() || {};
    const now = Date.now();
    const STALE_MS = 15 * 60 * 1000;

    // Add / update markers for active riders
    Object.entries(data).forEach(([id, pos]) => {
      if (!pos?.lat || !pos?.lng) return;
      if (now - pos.ts > STALE_MS) return;  // skip stale

      // Rider name: try S.riders first, fall back to id
      const riderName = S.riders[id]?.name || id;
      const av = initials(riderName);
      const popupHtml = `<div style="text-align:center;min-width:90px"><b style="color:var(--t0);font-size:13px">${riderName}</b><br><span style="color:#aaa;font-size:11px">Sharing location</span></div>`;

      if (!riderMarkers[id]) {
        const icon = L.divIcon({
          html: `<div style="width:28px;height:28px;border-radius:50%;background:rgba(96,165,250,0.25);border:1.5px solid rgba(96,165,250,0.7);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#1d4ed8;letter-spacing:0">${av}</div>`,
          iconSize: [28,28],
          iconAnchor: [14,14],
          className: ''
        });
        riderMarkers[id] = L.marker([pos.lat, pos.lng], { icon })
          .bindPopup(popupHtml)
          .addTo(map);
      } else {
        riderMarkers[id].setLatLng([pos.lat, pos.lng]);
        riderMarkers[id].setPopupContent(popupHtml);
      }
    });

    // Remove markers for riders who stopped sharing or went stale
    Object.keys(riderMarkers).forEach(id => {
      const pos = data[id];
      if (!pos || now - pos.ts > STALE_MS) {
        map.removeLayer(riderMarkers[id]);
        delete riderMarkers[id];
      }
    });
  });
}

// ── Bus tab & slot ────────────────────────────
window.selectBus = function(n) {
  S.bus = n;
  [1,2].forEach(i => {
    $(`bustab-${i}`).classList.toggle('active', i===n);
  });
  const pos = S.busPositions[n];
  if (pos && Date.now() - pos.ts < 30 * 60 * 1000) { 
    map.setView([pos.lat, pos.lng], 15); 
    updateETA(pos.lat, pos.lng); 
  }
  else { 
    $('eta-text').textContent = `Trip yet to start`; 
  }
};

window.selectSlot = function(slot) {
  S.slot = slot;
  $('sp-am').classList.toggle('active', slot==='am');
  $('sp-pm').classList.toggle('active', slot==='pm');
  $('bustab-1-sub').textContent = CONFIG.SLOTS[slot].label;
  $('bustab-2-sub').textContent = CONFIG.SLOTS[slot].label;
  updateTopbarCtx();
};

function updateTopbarCtx() {
  const role = S.user?.role || '';
  const tag = role.startsWith('driver') ? `Driver · Bus ${role.slice(-1)}` : 'Rider';
  $('topbar-ctx').textContent = `${tag} · ${CONFIG.SLOTS[S.slot].label}`;
}

// ── GPS Broadcast ─────────────────────────────
window.toggleBroadcast = function() {
  S.broadcasting ? stopBroadcast() : startBroadcast();
};

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (err) {}
}
function releaseWakeLock() {
  if (wakeLock !== null) { wakeLock.release(); wakeLock = null; }
}

function startBroadcast() {
  if (!navigator.geolocation) { toast('Geolocation not available'); return; }
  requestWakeLock();
  const busN = parseInt(S.user.role.slice(-1));
  S.watchId = navigator.geolocation.watchPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    moveBus(busN, lat, lng);
    map.setView([lat, lng], 15);
    dbSet(`bus${busN}/position`, { lat, lng, ts: Date.now() });
  }, err => toast('GPS: ' + err.message), { enableHighAccuracy:true, maximumAge:5000, timeout:10000 });
  S.broadcasting = true;
  updateBroadcastBtn();
  updateStopPopups(true); // open stop popups with rider counts on trip start
  toast(`📡 Broadcasting Bus ${busN} location`);
}

function stopBroadcast() {
  if (S.watchId) navigator.geolocation.clearWatch(S.watchId);
  S.watchId = null;
  S.broadcasting = false;
  releaseWakeLock();
  updateBroadcastBtn();
  toast('Broadcast stopped');
}

function updateBroadcastBtn() {
  const btn = $('btn-broadcast');
  if (!btn) return;
  if (S.broadcasting) {
    btn.classList.add('live');
    $('bc-label').textContent = 'Broadcasting… tap to stop';
    $('bc-icon').textContent = '🔴';
  } else {
    btn.classList.remove('live');
    $('bc-label').textContent = 'Start Trip and Broadcast Location';
    $('bc-icon').textContent = '📡';
  }
}

window.shareWA = function() {
  const busN = parseInt(S.user.role.slice(-1));
  const slot = CONFIG.SLOTS[S.slot].label;
  const msg = encodeURIComponent(
    `🚌 NoChutti — Bus ${busN} is running!\n` +
    `Slot: ${slot}\n` +
    `(I'll drop a live location pin in a moment)`
  );
  window.open(`https://wa.me/?text=${msg}`, '_blank');
};

// ── Rider Location Sharing ──────────────────────
window.toggleRiderLocation = function() {
  S.riderBroadcasting ? stopRiderLocation() : startRiderLocation();
};

let myMarker = null;
function startRiderLocation() {
  if (!navigator.geolocation) { toast('Geolocation not available'); return; }
  requestWakeLock();
  const id = S.user.id;
  const icon = L.divIcon({
    html: `<div style="width:28px;height:28px;border-radius:50%;background:rgba(248,113,113,0.25);border:1.5px solid rgba(248,113,113,0.7);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--red);">📍</div>`,
    iconSize: [28,28], iconAnchor: [14,14], className: ''
  });
  if (!myMarker) myMarker = L.marker([0,0], { icon, opacity: 0 }).addTo(map);

  S.riderWatchId = navigator.geolocation.watchPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    if (myMarker) { myMarker.setLatLng([lat, lng]); myMarker.setOpacity(1); }
    dbSet(`riderPositions/${id}`, { lat, lng, ts: Date.now() });
  }, err => toast('GPS: ' + err.message), { enableHighAccuracy:true, maximumAge:5000, timeout:10000 });
  S.riderBroadcasting = true;
  updateRiderLocationBtn();
  toast('Location sharing started');
}

function stopRiderLocation() {
  if (S.riderWatchId) navigator.geolocation.clearWatch(S.riderWatchId);
  S.riderWatchId = null;
  S.riderBroadcasting = false;
  releaseWakeLock();
  if (myMarker) { map.removeLayer(myMarker); myMarker = null; }
  dbRemove(`riderPositions/${S.user.id}`);
  updateRiderLocationBtn();
  toast('Location sharing stopped');
}

function updateRiderLocationBtn() {
  const btn = $('btn-rider-loc');
  if (!btn) return;
  if (S.riderBroadcasting) {
    btn.style.borderColor = 'var(--grn)';
    btn.style.background = 'rgba(74,222,128,0.1)';
  } else {
    btn.style.borderColor = 'var(--bdr)';
    btn.style.background = 'var(--bg1)';
  }
}

// endTrip uses a styled modal instead of browser confirm()
window.endTrip = function() {
  openModal('modal-end-trip');
};
window.confirmEndTrip = function() {
  closeModal();
  const busN = parseInt(S.user.role.slice(-1));
  if (S.broadcasting) stopBroadcast();
  const updates = {};
  updates[`bus${busN}/position`] = null;
  
  let count = 0;
  Object.entries(S.riders).forEach(([id, r]) => {
    if (r.checkedIn && r.busToday === busN) {
      updates[`riders/${id}/checkedIn`] = false;
      updates[`riders/${id}/busToday`] = null;
      updates[`riders/${id}/onboarded`] = false;
      count++;
    }
  });
  
  if (DB_READY()) {
    dbUpdateValues(updates).then(() => toast(`Trip ended. Offboarded ${count} passengers.`))
      .catch(err => toast('Error: ' + err.message));
  } else {
    Object.entries(S.riders).forEach(([id, r]) => {
      if (r.checkedIn && r.busToday === busN) { S.riders[id].checkedIn = false; S.riders[id].busToday = null; }
    });
    renderRiders(); renderWallet(); updateOccupancy(); updateCheckinBtn();
    toast(`Trip ended. Offboarded ${count} passengers.`);
  }
};

// ── Rider check-in ────────────────────────────
window.toggleCheckin = function() {
  const id = S.user.id;
  const rider = S.riders[id];
  const alreadyIn = rider?.checkedIn;
  const newStatus = !alreadyIn;
  const busAssigned = newStatus ? S.bus : null;

  if (!newStatus && S.busPositions[S.bus]) {
    const pos = S.busPositions[S.bus];
    const stop = CONFIG.STOPS.find(s => s.id === S.user?.stop) || CONFIG.STOPS.find(s => s.name === S.user?.stop);
    if (stop) {
      const d = Math.sqrt(Math.pow((pos.lat-stop.lat)*111,2)+Math.pow((pos.lng-stop.lng)*111,2));
      const approachKey = `bus${S.bus}_approach_${today()}`;
      if (S.notifiedEvents.includes(approachKey) && d > 2.0) {
        toast(`Check-out locked: Bus has already departed (> 2km away)`);
        return;
      }
    }
  }

  if (newStatus) {
    const ridersArray = Object.values(S.riders);
    const count = ridersArray.filter(r => r.checkedIn && r.busToday === S.bus).length;
    const capacity = CONFIG.BUSES[S.bus].capacity;
    if (count >= capacity) {
      toast(`Bus ${S.bus} is fully booked (${capacity}/${capacity})!`);
      return;
    }
  }

  // Auto-deduct a ride on check-in if configured
  if (newStatus && CONFIG.AUTO_DEDUCT_ON_CHECKIN) {
    const riderData = S.riders[id] || {};
    if ((riderData.rides || 0) > 0) {
      const deducted = { ...riderData, rides: (riderData.rides || 0) - 1 };
      if (DB_READY()) {
        dbSet(`riders/${id}`, { ...deducted, checkedIn: newStatus, busToday: busAssigned, lastCheckin: today() });
      } else {
        S.riders[id] = { ...deducted, checkedIn: newStatus, busToday: busAssigned, lastCheckin: today() };
        updateCheckinBtn(); updateOccupancy();
      }
      toast(`✓ Checked in on Bus ${busAssigned} · 1 ride deducted`);
      return;
    }
  }

  const updated = { ...(S.riders[id] || { name: S.user.name, stop: S.user.stop, rides:0, maxRides:5, payments:[] }),
    checkedIn: newStatus, busToday: busAssigned, lastCheckin: today() };

  if (DB_READY()) {
    dbSet(`riders/${id}`, updated);
  } else {
    S.riders[id] = updated;
    updateCheckinBtn();
    updateOccupancy();
  }
  toast(newStatus ? `✓ Checked in on Bus ${busAssigned}` : 'Check-in removed');
};

window.toggleOnboard = function() {
  const id = S.user.id;
  const rider = S.riders[id];
  if (!rider?.checkedIn) return;
  
  const isNowOnboard = !rider.onboarded;
  
  if (isNowOnboard && CONFIG.AUTO_DEDUCT_ON_CHECKIN && !rider.onboarded) {
    if ((rider.rides || 0) > 0) {
      rider.rides -= 1;
      toast(`🚌 Onboarded Bus ${rider.busToday} · 1 ride deducted`);
    } else {
      toast(`No rides left. Please pay driver.`);
    }
  } else if (isNowOnboard) {
    toast(`🚌 Onboarded Bus ${rider.busToday}`);
  } else {
    toast(`Offboarded Bus ${rider.busToday}`);
  }

  const updated = { ...S.riders[id], onboarded: isNowOnboard };
  if (DB_READY()) dbSet(`riders/${id}`, updated);
  else { S.riders[id] = updated; updateCheckinBtn(); }
};

function updateCheckinBtn() {
  const btn = $('btn-checkin');
  const btnOb = $('btn-onboard');
  if (!btn) return;
  const rider = S.riders[S.user?.id];
  const isIn = rider?.checkedIn;
  const isOb = rider?.onboarded;
  
  btn.classList.toggle('checked-in', !!isIn);
  $('ci-icon').textContent = isIn ? '✓' : '○';
  $('ci-label').textContent = isIn
    ? `Checked in Bus ${rider.busToday}`
    : `Check in for Bus ${S.bus} today`;

  if (btnOb) {
    if (isIn) {
      btnOb.style.display = 'flex';
      btnOb.classList.toggle('checked-in', !!isOb);
      $('ob-icon').textContent = isOb ? '✓' : '🚌';
      $('ob-label').textContent = isOb ? 'Onboarded' : 'Onboard bus now';
    } else {
      btnOb.style.display = 'none';
    }
  }
}

function updateOccupancy() {
  const riders = Object.values(S.riders);
  const c1 = riders.filter(r=>r.checkedIn && r.busToday===1).length;
  const c2 = riders.filter(r=>r.checkedIn && r.busToday===2).length;
  const col = n => n > 20 ? 'var(--amb)' : 'var(--grn)';
  $('occ1-count').textContent = c1;
  $('occ1-count').style.color = col(c1);
  $('occ2-count').textContent = c2;
  $('occ2-count').style.color = col(c2);
  
  const cap1 = CONFIG.BUSES[1].capacity;
  const cap2 = CONFIG.BUSES[2].capacity;
  if ($('occ1-cap')) $('occ1-cap').textContent = `/ ${cap1} seats`;
  if ($('occ2-cap')) $('occ2-cap').textContent = `/ ${cap2} seats`;
}

// Sort/filter state for rider panel (driver only)
let _riderSort = 'rides';  // 'rides' | 'stop'
let _riderFilter = 'all';  // 'all' | 'in'
window.setRiderSort = s => { _riderSort = s; renderRiders(); };
window.setRiderFilter = f => { _riderFilter = f; renderRiders(); };

// ── Render Riders list ────────────────────────
function renderRiders() {
  const el = $('rider-list');
  if (!el) return;
  const q = ($('rider-search')?.value||'').toLowerCase();
  const isDriver = S.user?.role?.startsWith('driver');

  let entries = Object.entries(S.riders)
    .filter(([,r]) => r.name.toLowerCase().includes(q));

  // Checked-in filter (driver only)
  if (isDriver && _riderFilter === 'in') {
    entries = entries.filter(([,r]) => r.checkedIn);
  }

  // Sorting
  if (_riderSort === 'stop') {
    // Sort by stop position in STOPS array
    const stopOrder = {};
    CONFIG.STOPS.forEach((s, i) => { stopOrder[s.name] = i; stopOrder[s.id] = i; });
    entries.sort((a, b) => (stopOrder[a[1].stop] ?? 999) - (stopOrder[b[1].stop] ?? 999));
  } else {
    entries.sort((a, b) => (a[1].rides||0) - (b[1].rides||0));
  }

  const zeroes = entries.filter(([,r]) => !r.rides);

  let html = '';

  // Driver-only toolbar: sort + filter controls
  if (isDriver) {
    html += `<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
      <button class="slot-pill${_riderSort==='rides'?' active':''}" onclick="setRiderSort('rides')">By rides</button>
      <button class="slot-pill${_riderSort==='stop'?' active':''}" onclick="setRiderSort('stop')">By stop</button>
      <button class="slot-pill${_riderFilter==='all'?' active':''}" onclick="setRiderFilter('all')" style="margin-left:auto">All</button>
      <button class="slot-pill${_riderFilter==='in'?' active':''}" onclick="setRiderFilter('in')">Checked in</button>
    </div>`;

    if (zeroes.length) {
      html += zeroes.map(([,r]) =>
        `<div class="alert-strip">⚠️ ${r.name} — 0 rides, collect payment</div>`
      ).join('');
    }
  }

  html += entries.map(([id,r]) => {
    const pct = Math.min(100, ((r.rides||0)/(r.maxRides||5))*100);
    const [bg,fg] = avColor(id);
    const [cc,fc] = rideColor(r.rides||0);
    const busTag = r.checkedIn
      ? `<span style="color:var(--grn)">Bus ${r.busToday} today</span>`
      : `<span style="color:var(--t2)">Not checked in</span>`;
    return `
    <div class="r-card" onclick="${isDriver?`openPay('${id}')`:''}" style="cursor:${isDriver?'pointer':'default'}">
      <div class="r-av" style="background:${bg};color:${fg}">${initials(r.name)}</div>
      <div class="r-info">
        <div class="r-name">${r.name}</div>
        <div class="r-stop">📍 ${r.stop}</div>
        <div class="r-bus-today">${busTag}</div>
      </div>
      <div class="r-rides">
        <div class="r-rcount ${cc}">${r.rides||0}</div>
        <div class="r-rlabel">rides left</div>
        <div class="r-bar"><div class="r-fill ${fc}" style="width:${pct}%"></div></div>
      </div>
      ${isDriver?`<button class="btn-addpay" onclick="event.stopPropagation();openPay('${id}')">+ Pay</button>`:''}
    </div>`;
  }).join('');

  el.innerHTML = html;
  updateOccupancy();
}
window.renderRiders = renderRiders;

// ── Wallet panel ──────────────────────────────
function renderWallet() {
  const el = $('wallet-inner');
  if (!el) return;
  const isDriver = S.user?.role?.startsWith('driver');
  isDriver ? renderDriverWallet(el) : renderRiderWallet(el);
}

function renderRiderWallet(el) {
  const id = S.user.id;
  const r = S.riders[id] || { rides:0, maxRides:5, payments:[] };
  const pct = Math.min(100,((r.rides||0)/(r.maxRides||5))*100);
  const [cc] = rideColor(r.rides||0);
  const hist = (r.payments||[]).slice().reverse();

  el.innerHTML = `
    <div class="panel-titlerow">
      <h2 class="panel-title">My wallet</h2>
      <button class="panel-close" onclick="goTab('map')">✕</button>
    </div>
    <div class="wallet-hero">
      <div class="wh-label">Rides remaining</div>
      <div class="wh-count ${cc}">${r.rides||0}</div>
      <div class="wh-sub">of ${r.maxRides||5} in last top-up</div>
      <div class="prog-track"><div class="prog-fill ${cc.replace('c-','f-')}" style="width:${pct}%"></div></div>
      <div class="prog-labels"><span>0</span><span>${r.maxRides||5}</span></div>
    </div>
    ${(r.rides||0)<=2?`<div class="alert-strip" style="margin-bottom:14px">⚠️ Running low — pay your driver via UPI/GPay</div>`:''}
    <div class="sec-head">Top-up packs</div>
    <div class="pack-grid">
      ${CONFIG.PACKS.map(p=>`
        <div class="pack${p.best?' best':''}">
          ${p.best?`<div class="pack-badge">Best</div>`:''}
          <div class="pack-r">${p.rides} rides</div>
          <div class="pack-p">₹${p.amount.toLocaleString('en-IN')}</div>
        </div>`).join('')}
    </div>
    <p style="font-size:12px;color:var(--t2);margin-top:10px;margin-bottom:2px">
      Pay your driver on GPay/UPI — they'll mark your rides in the app.
    </p>
    <div class="sec-head" style="margin-top:20px">Payment history</div>
    <div class="hist-list">
      ${hist.length
        ? hist.map(p=>`
          <div class="hist-item">
            <div class="hist-ico">💳</div>
            <div class="hist-inf">
              <div class="hist-d">${p.rides} rides added</div>
              <div class="hist-dt">${fmtDate(p.ts)} · ${p.method||'UPI'}</div>
            </div>
            <div class="hist-amt">+₹${(p.amount||0).toLocaleString('en-IN')}</div>
          </div>`).join('')
        : `<div style="color:var(--t2);font-size:14px;padding:12px 0">No payments yet</div>`
      }
    </div>`;
}

function renderDriverWallet(el) {
  const riders = Object.entries(S.riders);
  const zero = riders.filter(([,r])=>!r.rides).length;
  const total = riders.length;
  const bus1 = riders.filter(([,r])=>r.checkedIn&&r.busToday===1).length;
  const bus2 = riders.filter(([,r])=>r.checkedIn&&r.busToday===2).length;

  el.innerHTML = `
    <div class="panel-titlerow">
      <h2 class="panel-title">Payments</h2>
      <button class="panel-close" onclick="goTab('map')">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      ${[
        ['Total riders', total, 'var(--t0)'],
        ['Need to pay', zero, zero?'var(--red)':'var(--grn)'],
        ['On Bus 1 today', bus1, 'var(--grn)'],
        ['On Bus 2 today', bus2, 'var(--grn)'],
      ].map(([l,v,c])=>`
        <div style="background:var(--bg1);border:1px solid var(--bdr);border-radius:var(--rl);padding:12px">
          <div style="font-size:26px;font-weight:700;font-family:var(--fm);color:${c}">${v}</div>
          <div style="font-size:11px;color:var(--t2);margin-top:2px">${l}</div>
        </div>`).join('')}
    </div>
    <div class="sec-head">Rider balances</div>
    <div class="rider-list">
      ${riders.sort((a,b)=>(a[1].rides||0)-(b[1].rides||0)).map(([id,r])=>{
        const pct = Math.min(100,((r.rides||0)/(r.maxRides||5))*100);
        const [bg,fg]=avColor(id);
        const [cc,fc]=rideColor(r.rides||0);
        return `
        <div class="r-card" onclick="openPay('${id}')" style="cursor:pointer">
          <div class="r-av" style="background:${bg};color:${fg}">${initials(r.name)}</div>
          <div class="r-info">
            <div class="r-name">${r.name}</div>
            <div class="r-stop">${r.stop}</div>
          </div>
          <div class="r-rides">
            <div class="r-rcount ${cc}">${r.rides||0}</div>
            <div class="r-rlabel">left</div>
            <div class="r-bar"><div class="r-fill ${fc}" style="width:${pct}%"></div></div>
          </div>
          <button class="btn-addpay" onclick="event.stopPropagation();openPay('${id}')">+ Pay</button>
        </div>`;
      }).join('')}
    </div>`;
}

// ── Payment modal ─────────────────────────────
window.openPay = function(id) {
  S.selectedRider = id;
  S.selectedPack = null;
  const r = S.riders[id];
  if (!r) return;
  const [bg,fg] = avColor(id);
  $('pay-rider-info').innerHTML = `
    <div class="pay-av" style="background:${bg};color:${fg}">${initials(r.name)}</div>
    <div>
      <div class="pay-name">${r.name}</div>
      <div class="pay-sub">${r.rides||0} rides left · ${r.stop}</div>
    </div>`;
  document.querySelectorAll('.pack').forEach(p=>p.classList.remove('on'));
  $('custom-wrap').classList.add('hidden');
  openModal('modal-pay');
};

window.pickPack = function(rides, amount, el, type) {
  document.querySelectorAll('.pack').forEach(p=>p.classList.remove('on'));
  el.classList.add('on');
  if (type === 'custom') {
    S.selectedPack = 'custom';
    $('custom-wrap').classList.remove('hidden');
  } else {
    S.selectedPack = { rides, amount };
    $('custom-wrap').classList.add('hidden');
  }
};

window.confirmPay = function() {
  let rides, amount;
  if (!S.selectedPack) { toast('Select a pack first'); return; }
  if (S.selectedPack === 'custom') {
    rides = parseInt($('c-rides').value);
    amount = parseInt($('c-amount').value);
    if (!rides||!amount) { toast('Enter rides and amount'); return; }
  } else {
    ({ rides, amount } = S.selectedPack);
  }
  const id = S.selectedRider;
  const r = S.riders[id];
  if (!r) return;
  const newRides = (r.rides||0) + rides;
  const newMax = Math.max(r.maxRides||5, newRides);
  const payment = { rides, amount, ts: new Date().toISOString(), method:'UPI/GPay' };
  const updated = { ...r, rides: newRides, maxRides: newMax, payments:[...(r.payments||[]),payment] };
  if (DB_READY()) {
    dbSet(`riders/${id}`, updated);
  } else {
    S.riders[id] = updated;
    renderRiders(); renderWallet();
  }
  closeModal();
  toast(`✓ Added ${rides} rides for ${r.name}`);
};

window.removeRider = function() {
  if (!confirm('Are you sure you want to completely remove this rider?')) return;
  const id = S.selectedRider;
  if (DB_READY()) {
    dbRemove(`riders/${id}`);
  }
  delete S.riders[id];
  renderRiders(); renderWallet();
  closeModal();
  toast('Rider removed');
};

// ── Tab nav ───────────────────────────────────
window.goTab = function(tab) {
  ['map','riders','wallet'].forEach(t=>{
    $(`tab-${t}`)?.classList.toggle('active', t===tab);
  });
  $('panel-riders').classList.toggle('hidden', tab!=='riders');
  $('panel-wallet').classList.toggle('hidden', tab!=='wallet');
  if (tab==='map') setTimeout(()=>map?.invalidateSize(), 100);
  if (tab==='riders') renderRiders();
  if (tab==='wallet') renderWallet();
};

// ── Modal ─────────────────────────────────────
function openModal(id) {
  $('backdrop').classList.remove('hidden');
  const m = $(id);
  m.classList.remove('hidden');
  requestAnimationFrame(()=>m.classList.add('show'));
}
window.closeModal = function() {
  document.querySelectorAll('.modal').forEach(m=>{
    m.classList.remove('show');
    setTimeout(()=>m.classList.add('hidden'), 300);
  });
  $('backdrop').classList.add('hidden');
};

// ── Settings ──────────────────────────────────
window.openSettings = function() {
  $('s-name').value = S.user?.name||'';
  const isDriver = S.user?.role?.startsWith('driver');
  const stopRow = $('s-stop-row');
  const busRow = $('s-bus-row');
  if (isDriver) {
    if (stopRow) stopRow.style.display = 'none';
    if (busRow) { busRow.style.display = 'block'; $('s-bus-display').textContent = `Bus ${S.user.role.slice(-1)} (${S.user.name})`; }
  } else {
    if (stopRow) stopRow.style.display = 'block';
    if (busRow) busRow.style.display = 'none';
    const sel = $('s-stop');
    sel.innerHTML = CONFIG.STOPS.map(s=>`<option value="${s.name}" ${S.user?.stop===s.name?'selected':''}>${s.name}</option>`).join('');
  }
  openModal('modal-settings');
};
window.saveSettings = function() {
  const name = $('s-name').value.trim();
  const isDriver = S.user?.role?.startsWith('driver');
  const stop = isDriver ? S.user.stop : $('s-stop').value;
  if (!name || (!isDriver && !stop)) { toast('Fill all fields'); return; }
  S.user = {...S.user, name, stop};
  localStorage.setItem('nc_user', JSON.stringify(S.user));
  $('avatar-btn').textContent = initials(name);

  // Sync driver name to Firebase and update local popup
  if (isDriver && DB_READY()) {
    const busNum = S.user.role.slice(-1);
    dbUpdateValues({ [`driverInfo/driver${busNum}/name`]: name });
    updateBusPopup(parseInt(busNum));
  }

  closeModal(); toast('Saved ✓');
};
window.resetApp = function() {
  localStorage.removeItem('nc_user');
  location.reload();
};
window.hardRefresh = function() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
      for(let registration of registrations) {
        registration.unregister();
      }
      window.location.reload(true);
    });
  } else {
    window.location.reload(true);
  }
};

// ── Setup screen ──────────────────────────────
let _role = '';
window.pickRole = function(r) {
  _role = r;
  ['rider','driver1','driver2'].forEach(x=>$(`rt-${x}`).classList.toggle('on', x===r));
  $('common-fields').classList.remove('hidden');
  $('btn-join').disabled = false;
  $('btn-join').textContent = 'Join NoChutti →';
  if (r.startsWith('driver')) {
    $('rider-fields').classList.add('hidden');
    $('driver-pin-row').classList.remove('hidden');
  } else {
    $('rider-fields').classList.remove('hidden');
    $('driver-pin-row').classList.add('hidden');
  }
};

// Populate stop dropdown in setup
function populateSetupStops() {
  const sel = $('setup-stop');
  CONFIG.STOPS.forEach(s=>{
    const o = document.createElement('option');
    o.value = s.name; o.textContent = s.name;
    sel.appendChild(o);
  });
}

window.doSetup = function() {
  if (!_role) { toast('Select your role'); return; }
  const name = $('setup-name').value.trim();
  const phone = $('setup-phone').value.trim();
  if (!name) { toast('Enter your name'); return; }
  if (!phone || phone.length !== 10) { toast('Enter a valid 10-digit mobile number'); return; }

  if (_role === 'rider') {
    const stop = $('setup-stop').value;
    const code = $('setup-code').value.trim().toLowerCase();
    if (!stop) { toast('Select your stop'); return; }
    if (code !== CONFIG.JOIN_CODE) { toast('Wrong join code — ask your driver'); return; }
  } else {
    const pin = $('driver-pin').value;
    if (pin !== CONFIG.DRIVER_PINS[_role]) { toast('Wrong driver PIN'); return; }
  }

  localStorage.setItem('nc_last_name', name);
  localStorage.setItem('nc_last_phone', phone);

  const id = _role === 'rider'
    ? `r_${phone}`
    : `${_role}_main`;

  const stopVal = _role === 'rider' ? $('setup-stop').value : '';
  const user = { name, phone, stop: stopVal, role: _role, id };
  localStorage.setItem('nc_user', JSON.stringify(user));

  // Register rider in Firebase
  if (_role === 'rider' && DB_READY()) {
    const existing = S.riders[id];
    if (!existing) {
      dbSet(`riders/${id}`, { name, phone, stop: stopVal, rides:0, maxRides:5, payments:[], checkedIn:false, busToday:null });
    }
  }

  // Register driver name in Firebase so bus popup can show it
  if (_role.startsWith('driver') && DB_READY()) {
    const busNum = _role.slice(-1); // '1' or '2'
    dbSet(`driverInfo/driver${busNum}`, { name, phone, ts: Date.now() });
  }

  S.user = user;
  $('screen-setup').classList.add('hidden');
  launch();
};

// ── Launch ────────────────────────────────────
function launch() {
  const u = S.user;
  $('app').classList.remove('hidden');
  $('avatar-btn').textContent = initials(u.name);
  updateTopbarCtx();

  // Show correct overlays
  const isDriver = u.role.startsWith('driver');
  $('driver-overlay').style.display = isDriver ? 'flex' : 'none';
  $('rider-checkin-overlay').style.display = isDriver ? 'none' : 'flex';

  initMap();
  listenBusPositions();
  listenRiders();
  if (DB_READY()) initDriverInfoListeners();

  if (isDriver) {
    listenRiderPositions();
    // Ensure driver's local name is synced to Firebase for riders to see
    const busNum = u.role.slice(-1);
    dbUpdateValues({ [`driverInfo/driver${busNum}/name`]: u.name, [`driverInfo/driver${busNum}/ts`]: Date.now() });
  }

  if (!isDriver) {
    // Slight delay then update check-in button
    setTimeout(updateCheckinBtn, 800);
  }

  // Auto-select rider's bus if they're already checked in
  setTimeout(()=>{
    if (!isDriver) {
      const r = S.riders[u.id];
      if (r?.checkedIn && r.busToday) selectBus(r.busToday);
    }
  }, 1000);
}

// ── Boot ──────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  populateSetupStops();

  const bindClick = (id, handler) => {
    const el = $(id);
    if (el) el.addEventListener('click', handler);
  };
  const bindAllClick = (selector, handler) => {
    document.querySelectorAll(selector).forEach(el => el.addEventListener('click', handler));
  };

  bindClick('rt-rider', () => pickRole('rider'));
  bindClick('rt-driver1', () => pickRole('driver1'));
  bindClick('rt-driver2', () => pickRole('driver2'));
  bindClick('btn-join', doSetup);
  bindClick('btn-hard-refresh', hardRefresh);
  bindClick('btn-hard-refresh-settings', hardRefresh);
  bindClick('avatar-btn', openSettings);
  bindClick('bustab-1', () => selectBus(1));
  bindClick('bustab-2', () => selectBus(2));
  bindClick('sp-am', () => selectSlot('am'));
  bindClick('sp-pm', () => selectSlot('pm'));
  bindClick('btn-broadcast', toggleBroadcast);
  bindClick('btn-wa', shareWA);
  bindClick('btn-end-trip', endTrip);
  bindClick('btn-checkin', toggleCheckin);
  bindClick('btn-onboard', toggleOnboard);
  bindClick('btn-rider-loc', toggleRiderLocation);
  bindClick('tab-map', () => goTab('map'));
  bindClick('tab-riders', () => goTab('riders'));
  bindClick('tab-wallet', () => goTab('wallet'));
  bindClick('btn-panel-close', () => goTab('map'));
  bindClick('btn-confirm-pay', confirmPay);
  bindClick('btn-remove-rider', removeRider);
  bindClick('btn-save-settings', saveSettings);
  bindClick('btn-reset-app', resetApp);
  bindClick('btn-confirm-end-trip', confirmEndTrip);
  bindClick('btn-cancel-end-trip', closeModal);
  bindClick('backdrop', closeModal);
  bindAllClick('.modal-x', closeModal);

  const lName = localStorage.getItem('nc_last_name');
  const lPhone = localStorage.getItem('nc_last_phone');
  if (lName) $('setup-name').value = lName;
  if (lPhone) $('setup-phone').value = lPhone;

  setTimeout(() => {
    $('splash').classList.add('out');
    setTimeout(()=>{ $('splash').style.display='none'; }, 500);

    const saved = localStorage.getItem('nc_user');
    if (saved) {
      try { S.user = JSON.parse(saved); launch(); }
      catch { $('screen-setup').classList.remove('hidden'); }
    } else {
      $('screen-setup').classList.remove('hidden');
    }
  }, 1800);
});

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
