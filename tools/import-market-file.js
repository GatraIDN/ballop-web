// Import a marketplace export (.xlsx) straight into the store, with the same recognisers as the admin
// "Import file marketplace" panel and the same merge as POST /api/import (same key = update, no duplicates).
// Backs up the collection to data/ first. Dry run by default; add --write to save.
//   node --env-file=.env tools/import-market-file.js "<file.xlsx>" [--write]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { store, CLEAN } = require('../lib/api');

// ---- minimal xlsx reader (zip + shared strings), values as the sheet shows them ----
function unzip(buf) {
  let e = buf.length - 22; while (buf.readUInt32LE(e) !== 0x06054b50) e--;
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString();
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.slice(start, start + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nl + xl + cl;
  }
  return out;
}
const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function readXlsx(file) {
  const z = unzip(fs.readFileSync(file));
  const ss = z['xl/sharedStrings.xml'] ? [...z['xl/sharedStrings.xml'].toString().matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))) : [];
  const wb = z['xl/workbook.xml'].toString(), rels = z['xl/_rels/workbook.xml.rels'].toString();
  return [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(([, name, rid]) => {
    const t = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`));
    const xml = z[`xl/${t[1].replace(/^\/?xl\//, '')}`].toString();
    // place every cell by its own address (A1, B7 …): some exports (TikTok) write one <row> block per cell
    const grid = [];
    for (const c of xml.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/r="([A-Z]+)(\d+)"/);
      if (!ref) continue;
      let col = 0; for (const ch of ref[1]) col = col * 26 + ch.charCodeAt(0) - 64;
      const ty = (c[1].match(/t="(\w+)"/) || [])[1], v = ((c[2] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const row = grid[Number(ref[2]) - 1] = grid[Number(ref[2]) - 1] || [];
      row[col - 1] = ty === 's' ? ss[Number(v)] : ty === 'inlineStr' ? dec(((c[2] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '') : v === undefined ? '' : (ty === 'str' || isNaN(v) ? dec(v) : Number(v));
    }
    const rows = Array.from(grid, (r) => Array.from(r || [], (x) => (x === undefined ? '' : x)));
    return { name, rows };
  });
}

// ---- the admin's own recognisers, loaded from the browser file ----
const sandbox = { window: {}, document: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/admin-import.js'), 'utf8'), sandbox);
const { KINDS } = sandbox.window.MarketImport;
const text = (v) => String(v ?? '').trim();
function readSheet(aoa) {
  for (let i = 0; i < Math.min(20, aoa.length); i++) {
    const head = (aoa[i] || []).map(text);
    const kind = Object.keys(KINDS).find((k) => KINDS[k].match(head));
    if (!kind) continue;
    const out = [];
    aoa.slice(i + 1).forEach((row) => {
      if (!row || !row.some((c) => text(c))) return;
      const obj = {};
      head.forEach((h, j) => { if (h && !(h in obj)) obj[h] = row[j]; });
      const rec = KINDS[kind].map(obj);
      if (!rec || rec.date === undefined) return;
      rec.raw = [Object.fromEntries(Object.entries(obj).filter(([, v]) => text(v) !== ''))];
      out.push(rec);
    });
    return { kind, rows: KINDS[kind].finish ? KINDS[kind].finish(out) : out };
  }
  return null;
}

module.exports = { readXlsx, readSheet };
if (require.main === module) (async () => {
  const [file, flag] = process.argv.slice(2);
  const write = flag === '--write';
  for (const sh of readXlsx(file)) {
    const res = readSheet(sh.rows);
    if (!res) { console.log(`sheet "${sh.name}": format tidak dikenali, dilewati`); continue; }
    const target = KINDS[res.kind].target;
    const rows = res.rows;
    const months = {};
    rows.forEach((r) => { const m = (r.releaseDate || r.date || '').slice(0, 7); months[m] = (months[m] || 0) + 1; });
    const net = rows.filter((r) => r.state === 'completed' || r.state === 'pending').reduce((s, r) => s + (r.net || 0), 0);
    console.log(`sheet "${sh.name}": ${KINDS[res.kind].label} -> ${target}, ${rows.length} baris`, JSON.stringify(months), target === 'orders' ? `omzet selesai+diproses ${Math.round(net).toLocaleString('id-ID')}` : '');
    const all = await store.get(target, []);
    // LIVE sessions from the Analytics export have no Room ID: adopt the key of a stored session with the same date + start
    if (target === 'live') rows.forEach((r) => { const same = all.find((a) => a.channel === r.channel && a.date === r.date && a.start === r.start); if (same) { r.key = same.key; for (const k of ['roomId', 'impressions', 'title']) if (r[k] == null && same[k] != null) r[k] = same[k]; } });
    const byKey = new Map(all.map((r, i) => [r.key, i]));
    const clean = rows.map(CLEAN[target]).filter((r) => r.key);
    const upd = clean.filter((r) => byKey.has(r.key)).length;
    console.log(`  akan ditambah ${clean.length - upd}, di-update ${upd} (total ${target} sekarang ${all.length})`);
    if (!write) continue;
    const day = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(__dirname, '..', 'data', `backup-${target}-before-${path.basename(file).replace(/[^\w.-]+/g, '_')}-${day}.json`), JSON.stringify(all));
    const raw = await store.get(`raw_${target}`, {});
    rows.forEach((r) => { if (r.key && r.raw) raw[String(r.key).slice(0, 160)] = r.raw.slice(0, 30).map((row) => Object.entries(row)); });
    await store.set(`raw_${target}`, raw);
    clean.forEach((r) => { if (byKey.has(r.key)) { const i = byKey.get(r.key); r.id = all[i].id; all[i] = r; } else { byKey.set(r.key, all.length); all.push(r); } });
    await store.set(target, all);
    console.log(`  tersimpan. total ${target} sekarang ${all.length}`);
  }
  if (!write) console.log('\nDry run. Tambah --write untuk menyimpan.');
})();
