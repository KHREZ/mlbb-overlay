const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const HEROES_FILE = path.join(__dirname, 'heroes.json');
const ITEMS_FILE = path.join(__dirname, 'items.json');

// ---------- OBS WebSocket integration ----------
let obs = null;
let obsWsRunning = false;

function obsConfigPath() {
  const candidates = [
    process.env.OBS_WS_CONFIG,
    path.join(os.homedir(), '.var', 'app', 'com.obsproject.Studio', 'config', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json'),
    path.join(os.homedir(), '.config', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

const OBS_CONF_FILE = obsConfigPath();
const obsConf = OBS_CONF_FILE ? (() => {
  try { return JSON.parse(fs.readFileSync(OBS_CONF_FILE, 'utf8')); }
  catch (_) { return {}; }
})() : {};

async function getObs() {
  if (obs) return obs;
  if (!obsConf.server_enabled) return null;
  const OBSWebSocket = (await import('obs-websocket-js')).default;
  obs = new OBSWebSocket();
  try {
    await obs.connect(`ws://127.0.0.1:${obsConf.server_port || 4455}`, obsConf.server_password || '');
    obsWsRunning = true;
    console.log('[OBS] Connected to OBS WebSocket on port', obsConf.server_port || 4455);
    obs.on('ConnectionClosed', () => {
      obsWsRunning = false;
      obs = null;
      console.log('[OBS] Connection closed (will reconnect on next action)');
    });
    return obs;
  } catch (e) {
    obs = null;
    obsWsRunning = false;
    console.log('[OBS] Connection failed:', e.code ? e.code : e.message);
    return null;
  }
}

async function selectScene(name) {
  const client = await getObs();
  if (!client) return { success: false, error: 'OBS not connected' };
  try {
    await client.call('SetCurrentProgramScene', { sceneName: name });
    return { success: true, scene: name };
  } catch (e) {
    return { success: false, error: (e && (e.message || e.error)) || String(e) };
  }
}

// ---------- Auto-scoring (OCR) integration ----------
const { OCRPoller } = require('./scripts/ocr-poller');
const ocr = new OCRPoller({ getObs, readData, writeData, broadcast });

// ---------- Objective tracker (Turtle / Lord) ----------
const { ObjectiveTracker } = require('./scripts/objective-tracker');
const objectives = new ObjectiveTracker({ readData, writeData, broadcast });

function listItems() {
  try { return JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8')); }
  catch (e) { return []; }
}

// ---------- Helpers ----------
app.use(express.json({ limit: '30mb' }));
app.use(express.static(__dirname));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    connectedClients: wss.clients.size,
    obsConnected: obsWsRunning,
    ocrRunning: ocr.running,
    objectivesEnabled: !!(readData().objectives && readData().objectives.enabled),
  });
});

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { console.error('read data:', e.message); return {}; }
}

function writeData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.error('write data:', e.message); }
}

function listHeroes() {
  try { return JSON.parse(fs.readFileSync(HEROES_FILE, 'utf8')); }
  catch (e) { return []; }
}

function broadcast(data) {
  const payload = JSON.stringify({ type: 'UPDATE', data });
  wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
}

// ---------- Routes ----------
app.get('/api/data', (req, res) => res.json(readData()));
app.get('/api/heroes', (req, res) => res.json(listHeroes()));

app.post('/api/update', (req, res) => {
  const current = readData();
  const allowedFields = [
    'tournamentName', 'matchStage', 'matchFormat', 'currentGame',
    'statusText', 'teamA', 'teamB', 'draftState', 'liveMatch',
    'casters', 'mvp', 'overlayConfig', 'banCount',
  ];
  const sanitized = {};
  for (const key of allowedFields) {
    if (req.body.hasOwnProperty(key)) sanitized[key] = req.body[key];
  }
  const updated = { ...current, ...sanitized };
  writeData(updated);
  broadcast(updated);
  res.json({ success: true, data: updated });
});

app.post('/api/swap-sides', (req, res) => {
  const current = readData();
  const a = { ...current.teamA };
  current.teamA = { ...current.teamB, side: 'blue', color: '#2563eb' };
  current.teamB = { ...a, side: 'red', color: '#dc2626' };
  writeData(current);
  broadcast(current);
  res.json({ success: true, data: current });
});

app.get('/api/obs/status', async (req, res) => {
  res.json({
    configured: !!OBS_CONF_FILE,
    pluginEnabled: !!(obsConf && obsConf.server_enabled),
    port: obsConf.server_port || 4455,
    connected: obsWsRunning,
  });
});

app.post('/api/obs/scene', async (req, res) => {
  const { scene } = req.body || {};
  if (!scene) return res.status(400).json({ success: false, error: 'scene required' });
  res.json(await selectScene(scene));
});

app.post('/api/obs/refresh-sources', async (req, res) => {
  const client = await getObs();
  if (!client) return res.json({ success: false, error: 'OBS not connected' });
  try {
    await client.call('CallVendorRequest', {
      vendorName: 'obs-browser',
      requestType: 'call',
      requestData: { requestType: 'refreshAllBrowserSources' },
    });
    return res.json({ success: true });
  } catch (_) {
    // vendor call not available; force-refresh via scene cycle is handled client-side
    return res.json({ success: false });
  }
});

