const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const TESS_BIN = '/usr/bin/tesseract';
const TMP_DIR = path.join(os.tmpdir(), 'mlbb-ocr');

const ORIENTATIONS = {
  landscape: { timer: { x: 0.47, y: 0.052, w: 0.075, h: 0.035 }, blueKills: { x: 0.29, y: 0.052, w: 0.05, h: 0.035 }, redKills: { x: 0.66, y: 0.052, w: 0.05, h: 0.035 } },
  portrait: { timer: { x: 0.055, y: 0.47, w: 0.035, h: 0.075 }, blueKills: { x: 0.052, y: 0.29, w: 0.035, h: 0.05 }, redKills: { x: 0.066, y: 0.66, w: 0.035, h: 0.05 } },
};

const DEFAULT_CALIBRATION = {
  orientation: 'landscape',
  regions: {
    timer: { x: 0.47, y: 0.052, w: 0.075, h: 0.035 },
    blueKills: { x: 0.29, y: 0.052, w: 0.05, h: 0.035 },
    redKills: { x: 0.66, y: 0.052, w: 0.05, h: 0.035 },
    blueGold: { x: 0.15, y: 0.052, w: 0.05, h: 0.035 },
    redGold: { x: 0.71, y: 0.052, w: 0.05, h: 0.035 },
    blueTurrets: { x: 0.22, y: 0.12, w: 0.03, h: 0.025 },
    redTurrets: { x: 0.74, y: 0.12, w: 0.03, h: 0.025 },
  },
};

function runTesseract(imagePath, whitelist) {
  return new Promise((resolve) => {
    const args = [imagePath, 'stdout', '--psm', '7'];
    if (whitelist) args.push('-c', `tessedit_char_whitelist=${whitelist}`);
    const proc = spawn(TESS_BIN, args);
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 8000);
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, text: out.replace(/\s+/g, ' ').trim(), err });
    });
    proc.on('error', () => { clearTimeout(timer); resolve({ code: 1, text: '', err: 'tesseract missing' }); });
  });
}

function parseTimer(raw) {
  const m = String(raw).match(/(\d{1,2})[^\d]{0,3}(\d{1,2})/);
  if (!m) return null;
  const mins = Math.min(parseInt(m[1], 10), 99);
  const secs = Math.min(parseInt(m[2], 10), 59);
  return mins * 60 + secs;
}

function parseKills(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  const v = parseInt(digits, 10);
  return v <= 99 ? v : null;
}

function parseGold(raw) {
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return null;
  const v = parseInt(digits, 10);
  if (v <= 999999) return v;
  return null;
}

function parseTurrets(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  const v = parseInt(digits, 10);
  return v <= 5 ? v : null;
}

