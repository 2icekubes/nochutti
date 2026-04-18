# 🚌 NoChutti — Setup Guide

**No holiday from the commute.**

---

## Go live in 15 minutes

### 1. Customise your app (2 min)

Open `js/config.js` and edit:

```js
JOIN_CODE: "nochutti2025",     // ← change to your own code
DRIVER_PINS: {
  driver1: "1234",             // ← Bus 1 driver PIN
  driver2: "5678",             // ← Bus 2 driver PIN
},
STOPS: [ ... ]                 // ← add your actual stops + GPS coords
```

To find GPS coords for your stops: open Google Maps, long-press a location → coordinates appear at the top.

---

### 2. Firebase setup (5 min — free)

1. Go to **[firebase.google.com](https://firebase.google.com)** → Add project → "NoChutti"
2. Left menu → **Build → Realtime Database → Create database**
   - Region: `asia-southeast1` (Singapore, closest to Kolkata)
   - Start in **test mode** → Enable
3. **Project Settings (gear icon) → Your apps → Add web app**
   - Name it "NoChutti" → Register
   - Copy the `firebaseConfig` values
4. Open `js/firebase-config.js` → paste your values replacing `YOUR_*`

---

### 3. Deploy to GitHub Pages (5 min — free)

1. Sign up at **[github.com](https://github.com)**
2. New repository → name: `nochutti` → Public → Create
3. Upload all files in this folder
4. **Settings → Pages → Source → Deploy from branch → main / (root)**
5. Your app is live at: `https://YOUR_USERNAME.github.io/nochutti`

Share this URL on your office WhatsApp group.

---

### 4. Install on phones

**Android (Chrome):**
- Open URL → tap ⋮ menu → "Add to Home screen" → Install

**iPhone (Safari only):**
- Open URL in Safari → tap Share button → "Add to Home Screen"

---

## How it works

### Riders
1. Open app → enter name, stop, join code → select "Rider"
2. **Track tab** — see both buses live on the map, ETA to your stop
3. Tap **"Check in for Bus 1/2 today"** → driver sees your name under that bus
4. **Wallet tab** — see your ride balance and top-up pack prices
5. Pay driver via GPay/UPI → driver marks payment received

### Driver (Bus 1)
1. Open app → enter name, stop, join code → select "Driver A" → enter PIN `1234`
2. **Track tab** → tap "Start broadcasting location" → your GPS streams live to all riders
3. Tap "Share on WhatsApp" → sends a message to group
4. **Riders tab** → see who's checked in on each bus, who's at 0 rides (highlighted in red)
5. **Payments tab** → tap any rider → select pack → "Confirm received"

### Driver (Bus 2)
Same as above but select "Driver B" and use PIN `5678`.

---

## Costs

| What | Provider | Cost |
|------|----------|------|
| Hosting | GitHub Pages | ₹0 |
| Live GPS sync | Firebase (free tier: 1GB, 100 connections) | ₹0 |
| Maps | OpenStreetMap / Leaflet | ₹0 |
| Payments | Riders pay on GPay directly | ₹0 |
| **Total** | | **₹0 / month** |

Firebase free tier: 10 GB/month transfer, 1 GB storage — more than enough for 20 riders sharing GPS pings.

---

## File structure

```
nochutti/
├── index.html          ← whole app (single page)
├── manifest.json       ← PWA install config
├── sw.js               ← offline service worker
├── css/
│   └── app.css         ← all styles
└── js/
    ├── config.js       ← ✏️  edit this — stops, codes, PINs, pricing
    ├── firebase-config.js  ← ✏️  paste Firebase credentials here
    └── app.js          ← app logic (no need to edit)
```
