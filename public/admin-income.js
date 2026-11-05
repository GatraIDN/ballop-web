// BALLOP admin: marketplace income, per channel. An income row is a finished order whose money already reached
// the seller wallet, after every fee. Shows the payout, the full fee breakdown, per month and per order.
(() => {
  const { $, $$ } = window.A;
  const B = window.Biz;
  const { esc, num, money, pct, fmtDate, today, toCsv, SALES_CH } = B;
  const MI = window.MarketImport;

  const CHANNELS = ['all', 'shopee', 'tiktok', 'tokopedia'];
  const chLabel = (c) => (c === 'all' ? 'Semua marketplace' : SALES_CH[c].label);
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const st = { ch: 'all', range: 'mtd', from: '', to: '', q: '', limit: 150, open: '' };
  const day = (s) => s.releaseDate || s.date || '';

  // {column: amount}; older rows (TikTok / ops sheet) only carry the summed fields
  function detailOf(s) {
    if (s.detail && Object.keys(s.detail).length) return s.detail;
    const d = {};
    const put = (k, v) => { if (v) d[k] = -Math.abs(v); };
    put('Biaya admin / komisi platform', s.adminFee);
    put('Biaya layanan', s.serviceFee);
    put('Komisi afiliasi', s.affiliateFee);
    const rest = Math.abs(s.fees || 0) - Math.abs(s.adminFee || 0) - Math.abs(s.serviceFee || 0) - Math.abs(s.affiliateFee || 0);
    if (rest > 1) d['Biaya marketplace lainnya'] = -rest;
    if (s.shipping) d['Ongkir (netto)'] = s.shipping;
    if (s.refund) d['Pengembalian dana ke pembeli'] = -Math.abs(s.refund);
    if (s.sellerDiscount) d['Voucher / diskon penjual'] = -Math.abs(s.sellerDiscount);
    return d;
  }
  // totals of a set of income rows: groups -> {total, lines: {column: amount}}
  function sum(rows) {
    const t = { payout: 0, price: 0, fees: 0, orders: 0, groups: {} };
    rows.forEach((s) => {
      t.payout += s.payout || 0;
      if (s.type !== 'Penyesuaian') { t.price += s.productPrice || 0; t.orders++; }
      Object.entries(detailOf(s)).forEach(([k, v]) => {
        const g = s.type === 'Penyesuaian' ? 'Penyesuaian' : MI.feeGroup(k);
        const x = t.groups[g] = t.groups[g] || { total: 0, lines: {} };
        x.total += v; x.lines[k] = (x.lines[k] || 0) + v;
        if (!MI.NOT_FEES.includes(g)) t.fees += v;
      });
    });
    return t;
  }
  const g = (t, name) => t.groups[name]?.total || 0;

  // ---------- RRP → ASP → … → NMV ----------
  // RRP comes from the order export (price before any discount), matched by order number; ASP = product price on the
  // income row (after the seller's discount). Subsidi = platform-funded discount, voucher = seller-funded voucher/cashback,
  // ongkir = net shipping we bear, MP fee = every marketplace fee except affiliate, NMV = money released to the wallet.
  const AFF = /affiliate|afiliasi|komisi ams/i;
  const TOPUP = 'Biaya Isi Saldo Otomatis (dari Penghasilan)';
  let rrpIdx = null, rrpLen = -1;
  const rrpOf = () => {
    if (rrpLen !== B.data.orders.length) {
      rrpIdx = new Map();
      B.data.orders.forEach((o) => { if (o.state === 'cancelled') return; rrpIdx.set(o.orderId, (rrpIdx.get(o.orderId) || 0) + (o.gross || o.unitPrice * o.qty || o.net || 0)); });
      rrpLen = B.data.orders.length;
    }
    return rrpIdx;
  };
  function kpis(rows) {
    const idx = rrpOf();
    const k = { rrp: 0, asp: 0, subsidi: 0, voucher: 0, ongkir: 0, refund: 0, aff: 0, topup: 0, adj: 0, mp: 0, nmv: 0, orders: 0, matched: 0, mpLines: {}, affLines: {} };
    rows.forEach((x) => {
      k.nmv += x.payout || 0;
      if (x.type === 'Penyesuaian') { k.adj += x.payout || 0; return; }
      k.orders++; k.asp += x.productPrice || 0;
      const o = idx.get(x.orderId);
      if (o) { k.rrp += o; k.matched++; } else k.rrp += x.productPrice || 0;
      Object.entries(detailOf(x)).forEach(([key, v]) => {
        const grp = MI.feeGroup(key);
        if (key === TOPUP) k.topup -= v;
        else if (grp === 'Voucher & subsidi') { if (v > 0) k.subsidi += v; else k.voucher -= v; }
        else if (grp === 'Biaya pengiriman') k.ongkir -= v;
        else if (grp === 'Pengembalian dana') k.refund -= v;
        else if (AFF.test(key)) { k.aff -= v; k.affLines[key] = (k.affLines[key] || 0) - v; }
        else { k.mp -= v; k.mpLines[key] = (k.mpLines[key] || 0) - v; }
      });
    });
    k.disc = k.rrp - k.asp; k.discPct = k.rrp ? k.disc / k.rrp : NaN;
    k.mpPct = k.asp + k.subsidi ? k.mp / (k.asp + k.subsidi) : NaN;
    // what the parts add up to; any gap means an unmapped column (should stay 0)
    k.gap = k.nmv - (k.asp + k.subsidi - k.voucher - k.ongkir - k.mp - k.aff - k.topup - k.refund + k.adj);
    return k;
  }
  const FEE_NAME = { 'Biaya Administrasi (termasuk PPN 11%)': 'Biaya administrasi', 'Platform commission fee': 'Komisi platform', 'Dynamic commission': 'Komisi dinamis', 'Mall service fee': 'Biaya layanan Mall', 'Order processing fee': 'Biaya proses pesanan', 'Biaya Proses Pesanan': 'Biaya proses pesanan', 'Biaya Pembayaran': 'Biaya pembayaran', 'Biaya Transaksi': 'Biaya transaksi', 'Growth Xtra Program service fee': 'Growth Xtra', 'Growth Xtra Program Super service fee': 'Growth Xtra Super', 'Article 22 Income Tax withheld': 'PPh 22', 'Biaya Layanan Promo XTRA': 'Promo XTRA', 'Biaya Layanan Shopee Video XTRA': 'Shopee Video XTRA' };
  // fee lines with the same meaning on Shopee and TikTok are shown as one card
  const feeName = (key) => (/^Biaya Gratis Ongkir XTRA/i.test(key) ? 'Gratis Ongkir XTRA' : FEE_NAME[key] || key);
  const mpCards = (k) => { const m = {}; Object.entries(k.mpLines).forEach(([key, v]) => { const n = feeName(key); m[n] = (m[n] || 0) + v; }); return Object.entries(m).filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => b[1] - a[1]); };
  const kcard = (label, value, sub = '', cls = '') => `<div class="sum-card solid${cls ? ` ${cls}` : ''}"><div class="k-label">${label}</div><div class="k-value">${value}</div><div class="k-sub">${sub}</div></div>`;
  const kpiCards = (k) => `
      <div class="sum-cards inc-kpis">
        ${kcard('RRP', money(k.rrp), `harga sebelum diskon${k.orders && k.matched < k.orders ? ` · ${num(k.orders - k.matched)} pesanan tanpa file order (pakai ASP)` : ''}`)}
        ${kcard('ASP', money(k.asp), 'harga setelah diskon')}
        ${kcard('Discount amount', money(k.disc), 'RRP − ASP')}
        ${kcard('Discount (%)', pct(k.discPct), 'dari RRP')}
        ${kcard('Subsidi', money(k.subsidi), 'ditanggung marketplace')}
        ${kcard('Ongkir', money(k.ongkir), 'netto ditanggung penjual')}
        ${kcard('Voucher', k.voucher ? money(k.voucher) : '–', 'voucher & cashback penjual')}
        ${kcard('MP fee', money(k.mp), 'semua fee marketplace', 'neg')}
        ${kcard('Komisi affiliate', money(k.aff), Object.keys(k.affLines).length ? esc(Object.keys(k.affLines).map(feeName).join(', ')) : 'AMS / affiliate')}
        ${kcard('MP (%)', pct(k.mpPct), 'MP fee ÷ (ASP + subsidi)')}
        ${kcard('NMV', money(k.nmv), `penghasilan bersih · ${num(k.orders)} pesanan`, 'hero')}
        ${k.refund ? kcard('Refund', money(k.refund), 'dikembalikan ke pembeli') : ''}
        ${k.topup ? kcard('Top-up saldo iklan', money(k.topup), 'dipotong dari penghasilan') : ''}
        ${k.adj ? kcard('Penyesuaian', money(k.adj), 'kompensasi / koreksi') : ''}
        ${Math.abs(k.gap) >= 1 ? kcard('Lainnya', money(k.gap), 'kolom yang belum terpetakan') : ''}
      </div>
      <div class="panel solid inc-fees"><div class="panel-head"><h2>Rincian MP fee</h2><span class="muted small">${money(k.mp)} · % dari ASP</span></div>
        <div class="inc-fee-grid">${mpCards(k).map(([n, v]) => `<div class="inc-fee"><span>${esc(n)}</span><b>${money(v)}</b><small>${k.asp ? pct(v / k.asp) : '–'} dari ASP · ${k.mp ? pct(v / k.mp) : '–'} dari MP fee</small><i style="width:${k.mp ? Math.min(100, (v / k.mp) * 100) : 0}%"></i></div>`).join('') || '<p class="muted">Tidak ada fee di periode ini.</p>'}</div>
      </div>`;
  const signed = (v) => `<span style="color:${v < 0 ? 'var(--danger)' : v > 0 ? 'var(--ok, #1baf7a)' : 'inherit'}">${v > 0 ? '+' : ''}${money(v)}</span>`;

  function render() {
    const v = $('#view-income');
    const all = B.data.settlements;
    const chRows = all.filter((s) => CHANNELS.includes(s.channel) && (st.ch === 'all' || s.channel === st.ch));
    const r = B.periodOf(st);
    const inP = (s) => st.range === 'all' || (day(s) >= r.from && day(s) <= r.to);
    let rows = chRows.filter(inP);
    const t = sum(rows);
    const K = kpis(rows);
    if (st.q) { const q = st.q.toLowerCase(); rows = rows.filter((s) => `${s.orderId} ${(s.items || []).map((x) => x.name).join(' ')} ${s.courier} ${s.payment} ${s.note}`.toLowerCase().includes(q)); }
    rows.sort((a, b) => day(b).localeCompare(day(a)) || b.orderId.localeCompare(a.orderId));
    const share = (x) => (t.price ? pct(Math.abs(x) / t.price) : '–');

    // breakdown table: product price, each group with its columns, then payout
    const groups = MI.GROUP_ORDER.filter((n) => t.groups[n]);
    const breakdown = `
      <tr><td><b>GMV kotor</b></td><td class="num"><b>${money(t.price)}</b></td><td class="num muted">100%</td></tr>
      ${groups.map((n) => `<tr style="background:var(--soft, rgba(0,0,0,.03))"><td><b>${esc(n)}</b>${MI.NOT_FEES.includes(n) ? '' : ' <span class="badge warn" style="font-size:10px">fee</span>'}</td><td class="num"><b>${signed(t.groups[n].total)}</b></td><td class="num">${share(t.groups[n].total)}</td></tr>
        ${Object.entries(t.groups[n].lines).sort((a, b) => a[1] - b[1]).map(([k, x]) => `<tr><td style="padding-left:26px" class="muted">${esc(k)}</td><td class="num">${signed(x)}</td><td class="num muted">${share(x)}</td></tr>`).join('')}`).join('')}
      <tr><td><b>Penghasilan bersih</b></td><td class="num"><b>${money(t.payout)}</b></td><td class="num"><b>${share(t.payout)}</b></td></tr>`;

    const byMonth = [...new Set(rows.map((s) => day(s).slice(0, 7)).filter(Boolean))].sort().reverse().map((m) => [m, sum(rows.filter((s) => day(s).startsWith(m)))]);
    const tabs = CHANNELS.map((c) => { const n = all.filter((s) => (c === 'all' ? CHANNELS.includes(s.channel) : s.channel === c) && s.type !== 'Penyesuaian').length; return `<button class="btn sm${st.ch === c ? ' primary' : ''}" type="button" data-ch="${c}">${chLabel(c)} <span class="muted small">${num(n)}</span></button>`; }).join('');
    const prod = (s) => (s.items || []).map((x) => x.name.split(/\s+[–|-]\s+/)[0]).join(', ') || (s.type === 'Penyesuaian' ? (s.note || Object.keys(s.detail || {})[0] || 'Penyesuaian') : '–');

    v.innerHTML = `
      <header class="bar"><div><h1>Income data</h1><p class="muted">Pesanan yang sudah selesai dan penghasilannya sudah masuk ke saldo penjual, setelah dipotong semua biaya. Beda dengan order (pesanan masuk). Tanggal = tanggal dana dilepaskan. Import file Income di menu Order data.</p></div></header>
      <div style="margin-top:16px">${B.rangeBar(st)}</div>
      <div class="filters-row">${tabs}<span class="spacer"></span>
        <input type="search" data-i="q" placeholder="Cari no. pesanan / produk…" value="${esc(st.q)}">
        <button class="btn sm btn-export" type="button" id="incPdf">⬇ Export PDF</button><button class="btn sm" type="button" id="incExport">CSV</button>
      </div>
      ${chRows.length ? `
      ${kpiCards(K)}
      <div class="sum-cards" hidden>
        <div class="sum-card solid"><div class="k-label">Penghasilan bersih</div><div class="k-value">${money(t.payout)}</div><div class="k-sub">${num(t.orders)} pesanan selesai · ${share(t.payout)} dari GMV kotor</div></div>
        <div class="sum-card solid"><div class="k-label">GMV kotor</div><div class="k-value">${money(t.price)}</div><div class="k-sub">sebelum voucher & potongan</div></div>
        <div class="sum-card solid"><div class="k-label">Total fee marketplace</div><div class="k-value" style="color:var(--danger)">${money(Math.abs(t.fees))}</div><div class="k-sub">${share(t.fees)} dari GMV kotor</div></div>
        <div class="sum-card solid"><div class="k-label">Voucher penjual · ongkir</div><div class="k-value">${money(Math.abs(g(t, 'Voucher & subsidi')))}</div><div class="k-sub">ongkir netto ${money(g(t, 'Biaya pengiriman'))}</div></div>
        <div class="sum-card solid"><div class="k-label">Refund · penyesuaian</div><div class="k-value">${money(g(t, 'Pengembalian dana'))}</div><div class="k-sub">penyesuaian ${money(g(t, 'Penyesuaian'))}</div></div>
      </div>
      <div class="grid-3" style="margin-top:0">
        <section class="panel solid"><div class="panel-head"><h2>Rincian potongan</h2><span class="muted small">% dari GMV kotor</span></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Komponen</th><th class="num">Jumlah</th><th class="num">%</th></tr></thead><tbody>${breakdown}</tbody></table></div>
        </section>
        <section class="panel solid"><div class="panel-head"><h2>Per bulan</h2><span class="muted small">tanggal penghasilan masuk</span></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Bulan</th><th class="num">Pesanan</th><th class="num">GMV kotor</th><th class="num">Voucher</th><th class="num">Ongkir</th><th class="num">Fee</th><th class="num">Fee %</th><th class="num">Penghasilan bersih</th></tr></thead>
          <tbody>${byMonth.map(([m, x]) => `<tr><td>${monthLabel(m)}</td><td class="num">${num(x.orders)}</td><td class="num">${money(x.price)}</td><td class="num">${money(g(x, 'Voucher & subsidi'))}</td><td class="num">${money(g(x, 'Biaya pengiriman'))}</td><td class="num">${money(x.fees)}</td><td class="num">${x.price ? pct(Math.abs(x.fees) / x.price) : '–'}</td><td class="num"><b>${money(x.payout)}</b></td></tr>`).join('')}</tbody></table></div>
        </section>
      </div>
      <section class="panel solid" style="margin-top:14px">
        <div class="panel-head"><h2>Daftar income</h2><span class="muted small">${num(rows.length)} baris · klik untuk rincian fee</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Penghasilan bersih</th><th>Tgl pesanan</th><th>No. pesanan</th>${st.ch === 'all' ? '<th>Channel</th>' : ''}<th>Produk</th><th class="num">GMV kotor</th><th class="num">Voucher</th><th class="num">Ongkir</th><th class="num">Fee</th><th class="num">Penghasilan bersih</th></tr></thead>
          <tbody>${rows.slice(0, st.limit).map((s) => { const x = sum([s]); const open = st.open === s.key; return `<tr data-k="${esc(s.key)}" style="cursor:pointer"><td>${day(s) ? fmtDate(day(s)) : '–'}</td><td>${s.date && s.type !== 'Penyesuaian' ? fmtDate(s.date) : '–'}</td><td><button class="raw-link" type="button" data-raw="settlements" data-key="${esc(s.key)}">${esc(s.orderId)}</button>${s.type === 'Penyesuaian' ? ' <span class="badge warn">penyesuaian</span>' : ''}${g(x, 'Pengembalian dana') ? ' <span class="badge bad">refund</span>' : ''}</td>${st.ch === 'all' ? `<td>${B.chBadge(SALES_CH, s.channel)}</td>` : ''}<td title="${esc(prod(s))}">${esc(prod(s).length > 40 ? `${prod(s).slice(0, 38)}…` : prod(s))}</td><td class="num">${money(s.productPrice)}</td><td class="num">${money(g(x, 'Voucher & subsidi'))}</td><td class="num">${money(g(x, 'Biaya pengiriman'))}</td><td class="num">${money(x.fees)}</td><td class="num"><b>${money(s.payout)}</b></td></tr>${open ? `<tr><td colspan="${st.ch === 'all' ? 10 : 9}" style="background:var(--soft, rgba(0,0,0,.03))"><div class="small" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:4px 18px">${Object.entries(detailOf(s)).map(([k, a]) => `<div style="display:flex;justify-content:space-between;gap:8px"><span class="muted">${esc(k)}</span>${signed(a)}</div>`).join('')}${s.payment ? `<div style="display:flex;justify-content:space-between"><span class="muted">Pembayaran pembeli</span><span>${esc(s.payment)}</span></div>` : ''}${s.courier ? `<div style="display:flex;justify-content:space-between"><span class="muted">Kurir</span><span>${esc(s.courier)}</span></div>` : ''}</div></td></tr>` : ''}`; }).join('') || `<tr><td colspan="${st.ch === 'all' ? 10 : 9}" class="muted" style="text-align:center;padding:30px">Tidak ada income di filter ini.</td></tr>`}</tbody>
        </table></div>
        ${rows.length > st.limit ? '<p style="text-align:center"><button class="btn sm" type="button" id="incMore">Tampilkan lebih banyak</button></p>' : ''}
      </section>` : `<section class="panel solid"><p class="muted" style="text-align:center;padding:30px">Belum ada income ${chLabel(st.ch)}. Import file Income di menu Order data.</p></section>`}`;

    $$('[data-ch]', v).forEach((b) => b.addEventListener('click', () => { st.ch = b.dataset.ch; st.limit = 150; st.open = ''; render(); }));
    $$('[data-i]', v).forEach((el) => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
      st[el.dataset.i] = el.value; st.limit = 150;
      if (el.tagName === 'INPUT') { clearTimeout(st.t); st.t = setTimeout(render, 250); } else render();
    }));
    B.bindRangeBar(v, st, render);
    window.RawPopup.bind(v);
    $$('tr[data-k]', v).forEach((tr) => tr.addEventListener('click', () => { st.open = st.open === tr.dataset.k ? '' : tr.dataset.k; render(); }));
    $('#incMore')?.addEventListener('click', () => { st.limit += 300; render(); });
    $('#incPdf').addEventListener('click', () => {
      const R = window.PdfReport;
      const byDay = [...new Set(rows.map((s) => day(s)).filter(Boolean))].sort().map((d) => [d, sum(rows.filter((s) => day(s) === d))]);
      const body = `
        ${R.h2(`Ringkasan income · ${esc(chLabel(st.ch))}`)}
        ${R.tiles([
          R.tile('RRP', R.rp(K.rrp), 'harga sebelum diskon'),
          R.tile('ASP', R.rp(K.asp), 'harga setelah diskon'),
          R.tile('Discount', R.rp(K.disc), `${pct(K.discPct)} dari RRP`),
          R.tile('Subsidi', R.rp(K.subsidi), 'ditanggung marketplace'),
          R.tile('Ongkir', R.rp(K.ongkir), 'netto ditanggung penjual'),
          R.tile('Voucher', K.voucher ? R.rp(K.voucher) : '–', 'voucher & cashback penjual'),
          R.tile('MP fee', R.rp(K.mp), `${pct(K.mpPct)} dari ASP + subsidi`),
          R.tile('Komisi affiliate', R.rp(K.aff)),
          ...(K.refund ? [R.tile('Refund', R.rp(K.refund))] : []),
          ...(K.topup ? [R.tile('Top-up saldo iklan', R.rp(K.topup))] : []),
          ...(K.adj ? [R.tile('Penyesuaian', R.rp(K.adj))] : []),
          R.tile('NMV', R.rp(K.nmv), `penghasilan bersih · ${num(K.orders)} pesanan`, true),
        ], 4)}
        ${R.h2('Rincian MP fee', `${R.rp(K.mp)} · ${pct(K.mpPct)} dari ASP + subsidi`)}
        ${R.table([['Jenis fee'], ['Jumlah', 1], ['% dari ASP', 1], ['% dari MP fee', 1]], mpCards(K).map(([n, x]) => [esc(n), R.rp(x), K.asp ? pct(x / K.asp) : '–', K.mp ? pct(x / K.mp) : '–']), ['Total MP fee', R.rp(K.mp), K.asp ? pct(K.mp / K.asp) : '–', '100%'])}
        ${st.ch === 'all' ? `${R.h2('Per channel')}${R.table([['Channel'], ['Pesanan', 1], ['GMV kotor', 1], ['Fee', 1], ['Fee %', 1], ['Penghasilan bersih', 1]],
          CHANNELS.filter((c) => c !== 'all').map((c) => [c, sum(rows.filter((x) => x.channel === c))]).filter(([, x]) => x.orders || x.payout).map(([c, x]) => [`${R.dot(SALES_CH[c].color)}${SALES_CH[c].label}`, num(x.orders), R.rp(x.price), R.rp(Math.abs(x.fees)), x.price ? pct(Math.abs(x.fees) / x.price) : '–', `<b>${R.rp(x.payout)}</b>`]),
          ['Total', num(t.orders), R.rp(t.price), R.rp(Math.abs(t.fees)), share(t.fees), R.rp(t.payout)])}` : ''}
        <div class="two">
          <div>${R.h2('Rincian potongan', '% dari GMV kotor')}
            ${R.table([['Komponen'], ['Jumlah', 1], ['%', 1]], [['<b>GMV kotor</b>', `<b>${R.rp(t.price)}</b>`, '100%'], ...groups.map((n) => [`${esc(n)}${MI.NOT_FEES.includes(n) ? '' : ' <span class="chip warn">fee</span>'}`, R.rp(t.groups[n].total), share(t.groups[n].total)])], ['Penghasilan bersih', R.rp(t.payout), share(t.payout)])}</div>
          <div>${R.h2('Per bulan', 'tanggal penghasilan masuk')}
            ${R.table([['Bulan'], ['Pesanan', 1], ['GMV kotor', 1], ['Fee', 1], ['Penghasilan bersih', 1]], byMonth.map(([m, x]) => [monthLabel(m), num(x.orders), R.rp(x.price), R.rp(Math.abs(x.fees)), `<b>${R.rp(x.payout)}</b>`]))}</div>
        </div>
        ${R.h2('Income per tanggal', 'akumulasi per tanggal penghasilan masuk')}
        ${R.table([['Tanggal'], ['Pesanan', 1], ['GMV kotor', 1], ['Fee', 1], ['Fee %', 1], ['Refund · penyesuaian', 1], ['Penghasilan bersih', 1]],
          byDay.map(([d, x]) => [fmtDate(d), num(x.orders), R.rp(x.price), R.rp(Math.abs(x.fees)), x.price ? pct(Math.abs(x.fees) / x.price) : '–', R.rp(g(x, 'Pengembalian dana') + g(x, 'Penyesuaian')), `<b>${R.rp(x.payout)}</b>`]),
          ['Total', num(t.orders), R.rp(t.price), R.rp(Math.abs(t.fees)), share(t.fees), R.rp(g(t, 'Pengembalian dana') + g(t, 'Penyesuaian')), R.rp(t.payout)])}`;
      R.open({ title: 'Laporan Income', period: R.period(r.from, r.to), meta: [['Periode', st.range === 'all' ? 'Semua data' : R.period(r.from, r.to)], ['Channel', esc(chLabel(st.ch))]], body,
        note: 'Income = pesanan selesai yang penghasilannya sudah masuk ke saldo penjual. Tanggal = tanggal dana dilepaskan. Penghasilan bersih = GMV kotor setelah semua fee, voucher, ongkir & refund.' });
    });
    $('#incExport').addEventListener('click', () => {
      const cols = [...new Set(rows.flatMap((s) => Object.keys(detailOf(s))))];
      const head = ['Tanggal penghasilan', 'Tanggal pesanan', 'Channel', 'No. pesanan', 'Tipe', 'Produk', 'Harga produk', ...cols, 'Total fee', 'Penghasilan bersih'];
      const body = rows.map((s) => { const d = detailOf(s); return [day(s), s.date, s.channel, s.orderId, s.type, prod(s), s.productPrice, ...cols.map((k) => d[k] || 0), sum([s]).fees, s.payout]; });
      window.A.download(`ballop-income-${st.ch}-${r.from}_${r.to}-${today()}.csv`, new Blob([`﻿${toCsv([head, ...body])}`], { type: 'text/csv' }));
    });
  }

  // popup with every column of the original export row(s) behind an order / income line
  const KIND_LABEL = { orders: 'Order', settlements: 'Income', live: 'Live' };
  let cache = {};
  async function openRaw(kind, key) {
    const box = document.createElement('div');
    box.className = 'raw-pop';
    box.innerHTML = '<div class="raw-card"><p class="muted">Memuat…</p></div>';
    document.body.appendChild(box);
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-close]')) close(); });
    try {
      const ck = `${kind}|${key}`;
      if (!(ck in cache)) cache[ck] = (await window.A.api(`/api/raw?kind=${kind}&key=${encodeURIComponent(key)}`))[key];
      const rows = cache[ck];
      const rec = (B.data[kind] || []).find((r) => r.key === key) || {};
      const title = rec.orderId || rec.roomId || key;
      const section = (pairs, i) => {
        const row = Object.fromEntries(pairs);
        const by = row['Lihat berdasarkan'];
        const head = rows.length > 1 ? `<h3>${by ? `${esc(by)}${row['Nama Produk'] && row['Nama Produk'] !== '-' ? ` · ${esc(row['Nama Produk'])}` : ''}` : `Baris ${i + 1}`}</h3>` : '';
        return `${head}<table class="raw-table">${pairs.map(([k, val]) => `<tr><th>${esc(k)}</th><td>${typeof val === 'number' ? num(val) : esc(val)}</td></tr>`).join('')}</table>`;
      };
      box.querySelector('.raw-card').innerHTML = `
        <header><div><span class="muted small">${KIND_LABEL[kind]} · ${esc(SALES_CH[rec.channel]?.label || rec.channel || '')}</span><h2>${esc(title)}</h2></div>
          <input type="search" placeholder="Cari kolom…" data-rawq><button class="btn sm" type="button" data-close>✕</button></header>
        <div class="raw-body">${rows && rows.length ? rows.map(section).join('') : '<p class="muted">Data asli Excel untuk baris ini belum tersimpan. Import ulang file-nya untuk melihat semua kolom.</p>'}</div>`;
      const q = box.querySelector('[data-rawq]');
      q.focus();
      q.addEventListener('input', () => { const t = q.value.toLowerCase(); box.querySelectorAll('.raw-table tr').forEach((tr) => { tr.hidden = !!t && !tr.textContent.toLowerCase().includes(t); }); });
    } catch (e) { box.querySelector('.raw-card').innerHTML = `<p class="muted">${esc(e.message)}</p><button class="btn sm" type="button" data-close>Tutup</button>`; }
  }
  window.RawPopup = {
    open: openRaw,
    bind(root) { root.querySelectorAll('[data-raw]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openRaw(b.dataset.raw, b.dataset.key); })); },
    reset() { cache = {}; },
  };

  B.registerView('income', render);
})();
