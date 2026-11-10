// BALLOP admin: consignment (konsinyasi) at partner padel stores. Stock sent, returned, sold by the store,
// samples / sponsorship, what is still at the store per model × size, and how much the store has paid.
// Data comes from the partner workbooks in the "Ballop Offline" Drive folder (tools/import-consign.js).
(() => {
  const { $, $$, toast } = window.A;
  const B = window.Biz;
  const { esc, num, money, fmtDate, today } = B;
  const st = { partner: '' };
  try { Object.assign(st, JSON.parse(localStorage.getItem('ballopConsign') || '{}')); } catch {}
  const save = () => { try { localStorage.setItem('ballopConsign', JSON.stringify(st)); } catch {} };
  const COLORS = { White: '#9aa3ad', Black: '#15171c', Pink: '#e86fa0', Blue: '#2a78d6' };
  const sizeNum = (s) => parseFloat(String(s).replace(',', '.')) || 1e4;

  // totals of a list of movements
  function totals(rows) {
    const t = { kirim: 0, retur: 0, jual: 0, sample: 0, sponsor: 0, kirimV: 0, jualV: 0, paid: 0, unpaid: 0, last: '' };
    rows.forEach((r) => {
      t[r.type] += r.qty;
      if (r.type === 'kirim') t.kirimV += r.qty * r.price;
      if (r.type === 'retur') t.kirimV -= r.qty * r.price;
      if (r.type === 'jual') { const v = r.qty * r.price; t.jualV += v; if (r.payment === 'lunas') t.paid += v; else t.unpaid += v; }
      if (r.date > t.last) t.last = r.date;
    });
    t.sisa = t.kirim - t.retur - t.jual;
    t.sisaV = t.kirimV - t.jualV;
    t.sellThrough = t.kirim - t.retur ? t.jual / (t.kirim - t.retur) : NaN;
    return t;
  }
  // what is still at the store, per model (product + colour) × size
  function stockAt(rows) {
    const g = {};
    rows.filter((r) => ['kirim', 'retur', 'jual'].includes(r.type)).forEach((r) => {
      const k = `${r.product} · ${r.color}`;
      const m = g[k] = g[k] || { k, product: r.product, color: r.color, sizes: {}, sisa: 0, jual: 0 };
      const d = r.type === 'kirim' ? r.qty : -r.qty;
      m.sizes[r.size] = (m.sizes[r.size] || 0) + d; m.sisa += d; if (r.type === 'jual') m.jual += r.qty;
    });
    return Object.values(g).sort((a, b) => a.k.localeCompare(b.k));
  }
  const partners = () => {
    const by = {};
    (B.data.consign || []).forEach((r) => { (by[r.partner] = by[r.partner] || []).push(r); });
    return Object.entries(by).map(([name, rows]) => ({ name, rows, t: totals(rows) })).sort((a, b) => b.t.sisa - a.t.sisa);
  };
  const pctTxt = (x) => (Number.isFinite(x) ? `${(x * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–');

  function render() {
    const v = $('#view-consign');
    if (!v) return;
    const ps = partners();
    const all = totals(B.data.consign || []);
    if (st.partner && !ps.some((p) => p.name === st.partner)) st.partner = '';
    const P = ps.find((p) => p.name === st.partner);
    v.innerHTML = `
      <header class="bar"><div><h1>Konsinyasi</h1><p class="muted">Stok Ballop yang dititip di toko partner: dikirim, retur, terjual, sisa di toko per size, dan pembayaran. Sumber: file konsinyasi per toko di folder Drive "Ballop Offline".</p></div>
        <div class="bar-actions"><button class="btn sm btn-export" type="button" id="csgPdf">⬇ Export PDF</button></div></header>
      <div class="st-cards">
        <div class="st-card hero"><span>Sisa stok di toko partner</span><b>${num(all.sisa)} psg</b><small>nilai ${money(all.sisaV)} · ${num(ps.length)} toko</small></div>
        <div class="st-card"><span>Total dikirim</span><b>${num(all.kirim)}</b><small>retur ${num(all.retur)} psg</small></div>
        <div class="st-card"><span>Terjual di toko</span><b>${num(all.jual)}</b><small>${money(all.jualV)} · sell-through ${pctTxt(all.sellThrough)}</small></div>
        <div class="st-card"><span>Sudah dibayar</span><b>${money(all.paid)}</b><small>dari penjualan konsinyasi</small></div>
        <div class="st-card warn"><span>Belum dibayar</span><b>${money(all.unpaid)}</b><small>tagihan ke toko partner</small></div>
        <div class="st-card"><span>Sample & sponsorship</span><b>${num(all.sample + all.sponsor)}</b><small>sample ${num(all.sample)} · coach ${num(all.sponsor)}</small></div>
      </div>
      <section class="panel solid">
        <div class="panel-head"><h2>Per toko partner</h2><span class="muted small">klik toko untuk lihat stok per size & transaksi</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Toko</th><th class="num">Dikirim</th><th class="num">Retur</th><th class="num">Terjual</th><th class="num">Sell-through</th><th class="num">Sisa di toko</th><th class="num">Nilai sisa</th><th class="num">Sudah dibayar</th><th class="num">Belum dibayar</th><th class="num">Sample</th><th>Aktivitas terakhir</th></tr></thead>
          <tbody>${ps.map((p) => `<tr data-partner="${esc(p.name)}" style="cursor:pointer"${p.name === st.partner ? ' class="on"' : ''}><td><b>${esc(p.name)}</b></td><td class="num">${num(p.t.kirim)}</td><td class="num">${p.t.retur ? num(p.t.retur) : '–'}</td><td class="num">${num(p.t.jual)}</td><td class="num">${pctTxt(p.t.sellThrough)}</td><td class="num"><b>${num(p.t.sisa)}</b></td><td class="num">${money(p.t.sisaV)}</td><td class="num">${money(p.t.paid)}</td><td class="num">${p.t.unpaid ? `<span class="badge bad">${money(p.t.unpaid)}</span>` : '–'}</td><td class="num">${num(p.t.sample + p.t.sponsor)}</td><td>${fmtDate(p.t.last)}</td></tr>`).join('') || '<tr><td colspan="11" class="muted">Belum ada data konsinyasi.</td></tr>'}
          ${ps.length > 1 ? `<tr class="tot"><td>Total</td><td class="num">${num(all.kirim)}</td><td class="num">${num(all.retur)}</td><td class="num">${num(all.jual)}</td><td class="num">${pctTxt(all.sellThrough)}</td><td class="num">${num(all.sisa)}</td><td class="num">${money(all.sisaV)}</td><td class="num">${money(all.paid)}</td><td class="num">${money(all.unpaid)}</td><td class="num">${num(all.sample + all.sponsor)}</td><td></td></tr>` : ''}</tbody>
        </table></div>
      </section>
      ${P ? partnerDetail(P) : '<p class="muted small">Pilih toko di tabel untuk melihat detail stok per size, penjualan, dan pembayaran.</p>'}`;
    $$('[data-partner]', v).forEach((tr) => tr.addEventListener('click', () => { st.partner = st.partner === tr.dataset.partner ? '' : tr.dataset.partner; save(); render(); }));
    $('#csgPdf').addEventListener('click', () => consignPdf(P));
  }

  function partnerDetail(P) {
    const stock = stockAt(P.rows);
    const sizes = [...new Set(stock.flatMap((m) => Object.keys(m.sizes)))].sort((a, b) => sizeNum(a) - sizeNum(b));
    const sales = P.rows.filter((r) => r.type === 'jual').sort((a, b) => b.date.localeCompare(a.date));
    const moves = P.rows.filter((r) => ['kirim', 'retur'].includes(r.type));
    const ship = {};
    moves.forEach((r) => { const k = `${r.date}|${r.type}|${r.ref}`; const x = ship[k] = ship[k] || { date: r.date, type: r.type, ref: r.ref, qty: 0, v: 0, note: r.note }; x.qty += r.qty; x.v += r.qty * r.price; });
    const extra = P.rows.filter((r) => ['sample', 'sponsor'].includes(r.type));
    return `
      <div class="sec-head" style="--sec:#0e8a8a;margin-top:6px"><div><h2>${esc(P.name)}</h2><p>Sisa ${num(P.t.sisa)} psg di toko (${money(P.t.sisaV)}) · terjual ${num(P.t.jual)} psg · belum dibayar ${money(P.t.unpaid)}</p></div></div>
      <section class="panel solid">
        <div class="panel-head"><h2>Sisa stok di toko per size</h2><span class="muted small">dikirim − retur − terjual</span></div>
        <div class="table-wrap"><table class="data csg-mx">
          <thead><tr><th>Model</th>${sizes.map((s) => `<th class="num">${esc(s)}</th>`).join('')}<th class="num">Sisa</th><th class="num">Terjual</th></tr></thead>
          <tbody>${stock.map((m) => `<tr><td><span class="ch"><i style="background:${COLORS[m.color] || '#888'}"></i>${esc(m.product)} · ${esc(m.color)}</span></td>${sizes.map((s) => { const q = m.sizes[s]; return `<td class="num${q === 0 ? ' z' : ''}">${q === undefined ? '' : num(q)}</td>`; }).join('')}<td class="num"><b>${num(m.sisa)}</b></td><td class="num">${num(m.jual)}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      <div class="grid-3">
        <section class="panel solid"><div class="panel-head"><h2>Penjualan & pembayaran</h2><span class="muted small">${num(sales.length)} transaksi</span></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Tanggal</th><th>Produk</th><th class="num">Qty</th><th class="num">Nilai</th><th>Status</th></tr></thead>
          <tbody>${sales.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.product)} ${esc(r.color)} · ${esc(r.size)}<br><small class="muted">${esc(r.ref || '')}</small></td><td class="num">${num(r.qty)}</td><td class="num">${money(r.qty * r.price)}</td><td>${r.payment === 'lunas' ? `<span class="badge live">Lunas${r.paidDate ? ` · ${fmtDate(r.paidDate)}` : ''}</span>` : '<span class="badge bad">Belum</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Belum ada penjualan.</td></tr>'}</tbody></table></div>
        </section>
        <section class="panel solid"><div class="panel-head"><h2>Pengiriman & retur</h2><span class="muted small">per surat jalan</span></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Tanggal</th><th>Jenis</th><th>Surat jalan</th><th class="num">Qty</th><th class="num">Nilai</th></tr></thead>
          <tbody>${Object.values(ship).sort((a, b) => b.date.localeCompare(a.date)).map((x) => `<tr><td>${fmtDate(x.date)}</td><td>${x.type === 'kirim' ? '<span class="badge">Kirim</span>' : '<span class="badge warn">Retur</span>'}</td><td>${esc(x.ref || '–')}</td><td class="num">${num(x.qty)}</td><td class="num">${money(x.v)}</td></tr>`).join('')}</tbody></table></div>
        </section>
      </div>
      ${extra.length ? `<section class="panel solid"><div class="panel-head"><h2>Sample & sponsorship</h2><span class="muted small">tidak dihitung di stok konsinyasi</span></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Tanggal</th><th>Jenis</th><th>Produk</th><th class="num">Size</th><th class="num">Qty</th><th>Keterangan</th></tr></thead>
        <tbody>${extra.sort((a, b) => b.date.localeCompare(a.date)).map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${r.type === 'sponsor' ? 'Sponsorship coach' : 'Sample'}</td><td>${esc(r.product)} ${esc(r.color)}</td><td class="num">${esc(r.size)}</td><td class="num">${num(r.qty)}</td><td>${esc(r.note || '')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
  }

  // PDF (English): all partners, plus the size matrix of the selected partner
  function consignPdf(sel) {
    const R = window.PdfReport;
    const ps = partners(), all = totals(B.data.consign || []);
    const pc = (x) => R.pct(x);
    const detail = (P) => {
      const stock = stockAt(P.rows);
      const sizes = [...new Set(stock.flatMap((m) => Object.keys(m.sizes)))].sort((a, b) => sizeNum(a) - sizeNum(b));
      const sales = P.rows.filter((r) => r.type === 'jual').sort((a, b) => a.date.localeCompare(b.date));
      return `<div class="avoid">${R.h2(`${esc(P.name)} · stock at store by size`, `${R.num(P.t.sisa)} pairs · ${R.rp(P.t.sisaV)}`)}
        ${R.table([['Model'], ...sizes.map((s) => [esc(s), 1]), ['Left', 1], ['Sold', 1]], stock.map((m) => [`${R.dot(COLORS[m.color] || '#888')}${esc(m.product)} · ${esc(m.color)}`, ...sizes.map((s) => (m.sizes[s] === undefined ? '' : R.num(m.sizes[s]))), `<b>${R.num(m.sisa)}</b>`, R.num(m.jual)]))}</div>
        ${R.h2(`${esc(P.name)} · sales &amp; payment`, `${R.num(sales.length)} sales`)}
        ${R.table([['Date'], ['Invoice'], ['Product'], ['Size', 1], ['Qty', 1], ['Amount', 1], ['Status']], sales.map((r) => [R.longDate(r.date), esc(r.ref || '–'), `${esc(r.product)} ${esc(r.color)}`, esc(r.size), R.num(r.qty), R.rp(r.qty * r.price), r.payment === 'lunas' ? `<span class="chip ok">Paid${r.paidDate ? ` · ${R.longDate(r.paidDate)}` : ''}</span>` : '<span class="chip bad">Unpaid</span>']), null, 'No sales yet.')}`;
    };
    const body = `
      ${R.h2('Consignment summary', `${R.num(ps.length)} partner stores`)}
      ${R.tiles([
        R.tile('Stock at partner stores', `${R.num(all.sisa)} pairs`, `value ${R.rp(all.sisaV)}`, true),
        R.tile('Sent', R.num(all.kirim), `returned ${R.num(all.retur)}`),
        R.tile('Sold by stores', R.num(all.jual), `${R.rp(all.jualV)} · sell-through ${pc(all.sellThrough)}`),
        R.tile('Unpaid', R.rp(all.unpaid), `paid ${R.rp(all.paid)}`),
      ])}
      ${R.h2('By partner store')}
      ${R.table([['Store'], ['Sent', 1], ['Returned', 1], ['Sold', 1], ['Sell-through', 1], ['At store', 1], ['Stock value', 1], ['Paid', 1], ['Unpaid', 1], ['Samples', 1]],
        ps.map((p) => [`<b>${esc(p.name)}</b>`, R.num(p.t.kirim), R.num(p.t.retur), R.num(p.t.jual), pc(p.t.sellThrough), `<b>${R.num(p.t.sisa)}</b>`, R.rp(p.t.sisaV), R.rp(p.t.paid), p.t.unpaid ? `<span class="chip bad">${R.rp(p.t.unpaid)}</span>` : '–', R.num(p.t.sample + p.t.sponsor)]),
        ['Total', R.num(all.kirim), R.num(all.retur), R.num(all.jual), pc(all.sellThrough), R.num(all.sisa), R.rp(all.sisaV), R.rp(all.paid), R.rp(all.unpaid), R.num(all.sample + all.sponsor)])}
      ${(sel ? [sel] : ps).map(detail).join('')}`;
    R.open({ title: sel ? `Consignment Report · ${sel.name}` : 'Consignment Report', period: `as of ${R.longDate(today())}`,
      meta: [['Stores', esc(sel ? sel.name : ps.map((p) => p.name).join(', '))], ['Data', 'partner consignment workbooks']],
      body, note: 'At store = sent − returned − sold. Stock value at consignment price. Samples &amp; coach sponsorship are not counted as consignment stock.' });
  }

  // ---------- Stock offline: only what is physically at each partner store (no sales / payments) ----------
  const sst = { store: 'all' };
  function renderStock() {
    const v = $('#view-stockoff');
    if (!v) return;
    const ps = partners().map((p) => ({ ...p, stock: stockAt(p.rows) }));
    if (sst.store !== 'all' && !ps.some((p) => p.name === sst.store)) sst.store = 'all';
    const shown = sst.store === 'all' ? ps : ps.filter((p) => p.name === sst.store);
    // models × sizes summed over the shown stores
    const g = {};
    shown.forEach((p) => p.stock.forEach((m) => { const x = g[m.k] = g[m.k] || { ...m, sizes: {}, sisa: 0 }; Object.entries(m.sizes).forEach(([s, q]) => { x.sizes[s] = (x.sizes[s] || 0) + q; }); x.sisa += m.sisa; }));
    const models = Object.values(g).sort((a, b) => a.k.localeCompare(b.k));
    const sizes = [...new Set(models.flatMap((m) => Object.keys(m.sizes)))].sort((a, b) => sizeNum(a) - sizeNum(b));
    const tot = models.reduce((t, m) => t + m.sisa, 0);
    const empty = models.reduce((t, m) => t + Object.values(m.sizes).filter((q) => q <= 0).length, 0);
    const samples = shown.reduce((t, p) => t + p.t.sample, 0);
    v.innerHTML = `
      <header class="bar"><div><h1>Stock offline</h1><p class="muted">Stok Ballop yang ada di toko partner (konsinyasi) per model dan size. Sisa = dikirim − retur − terjual.</p></div></header>
      <div class="st-cards">
        <div class="st-card hero"><span>Total stok di toko</span><b>${num(tot)} psg</b><small>${num(shown.length)} toko · ${num(models.length)} model</small></div>
        ${ps.slice(0, 5).map((p) => `<div class="st-card"><span>${esc(p.name)}</span><b>${num(p.t.sisa)}</b><small>psg di toko</small></div>`).join('')}
      </div>
      <section class="panel solid">
        <div class="panel-head"><h2>Stok per size</h2>
          <span class="seg glass">${[['all', 'Semua toko'], ...ps.map((p) => [p.name, p.name])].map(([k, l]) => `<button type="button" data-sto="${esc(k)}" class="${sst.store === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</span></div>
        <div class="table-wrap"><table class="data csg-mx">
          <thead><tr><th>Model</th>${sizes.map((s) => `<th class="num">${esc(s)}</th>`).join('')}<th class="num">Total</th></tr></thead>
          <tbody>${models.map((m) => `<tr><td><span class="ch"><i style="background:${COLORS[m.color] || '#888'}"></i>${esc(m.product)} · ${esc(m.color)}</span></td>${sizes.map((s) => { const q = m.sizes[s]; return `<td class="num${q === 0 ? ' z' : ''}">${q === undefined ? '' : num(q)}</td>`; }).join('')}<td class="num"><b>${num(m.sisa)}</b></td></tr>`).join('') || '<tr><td class="muted">Belum ada stok.</td></tr>'}
          <tr class="tot"><td>Total</td>${sizes.map((s) => `<td class="num">${num(models.reduce((t, m) => t + (m.sizes[s] || 0), 0))}</td>`).join('')}<td class="num">${num(tot)}</td></tr></tbody>
        </table></div>
        <p class="muted small" style="margin:8px 2px 0">Angka merah = size sudah habis di toko (${num(empty)} size). Sample display (${num(samples)} psg) tidak dihitung.</p>
      </section>
      ${sst.store === 'all' ? `<section class="panel solid"><div class="panel-head"><h2>Stok per toko</h2></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Toko</th>${[...new Set(ps.flatMap((p) => p.stock.map((m) => m.k)))].sort().map((k) => `<th class="num">${esc(k.replace(/^Ballop Padel Pulse · /, 'Pulse '))}</th>`).join('')}<th class="num">Total</th></tr></thead>
        <tbody>${(() => { const ks = [...new Set(ps.flatMap((p) => p.stock.map((m) => m.k)))].sort(); return ps.map((p) => `<tr><td><b>${esc(p.name)}</b></td>${ks.map((k) => { const m = p.stock.find((x) => x.k === k); return `<td class="num">${m ? num(m.sisa) : '–'}</td>`; }).join('')}<td class="num"><b>${num(p.t.sisa)}</b></td></tr>`).join(''); })()}</tbody></table></div></section>` : ''}`;
    $$('[data-sto]', v).forEach((b) => b.addEventListener('click', () => { sst.store = b.dataset.sto; renderStock(); }));
  }
  B.registerView('stockoff', renderStock);
  B.registerView('consign', render);
  window.Consign = { render, renderStock, pdf: consignPdf, totals };
  document.addEventListener('admin:data', () => { if (!$('#view-consign')?.hidden) render(); });
})();
