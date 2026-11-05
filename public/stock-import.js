// BALLOP: daily stock import from the 3PL "stock balance" export
// (Customer | Item | UoM | W/H | Opening | Stock In | Other In | Order Out | Other Out | Ending), one row per item × warehouse.
// Item = the pickpack name ("BALLOP PADEL PULSE - BLACK - 250 (EU 40)"), stored on a stock row as `note`.
// good (available) = Ending of the "… - NORMAL" warehouses, damaged = Ending of "… - DAMAGED".
// Used by the Stok gudang page (browser) and tools/import-stock-file.js (node).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StockImport = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const text = (v) => String(v ?? '').trim();
  const num = (v) => { if (typeof v === 'number') return v; const s = text(v).replace(/\./g, '').replace(',', '.'); return Number(s) || 0; };
  const COLS = { item: 'Item', uom: 'UoM', wh: 'W/H', opening: 'Opening', stockIn: 'Stock In', otherIn: 'Other In', orderOut: 'Order Out', otherOut: 'Other Out', ending: 'Ending' };
  const isDamaged = (wh) => /damage/i.test(wh);

  // rows (array of arrays) -> Map(item -> { uom, whs: [...] }) or null when the sheet is not a stock balance export
  function parse(aoa) {
    for (let i = 0; i < Math.min(15, aoa.length); i++) {
      const head = (aoa[i] || []).map(text);
      const ix = Object.fromEntries(Object.entries(COLS).map(([k, l]) => [k, head.findIndex((h) => h.toLowerCase() === l.toLowerCase())]));
      if (ix.item < 0 || ix.wh < 0 || ix.ending < 0) continue;
      const items = new Map();
      aoa.slice(i + 1).forEach((r) => {
        const item = text(r[ix.item]);
        if (!item) return;
        const x = items.get(item) || { uom: text(r[ix.uom]), whs: [] };
        x.whs.push({ wh: text(r[ix.wh]).replace(/^W\/H\s*-\s*/i, ''), ...Object.fromEntries(['opening', 'stockIn', 'otherIn', 'orderOut', 'otherOut', 'ending'].map((k) => [k, ix[k] >= 0 ? num(r[ix[k]]) : 0])) });
        items.set(item, x);
      });
      return items;
    }
    return null;
  }

  // "BALLOP PADEL PULSE - BLACK - 250 (EU 40)" -> product, colour, Korean size, EU size (for items not seen before)
  function parseItem(item) {
    const m = item.match(/^(.*?)\s+-\s+(.*?)\s+-\s+(\d{3})\s*\(EU\s*([\d.,]+)\)\s*$/i);
    if (m) return { product: m[1].trim(), color: m[2].trim(), sizeKr: m[3], size: m[4].replace(',', '.') };
    const parts = item.split(/\s+-\s+/);
    return { product: parts.slice(0, -1).join(' - ') || item, color: parts.length > 1 ? parts[parts.length - 1] : '', sizeKr: '', size: '' };
  }

  // "stock 5.11.xlsx" -> "2026-11-05" (year of `today`); null when the name has no day.month
  function dateFromName(name, today) {
    const m = String(name).match(/(?:^|[^\d])(\d{1,2})[.\-_](\d{1,2})(?:[.\-_](\d{2,4}))?(?:[^\d]|$)/);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    let y = m[3] ? Number(m[3]) : Number(String(today).slice(0, 4));
    if (y < 100) y += 2000;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // existing stock rows + parsed export -> new full list and what changed
  function apply(stock, items, { date, at, by }) {
    const byNote = new Map(stock.map((r) => [text(r.note), r]));
    const sum = (whs, dmg) => whs.filter((w) => isDamaged(w.wh) === dmg).reduce((t, w) => t + w.ending, 0);
    const stats = { updated: 0, added: 0, missing: 0, goodBefore: 0, goodAfter: 0, dmgBefore: 0, dmgAfter: 0, changes: [], newItems: [] };
    const seen = new Set();
    const list = stock.map((r) => {
      const x = items.get(text(r.note));
      stats.goodBefore += r.available || 0; stats.dmgBefore += r.damaged || 0;
      if (!x) { stats.missing++; stats.goodAfter += r.available || 0; stats.dmgAfter += r.damaged || 0; return r; }
      seen.add(text(r.note));
      const available = sum(x.whs, false), damaged = sum(x.whs, true);
      stats.updated++; stats.goodAfter += available; stats.dmgAfter += damaged;
      if (available !== r.available || damaged !== r.damaged) stats.changes.push({ item: r.note, before: r.available, after: available, dmgBefore: r.damaged, dmgAfter: damaged });
      return { ...r, date, available, damaged, whs: x.whs, uom: x.uom || r.uom, warehouse: [...new Set(x.whs.filter((w) => !isDamaged(w.wh)).map((w) => w.wh.replace(/\s*-\s*NORMAL$/i, '')))].join(' + ') || r.warehouse, updatedAt: at, updatedBy: by };
    });
    const maxOrder = Math.max(0, ...stock.map((r) => r.order || 0));
    let n = 0;
    items.forEach((x, item) => {
      if (seen.has(item)) return;
      const p = parseItem(item);
      const available = sum(x.whs, false), damaged = sum(x.whs, true);
      stats.added++; stats.goodAfter += available; stats.dmgAfter += damaged; stats.newItems.push(item);
      list.push({ id: '', date, warehouse: [...new Set(x.whs.filter((w) => !isDamaged(w.wh)).map((w) => w.wh.replace(/\s*-\s*NORMAL$/i, '')))].join(' + '), sku: '', productId: '',
        name: `${p.product} ${p.color}`.trim(), size: p.size, sizeKr: p.sizeKr, product: p.product, color: p.color, category: 'Lainnya', order: maxOrder + ++n,
        available, reserved: 0, damaged, note: item, whs: x.whs, uom: x.uom, updatedAt: at, updatedBy: by });
    });
    stats.changes.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
    return { list, stats };
  }

  // compact snapshot of one export for the stock history: [item, good, damaged, in, out]
  function snapshot(items) {
    const out = [];
    items.forEach((x, item) => {
      const sum = (pred, k) => x.whs.filter(pred).reduce((t, w) => t + (w[k] || 0), 0);
      const all = () => true;
      out.push([item, sum((w) => !isDamaged(w.wh), 'ending'), sum((w) => isDamaged(w.wh), 'ending'), sum(all, 'stockIn') + sum(all, 'otherIn'), sum(all, 'orderOut') + sum(all, 'otherOut')]);
    });
    return out;
  }

  return { parse, parseItem, dateFromName, apply, snapshot };
});