class OCRPoller {
  constructor({ getObs, readData, writeData, broadcast }) {
    this.getObs = getObs;
    this.readData = readData;
    this.writeData = writeData;
    this.broadcast = broadcast;
    this.timer = null;
    this.running = false;
    this.lastRead = { timer: null, blueKills: null, redKills: null, raw: {}, at: null };
    this.errors = 0;
    this.calibration = JSON.parse(JSON.stringify(DEFAULT_CALIBRATION));
    this.orientation = 'landscape';
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  config() {
    const d = this.readData();
    if (!d || !d.autoScore) return { orientation: 'landscape', regions: {} };
    const cfg = d.autoScore;
    this.orientation = cfg.orientation || 'landscape';
    this.calibration = { ...DEFAULT_CALIBRATION, ...cfg };
    if (cfg.orientation) this.orientation = cfg.orientation;
    const regions = {};
    ['timer', 'blueKills', 'redKills', 'blueGold', 'redGold', 'blueTurrets', 'redTurrets'].forEach(k => {
      if (cfg.regions && cfg.regions[k]) regions[k] = cfg.regions[k];
    });
    return { orientation: this.orientation, regions };
  }

  async capture() {
    const cfg = this.config();
    const obs = await this.getObs();
    if (!obs) throw new Error('OBS not connected');
    const res = await obs.call('GetSourceScreenshot', {
      sourceName: cfg.sourceName || 'scrcpy - Phone',
      imageFormat: 'png',
    });
    const b64 = (res.imageData || '').replace(/^data:image\/\w+;base64,/, '');
    return {
      width: res.imageWidth,
      height: res.imageHeight,
      buffer: Buffer.from(b64, 'base64'),
    };
  }

  slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  async ocrRegion(buffer, width, height, region, whitelist) {
    const orientation = this.orientation;
    const baseRegion = ORIENTATIONS[orientation] && ORIENTATIONS[orientation][region] || region;
    const left = Math.round(baseRegion.x * width);
    const top = Math.round(baseRegion.y * height);
    const w = Math.max(2, Math.round(baseRegion.w * width));
    const h = Math.max(2, Math.round(baseRegion.h * height));
    const file = path.join(TMP_DIR, `region_${width}x${height}_${left}_${top}.png`);
    await sharp(buffer)
      .extract({ left: Math.min(left, width - 2), top: Math.min(top, height - 2), width: Math.min(w, width - left), height: Math.min(h, height - top) })
      .grayscale()
      .normalise()
      .sharpen({ sigma: 1.5 })
      .threshold(140)
      .resize({ width: Math.max(200, w * 4), height: Math.max(100, h * 4), fit: 'fill' })
      .png()
      .toFile(file);
    return runTesseract(file, whitelist);
  }

  async singlePass() {
    const cfg = this.config();
    const regions = cfg.regions || {};
    const frame = await this.capture();
    const reads = {};
    for (const key of ['timer', 'blueKills', 'redKills', 'blueGold', 'redGold', 'blueTurrets', 'redTurrets']) {
      const region = regions[key];
      if (!region) continue;
      const whitelist = key === 'timer' ? '0123456789:' : key.includes('Gold') ? '0123456789' : '';
      const res = await this.ocrRegion(frame.buffer, frame.width, frame.height, region, whitelist);
      reads[key] = { raw: res.text, code: res.code };
    }

    const parsed = {
      timer: parseTimer(reads.timer && reads.timer.raw),
      blueKills: parseKills(reads.blueKills && reads.blueKills.raw),
      redKills: parseKills(reads.redKills && reads.redKills.raw),
      blueGold: parseGold(reads.blueGold && reads.blueGold.raw),
      redGold: parseGold(reads.redGold && reads.redGold.raw),
      blueTurrets: parseTurrets(reads.blueTurrets && reads.blueTurrets.raw),
      redTurrets: parseTurrets(reads.redTurrets && reads.redTurrets.raw),
    };

    this.lastRead = { ...this.lastRead, parsed, raw: { timer: reads.timer && reads.timer.raw, blueKills: reads.blueKills && reads.blueKills.raw, redKills: reads.redKills && reads.redKills.raw, blueGold: reads.blueGold && reads.blueGold.raw, redGold: reads.redGold && reads.redGold.raw, blueTurrets: reads.blueTurrets && reads.blueTurrets.raw, redTurrets: reads.redTurrets && reads.redTurrets.raw }, at: Date.now() };
    // Cleanup temp files after each pass
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (_) {}
    fs.mkdirSync(TMP_DIR, { recursive: true });
    return { parsed, raw: this.lastRead.raw, frame: { width: frame.width, height: frame.height } };
  }

  applyToData(parsed) {
    const data = this.readData();
    if (!data) return;
    const lm = (data.liveMatch = data.liveMatch || {});
    const blue = (lm.blue = lm.blue || {});
    const red = (lm.red = lm.red || {});
    let changed = false;

    if (parsed.timer !== null && parsed.timer !== lm.timerSeconds) {
      lm.timerSeconds = parsed.timer;
      lm.timerRunning = true;
      changed = true;
    }
    if (parsed.blueKills !== null && parsed.blueKills !== blue.kills) {
      if (parsed.blueKills > (blue.kills || 0)) {
        blue.kills = parsed.blueKills;
        changed = true;
      }
    }
    if (parsed.redKills !== null && parsed.redKills !== red.kills) {
      if (parsed.redKills > (red.kills || 0)) {
        red.kills = parsed.redKills;
        changed = true;
      }
    }
    if (parsed.blueGold !== null && parsed.blueGold !== parseInt(blue.gold, 10)) {
      blue.gold = String(parsed.blueGold);
      changed = true;
    }
    if (parsed.redGold !== null && parsed.redGold !== parseInt(red.gold, 10)) {
      red.gold = String(parsed.redGold);
      changed = true;
    }
    if (parsed.blueTurrets !== null && parsed.blueTurrets !== (blue.turrets || 0)) {
      blue.turrets = parsed.blueTurrets;
      changed = true;
    }
    if (parsed.redTurrets !== null && parsed.redTurrets !== (red.turrets || 0)) {
      red.turrets = parsed.redTurrets;
      changed = true;
    }

    if (changed || lm.autoActive !== true) {
      lm.autoActive = true;
      this.writeData(data);
      this.broadcast(data);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const cfg = this.config();
    const interval = Math.max(300, cfg.refreshMs || 1000);
    console.log('[OCR] Auto-scoring poller started (every ' + interval + 'ms, source: ' + (cfg.sourceName || 'scrcpy - Phone') + ', orientation: ' + cfg.orientation + ')');
    this.timer = setInterval(async () => {
      try {
        const { parsed } = await this.singlePass();
        this.applyToData(parsed);
        this.errors = 0;
      } catch (e) {
        this.errors++;
        const data = this.readData();
        if (data && data.liveMatch) {
          data.liveMatch.autoActive = this.running;
          this.writeData(data);
        }
        if (this.errors === 1 || this.errors % 20 === 0) {
          console.log('[OCR] pass failed:', e.message || e);
        }
      }
    }, interval);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    const data = this.readData();
    if (data && data.liveMatch) {
      data.liveMatch.autoActive = false;
      this.writeData(data);
      this.broadcast(data);
    }
    console.log('[OCR] Auto-scoring poller stopped');
  }

  status() {
    return {
      running: this.running,
      errors: this.errors,
      lastRead: this.lastRead,
      config: this.config(),
    };
  }
}

module.exports = { OCRPoller };