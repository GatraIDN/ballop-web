// Import consignment (konsinyasi) workbooks from the "Ballop Offline" Drive folder into the `consign` collection.
// One workbook per partner store, sheets: Barang Keluar (kirim), Barang Masuk (Retur), Penjualan & Pembayaran (jual),
// Sample, and for Ascend also Sponsorship Sepatu. Every import replaces that partner's rows; other partners are kept.
//   node --env-file=.env tools/import-consign.js <file.xlsx ...> [--write]
const fs = require('fs');
const path = require('path');
const { readXlsx } = require('./import-market-file');
const { store, CLEAN } = require('../lib/api');

// "Consigment Report_Ballop_x_Holywings Sport House.xlsx" -> "Holywings Sport House"
const partnerOf = (f) => path.basename(f).replace(/\.xlsx$/i, '').replace(/^.*_x_/i, '').replace(/[-_\s]+$/, '').trim();
// Excel serial (46231) or dd/mm/yyyy -> yyyy-mm-dd
const isoOf = (v) => {
  if (typeof v === 'number' && v > 30000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return d.toISOString().slice(0, 10); }
  const m = String(v || '').match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};
const numOf = (v) => (typeof v === 'number' ? v : Number(String(v || '').replace(/[^0-9.-]/g, '')) || 0);
const KIND = [[/^barang keluar/i, 'kirim'], [/retur/i, 'retur'], [/^penjualan/i, 'jual'], [/^sample/i, 'sample'], [/^sponsorship sepatu/i, 'sponsor']];

function parse(file) {
  const partner = partnerOf(file);
  const out = [];
  for (const sh of readXlsx(file)) {
    const kind = (KIND.find(([re]) => re.test(sh.name.replace(/&amp;/g, '&'))) || [])[1];
    if (!kind) continue;
    const rows = (sh.rows || []).filter((r) => r && r.some((c) => c !== '' && c != null));
    const hi = rows.findIndex((r) => r.some((c) => /Kode Varian|Nama Coach/.test(String(c))));
    if (hi < 0) continue;
    const head = rows[hi].map((c) => String(c).replace(/\s+/g, ' ').trim());
    const col = (re) => head.findIndex((h) => re.test(h));
    const c = {
      date: col(/^Tanggal (Kirim|Retur|Jual|Distribusi)/), ref: col(/No Surat Jalan|No Invoice|No Referensi/), sku: col(/^Kode Varian/), size: col(/^Ukuran|^Size/),
      name: col(/^Nama Produk|^Model/), color: col(/^Warna/), qty: col(/^Qty/), price: col(/^Harga Satuan|^Harga Jual \(Rp\)$/), retail: col(/^Harga Jual$|^Harga Jual \(Rp\)$/),
      pay: col(/^Status Pembayaran/), paid: col(/^Tanggal Bayar/), note: col(/^Keterangan|^Catatan/), coach: col(/^Nama Coach/), kind2: col(/^Jenis Retur/),
    };
    rows.slice(hi + 1).forEach((r) => {
      const date = isoOf(r[c.date]);
      const qty = kind === 'sponsor' ? 1 : numOf(r[c.qty]);
      if (!date || !qty) return; // blank template rows and the TOTAL line
      const name = String(r[c.name] || '').trim();
      if (!name || /^#N\/A|^#REF/i.test(name)) return; // broken formula rows in some sheets
      const [product, color] = kind === 'sponsor' ? [name, String(r[c.color] || '')] : name.split(/\s+-\s+/);
      out.push(CLEAN.consign({
        partner, type: kind, date, ref: String(r[c.ref] ?? '').trim(), sku: String(r[c.sku] ?? '').trim(), product: (product || '').trim(), color: (color || '').trim(),
        size: String(r[c.size] ?? '').replace(',', '.').trim(), qty, price: numOf(r[c.price]), retail: c.retail >= 0 && c.retail !== c.price ? numOf(r[c.retail]) : 0,
        payment: c.pay >= 0 ? (/^lunas/i.test(r[c.pay]) ? 'lunas' : r[c.pay] ? 'belum' : '') : '', paidDate: c.paid >= 0 ? isoOf(r[c.paid]) : '',
        note: [kind === 'sponsor' ? `Coach ${r[c.coach]}` : '', c.kind2 >= 0 ? r[c.kind2] : '', r[c.note]].filter(Boolean).join(' · '),
      }));
    });
  }
  return { partner, rows: out };
}

(async () => {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const write = process.argv.includes('--write');
  const parsed = files.map(parse);
  parsed.forEach(({ partner, rows }) => {
    const t = (k) => rows.filter((r) => r.type === k).reduce((s, r) => s + r.qty, 0);
    console.log(`${partner.padEnd(26)} kirim ${t('kirim')} · retur ${t('retur')} · jual ${t('jual')} · sample ${t('sample')} · sponsor ${t('sponsor')} · sisa ${t('kirim') - t('retur') - t('jual')}`);
  });
  if (!write) { console.log('Dry run. Tambah --write untuk menyimpan.'); return; }
  const all = await store.get('consign', []);
  fs.writeFileSync(path.join(__dirname, '..', 'data', `backup-consign-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(all));
  const names = new Set(parsed.map((p) => p.partner.toLowerCase()));
  const out = [...all.filter((r) => !names.has(r.partner.toLowerCase())), ...parsed.flatMap((p) => p.rows)];
  await store.set('consign', out);
  console.log(`tersimpan. total baris konsinyasi ${out.length}`);
})();
