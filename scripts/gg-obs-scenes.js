const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function uuid() {
  return crypto.randomUUID();
}

const CANVAS = { x: 1920, y: 1080 };
const CANVAS_UUID = '6c69626f-6273-4c00-9d88-c5136d61696e';

function audioDevice(name, uuidv, id) {
  return {
    prev_ver: 537001985,
    name,
    uuid: uuidv,
    id,
    versioned_id: id,
    settings: { device_id: 'default' },
    mixers: 255,
    sync: 0,
    flags: 0,
    volume: 1.0,
    balance: 0.5,
    enabled: true,
    muted: false,
    'push-to-mute': false,
    'push-to-mute-delay': 0,
    'push-to-talk': false,
    'push-to-talk-delay': 0,
    hotkeys: {
      'libobs.mute': [],
      'libobs.unmute': [],
      'libobs.push-to-mute': [],
      'libobs.push-to-talk': [],
    },
    deinterlace_mode: 0,
    deinterlace_field_order: 0,
    monitoring_type: 0,
    private_settings: {},
  };
}

function browserSettings(url) {
  return {
    url,
    width: 1920,
    height: 1080,
    fps: 60,
    fps_custom: true,
    shutdown: false,
    restart_when_active: false,
    ignore_web_cert_errors: false,
    reroute_audio: true,
  };
}

function makeBrowserSource(name, url) {
  return {
    prev_ver: 537001985,
    name,
    uuid: uuid(),
    id: 'browser_source',
    versioned_id: 'browser_source',
    settings: browserSettings(url),
    mixers: 255,
    sync: 0,
    flags: 0,
    volume: 1.0,
    balance: 0.5,
    enabled: true,
    muted: false,
    'push-to-mute': false,
    'push-to-mute-delay': 0,
    'push-to-talk': false,
    'push-to-talk-delay': 0,
    hotkeys: { 'libobs.mute': [], 'libobs.unmute': [], 'OBSBrowser.Refresh': [] },
    deinterlace_mode: 0,
    deinterlace_field_order: 0,
    monitoring_type: 0,
    private_settings: {},
  };
}

function makeWindowCapture(name) {
  return {
    prev_ver: 537001985,
    name,
    uuid: uuid(),
    id: 'xcomposite_capture',
    versioned_id: 'xcomposite_capture',
    settings: {
      client_area: true,
      capture_cursor: true,
      fullscreen: false,
      region: null,
      region_select_manual: false,
      region_fit_manual: false,
      downscale_scale: 1.0,
      downscale_method: 0,
      encoder_group: null,
    },
    mixers: 255,
    sync: 0,
    flags: 0,
    volume: 1.0,
    balance: 0.5,
    enabled: true,
    muted: false,
    'push-to-mute': false,
    'push-to-mute-delay': 0,
    'push-to-talk': false,
    'push-to-talk-delay': 0,
    hotkeys: { 'libobs.mute': [], 'libobs.unmute': [] },
    deinterlace_mode: 0,
    deinterlace_field_order: 0,
    monitoring_type: 0,
    private_settings: {},
  };
}

function makeVideoCapture(name) {
  return {
    prev_ver: 1,
    name,
    uuid: uuid(),
    id: 'av_capture_source',
    versioned_id: 'av_capture_source',
    settings: { device_id: 'Default', fit: 'contain', input_format: 'NV12' },
    mixers: 255,
    sync: 0,
    flags: 0,
    volume: 1.0,
    balance: 0.5,
    enabled: true,
    muted: false,
    'push-to-mute': false,
    'push-to-mute-delay': 0,
    'push-to-talk': false,
    'push-to-talk-delay': 0,
    hotkeys: { 'libobs.mute': [], 'libobs.unmute': [] },
    deinterlace_mode: 0,
    deinterlace_field_order: 0,
    monitoring_type: 0,
    private_settings: {},
  };
}

function sceneItem(sourceName, sourceUuid, bounds, pos) {
  const b = bounds || CANVAS;
  const p = pos || { x: 0, y: 0 };
  return {
    name: sourceName,
    source_uuid: sourceUuid,
    visible: true,
    locked: false,
    rot: 0.0,
    scale_ref: { x: b.x, y: b.y },
    align: 5,
    bounds_type: 2,
    bounds_align: 0,
    bounds_crop: false,
    crop_left: 0,
    crop_top: 0,
    crop_right: 0,
    crop_bottom: 0,
    id: 0,
    group_item_backup: false,
    pos: p,
    pos_rel: { x: p.x / CANVAS.x, y: p.y / CANVAS.y },
    scale: { x: 1.0, y: 1.0 },
    scale_rel: { x: 1.0, y: 1.0 },
    bounds: { x: b.x, y: b.y },
    bounds_rel: { x: b.x / CANVAS.x, y: b.y / CANVAS.y },
    scale_filter: 'disable',
    blend_method: 'default',
    blend_type: 'normal',
    show_transition: { duration: 300 },
    hide_transition: { duration: 300 },
    private_settings: {},
  };
}

