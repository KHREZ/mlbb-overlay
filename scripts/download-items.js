const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, '..', 'images', 'items');
const ITEMS_FILE = path.join(__dirname, '..', 'items.json');
const API = 'https://mobile-legends.fandom.com/api.php';

const ITEMS = [
  'Swift Boots', 'Warrior Boots', 'Rapid Boots', 'Tough Boots', 'Magic Shoes', 'Demon Shoes', 'Arcane Boots',
  'Blade of the Heptaseas', 'Windtalker', 'Demon Hunter Sword', 'Scarlet Phantom', "Berserker's Fury",
  'Malefic Roar', 'Blade of Despair', 'Great Dragon Spear', "Queen's Wings", "Hunter's Strike",
  'War Axe', 'Endless Battle', 'Corrosion Scythe', 'Sea Halberd', 'Wind of Nature',
  'Feather of Heaven', 'Glowing Wand', 'Holy Crystal', 'Genius Wand', 'Lightning Truncheon',
  'Divine Glaive', 'Blood Wings', 'Concentrated Energy', 'Ice Queen Wand', 'Enchanted Talisman',
  'Necklace of Durance', 'Clock of Destiny',
  'Antique Cuirass', 'Blade Armor', 'Dominance Ice', "Athena's Shield", 'Twilight Armor',
  'Guardian Helmet', 'Cursed Helmet', 'Oracle', 'Radiant Armor', 'Brute Force Breastplate',
  'Immortality', 'Winter Truncheon', 'Rose Gold Meteor', 'Thunder Belt', 'Courage Bulwark',
  'Shadow Mask',
];

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, dest).then(resolve).catch(reject);
        res.resume();
        return;
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 500) return reject(new Error('Too small: ' + buf.length));
        fs.writeFileSync(dest, buf);
        resolve(buf.length);
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function accept(im) {
  return /\.png$/.test(im.name) && !/\(/.test(im.name) && !/_MC/.test(im.name) && !/Old/i.test(im.name) && !/EquipEffect/i.test(im.name) && !/^(Skill|Ability|Item)?\s*Icon/i.test(im.name);
}

async function resolveItem(name) {
  const tryPrefix = async (prefix) => {
    const url = `${API}?action=query&list=allimages&aiprefix=${encodeURIComponent(prefix)}&aiprop=url&format=json`;
    const data = await getJSON(url);
    return (data.query && data.query.allimages) || [];
  };

  let images = await tryPrefix(name);
  let img = images.find((im) => im.name === name + '.png');
  if (!img) {
    img = images.find(accept);
    const altNames = [name.replace(/['’][a-z] /gi, ' '), name.replace(/['’]/g, ' '), name.replace(/['’]/g, '')].map((s) => s.replace(/\s+/g, ' ').trim());
    for (const alt of altNames) {
      if (img || alt === name) break;
      const altImages = await tryPrefix(alt);
      img = altImages.find((im) => im.name === alt + '.png') || altImages.find(accept);
    }
  }
  if (!img) return null;
  return { url: img.url, name: img.name };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let ok = 0, fail = 0;
  const catalog = [];
  for (const name of ITEMS) {
    const id = slug(name);
    const dest = path.join(OUT_DIR, id + '.png');
    if (fs.existsSync(dest)) {
      catalog.push({ id, name, icon: 'images/items/' + id + '.png' });
      ok++;
      continue;
    }
    let success = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const resolved = await resolveItem(name);
        if (!resolved) throw new Error('no fandom match');
        const len = await download(resolved.url, dest);
        catalog.push({ id, name, icon: 'images/items/' + id + '.png' });
        console.log(`OK    ${id}  (${Math.round(len / 1024)}KB)${attempt > 1 ? ` [retry ${attempt}]` : ''}`);
        ok++;
        success = true;
        break;
      } catch (e) {
        if (attempt < 4) await new Promise((r) => setTimeout(r, 1200 * attempt));
        else { console.log(`FAIL  ${id}  ${e.message}`); fail++; }
      }
    }
  }
  fs.writeFileSync(ITEMS_FILE, JSON.stringify(catalog, null, 2));
  console.log(`\nDone: ${ok} ok, ${fail} failed. items.json updated.`);
})().catch((e) => { console.error(e); process.exit(1); });