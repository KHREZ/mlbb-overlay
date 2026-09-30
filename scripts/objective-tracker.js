const DEFAULT_CONFIG = {
  enabled: true,
  warningSec: 30,
  series: { games: 1, wonBy: null, currentGame: 1 },
  turtle: { firstSpawn: 120, respawn: 120, phaseEnd: 480, nextSpawn: 120, state: 'waiting', warned: false, slainBy: null },
  lord: { firstSpawn: 480, respawn: 180, nextSpawn: 480, state: 'waiting', warned: false, slainBy: null },
  lastEvent: null,
};

const BANNER_MS = { warn: 6000, spawn: 7000, slain: 9000 };

class ObjectiveTracker {
  constructor({ readData, writeData, broadcast }) {
    this.readData = readData;
    this.writeData = writeData;
    this.broadcast = broadcast;
    this.timer = null;
  }

  config() {
    const d = this.readData();
    if (!d || !d.objectives) return null;
    return d.objectives;
  }

  start() {
    if (this.timer) return;
    console.log('[OBJ] Objective tracker started');
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    console.log('[OBJ] Objective tracker stopped');
  }

  emit(d, event) {
    d.objectives.lastEvent = event;
  }

  tick() {
    const d = this.readData();
    if (!d || !d.objectives || !d.objectives.enabled) return;
    const lm = d.liveMatch || {};
    if (!lm.timerRunning || typeof lm.timerSeconds !== 'number') return;

    const t = lm.timerSeconds;
    const objs = d.objectives;
    let changed = false;

    // New-game detection (clock far below every scheduled spawn)
    for (const key of ['turtle', 'lord']) {
      const o = objs[key];
      if (o.state === 'waiting' && t < o.nextSpawn - 120) {
        o.warned = false;
        changed = true;
      }
    }

    // Series game tracking: if timer is near 0 and a new game should start
    if (t <= 0 && objs.series && objs.series.currentGame && objs.series.currentGame <= objs.series.games) {
      // Reset objectives for new game, preserving config but clearing state
      for (const key of ['turtle', 'lord']) {
        const o = objs[key];
        if (o.state !== 'waiting') {
          o.state = 'waiting';
          o.warned = false;
          o.slainBy = null;
          o.nextSpawn = Math.max(o.firstSpawn, 120);
          o.slainAt = null;
          changed = true;
        }
      }
    }

    for (const key of ['turtle', 'lord']) {
      const o = objs[key];
      // Transition slain back to waiting once clock advances past kill time
      if (o.state === 'slain' && o.slainAt !== undefined && t >= o.slainAt + 5) {
        o.state = 'waiting';
        o.warned = false;
        changed = true;
      }
      if (o.state !== 'waiting') continue;

      if (!o.warned && t < o.nextSpawn && o.nextSpawn - t <= objs.warningSec) {
        o.warned = true;
        changed = true;
        this.emit(d, { objective: key, kind: 'warn', team: null, at: t });
        continue;
      }
      if (t >= o.nextSpawn) {
        o.state = 'spawned';
        o.warned = true;
        changed = true;
        this.emit(d, { objective: key, kind: 'spawn', team: null, at: t });
      }
    }

    // Banner expiry: clear lastEvent after its window so reloads don't replay
    const le = objs.lastEvent;
    if (le && BANNER_MS[le.kind] && t - le.at > BANNER_MS[le.kind] / 1000) {
      objs.lastEvent = null;
      changed = true;
    }

    // Persist and broadcast changes
    if (changed) {
      this.writeData(d);
      this.broadcast(d);
    }
  }

  action(type, team) {
    const d = this.readData();
    if (!d || !d.objectives) return { success: false, error: 'objectives not configured' };
    const o = d.objectives[type];
    if (!o) return { success: false, error: 'unknown objective: ' + type };
    if (o.state === 'done') return { success: false, error: type + ' phase is over' };

    const t = (d.liveMatch && d.liveMatch.timerSeconds) || 0;
    o.state = 'slain';
    o.slainAt = t;
    o.slainBy = team;
    o.warned = false;

    if (type === 'turtle') {
      const next = t + o.respawn;
      if (next > o.phaseEnd) {
        o.state = 'done';
        // Last turtle — Lord comes 2 min after this kill (or its first spawn, whichever later)
        const lord = d.objectives.lord;
        if (lord && lord.state === 'waiting') {
          lord.nextSpawn = Math.max(lord.firstSpawn, t + 120);
          lord.warned = false;
        }
      } else {
        o.nextSpawn = next;
      }
    } else {
      o.nextSpawn = t + o.respawn;
    }

    // Series scoring and game advancement
    const series = d.objectives.series || { games: 1, wonBy: null, currentGame: 1 };
    const maxGames = series.games || 1;
    const winThreshold = Math.ceil(maxGames / 2); // first to win this many games

    // Check if current game just ended (score-based determination)
    // A game effectively ends when we track it - here we just record the slain event
    // and let the UI/admin determine game completion

    this.emit(d, { objective: type, kind: 'slain', team, at: t });
    return { success: true };
  }

  reset() {
    const d = this.readData();
    if (!d) return { success: false };
    const cur = d.objectives || {};
    d.objectives = {
      ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
      enabled: cur.enabled !== undefined ? cur.enabled : DEFAULT_CONFIG.enabled,
      warningSec: cur.warningSec !== undefined ? cur.warningSec : DEFAULT_CONFIG.warningSec,
      series: cur.series || JSON.parse(JSON.stringify(DEFAULT_CONFIG.series)),
      turtle: {
        ...JSON.parse(JSON.stringify(DEFAULT_CONFIG.turtle)),
        firstSpawn: (cur.turtle && cur.turtle.firstSpawn) || DEFAULT_CONFIG.turtle.firstSpawn,
        respawn: (cur.turtle && cur.turtle.respawn) || DEFAULT_CONFIG.turtle.respawn,
        phaseEnd: (cur.turtle && cur.turtle.phaseEnd) || DEFAULT_CONFIG.turtle.phaseEnd,
      },
      lord: {
        ...JSON.parse(JSON.stringify(DEFAULT_CONFIG.lord)),
        firstSpawn: (cur.lord && cur.lord.firstSpawn) || DEFAULT_CONFIG.lord.firstSpawn,
        respawn: (cur.lord && cur.lord.respawn) || DEFAULT_CONFIG.lord.respawn,
      },
      lastEvent: null,
    };
    this.writeData(d);
    this.broadcast(d);
    return { success: true };
  }

  applyConfig(cfg) {
    const d = this.readData();
    if (!d) return { success: false };
    const cur = d.objectives || JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    if (typeof cfg.warningSec === 'number') cur.warningSec = Math.max(0, Math.min(120, cfg.warningSec));
    if (typeof cfg.enabled === 'boolean') cur.enabled = cfg.enabled;
    for (const key of ['turtle', 'lord']) {
      if (!cfg[key]) continue;
      const o = cur[key];
      if (typeof cfg[key].firstSpawn === 'number') o.firstSpawn = cfg[key].firstSpawn;
      if (typeof cfg[key].respawn === 'number') o.respawn = cfg[key].respawn;
      if (typeof cfg[key].phaseEnd === 'number' && key === 'turtle') o.phaseEnd = cfg[key].phaseEnd;
      if (o.state === 'waiting') o.nextSpawn = Math.max(o.nextSpawn, o.firstSpawn);
    }
    d.objectives = cur;
    this.writeData(d);
    return { success: true };
  }
}

module.exports = { ObjectiveTracker, DEFAULT_CONFIG };