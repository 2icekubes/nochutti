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
  riderLocation: null,
  riderPositions: {},
  riderSnapTimer: null,
  programmaticMapMove: false,
  riders: {},          // id → rider
  checkins: {},        // "YYYY-MM-DD" → { bus1: Set<id>, bus2: Set<id> }
  busPositions: { am: {}, pm: {} },    // slot → busN → { lat, lng, ts }
  selectedRider: null,
  selectedPack: null,
  demoStep: { 1: 0, 2: 5 },
  demoInterval: null,
  notifiedEvents: [],
  lastOnboardPromptKey: '',
  driverInfo: { 1: null, 2: null },
  myRideDraft: { am: { pickup: '', drop: '', bus: 1 }, pm: { pickup: '', drop: '', bus: 1 } },
  myRideManageSlot: 'am',
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

// Prompt driver with nearby riders to onboard
function promptDriverOnboard(riderIds, stopName = '') {
  if (!riderIds || !riderIds.length) return;
  const listEl = $('onboard-list');
  if (!listEl) return;
  const titleEl = document.querySelector('#modal-onboard .modal-title');
  if (titleEl) titleEl.textContent = stopName ? `Onboard at ${stopName}` : 'Onboard riders';
  listEl.innerHTML = '';
  riderIds.forEach(id => {
    const r = S.riders[id];
    if (!r) return;
    const item = document.createElement('div');
    item.style.display = 'flex'; item.style.justifyContent = 'space-between'; item.style.alignItems = 'center';
    item.innerHTML = `<div><strong>${r.name}</strong><div style="font-size:12px;color:var(--t2)">${getRiderRouteLabel(r)}</div></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn-primary'; btn.style.marginLeft = '8px'; btn.textContent = 'Onboard';
    btn.onclick = () => confirmDriverOnboard(id, btn);
    item.appendChild(btn);
    listEl.appendChild(item);
  });
  window.openModal('modal-onboard');
}

function confirmDriverOnboard(id, btn = null) {
  const r = S.riders[id];
  if (!r) return;
  const ride = getRideForSlot(r, S.slot);
  const busAssigned = ride?.bus || parseInt(S.user?.role?.slice(-1)) || r.busToday || S.bus;
  const updated = buildRiderRecord(r, {
    checkedIn: true,
    busToday: busAssigned,
    onboarded: true,
    lastCheckin: today(),
  });
  S.riders[id] = updated;
  if (DB_READY()) dbSet(`riders/${id}`, updated);
  renderRiders();
  updateOccupancy();
  updateStopPopups();
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Onboarded';
    btn.closest('div').style.opacity = '0.65';
  }
  toast(`Onboarded ${r.name}`);
}

// Auto-deboard riders when bus reaches their drop stop
function checkAutoDeboard(busN, lat, lng) {
  const toProcess = [];
  Object.entries(S.riders).forEach(([id, r]) => {
    if (!r.onboarded) return;
    if (r.busToday !== busN) return;
    const drop = getRideForSlot(r, S.slot)?.drop || getRiderDropStop(r);
    const stop = findStopByValue(drop, S.slot);
    if (!stop) return;
    const d = Math.sqrt(Math.pow((lat - stop.lat) * 111, 2) + Math.pow((lng - stop.lng) * 111, 2));
    if (d < (CONFIG.AUTO_DEBOARD_KM || 0.05)) toProcess.push(id);
  });
  if (!toProcess.length) return;
  const updates = {};
  toProcess.forEach(id => {
    updates[`riders/${id}/checkedIn`] = false;
    updates[`riders/${id}/busToday`] = null;
    updates[`riders/${id}/onboarded`] = false;
  });
  if (DB_READY()) dbUpdateValues(updates).then(() => {
    toast(`Auto-deboarded ${toProcess.length} rider${toProcess.length>1?'s':''}`);
  }).catch(err => console.warn('auto-deboard error', err));
  if (!DB_READY()) {
    toProcess.forEach(id => { S.riders[id].checkedIn = false; S.riders[id].busToday = null; S.riders[id].onboarded = false; });
    renderRiders(); updateOccupancy(); updateCheckinBtn();
  }
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
const dateKey = value => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
};
const fmtDate = s => new Date(s).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
const isValidSlot = slot => slot === 'am' || slot === 'pm';
const isFreshPosition = pos => !!pos && Date.now() - pos.ts < 30 * 60 * 1000;

function getBusPosition(busN, slot = S.slot) {
  return isValidSlot(slot) ? S.busPositions[slot]?.[busN] || null : null;
}

function setBusPosition(busN, position, slot = S.slot) {
  if (!isValidSlot(slot)) return;
  S.busPositions[slot] = S.busPositions[slot] || {};
  S.busPositions[slot][busN] = { ...position, slot };
}

function clearBusPosition(busN, slot = S.slot) {
  if (isValidSlot(slot) && S.busPositions[slot]) delete S.busPositions[slot][busN];
}

const AV_COLORS = [
  ['rgba(74,222,128,.18)','#4ade80'],
  ['rgba(96,165,250,.18)','#60a5fa'],
  ['rgba(251,191,36,.18)','#fbbf24'],
  ['rgba(248,113,113,.18)','#f87171'],
  ['rgba(167,139,250,.18)','#a78bfa'],
  ['rgba(251,146,60,.18)','#fb923c'],
];
const avColor = id => AV_COLORS[[...id].reduce((s,c)=>s+c.charCodeAt(0),0) % AV_COLORS.length];

function getStopsForSlot(slot = S.slot) {
  return slot === 'pm' ? CONFIG.PM_STOPS : CONFIG.AM_STOPS;
}

function findStopByValue(value, slot = S.slot) {
  if (!value) return null;
  return getStopsForSlot(slot).find(s => s.id === value || s.name === value || s.aliases?.includes(value)) || null;
}

function getStopValueAtIndex(index, slot = S.slot) {
  const stop = getStopsForSlot(slot)[index];
  return stop ? stop.name : '';
}

function createEmptySavedRides() {
  return { am: null, pm: null };
}

function normalizeSavedRideEntry(ride, slot) {
  if (!ride) return null;
  const pickup = ride.pickup || ride.boardingStop || ride.stop || '';
  const drop = ride.drop || ride.dropStop || '';
  if (!pickup || !drop) return null;
  return {
    slot,
    pickup,
    drop,
    bus: ride.bus === 2 ? 2 : 1,
    savedAt: ride.savedAt || new Date().toISOString(),
  };
}

function normalizeSavedRides(rider) {
  const rides = createEmptySavedRides();
  if (rider?.savedRides) {
    rides.am = normalizeSavedRideEntry(rider.savedRides.am, 'am');
    rides.pm = normalizeSavedRideEntry(rider.savedRides.pm, 'pm');
  } else if (rider?.boardingStop || rider?.dropStop || rider?.stop) {
    rides.am = normalizeSavedRideEntry({
      pickup: rider.boardingStop || rider.stop || '',
      drop: rider.dropStop || rider.boardingStop || rider.stop || '',
    }, 'am');
  }
  return rides;
}

function getRideForSlot(rider = S.user, slot = S.slot) {
  const rides = normalizeSavedRides(rider);
  return rides[slot] || null;
}

function getExplicitRideForSlot(rider, slot = S.slot) {
  const ride = rider?.savedRides?.[slot];
  if (!ride?.pickup || !ride?.drop || dateKey(ride.savedAt) !== today()) return null;
  return {
    slot,
    pickup: ride.pickup,
    drop: ride.drop,
    bus: ride.bus === 2 ? 2 : 1,
    savedAt: ride.savedAt,
  };
}

function getCurrentRide(slot = S.slot, rider = S.user) {
  return getRideForSlot(rider, slot);
}

function buildRiderRecord(base = {}, overrides = {}) {
  const merged = { ...base, ...overrides };
  const savedRides = createEmptySavedRides();
  const incoming = overrides.savedRides || merged.savedRides || {};
  savedRides.am = normalizeSavedRideEntry(incoming.am, 'am');
  savedRides.pm = normalizeSavedRideEntry(incoming.pm, 'pm');
  const hasExplicitSavedRides = Object.prototype.hasOwnProperty.call(overrides, 'savedRides') || Object.prototype.hasOwnProperty.call(base, 'savedRides');
  if (!hasExplicitSavedRides && !savedRides.am && (merged.boardingStop || merged.stop || merged.dropStop)) {
    savedRides.am = normalizeSavedRideEntry({
      pickup: merged.boardingStop || merged.stop || '',
      drop: merged.dropStop || merged.boardingStop || merged.stop || '',
    }, 'am');
  }
  merged.savedRides = savedRides;
  merged.stop = savedRides.am?.pickup || merged.stop || '';
  merged.boardingStop = savedRides.am?.pickup || merged.boardingStop || merged.stop || '';
  merged.dropStop = savedRides.pm?.drop || savedRides.am?.drop || merged.dropStop || '';
  return merged;
}

function syncRideDraftFromSavedRides(rider = S.user) {
  ['am', 'pm'].forEach(slot => {
    const ride = getRideForSlot(rider, slot);
    S.myRideDraft[slot] = {
      pickup: ride?.pickup || '',
      drop: ride?.drop || '',
      bus: ride?.bus || 1,
    };
  });
}

function getDropOptionsForPickup(pickup, slot = S.slot) {
  const stops = getStopsForSlot(slot);
  const startIndex = stops.findIndex(stop => stopMatchesValue(stop, pickup));
  return startIndex >= 0 ? stops.slice(startIndex + 1) : [];
}

function getRiderBoardingStop(rider = S.user) {
  return getRideForSlot(rider, 'am')?.pickup || rider?.boardingStop || rider?.stop || '';
}

function getRiderDropStop(rider = S.user) {
  return getRideForSlot(rider, 'pm')?.drop || rider?.dropStop || '';
}

function getRiderActiveStop(rider = S.user, slot = S.slot) {
  const ride = getRideForSlot(rider, slot);
  if (!ride) return slot === 'pm' ? getRiderDropStop(rider) || getRiderBoardingStop(rider) : getRiderBoardingStop(rider);
  return rider?.onboarded ? ride.drop : ride.pickup;
}

function getRiderBookedStop(rider, slot = S.slot) {
  const ride = getRideForSlot(rider, slot);
  if (!ride) return '';
  return ride.pickup;
}

function isRiderBookedForStop(rider, stop, slot = S.slot, busN = null) {
  const ride = getExplicitRideForSlot(rider, slot);
  if (!ride) return false;
  if (busN !== null && ride.bus !== busN) return false;
  const pickupStop = findStopByValue(ride.pickup, slot);
  return !!pickupStop && pickupStop.id === stop.id;
}

function getBookedRidersForStop(stop, busN, slot = S.slot) {
  return Object.entries(S.riders)
    .filter(([id, r]) =>
      isRiderRecord(id, r) &&
      !r.onboarded &&
      isRiderBookedForStop(r, stop, slot, busN)
    )
    .map(([id]) => id);
}

function getNearbyBookedRidersByLocation(busN, lat, lng, slot = S.slot) {
  const now = Date.now();
  const threshold = CONFIG.ONBOARD_PROXIMITY_KM || 0.2;
  const busPoint = { lat, lng };
  return Object.entries(S.riderPositions)
    .filter(([id, pos]) => {
      const rider = S.riders[id];
      const ride = getExplicitRideForSlot(rider, slot);
      return pos?.lat && pos?.lng &&
        now - pos.ts < 15 * 60 * 1000 &&
        isRiderRecord(id, rider) &&
        !rider.onboarded &&
        ride?.bus === busN &&
        distanceKm(busPoint, pos) < threshold;
    })
    .map(([id]) => id);
}

function getNearestStop(lat, lng, slot = S.slot) {
  let nearest = null;
  let nearestDistance = Infinity;
  getStopsForSlot(slot).forEach(stop => {
    const d = distanceKm({ lat, lng }, stop);
    if (d < nearestDistance) {
      nearest = stop;
      nearestDistance = d;
    }
  });
  return nearest ? { stop: nearest, distance: nearestDistance } : null;
}

function isRiderRecord(id, rider) {
  if (!rider) return false;
  if (rider.role?.startsWith?.('driver')) return false;
  if (id?.startsWith?.('driver')) return false;
  return true;
}


function getStopOrderMap(slot = S.slot) {
  const order = {};
  getStopsForSlot(slot).forEach((stop, index) => {
    order[stop.name] = index;
    order[stop.id] = index;
    stop.aliases?.forEach(alias => {
      order[alias] = index;
    });
  });
  return order;
}

function stopMatchesValue(stop, value) {
  return !!value && (stop.name === value || stop.id === value || stop.aliases?.includes(value));
}

function getRiderRouteLabel(rider = S.user) {
  const ride = getRideForSlot(rider, S.slot) || getRideForSlot(rider, 'am') || getRideForSlot(rider, 'pm');
  const pickup = ride?.pickup || getRiderBoardingStop(rider);
  const drop = ride?.drop || getRiderDropStop(rider);
  return drop && drop !== pickup ? `${pickup} -> ${drop}` : pickup;
}

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
let map, olaMapsClient, busMarkers = {};

const DEFAULT_OLA_STYLE_URL = 'https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json?key=0.4.0';
const toLngLat = (lat, lng) => [lng, lat];

function requireOlaMapsSdk() {
  if (typeof window.OlaMaps !== 'function') {
    throw new Error('Ola Maps SDK did not load.');
  }
  if (!CONFIG.OLA_MAPS_API_KEY) {
    throw new Error('Set CONFIG.OLA_MAPS_API_KEY in js/config.js.');
  }
}

function createPopup(html) {
  return new window.OlaMaps.Popup({
    closeButton: false,
    closeOnClick: true,
    maxWidth: '220px',
    offset: 18,
  }).setHTML(html);
}

function createMarker({ lat, lng, html, popupHtml = '', hidden = false }) {
  const shell = document.createElement('div');
  shell.innerHTML = html.trim();
  const element = shell.firstElementChild;
  const marker = new window.OlaMaps.Marker({ element, anchor: 'center' })
    .setLngLat(toLngLat(lat, lng))
    .addTo(map);

  if (hidden) element.style.opacity = '0';

  const wrapped = {
    marker,
    element,
    popup: null,
    addTo() {
      this.marker.addTo(map);
      return this;
    },
    bindPopup(htmlContent) {
      this.popup = createPopup(htmlContent);
      this.marker.setPopup(this.popup);
      return this;
    },
    openPopup() {
      if (this.popup && !this.popup.isOpen()) this.marker.togglePopup();
      return this;
    },
    isPopupOpen() {
      return !!this.popup?.isOpen();
    },
    setPopupContent(htmlContent) {
      if (!this.popup) return this.bindPopup(htmlContent);
      this.popup.setHTML(htmlContent);
      return this;
    },
    setLatLng(coords) {
      this.marker.setLngLat(toLngLat(coords[0], coords[1]));
      return this;
    },
    setOpacity(opacity) {
      this.element.style.opacity = String(opacity);
      return this;
    },
    remove() {
      this.marker.remove();
    },
  };

  if (popupHtml) wrapped.bindPopup(popupHtml);
  return wrapped;
}

function createBusMarker(busN) {
  const bus = CONFIG.BUSES[busN];
  busMarkers[busN] = createMarker({
    lat: CONFIG.MAP_CENTER[0],
    lng: CONFIG.MAP_CENTER[1],
    html: `<div id="busmarker-${busN}" style="width:38px;height:38px;border-radius:50%;background:#4ade80;border:3px solid #0d1f0f;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 14px rgba(74,222,128,.45)">${bus.emoji}</div>`,
  });
  updateBusPopup(busN);
  return busMarkers[busN];
}

function addRouteLine() {
  if (!map || map.getSource('route-path')) return;
  map.addSource('route-path', {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: CONFIG.ROUTE_PATH.map(([lat, lng]) => toLngLat(lat, lng)),
      },
      properties: {},
    },
  });
  map.addLayer({
    id: 'route-path',
    type: 'line',
    source: 'route-path',
    paint: {
      'line-color': '#4ade80',
      'line-width': 4,
      'line-opacity': 0.8,
    },
  });
}

function setMapView(lat, lng, zoom = 15) {
  if (!map) return;
  S.programmaticMapMove = true;
  map.easeTo({ center: toLngLat(lat, lng), zoom, duration: 0 });
  setTimeout(() => { S.programmaticMapMove = false; }, 250);
}

function scheduleRiderMapSnap() {
  if (S.user?.role?.startsWith('driver')) return;
  if (!S.riderLocation) return;
  if (!$('tab-map')?.classList.contains('active')) return;
  clearTimeout(S.riderSnapTimer);
  S.riderSnapTimer = setTimeout(() => {
    if (S.riderLocation) setMapView(S.riderLocation.lat, S.riderLocation.lng, 16);
  }, 1800);
}

function initRiderMapSnap() {
  if (!map) return;
  ['dragend', 'zoomend', 'rotateend', 'pitchend'].forEach(eventName => {
    map.on(eventName, () => {
      if (S.programmaticMapMove) return;
      scheduleRiderMapSnap();
    });
  });
}

async function initMap() {
  requireOlaMapsSdk();
  olaMapsClient = new window.OlaMaps({ apiKey: CONFIG.OLA_MAPS_API_KEY });
  map = await olaMapsClient.init({
    style: CONFIG.OLA_STYLE_URL || DEFAULT_OLA_STYLE_URL,
    container: 'map',
    center: toLngLat(CONFIG.MAP_CENTER[0], CONFIG.MAP_CENTER[1]),
    zoom: CONFIG.MAP_ZOOM,
  });

  if (S.user?.role?.startsWith('driver')) {
    if (map.loaded()) addRouteLine();
    else map.once('load', addRouteLine);
  }
  initRiderMapSnap();

  window._stopMarkers = {};
  renderStopMarkers();

  [1, 2].forEach(n => {
    busMarkers[n] = null;
  });
}

function renderStopMarkers() {
  const stopMarkers = window._stopMarkers || {};
  Object.values(stopMarkers).forEach(marker => marker?.remove());

  const freshMarkers = {};
  let stopsToRender = getStopsForSlot();
  if (!S.user?.role?.startsWith('driver')) {
    const ride = getRideForSlot(S.user, S.slot);
    stopsToRender = [ride?.pickup, ride?.drop]
      .map(value => findStopByValue(value, S.slot))
      .filter(Boolean)
      .filter((stop, index, arr) => arr.findIndex(candidate => candidate.id === stop.id) === index);
  }
  stopsToRender.forEach(stop => {
    freshMarkers[stop.id] = _makeStopMarker(stop, 0).addTo();
  });
  window._stopMarkers = freshMarkers;
  updateStopPopups();
}

// Creates a stop marker icon sized/coloured by rider count
function _makeStopMarker(s, count) {
  const hasRiders = count > 0;
  const size = hasRiders ? 14 : 10;
  const bg = hasRiders ? '#4ade80' : '#555';
  const glow = hasRiders ? ';box-shadow:0 0 0 3px rgba(74,222,128,0.4)' : '';
  return createMarker({
    lat: s.lat,
    lng: s.lng,
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:2px solid #0d1f0f${glow}"></div>`,
  });
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

function moveBus(busN, lat, lng, slot = S.slot, ts = Date.now()) {
  if (!isValidSlot(slot)) return;
  setBusPosition(busN, { lat, lng, ts }, slot);
  if (slot !== S.slot) {
    updateStatusBadges();
    return;
  }

  if (!busMarkers[busN]) createBusMarker(busN);
  busMarkers[busN].setLatLng([lat, lng]);
  updateStatusBadges();
  if (busN === S.bus) updateETA(lat, lng);
  checkProximity(busN, lat, lng);
  // After proximity checks, run auto-deboard for any onboarded riders
  checkAutoDeboard(busN, lat, lng);

  // Pulse the bus marker icon if this driver is broadcasting
  const isMyBus = S.user?.role === `driver${busN}` && S.broadcasting;
  const el = document.getElementById(`busmarker-${busN}`);
  if (el) el.classList.toggle('bus-live-pulse', isMyBus);
}

function hideBus(busN, slot = S.slot) {
  clearBusPosition(busN, slot);
  if (slot === S.slot && busMarkers[busN]) {
    busMarkers[busN].remove();
    busMarkers[busN] = null;
  }
  updateStatusBadges();
  if (slot === S.slot && S.bus === busN) {
    const el = $('eta-text');
    if (el) el.textContent = 'Trip yet to start';
  }
}

function refreshBusMarkerForSlot(busN) {
  const pos = getBusPosition(busN);
  if (isFreshPosition(pos)) {
    if (!busMarkers[busN]) createBusMarker(busN);
    busMarkers[busN].setLatLng([pos.lat, pos.lng]);
    if (busN === S.bus) updateETA(pos.lat, pos.lng);
  } else if (busMarkers[busN]) {
    busMarkers[busN].remove();
    busMarkers[busN] = null;
    if (busN === S.bus) $('eta-text').textContent = 'Trip yet to start';
  }
}

function refreshBusMarkersForSlot() {
  [1, 2].forEach(refreshBusMarkerForSlot);
  updateStatusBadges();
}

function checkProximity(busN, lat, lng) {
  // Driver-specific proximity: prompt to onboard riders when bus nears boarding stop
  if (S.user?.role?.startsWith('driver')) {
    const nearbyStop = getNearestStop(lat, lng, S.slot);
    const threshold = CONFIG.ONBOARD_PROXIMITY_KM || 0.2;
    if (nearbyStop && nearbyStop.distance < threshold) {
      const stopRiderIds = getBookedRidersForStop(nearbyStop.stop, busN, S.slot);
      const nearbyRiderIds = getNearbyBookedRidersByLocation(busN, lat, lng, S.slot);
      const riderIds = [...new Set([...stopRiderIds, ...nearbyRiderIds])];
      const promptKey = `${today()}_${S.slot}_bus${busN}_${nearbyStop.stop.id}_${riderIds.join(',')}`;
      if (riderIds.length && promptKey !== S.lastOnboardPromptKey) {
        S.lastOnboardPromptKey = promptKey;
        promptDriverOnboard(riderIds, nearbyStop.stop.name);
      }
    } else {
      const riderIds = getNearbyBookedRidersByLocation(busN, lat, lng, S.slot);
      const promptKey = `${today()}_${S.slot}_bus${busN}_nearby_${riderIds.join(',')}`;
      if (riderIds.length && promptKey !== S.lastOnboardPromptKey) {
        S.lastOnboardPromptKey = promptKey;
        promptDriverOnboard(riderIds, 'nearby');
      }
    }
    return;
  }

  // Rider-facing proximity (existing behaviour)
  if (busN !== S.bus) return;

  const targetStopValue = getRiderActiveStop(S.user);
  if (!targetStopValue) {
    el.textContent = `Book your ${S.slot.toUpperCase()} ride in MyRide`;
    return;
  }
  const stop = findStopByValue(targetStopValue);
  if (!stop) return;

  const d = Math.sqrt(Math.pow((lat - stop.lat) * 111, 2) + Math.pow((lng - stop.lng) * 111, 2));

  // "Bus started" only fires if bus is near the first route stop
  const firstStop = getStopsForSlot()[0];
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
    el.textContent = isBroadcastingThisBus ? `Broadcasting Bus ${S.bus}` : `Bus ${S.bus} · ${getSlotBusLabel(S.slot, S.bus)}`;
    return;
  }

  const pos = getBusPosition(S.bus);
  if (!isFreshPosition(pos)) {
    el.textContent = 'Trip yet to start';
    return;
  }
  lat = lat ?? pos.lat;
  lng = lng ?? pos.lng;

  const targetStopValue = getRiderActiveStop(S.user);
  if (!targetStopValue) {
    el.textContent = `Book your ${S.slot.toUpperCase()} ride in MyRide`;
    return;
  }
  const stop = findStopByValue(targetStopValue);
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
    const pos = getBusPosition(n);
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
  const route = CONFIG.ROUTE_PATH;
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
      const slot = d?.slot;
      const isCurrentTrip = isValidSlot(slot) && d.date === today();
      if (d?.lat && d?.lng && d?.ts && isCurrentTrip && Date.now() - d.ts < 30 * 60 * 1000) {
        moveBus(n, d.lat, d.lng, slot, d.ts);
      } else {
        hideBus(n, isValidSlot(slot) ? slot : S.slot);
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
    S.riders = Object.fromEntries(Object.entries(DEMO_RIDERS).map(([id, rider]) => [id, buildRiderRecord(rider)]));
    syncRideDraftFromSavedRides(S.riders[S.user?.id] || S.user);
    sweepMidnight();
    renderRiders(); renderWallet(); renderMyRide(); updateOccupancy(); updateCheckinBtn(); updateStopPopups();
    return;
  }
  dbOnValue('riders', snap => {
    const raw = snap.val() || {};
    S.riders = Object.fromEntries(Object.entries(raw).map(([id, rider]) => [id, buildRiderRecord(rider)]));
    syncRideDraftFromSavedRides(S.riders[S.user?.id] || S.user);
    sweepMidnight();
    renderRiders(); renderWallet(); renderMyRide(); updateOccupancy(); updateCheckinBtn(); updateStopPopups();
  });
}

