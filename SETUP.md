# MLBB Tournament Broadcast System — Setup Guide

A professional Mobile Legends: Bang Bang tournament overlay for OBS Studio,
with live score control, hero Pick & Ban screen, casters lower-thirds, MVP
reveal, and one-click OBS scene switching.

---

## 1. Requirements

- **Node.js 18+** (tested on v24)
- **OBS Studio** (this build tested against Flatpak `com.obsproject.Studio`)
- **scrcpy** (to mirror your phone into OBS)
- **Phone** connected via USB (with ADB debugging enabled)

---

## 2. Start the server

```bash
cd ~/Desktop/my-mlbb-overlay
npm install        # first time only
./start-broadcast.sh
```

This starts the overlay server **and** launches `scrcpy` (borderless, 60 fps).

> Alternatively run just `npm start` (server only).

- Server: **http://localhost:3000**
- Admin dashboard: **http://localhost:3000/admin.html**

---

## 3. Import the OBS scene collection (IMPORTANT)

1. Close OBS if it's open.
2. In OBS: **Scene Collection → Import** → select
   `obs-config/mlbb-tournament.json`.
3. Select the imported **"MLBB Tournament"** scene collection.

The collection includes these scenes (all 1920×1080):

| Scene            | Contents                                                    |
| ---------------- | ----------------------------------------------------------- |
| `INTRO / BREAK`  | Tournament title card                                        |
| `DRAFT`          | Pick & Ban overlay + phone capture (center)                 |
| `LIVE MATCH`     | Phone capture + in-game scoreboard + status                 |
| `CASTERS`        | Webcam frame + caster lower-thirds                          |
| `MVP`            | Post-match MVP reveal card                                  |
| `BRB`            | Be Right Back screen                                        |

> The base canvas of your OBS profile has been set to **1920×1080 @ 60fps**
> automatically. If it doesn't take, set it manually in **Settings → Video**:
> Base + Output resolution `1920×1080`, FPS `60`.

### Configure your phone capture (once)

> **Wayland note:** your OBS runs on Wayland, where the old `xcomposite_capture`
> source doesn't exist. The scene now uses **PipeWire Window Capture**
> (`pipewire-window-capture-source`). The first time you open the source's
> Properties, OBS shows a **window picker** — accept any "share screen" prompt.

1. In the **DRAFT** and **LIVE MATCH** scenes, right-click the **"scrcpy - Phone"**
   source → **Properties** → pick the `scrcpy` window in the PipeWire window
   picker. Shift-drag inside the preview to crop/scale the phone to fill the middle.
2. If the scrcpy window doesn't appear in the picker (XWayland quirk), fall back
   to a **Screen Capture (PipeWire)** source on your monitor and crop to the phone.
