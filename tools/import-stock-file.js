// Import the daily 3PL stock balance export (.xlsx) into stock3pl, same rules as "Import stock harian" in the admin.
// Backs up first. Dry run by default; add --write to save. Date comes from the file name ("stock 5.11.xlsx") or --date=YYYY-MM-DD.
//   node --env-file=.env tools/import-stock-file.js "<file.xlsx>" [--date=2026-11-05] [--write]
const fs = require('fs');
const path = require('path');
const { store } = require('../lib/api');
const { readXlsx } = require('./import-market-file');
const SI = require('../public/stock-import');

(async () => {
  const file = process.argv[2];
  const write = process.argv.includes('--write');
  const today = new Date().toISOString().slice(0, 10);
  const date = (process.argv.find((a) => a.startsWith('--date=')) || '').slice(7) || SI.dateFromName(path.basename(file), today) || today;
  const items = readXlsx(file).map((s) => SI.parse(s.rows)).find(Boolean);
  if (!items) { console.log('Format stock balance (Item, W/H, Ending) tidak ditemukan.'); return; }
  const stock = await store.get('stock3pl', []);
  const now = new Date();
  const at = `${today} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const { list, stats } = SI.apply(stock, items, { date, at, by: `Import ${path.basename(file)}` });
  console.log(`tanggal stok ${date} · ${items.size} item di file`);
  console.log(`di-update ${stats.updated} · item baru ${stats.added} · tidak ada di file ${stats.missing}`);
  console.log(`good ${stats.goodBefore} -> ${stats.goodAfter} · damaged ${stats.dmgBefore} -> ${stats.dmgAfter} · ${stats.changes.length} SKU berubah`);
  stats.changes.slice(0, 15).forEach((c) => console.log(`  ${c.item}: ${c.before} -> ${c.after}${c.dmgBefore !== c.dmgAfter ? ` (damaged ${c.dmgBefore} -> ${c.dmgAfter})` : ''}`));
  stats.newItems.forEach((i) => console.log(`  + baru: ${i}`));
  if (!write) { console.log('\nDry run. Tambah --write untuk menyimpan.'); return; }
  fs.writeFileSync(path.join(__dirname, '..', 'data', `backup-stock3pl-before-${path.basename(file).replace(/[^\w.-]+/g, '_')}-${today}.json`), JSON.stringify(stock));
  await store.set('stock3pl', list);
  const hist = (await store.get('stockhist', [])).filter((h) => h.date !== date);
  hist.push({ id: require('crypto').randomUUID(), date, source: path.basename(file), items: SI.snapshot(items), updatedAt: at, updatedBy: 'Import tools' });
  hist.sort((a, b) => a.date.localeCompare(b.date));
  await store.set('stockhist', hist);
  console.log(`riwayat stok: ${hist.length} tanggal (${hist.map((h) => h.date).join(', ')})`);
  console.log(`tersimpan. total SKU ${list.length}`);
})();
