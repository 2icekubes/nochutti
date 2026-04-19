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
  riders: {},          // id → rider
  checkins: {},        // "YYYY-MM-DD" → { bus1: Set<id>, bus2: Set<id> }
  busPositions: {},    // busN → { lat, lng, ts }
  selectedRider: null,
  selectedPack: null,
  demoStep: { 1: 0, 2: 5 },
  demoInterval: null,
};

// ── Demo riders ───────────────────────────────
const DEMO_RIDERS = {
  r001: { name:'Ananya Roy',      stop:'Sector 5',    rides:3, maxRides:5,  payments:[], checkedIn: true,  busToday:1 },
  r002: { name:'Sourav Kar',      stop:'Park Street', rides:1, maxRides:5,  payments:[], checkedIn: true,  busToday:2 },
  r003: { name:'Priya Mehta',     stop:'Sector 5',    rides:0, maxRides:5,  payments:[], checkedIn: false, busToday:null },
  r004: { name:'Rahul Bose',      stop:'Ultadanga',   rides:8, maxRides:20, payments:[], checkedIn: true,  busToday:1 },
  r005: { name:'Debjani Sen',     stop:'Salt Lake',   rides:4, maxRides:5,  payments:[], checkedIn: true,  busToday:2 },
  r006: { name:'Arjun Das',       stop:'Park Street', rides:2, maxRides:10, payments:[], checkedIn: true,  busToday:1 },
  r007: { name:'Mitali Ghosh',    stop:'Shyambazar',  rides:9, maxRides:20, payments:[], checkedIn: false, busToday:null },
  r008: { name:'Siddharth Paul',  stop:'Sector 5',    rides:0, maxRides:5,  payments:[], checkedIn: true,  busToday:2 },
  r009: { name:'Rima Chatterjee', stop:'Salt Lake',   rides:5, maxRides:5,  payments:[], checkedIn: true,  busToday:1 },
  r010: { name:'Niloy Sen',       stop:'Ultadanga',   rides:3, maxRides:10, payments:[], checkedIn: true,  busToday:2 },
};

// ── Helpers ───────────────────────────────────
const $ = id => document.getElementById(id);
const initials = n => n.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
const today = () => new Date().toISOString().slice(0,10);
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

// ── Map ───────────────────────────────────────
let map, busMarkers = {};

function initMap() {
  map = L.map('map', { zoomControl:false, attributionControl:false,
    center: CONFIG.MAP_CENTER, zoom: CONFIG.MAP_ZOOM });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(map);

  // Stop markers
  CONFIG.STOPS.forEach(s => {
    const icon = L.divIcon({
      html:`<div style="width:10px;height:10px;border-radius:50%;background:#4ade80;border:2px solid #0d1f0f;box-shadow:0 0 0 2px #4ade80"></div>`,
      iconSize:[10,10], iconAnchor:[5,5], className:''
    });
    L.marker([s.lat, s.lng], { icon }).addTo(map)
      .bindPopup(`<b style="color:#0d1f0f;font-size:13px">${s.name}</b>`);
  });

  // Bus markers for both buses
  [1, 2].forEach(n => {
    const bus = CONFIG.BUSES[n];
    const icon = L.divIcon({
      html:`<div id="busmarker-${n}" style="width:38px;height:38px;border-radius:50%;background:#4ade80;border:3px solid #0d1f0f;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 14px rgba(74,222,128,.45)">${bus.emoji}</div>`,
      iconSize:[38,38], iconAnchor:[19,19], className:''
    });
    busMarkers[n] = L.marker(CONFIG.MAP_CENTER, { icon, opacity: 0.5 }).addTo(map)
      .bindPopup(`<b style="color:#0d1f0f">${bus.name}</b>`);
  });
}

function moveBus(busN, lat, lng) {
  if (!busMarkers[busN]) return;
  busMarkers[busN].setLatLng([lat, lng]);
  busMarkers[busN].setOpacity(1);
  S.busPositions[busN] = { lat, lng, ts: Date.now() };
  updateStatusBadges();
  if (busN === S.bus) updateETA(lat, lng);
}

function updateETA(lat, lng) {
  const stop = CONFIG.STOPS.find(s => s.id === S.user?.stop) ||
               CONFIG.STOPS.find(s => s.name === S.user?.stop);
  const el = $('eta-text');
  if (!stop || !el) return;
  const d = Math.sqrt(Math.pow((lat-stop.lat)*111,2)+Math.pow((lng-stop.lng)*111,2));
  if (d < 0.05) { el.textContent = `Bus ${S.bus} is at your stop! 🎉`; return; }
  const mins = Math.max(1, Math.round(d/28*60));
  if (S.user?.role?.startsWith('driver')) {
    el.textContent = `Bus ${S.bus} broadcasting · ${CONFIG.SLOTS[S.slot].label}`;
  } else {
    el.textContent = `Bus ${S.bus} · ~${mins} min to ${stop.name}`;
  }
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
  if (!firebaseReady || !db) { startDemo(); return; }
  [1,2].forEach(n => {
    onValue(ref(db, `bus${n}/position`), snap => {
      const d = snap.val();
      if (d?.lat) moveBus(n, d.lat, d.lng);
    });
  });
}

function listenRiders() {
  if (!firebaseReady || !db) {
    S.riders = DEMO_RIDERS;
    renderRiders(); renderWallet(); updateOccupancy();
    return;
  }
  onValue(ref(db, 'riders'), snap => {
    S.riders = snap.val() || {};
    renderRiders(); renderWallet(); updateOccupancy();
  });
}

