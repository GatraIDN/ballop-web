// BALLOP admin, business side: sales / stock / ads / expenses ledgers and the reporting dashboard.
// Every ledger is a flat list of rows saved whole to /api/<name>; all numbers are derived on the fly.
(() => {
  const { $, $$, api, json, toast } = window.A;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => window.A.money(Math.round(n || 0));
  const num = (n) => Math.round(n || 0).toLocaleString('id-ID');
  const pct = (n) => (Number.isFinite(n) ? `${(n * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–');
  const ratio = (n) => (Number.isFinite(n) && n > 0 ? `${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}×` : '–');
  const compact = (n) => {
    const a = Math.abs(n);
    if (a >= 1e9) return `${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })}M`;
    if (a >= 1e6) return `${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`;
    if (a >= 1e3) return `${(n / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })}rb`;
    return String(Math.round(n));
  };

  // channel identity colours are fixed per entity (never by rank)
  const SALES_CH = {
    shopee: { label: 'Shopee', color: '#eb6834' },
    tiktok: { label: 'TikTok Shop', color: '#2a78d6' },
    website: { label: 'Website / WA', color: '#1baf7a' },
    offline: { label: 'Offline / Event', color: '#6250d6' },
    other: { label: 'Lainnya', color: '#8a8f99' },
  };
  const ADS_CH = {
    meta: { label: 'Meta Ads', color: '#6250d6' },
    shopee: { label: 'Shopee Ads', color: '#eb6834' },
    tiktok: { label: 'TikTok Ads', color: '#2a78d6' },
    google: { label: 'Google Ads', color: '#1baf7a' },
    other: { label: 'Lainnya', color: '#8a8f99' },
  };
  const STATUS = { completed: 'Selesai', returned: 'Retur', cancelled: 'Batal' };
  const EXP_CATS = ['Gaji', 'Packaging', 'Ongkir', 'Sewa', 'Event', 'Konten / KOL', 'Operasional', 'Lainnya'];
  const DEMO = '[DEMO]';

  const data = { sales: [], stock: [], ads: [], expenses: [] };
  let loaded = false;

  // ---------- dates ----------
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => iso(new Date());
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5) + 1;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const fmtDay = (s) => { const d = parse(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const fmtDate = (s) => { const d = parse(s); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

  const RANGES = [
    ['7d', '7 hari'], ['30d', '30 hari'], ['90d', '90 hari'], ['mtd', 'Bulan ini'], ['lastm', 'Bulan lalu'], ['ytd', 'Tahun ini'], ['all', 'Semua'],
  ];
  let range = { key: '30d', from: '', to: '' };
  function resolveRange(key) {
    const t = today();
    const d = parse(t);
    switch (key) {
      case '7d': return { from: addDays(t, -6), to: t };
      case '30d': return { from: addDays(t, -29), to: t };
      case '90d': return { from: addDays(t, -89), to: t };
      case 'mtd': return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: t };
      case 'lastm': return { from: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) };
      case 'ytd': return { from: iso(new Date(d.getFullYear(), 0, 1)), to: t };
      case 'all': {
        const dates = [...data.sales, ...data.ads, ...data.expenses].map((r) => r.date).sort();
        return { from: dates[0] || addDays(t, -29), to: dates.length && dates[dates.length - 1] > t ? dates[dates.length - 1] : t };
      }
      default: return { from: range.from || addDays(t, -29), to: range.to || t };
    }
  }
  function setRange(key, from, to) {
    range = key === 'custom' ? { key, from, to } : { key, ...resolveRange(key) };
  }

  // ---------- products / cost / stock ----------
  const product = (id) => window.A.products.find((p) => p.id === id);
  const pname = (id) => { const p = product(id); return p ? `${p.name} ${p.series}`.trim() : '(produk dihapus)'; };
  // weighted average purchase cost from restocks, falling back to the product's HPP
  function unitCost(id) {
    let q = 0, c = 0;
    data.stock.forEach((s) => { if (s.productId === id && s.type === 'in' && s.cost > 0 && s.qty > 0) { q += s.qty; c += s.qty * s.cost; } });
    return q ? c / q : (product(id)?.cost || 0);
  }
  function stockLevels() {
    const lv = {}; // productId -> size -> {in, sold}
    const cell = (p, s) => { lv[p] = lv[p] || {}; lv[p][s] = lv[p][s] || { in: 0, sold: 0 }; return lv[p][s]; };
    data.stock.forEach((r) => { cell(r.productId, r.size || '').in += r.qty; });
    data.sales.forEach((r) => { if (r.status === 'completed') cell(r.productId, r.size || '').sold += r.qty; });
    return lv;
  }
  const lowLimit = (p) => p.lowStock || window.A.settings.lowStock || 5;

  // ---------- metrics ----------
  const lineGross = (r) => r.qty * r.price;
  const lineNet = (r) => lineGross(r) - r.discount;
  function compute(from, to) {
    const inR = (r) => r.date >= from && r.date <= to;
    const sales = data.sales.filter(inR);
    const done = sales.filter((r) => r.status === 'completed');
    const ads = data.ads.filter(inR);
    const exp = data.expenses.filter(inR);
    const m = {
      gross: 0, discount: 0, revenue: 0, fees: 0, shipping: 0, cogs: 0, units: 0, orders: 0,
      returns: 0, returnValue: 0, adSpend: 0, adRevenue: 0, expenses: 0,
      byCh: {}, byAd: {}, byProduct: {}, byExp: {},
    };
    const orderKeys = new Set();
    done.forEach((r) => {
      const net = lineNet(r);
      m.gross += lineGross(r); m.discount += r.discount; m.revenue += net; m.fees += r.fee; m.shipping += r.shipping;
      m.units += r.qty; m.cogs += r.qty * unitCost(r.productId);
      orderKeys.add(r.orderId ? `${r.channel}:${r.orderId}` : r.id);
      const c = m.byCh[r.channel] = m.byCh[r.channel] || { revenue: 0, units: 0, orders: new Set(), fees: 0 };
      c.revenue += net; c.units += r.qty; c.fees += r.fee; c.orders.add(r.orderId || r.id);
      const p = m.byProduct[r.productId] = m.byProduct[r.productId] || { revenue: 0, units: 0 };
      p.revenue += net; p.units += r.qty;
    });
    sales.filter((r) => r.status === 'returned').forEach((r) => { m.returns += r.qty; m.returnValue += lineNet(r); });
    m.orders = orderKeys.size;
    Object.values(m.byCh).forEach((c) => { c.orders = c.orders.size; });
    ads.forEach((a) => {
      m.adSpend += a.spend; m.adRevenue += a.revenue;
      const c = m.byAd[a.channel] = m.byAd[a.channel] || { spend: 0, impressions: 0, clicks: 0, orders: 0, revenue: 0 };
      c.spend += a.spend; c.impressions += a.impressions; c.clicks += a.clicks; c.orders += a.orders; c.revenue += a.revenue;
    });
    exp.forEach((x) => { m.expenses += x.amount; m.byExp[x.category] = (m.byExp[x.category] || 0) + x.amount; });
    m.grossProfit = m.revenue - m.fees - m.shipping - m.cogs;
    m.netProfit = m.grossProfit - m.adSpend - m.expenses;
    m.aov = m.orders ? m.revenue / m.orders : 0;
    m.roas = m.adSpend ? m.revenue / m.adSpend : NaN;
    m.cpa = m.orders ? m.adSpend / m.orders : NaN;
    m.margin = m.revenue ? m.netProfit / m.revenue : NaN;
    m.salesRows = done;
    m.adRows = ads;
    return m;
  }

  // group a date range into day / week / month buckets
  function buckets(from, to) {
    const n = daysBetween(from, to);
    const unit = n <= 45 ? 'day' : n <= 200 ? 'week' : 'month';
    const out = [];
    let cur = from;
    if (unit === 'week') { const d = parse(from); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); cur = iso(d); }
    if (unit === 'month') { const d = parse(from); cur = iso(new Date(d.getFullYear(), d.getMonth(), 1)); }
    while (cur <= to) {
      let next;
      if (unit === 'day') next = addDays(cur, 1);
      else if (unit === 'week') next = addDays(cur, 7);
      else { const d = parse(cur); next = iso(new Date(d.getFullYear(), d.getMonth() + 1, 1)); }
      const end = addDays(next, -1);
      const label = unit === 'month' ? `${MONTHS[parse(cur).getMonth()]} ${String(parse(cur).getFullYear()).slice(2)}` : fmtDay(cur < from ? from : cur);
      out.push({ from: cur < from ? from : cur, to: end > to ? to : end, label, unit });
      cur = next;
    }
    return out;
  }

  // ---------- charts (stacked bars, one axis, hover tooltip) ----------
  function stackedBars(el, bks, series, value, fmt) {
    const W = Math.max(280, el.clientWidth || 600), H = 240, padL = 46, padR = 8, padT = 10, padB = 26;
    const totals = bks.map((b) => series.reduce((s, sr) => s + value(b, sr.key), 0));
    const max = Math.max(1, ...totals);
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const top = Math.ceil(max / step / 2) * step * 2 || 1;
    const ih = H - padT - padB, iw = W - padL - padR;
    const bw = iw / bks.length;
    const gap = Math.min(6, bw * 0.25);
    const y = (v) => padT + ih - (v / top) * ih;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik"><g class="grid">`;
    for (let i = 0; i <= 4; i++) {
      const v = (top / 4) * i;
      svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
    }
    svg += '</g><g class="axis">';
    for (let i = 0; i <= 4; i++) { const v = (top / 4) * i; svg += `<text x="${padL - 8}" y="${y(v) + 3}" text-anchor="end">${compact(v)}</text>`; }
    const every = Math.ceil(bks.length / Math.max(1, Math.floor(iw / 70)));
    bks.forEach((b, i) => { if (i % every === 0) svg += `<text x="${padL + bw * i + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>`; });
    svg += '</g>';
    bks.forEach((b, i) => {
      let acc = 0;
      const x = padL + bw * i + gap / 2;
      const w = Math.max(1, bw - gap);
      const segs = series.map((sr) => ({ sr, v: value(b, sr.key) })).filter((s) => s.v > 0);
      segs.forEach((s, k) => {
        const y0 = y(acc), y1 = y(acc + s.v);
        const h = Math.max(0, y0 - y1 - (k ? 2 : 0)); // 2px surface gap between stacked segments
        const isTop = k === segs.length - 1;
        const r = isTop ? Math.min(4, w / 2, h) : 0;
        // rounded data-end on the top segment only, flat at the baseline
        svg += r
          ? `<path class="bar" data-i="${i}" fill="${s.sr.color}" d="M${x},${y1 + h} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y1 + h} Z"/>`
          : `<rect class="bar" data-i="${i}" fill="${s.sr.color}" x="${x}" y="${y1}" width="${w}" height="${h}"/>`;
        acc += s.v;
      });
      svg += `<rect class="hit" data-i="${i}" x="${padL + bw * i}" y="${padT}" width="${bw}" height="${ih}" fill="transparent"/>`;
    });
    svg += '</svg>';
    el.innerHTML = `${svg}<div class="tip"></div>`;
    const tip = $('.tip', el);
    $$('.hit', el).forEach((h) => {
      h.addEventListener('mouseenter', () => {
        const i = Number(h.dataset.i);
        const b = bks[i];
        $$('.bar', el).forEach((n) => n.classList.toggle('hot', Number(n.dataset.i) === i));
        el.querySelector('svg').style.setProperty('--dim', 1);
        const rows = series.map((sr) => ({ sr, v: value(b, sr.key) })).filter((s) => s.v > 0);
        tip.innerHTML = `<b>${esc(b.from === b.to ? fmtDate(b.from) : `${fmtDay(b.from)} – ${fmtDate(b.to)}`)}</b>${rows.map((s) => `<div><span><i style="background:${s.sr.color}"></i>${esc(s.sr.label)}</span><strong>${fmt(s.v)}</strong></div>`).join('')}<div><span>Total</span><strong>${fmt(totals[i])}</strong></div>`;
        const box = el.getBoundingClientRect();
        const hb = h.getBoundingClientRect();
        let left = hb.left - box.left + hb.width / 2 + 12;
        if (left + 190 > box.width) left = hb.left - box.left - 200;
        tip.style.left = `${Math.max(0, left)}px`;
        tip.style.top = '10px';
        tip.classList.add('show');
      });
      h.addEventListener('mouseleave', () => { tip.classList.remove('show'); $$('.bar', el).forEach((n) => n.classList.remove('hot')); });
    });
  }
  const legend = (series) => `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`;

  // ---------- dashboard ----------
  function delta(cur, prev, invert = false, neutral = false) {
    if (!prev || !Number.isFinite(prev) || !Number.isFinite(cur)) return '<div class="k-delta">— vs periode lalu</div>';
    const d = (cur - prev) / Math.abs(prev);
    const good = invert ? d < 0 : d > 0;
    return `<div class="k-delta ${d === 0 || neutral ? '' : good ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${pct(Math.abs(d))} vs periode lalu</div>`;
  }

  function renderDashboard() {
    const v = $('#view-dashboard');
    if (!loaded) { v.innerHTML = '<p class="muted">Memuat…</p>'; return; }
    const { from, to } = range;
    const len = daysBetween(from, to);
    const m = compute(from, to);
    const p = compute(addDays(from, -len), addDays(from, -1));
    const hasData = data.sales.length || data.ads.length;
    const hasDemo = [...data.sales, ...data.ads, ...data.stock, ...data.expenses].some((r) => (r.note || '').startsWith(DEMO));

    // monthly target (current month, independent of the selected range)
    const t = today(), td = parse(t);
    const mStart = iso(new Date(td.getFullYear(), td.getMonth(), 1));
    const mDays = new Date(td.getFullYear(), td.getMonth() + 1, 0).getDate();
    const mRev = compute(mStart, t).revenue;
    const target = window.A.settings.monthlyTarget || 0;
    const projected = (mRev / td.getDate()) * mDays;

    const bks = buckets(from, to);
    const salesSeries = Object.entries(SALES_CH).map(([key, c]) => ({ key, ...c })).filter((s) => m.byCh[s.key]);
    const adSeries = Object.entries(ADS_CH).map(([key, c]) => ({ key, ...c })).filter((s) => m.byAd[s.key]);
    const sumBy = (rows, b, pred, val) => rows.reduce((s, r) => (r.date >= b.from && r.date <= b.to && pred(r) ? s + val(r) : s), 0);

    const topProducts = Object.entries(m.byProduct).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 6);
    const maxTop = Math.max(1, ...topProducts.map(([, x]) => x.revenue));
    const lv = stockLevels();
    const alerts = [];
    window.A.products.forEach((pr) => {
      const sizes = pr.sizes.length ? pr.sizes : [''];
      sizes.forEach((s) => {
        const c = lv[pr.id]?.[s];
        if (!c) return;
        const left = c.in - c.sold;
        if (left <= lowLimit(pr)) alerts.push({ name: `${pr.name} ${pr.series}`, size: s, left });
      });
    });
    alerts.sort((a, b) => a.left - b.left);

    const mp = [
      { label: 'Shopee', rev: m.byCh.shopee?.revenue || 0, spend: m.byAd.shopee?.spend || 0, color: SALES_CH.shopee.color },
      { label: 'TikTok Shop', rev: m.byCh.tiktok?.revenue || 0, spend: m.byAd.tiktok?.spend || 0, color: SALES_CH.tiktok.color },
      { label: 'Meta (atribusi)', rev: m.byAd.meta?.revenue || 0, spend: m.byAd.meta?.spend || 0, color: ADS_CH.meta.color },
    ];

    v.innerHTML = `
      <header class="bar">
        <div><h1>Ringkasan</h1><p class="muted">${fmtDate(from)} – ${fmtDate(to)} · ${len} hari</p></div>
        <button class="btn" id="expReport" type="button">⬇ Export laporan</button>
      </header>
      <div class="toolbar">
        <div class="seg glass">${RANGES.map(([k, l]) => `<button type="button" data-r="${k}" class="${range.key === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="range-custom">dari <input type="date" id="rFrom" value="${from}"> s/d <input type="date" id="rTo" value="${to}"></span>
      </div>
      ${!hasData ? `<div class="demo-note glass"><b>Belum ada data penjualan / iklan.</b> Catat di menu Penjualan & Iklan, atau coba dengan data contoh dulu. <button class="btn sm blue" id="demoFill" type="button">Isi data contoh</button></div>` : ''}
      ${hasDemo ? `<div class="demo-note glass"><span class="badge warn">Data contoh</span> Angka di bawah memakai data contoh. <button class="btn sm danger" id="demoClear" type="button">Hapus data contoh</button></div>` : ''}
      <div class="kpis">
        <div class="kpi solid hero"><div class="k-label">Omzet bersih</div><div class="k-value">${money(m.revenue)}</div>${delta(m.revenue, p.revenue)}</div>
        <div class="kpi solid"><div class="k-label">Laba bersih</div><div class="k-value">${money(m.netProfit)}</div>${delta(m.netProfit, p.netProfit)}</div>
        <div class="kpi solid"><div class="k-label">Unit terjual</div><div class="k-value">${num(m.units)} pasang</div>${delta(m.units, p.units)}</div>
        <div class="kpi solid"><div class="k-label">Pesanan · AOV</div><div class="k-value">${num(m.orders)} · ${compact(m.aov)}</div>${delta(m.orders, p.orders)}</div>
        <div class="kpi solid"><div class="k-label">Biaya iklan</div><div class="k-value">${money(m.adSpend)}</div>${delta(m.adSpend, p.adSpend, false, true)}</div>
        <div class="kpi solid"><div class="k-label">ROAS total (omzet ÷ iklan)</div><div class="k-value">${ratio(m.roas)}</div>${delta(m.roas, p.roas)}</div>
        <div class="kpi solid"><div class="k-label">Biaya per pesanan (CPA)</div><div class="k-value">${Number.isFinite(m.cpa) ? money(m.cpa) : '–'}</div>${delta(m.cpa, p.cpa, true)}</div>
        <div class="kpi solid"><div class="k-label">Margin bersih</div><div class="k-value">${pct(m.margin)}</div>${delta(m.margin, p.margin)}</div>
      </div>
      <div class="target solid">
        <div class="target-top"><b>Target ${MONTHS[td.getMonth()]} ${td.getFullYear()}</b><span>${money(mRev)} dari ${target ? money(target) : '(atur di Pengaturan)'}</span><span class="spacer"></span>
          <span>${target ? `${pct(mRev / target)} · proyeksi akhir bulan ${money(projected)}` : ''}</span></div>
        <div class="track" title="Garis = posisi hari ini dalam bulan"><i style="width:${target ? Math.min(100, (mRev / target) * 100) : 0}%"></i><em style="left:${(td.getDate() / mDays) * 100}%"></em></div>
      </div>
      <div class="grid-2">
        <section class="panel solid">
          <div class="panel-head"><h2>Omzet per channel</h2>${legend(salesSeries)}</div>
          <div class="chart" id="chSales"></div>
        </section>
        <section class="panel solid">
          <div class="panel-head"><h2>Biaya iklan per channel</h2>${legend(adSeries)}</div>
          <div class="chart" id="chAds"></div>
        </section>
      </div>
      <div class="grid-2">
        <section class="panel solid">
          <div class="panel-head"><h2>Penjualan per channel</h2></div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Channel</th><th class="num">Omzet</th><th class="num">Unit</th><th class="num">Pesanan</th><th class="num">Fee</th><th class="num">Porsi</th></tr></thead>
            <tbody>${Object.entries(SALES_CH).filter(([k]) => m.byCh[k]).map(([k, c]) => { const x = m.byCh[k]; return `<tr><td><span class="ch"><i style="background:${c.color}"></i>${c.label}</span></td><td class="num">${money(x.revenue)}</td><td class="num">${num(x.units)}</td><td class="num">${num(x.orders)}</td><td class="num">${money(x.fees)}</td><td class="num">${pct(x.revenue / m.revenue)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">Belum ada penjualan di periode ini.</td></tr>'}</tbody>
          </table></div>
        </section>
        <section class="panel solid">
          <div class="panel-head"><h2>Iklan per channel</h2></div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Channel</th><th class="num">Spend</th><th class="num">Klik</th><th class="num">CTR</th><th class="num">CPC</th><th class="num">Order</th><th class="num">ROAS</th></tr></thead>
            <tbody>${Object.entries(ADS_CH).filter(([k]) => m.byAd[k]).map(([k, c]) => { const x = m.byAd[k]; return `<tr><td><span class="ch"><i style="background:${c.color}"></i>${c.label}</span></td><td class="num">${money(x.spend)}</td><td class="num">${num(x.clicks)}</td><td class="num">${pct(x.impressions ? x.clicks / x.impressions : NaN)}</td><td class="num">${x.clicks ? money(x.spend / x.clicks) : '–'}</td><td class="num">${num(x.orders)}</td><td class="num">${ratio(x.revenue / x.spend)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Belum ada data iklan di periode ini.</td></tr>'}</tbody>
          </table></div>
        </section>
      </div>
      <div class="grid-3">
        <section class="panel solid">
          <div class="panel-head"><h2>Produk terlaris</h2><span class="muted small">omzet · unit</span></div>
          <div class="hbar">${topProducts.map(([id, x]) => { const pr = product(id); return `<div class="hbar-row"><span class="hb-name" title="${esc(pname(id))}">${esc(pname(id))}</span><span class="hb-track"><i style="width:${(x.revenue / maxTop) * 100}%;background:${pr ? pr.color : '#8a8f99'}"></i></span><span class="hb-val">${compact(x.revenue)} · ${num(x.units)}</span></div>`; }).join('') || '<p class="muted">Belum ada penjualan.</p>'}</div>
        </section>
        <section class="panel solid">
          <div class="panel-head"><h2>Laba rugi</h2></div>
          <table class="pl">
            <tr><td>Penjualan kotor</td><td>${money(m.gross)}</td></tr>
            <tr class="sub"><td>Diskon</td><td>−${money(m.discount)}</td></tr>
            <tr class="mid"><td>Omzet bersih</td><td>${money(m.revenue)}</td></tr>
            <tr class="sub"><td>Fee marketplace</td><td>−${money(m.fees)}</td></tr>
            <tr class="sub"><td>Ongkir ditanggung</td><td>−${money(m.shipping)}</td></tr>
            <tr class="sub"><td>HPP (modal barang)</td><td>−${money(m.cogs)}</td></tr>
            <tr class="mid"><td>Laba kotor</td><td>${money(m.grossProfit)}</td></tr>
            <tr class="sub"><td>Biaya iklan</td><td>−${money(m.adSpend)}</td></tr>
            <tr class="sub"><td>Biaya operasional</td><td>−${money(m.expenses)}</td></tr>
            <tr class="total"><td>Laba bersih</td><td style="color:${m.netProfit < 0 ? 'var(--danger)' : 'var(--good)'}">${money(m.netProfit)}</td></tr>
          </table>
          ${m.returns ? `<p class="muted small">Retur: ${num(m.returns)} pasang (${money(m.returnValue)}), tidak dihitung di omzet.</p>` : ''}
        </section>
      </div>
      <div class="grid-2">
        <section class="panel solid">
          <div class="panel-head"><h2>ROAS per marketplace</h2><span class="muted small">omzet channel ÷ iklan channel</span></div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Channel</th><th class="num">Omzet</th><th class="num">Iklan</th><th class="num">ROAS</th><th class="num">Iklan / omzet</th></tr></thead>
            <tbody>${mp.map((x) => `<tr><td><span class="ch"><i style="background:${x.color}"></i>${x.label}</span></td><td class="num">${money(x.rev)}</td><td class="num">${money(x.spend)}</td><td class="num">${ratio(x.rev / x.spend)}</td><td class="num">${x.rev ? pct(x.spend / x.rev) : '–'}</td></tr>`).join('')}</tbody>
          </table></div>
        </section>
        <section class="panel solid">
          <div class="panel-head"><h2>Stok menipis</h2><button class="btn sm" type="button" data-go="stock">Kelola stok</button></div>
          <div class="alert-list">${alerts.slice(0, 8).map((a) => `<div><span>${esc(a.name)}${a.size ? ` · ${esc(a.size)}` : ''}</span><span class="badge ${a.left <= 0 ? 'bad' : 'warn'}">${a.left <= 0 ? 'HABIS' : `sisa ${a.left}`}</span></div>`).join('') || '<p class="muted">Semua stok aman.</p>'}</div>
        </section>
      </div>`;

    stackedBars($('#chSales'), bks, salesSeries.length ? salesSeries : [{ key: '_', label: 'Omzet', color: '#2a78d6' }],
      (b, key) => sumBy(m.salesRows, b, (r) => r.channel === key, lineNet), money);
    stackedBars($('#chAds'), bks, adSeries.length ? adSeries : [{ key: '_', label: 'Iklan', color: '#6250d6' }],
      (b, key) => sumBy(m.adRows, b, (r) => r.channel === key, (r) => r.spend), money);

    $$('[data-r]', v).forEach((b) => b.addEventListener('click', () => { setRange(b.dataset.r); renderDashboard(); }));
    const custom = () => { const f = $('#rFrom').value, t2 = $('#rTo').value; if (f && t2 && f <= t2) { setRange('custom', f, t2); renderDashboard(); } };
    $('#rFrom').addEventListener('change', custom);
    $('#rTo').addEventListener('change', custom);
    $$('[data-go]', v).forEach((b) => b.addEventListener('click', () => window.A.showView(b.dataset.go)));
    $('#demoFill')?.addEventListener('click', fillDemo);
    $('#demoClear')?.addEventListener('click', clearDemo);
    $('#expReport').addEventListener('click', () => exportReport(m));
  }

  function exportReport(m) {
    const rows = [['Laporan BALLOP', `${range.from} s/d ${range.to}`], [],
      ['Ringkasan'], ['Penjualan kotor', m.gross], ['Diskon', m.discount], ['Omzet bersih', m.revenue], ['Fee marketplace', m.fees],
      ['Ongkir ditanggung', m.shipping], ['HPP', Math.round(m.cogs)], ['Laba kotor', Math.round(m.grossProfit)], ['Biaya iklan', m.adSpend],
      ['Biaya operasional', m.expenses], ['Laba bersih', Math.round(m.netProfit)], ['Unit terjual', m.units], ['Pesanan', m.orders],
      ['AOV', Math.round(m.aov)], ['ROAS', Number.isFinite(m.roas) ? m.roas.toFixed(2) : ''], [],
      ['Penjualan per channel', 'Omzet', 'Unit', 'Pesanan', 'Fee'],
      ...Object.entries(m.byCh).map(([k, x]) => [SALES_CH[k].label, x.revenue, x.units, x.orders, x.fees]), [],
      ['Iklan per channel', 'Spend', 'Impresi', 'Klik', 'Order', 'Revenue', 'ROAS'],
      ...Object.entries(m.byAd).map(([k, x]) => [ADS_CH[k].label, x.spend, x.impressions, x.clicks, x.orders, x.revenue, x.spend ? (x.revenue / x.spend).toFixed(2) : '']), [],
      ['Produk', 'Omzet', 'Unit'],
      ...Object.entries(m.byProduct).map(([id, x]) => [pname(id), x.revenue, x.units]),
    ];
    window.A.download(`ballop-laporan-${range.from}-${range.to}.csv`, new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv' }));
  }

  // ---------- CSV ----------
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  const findProduct = (v) => {
    const s = String(v || '').trim().toLowerCase();
    return window.A.products.find((p) => p.id.toLowerCase() === s || (p.sku || '').toLowerCase() === s || `${p.name} ${p.series}`.toLowerCase() === s);
  };
  const normChannel = (v, map) => {
    const s = String(v || '').toLowerCase();
    if (map === ADS_CH && /(meta|facebook|fb|instagram|ig)/.test(s)) return 'meta';
    if (/shopee/.test(s)) return 'shopee';
    if (/tiktok|tik tok/.test(s)) return 'tiktok';
    if (map === ADS_CH && /google/.test(s)) return 'google';
    if (map === SALES_CH && /(web|wa|whatsapp)/.test(s)) return 'website';
    if (map === SALES_CH && /(offline|event|toko)/.test(s)) return 'offline';
    return 'other';
  };
  const toNum = (v) => Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;
  const toIso = (v) => {
    const s = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : today();
  };

  // ---------- ledger configs ----------
  const productOptions = () => window.A.products.map((p) => [p.id, `${p.sku ? `${p.sku} · ` : ''}${p.name} ${p.series}`]);
  const sizeOptions = (pid) => { const p = product(pid); return (p && p.sizes.length ? p.sizes : ['']).map((s) => [s, s || '—']); };
  const chBadge = (map, k) => `<span class="ch"><i style="background:${(map[k] || map.other).color}"></i>${(map[k] || map.other).label}</span>`;

  const LEDGERS = {
    sales: {
      title: 'Penjualan', sub: 'Catat order dari Shopee, TikTok Shop, website, dan offline. Satu baris = satu produk dalam order.',
      add: '+ Catat penjualan', map: SALES_CH,
      fields: [
        { k: 'date', label: 'Tanggal', type: 'date', half: 1 },
        { k: 'channel', label: 'Channel', type: 'select', options: () => Object.entries(SALES_CH).map(([k, c]) => [k, c.label]), half: 1 },
        { k: 'orderId', label: 'No. order (opsional)', half: 1 },
        { k: 'status', label: 'Status', type: 'select', options: () => Object.entries(STATUS), half: 1 },
        { k: 'productId', label: 'Produk', type: 'select', options: productOptions },
        { k: 'size', label: 'Ukuran', type: 'select', options: (f) => sizeOptions(f.productId.value), half: 1 },
        { k: 'qty', label: 'Jumlah (pasang)', type: 'number', min: 1, def: 1, half: 1 },
        { k: 'price', label: 'Harga satuan', type: 'number', step: 1000, half: 1 },
        { k: 'discount', label: 'Diskon / voucher (total)', type: 'number', step: 1000, half: 1 },
        { k: 'fee', label: 'Fee marketplace (total)', type: 'number', step: 100, half: 1 },
        { k: 'shipping', label: 'Ongkir ditanggung toko', type: 'number', step: 1000, half: 1 },
        { k: 'note', label: 'Catatan' },
      ],
      onChange(f, k) {
        if (k === 'productId') {
          const p = product(f.productId.value);
          fillSelect(f.size, sizeOptions(f.productId.value));
          if (p) f.price.value = p.price;
        }
      },
      summary: (f) => {
        const net = (Number(f.qty.value) || 0) * (Number(f.price.value) || 0) - (Number(f.discount.value) || 0);
        const fee = Number(f.fee.value) || 0;
        return `Omzet ${money(net)} · bersih setelah fee ${money(net - fee - (Number(f.shipping.value) || 0))}`;
      },
      columns: [
        { label: 'Tanggal', get: (r) => fmtDate(r.date) },
        { label: 'Channel', get: (r) => chBadge(SALES_CH, r.channel) },
        { label: 'Order', get: (r) => esc(r.orderId || '–') },
        { label: 'Produk', get: (r) => esc(pname(r.productId)) },
        { label: 'Ukuran', get: (r) => esc(r.size || '–') },
        { label: 'Qty', num: true, get: (r) => num(r.qty), sum: (r) => r.qty },
        { label: 'Omzet', num: true, get: (r) => money(lineNet(r)), sum: (r) => lineNet(r), fmt: money },
        { label: 'Fee', num: true, get: (r) => money(r.fee), sum: (r) => r.fee, fmt: money },
        { label: 'Status', get: (r) => `<span class="badge ${r.status === 'completed' ? 'live' : r.status === 'returned' ? 'warn' : 'bad'}">${STATUS[r.status]}</span>` },
      ],
      filters: ['channel', 'product', 'status'],
      csv: ['date', 'channel', 'orderId', 'sku', 'size', 'qty', 'price', 'discount', 'fee', 'shipping', 'status', 'note'],
    },
    ads: {
      title: 'Iklan', sub: 'Catat spending iklan harian per channel. Isi order & revenue dari dashboard iklan (atribusi platform).',
      add: '+ Catat iklan', map: ADS_CH,
      fields: [
        { k: 'date', label: 'Tanggal', type: 'date', half: 1 },
        { k: 'channel', label: 'Channel', type: 'select', options: () => Object.entries(ADS_CH).map(([k, c]) => [k, c.label]), half: 1 },
        { k: 'campaign', label: 'Nama campaign' },
        { k: 'spend', label: 'Spending', type: 'number', step: 1000, half: 1 },
        { k: 'impressions', label: 'Impresi', type: 'number', half: 1 },
        { k: 'clicks', label: 'Klik', type: 'number', half: 1 },
        { k: 'orders', label: 'Order (atribusi)', type: 'number', half: 1 },
        { k: 'revenue', label: 'Revenue (atribusi)', type: 'number', step: 1000 },
        { k: 'note', label: 'Catatan' },
      ],
      summary: (f) => {
        const sp = Number(f.spend.value) || 0, cl = Number(f.clicks.value) || 0, im = Number(f.impressions.value) || 0, rv = Number(f.revenue.value) || 0;
        return `CTR ${pct(im ? cl / im : NaN)} · CPC ${cl ? money(sp / cl) : '–'} · ROAS ${ratio(sp ? rv / sp : NaN)}`;
      },
      columns: [
        { label: 'Tanggal', get: (r) => fmtDate(r.date) },
        { label: 'Channel', get: (r) => chBadge(ADS_CH, r.channel) },
        { label: 'Campaign', get: (r) => esc(r.campaign || '–') },
        { label: 'Spend', num: true, get: (r) => money(r.spend), sum: (r) => r.spend, fmt: money },
        { label: 'Impresi', num: true, get: (r) => num(r.impressions), sum: (r) => r.impressions },
        { label: 'Klik', num: true, get: (r) => num(r.clicks), sum: (r) => r.clicks },
        { label: 'CTR', num: true, get: (r) => pct(r.impressions ? r.clicks / r.impressions : NaN) },
        { label: 'Order', num: true, get: (r) => num(r.orders), sum: (r) => r.orders },
        { label: 'Revenue', num: true, get: (r) => money(r.revenue), sum: (r) => r.revenue, fmt: money },
        { label: 'ROAS', num: true, get: (r) => ratio(r.spend ? r.revenue / r.spend : NaN) },
      ],
      filters: ['channel'],
      csv: ['date', 'channel', 'campaign', 'spend', 'impressions', 'clicks', 'orders', 'revenue', 'note'],
    },
    expenses: {
      title: 'Biaya operasional', sub: 'Biaya di luar iklan: gaji, packaging, sewa, event, KOL. Masuk ke laba rugi.',
      add: '+ Catat biaya',
      fields: [
        { k: 'date', label: 'Tanggal', type: 'date', half: 1 },
        { k: 'category', label: 'Kategori', type: 'select', options: () => EXP_CATS.map((c) => [c, c]), half: 1 },
        { k: 'amount', label: 'Jumlah', type: 'number', step: 1000 },
        { k: 'note', label: 'Keterangan' },
      ],
      columns: [
        { label: 'Tanggal', get: (r) => fmtDate(r.date) },
        { label: 'Kategori', get: (r) => esc(r.category) },
        { label: 'Keterangan', get: (r) => esc(r.note || '–') },
        { label: 'Jumlah', num: true, get: (r) => money(r.amount), sum: (r) => r.amount, fmt: money },
      ],
      filters: ['category'],
      csv: ['date', 'category', 'amount', 'note'],
    },
    stock: {
      title: 'Riwayat stok', add: '+ Restock',
      fields: [
        { k: 'date', label: 'Tanggal', type: 'date', half: 1 },
        { k: 'type', label: 'Jenis', type: 'select', options: () => [['in', 'Barang masuk (restock)'], ['adjust', 'Penyesuaian / opname']], half: 1 },
        { k: 'productId', label: 'Produk', type: 'select', options: productOptions },
        { k: 'size', label: 'Ukuran', type: 'select', options: (f) => [['*', 'Semua ukuran (jumlah per ukuran)'], ...sizeOptions(f.productId.value)], half: 1 },
        { k: 'qty', label: 'Jumlah (minus untuk mengurangi)', type: 'number', step: 1, def: 1, half: 1, allowNeg: true },
        { k: 'cost', label: 'Harga modal per pasang', type: 'number', step: 1000 },
        { k: 'note', label: 'Catatan' },
      ],
      onChange(f, k) {
        if (k === 'productId') {
          fillSelect(f.size, [['*', 'Semua ukuran (jumlah per ukuran)'], ...sizeOptions(f.productId.value)]);
          const p = product(f.productId.value);
          if (p && !Number(f.cost.value)) f.cost.value = p.cost || '';
        }
      },
      columns: [
        { label: 'Tanggal', get: (r) => fmtDate(r.date) },
        { label: 'Jenis', get: (r) => `<span class="badge ${r.type === 'in' ? 'live' : 'warn'}">${r.type === 'in' ? 'Masuk' : 'Penyesuaian'}</span>` },
        { label: 'Produk', get: (r) => esc(pname(r.productId)) },
        { label: 'Ukuran', get: (r) => esc(r.size || '–') },
        { label: 'Qty', num: true, get: (r) => (r.qty > 0 ? `+${num(r.qty)}` : num(r.qty)), sum: (r) => r.qty },
        { label: 'Modal / pasang', num: true, get: (r) => (r.cost ? money(r.cost) : '–') },
        { label: 'Catatan', get: (r) => esc(r.note || '') },
      ],
      filters: ['product'],
      csv: ['date', 'type', 'sku', 'size', 'qty', 'cost', 'note'],
    },
  };

  function fillSelect(sel, opts) {
    const keep = sel.value;
    sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    if (opts.some(([v]) => v === keep)) sel.value = keep;
  }

  // ---------- ledger views ----------
  const lstate = {};
  function renderLedger(name, targetSel, opts = {}) {
    const cfg = LEDGERS[name];
    const st = lstate[name] = lstate[name] || { range: '30d', channel: '', product: '', status: '', category: '', q: '', limit: 100 };
    const root = $(targetSel);
    const r = st.range === 'all' ? { from: '0000-00-00', to: '9999-12-31' } : resolveRange(st.range);
    let rows = data[name].filter((x) => x.date >= r.from && x.date <= r.to);
    if (st.channel) rows = rows.filter((x) => x.channel === st.channel);
    if (st.product) rows = rows.filter((x) => x.productId === st.product);
    if (st.status) rows = rows.filter((x) => x.status === st.status);
    if (st.category) rows = rows.filter((x) => x.category === st.category);
    if (st.q) { const q = st.q.toLowerCase(); rows = rows.filter((x) => JSON.stringify(x).toLowerCase().includes(q) || pname(x.productId || '').toLowerCase().includes(q)); }
    rows = rows.map((x) => ({ x, i: data[name].indexOf(x) })).sort((a, b) => b.x.date.localeCompare(a.x.date) || b.i - a.i);

    const filt = [];
    filt.push(`<select data-f="range">${[['7d', '7 hari'], ['30d', '30 hari'], ['90d', '90 hari'], ['mtd', 'Bulan ini'], ['lastm', 'Bulan lalu'], ['ytd', 'Tahun ini'], ['all', 'Semua']].map(([k, l]) => `<option value="${k}"${st.range === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`);
    if (cfg.filters.includes('channel')) filt.push(`<select data-f="channel"><option value="">Semua channel</option>${Object.entries(cfg.map).map(([k, c]) => `<option value="${k}"${st.channel === k ? ' selected' : ''}>${c.label}</option>`).join('')}</select>`);
    if (cfg.filters.includes('product')) filt.push(`<select data-f="product"><option value="">Semua produk</option>${productOptions().map(([k, l]) => `<option value="${esc(k)}"${st.product === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
    if (cfg.filters.includes('status')) filt.push(`<select data-f="status"><option value="">Semua status</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${st.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`);
    if (cfg.filters.includes('category')) filt.push(`<select data-f="category"><option value="">Semua kategori</option>${EXP_CATS.map((c) => `<option${st.category === c ? ' selected' : ''}>${c}</option>`).join('')}</select>`);
    filt.push(`<input type="search" data-f="q" placeholder="Cari…" value="${esc(st.q)}">`);

    const shown = rows.slice(0, st.limit);
    const totals = cfg.columns.map((c) => (c.sum ? rows.reduce((s, { x }) => s + c.sum(x), 0) : null));
    root.innerHTML = `
      ${opts.header === false ? `<div class="panel-head"><h2>${cfg.title}</h2></div>` : `<header class="bar"><div><h1>${cfg.title}</h1><p class="muted">${cfg.sub}</p></div></header>`}
      <div class="filters-row">
        ${filt.join('')}
        <span class="spacer"></span>
        <button class="btn sm" type="button" data-act="tpl">Template CSV</button>
        <label class="btn sm">⬆ Import CSV<input type="file" accept=".csv,text/csv" data-act="import" hidden></label>
        <button class="btn sm" type="button" data-act="export">⬇ Export</button>
        <button class="btn sm primary" type="button" data-act="add">${cfg.add}</button>
      </div>
      ${opts.before || ''}
      <div class="table-wrap solid"><table class="data">
        <thead><tr>${cfg.columns.map((c) => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}</tr></thead>
        <tbody>${shown.map(({ x, i }) => `<tr class="click" data-i="${i}">${cfg.columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.get(x)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cfg.columns.length}" class="muted" style="text-align:center;padding:30px">Belum ada data di filter ini.</td></tr>`}</tbody>
        ${rows.length ? `<tfoot><tr>${cfg.columns.map((c, k) => `<td class="${c.num ? 'num' : ''}">${k === 0 ? `${num(rows.length)} baris` : totals[k] != null ? (c.fmt || num)(totals[k]) : ''}</td>`).join('')}</tr></tfoot>` : ''}
      </table></div>
      ${rows.length > st.limit ? `<p style="text-align:center"><button class="btn sm" type="button" data-act="more">Tampilkan lebih banyak (${num(rows.length - st.limit)} lagi)</button></p>` : ''}`;

    $$('[data-f]', root).forEach((el) => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
      st[el.dataset.f] = el.value;
      st.limit = 100;
      if (el.tagName === 'INPUT') { clearTimeout(st.t); st.t = setTimeout(() => rerender(name), 250); } else rerender(name);
    }));
    $$('tr.click', root).forEach((tr) => tr.addEventListener('click', () => openRecord(name, Number(tr.dataset.i))));
    $('[data-act=add]', root).addEventListener('click', () => openRecord(name, -1));
    $('[data-act=more]', root)?.addEventListener('click', () => { st.limit += 200; rerender(name); });
    $('[data-act=export]', root).addEventListener('click', () => exportLedger(name, rows.map((r) => r.x)));
    $('[data-act=tpl]', root).addEventListener('click', () => template(name));
    $('[data-act=import]', root).addEventListener('change', (e) => { importLedger(name, e.target.files[0]); e.target.value = ''; });
  }

  function rerender(name) {
    if (name === 'stock') renderStock();
    else renderLedger(name, `#view-${name}`);
  }

  function rowToCsv(name, r) {
    return LEDGERS[name].csv.map((k) => (k === 'sku' ? (product(r.productId)?.sku || r.productId) : r[k]));
  }
  function exportLedger(name, rows) {
    const cfg = LEDGERS[name];
    const csv = toCsv([cfg.csv, ...rows.map((r) => rowToCsv(name, r))]);
    window.A.download(`ballop-${name}-${today()}.csv`, new Blob([`﻿${csv}`], { type: 'text/csv' }));
  }
  function template(name) {
    const p = window.A.products[0] || { sku: 'PP-01', sizes: ['42'], price: 1499000 };
    const ex = {
      sales: [today(), 'shopee', 'INV123', p.sku, p.sizes[0] || '', 1, p.price, 0, 0, 0, 'completed', ''],
      ads: [today(), 'meta', 'Prospecting', 250000, 40000, 900, 4, 5996000, ''],
      expenses: [today(), 'Packaging', 150000, 'Box + tissue'],
      stock: [today(), 'in', p.sku, p.sizes[0] || '', 20, p.cost || 650000, 'Restock'],
    }[name];
    window.A.download(`template-${name}.csv`, new Blob([`﻿${toCsv([LEDGERS[name].csv, ex])}`], { type: 'text/csv' }));
  }
  async function importLedger(name, file) {
    if (!file) return;
    const rows = parseCsv((await file.text()).replace(/^﻿/, ''));
    if (rows.length < 2) { toast('CSV kosong', true); return; }
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (row, k) => { const i = head.indexOf(k.toLowerCase()); return i >= 0 ? row[i] : ''; };
    let ok = 0, skipped = 0;
    const out = [];
    rows.slice(1).forEach((row) => {
      const r = { id: '' };
      LEDGERS[name].csv.forEach((k) => {
        const v = col(row, k);
        if (k === 'sku') { const p = findProduct(v || col(row, 'product') || col(row, 'produk')); r.productId = p ? p.id : ''; }
        else if (k === 'date') r.date = toIso(v);
        else if (k === 'channel') r.channel = normChannel(v, name === 'ads' ? ADS_CH : SALES_CH);
        else if (k === 'status') r.status = /retur|return/i.test(v) ? 'returned' : /batal|cancel/i.test(v) ? 'cancelled' : 'completed';
        else if (k === 'type') r.type = /adj|sesuai|opname/i.test(v) ? 'adjust' : 'in';
        else if (['qty', 'price', 'discount', 'fee', 'shipping', 'spend', 'impressions', 'clicks', 'orders', 'revenue', 'amount', 'cost'].includes(k)) r[k] = toNum(v);
        else r[k] = String(v || '').trim();
      });
      if ((name === 'sales' || name === 'stock') && !r.productId) { skipped++; return; }
      out.push(r); ok++;
    });
    if (!ok) { toast(`Tidak ada baris valid (${skipped} dilewati: produk/SKU tidak dikenal)`, true); return; }
    data[name].push(...out);
    await save(name, `${ok} baris diimport${skipped ? `, ${skipped} dilewati` : ''}`);
  }

  async function save(name, msg) {
    try {
      data[name] = await api(`/api/${name}`, json('PUT', data[name]));
      refresh();
      if (msg) toast(msg);
    } catch (e) { toast(e.message, true); }
  }

  // ---------- record drawer ----------
  const rec = { name: '', index: -1 };
  const form = $('#recEditor');
  function openRecord(name, index) {
    const cfg = LEDGERS[name];
    if ((name === 'sales' || name === 'stock') && !window.A.products.length) { toast('Tambah produk dulu di menu Produk', true); return; }
    rec.name = name; rec.index = index;
    const row = index >= 0 ? data[name][index] : null;
    $('#recTitle').textContent = `${index >= 0 ? 'Edit' : 'Catat'} ${cfg.title.toLowerCase().replace('riwayat ', '')}`;
    $('#recDelete').hidden = index < 0;
    $('#recAgain').hidden = index >= 0;
    // fields: pair the "half" ones into rows
    const html = [];
    let pend = [];
    const fieldHtml = (fd) => {
      const id = `rf-${fd.k}`;
      if (fd.type === 'select') return `<label for="${id}">${fd.label}<select id="${id}" name="${fd.k}"></select></label>`;
      const attrs = fd.type === 'number' ? `type="number" step="${fd.step || 1}" ${fd.allowNeg ? '' : `min="${fd.min ?? 0}"`}` : fd.type === 'date' ? 'type="date" required' : 'type="text" maxlength="200"';
      return `<label for="${id}">${fd.label}<input id="${id}" name="${fd.k}" ${attrs}></label>`;
    };
    cfg.fields.forEach((fd) => {
      if (fd.half) { pend.push(fieldHtml(fd)); if (pend.length === 2) { html.push(`<div class="row">${pend.join('')}</div>`); pend = []; } }
      else { if (pend.length) { html.push(`<div class="row">${pend.join('')}</div>`); pend = []; } html.push(fieldHtml(fd)); }
    });
    if (pend.length) html.push(`<div class="row">${pend.join('')}</div>`);
    if (cfg.summary) html.push('<p class="demo-note glass" id="recSummary"></p>');
    $('#recFields').innerHTML = html.join('');
    const f = form.elements;
    // order matters: product before size
    cfg.fields.forEach((fd) => { if (fd.type === 'select') fillSelect(f[fd.k], fd.options(f)); });
    const last = lstate[name] || {};
    cfg.fields.forEach((fd) => {
      const el = f[fd.k];
      if (row) el.value = row[fd.k] ?? '';
      else if (fd.k === 'date') el.value = today();
      else if (fd.k === 'channel' && last.channel) el.value = last.channel;
      else if (fd.def != null) el.value = fd.def;
      if (fd.type === 'select' && fd.k === 'productId') { cfg.onChange?.(f, 'productId'); if (row) { fillSelect(f.size, LEDGERS[name].fields.find((x) => x.k === 'size').options(f)); f.size.value = row.size; f.price && (f.price.value = row.price); f.cost && (f.cost.value = row.cost || ''); } }
    });
    const upd = () => { if (cfg.summary) $('#recSummary').textContent = cfg.summary(f); };
    $('#recFields').oninput = upd;
    $('#recFields').onchange = (e) => { cfg.onChange?.(f, e.target.name); upd(); };
    upd();
    window.A.openScrim();
    $('#recDrawer').classList.add('open');
    $('#recDrawer').setAttribute('aria-hidden', 'false');
    setTimeout(() => f[cfg.fields[0].k].focus(), 300);
  }
  function closeRecord() {
    $('#recDrawer').classList.remove('open');
    $('#recDrawer').setAttribute('aria-hidden', 'true');
    window.A.closeScrim();
    rec.name = '';
  }
  $$('[data-rec-close]').forEach((b) => b.addEventListener('click', closeRecord));
  $('#scrim').addEventListener('click', () => { if (rec.name) closeRecord(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && rec.name) closeRecord(); });

  function readForm() {
    const f = form.elements;
    const r = {};
    LEDGERS[rec.name].fields.forEach((fd) => {
      r[fd.k] = fd.type === 'number' ? Number(f[fd.k].value) || 0 : f[fd.k].value;
    });
    return r;
  }
  async function submitRecord(again) {
    if (!form.reportValidity()) return;
    const name = rec.name;
    const r = readForm();
    if (name === 'sales' && r.qty < 1) { toast('Jumlah minimal 1', true); return; }
    if (name === 'stock' && !r.qty) { toast('Jumlah tidak boleh 0', true); return; }
    if (rec.index >= 0) {
      data[name][rec.index] = { ...data[name][rec.index], ...r };
    } else if (name === 'stock' && r.size === '*') {
      const p = product(r.productId);
      (p && p.sizes.length ? p.sizes : ['']).forEach((s) => data.stock.push({ ...r, size: s, id: '' }));
    } else {
      data[name].push({ ...r, id: '' });
    }
    await save(name, rec.index >= 0 ? 'Tersimpan' : 'Dicatat');
    if (again) {
      const keep = { date: r.date, channel: r.channel, orderId: r.orderId };
      openRecord(name, -1);
      const f = form.elements;
      Object.entries(keep).forEach(([k, v]) => { if (f[k] && v) f[k].value = v; });
    } else closeRecord();
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); submitRecord(false); });
  $('#recAgain').addEventListener('click', () => submitRecord(true));
  $('#recDelete').addEventListener('click', async () => {
    if (rec.index < 0 || !confirm('Hapus catatan ini?')) return;
    const name = rec.name;
    data[name].splice(rec.index, 1);
    closeRecord();
    await save(name, 'Dihapus');
  });

  // ---------- stock view ----------
  function renderStock() {
    const v = $('#view-stock');
    const lv = stockLevels();
    let totalLeft = 0, totalValue = 0, low = 0, out = 0;
    const rows = window.A.products.map((p) => {
      const sizes = p.sizes.length ? p.sizes : [''];
      const extra = Object.keys(lv[p.id] || {}).filter((s) => !sizes.includes(s));
      let pin = 0, psold = 0;
      const chips = [...sizes, ...extra].map((s) => {
        const c = lv[p.id]?.[s] || { in: 0, sold: 0 };
        const left = c.in - c.sold;
        pin += c.in; psold += c.sold;
        const cls = left <= 0 ? 'zero' : left <= lowLimit(p) ? 'low' : '';
        if (c.in || c.sold) { if (left <= 0) out++; else if (left <= lowLimit(p)) low++; }
        return `<span class="${cls}" title="Ukuran ${esc(s || '–')}: masuk ${c.in}, terjual ${c.sold}">${esc(s || '–')}: ${left}</span>`;
      }).join('');
      const left = pin - psold;
      const value = Math.max(0, left) * unitCost(p.id);
      totalLeft += left; totalValue += value;
      return `<tr><td><b>${esc(p.name)} ${esc(p.series)}</b><br><span class="muted small">${esc(p.sku || '')}</span></td><td><div class="sizes-mini">${chips}</div></td><td class="num">${num(pin)}</td><td class="num">${num(psold)}</td><td class="num"><b>${num(left)}</b></td><td class="num">${money(value)}</td><td><button class="btn sm" type="button" data-restock="${esc(p.id)}">+ Restock</button></td></tr>`;
    }).join('');
    v.innerHTML = `
      <header class="bar"><div><h1>Stok</h1><p class="muted">Sisa = barang masuk + penyesuaian − terjual (status Selesai). Retur & batal tidak mengurangi stok.</p></div></header>
      <div class="sum-cards">
        <div class="sum-card solid"><div class="k-label">Total sisa</div><div class="k-value">${num(totalLeft)} pasang</div></div>
        <div class="sum-card solid"><div class="k-label">Nilai stok (modal)</div><div class="k-value">${money(totalValue)}</div></div>
        <div class="sum-card solid"><div class="k-label">Ukuran stok rendah</div><div class="k-value" style="color:var(--warn)">${num(low)}</div><div class="k-sub">batas default ${window.A.settings.lowStock || 5} pasang</div></div>
        <div class="sum-card solid"><div class="k-label">Ukuran habis</div><div class="k-value" style="color:var(--danger)">${num(out)}</div></div>
      </div>
      <section class="panel solid" style="margin-bottom:16px">
        <div class="panel-head"><h2>Stok per produk</h2><button class="btn sm primary" type="button" id="restockAll">+ Restock</button></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Produk</th><th>Sisa per ukuran</th><th class="num">Masuk</th><th class="num">Terjual</th><th class="num">Sisa</th><th class="num">Nilai</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="muted">Belum ada produk.</td></tr>'}</tbody>
        </table></div>
      </section>
      <section class="panel solid" id="stockLedger"></section>`;
    renderLedger('stock', '#stockLedger', { header: false });
    $('#restockAll').addEventListener('click', () => openRecord('stock', -1));
    $$('[data-restock]', v).forEach((b) => b.addEventListener('click', () => {
      openRecord('stock', -1);
      const f = form.elements;
      f.productId.value = b.dataset.restock;
      LEDGERS.stock.onChange(f, 'productId');
      f.size.value = '*';
    }));
  }

  // ---------- ads summary on top of the ads ledger ----------
  function renderAds() {
    const st = lstate.ads = lstate.ads || { range: '30d', channel: '', q: '', limit: 100 };
    const r = st.range === 'all' ? { from: '0000-00-00', to: '9999-12-31' } : resolveRange(st.range);
    const m = compute(r.from, r.to);
    const cards = Object.entries(ADS_CH).filter(([k]) => m.byAd[k]).map(([k, c]) => {
      const x = m.byAd[k];
      return `<div class="sum-card solid"><div class="k-label"><i style="width:8px;height:8px;border-radius:50%;background:${c.color};display:inline-block"></i>${c.label}</div><div class="k-value">${money(x.spend)}</div><div class="k-sub">ROAS ${ratio(x.revenue / x.spend)} · CPC ${x.clicks ? money(x.spend / x.clicks) : '–'}</div></div>`;
    }).join('');
    renderLedger('ads', '#view-ads', { before: cards ? `<div class="sum-cards">${cards}</div>` : '' });
  }
  function renderSales() {
    const st = lstate.sales = lstate.sales || { range: '30d', channel: '', product: '', status: '', q: '', limit: 100 };
    const r = st.range === 'all' ? { from: '0000-00-00', to: '9999-12-31' } : resolveRange(st.range);
    const m = compute(r.from, r.to);
    const cards = Object.entries(SALES_CH).filter(([k]) => m.byCh[k]).map(([k, c]) => {
      const x = m.byCh[k];
      return `<div class="sum-card solid"><div class="k-label"><i style="width:8px;height:8px;border-radius:50%;background:${c.color};display:inline-block"></i>${c.label}</div><div class="k-value">${money(x.revenue)}</div><div class="k-sub">${num(x.units)} pasang · ${num(x.orders)} pesanan</div></div>`;
    }).join('');
    renderLedger('sales', '#view-sales', { before: cards ? `<div class="sum-cards">${cards}</div>` : '' });
  }

  // ---------- demo data ----------
  async function fillDemo() {
    const prods = window.A.products;
    if (!prods.length) { toast('Tambah produk dulu', true); return; }
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const t = today();
    const start = addDays(t, -75);
    prods.forEach((p) => (p.sizes.length ? p.sizes : ['']).forEach((s) => data.stock.push({ id: '', date: start, type: 'in', productId: p.id, size: s, qty: 12 + Math.floor(rnd() * 10), cost: p.cost || 650000, note: `${DEMO} stok awal` })));
    let inv = 1000;
    for (let d = 0; d <= 75; d++) {
      const date = addDays(start, d);
      const boost = 1 + d / 75; // business growing
      [['shopee', 2.2, 0.08], ['tiktok', 1.6, 0.06], ['website', 0.5, 0], ['offline', 0.15, 0]].forEach(([ch, rate, feeRate]) => {
        const n = Math.floor(rate * boost * (0.4 + rnd() * 1.2));
        for (let k = 0; k < n; k++) {
          const p = pick(prods);
          const price = ch === 'offline' ? p.price : Math.round(p.price * (0.85 + rnd() * 0.1) / 1000) * 1000;
          const disc = rnd() < 0.3 ? 50000 : 0;
          data.sales.push({ id: '', date, channel: ch, orderId: `D${inv++}`, productId: p.id, size: pick(p.sizes.length ? p.sizes : ['']), qty: rnd() < 0.1 ? 2 : 1, price, discount: disc, fee: Math.round(price * feeRate), shipping: ch === 'website' ? 15000 : 0, status: rnd() < 0.04 ? 'returned' : 'completed', note: DEMO });
        }
      });
      [['meta', 180000, 1.4], ['shopee', 120000, 3.2], ['tiktok', 150000, 2.6]].forEach(([ch, base, roas]) => {
        const spend = Math.round(base * boost * (0.7 + rnd() * 0.6) / 1000) * 1000;
        const impressions = Math.round(spend / (ch === 'meta' ? 25 : 18));
        const clicks = Math.round(impressions * (0.009 + rnd() * 0.012));
        const revenue = Math.round(spend * roas * (0.6 + rnd() * 0.8) / 1000) * 1000;
        data.ads.push({ id: '', date, channel: ch, campaign: ch === 'meta' ? 'Prospecting Padel' : ch === 'shopee' ? 'Iklan Pencarian' : 'Live + Video Shopping', spend, impressions, clicks, orders: Math.round(revenue / 1350000), revenue, note: DEMO });
      });
      if (d % 15 === 0) data.expenses.push({ id: '', date, category: pick(['Packaging', 'Konten / KOL', 'Event', 'Operasional']), amount: Math.round((300000 + rnd() * 1500000) / 1000) * 1000, note: DEMO });
    }
    await Promise.all(['sales', 'stock', 'ads', 'expenses'].map((n) => api(`/api/${n}`, json('PUT', data[n])).then((r) => { data[n] = r; })));
    refresh();
    toast('Data contoh dibuat');
  }
  async function clearDemo() {
    if (!confirm('Hapus semua data contoh? Data asli yang kamu catat tidak ikut terhapus.')) return;
    for (const n of ['sales', 'stock', 'ads', 'expenses']) {
      const keep = data[n].filter((r) => !(r.note || '').startsWith(DEMO));
      if (keep.length !== data[n].length) data[n] = await api(`/api/${n}`, json('PUT', keep));
    }
    refresh();
    toast('Data contoh dihapus');
  }

  // ---------- wiring ----------
  let current = 'dashboard';
  function refresh() {
    if (current === 'dashboard') renderDashboard();
    else if (current === 'sales') renderSales();
    else if (current === 'ads') renderAds();
    else if (current === 'stock') renderStock();
    else if (current === 'expenses') renderLedger('expenses', '#view-expenses');
  }
  document.addEventListener('admin:ready', async () => {
    setRange('30d');
    renderDashboard();
    try {
      const [s, st, a, x] = await Promise.all(['sales', 'stock', 'ads', 'expenses'].map((n) => api(`/api/${n}`)));
      Object.assign(data, { sales: s, stock: st, ads: a, expenses: x });
      loaded = true;
      refresh();
    } catch (e) { toast(e.message, true); }
  });
  document.addEventListener('admin:view', (e) => { current = e.detail; if (loaded) refresh(); });
  document.addEventListener('admin:settings', () => { if (loaded) refresh(); });
  document.addEventListener('admin:products', () => { if (loaded) refresh(); });
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (current === 'dashboard' && loaded) renderDashboard(); }, 200); });
})();