function makeScene(name, items) {
  let n = 1;
  const arr = items.map((it) => ({ ...it, id: it.id || n++ }));
  return {
    prev_ver: 537001985,
    name,
    uuid: uuid(),
    id: 'scene',
    versioned_id: 'scene',
    settings: { id_counter: 100, custom_size: false, items: arr },
    mixers: 0,
    sync: 0,
    flags: 0,
    volume: 1.0,
    balance: 0.5,
    enabled: true,
    muted: false,
    'push-to-mute': false,
    'push-to-mute-delay': 0,
    'push-to-talk': false,
    'push-to-talk-delay': 0,
    hotkeys: { 'OBSBasic.SelectScene': [] },
    deinterlace_mode: 0,
    deinterlace_field_order: 0,
    monitoring_type: 0,
    canvas_uuid: '6c69626f-6273-4c00-9d88-c5136d61696e',
    private_settings: {},
  };
}

// ---- Create sources ----
const scoreboard = makeBrowserSource('Scoreboard', 'http://localhost:3000/overlay.html');
const draft = makeBrowserSource('Draft Overlay', 'http://localhost:3000/draft.html');
const casters = makeBrowserSource('Casters Overlay', 'http://localhost:3000/casters.html');
const mvp = makeBrowserSource('MVP Overlay', 'http://localhost:3000/mvp.html');
const intro = makeBrowserSource('Intro Overlay', 'http://localhost:3000/intro.html');
const brb = makeBrowserSource('BRB Overlay', 'http://localhost:3000/brb.html');
const scrcpySrc = makeWindowCapture('scrcpy - Phone');
const webcamSrc = makeVideoCapture('Webcam');

// ---- Scenes ----
const scenes = [
  makeScene('INTRO / BREAK', [
    sceneItem(intro.name, intro.uuid, CANVAS),
  ]),
  makeScene('DRAFT', [
    sceneItem(draft.name, draft.uuid, CANVAS),
    sceneItem(scrcpySrc.name, scrcpySrc.uuid, { x: 620, y: 1080 }, { x: 650, y: 0 }),
  ]),
  makeScene('LIVE MATCH', [
    sceneItem(scrcpySrc.name, scrcpySrc.uuid, { x: 620, y: 1080 }, { x: 650, y: 0 }),
    sceneItem(scoreboard.name, scoreboard.uuid, CANVAS),
  ]),
  makeScene('CASTERS', [
    sceneItem(webcamSrc.name, webcamSrc.uuid, { x: 640, y: 360 }, { x: 60, y: 120 }),
    sceneItem(casters.name, casters.uuid, CANVAS),
  ]),
  makeScene('MVP', [
    sceneItem(scrcpySrc.name, scrcpySrc.uuid, CANVAS),
    sceneItem(mvp.name, mvp.uuid, CANVAS),
  ]),
  makeScene('BRB', [
    sceneItem(brb.name, brb.uuid, CANVAS),
  ]),
];

const collection = {
  name: 'MLBB Tournament',
  DesktopAudioDevice1: audioDevice('Desktop Audio', '4934a624-3eee-4193-a1f4-865aa7b1605c', 'pulse_output_capture'),
  AuxAudioDevice1: audioDevice('Mic/Aux', 'd8b052ab-fed9-456f-a2e4-83b3d818fa1e', 'pulse_input_capture'),
  sources: [scoreboard, draft, casters, mvp, intro, brb, scrcpySrc, webcamSrc, ...scenes],
  groups: [],
  scene_order: scenes.map((s) => ({ name: s.name })),
  current_scene: 'LIVE MATCH',
  current_program_scene: 'LIVE MATCH',
  canvases: [],
  current_transition: 'Fade',
  transition_duration: 300,
  transitions: [],
  quick_transitions: [
    { name: 'Cut', duration: 300, hotkeys: [], id: 1, fade_to_black: false },
    { name: 'Fade', duration: 300, hotkeys: [], id: 2, fade_to_black: false },
    { name: 'Fade', duration: 300, hotkeys: [], id: 3, fade_to_black: true },
  ],
  saved_projectors: [],
  preview_locked: false,
  scaling_enabled: false,
  scaling_level: -1,
  scaling_off_x: 0.0,
  scaling_off_y: 0.0,
  modules: {},
  resolution: { x: CANVAS.x, y: CANVAS.y },
  version: 2,
};

const out = path.join(__dirname, '..', 'obs-config', 'mlbb-tournament.json');
fs.writeFileSync(out, JSON.stringify(collection, null, 2));
console.log('Wrote', out, '-', scenes.length, 'scenes');