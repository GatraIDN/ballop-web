// Save today's ad balance record (menu "Sisa saldo iklan"). Missing values are copied from the last record
// and listed in the note. Backs up first.
//   node --env-file=.env tools/daily/save-adbudget.js YYYY-MM-DD shopee=2849814 shopeeExt=398174 [tiktok=..] [metaCampaign=..] [metaCpas=..] [--write]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { store } = require('../../lib/api');

(async () => {
  const [date, ...rest] = process.argv.slice(2);
  const write = rest.includes('--write');
  const KEYS = ['shopee', 'shopeeExt', 'tiktok', 'metaCampaign', 'metaCpas'];
  const vals = Object.fromEntries(rest.filter((a) => a.includes('=')).map((a) => a.split('=')).map(([k, v]) => [k, Number(v)]));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('first argument must be the date YYYY-MM-DD');
  const list = await store.get('adbudget', []);
  const last = [...list].sort((a, b) => b.date.localeCompare(a.date))[0] || {};
  const copied = KEYS.filter((k) => !(k in vals));
  const rec = { id: crypto.randomUUID(), date, updatedBy: 'Claude', updatedAt: new Date().toISOString().slice(0, 16),
    note: copied.length ? `${copied.join(', ')} disalin dari ${last.date || '-'} (belum bisa dibaca)` : 'semua saldo dari platform' };
  KEYS.forEach((k) => { rec[k] = k in vals ? vals[k] : last[k] || 0; });
  console.log(JSON.stringify(rec));
  if (!write) { console.log('Dry run. Tambah --write untuk menyimpan.'); return; }
  fs.writeFileSync(path.join(__dirname, '..', '..', 'data', `backup-adbudget-${date}.json`), JSON.stringify(list));
  await store.set('adbudget', [...list.filter((x) => x.date !== date), rec]);
  console.log('tersimpan');
})();
