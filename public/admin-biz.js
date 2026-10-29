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
    tokopedia: { label: 'Tokopedia', color: '#008300' },
    lazada: { label: 'Lazada', color: '#e87ba4' },
    blibli: { label: 'Blibli', color: '#eda100' },
    website: { label: 'Website / WA', color: '#1baf7a' },
    offline: { label: 'Offline / Event', color: '#6250d6' },
    other: { label: 'Lainnya', color: '#8a8f99' },
  };
  const ADS_CH = {
    meta: { label: 'Meta Ads', color: '#6250d6' },
    shopee: { label: 'Shopee Ads', color: '#eb6834' },
    tiktok: { label: 'TikTok Ads', color: '#2a78d6' },
    lazada: { label: 'Lazada Ads', color: '#e87ba4' },
    blibli: { label: 'Blibli Ads', color: '#eda100' },
    google: { label: 'Google Ads', color: '#1baf7a' },
    other: { label: 'Lainnya', color: '#8a8f99' },
  };
  const STATUS = { completed: 'Selesai', returned: 'Retur', cancelled: 'Batal' };
  const EXP_CATS = ['Gaji', 'Packaging', 'Ongkir', 'Sewa', 'Event', 'Konten / KOL', 'Operasional', 'Lainnya'];
  const DEMO = '[DEMO]';
  const MOVE = { in: 'Masuk', out: 'Keluar', adjust: 'Penyesuaian' };
  const OFF_TYPES = { toko: 'Toko', distributor: 'Distributor', reseller: 'Reseller', event: 'Event / bazar' };
  const PAY = { lunas: 'Lunas', tempo: 'Tempo', belum: 'Belum bayar' };
  const PLATFORM = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', other: 'Lainnya' };
  const SHIP = { siap: 'Siap kirim', dikirim: 'Dikirim', diterima: 'Diterima', batal: 'Batal' };
  const CONTENT = { menunggu: 'Menunggu', brief: 'Brief dikirim', draft: 'Draft', revisi: 'Revisi', posted: 'Sudah posting', tidak: 'Tidak posting' };
  const CASH_CATS = ['Penjualan offline', 'Pencairan marketplace', 'Modal', 'Pembelian stok', 'Iklan', 'Gaji', 'Ongkir', 'Packaging', 'KOL / endorse', 'Event', 'Sewa', 'Pajak', 'Lainnya'];

  const COLLS = ['sales', 'stock', 'ads', 'expenses', 'orders', 'settlements', 'offline', 'stock3pl', 'kol', 'cashflow', 'contents', 'contentplans'];
  const extraViews = {}; // views added by other admin modules (admin-konten.js)
  const data = Object.fromEntries(COLLS.map((c) => [c, []]));
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
        const dates = [...data.sales, ...data.orders, ...data.offline, ...data.ads, ...data.expenses].map((r) => r.date).sort();
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
  const productBySku = (sku) => {
    if (!sku) return null;
    const s = String(sku).toLowerCase();
    return window.A.products.find((p) => (p.sku && p.sku.toLowerCase() === s) || (p.variants || []).some((v) => v.sku && v.sku.toLowerCase() === s));
  };
  // product keys are a product id, or "n:<marketplace name>" for imported lines with no matching SKU
  const pname = (id) => {
    if (String(id).startsWith('n:')) return id.slice(2);
    const p = product(id);
    return p ? `${p.name} ${p.series}`.trim() : '(produk dihapus)';
  };
  // weighted average purchase cost from restocks, falling back to the product's HPP
  function unitCost(id) {
    let q = 0, c = 0;
    data.stock.forEach((s) => { if (s.productId === id && s.type === 'in' && s.cost > 0 && s.qty > 0) { q += s.qty; c += s.qty * s.cost; } });
    return q ? c / q : (product(id)?.cost || 0);
  }
  function stockLevels() {
    const lv = {}; // productId -> size -> {in, sold}
    const cell = (p, s) => { lv[p] = lv[p] || {}; lv[p][s] = lv[p][s] || { in: 0, sold: 0 }; return lv[p][s]; };
    // own warehouse: inbound + adjustments − outbound − manual & offline sales (marketplace orders ship from 3PL)
    data.stock.forEach((r) => { cell(r.productId, r.size || '').in += r.type === 'out' ? -Math.abs(r.qty) : r.qty; });
    data.sales.forEach((r) => { if (r.status === 'completed') cell(r.productId, r.size || '').sold += r.qty; });
    data.offline.forEach((r) => { if (r.status === 'completed') cell(r.productId, r.size || '').sold += r.qty; });
    return lv;
  }
  const cogsRate = () => (window.A.settings.cogsRate ?? 0.35);
  const lowLimit = (p) => p.lowStock || window.A.settings.lowStock || 5;

  // ---------- metrics ----------
  const lineGross = (r) => r.qty * r.price;
  const lineNet = (r) => lineGross(r) - r.discount;
  // every sale source (manual, imported marketplace orders, offline) as one shape:
  // { date, channel, orderKey, pkey, qty, gross, discount, net, fee, shipping, cost, state }
  function saleLines(from, to) {
    const inR = (r) => r.date >= from && r.date <= to;
    const lines = [];
    data.sales.filter(inR).forEach((r) => lines.push({
      date: r.date, channel: r.channel, orderKey: r.orderId ? `${r.channel}:${r.orderId}` : r.id, pkey: r.productId,
      qty: r.qty, gross: lineGross(r), discount: r.discount, net: lineNet(r), fee: r.fee, shipping: r.shipping,
      cost: r.qty * unitCost(r.productId), state: r.status,
    }));
    data.offline.filter(inR).forEach((r) => lines.push({
      date: r.date, channel: 'offline', orderKey: r.invoice ? `off:${r.invoice}` : r.id, pkey: r.productId,
      qty: r.qty, gross: r.qty * r.price, discount: r.discount, net: r.qty * r.price - r.discount, fee: 0, shipping: 0,
      cost: unitCost(r.productId) ? r.qty * unitCost(r.productId) : (r.qty * r.price - r.discount) * cogsRate(), state: r.status,
    }));
    // marketplace fees come from the settlement export, charged once per order
    const fees = new Map();
    data.settlements.forEach((s) => { const k = `${s.channel}:${s.orderId}`; fees.set(k, (fees.get(k) || 0) + Math.abs(s.fees || 0)); });
    const charged = new Set();
    data.orders.filter(inR).forEach((o) => {
      const p = productBySku(o.sku);
      const ok = `${o.channel}:${o.orderId}`;
      const fee = !charged.has(ok) ? (fees.get(ok) || 0) : 0;
      charged.add(ok);
      const state = o.state === 'pending' ? 'completed' : o.state; // paid & in process counts as sold
      lines.push({
        date: o.date, channel: o.channel, orderKey: ok, pkey: p ? p.id : `n:${o.productName}${o.variation ? ` (${o.variation.replace(/,\s*[^,]*$/, '')})` : ''}`,
        qty: o.qty, gross: o.gross, discount: o.sellerDiscount, net: o.net, fee, shipping: 0,
        cost: p && unitCost(p.id) ? o.qty * unitCost(p.id) : o.net * cogsRate(), estCost: !(p && unitCost(p.id)), state,
      });
    });
    return lines;
  }

  function compute(from, to) {
    const inR = (r) => r.date >= from && r.date <= to;
    const lines = saleLines(from, to);
    const done = lines.filter((r) => r.state === 'completed');
    const ads = data.ads.filter(inR);
    const exp = data.expenses.filter(inR);
    const m = {
      gross: 0, discount: 0, revenue: 0, fees: 0, shipping: 0, cogs: 0, units: 0, orders: 0, unknownCost: 0,
      returns: 0, returnValue: 0, cancelled: 0, adSpend: 0, adRevenue: 0, expenses: 0, payout: 0,
      byCh: {}, byAd: {}, byProduct: {}, byExp: {},
    };
    const orderKeys = new Set();
    done.forEach((r) => {
      m.gross += r.gross; m.discount += r.discount; m.revenue += r.net; m.fees += r.fee; m.shipping += r.shipping;
      m.units += r.qty; m.cogs += r.cost; if (r.estCost) m.unknownCost += r.qty;
      orderKeys.add(r.orderKey);
      const c = m.byCh[r.channel] = m.byCh[r.channel] || { revenue: 0, units: 0, orders: new Set(), fees: 0 };
      c.revenue += r.net; c.units += r.qty; c.fees += r.fee; c.orders.add(r.orderKey);
      const p = m.byProduct[r.pkey] = m.byProduct[r.pkey] || { revenue: 0, units: 0 };
      p.revenue += r.net; p.units += r.qty;
    });
    lines.filter((r) => r.state === 'returned').forEach((r) => { m.returns += r.qty; m.returnValue += r.net; });
    m.cancelled = new Set(lines.filter((r) => r.state === 'cancelled').map((r) => r.orderKey)).size;
    data.settlements.forEach((s) => { const d = s.releaseDate || s.date; if (d >= from && d <= to) m.payout += s.payout; });
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
    const hasData = data.sales.length || data.ads.length || data.orders.length || data.offline.length;
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
        <div class="kpi solid"><div class="k-label">Dana cair marketplace</div><div class="k-value">${money(m.payout)}</div>${delta(m.payout, p.payout)}</div>
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
          ${m.returns ? `<p class="muted small">Retur: ${num(m.returns)} pasang (${money(m.returnValue)}), tidak dihitung di omzet.</p>` : ''}${m.cancelled ? `<p class="muted small">${num(m.cancelled)} pesanan batal tidak dihitung.</p>` : ''}${m.unknownCost ? `<p class="muted small">HPP ${num(m.unknownCost)} pasang memakai estimasi ${pct(cogsRate())} dari omzet (atur di Pengaturan, atau isi HPP per produk).</p>` : ''}
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
      (b, key) => sumBy(m.salesRows, b, (r) => r.channel === key, (r) => r.net), money);
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
    if (/lazada/.test(s)) return 'lazada';
    if (/blibli/.test(s)) return 'blibli';
    if (map === SALES_CH && /tokopedia|tokped/.test(s)) return 'tokopedia';
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
      title: 'Riwayat barang masuk & keluar', add: '+ Catat barang',
      fields: [
        { k: 'date', label: 'Tanggal', type: 'date', half: 1 },
        { k: 'type', label: 'Jenis', type: 'select', options: () => Object.entries(MOVE), half: 1 },
        { k: 'warehouse', label: 'Gudang / lokasi', half: 1, list: () => warehouses() },
        { k: 'ref', label: 'No. dokumen (PO / DO / surat jalan)', half: 1 },
        { k: 'productId', label: 'Produk', type: 'select', options: productOptions },
        { k: 'size', label: 'Ukuran', type: 'select', options: (f) => [['*', 'Semua ukuran (jumlah per ukuran)'], ...sizeOptions(f.productId.value)], half: 1 },
        { k: 'qty', label: 'Jumlah (penyesuaian boleh minus)', type: 'number', step: 1, def: 1, half: 1, allowNeg: true },
        { k: 'party', label: 'Supplier / tujuan', half: 1 },
        { k: 'cost', label: 'Harga modal per pasang', type: 'number', step: 1000, half: 1 },
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
        { label: 'Jenis', get: (r) => `<span class="badge ${r.type === 'in' ? 'live' : r.type === 'out' ? 'bad' : 'warn'}">${MOVE[r.type]}</span>` },
        { label: 'Gudang', get: (r) => esc(r.warehouse || '–') },
        { label: 'Dokumen', get: (r) => esc(r.ref || '–') },
        { label: 'Produk', get: (r) => esc(pname(r.productId)) },
        { label: 'Ukuran', get: (r) => esc(r.size || '–') },
        { label: 'Qty', num: true, get: (r) => { const q = r.type === 'out' ? -Math.abs(r.qty) : r.qty; return q > 0 ? `+${num(q)}` : num(q); }, sum: (r) => (r.type === 'out' ? -Math.abs(r.qty) : r.qty) },
        { label: 'Supplier / tujuan', get: (r) => esc(r.party || '') },
        { label: 'Modal / pasang', num: true, get: (r) => (r.cost ? money(r.cost) : '–') },
        { label: 'Catatan', get: (r) => esc(r.note || '') },
      ],
      filters: ['product', { k: 'type', label: 'Semua jenis', options: () => Object.entries(MOVE) }],
      csv: ['date', 'type', 'warehouse', 'ref', 'sku', 'size', 'qty', 'party', 'cost', 'note'],
    },

    offline: {
      title: 'Penjualan offline', sub: 'Toko, distributor, reseller, dan event. Stok gudang sendiri otomatis berkurang.',
      add: '+ Catat penjualan offline',
      fields: [
        { k: 'date', label: 'Tanggal', type: 'date', half: 1 },
        { k: 'type', label: 'Jenis', type: 'select', options: () => Object.entries(OFF_TYPES), half: 1 },
        { k: 'outlet', label: 'Nama toko / distributor', half: 1, list: () => [...new Set(data.offline.map((r) => r.outlet).filter(Boolean))] },
        { k: 'invoice', label: 'No. invoice / nota', half: 1 },
        { k: 'productId', label: 'Produk', type: 'select', options: productOptions },
        { k: 'size', label: 'Ukuran', type: 'select', options: (f) => sizeOptions(f.productId.value), half: 1 },
        { k: 'qty', label: 'Jumlah (pasang)', type: 'number', min: 1, def: 1, half: 1 },
        { k: 'price', label: 'Harga satuan', type: 'number', step: 1000, half: 1 },
        { k: 'discount', label: 'Diskon (total)', type: 'number', step: 1000, half: 1 },
        { k: 'payment', label: 'Pembayaran', type: 'select', options: () => Object.entries(PAY), half: 1 },
        { k: 'dueDate', label: 'Jatuh tempo (kalau tempo)', type: 'date', optional: 1, half: 1 },
        { k: 'status', label: 'Status', type: 'select', options: () => Object.entries(STATUS) },
        { k: 'note', label: 'Catatan' },
      ],
      onChange(f, k) {
        if (k === 'productId') { const p = product(f.productId.value); fillSelect(f.size, sizeOptions(f.productId.value)); if (p) f.price.value = p.price; }
      },
      summary: (f) => `Total ${money((Number(f.qty.value) || 0) * (Number(f.price.value) || 0) - (Number(f.discount.value) || 0))}`,
      columns: [
        { label: 'Tanggal', get: (r) => fmtDate(r.date) },
        { label: 'Jenis', get: (r) => OFF_TYPES[r.type] },
        { label: 'Toko / distributor', get: (r) => esc(r.outlet || '–') },
        { label: 'Invoice', get: (r) => esc(r.invoice || '–') },
        { label: 'Produk', get: (r) => esc(pname(r.productId)) },
        { label: 'Ukuran', get: (r) => esc(r.size || '–') },
        { label: 'Qty', num: true, get: (r) => num(r.qty), sum: (r) => r.qty },
        { label: 'Total', num: true, get: (r) => money(r.qty * r.price - r.discount), sum: (r) => r.qty * r.price - r.discount, fmt: money },
        { label: 'Bayar', get: (r) => `<span class="badge ${r.payment === 'lunas' ? 'live' : r.payment === 'tempo' ? 'warn' : 'bad'}">${PAY[r.payment]}${r.payment === 'tempo' && r.dueDate ? ` · ${fmtDay(r.dueDate)}` : ''}</span>` },
        { label: 'Status', get: (r) => `<span class="badge ${r.status === 'completed' ? 'live' : 'warn'}">${STATUS[r.status]}</span>` },
      ],
      filters: ['product', 'status', { k: 'type', label: 'Semua jenis', options: () => Object.entries(OFF_TYPES) }, { k: 'payment', label: 'Semua pembayaran', options: () => Object.entries(PAY) }],
      csv: ['date', 'type', 'outlet', 'invoice', 'sku', 'size', 'qty', 'price', 'discount', 'payment', 'dueDate', 'status', 'note'],
    },

    stock3pl: {
      title: 'Riwayat laporan stok 3PL', add: '+ Input stok 3PL',
      fields: [
        { k: 'date', label: 'Tanggal laporan', type: 'date', half: 1 },
        { k: 'warehouse', label: 'Nama gudang 3PL', half: 1, list: () => warehouses() },
        { k: 'productId', label: 'Produk', type: 'select', options: () => [['', '— pakai SKU / nama di bawah —'], ...productOptions()] },
        { k: 'sku', label: 'SKU', half: 1 },
        { k: 'size', label: 'Ukuran', half: 1 },
        { k: 'name', label: 'Nama barang (kalau tidak ada di daftar produk)' },
        { k: 'available', label: 'Tersedia', type: 'number', half: 1 },
        { k: 'reserved', label: 'Dipesan / reserved', type: 'number', half: 1 },
        { k: 'damaged', label: 'Rusak', type: 'number', half: 1 },
        { k: 'note', label: 'Catatan', half: 1 },
      ],
      onChange(f, k) { if (k === 'productId') { const p = product(f.productId.value); if (p) { f.sku.value = p.sku || ''; f.name.value = `${p.name} ${p.series}`; } } },
      columns: [
        { label: 'Tanggal', get: (r) => fmtDate(r.date) },
        { label: 'Gudang', get: (r) => esc(r.warehouse) },
        { label: 'SKU', get: (r) => esc(r.sku || '–') },
        { label: 'Barang', get: (r) => esc(itemName(r)) },
        { label: 'Ukuran', get: (r) => esc(r.size || '–') },
        { label: 'Tersedia', num: true, get: (r) => num(r.available), sum: (r) => r.available },
        { label: 'Reserved', num: true, get: (r) => num(r.reserved), sum: (r) => r.reserved },
        { label: 'Rusak', num: true, get: (r) => num(r.damaged), sum: (r) => r.damaged },
      ],
      filters: [{ k: 'warehouse', label: 'Semua gudang', options: () => warehouses().map((w) => [w, w]) }],
      csv: ['date', 'warehouse', 'sku', 'name', 'size', 'available', 'reserved', 'damaged', 'note'],
    },

    kol: {
      title: 'KOL seeding', sub: 'Pengiriman produk ke KOL, progres konten, dan hasil posting.',
      add: '+ Tambah KOL',
      fields: [
        { k: 'date', label: 'Tanggal kirim', type: 'date', half: 1 },
        { k: 'platform', label: 'Platform', type: 'select', options: () => Object.entries(PLATFORM), half: 1 },
        { k: 'name', label: 'Nama KOL', half: 1 },
        { k: 'handle', label: 'Username (@)', half: 1 },
        { k: 'followers', label: 'Followers', type: 'number', half: 1 },
        { k: 'cost', label: 'Fee / biaya (0 kalau barter)', type: 'number', step: 1000, half: 1 },
        { k: 'productId', label: 'Produk dikirim', type: 'select', options: productOptions },
        { k: 'size', label: 'Ukuran', type: 'select', options: (f) => sizeOptions(f.productId.value), half: 1 },
        { k: 'qty', label: 'Jumlah', type: 'number', min: 1, def: 1, half: 1 },
        { k: 'shipStatus', label: 'Status kirim', type: 'select', options: () => Object.entries(SHIP), half: 1 },
        { k: 'resi', label: 'No. resi', half: 1 },
        { k: 'contentStatus', label: 'Status konten', type: 'select', options: () => Object.entries(CONTENT), half: 1 },
        { k: 'dueDate', label: 'Deadline posting', type: 'date', optional: 1, half: 1 },
        { k: 'postDate', label: 'Tanggal posting', type: 'date', optional: 1, half: 1 },
        { k: 'postUrl', label: 'Link postingan', half: 1 },
        { k: 'views', label: 'Views', type: 'number', half: 1 },
        { k: 'likes', label: 'Likes', type: 'number', half: 1 },
        { k: 'comments', label: 'Komentar', type: 'number', half: 1 },
        { k: 'shares', label: 'Share / save', type: 'number', half: 1 },
        { k: 'note', label: 'Catatan' },
      ],
      summary: (f) => { const v = Number(f.views.value) || 0, e = (Number(f.likes.value) || 0) + (Number(f.comments.value) || 0) + (Number(f.shares.value) || 0), fo = Number(f.followers.value) || 0; return `Engagement ${num(e)} · ER ${pct(fo ? e / fo : NaN)} · biaya per 1.000 views ${v ? money((Number(f.cost.value) || 0) / v * 1000) : '–'}`; },
      columns: [
        { label: 'Kirim', get: (r) => fmtDate(r.date) },
        { label: 'KOL', get: (r) => `<b>${esc(r.name)}</b><br><span class="muted small">${PLATFORM[r.platform]} · @${esc(r.handle.replace(/^@/, ''))} · ${compact(r.followers)}</span>` },
        { label: 'Produk', get: (r) => `${esc(pname(r.productId))}${r.size ? ` · ${esc(r.size)}` : ''}` },
        { label: 'Kirim', get: (r) => `<span class="badge ${r.shipStatus === 'diterima' ? 'live' : r.shipStatus === 'batal' ? 'bad' : 'warn'}">${SHIP[r.shipStatus]}</span>` },
        { label: 'Konten', get: (r) => `<span class="badge ${r.contentStatus === 'posted' ? 'live' : r.contentStatus === 'tidak' ? 'bad' : late(r) ? 'bad' : 'warn'}">${CONTENT[r.contentStatus]}${late(r) ? ' · telat' : ''}</span>` },
        { label: 'Posting', get: (r) => (r.postUrl ? `<a href="${esc(r.postUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${r.postDate ? fmtDay(r.postDate) : 'lihat'} ↗</a>` : r.dueDate ? `deadline ${fmtDay(r.dueDate)}` : '–') },
        { label: 'Views', num: true, get: (r) => num(r.views), sum: (r) => r.views },
        { label: 'Engagement', num: true, get: (r) => num(r.likes + r.comments + r.shares), sum: (r) => r.likes + r.comments + r.shares },
        { label: 'Biaya', num: true, get: (r) => money(r.cost), sum: (r) => r.cost, fmt: money },
      ],
      filters: [{ k: 'platform', label: 'Semua platform', options: () => Object.entries(PLATFORM) }, { k: 'shipStatus', label: 'Semua status kirim', options: () => Object.entries(SHIP) }, { k: 'contentStatus', label: 'Semua status konten', options: () => Object.entries(CONTENT) }],
      csv: ['date', 'name', 'handle', 'platform', 'followers', 'sku', 'size', 'qty', 'resi', 'shipStatus', 'contentStatus', 'dueDate', 'postDate', 'postUrl', 'views', 'likes', 'comments', 'shares', 'cost', 'note'],
    },

    cashflow: {
      title: 'Keuangan', sub: 'Uang masuk dan keluar. Dana cair marketplace dari file income ikut dihitung di ringkasan.',
      add: '+ Catat transaksi',
      fields: [
        { k: 'date', label: 'Tanggal', type: 'date', half: 1 },
        { k: 'type', label: 'Jenis', type: 'select', options: () => [['in', 'Uang masuk'], ['out', 'Uang keluar']], half: 1 },
        { k: 'category', label: 'Kategori', half: 1, list: () => CASH_CATS },
        { k: 'account', label: 'Rekening / kas', half: 1, list: () => [...new Set(['BCA', 'Mandiri', 'Kas kecil', 'Saldo Shopee', 'Saldo TikTok', ...data.cashflow.map((r) => r.account)].filter(Boolean))] },
        { k: 'amount', label: 'Jumlah', type: 'number', step: 1000, half: 1 },
        { k: 'ref', label: 'No. referensi', half: 1 },
        { k: 'note', label: 'Keterangan' },
      ],
      columns: [
        { label: 'Tanggal', get: (r) => fmtDate(r.date) },
        { label: 'Jenis', get: (r) => `<span class="badge ${r.type === 'in' ? 'live' : 'bad'}">${r.type === 'in' ? 'Masuk' : 'Keluar'}</span>` },
        { label: 'Kategori', get: (r) => esc(r.category) },
        { label: 'Rekening', get: (r) => esc(r.account || '–') },
        { label: 'Keterangan', get: (r) => esc(r.note || r.ref || '–') },
        { label: 'Masuk', num: true, get: (r) => (r.type === 'in' ? money(r.amount) : ''), sum: (r) => (r.type === 'in' ? r.amount : 0), fmt: money },
        { label: 'Keluar', num: true, get: (r) => (r.type === 'out' ? money(r.amount) : ''), sum: (r) => (r.type === 'out' ? r.amount : 0), fmt: money },
      ],
      filters: [{ k: 'type', label: 'Masuk & keluar', options: () => [['in', 'Masuk'], ['out', 'Keluar']] }, { k: 'account', label: 'Semua rekening', options: () => [...new Set(data.cashflow.map((r) => r.account).filter(Boolean))].map((a) => [a, a]) }],
      csv: ['date', 'type', 'category', 'account', 'amount', 'ref', 'note'],
    },
  };
  const itemName = (r) => r.name || (r.productId ? pname(r.productId) : '') || r.sku;
  const late = (r) => r.dueDate && r.contentStatus !== 'posted' && r.contentStatus !== 'tidak' && r.dueDate < today();
  function warehouses() { return [...new Set([...data.stock3pl.map((r) => r.warehouse), ...data.stock.map((r) => r.warehouse)].filter(Boolean))]; }

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
    (cfg.filters || []).filter((f) => typeof f === 'object').forEach((f) => { if (st[f.k]) rows = rows.filter((x) => x[f.k] === st[f.k]); });
    if (st.q) { const q = st.q.toLowerCase(); rows = rows.filter((x) => JSON.stringify(x).toLowerCase().includes(q) || pname(x.productId || '').toLowerCase().includes(q)); }
    rows = rows.map((x) => ({ x, i: data[name].indexOf(x) })).sort((a, b) => b.x.date.localeCompare(a.x.date) || b.i - a.i);

    const filt = [];
    filt.push(`<select data-f="range">${[['7d', '7 hari'], ['30d', '30 hari'], ['90d', '90 hari'], ['mtd', 'Bulan ini'], ['lastm', 'Bulan lalu'], ['ytd', 'Tahun ini'], ['all', 'Semua']].map(([k, l]) => `<option value="${k}"${st.range === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`);
    if (cfg.filters.includes('channel')) filt.push(`<select data-f="channel"><option value="">Semua channel</option>${Object.entries(cfg.map).map(([k, c]) => `<option value="${k}"${st.channel === k ? ' selected' : ''}>${c.label}</option>`).join('')}</select>`);
    if (cfg.filters.includes('product')) filt.push(`<select data-f="product"><option value="">Semua produk</option>${productOptions().map(([k, l]) => `<option value="${esc(k)}"${st.product === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
    if (cfg.filters.includes('status')) filt.push(`<select data-f="status"><option value="">Semua status</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${st.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`);
    if (cfg.filters.includes('category')) filt.push(`<select data-f="category"><option value="">Semua kategori</option>${EXP_CATS.map((c) => `<option${st.category === c ? ' selected' : ''}>${c}</option>`).join('')}</select>`);
    (cfg.filters || []).filter((f) => typeof f === 'object').forEach((f) => {
      filt.push(`<select data-f="${f.k}"><option value="">${f.label}</option>${f.options().map(([v, l]) => `<option value="${esc(v)}"${st[f.k] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
    });
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
    const views = { stock: renderStock, stock3pl: renderStock3pl, offline: renderOffline, kol: renderKol, cashflow: renderFinance, sales: renderSales, ads: renderAds };
    if (views[name]) views[name]();
    else if (LEDGERS[name]?.ownView) refresh();
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
        else if (k === 'dueDate' || k === 'postDate') r[k] = v ? toIso(v) : '';
        else if (k === 'channel') r.channel = normChannel(v, name === 'ads' ? ADS_CH : SALES_CH);
        else if (k === 'status') r.status = /retur|return/i.test(v) ? 'returned' : /batal|cancel/i.test(v) ? 'cancelled' : 'completed';
        else if (k === 'type' && name === 'cashflow') r.type = /out|keluar/i.test(v) ? 'out' : 'in';
        else if (k === 'type' && name === 'stock') r.type = /adj|sesuai|opname/i.test(v) ? 'adjust' : /out|keluar/i.test(v) ? 'out' : 'in';
        else if (['qty', 'price', 'discount', 'fee', 'shipping', 'spend', 'impressions', 'clicks', 'orders', 'revenue', 'amount', 'cost', 'available', 'reserved', 'damaged', 'followers', 'views', 'likes', 'comments', 'shares'].includes(k)) r[k] = toNum(v);
        else r[k] = String(v || '').trim();
      });
      if (name === 'stock3pl' && !r.productId) r.productId = '';
      if (['sales', 'stock', 'offline'].includes(name) && !r.productId) { skipped++; return; }
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
    if (['sales', 'stock', 'offline', 'kol'].includes(name) && !window.A.products.length) { toast('Tambah produk dulu di menu Produk', true); return; }
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
      if (fd.type === 'area') return `<label for="${id}">${fd.label}<textarea id="${id}" name="${fd.k}" rows="${fd.rows || 3}" maxlength="2000"></textarea></label>`;
      const attrs = fd.type === 'number' ? `type="number" step="${fd.step || 1}" ${fd.allowNeg ? '' : `min="${fd.min ?? 0}"`}` : fd.type === 'date' ? `type="date"${fd.optional ? '' : ' required'}` : `type="text" maxlength="200"${fd.list ? ` list="${id}-list"` : ''}`;
      const dl = fd.list ? `<datalist id="${id}-list">${fd.list().map((v) => `<option value="${esc(v)}">`).join('')}</datalist>` : '';
      return `<label for="${id}">${fd.label}<input id="${id}" name="${fd.k}" ${attrs}>${dl}</label>`;
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
      if (fd.type === 'select' && fd.k === 'productId') {
        cfg.onChange?.(f, 'productId');
        // editing: refill dependent fields from the saved row, not from the product defaults
        if (row) {
          const sizeField = cfg.fields.find((x) => x.k === 'size');
          if (sizeField?.options) fillSelect(f.size, sizeField.options(f));
          ['size', 'price', 'cost', 'sku', 'name'].forEach((k) => { if (f[k] && row[k] !== undefined) f[k].value = row[k] || ''; });
        }
      }
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
      <header class="bar"><div><h1>Barang masuk & keluar</h1><p class="muted">Stok gudang sendiri = masuk + penyesuaian − keluar − terjual (manual & offline). Pesanan marketplace dikirim dari 3PL, lihat Stok 3PL.</p></div></header>
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

  // ---------- online sales (imported marketplace exports) ----------
  const ORDER_STATE = { completed: 'Selesai', pending: 'Diproses', cancelled: 'Batal', returned: 'Retur' };
  const ost = { range: '30d', channel: '', state: '', q: '', limit: 150 };
  let pending = null; // parsed files waiting for the Import button
  function renderOnline() {
    const v = $('#view-online');
    const r = ost.range === 'all' ? { from: '0000-00-00', to: '9999-12-31' } : resolveRange(ost.range);
    const inR = (x) => x.date >= r.from && x.date <= r.to;
    let rows = data.orders.filter(inR);
    if (ost.channel) rows = rows.filter((x) => x.channel === ost.channel);
    if (ost.state) rows = rows.filter((x) => x.state === ost.state);
    if (ost.q) { const q = ost.q.toLowerCase(); rows = rows.filter((x) => `${x.orderId} ${x.productName} ${x.variation} ${x.sku} ${x.city}`.toLowerCase().includes(q)); }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const live = rows.filter((x) => x.state === 'completed' || x.state === 'pending');
    const orders = new Set(live.map((x) => `${x.channel}:${x.orderId}`));
    const sett = data.settlements.filter((s) => (!ost.channel || s.channel === ost.channel) && (s.releaseDate || s.date) >= r.from && (s.releaseDate || s.date) <= r.to);
    const payoutBy = new Map();
    data.settlements.forEach((s) => { const k = `${s.channel}:${s.orderId}`; payoutBy.set(k, (payoutBy.get(k) || 0) + s.payout); });
    const byProd = {};
    live.forEach((x) => { const k = x.productName; const p = byProd[k] = byProd[k] || { units: 0, revenue: 0, sizes: {} }; p.units += x.qty; p.revenue += x.net; if (x.size) p.sizes[x.size] = (p.sizes[x.size] || 0) + x.qty; });
    const top = Object.entries(byProd).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 12);
    const maxTop = Math.max(1, ...top.map(([, x]) => x.revenue));
    const byCity = {};
    live.forEach((x) => { if (x.province) byCity[x.province] = (byCity[x.province] || 0) + x.qty; });
    const cities = Object.entries(byCity).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const cnt = (st) => new Set(rows.filter((x) => x.state === st).map((x) => `${x.channel}:${x.orderId}`)).size;

    v.innerHTML = `
      <header class="bar"><div><h1>Penjualan online</h1><p class="muted">Import file export Shopee, TikTok Shop, dan Lazada (Tokopedia & Blibli lewat rekap / input manual). Order yang sama di-import ulang akan di-update, tidak dobel.</p></div></header>
      <section class="panel solid import-panel">
        <div class="panel-head"><h2>Import file marketplace</h2><button class="btn sm" type="button" id="impTpl">⬇ Template 4 sheet</button></div>
        <label class="drop" id="impDrop">
          <input type="file" id="impFiles" accept=".xlsx,.xls,.csv" multiple hidden>
          <b>Pilih / seret file export (.xlsx / .csv)</b>
          <span>Order & Income Shopee / TikTok Shop, Order Lazada. Boleh 1 file berisi beberapa sheet, atau beberapa file sekaligus.</span>
        </label>
        <div id="impPreview"></div>
      </section>
      <div class="filters-row" style="margin-top:16px">
        <select data-o="range">${[['7d', '7 hari'], ['30d', '30 hari'], ['90d', '90 hari'], ['mtd', 'Bulan ini'], ['lastm', 'Bulan lalu'], ['ytd', 'Tahun ini'], ['all', 'Semua']].map(([k, l]) => `<option value="${k}"${ost.range === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <select data-o="channel"><option value="">Semua marketplace</option>${['shopee', 'tiktok', 'tokopedia', 'lazada', 'blibli'].map((k) => `<option value="${k}"${ost.channel === k ? ' selected' : ''}>${SALES_CH[k].label}</option>`).join('')}</select>
        <select data-o="state"><option value="">Semua status</option>${Object.entries(ORDER_STATE).map(([k, l]) => `<option value="${k}"${ost.state === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <input type="search" data-o="q" placeholder="Cari order / produk / kota…" value="${esc(ost.q)}">
        <span class="spacer"></span>
        <button class="btn sm" type="button" id="ordExport">⬇ Export</button>
      </div>
      <div class="sum-cards">
        <div class="sum-card solid"><div class="k-label">Pesanan masuk</div><div class="k-value">${num(orders.size)}</div><div class="k-sub">${num(live.reduce((s, x) => s + x.qty, 0))} pasang</div></div>
        <div class="sum-card solid"><div class="k-label">Omzet (setelah diskon)</div><div class="k-value">${money(live.reduce((s, x) => s + x.net, 0))}</div><div class="k-sub">AOV ${orders.size ? money(live.reduce((s, x) => s + x.net, 0) / orders.size) : '–'}</div></div>
        <div class="sum-card solid"><div class="k-label">Dana cair</div><div class="k-value">${money(sett.reduce((s, x) => s + x.payout, 0))}</div><div class="k-sub">${num(sett.length)} transaksi income</div></div>
        <div class="sum-card solid"><div class="k-label">Biaya marketplace</div><div class="k-value">${money(sett.reduce((s, x) => s + Math.abs(x.fees), 0))}</div><div class="k-sub">admin, layanan, afiliasi</div></div>
        <div class="sum-card solid"><div class="k-label">Batal · retur</div><div class="k-value">${num(cnt('cancelled'))} · ${num(cnt('returned'))}</div><div class="k-sub">pesanan</div></div>
      </div>
      <div class="grid-3" style="margin-top:0">
        <section class="panel solid"><div class="panel-head"><h2>Produk terlaris</h2><span class="muted small">omzet · pasang</span></div>
          <div class="hbar">${top.map(([n, x]) => `<div class="hbar-row"><span class="hb-name" title="${esc(n)}">${esc(n)}</span><span class="hb-track"><i style="width:${(x.revenue / maxTop) * 100}%;background:#2a78d6"></i></span><span class="hb-val">${compact(x.revenue)} · ${num(x.units)}</span></div>`).join('') || '<p class="muted">Belum ada data. Import file dulu.</p>'}</div>
        </section>
        <section class="panel solid"><div class="panel-head"><h2>Provinsi teratas</h2><span class="muted small">pasang</span></div>
          <div class="alert-list">${cities.map(([c, q]) => `<div><span>${esc(c)}</span><b>${num(q)}</b></div>`).join('') || '<p class="muted">–</p>'}</div>
        </section>
      </div>
      <section class="panel solid" style="margin-top:14px">
        <div class="panel-head"><h2>Daftar pesanan</h2><span class="muted small">${num(rows.length)} baris</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Tanggal</th><th>Channel</th><th>No. pesanan</th><th>Produk</th><th>Variasi</th><th class="num">Qty</th><th class="num">Omzet</th><th class="num">Dana cair</th><th>Status</th></tr></thead>
          <tbody>${rows.slice(0, ost.limit).map((x) => { const pay = payoutBy.get(`${x.channel}:${x.orderId}`); return `<tr><td>${fmtDate(x.date)}</td><td>${chBadge(SALES_CH, x.channel)}</td><td>${esc(x.orderId)}</td><td title="${esc(x.productName)}">${esc(x.productName.length > 42 ? `${x.productName.slice(0, 40)}…` : x.productName)}</td><td>${esc(x.variation)}</td><td class="num">${num(x.qty)}</td><td class="num">${money(x.net)}</td><td class="num">${pay != null ? money(pay) : '<span class="muted">–</span>'}</td><td><span class="badge ${x.state === 'completed' ? 'live' : x.state === 'pending' ? '' : x.state === 'returned' ? 'warn' : 'bad'}" title="${esc(x.status)}">${ORDER_STATE[x.state]}</span></td></tr>`; }).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">Belum ada pesanan di filter ini.</td></tr>'}</tbody>
        </table></div>
        ${rows.length > ost.limit ? `<p style="text-align:center"><button class="btn sm" type="button" id="ordMore">Tampilkan lebih banyak</button></p>` : ''}
      </section>`;

    $$('[data-o]', v).forEach((el) => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
      ost[el.dataset.o] = el.value; ost.limit = 150;
      if (el.tagName === 'INPUT') { clearTimeout(ost.t); ost.t = setTimeout(renderOnline, 250); } else renderOnline();
    }));
    $('#ordMore')?.addEventListener('click', () => { ost.limit += 300; renderOnline(); });
    $('#ordExport').addEventListener('click', () => {
      const head = ['date', 'channel', 'orderId', 'status', 'sku', 'productName', 'variation', 'size', 'qty', 'unitPrice', 'sellerDiscount', 'platformDiscount', 'net', 'province', 'city', 'courier'];
      window.A.download(`ballop-penjualan-online-${today()}.csv`, new Blob([`﻿${toCsv([head, ...rows.map((x) => head.map((k) => x[k]))])}`], { type: 'text/csv' }));
    });
    $('#impTpl').addEventListener('click', () => window.MarketImport.template().catch((e) => toast(e.message, true)));
    $('#impFiles').addEventListener('change', (e) => { readImport(e.target.files); e.target.value = ''; });
    window.A.dropZone($('#impDrop'), readImport);
    showPreview();
  }

  async function readImport(files) {
    const drop = $('#impDrop');
    drop.classList.add('busy');
    try {
      pending = await window.MarketImport.readFiles([...files]);
      showPreview();
    } catch (e) { toast(e.message, true); }
    drop.classList.remove('busy');
  }
  function showPreview() {
    const box = $('#impPreview');
    if (!box) return;
    if (!pending) { box.innerHTML = ''; return; }
    const { found, unknown } = pending;
    const range = (rows) => { const d = rows.map((x) => x.date).filter(Boolean).sort(); return d.length ? `${fmtDay(d[0])} – ${fmtDate(d[d.length - 1])}` : ''; };
    box.innerHTML = `
      <div class="table-wrap" style="margin-top:12px"><table class="data">
        <thead><tr><th>File / sheet</th><th>Terbaca sebagai</th><th class="num">Baris</th><th>Periode</th></tr></thead>
        <tbody>${found.map((f) => `<tr><td>${esc(f.file)}${f.sheet ? ` › ${esc(f.sheet)}` : ''}</td><td><span class="badge live">${window.MarketImport.KINDS[f.kind].label}</span></td><td class="num">${num(f.rows.length)}</td><td>${range(f.rows)}</td></tr>`).join('')}
        ${unknown.map((u) => `<tr><td>${esc(u)}</td><td colspan="3"><span class="badge bad">Format tidak dikenali, dilewati</span></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="filters-row" style="margin-top:12px"><span class="spacer"></span>
        <button class="btn sm" type="button" id="impCancel">Batal</button>
        <button class="btn sm primary" type="button" id="impGo"${found.length ? '' : ' disabled'}>Import ${num(found.reduce((s, f) => s + f.rows.length, 0))} baris</button></div>`;
    $('#impCancel').addEventListener('click', () => { pending = null; showPreview(); });
    $('#impGo').addEventListener('click', doImport);
  }
  async function doImport() {
    const btn = $('#impGo');
    btn.disabled = true;
    let added = 0, updated = 0;
    try {
      for (const target of ['orders', 'settlements']) {
        const rows = pending.found.filter((f) => window.MarketImport.KINDS[f.kind].target === target).flatMap((f) => f.rows);
        for (let i = 0; i < rows.length; i += 1500) {
          btn.textContent = `Mengimport ${num(i)} / ${num(rows.length)}…`;
          const res = await api('/api/import', json('POST', { kind: target, rows: rows.slice(i, i + 1500) }));
          added += res.added; updated += res.updated;
        }
      }
      [data.orders, data.settlements] = await Promise.all([api('/api/orders'), api('/api/settlements')]);
      pending = null;
      toast(`Import selesai: ${num(added)} baru, ${num(updated)} diperbarui`);
      renderOnline();
    } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Coba lagi'; }
  }

  // ---------- offline / 3PL / KOL / finance ----------
  const rangeOf = (name) => { const st = lstate[name] || { range: '30d' }; return st.range === 'all' ? { from: '0000-00-00', to: '9999-12-31' } : resolveRange(st.range || '30d'); };
  function renderOffline() {
    lstate.offline = lstate.offline || { range: '30d', limit: 100 };
    const r = rangeOf('offline');
    const rows = data.offline.filter((x) => x.date >= r.from && x.date <= r.to && x.status === 'completed');
    const total = rows.reduce((s, x) => s + x.qty * x.price - x.discount, 0);
    const unpaid = data.offline.filter((x) => x.status === 'completed' && x.payment !== 'lunas');
    const overdue = unpaid.filter((x) => x.dueDate && x.dueDate < today());
    const byOutlet = {};
    rows.forEach((x) => { byOutlet[x.outlet || '(tanpa nama)'] = (byOutlet[x.outlet || '(tanpa nama)'] || 0) + x.qty * x.price - x.discount; });
    const topOutlet = Object.entries(byOutlet).sort((a, b) => b[1] - a[1])[0];
    renderLedger('offline', '#view-offline', { before: `<div class="sum-cards">
      <div class="sum-card solid"><div class="k-label">Omzet offline</div><div class="k-value">${money(total)}</div><div class="k-sub">${num(rows.reduce((s, x) => s + x.qty, 0))} pasang</div></div>
      <div class="sum-card solid"><div class="k-label">Piutang (belum lunas)</div><div class="k-value" style="color:var(--warn)">${money(unpaid.reduce((s, x) => s + x.qty * x.price - x.discount, 0))}</div><div class="k-sub">${num(unpaid.length)} transaksi${overdue.length ? ` · <b style="color:var(--danger)">${overdue.length} lewat jatuh tempo</b>` : ''}</div></div>
      <div class="sum-card solid"><div class="k-label">Toko / distributor terbesar</div><div class="k-value" style="font-size:16px">${topOutlet ? esc(topOutlet[0]) : '–'}</div><div class="k-sub">${topOutlet ? money(topOutlet[1]) : ''}</div></div>
    </div>` });
  }

  // latest report per warehouse + item + size
  function latest3pl() {
    const map = new Map();
    data.stock3pl.forEach((r) => {
      const k = `${r.warehouse}|${r.productId || r.sku || r.name}|${r.size}`;
      const cur = map.get(k);
      if (!cur || r.date >= cur.date) map.set(k, r);
    });
    return [...map.values()];
  }
  function renderStock3pl() {
    const v = $('#view-stock3pl');
    const now = latest3pl().sort((a, b) => a.warehouse.localeCompare(b.warehouse) || itemName(a).localeCompare(itemName(b)) || a.size.localeCompare(b.size));
    const limit = window.A.settings.lowStock || 5;
    const tot = now.reduce((s, x) => s + x.available, 0);
    v.innerHTML = `
      <header class="bar"><div><h1>Stok 3PL</h1><p class="muted">Stok terakhir di gudang 3PL. Input manual atau import CSV laporan gudang; yang ditampilkan adalah laporan terbaru per barang.</p></div></header>
      <div class="sum-cards">
        <div class="sum-card solid"><div class="k-label">Total tersedia</div><div class="k-value">${num(tot)} pasang</div><div class="k-sub">${num(new Set(now.map((x) => x.warehouse)).size)} gudang</div></div>
        <div class="sum-card solid"><div class="k-label">Reserved</div><div class="k-value">${num(now.reduce((s, x) => s + x.reserved, 0))}</div></div>
        <div class="sum-card solid"><div class="k-label">Stok rendah (≤ ${limit})</div><div class="k-value" style="color:var(--warn)">${num(now.filter((x) => x.available > 0 && x.available <= limit).length)}</div></div>
        <div class="sum-card solid"><div class="k-label">Habis</div><div class="k-value" style="color:var(--danger)">${num(now.filter((x) => x.available <= 0).length)}</div></div>
      </div>
      <section class="panel solid" style="margin-bottom:16px">
        <div class="panel-head"><h2>Stok sekarang</h2></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Gudang</th><th>SKU</th><th>Barang</th><th>Ukuran</th><th class="num">Tersedia</th><th class="num">Reserved</th><th class="num">Rusak</th><th>Update</th></tr></thead>
          <tbody>${now.map((x) => `<tr><td>${esc(x.warehouse)}</td><td>${esc(x.sku || '–')}</td><td>${esc(itemName(x))}</td><td>${esc(x.size || '–')}</td><td class="num"><span class="badge ${x.available <= 0 ? 'bad' : x.available <= limit ? 'warn' : 'live'}">${num(x.available)}</span></td><td class="num">${num(x.reserved)}</td><td class="num">${num(x.damaged)}</td><td>${fmtDate(x.date)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">Belum ada laporan stok 3PL.</td></tr>'}</tbody>
        </table></div>
      </section>
      <section class="panel solid" id="stock3plLedger"></section>`;
    renderLedger('stock3pl', '#stock3plLedger', { header: false });
  }

  function renderKol() {
    lstate.kol = lstate.kol || { range: 'all', limit: 100 };
    const r = rangeOf('kol');
    const rows = data.kol.filter((x) => x.date >= r.from && x.date <= r.to);
    const posted = rows.filter((x) => x.contentStatus === 'posted');
    const views = posted.reduce((s, x) => s + x.views, 0);
    const cost = rows.reduce((s, x) => s + x.cost, 0);
    const units = rows.filter((x) => x.shipStatus !== 'batal').reduce((s, x) => s + x.qty, 0);
    const seedValue = rows.filter((x) => x.shipStatus !== 'batal').reduce((s, x) => s + x.qty * unitCost(x.productId), 0);
    const lateN = rows.filter(late).length;
    renderLedger('kol', '#view-kol', { before: `<div class="sum-cards">
      <div class="sum-card solid"><div class="k-label">KOL</div><div class="k-value">${num(rows.length)}</div><div class="k-sub">${num(rows.filter((x) => x.shipStatus === 'diterima').length)} sudah terima barang</div></div>
      <div class="sum-card solid"><div class="k-label">Sudah posting</div><div class="k-value">${num(posted.length)} / ${num(rows.length)}</div><div class="k-sub">${pct(rows.length ? posted.length / rows.length : NaN)}${lateN ? ` · <b style="color:var(--danger)">${lateN} telat</b>` : ''}</div></div>
      <div class="sum-card solid"><div class="k-label">Total views</div><div class="k-value">${compact(views)}</div><div class="k-sub">engagement ${compact(posted.reduce((s, x) => s + x.likes + x.comments + x.shares, 0))}</div></div>
      <div class="sum-card solid"><div class="k-label">Biaya seeding</div><div class="k-value">${money(cost + seedValue)}</div><div class="k-sub">fee ${compact(cost)} + barang ${num(units)} psg (${compact(seedValue)})</div></div>
      <div class="sum-card solid"><div class="k-label">Biaya per 1.000 views</div><div class="k-value">${views ? money(((cost + seedValue) / views) * 1000) : '–'}</div></div>
    </div>` });
  }

  function renderFinance() {
    lstate.cashflow = lstate.cashflow || { range: 'mtd', limit: 100 };
    const r = rangeOf('cashflow');
    const rows = data.cashflow.filter((x) => x.date >= r.from && x.date <= r.to);
    const cin = rows.filter((x) => x.type === 'in').reduce((s, x) => s + x.amount, 0);
    const cout = rows.filter((x) => x.type === 'out').reduce((s, x) => s + x.amount, 0);
    const payout = data.settlements.filter((s) => { const d = s.releaseDate || s.date; return d >= r.from && d <= r.to; }).reduce((s, x) => s + x.payout, 0);
    const ads = data.ads.filter((x) => x.date >= r.from && x.date <= r.to).reduce((s, x) => s + x.spend, 0);
    const byCat = {};
    rows.filter((x) => x.type === 'out').forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + x.amount; });
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxCat = Math.max(1, ...cats.map(([, x]) => x));
    renderLedger('cashflow', '#view-finance', { before: `<div class="sum-cards">
      <div class="sum-card solid"><div class="k-label">Uang masuk</div><div class="k-value" style="color:var(--good)">${money(cin)}</div></div>
      <div class="sum-card solid"><div class="k-label">Uang keluar</div><div class="k-value" style="color:var(--danger)">${money(cout)}</div></div>
      <div class="sum-card solid"><div class="k-label">Arus kas bersih</div><div class="k-value">${money(cin - cout)}</div></div>
      <div class="sum-card solid"><div class="k-label">Dana cair marketplace</div><div class="k-value">${money(payout)}</div><div class="k-sub">dari file income (info)</div></div>
      <div class="sum-card solid"><div class="k-label">Spending iklan tercatat</div><div class="k-value">${money(ads)}</div><div class="k-sub">dari menu Iklan (info)</div></div>
    </div>${cats.length ? `<section class="panel solid" style="margin-bottom:14px"><div class="panel-head"><h2>Pengeluaran terbesar</h2></div><div class="hbar">${cats.map(([c, x]) => `<div class="hbar-row"><span class="hb-name">${esc(c)}</span><span class="hb-track"><i style="width:${(x / maxCat) * 100}%;background:#e34948"></i></span><span class="hb-val">${money(x)}</span></div>`).join('')}</div></section>` : ''}` });
  }

  // ---------- wiring ----------
  let current = 'dashboard';
  function refresh() {
    const views = {
      dashboard: renderDashboard, sales: renderSales, ads: renderAds, stock: renderStock, online: renderOnline,
      offline: renderOffline, stock3pl: renderStock3pl, kol: renderKol, finance: renderFinance,
      expenses: () => renderLedger('expenses', '#view-expenses'),
    };
    const fn = views[current] || extraViews[current];
    if (fn && !$(`#view-${current}`).hidden) fn();
  }
  document.addEventListener('admin:ready', async () => {
    setRange('30d');
    renderDashboard();
    // each user only receives the collections their roles allow; the rest stay empty
    const got = await Promise.all(COLLS.map((n) => api(`/api/${n}`).catch(() => [])));
    COLLS.forEach((n, i) => { data[n] = Array.isArray(got[i]) ? got[i] : []; });
    loaded = true;
    refresh();
  });
  document.addEventListener('admin:view', (e) => { current = e.detail; if (loaded) refresh(); });
  document.addEventListener('admin:settings', () => { if (loaded) refresh(); });
  document.addEventListener('admin:products', () => { if (loaded) refresh(); });
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (current === 'dashboard' && loaded) renderDashboard(); }, 200); });

  // shared with other admin modules
  window.Biz = {
    data, LEDGERS, openRecord, save, renderLedger, fillSelect, refresh, productOptions, pname, chBadge,
    fmtDate, fmtDay, money, num, compact, pct, esc, today, addDays, toCsv,
    get loaded() { return loaded; },
    registerView(name, fn) { extraViews[name] = fn; },
  };
})();