3. In **CASTERS**, set the **Webcam** source to your device (Properties → Device;
   it's the V4L2 source, your `/dev/video0` ACER HD cam).

---

## 4. Enable OBS scene control (optional but recommended)

1. In OBS: **Tools → WebSocket Server Settings**.
2. Tick **Enable WebSocket server** and remember the password shown.
3. This matches the config file at
   `obs-config/../config/obs-studio/plugin_config/obs-websocket/config.json`
   (password: `7LkjA9qvWjxpi9fK`, port 4455) which I pre-enabled for you.

Then open **http://localhost:3000/admin.html** and use the **Scene** tab to
switch OBS scenes, or keep the dashboard as an OBS dock:

- **Docks → Custom Browser Docks…** → name it `MLBB Admin` →
  URL `http://localhost:3000/admin.html`.

---

## 5. Admin dashboard — what each tab does

| Tab       | Features                                                        |
| --------- | ---------------------------------------------------------------- |
| **Scene** | One-click switch between all 6 OBS scenes (+ refresh overlays)   |
| **Score** | Tournament name, stage, format (BO1–BO7), game #, team names, logos, live scores, swap sides |
| **Draft** | Draft-phase banner text, countdown timer, **ban count selector (1–5, per game)**, 5 picks (hero, player IGN, role, **battle spell, emblem**) per team |
| **Live Match** | **Auto-scoring (OCR) toggle + calibration**, match clock, team kills/gold/turrets, **objective events (Turtle/Lord killed buttons + tracker toggle + reset)**, **End Game** (auto series score) |
| **Casters** | 2 casters + 1 analyst lower-third (names + handles), ticker text, show/hide |
| **MVP**   | Player name, team, hero, K/D/A, gold, damage + show/hide         |

Every save broadcasts instantly over WebSocket to all open overlays — no
refreshing needed.

**Live Match hotkeys** (while the admin dashboard has focus):
`A` = blue kill, `S` = red kill, `Q` = blue turret, `W` = red turret,
`G` = end game (asks who won → auto-increments series score + game #).

---

## 5b. Auto-scoring (OCR) — setup

The system reads the **match timer and both teams' kill counters** straight
from your scrcpy phone feed, once per second, with zero typing:

```
OBS ("scrcpy - Phone" source)
   → GetSourceScreenshot (every 1s)
   → crop 3 regions (timer / blue kills / red kills)
   → tesseract OCR → sanity check → broadcasts to overlay
```

1. Start the broadcast (`./start-broadcast.sh`) — OBS + scrcpy must be running,
   and the phone must show an **in-game** HUD (lobby screens have no counters).
2. Open **Admin → Live Match** tab.
3. **Refresh Frame** — you should see the phone frame.
4. **Drag the 3 dashed boxes** so they sit exactly on:
   - the in-game **timer** (yellow box),
   - the **blue team kill counter** (blue box),
   - the **red team kill counter** (red box).
   Boxes auto-save on release.
5. **Test OCR Now** — verify it reads sensible numbers.
6. **Start Auto** — timer and kills now update automatically. Gold/turrets
   are not visible in the MLBB HUD, so those stay manual (buttons/hotkeys).

Notes:
- Requires `tesseract` + English data (`tesseract-data-eng`); both installed.
- If OCR misreads, nudge the boxes with the calibration canvas and re-test.
- While AUTO is on, it overwrites manual kill/timer edits on each pass.
- Region defaults assume a **landscape** phone feed. Portrait feeds need
  re-calibration (Reset Regions → drag boxes to the top corners).

---

## 5c. Objective banners (Turtle / Lord)

The overlay shows **INCOMING / SPAWNING** banners and **countdown chips**
(bottom-right) for Turtle and Lord, driven by the match clock:

- **Warn** ("TURTLE INCOMING") 30s before spawn → **Spawn** ("TURTLE SPAWNING")
  at the scheduled time (turtle first at 2:00, respawn 2:00 until 8:00;
  lord first at 8:00, respawn 3:00).
- When a turtle/lord is killed, click the matching button in
  **Admin → Live Match → Objective Events** ("Turtle Down — Blue/Red") — the
  overlay shows "TURTLE SLAIN BY BLUE" and the chip resets to the respawn
  countdown. When the last turtle (after 8:00) falls, the Lord timer advances
  to 2 minutes from that kill.
- **Reset Objective Cycle** restores the default first-spawn schedule (do this
  at the start of each game).

---

## 6. Adding team logos

In the **Score** tab enter a `logo` URL for each team. You can use:

- an online URL (e.g. from the team's site), or
- a local file placed in the project, e.g. `images/teamA.png` → type
  `/images/teamA.png`.

If left blank, a colored circle with the team initial is shown instead.

---

## 7. Hero portraits

The build ships with official MLBB hero portraits already downloaded into
`images/heroes/`, referenced from `heroes.json` and used by the **Draft**
pick & ban and **MVP** screens. To re-fetch or expand the list:

```bash
node scripts/download-heroes.js    # heroes (Fandom/gist mirrors)
```

> `items.json` + `scripts/download-items.js` remain available but are not
> used by the current HUD (per-player item rows were removed).

---

## 8. File map

```
my-mlbb-overlay/
├── server.js               # Express + WebSocket + OBS WebSocket bridge
├── data.json               # live match state (edit via admin, rarely by hand)
├── heroes.json             # hero list with local icon paths
├── items.json              # item list (kept, not used by current HUD)
├── images/heroes/*.png     # hero portraits
├── images/objectives/*.png # turtle / lord icons
├── overlay.html            # in-game HUD (clock/kills/gold/turrets + objective banners & chips)
├── draft.html              # MPL S4/5 pick & ban overlay
├── casters.html            # lower-third + ticker
├── mvp.html                # MVP reveal
├── intro.html / brb.html   # standby screens
├── admin.html              # control dashboard (incl. Live Match + auto-scoring + objectives)
├── obs-config/mlbb-tournament.json   # importable OBS scene collection
├── scripts/download-heroes.js        # hero icon fetcher
├── scripts/download-items.js         # item icon fetcher (unused by HUD)
├── scripts/objective-tracker.js      # Turtle/Lord schedule engine
├── scripts/ocr-poller.js             # auto-scoring OCR engine
└── start-broadcast.sh       # launcher (server + scrcpy)
```

---

## 9. Troubleshooting

**Scoreboard not updating?**
→ Check the server is running and `http://localhost:3000/api/data` responds.

**Scene switch says "OBS not connected"**
→ Enable the obs-websocket plugin (see §4) and restart OBS.

**Overlay not fitting the screen in OBS**
→ Make sure the **Browser source** is 1920×1080 and the canvas is 1920×1080.

**Hero portraits missing in Draft/MVP**
→ Re-run `node scripts/download-heroes.js`, then in OBS right click the
browser source → Refresh, or use the Admin **Scene** tab → Refresh All.

**scrcpy not launching**
→ Make sure ADB recognizes your phone (`adb devices`) and `scrcpy` is installed.