// ---------- Auto-scoring routes ----------
app.get('/api/items', (req, res) => res.json(listItems()));

app.get('/api/auto/status', (req, res) => res.json(ocr.status()));

app.post('/api/auto/start', (req, res) => {
  const data = readData();
  if (!data.autoScore) data.autoScore = {};
  data.autoScore.enabled = true;
  writeData(data);
  ocr.start();
  res.json({ success: true, status: ocr.status() });
});

app.post('/api/auto/stop', (req, res) => {
  const data = readData();
  if (data.autoScore) data.autoScore.enabled = false;
  writeData(data);
  ocr.stop();
  res.json({ success: true, status: ocr.status() });
});

app.post('/api/auto/config', (req, res) => {
  const data = readData();
  data.autoScore = { ...(data.autoScore || {}), ...(req.body || {}) };
  writeData(data);
  if (ocr.running) { ocr.stop(); ocr.start(); }
  res.json({ success: true, config: data.autoScore });
});

app.post('/api/auto/frame', async (req, res) => {
  try {
    const frame = await ocr.capture();
    res.json({ success: true, width: frame.width, height: frame.height, dataUrl: 'data:image/png;base64,' + frame.buffer.toString('base64') });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/auto/test', async (req, res) => {
  try {
    const result = await ocr.singlePass();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

// ---------- Objective routes (Turtle / Lord) ----------
app.post('/api/objectives/action', (req, res) => {
  const { type, team } = req.body || {};
  if (!type || !team) return res.status(400).json({ success: false, error: 'type and team required' });
  if (!['turtle', 'lord'].includes(type)) return res.status(400).json({ success: false, error: 'type must be turtle or lord' });
  if (!['blue', 'red'].includes(team)) return res.status(400).json({ success: false, error: 'team must be blue or red' });
  res.json(objectives.action(type, team));
});

app.post('/api/objectives/reset', (req, res) => {
  res.json(objectives.reset());
});

app.post('/api/objectives/config', (req, res) => {
  const j = objectives.applyConfig(req.body || {});
  res.json(j);
});

app.post('/api/objectives/toggle', (req, res) => {
  const d = readData();
  if (d && d.objectives) {
    d.objectives.enabled = req.body && req.body.enabled !== undefined
      ? req.body.enabled
      : !d.objectives.enabled;
    writeData(d);
    broadcast(d);
  }
  res.json({ success: true, enabled: !!(d && d.objectives && d.objectives.enabled) });
});

// ---------- Objective series & game routes ----------
app.post('/api/objectives/series', (req, res) => {
  const data = readData();
  if (!data.objectives) return res.status(400).json({ success: false, error: 'objectives not configured' });
  data.objectives.series = { ...(data.objectives.series || {}), ...(req.body || {}) };
  // Ensure current game stays within bounds
  const max = Math.max(1, data.objectives.series.games || 1);
  if (data.objectives.series.currentGame > max) data.objectives.series.currentGame = max;
  if (typeof data.objectives.series.wonBy !== 'string') data.objectives.series.wonBy = null;
  writeData(data);
  res.json({ success: true, series: data.objectives.series });
});

app.post('/api/objectives/game', (req, res) => {
  const data = readData();
  if (!data.objectives) return res.status(400).json({ success: false, error: 'objectives not configured' });
  let series = data.objectives.series || { games: 1, wonBy: null, currentGame: 1 };
  if (req.body && req.body.action === 'next') {
    const max = Math.max(1, series.games || 1);
    const winThreshold = Math.ceil(max / 2);
    // Check if series is already decided
    if (series.wonBy && series.wonBy === data.teamA?.name) {
      // Blue team won series, no more games
      return res.json({ success: false, error: 'Series already decided' });
    }
    if (series.wonBy && series.wonBy === data.teamB?.name) {
      // Red team won series, no more games
      return res.json({ success: false, error: 'Series already decided' });
    }
    series.currentGame = Math.min(max, (series.currentGame || 1) + 1);
    series.wonBy = null;
  } else if (req.body && req.body.action === 'reset') {
    series.currentGame = 1;
    series.wonBy = null;
  }
  data.objectives.series = series;
  writeData(data);
  res.json({ success: true, series: data.objectives.series, currentGame: series.currentGame });
});

app.post('/api/objectives/win', (req, res) => {
  const { winner } = req.body || {};
  if (!winner || !['A', 'B'].includes(winner)) return res.status(400).json({ success: false, error: 'winner must be A or B' });
  const data = readData();
  if (!data.objectives) return res.status(400).json({ success: false, error: 'objectives not configured' });
  const series = data.objectives.series || { games: 1, wonBy: null, currentGame: 1 };
  const max = Math.max(1, series.games || 1);
  const threshold = Math.ceil(max / 2);
  
  // Mark series winner
  series.wonBy = winner === 'A' ? data.teamA.name : data.teamB.name;
  series.currentGame = max; // series complete
  
  data.objectives.series = series;
  writeData(data);
  res.json({ success: true, series, seriesWon: true, winner: series.wonBy });
});

// ---------- Overlay configuration ----------
app.get('/api/overlay-config', (req, res) => {
  res.json( { overlayConfig: readData().overlayConfig || {} } );
});

app.post('/api/overlay-config', (req, res) => {
  const data = readData();
  data.overlayConfig = { ...(data.overlayConfig || {}), ...(req.body || {}) };
  writeData(data);
  res.json({ success: true, overlayConfig: data.overlayConfig });
});

// ---------- Match data management ----------
app.get('/api/match/history', (req, res) => {
  const data = readData();
  const history = data.matchHistory || [];
  res.json({ success: true, history });
});

app.post('/api/match/history', (req, res) => {
  const { entry } = req.body || {};
  if (!entry) return res.status(400).json({ success: false, error: 'entry required' });
  const data = readData();
  let history = data.matchHistory || [];
  history.push({ ...entry, timestamp: Date.now() });
  // Keep only last 50 entries to prevent unbounded growth
  if (history.length > 50) history = history.slice(-50);
  data.matchHistory = history;
  writeData(data);
  res.json({ success: true, history });
});

app.post('/api/match/reset-all', (req, res) => {
  const data = readData();
  if (!data) return res.status(400).json({ success: false, error: 'no data' });
  
  // Reset live match state
  data.liveMatch = {
    timerSeconds: 0,
    timerRunning: false,
    autoActive: false,
    blue: { kills: 0, gold: '0', turrets: 0 },
    red: { kills: 0, gold: '0', turrets: 0 }
  };
  
  // Reset objectives to default
  data.objectives = {
    enabled: true,
    warningSec: 30,
    series: { games: 1, wonBy: null, currentGame: 1 },
    turtle: { firstSpawn: 120, respawn: 120, phaseEnd: 480, nextSpawn: 120, state: 'waiting', warned: false, slainBy: null },
    lord: { firstSpawn: 480, respawn: 180, nextSpawn: 480, state: 'waiting', warned: false, slainBy: null },
    lastEvent: null
  };
  
  // Clear match history
  data.matchHistory = [];
  
  // Preserve tournament metadata
  const preserved = { tournamentName: data.tournamentName, matchStage: data.matchStage, matchFormat: data.matchFormat, currentGame: data.currentGame };
  Object.assign(data, preserved);
  
  writeData(data);
  broadcast(data);
  res.json({ success: true, data });
});

// ---------- Draft import/export ----------
app.post('/api/draft/export', (req, res) => {
  const data = readData();
  res.json({ success: true, draft: data });
});

app.post('/api/draft/import', (req, res) => {
  const { draft } = req.body || {};
  if (!draft) return res.status(400).json({ success: false, error: 'draft data required' });
  const data = readData();
  // Merge imported draft values, preserving other fields
  data.teamA = { ...data.teamA, ...(draft.teamA || {}) };
  data.teamB = { ...data.teamB, ...(draft.teamB || {}) };
  data.draftState = { ...data.draftState, ...(draft.draftState || {}) };
  // Merge bans and picks
  if (draft.teamA) {
    data.teamA.bans = draft.teamA.bans || [];
    data.teamA.picks = draft.teamA.picks || [];
  }
  if (draft.teamB) {
    data.teamB.bans = draft.teamB.bans || [];
    data.teamB.picks = draft.teamB.picks || [];
  }
  writeData(data);
  broadcast(data);
  res.json({ success: true, data });
});

// ---------- WebSocket ----------
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  console.log('Overlay client connected');
  ws.send(JSON.stringify({ type: 'INIT', data: readData() }));
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'UPDATE') {
        const current = readData();
        const updated = { ...current, ...parsed.data };
        writeData(updated);
        broadcast(updated);
      }
    } catch (_) {}
  });
  ws.on('close', () => console.log('Overlay client disconnected'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message || err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log('  MLBB Tournament Overlay System Server Running!');
  console.log('  URL base: http://localhost:' + PORT);
  console.log('  Scoreboard: /overlay.html   Draft: /draft.html');
  console.log('  Casters:    /casters.html   MVP:   /mvp.html');
  console.log('  Intro:      /intro.html     BRB:   /brb.html');
  console.log('  Ban Phase:  /banphase.html  Stats: /teamstats.html');
  console.log('  Analysis:   /draftanalysis.html  Timeline: /timeline.html');
  console.log('  Profiles:   /profiles.html');
  console.log('  Admin:      /admin.html');
  console.log('  Live Match: /admin.html (Live Match tab + auto-scoring)');
  if (obsConf.server_enabled) {
    console.log('  OBS WebSocket plugin detected (port ' + (obsConf.server_port || 4455) + ').');
  } else {
    console.log('  OBS WebSocket plugin NOT enabled - scene switching disabled.');
  }
  const startupData = readData();
  if (startupData.autoScore && startupData.autoScore.enabled) {
    ocr.start();
  }
  objectives.start();
  console.log('====================================================');
});

if (obsConf.server_enabled) {
  getObs();
}