// ── Bus tab & slot ────────────────────────────
window.selectBus = function(n) {
  S.bus = n;
  [1,2].forEach(i => {
    $(`bustab-${i}`).classList.toggle('active', i===n);
  });
  const pos = S.busPositions[n];
  if (pos) { map.setView([pos.lat, pos.lng], 15); updateETA(pos.lat, pos.lng); }
  else { $('eta-text').textContent = `Bus ${n} — no position yet`; }
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

function startBroadcast() {
  if (!navigator.geolocation) { toast('Geolocation not available'); return; }
  const busN = parseInt(S.user.role.slice(-1));
  S.watchId = navigator.geolocation.watchPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    moveBus(busN, lat, lng);
    map.setView([lat, lng], 15);
    if (firebaseReady && db) {
      set(ref(db, `bus${busN}/position`), { lat, lng, ts: serverTimestamp() });
    }
  }, err => toast('GPS: ' + err.message), { enableHighAccuracy:true, maximumAge:5000, timeout:10000 });
  S.broadcasting = true;
  updateBroadcastBtn();
  toast(`📡 Broadcasting Bus ${busN} location`);
}

function stopBroadcast() {
  if (S.watchId) navigator.geolocation.clearWatch(S.watchId);
  S.watchId = null;
  S.broadcasting = false;
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
    $('bc-label').textContent = 'Start broadcasting location';
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

// ── Rider check-in ────────────────────────────
window.toggleCheckin = function() {
  const id = S.user.id;
  const rider = S.riders[id];
  const alreadyIn = rider?.checkedIn;
  const newStatus = !alreadyIn;
  const busAssigned = newStatus ? S.bus : null;

  const updated = { ...(S.riders[id] || { name: S.user.name, stop: S.user.stop, rides:0, maxRides:5, payments:[] }),
    checkedIn: newStatus, busToday: busAssigned, lastCheckin: today() };

  if (firebaseReady && db) {
    set(ref(db, `riders/${id}`), updated);
  } else {
    S.riders[id] = updated;
    updateCheckinBtn();
    updateOccupancy();
  }
  toast(newStatus ? `✓ Checked in on Bus ${busAssigned}` : 'Check-in removed');
};

function updateCheckinBtn() {
  const btn = $('btn-checkin');
  if (!btn) return;
  const rider = S.riders[S.user?.id];
  const isIn = rider?.checkedIn;
  btn.classList.toggle('checked-in', !!isIn);
  $('ci-icon').textContent = isIn ? '✓' : '○';
  $('ci-label').textContent = isIn
    ? `On Bus ${rider.busToday} today · tap to remove`
    : `Check in for Bus ${S.bus} today`;
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
}

// ── Render Riders list ────────────────────────
function renderRiders() {
  const el = $('rider-list');
  if (!el) return;
  const q = ($('rider-search')?.value||'').toLowerCase();
  const isDriver = S.user?.role?.startsWith('driver');
  const entries = Object.entries(S.riders)
    .filter(([,r])=>r.name.toLowerCase().includes(q))
    .sort((a,b)=>(a[1].rides||0)-(b[1].rides||0));

  const zeroes = entries.filter(([,r])=>!r.rides);

  let html = '';
  if (zeroes.length && isDriver) {
    html += zeroes.map(([,r])=>
      `<div class="alert-strip">⚠️ ${r.name} — 0 rides, collect payment</div>`
    ).join('');
  }

  html += entries.map(([id,r])=>{
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
  if (firebaseReady && db) {
    set(ref(db, `riders/${id}`), updated);
  } else {
    S.riders[id] = updated;
    renderRiders(); renderWallet();
  }
  closeModal();
  toast(`✓ Added ${rides} rides for ${r.name}`);
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
  // Populate stop dropdown
  const sel = $('s-stop');
  sel.innerHTML = CONFIG.STOPS.map(s=>`<option value="${s.name}" ${S.user?.stop===s.name?'selected':''}>${s.name}</option>`).join('');
  openModal('modal-settings');
};
window.saveSettings = function() {
  const name = $('s-name').value.trim();
  const stop = $('s-stop').value;
  if (!name||!stop) { toast('Fill all fields'); return; }
  S.user = {...S.user, name, stop};
  localStorage.setItem('nc_user', JSON.stringify(S.user));
  $('avatar-btn').textContent = initials(name);
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
  $('driver-pin-row').classList.toggle('hidden', r==='rider');
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
  const name = $('setup-name').value.trim();
  const stop = $('setup-stop').value;
  const code = $('setup-code').value.trim().toLowerCase();
  if (!name) { toast('Enter your name'); return; }
  if (!stop) { toast('Select your stop'); return; }
  if (code !== CONFIG.JOIN_CODE) { toast('Wrong join code — ask your driver'); return; }
  if (!_role) { toast('Select your role'); return; }

  if (_role.startsWith('driver')) {
    const pin = $('driver-pin').value;
    const expected = CONFIG.DRIVER_PINS[_role];
    if (pin !== expected) { toast('Wrong driver PIN'); return; }
  }

  const id = _role === 'rider'
    ? `r_${name.replace(/\s/g,'').toLowerCase()}_${Date.now().toString(36)}`
    : `${_role}_main`;

  const user = { name, stop, role: _role, id };
  localStorage.setItem('nc_user', JSON.stringify(user));

  // Register rider in Firebase
  if (_role === 'rider' && firebaseReady && db) {
    const existing = S.riders[id];
    if (!existing) {
      set(ref(db, `riders/${id}`), { name, stop, rides:0, maxRides:5, payments:[] });
    }
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
