// BALLOP admin: marketplace income, per channel. An income row is a finished order whose money already reached
// the seller wallet, after every fee. Shows the payout, the full fee breakdown, per month and per order.
(() => {
  const { $, $$ } = window.A;
  const B = window.Biz;
  const { esc, num, money, pct, fmtDate, today, toCsv, SALES_CH } = B;
  const MI = window.MarketImport;

  const CHANNELS = ['shopee', 'tiktok', 'tokopedia'];
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const st = { ch: 'shopee', period: 'all', q: '', limit: 150, open: '' };
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
  const signed = (v) => `<span style="color:${v < 0 ? 'var(--danger)' : v > 0 ? 'var(--ok, #1baf7a)' : 'inherit'}">${v > 0 ? '+' : ''}${money(v)}</span>`;

  function render() {
    const v = $('#view-income');
    const all = B.data.settlements;
    const chRows = all.filter((s) => s.channel === st.ch);
    const months = [...new Set(chRows.map((s) => day(s).slice(0, 7)).filter(Boolean))].sort().reverse();
    const years = [...new Set(months.map((m) => m.slice(0, 4)))];
    if (st.period !== 'all' && !months.includes(st.period) && !years.includes(st.period)) st.period = 'all';
    const inP = (s) => st.period === 'all' || day(s).startsWith(st.period);
    let rows = chRows.filter(inP);
    const t = sum(rows);
    if (st.q) { const q = st.q.toLowerCase(); rows = rows.filter((s) => `${s.orderId} ${(s.items || []).map((x) => x.name).join(' ')} ${s.courier} ${s.payment} ${s.note}`.toLowerCase().includes(q)); }
    rows.sort((a, b) => day(b).localeCompare(day(a)) || b.orderId.localeCompare(a.orderId));
    const share = (x) => (t.price ? pct(Math.abs(x) / t.price) : '–');

    // breakdown table: product price, each group with its columns, then payout
    const groups = MI.GROUP_ORDER.filter((n) => t.groups[n]);
    const breakdown = `
      <tr><td><b>Harga produk</b></td><td class="num"><b>${money(t.price)}</b></td><td class="num muted">100%</td></tr>
      ${groups.map((n) => `<tr style="background:var(--soft, rgba(0,0,0,.03))"><td><b>${esc(n)}</b>${MI.NOT_FEES.includes(n) ? '' : ' <span class="badge warn" style="font-size:10px">fee</span>'}</td><td class="num"><b>${signed(t.groups[n].total)}</b></td><td class="num">${share(t.groups[n].total)}</td></tr>
        ${Object.entries(t.groups[n].lines).sort((a, b) => a[1] - b[1]).map(([k, x]) => `<tr><td style="padding-left:26px" class="muted">${esc(k)}</td><td class="num">${signed(x)}</td><td class="num muted">${share(x)}</td></tr>`).join('')}`).join('')}
      <tr><td><b>Dana cair ke saldo</b></td><td class="num"><b>${money(t.payout)}</b></td><td class="num"><b>${share(t.payout)}</b></td></tr>`;

    const byMonth = [...new Set(rows.map((s) => day(s).slice(0, 7)).filter(Boolean))].sort().reverse().map((m) => [m, sum(rows.filter((s) => day(s).startsWith(m)))]);
    const tabs = CHANNELS.map((c) => { const n = all.filter((s) => s.channel === c && s.type !== 'Penyesuaian').length; return `<button class="btn sm${st.ch === c ? ' primary' : ''}" type="button" data-ch="${c}">${SALES_CH[c].label} <span class="muted small">${num(n)}</span></button>`; }).join('');
    const prod = (s) => (s.items || []).map((x) => x.name.split(/\s+[–|-]\s+/)[0]).join(', ') || (s.type === 'Penyesuaian' ? (s.note || Object.keys(s.detail || {})[0] || 'Penyesuaian') : '–');

    v.innerHTML = `
      <header class="bar"><div><h1>Income marketplace</h1><p class="muted">Pesanan yang sudah selesai dan dananya sudah cair ke saldo penjual, setelah dipotong semua biaya. Beda dengan order (pesanan masuk). Tanggal = tanggal dana dilepaskan. Import file Income di menu Penjualan online.</p></div></header>
      <div class="filters-row">${tabs}<span class="spacer"></span>
        <select data-i="period"><option value="all">Semua periode</option>${years.map((y) => `<option value="${y}"${st.period === y ? ' selected' : ''}>Tahun ${y}</option>`).join('')}${months.map((m) => `<option value="${m}"${st.period === m ? ' selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
        <input type="search" data-i="q" placeholder="Cari no. pesanan / produk…" value="${esc(st.q)}">
        <button class="btn sm" type="button" id="incExport">⬇ Export</button>
      </div>
      ${chRows.length ? `
      <div class="sum-cards">
        <div class="sum-card solid"><div class="k-label">Dana cair</div><div class="k-value">${money(t.payout)}</div><div class="k-sub">${num(t.orders)} pesanan selesai · ${share(t.payout)} dari harga produk</div></div>
        <div class="sum-card solid"><div class="k-label">Harga produk</div><div class="k-value">${money(t.price)}</div><div class="k-sub">sebelum voucher & potongan</div></div>
        <div class="sum-card solid"><div class="k-label">Total fee marketplace</div><div class="k-value" style="color:var(--danger)">${money(Math.abs(t.fees))}</div><div class="k-sub">${share(t.fees)} dari harga produk</div></div>
        <div class="sum-card solid"><div class="k-label">Voucher penjual · ongkir</div><div class="k-value">${money(Math.abs(g(t, 'Voucher & subsidi')))}</div><div class="k-sub">ongkir netto ${money(g(t, 'Biaya pengiriman'))}</div></div>
        <div class="sum-card solid"><div class="k-label">Refund · penyesuaian</div><div class="k-value">${money(g(t, 'Pengembalian dana'))}</div><div class="k-sub">penyesuaian ${money(g(t, 'Penyesuaian'))}</div></div>
      </div>
      <div class="grid-3" style="margin-top:0">
        <section class="panel solid"><div class="panel-head"><h2>Rincian potongan</h2><span class="muted small">% dari harga produk</span></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Komponen</th><th class="num">Jumlah</th><th class="num">%</th></tr></thead><tbody>${breakdown}</tbody></table></div>
        </section>
        <section class="panel solid"><div class="panel-head"><h2>Per bulan</h2><span class="muted small">tanggal dana cair</span></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Bulan</th><th class="num">Pesanan</th><th class="num">Harga produk</th><th class="num">Voucher</th><th class="num">Ongkir</th><th class="num">Fee</th><th class="num">Fee %</th><th class="num">Dana cair</th></tr></thead>
          <tbody>${byMonth.map(([m, x]) => `<tr><td>${monthLabel(m)}</td><td class="num">${num(x.orders)}</td><td class="num">${money(x.price)}</td><td class="num">${money(g(x, 'Voucher & subsidi'))}</td><td class="num">${money(g(x, 'Biaya pengiriman'))}</td><td class="num">${money(x.fees)}</td><td class="num">${x.price ? pct(Math.abs(x.fees) / x.price) : '–'}</td><td class="num"><b>${money(x.payout)}</b></td></tr>`).join('')}</tbody></table></div>
        </section>
      </div>
      <section class="panel solid" style="margin-top:14px">
        <div class="panel-head"><h2>Daftar income</h2><span class="muted small">${num(rows.length)} baris · klik untuk rincian fee</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Dana cair</th><th>Tgl pesanan</th><th>No. pesanan</th><th>Produk</th><th class="num">Harga produk</th><th class="num">Voucher</th><th class="num">Ongkir</th><th class="num">Fee</th><th class="num">Dana cair</th></tr></thead>
          <tbody>${rows.slice(0, st.limit).map((s) => { const x = sum([s]); const open = st.open === s.key; return `<tr data-k="${esc(s.key)}" style="cursor:pointer"><td>${day(s) ? fmtDate(day(s)) : '–'}</td><td>${s.date && s.type !== 'Penyesuaian' ? fmtDate(s.date) : '–'}</td><td>${esc(s.orderId)}${s.type === 'Penyesuaian' ? ' <span class="badge warn">penyesuaian</span>' : ''}${g(x, 'Pengembalian dana') ? ' <span class="badge bad">refund</span>' : ''}</td><td title="${esc(prod(s))}">${esc(prod(s).length > 40 ? `${prod(s).slice(0, 38)}…` : prod(s))}</td><td class="num">${money(s.productPrice)}</td><td class="num">${money(g(x, 'Voucher & subsidi'))}</td><td class="num">${money(g(x, 'Biaya pengiriman'))}</td><td class="num">${money(x.fees)}</td><td class="num"><b>${money(s.payout)}</b></td></tr>${open ? `<tr><td colspan="9" style="background:var(--soft, rgba(0,0,0,.03))"><div class="small" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:4px 18px">${Object.entries(detailOf(s)).map(([k, a]) => `<div style="display:flex;justify-content:space-between;gap:8px"><span class="muted">${esc(k)}</span>${signed(a)}</div>`).join('')}${s.payment ? `<div style="display:flex;justify-content:space-between"><span class="muted">Pembayaran pembeli</span><span>${esc(s.payment)}</span></div>` : ''}${s.courier ? `<div style="display:flex;justify-content:space-between"><span class="muted">Kurir</span><span>${esc(s.courier)}</span></div>` : ''}</div></td></tr>` : ''}`; }).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">Tidak ada income di filter ini.</td></tr>'}</tbody>
        </table></div>
        ${rows.length > st.limit ? '<p style="text-align:center"><button class="btn sm" type="button" id="incMore">Tampilkan lebih banyak</button></p>' : ''}
      </section>` : `<section class="panel solid"><p class="muted" style="text-align:center;padding:30px">Belum ada income ${SALES_CH[st.ch].label}. Import file Income ${SALES_CH[st.ch].label} di menu Penjualan online.</p></section>`}`;

    $$('[data-ch]', v).forEach((b) => b.addEventListener('click', () => { st.ch = b.dataset.ch; st.limit = 150; st.open = ''; render(); }));
    $$('[data-i]', v).forEach((el) => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
      st[el.dataset.i] = el.value; st.limit = 150;
      if (el.tagName === 'INPUT') { clearTimeout(st.t); st.t = setTimeout(render, 250); } else render();
    }));
    $$('tr[data-k]', v).forEach((tr) => tr.addEventListener('click', () => { st.open = st.open === tr.dataset.k ? '' : tr.dataset.k; render(); }));
    $('#incMore')?.addEventListener('click', () => { st.limit += 300; render(); });
    $('#incExport').addEventListener('click', () => {
      const cols = [...new Set(rows.flatMap((s) => Object.keys(detailOf(s))))];
      const head = ['Tanggal dana cair', 'Tanggal pesanan', 'Channel', 'No. pesanan', 'Tipe', 'Produk', 'Harga produk', ...cols, 'Total fee', 'Dana cair'];
      const body = rows.map((s) => { const d = detailOf(s); return [day(s), s.date, s.channel, s.orderId, s.type, prod(s), s.productPrice, ...cols.map((k) => d[k] || 0), sum([s]).fees, s.payout]; });
      window.A.download(`ballop-income-${st.ch}-${st.period}-${today()}.csv`, new Blob([`﻿${toCsv([head, ...body])}`], { type: 'text/csv' }));
    });
  }

  B.registerView('income', render);
})();
