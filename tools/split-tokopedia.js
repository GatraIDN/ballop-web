// One-off: TikTok Shop exports also carry Tokopedia orders. Move those rows to channel "tokopedia",
// using the raw export column (orders: "Purchase Channel", income: "Order source"). Backs up first.
// node --env-file=.env tools/split-tokopedia.js
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');

const COL = { orders: ['Purchase Channel'], settlements: ['Order source', 'Sumber pesanan'] };
(async () => {
  const day = new Date().toISOString().slice(0, 10);
  for (const kind of ['orders', 'settlements']) {
    const rows = await store.get(kind, []);
    const raw = await store.get(`raw_${kind}`, {});
    fs.writeFileSync(path.join(__dirname, '..', 'data', `backup-${kind}-before-tokopedia-split-${day}.json`), JSON.stringify(rows));
    const src = (key) => {
      for (const r of raw[key] || []) for (const [c, v] of Array.isArray(r) ? r : Object.entries(r)) if (COL[kind].includes(c) && v) return String(v);
      return '';
    };
    // adjustments carry the related order id; borrow the channel of that order
    const byOrder = {};
    let moved = 0;
    rows.forEach((r) => {
      if (!String(r.key).startsWith('tiktok:') || !['tiktok', 'tokopedia'].includes(r.channel)) return;
      const s = src(r.key);
      if (!s) return;
      const ch = /tokopedia/i.test(s) ? 'tokopedia' : 'tiktok';
      byOrder[r.orderId] = ch;
      if (r.channel !== ch) { r.channel = ch; moved++; }
    });
    rows.forEach((r) => {
      if (String(r.key).startsWith('tiktok:') && r.type === 'Penyesuaian' && byOrder[r.orderId] && r.channel !== byOrder[r.orderId]) { r.channel = byOrder[r.orderId]; moved++; }
    });
    await store.set(kind, rows);
    const n = (c) => rows.filter((r) => r.channel === c).length;
    console.log(kind, 'moved', moved, '| tiktok', n('tiktok'), '| tokopedia', n('tokopedia'));
  }
})();