// ── Stop popup counts ──────────────────────────
function updateStopPopups(openAll) {
  const stopMarkers = window._stopMarkers;
  if (!stopMarkers) return;
  const busN = S.user?.role?.startsWith('driver') ? parseInt(S.user.role.slice(-1)) : null;

  Object.values(stopMarkers).forEach(marker => marker?.remove());

  let stopsToRender = getStopsForSlot();
  if (!S.user?.role?.startsWith('driver')) {
    const ride = getRideForSlot(S.user, S.slot);
    stopsToRender = [ride?.pickup, ride?.drop]
      .map(value => findStopByValue(value, S.slot))
      .filter(Boolean)
      .filter((stop, index, arr) => arr.findIndex(candidate => candidate.id === stop.id) === index);
  }

  const freshMarkers = {};
  stopsToRender.forEach(s => {
    const old = stopMarkers[s.id];

    const count = Object.entries(S.riders).filter(([id, r]) =>
      isRiderRecord(id, r) && isRiderBookedForStop(r, s, S.slot, busN)
    ).length;

    const popupHtml = `
      <div style="text-align:center;min-width:60px;line-height:1.2">
        <b style="color:var(--t0);font-size:11px">${s.name}</b><br>
        <span style="font-size:16px;font-weight:700;color:${count > 0 ? '#4ade80' : '#aaa'};display:inline-block;margin:2px 0">${count}</span><br>
        <span style="color:#aaa;font-size:10px">rider${count !== 1 ? 's' : ''} today</span>
      </div>`;

    // Swap marker icon to reflect count (remove old, add new)
    const wasOpen = old?.isPopupOpen?.() || false;
    const fresh = _makeStopMarker(s, count).bindPopup(popupHtml).addTo();
    freshMarkers[s.id] = fresh;
    if ((openAll && count > 0) || wasOpen) fresh.openPopup();
  });
  window._stopMarkers = freshMarkers;
}

