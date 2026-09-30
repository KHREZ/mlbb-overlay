const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { ObjectiveTracker, DEFAULT_CONFIG } = require('./objective-tracker');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ok  ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL  ' + name + ' — ' + e.message);
  }
}

console.log('ObjectiveTracker engine tests');
console.log('-----------------------------');

// In-memory data store harness
function harness() {
  const data = {
    liveMatch: { timerSeconds: 0, timerRunning: true },
    objectives: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
  };
  const events = [];
  const tracker = new ObjectiveTracker({
    readData: () => data,
    writeData: (d) => { Object.assign(data, d); },
    broadcast: () => {},
  });
  return { data, tracker, events };
}

test('no warn/spawn before first turtle spawn', () => {
  const { data, tracker } = harness();
  data.liveMatch.timerSeconds = 85;
  tracker.tick();
  assert.strictEqual(data.objectives.turtle.state, 'waiting');
  assert.strictEqual(data.objectives.lastEvent, null);
});

test('warn fires 30s before turtle spawn (2:00 first spawn)', () => {
  const { data, tracker } = harness();
  data.liveMatch.timerSeconds = 90;
  tracker.tick();
  const ev = data.objectives.lastEvent;
  assert.ok(ev && ev.kind === 'warn' && ev.objective === 'turtle', 'expected turtle warn event');
});

test('spawn fires at the scheduled time', () => {
  const { data, tracker } = harness();
  data.liveMatch.timerSeconds = 120;
  tracker.tick();
  assert.strictEqual(data.objectives.turtle.state, 'spawned');
  assert.strictEqual(data.objectives.lastEvent.kind, 'spawn');
});

test('slain by blue resets turtle to respawn countdown', () => {
  const { data, tracker } = harness();
  data.liveMatch.timerSeconds = 150;
  tracker.tick();
  const r = tracker.action('turtle', 'blue');
  assert.strictEqual(r.success, true);
  assert.strictEqual(data.objectives.turtle.state, 'slain');
  assert.strictEqual(data.objectives.lastEvent.kind, 'slain');
  assert.strictEqual(data.objectives.lastEvent.team, 'blue');
  assert.strictEqual(data.objectives.turtle.nextSpawn, 270);
});

test('final turtle (after phaseEnd) triggers lord early spawn', () => {
  const { data, tracker } = harness();
  data.liveMatch.timerSeconds = 120;
  tracker.tick();
  tracker.action('turtle', 'blue');
  data.liveMatch.timerSeconds = 240;
  tracker.tick();
  tracker.action('turtle', 'red');
  data.liveMatch.timerSeconds = 361;
  tracker.tick();
  tracker.action('turtle', 'blue');
  assert.strictEqual(data.objectives.turtle.state, 'done');
  assert.strictEqual(data.objectives.lord.nextSpawn, 481);
});

test('lord spawns at 8:00 by default', () => {
  const { data, tracker } = harness();
  data.liveMatch.timerSeconds = 479;
  tracker.tick();
  assert.strictEqual(data.objectives.lord.state, 'waiting');
  data.liveMatch.timerSeconds = 480;
  tracker.tick();
  assert.strictEqual(data.objectives.lord.state, 'spawned');
});

test('tick does nothing when tracker disabled', () => {
  const { data, tracker } = harness();
  data.objectives.enabled = false;
  data.liveMatch.timerSeconds = 120;
  tracker.tick();
  assert.strictEqual(data.objectives.turtle.state, 'waiting');
  assert.strictEqual(data.objectives.lastEvent, null);
});

test('tick does nothing when match clock paused', () => {
  const { data, tracker } = harness();
  data.liveMatch.timerRunning = false;
  data.liveMatch.timerSeconds = 120;
  tracker.tick();
  assert.strictEqual(data.objectives.turtle.state, 'waiting');
});

test('slain on a done objective is rejected', () => {
  const { data, tracker } = harness();
  data.liveMatch.timerSeconds = 480;
  tracker.tick();
  tracker.action('turtle', 'blue');
  const r = tracker.action('turtle', 'blue');
  assert.strictEqual(r.success, false);
});

test('reset restores default schedule', () => {
  const { data, tracker } = harness();
  data.liveMatch.timerSeconds = 480;
  tracker.tick();
  tracker.action('turtle', 'blue');
  tracker.reset();
  assert.deepStrictEqual(data.objectives.turtle.state, DEFAULT_CONFIG.turtle.state);
  assert.strictEqual(data.objectives.turtle.nextSpawn, 120);
  assert.strictEqual(data.objectives.lastEvent, null);
});

console.log();
console.log('Static checks');
console.log('-------------');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('data.json has valid objectives config', () => {
  const d = JSON.parse(read('data.json'));
  assert.ok(d.objectives && d.objectives.turtle && d.objectives.lord, 'objectives present');
  assert.ok(['waiting', 'spawned', 'slain', 'done'].includes(d.objectives.turtle.state));
});

test('data.json has no leftover player rows', () => {
  const d = JSON.parse(read('data.json'));
  const lm = d.liveMatch || {};
  assert.ok(!lm.blue || !lm.blue.players, 'blue.players removed');
  assert.ok(!lm.red || !lm.red.players, 'red.players removed');
});

test('overlay.html has objective banner + chips elements', () => {
  const h = read('overlay.html');
  for (const id of ['objBanner', 'bannerIcon', 'bannerTitle', 'bannerSub', 'chipTurtle', 'chipLord']) {
    assert.ok(h.includes('id="' + id + '"'), 'missing #' + id);
  }
});

test('overlay.html no longer renders player rows', () => {
  const h = read('overlay.html');
  assert.ok(!h.includes('player-row'), 'no .player-row CSS');
  assert.ok(!h.includes('renderPlayers'), 'no renderPlayers');
  assert.ok(!h.includes('p-items'), 'no item slots');
});

test('admin.html player editors removed', () => {
  const h = read('admin.html');
  for (const token of ['lmBluePlayers', 'lmRedPlayers', 'buildPlayerEditors', 'collectPlayers', 'itemsList']) {
    assert.ok(!h.includes(token), 'leftover token: ' + token);
  }
  assert.ok(h.includes('objectiveAction'), 'objective controls present');
});

test('admin.html objectives UI present', () => {
  const h = read('admin.html');
  assert.ok(h.includes('objectiveAction(\'turtle\'') || h.includes("objectiveAction('turtle'"));
  assert.ok(h.includes('objectiveReset') && h.includes('objectiveToggle'));
});

console.log();
if (failures) {
  console.log(failures + ' test(s) FAILED');
  process.exit(1);
}
console.log('All tests passed.');
