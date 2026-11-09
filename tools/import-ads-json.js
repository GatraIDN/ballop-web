// Import ad spend grabbed from Shopee Seller Centre (Iklan Shopee) and TikTok Seller Centre (GMV Max) as JSON rows
// [date, type, title, spend, gmv, orders, impressions, clicks]. Within the date range of the file it replaces the
// rows of the same source (Shopee rows except CPAS, TikTok rows named GMV Max); other manual rows are kept.
//   node --env-file=.env tools/import-ads-json.js <shopee.json> <tiktok.json> [--write]
const fs = require('fs');
const path = require('path');
const { store, CLEAN } = require('../lib/api');
const TYPE = { P: ['shopee', 'Iklan Produk'], S: ['shopee', 'Iklan Toko+'], L: ['shopee', 'Iklan Live'], B: ['shopee', 'Iklan Banner'], G: ['tiktok', 'GMV Max'] };

(async () => {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const write = process.argv.includes('--write');
  const rows = files.flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const from = rows.map((r) => r[0]).sort()[0], to = rows.map((r) => r[0]).sort().pop();
  const fresh = rows.map(([date, t, title, spend, revenue, orders, impressions, clicks]) => {
    const [channel, kind] = TYPE[t];
    return CLEAN.ads({ date, channel, campaign: t === 'G' ? 'GMV Max Tiktok' : `${kind} · ${title}`, spend, revenue, orders, impressions, clicks, note: `${kind} · dari Seller Centre` });
  });
  const all = await store.get('ads', []);
  const replaced = (a) => a.date >= from && a.date <= to && ((a.channel === 'shopee' && !/cpas/i.test(a.campaign)) || (a.channel === 'tiktok' && /gmv max/i.test(a.campaign)));
  const keep = all.filter((a) => !replaced(a));
  const sum = (list, ch) => Math.round(list.filter((a) => a.channel === ch).reduce((s, a) => s + a.spend, 0));
  console.log(`periode ${from} – ${to} · baris baru ${fresh.length} · diganti ${all.length - keep.length} · tetap ${keep.length}`);
  console.log(`spend Shopee lama ${sum(all.filter((a) => a.date >= from && a.date <= to), 'shopee').toLocaleString('id-ID')} -> baru ${sum([...keep.filter((a) => a.date >= from && a.date <= to), ...fresh], 'shopee').toLocaleString('id-ID')}`);
  console.log(`spend TikTok lama ${sum(all.filter((a) => a.date >= from && a.date <= to), 'tiktok').toLocaleString('id-ID')} -> baru ${sum([...keep.filter((a) => a.date >= from && a.date <= to), ...fresh], 'tiktok').toLocaleString('id-ID')}`);
  if (!write) { console.log('Dry run. Tambah --write untuk menyimpan.'); return; }
  fs.writeFileSync(path.join(__dirname, '..', 'data', `backup-ads-before-seller-centre-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(all));
  const out = [...keep, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
  await store.set('ads', out);
  console.log(`tersimpan. total baris iklan ${out.length}`);
})();
