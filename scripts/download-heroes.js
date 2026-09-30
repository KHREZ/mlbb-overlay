const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const HEROES_FILE = path.join(__dirname, '..', 'heroes.json');
const OUT_DIR = path.join(__dirname, '..', 'images', 'heroes');
const SCHEME_URL = 'https://gist.githubusercontent.com/vsec7/73c6dedea092fca8e0a94d448000226c/raw';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, dest).then(resolve).catch(reject);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 1000) return reject(new Error('Too small: ' + buf.length));
        fs.writeFileSync(dest, buf);
        resolve(buf.length);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function normalizeId(id) {
  return String(id).toLowerCase().replace(/[\s.'"()-]/g, '_').replace(/_+/g, '_');
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const heroes = JSON.parse(fs.readFileSync(HEROES_FILE, 'utf8'));
  const schemeRes = await new Promise((resolve) => {
    https.get(SCHEME_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(ch).toString())));
    }).on('error', (e) => resolve([]));
  });

  const scheme = Array.isArray(schemeRes) ? schemeRes : (schemeRes.data || schemeRes.heroes || []);
  const schemeMap = {};
  const mlidMap = {};
  scheme.forEach((h) => {
    schemeMap[normalizeId(h.hero_name)] = h.portrait;
    if (h.mlid) mlidMap[normalizeId(h.hero_name)] = String(h.mlid);
  });

  function fandomUrl(mlid) {
    const crypto = require('crypto');
    const num = parseInt(mlid, 10);
    const fname = 'Hero' + (num < 100 ? String(num).padStart(3, '0') : num + '1') + '-portrait.png';
    const h = crypto.createHash('md5').update(fname).digest('hex');
    return `https://static.wikia.nocookie.net/mobile-legends/images/${h.slice(0, 1)}/${h.slice(0, 2)}/${fname}/revision/latest`;
  }

  function pickPortrait(hero) {
    const idKey = normalizeId(hero.id);
    const nameKey = normalizeId(hero.name);
    const primary = schemeMap[idKey] || schemeMap[nameKey];
    if (primary && !primary.includes('youngjoygame.com')) return primary;
    const mlid = mlidMap[idKey] || mlidMap[nameKey];
    if (mlid) return fandomUrl(mlid);
    return primary || null;
  }

  let ok = 0, fail = 0;
  for (const hero of heroes) {
    const portrait = pickPortrait(hero);
    if (!portrait) {
      console.log(`SKIP  ${hero.id} (no scheme match)`);
      fail++;
      continue;
    }
    const ext = path.extname(new URL(portrait).pathname) || '.png';
    const dest = path.join(OUT_DIR, hero.id + ext);
    if (fs.existsSync(dest)) { ok++; continue; }
    let success = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const len = await download(portrait, dest);
        console.log(`OK    ${hero.id}  (${Math.round(len / 1024)}KB)${attempt > 1 ? ` [retry ${attempt}]` : ''}`);
        ok++;
        success = true;
        break;
      } catch (e) {
        if (attempt < 4) await new Promise((r) => setTimeout(r, 1500 * attempt));
        else { console.log(`FAIL  ${hero.id}  ${e.message}`); fail++; }
      }
    }
    if (!success) continue;
  }

  // Update heroes.json icon paths to local files
  for (const hero of heroes) {
    const ext = ['.png', '.jpg', '.jpeg'].find((e) => fs.existsSync(path.join(OUT_DIR, hero.id + e)));
    if (ext) hero.icon = 'images/heroes/' + hero.id + ext;
  }
  fs.writeFileSync(HEROES_FILE, JSON.stringify(heroes, null, 2));
  console.log(`\nDone: ${ok} ok, ${fail} failed. heroes.json updated.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});