let riderMarkers = {};
function listenRiderPositions() {
  if (!DB_READY()) return;
  if (!S.user?.role?.startsWith('driver')) return;

  dbOnValue('riderPositions', snap => {
    const data = snap.val() || {};
    const now = Date.now();
    const STALE_MS = 15 * 60 * 1000;
    S.riderPositions = Object.fromEntries(Object.entries(data).filter(([, pos]) =>
      pos?.lat && pos?.lng && now - pos.ts <= STALE_MS
    ));

    // Add / update markers for active riders
    Object.entries(S.riderPositions).forEach(([id, pos]) => {
      if (!pos?.lat || !pos?.lng) return;

      // Rider name: try S.riders first, fall back to id
      const riderName = S.riders[id]?.name || id;
      const av = initials(riderName);
      const popupHtml = `<div style="text-align:center;min-width:90px"><b style="color:var(--t0);font-size:13px">${riderName}</b><br><span style="color:#aaa;font-size:11px">Sharing location</span></div>`;

      if (!riderMarkers[id]) {
        riderMarkers[id] = createMarker({
          lat: pos.lat,
          lng: pos.lng,
          html: `<div style="width:28px;height:28px;border-radius:50%;background:rgba(96,165,250,0.25);border:1.5px solid rgba(96,165,250,0.7);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#1d4ed8;letter-spacing:0">${av}</div>`,
          popupHtml,
        });
      } else {
        riderMarkers[id].setLatLng([pos.lat, pos.lng]);
        riderMarkers[id].setPopupContent(popupHtml);
      }
    });

    // Remove markers for riders who stopped sharing or went stale
    Object.keys(riderMarkers).forEach(id => {
      if (!S.riderPositions[id]) {
        riderMarkers[id].remove();
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
  updateTopbarCtx();
  updateCheckinBtn();
  const pos = getBusPosition(n);
  if (isFreshPosition(pos)) { 
    setMapView(pos.lat, pos.lng, 15); 
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
  $('bustab-1-sub').textContent = getSlotBusLabel(slot, 1);
  $('bustab-2-sub').textContent = getSlotBusLabel(slot, 2);
  renderStopMarkers();
  refreshBusMarkersForSlot();
  updateTopbarCtx();
  updateCheckinBtn();
  renderMyRide();
};

function updateTopbarCtx() {
  const role = S.user?.role || '';
  const tag = role.startsWith('driver') ? `Driver · Bus ${role.slice(-1)}` : 'Rider';
  $('topbar-ctx').textContent = `${tag} · ${getSlotBusLabel(S.slot, S.bus)}`;
}

// ── GPS Broadcast ─────────────────────────────
window.toggleBroadcast = function() {
  S.broadcasting ? confirmEndTrip() : startBroadcast();
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
  const broadcastSlot = S.slot;
  S.watchId = navigator.geolocation.watchPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    const ts = Date.now();
    moveBus(busN, lat, lng, broadcastSlot, ts);
    setMapView(lat, lng, 15);
    dbSet(`bus${busN}/position`, { lat, lng, slot: broadcastSlot, date: today(), ts });
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
    // When broadcasting, the same button becomes the trip end control
    $('bc-label').textContent = 'End trip';
    $('bc-icon').textContent = '🛑';
  } else {
    btn.classList.remove('live');
    $('bc-label').textContent = 'Start Trip and Broadcast Location';
    $('bc-icon').textContent = '📡';
  }
}

window.shareWA = function() {
  const busN = parseInt(S.user.role.slice(-1));
  const slot = getSlotBusLabel(S.slot, busN);
  const msg = encodeURIComponent(
    `🚌 NoChutti — Bus ${busN} is running!\n` +
    `Slot: ${slot}\n` +
    `(I'll drop a live location pin in a moment)`
  );
  window.open(`https://wa.me/?text=${msg}`, '_blank');
};

window.openDriverOnboardList = function() {
  if (!S.user?.role?.startsWith('driver')) return;
  const busN = parseInt(S.user.role.slice(-1));
  const pos = getBusPosition(busN);
  if (!isFreshPosition(pos)) {
    toast('Start broadcasting to detect the current stop');
    return;
  }

  const nearest = getNearestStop(pos.lat, pos.lng, S.slot);
  const threshold = CONFIG.ONBOARD_PROXIMITY_KM || 0.2;
  const stopRiderIds = nearest && nearest.distance <= threshold
    ? getBookedRidersForStop(nearest.stop, busN, S.slot)
    : [];
  const nearbyRiderIds = getNearbyBookedRidersByLocation(busN, pos.lat, pos.lng, S.slot);
  const riderIds = [...new Set([...stopRiderIds, ...nearbyRiderIds])];
  if (!riderIds.length) {
    toast(nearest && nearest.distance <= threshold
      ? `No booked riders at ${nearest.stop.name}`
      : 'No booked riders nearby');
    return;
  }

  promptDriverOnboard(riderIds, nearest && nearest.distance <= threshold ? nearest.stop.name : 'nearby');
};

// ── Rider Location Sharing ──────────────────────
window.toggleRiderLocation = function() {
  S.riderBroadcasting ? stopRiderLocation() : startRiderLocation();
};

let myMarker = null;
function startRiderLocation(options = {}) {
  const silent = !!options.silent;
  if (S.riderBroadcasting) return;
  if (!navigator.geolocation) { toast('Geolocation not available'); return; }
  requestWakeLock();
  const id = S.user.id;
  if (!myMarker) {
    myMarker = createMarker({
      lat: CONFIG.MAP_CENTER[0],
      lng: CONFIG.MAP_CENTER[1],
      html: '<div style="width:28px;height:28px;border-radius:50%;background:rgba(248,113,113,0.25);border:1.5px solid rgba(248,113,113,0.7);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--red);">📍</div>',
      hidden: true,
    });
  }

  S.riderWatchId = navigator.geolocation.watchPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    const hadLocation = !!S.riderLocation;
    S.riderLocation = { lat, lng, ts: Date.now() };
    if (myMarker) { myMarker.setLatLng([lat, lng]); myMarker.setOpacity(1); }
    if (!hadLocation && $('tab-map')?.classList.contains('active')) setMapView(lat, lng, 16);
    dbSet(`riderPositions/${id}`, { lat, lng, slot: S.slot, bus: S.bus, ts: S.riderLocation.ts });
  }, err => toast('GPS: ' + err.message), { enableHighAccuracy:true, maximumAge:5000, timeout:10000 });
  S.riderBroadcasting = true;
  updateRiderLocationBtn();
  if (!silent) toast('Location sharing started');
  return;
  const icon = ({
    html: `<div style="width:28px;height:28px;border-radius:50%;background:rgba(248,113,113,0.25);border:1.5px solid rgba(248,113,113,0.7);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--red);">📍</div>`,
    iconSize: [28,28], iconAnchor: [14,14], className: ''
  });
  if (!myMarker) myMarker = createMarker({ lat: CONFIG.MAP_CENTER[0], lng: CONFIG.MAP_CENTER[1], html: '<div></div>', hidden: true });

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
  S.riderLocation = null;
  releaseWakeLock();
  if (myMarker) { myMarker.remove(); myMarker = null; }
  dbRemove(`riderPositions/${S.user.id}`);
  updateRiderLocationBtn();
  toast('Location sharing stopped');
}

function updateRiderLocationBtn() {
  const btn = $('btn-rider-loc-top');
  if (!btn) return;
  btn.classList.remove('hidden');
  if (S.riderBroadcasting) {
    btn.classList.add('live');
  } else {
    btn.classList.remove('live');
  }
}

// endTrip uses a styled modal instead of browser confirm()
window.endTrip = function() {
  window.openModal('modal-end-trip');
};
window.confirmEndTrip = function() {
  window.closeModal();
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

  const activeBusPosition = getBusPosition(S.bus);
  if (!newStatus && activeBusPosition) {
    const pos = activeBusPosition;
    const stop = findStopByValue(getRiderActiveStop(S.user));
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

  const updated = buildRiderRecord(S.riders[id] || { name: S.user.name, rides:0, maxRides:5, payments:[] }, {
    checkedIn: newStatus, busToday: busAssigned, lastCheckin: today()
  });

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
  if (!btn && !btnOb) return;
  const rider = S.riders[S.user?.id];
  const isDriver = S.user?.role?.startsWith('driver');

  if (isDriver) {
    // Driver view: hide checkin button, show onboard control if a ride exists
    if (btn) btn.style.display = 'none';
    if (!btnOb) return;
    const ride = getRideForSlot(rider, S.slot);
    const isOb = rider?.onboarded;
    btnOb.style.display = ride ? 'flex' : 'none';
    btnOb.classList.toggle('checked-in', !!isOb);
    $('ob-icon').textContent = isOb ? '✓' : '🚌';
    $('ob-label').textContent = isOb ? `Onboarded Bus ${ride?.bus || S.bus}` : `Onboard Bus ${ride?.bus || S.bus}`;
    return;
  }

  // Rider view
  if (!btn) return;
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

window.toggleOnboard = function() {
  const id = S.user.id;
  const rider = S.riders[id];
  const ride = getRideForSlot(rider, S.slot);
  if (!ride) {
    toast(`Book your ${S.slot.toUpperCase()} ride in MyRide first`);
    return;
  }
  const busAssigned = ride.bus || S.bus || 1;
  window.selectBus(busAssigned);

  const isNowOnboard = !rider?.onboarded;
  let nextRides = rider?.rides || 0;

  if (isNowOnboard && CONFIG.AUTO_DEDUCT_ON_CHECKIN && !rider?.onboarded) {
    if (nextRides > 0) {
      nextRides -= 1;
      toast(`Onboarded Bus ${busAssigned} · 1 ride deducted`);
    } else {
      toast(`No rides left. Please pay driver.`);
    }
  } else if (isNowOnboard) {
    toast(`Onboarded Bus ${busAssigned}`);
  } else {
    // Prevent riders from deboarding manually unless bus is at their drop stop
    if (S.user?.role && !S.user.role.startsWith('driver')) {
      const pos = getBusPosition(busAssigned);
      const drop = ride.drop || getRiderDropStop(rider);
      const stop = findStopByValue(drop, S.slot);
      if (stop && pos) {
        const d = Math.sqrt(Math.pow((pos.lat - stop.lat) * 111, 2) + Math.pow((pos.lng - stop.lng) * 111, 2));
        if (d > (CONFIG.AUTO_DEBOARD_KM || 0.05)) {
          toast('Cannot deboard until bus reaches your destination');
          return;
        }
      }
    }
    toast(`Offboarded Bus ${busAssigned}`);
  }

  const updated = buildRiderRecord(S.riders[id] || {}, {
    rides: nextRides,
    checkedIn: isNowOnboard,
    busToday: isNowOnboard ? busAssigned : null,
    onboarded: isNowOnboard,
    lastCheckin: isNowOnboard ? today() : S.riders[id]?.lastCheckin || null
  });
  if (DB_READY()) {
    dbSet(`riders/${id}`, updated);
  } else {
    S.riders[id] = updated;
    updateCheckinBtn();
    updateOccupancy();
  }
};



function updateOccupancy() {
  const riders = Object.entries(S.riders)
    .filter(([id, r]) => isRiderRecord(id, r))
    .map(([, r]) => r);
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
    .filter(([id, r]) => isRiderRecord(id, r))
    .filter(([,r]) => r.name.toLowerCase().includes(q));

  // Checked-in filter (driver only)
  if (isDriver && _riderFilter === 'in') {
    entries = entries.filter(([,r]) => r.checkedIn);
  }

  // Sorting
  if (_riderSort === 'stop') {
    // Sort by stop position in STOPS array
    const stopOrder = getStopOrderMap();
    entries.sort((a, b) => (stopOrder[getRiderActiveStop(a[1])] ?? 999) - (stopOrder[getRiderActiveStop(b[1])] ?? 999));
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
        <div class="r-stop">📍 ${getRiderRouteLabel(r)}</div>
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
            <div class="r-stop">${getRiderRouteLabel(r)}</div>
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

function getSlotRideDateLabel(slot = S.slot) {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}

function formatRideTime(timeValue) {
  if (!timeValue) return '';
  const [rawHours, rawMinutes] = timeValue.split(':').map(Number);
  const hours = rawHours;
  const period = hours >= 12 ? 'pm' : 'am';
  const displayHour = ((hours + 11) % 12) + 1;
  return `${displayHour}:${String(rawMinutes).padStart(2, '0')} ${period}`;
}

function getSlotBusTime(slot = S.slot, bus = S.bus) {
  return CONFIG.SLOTS[slot]?.times?.[bus] || CONFIG.SLOTS[slot]?.times?.[1] || '';
}

function getSlotBusLabel(slot = S.slot, bus = S.bus) {
  return formatRideTime(getSlotBusTime(slot, bus));
}

function addMinutesToTime(timeValue, minutesToAdd = 0) {
  if (!timeValue) return '';
  const [hours, minutes] = timeValue.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes + Math.round(minutesToAdd), 0, 0);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function distanceKm(a, b) {
  if (!a || !b) return 0;
  return Math.sqrt(Math.pow((a.lat - b.lat) * 111, 2) + Math.pow((a.lng - b.lng) * 111, 2));
}

function getScheduledStopOffsetMinutes(stopValue, slot = S.slot) {
  const stops = getStopsForSlot(slot);
  const stopIndex = stops.findIndex(stop => stopMatchesValue(stop, stopValue));
  if (stopIndex <= 0) return 0;

  const speed = slot === 'am' ? 18 : 22;
  let total = 0;
  for (let i = 1; i <= stopIndex; i++) {
    total += (distanceKm(stops[i - 1], stops[i]) / speed) * 60;
  }
  return Math.round(total);
}

function getScheduledStopTime(stopValue, slot = S.slot, bus = S.bus) {
  const baseTime = getSlotBusTime(slot, bus);
  return formatRideTime(addMinutesToTime(baseTime, getScheduledStopOffsetMinutes(stopValue, slot)));
}

function getMyRideBusButtonLabel(slot, bus) {
  return `Bus ${bus} ${getSlotBusLabel(slot, bus).toUpperCase()}`;
}

function populateMyRideSelectors() {
  const pickupSelect = $('myride-pickup');
  const dropSelect = $('myride-drop');
  if (!pickupSelect || !dropSelect) return;
  const draft = S.myRideDraft[S.slot] || { pickup: '', drop: '', bus: 1 };
  pickupSelect.innerHTML = `<option value="">Select pickup...</option>${getStopsForSlot().map(stop => `<option value="${stop.name}" ${draft.pickup === stop.name ? 'selected' : ''}>${stop.name}</option>`).join('')}`;
  const dropOptions = getDropOptionsForPickup(draft.pickup, S.slot);
  dropSelect.innerHTML = `<option value="">Select drop...</option>${dropOptions.map(stop => `<option value="${stop.name}" ${draft.drop === stop.name ? 'selected' : ''}>${stop.name}</option>`).join('')}`;
}

function renderMyRide() {
  const el = $('myride-inner');
  if (!el || S.user?.role?.startsWith('driver')) return;
  const ride = getCurrentRide();
  const draft = S.myRideDraft[S.slot] || { pickup: '', drop: '', bus: 1 };
  const rideBus = ride?.bus || draft.bus || 1;
  const pickupTime = ride ? getScheduledStopTime(ride.pickup, S.slot, rideBus) : getSlotBusLabel(S.slot, rideBus);
  const dropTime = ride ? getScheduledStopTime(ride.drop, S.slot, rideBus) : '';
  el.innerHTML = `
    <div class="myride-shell">
      <div class="panel-titlerow">
        <h2 class="panel-title">MyRide</h2>
        <button class="panel-close" onclick="goTab('map')">✕</button>
      </div>
      <div class="myride-slot-switch">
        <button type="button" class="myride-slot-btn${S.slot === 'am' ? ' active' : ''}" onclick="switchMyRideSlot('am')">AM Ride</button>
        <button type="button" class="myride-slot-btn${S.slot === 'pm' ? ' active' : ''}" onclick="switchMyRideSlot('pm')">PM Ride</button>
      </div>
      <div class="myride-bus-switch">
        <button type="button" class="myride-bus-btn${draft.bus === 1 ? ' active' : ''}" onclick="selectMyRideBus(1)">${getMyRideBusButtonLabel(S.slot, 1)}</button>
        <button type="button" class="myride-bus-btn${draft.bus === 2 ? ' active' : ''}" onclick="selectMyRideBus(2)">${getMyRideBusButtonLabel(S.slot, 2)}</button>
      </div>
      <div class="myride-card">
        <div class="myride-route">
          <div class="myride-dots">
            <span class="myride-dot pickup"></span>
            <span class="myride-line"></span>
            <span class="myride-dot drop"></span>
          </div>
          <div>
            <div class="myride-field">
              <label>Pickup</label>
              <select class="inp" id="myride-pickup"></select>
            </div>
            <div class="myride-field">
              <label>Dropoff</label>
              <select class="inp" id="myride-drop"></select>
            </div>
          </div>
        </div>
        <button type="button" class="btn-primary full" id="btn-save-myride">Book my ride</button>
      </div>
      ${ride ? `
        <div>
          <div class="myride-upcoming-head">Upcoming Rides</div>
          <div class="myride-ride-card">
            <div class="myride-ride-main">
              <div class="myride-date">${getSlotRideDateLabel(S.slot)} - Bus ${rideBus}</div>
              <div class="myride-ride-route">
                <div class="myride-route-row">
                  <div class="myride-time pickup">${pickupTime}</div>
                  <span class="myride-dot pickup"></span>
                  <div class="myride-ride-stop">${ride.pickup}</div>
                </div>
                <div class="myride-route-row">
                  <div class="myride-time drop">${dropTime}</div>
                  <span class="myride-dot drop"></span>
                  <div class="myride-ride-stop">${ride.drop}</div>
                </div>
              </div>
            </div>
            <div class="myride-ride-actions">
              <button type="button" class="btn-ghost" onclick="openManageRide('${S.slot}')">Manage Ride</button>
              <button type="button" class="btn-primary" onclick="trackRide('${S.slot}')">Track Ride</button>
            </div>
          </div>
        </div>
      ` : ''}
    </div>`;
  populateMyRideSelectors();
  $('btn-save-myride')?.addEventListener('click', window.saveMyRide);
  $('myride-pickup')?.addEventListener('change', event => {
    S.myRideDraft[S.slot].pickup = event.target.value;
    S.myRideDraft[S.slot].drop = '';
    populateMyRideSelectors();
  });
  $('myride-drop')?.addEventListener('change', event => {
    S.myRideDraft[S.slot].drop = event.target.value;
  });
}

window.switchMyRideSlot = function(slot) {
  window.selectSlot(slot);
  const ride = getRideForSlot(S.riders[S.user?.id], slot);
  const draft = S.myRideDraft[slot] || { pickup: '', drop: '', bus: 1 };
  window.selectBus(ride?.bus || draft.bus || 1);
  window.goTab('myride');
};

window.selectMyRideBus = function(bus) {
  S.myRideDraft[S.slot].bus = bus;
  window.selectBus(bus);
  renderMyRide();
};

window.saveMyRide = function() {
  const rider = S.riders[S.user?.id] || {};
  const draft = S.myRideDraft[S.slot] || { pickup: '', drop: '', bus: 1 };
  if (!draft.pickup || !draft.drop) {
    toast('Select both pickup and drop');
    return;
  }
  const savedRides = normalizeSavedRides(rider);
  const selectedBus = draft.bus === 2 ? 2 : 1;
  savedRides[S.slot] = { slot: S.slot, pickup: draft.pickup, drop: draft.drop, bus: selectedBus, savedAt: new Date().toISOString() };
  const updated = buildRiderRecord(rider, {
    name: S.user.name,
    phone: S.user.phone,
    savedRides,
    checkedIn: true,
    busToday: selectedBus,
    onboarded: false,
    lastCheckin: today()
  });
  S.riders[S.user.id] = updated;
  S.user = buildRiderRecord(S.user, { savedRides, checkedIn: true, busToday: selectedBus, onboarded: false, lastCheckin: today() });
  localStorage.setItem('nc_user', JSON.stringify(S.user));
  if (DB_READY()) dbSet(`riders/${S.user.id}`, updated);
  window.selectBus(selectedBus);
  renderMyRide();
  renderRiders();
  updateStopPopups();
  updateETA();
  updateCheckinBtn();
  updateOccupancy();
  toast('Ride booked');
};

window.openManageRide = function(slot) {
  const ride = getRideForSlot(S.riders[S.user?.id], slot);
  if (!ride) return;
  S.myRideManageSlot = slot;
  $('manage-ride-summary').textContent = `${slot.toUpperCase()} · ${ride.pickup} -> ${ride.drop}`;
  window.openModal('modal-manage-ride');
};

window.manageRideEdit = function() {
  const ride = getRideForSlot(S.riders[S.user?.id], S.myRideManageSlot);
  if (ride) {
    S.myRideDraft[S.myRideManageSlot] = {
      pickup: ride.pickup,
      drop: ride.drop,
      bus: ride.bus || 1,
    };
    window.selectBus(ride.bus || 1);
  }
  window.closeModal();
  window.selectSlot(S.myRideManageSlot);
  window.goTab('myride');
};

window.manageRideCancel = function() {
  const rider = S.riders[S.user?.id] || {};
  const savedRides = normalizeSavedRides(rider);
  savedRides[S.myRideManageSlot] = null;
  S.myRideDraft[S.myRideManageSlot] = { pickup: '', drop: '', bus: S.bus };
  const updated = buildRiderRecord(rider, {
    savedRides,
    checkedIn: false,
    busToday: null,
    onboarded: false
  });
  S.riders[S.user.id] = updated;
  S.user = buildRiderRecord(S.user, { savedRides, checkedIn: false, busToday: null, onboarded: false });
  localStorage.setItem('nc_user', JSON.stringify(S.user));
  if (DB_READY()) dbSet(`riders/${S.user.id}`, updated);
  window.closeModal();
  renderMyRide();
  updateCheckinBtn();
  updateOccupancy();
  toast('Ride cancelled');
};

window.trackRide = function(slot) {
  const ride = getRideForSlot(S.riders[S.user?.id], slot);
  if (ride?.bus) window.selectBus(ride.bus);
  window.selectSlot(slot);
  window.goTab('map');
  const pos = getBusPosition(ride?.bus || S.bus);
  if (pos) updateETA(pos.lat, pos.lng);
};

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
      <div class="pay-sub">${r.rides||0} rides left · ${getRiderRouteLabel(r)}</div>
    </div>`;
  document.querySelectorAll('.pack').forEach(p=>p.classList.remove('on'));
  $('custom-wrap').classList.add('hidden');
  window.openModal('modal-pay');
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
  window.closeModal();
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
  window.closeModal();
  toast('Rider removed');
};

// ── Tab nav ───────────────────────────────────
window.goTab = function(tab) {
  ['map','riders','wallet','myride'].forEach(t=>{
    $(`tab-${t}`)?.classList.toggle('active', t===tab);
  });
  $('panel-riders').classList.toggle('hidden', tab!=='riders');
  $('panel-wallet').classList.toggle('hidden', tab!=='wallet');
  $('panel-myride')?.classList.toggle('hidden', tab!=='myride');
  if (tab==='map') setTimeout(()=>map?.resize(), 100);
  if (tab==='map' && S.riderLocation && !S.user?.role?.startsWith('driver')) {
    setTimeout(() => setMapView(S.riderLocation.lat, S.riderLocation.lng, 16), 150);
  }
  if (tab==='riders') renderRiders();
  if (tab==='wallet') renderWallet();
  if (tab==='myride') renderMyRide();
};

// ── Modal ─────────────────────────────────────
window.openModal = function(id) {
  $('backdrop').classList.remove('hidden');
  const m = $(id);
  m.classList.remove('hidden');
  requestAnimationFrame(()=>m.classList.add('show'));
};
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
  const busRow = $('s-bus-row');
  if (isDriver) {
    if (busRow) { busRow.style.display = 'block'; $('s-bus-display').textContent = `Bus ${S.user.role.slice(-1)} (${S.user.name})`; }
  } else {
    if (busRow) busRow.style.display = 'none';
  }
  window.openModal('modal-settings');
};
window.saveSettings = function() {
  const name = $('s-name').value.trim();
  const isDriver = S.user?.role?.startsWith('driver');
  if (!name) { toast('Fill all fields'); return; }
  S.user = buildRiderRecord(S.user, { name });
  localStorage.setItem('nc_user', JSON.stringify(S.user));
  $('avatar-btn').textContent = initials(name);

  // Sync driver name to Firebase and update local popup
  if (isDriver && DB_READY()) {
    const busNum = S.user.role.slice(-1);
    dbUpdateValues({ [`driverInfo/driver${busNum}/name`]: name });
    updateBusPopup(parseInt(busNum));
  } else if (!isDriver) {
    const nextRider = buildRiderRecord(S.riders[S.user.id] || {}, { name });
    S.riders[S.user.id] = nextRider;
    if (DB_READY()) dbSet(`riders/${S.user.id}`, nextRider);
    renderRiders();
    renderWallet();
    renderMyRide();
  }

  window.closeModal(); toast('Saved ✓');
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
function populateBoardingSelect(selectEl, selectedValue = '') {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Select stop...</option>';
  CONFIG.AM_STOPS.forEach(stop => {
    const option = document.createElement('option');
    option.value = stop.name;
    option.textContent = stop.name;
    option.selected = selectedValue === stop.name;
    selectEl.appendChild(option);
  });
}

function populateDropSelect(boardingStop, selectEl, selectedValue = '') {
  if (!selectEl) return;
  const startIndex = CONFIG.AM_STOPS.findIndex(stop => stop.name === boardingStop || stop.id === boardingStop);
  const dropOptions = startIndex >= 0 ? CONFIG.AM_STOPS.slice(startIndex + 1) : [];
  selectEl.innerHTML = '<option value="">Select drop location...</option>';
  dropOptions.forEach(stop => {
    const option = document.createElement('option');
    option.value = stop.name;
    option.textContent = stop.name;
    option.selected = selectedValue === stop.name;
    selectEl.appendChild(option);
  });
  if (selectedValue && !dropOptions.some(stop => stop.name === selectedValue)) {
    selectEl.value = '';
  }
}

function populateSetupStops() {
  return;
}

window.doSetup = function() {
  if (!_role) { toast('Select your role'); return; }
  const name = $('setup-name').value.trim();
  const phone = $('setup-phone').value.trim();
  if (!name) { toast('Enter your name'); return; }
  if (!phone || phone.length !== 10) { toast('Enter a valid 10-digit mobile number'); return; }

  if (_role === 'rider') {
    const code = $('setup-code').value.trim().toLowerCase();
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

  const user = buildRiderRecord({ name, phone, role: _role, id });
  localStorage.setItem('nc_user', JSON.stringify(user));

  // Register rider in Firebase
  if (_role === 'rider' && DB_READY()) {
    const existing = S.riders[id] || {};
    dbSet(`riders/${id}`, {
      rides: 0,
      maxRides: 5,
      payments: [],
      checkedIn: false,
      busToday: null,
      ...existing,
      name,
      phone,
      savedRides: normalizeSavedRides(existing),
    });
  }

  // Register driver name in Firebase so bus popup can show it
  if (_role.startsWith('driver') && DB_READY()) {
    const busNum = _role.slice(-1); // '1' or '2'
    dbSet(`driverInfo/driver${busNum}`, { name, phone, ts: Date.now() });
  }

  S.user = user;
  $('screen-setup').classList.add('hidden');
  launch().catch(handleLaunchError);
};

// ── Launch ────────────────────────────────────
function handleLaunchError(err) {
  console.error(err);
  toast(err?.message || 'Unable to start Ola Maps.');
}

async function launch() {
  const u = S.user;
  const isDriver = u.role.startsWith('driver');
  if (isDriver) {
    S.bus = parseInt(u.role.slice(-1)) || 1;
  }
  $('app').classList.remove('hidden');
  $('avatar-btn').textContent = initials(u.name);
  updateTopbarCtx();

  // Show correct overlays
  $('driver-overlay').style.display = isDriver ? 'flex' : 'none';
  $('rider-checkin-overlay').style.display = isDriver ? 'none' : 'flex';
  $('btn-rider-loc-top')?.classList.toggle('hidden', isDriver);
  if ($('tab-myride')) $('tab-myride').style.display = isDriver ? 'none' : 'flex';
  // hide the topbar context for drivers (not required next to wordmark)
  if ($('topbar-ctx')) $('topbar-ctx').style.display = isDriver ? 'none' : 'block';
  if ($('bus-bar')) $('bus-bar').style.display = isDriver ? 'flex' : 'none';
  const busBadges = document.querySelector('.bus-badges');
  if (busBadges) busBadges.style.display = isDriver ? 'flex' : 'none';
  // If driver logged in for a particular bus, hide the other bus tab
  if (isDriver) {
    const busTab1 = $('bustab-1');
    const busTab2 = $('bustab-2');
    busTab1?.classList.toggle('active', S.bus === 1);
    busTab2?.classList.toggle('active', S.bus === 2);
    if (u.role === 'driver1') { if (busTab2) busTab2.style.display = 'none'; }
    if (u.role === 'driver2') { if (busTab1) busTab1.style.display = 'none'; }
  }

  await initMap();
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
    syncRideDraftFromSavedRides(u);
    updateRiderLocationBtn();
    setTimeout(() => startRiderLocation({ silent: true }), 1000);
  }

  // Auto-select rider's bus if they're already checked in
  setTimeout(()=>{
    if (!isDriver) {
      const r = S.riders[u.id];
      if (r?.checkedIn && r.busToday) window.selectBus(r.busToday);
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

  bindClick('rt-rider', () => window.pickRole('rider'));
  bindClick('rt-driver1', () => window.pickRole('driver1'));
  bindClick('rt-driver2', () => window.pickRole('driver2'));
  bindClick('btn-join', window.doSetup);
  bindClick('btn-hard-refresh', window.hardRefresh);
  bindClick('btn-hard-refresh-settings', window.hardRefresh);
  bindClick('avatar-btn', window.openSettings);
  bindClick('btn-rider-loc-top', window.toggleRiderLocation);
  bindClick('bustab-1', () => window.selectBus(1));
  bindClick('bustab-2', () => window.selectBus(2));
  bindClick('sp-am', () => window.selectSlot('am'));
  bindClick('sp-pm', () => window.selectSlot('pm'));
  bindClick('btn-broadcast', window.toggleBroadcast);
  bindClick('btn-driver-onboard', window.openDriverOnboardList);
  bindClick('btn-wa', window.shareWA);
  bindClick('btn-checkin', window.toggleCheckin);
  bindClick('btn-onboard', window.toggleOnboard);
  bindClick('tab-map', () => window.goTab('map'));
  bindClick('tab-riders', () => window.goTab('riders'));
  bindClick('tab-wallet', () => window.goTab('wallet'));
  bindClick('tab-myride', () => window.goTab('myride'));
  bindClick('btn-panel-close', () => window.goTab('map'));
  bindClick('btn-confirm-pay', window.confirmPay);
  bindClick('btn-remove-rider', window.removeRider);
  bindClick('btn-save-settings', window.saveSettings);
  bindClick('btn-reset-app', window.resetApp);
  bindClick('btn-confirm-end-trip', window.confirmEndTrip);
  bindClick('btn-cancel-end-trip', window.closeModal);
  bindClick('btn-manage-edit', window.manageRideEdit);
  bindClick('btn-manage-cancel', window.manageRideCancel);
  bindClick('backdrop', window.closeModal);
  bindAllClick('.modal-x', window.closeModal);

  const lName = localStorage.getItem('nc_last_name');
  const lPhone = localStorage.getItem('nc_last_phone');
  if (lName) $('setup-name').value = lName;
  if (lPhone) $('setup-phone').value = lPhone;

  setTimeout(() => {
    $('splash').classList.add('out');
    setTimeout(()=>{ $('splash').style.display='none'; }, 500);

    const saved = localStorage.getItem('nc_user');
    if (saved) {
      try {
        S.user = buildRiderRecord(JSON.parse(saved));
        if (S.user?.role === 'rider') {
          localStorage.setItem('nc_user', JSON.stringify(S.user));
        }
        launch().catch(handleLaunchError);
      }
      catch { $('screen-setup').classList.remove('hidden'); }
    } else {
      $('screen-setup').classList.remove('hidden');
    }
  }, 1800);
});

// Register service worker
if ('serviceWorker' in navigator) {
  let refreshingForUpdate = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshingForUpdate) return;
    refreshingForUpdate = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('./sw.js').then(registration => {
    registration.update().catch(() => {});

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          newWorker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
  }).catch(()=>{});
}
