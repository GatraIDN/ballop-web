// BALLOP admin, business side: sales / stock / ads / expenses ledgers and the reporting dashboard.
// Every ledger is a flat list of rows saved whole to /api/<name>; all numbers are derived on the fly.
(() => {
  const { $, $$, api, json, toast } = window.A;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => window.A.money(Math.round(n || 0));
  const num = (n) => Math.round(n || 0).toLocaleString('id-ID');
  const dash = (n) => (n ? num(n) : '–'); // counts an ad platform may not report
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
  const isGmvMax = (c) => /gmv\s*max/i.test(c || '');
  const ADS_CAMPAIGNS = ['Product Ads Shopee', 'Shop Ads Shopee', 'Banner Ads Shopee', 'CPAS Shopee', 'GMV Max Tiktok', 'Manual Campaign Tiktok', 'Live Ads Tiktok', 'Meta Ads'];
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

  const COLLS = ['sales', 'stock', 'ads', 'expenses', 'orders', 'settlements', 'live', 'stockdaily', 'csdaily', 'flashsale', 'listings', 'offline', 'stock3pl', 'kol', 'cashflow', 'contents', 'contentplans'];
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
    ['today', 'Hari ini'], ['yday', 'Kemarin'], ['7d', '7 hari'], ['30d', '30 hari'], ['90d', '90 hari'], ['mtd', 'Bulan ini'], ['lastm', 'Bulan lalu'], ['ytd', 'Tahun ini'], ['all', 'Semua'],
  ];
  let range = { key: '30d', from: '', to: '' };
  function resolveRange(key) {
    const t = today();
    const d = parse(t);
    switch (key) {
      case 'today': return { from: t, to: t };
      case 'yday': return { from: addDays(t, -1), to: addDays(t, -1) };
      case '7d': return { from: addDays(t, -6), to: t };
      case '30d': return { from: addDays(t, -29), to: t };
      case '90d': return { from: addDays(t, -89), to: t };
      case 'mtd': return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: t };
      case 'lastm': return { from: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) };
      case 'ytd': return { from: iso(new Date(d.getFullYear(), 0, 1)), to: t };
      case 'all': {
        const dates = [...data.sales, ...data.orders, ...data.settlements, ...data.offline, ...data.ads, ...data.expenses].map((r) => r.date).filter(Boolean).sort();
        return { from: dates[0] || addDays(t, -29), to: dates.length && dates[dates.length - 1] > t ? dates[dates.length - 1] : t };
      }
      default: return { from: range.from || addDays(t, -29), to: range.to || t };
    }
  }
  function setRange(key, from, to) {
    range = key === 'custom' ? { key, from, to } : { key, ...resolveRange(key) };
  }
  // same period bar as the dashboard, for any page: st holds {range, from, to}
  const periodOf = (st) => (st.range === 'custom' ? { from: st.from, to: st.to } : resolveRange(st.range));
  function rangeBar(st) {
    const r = periodOf(st);
    return `<div class="toolbar"><div class="seg glass">${RANGES.map(([k, l]) => `<button type="button" data-pr="${k}" class="${st.range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="range-custom">dari <input type="date" data-pf="from" value="${r.from}"> s/d <input type="date" data-pf="to" value="${r.to}"></span></div>`;
  }
  function bindRangeBar(root, st, rerender) {
    root.querySelectorAll('[data-pr]').forEach((b) => b.addEventListener('click', () => { st.range = b.dataset.pr; st.limit = 150; rerender(); }));
    root.querySelectorAll('[data-pf]').forEach((el) => el.addEventListener('change', () => {
      const f = root.querySelector('[data-pf="from"]').value, t = root.querySelector('[data-pf="to"]').value;
      if (f && t && f <= t) { Object.assign(st, { range: 'custom', from: f, to: t, limit: 150 }); rerender(); }
    }));
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
    // marketplace orders only; fees and payouts belong to the income section (computeIncome)
    data.orders.filter(inR).forEach((o) => {
      const p = productBySku(o.sku);
      const ok = `${o.channel}:${o.orderId}`;
      const fee = 0;
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

      byCh: {}, byAd: {}, byCamp: {}, byProduct: {}, byExp: {},
    };
    const orderKeys = new Set();
    done.forEach((r) => {
      m.gross += r.gross; m.discount += r.discount; m.revenue += r.net; m.fees += r.fee; m.shipping += r.shipping;
      m.units += r.qty; m.cogs += r.cost; if (r.estCost) m.unknownCost += r.qty;
      orderKeys.add(r.orderKey);
      const c = m.byCh[r.channel] = m.byCh[r.channel] || { revenue: 0, units: 0, orders: new Set(), fees: 0 };
      c.revenue += r.net; c.units += r.qty; c.fees += r.fee; c.orders.add(r.orderKey);
      if (!r.pkey) return;
      const p = m.byProduct[r.pkey] = m.byProduct[r.pkey] || { revenue: 0, units: 0, ch: {} };
      p.revenue += r.net; p.units += r.qty; p.ch[r.channel] = (p.ch[r.channel] || 0) + r.qty;
    });
    lines.filter((r) => r.state === 'returned').forEach((r) => { m.returns += r.qty; m.returnValue += r.net; });
    m.cancelled = new Set(lines.filter((r) => r.state === 'cancelled').map((r) => r.orderKey)).size;
    // every order that came in, by final state, so cancels/returns can be tracked per channel
    m.cancelValue = 0; m.allOrders = 0; m.returnOrders = 0;
    m.byState = {};
    const seen = new Map();
    lines.forEach((r) => {
      if (r.state === 'cancelled') m.cancelValue += r.net;
      const s = m.byState[r.channel] = m.byState[r.channel] || { all: new Set(), completed: new Set(), cancelled: new Set(), returned: new Set(), cancelValue: 0, returnValue: 0 };
      s.all.add(r.orderKey); s[r.state]?.add(r.orderKey);
      if (r.state === 'cancelled') s.cancelValue += r.net;
      if (r.state === 'returned') s.returnValue += r.net;
      seen.set(r.orderKey, r.state);
    });
    m.allOrders = seen.size;
    m.returnOrders = new Set(lines.filter((r) => r.state === 'returned').map((r) => r.orderKey)).size;
    Object.values(m.byState).forEach((s) => { ['all', 'completed', 'cancelled', 'returned'].forEach((k) => { s[k] = s[k].size; }); });
    data.settlements.forEach((s) => { const d = s.releaseDate || s.date; if (d >= from && d <= to) m.payout += s.payout; });
    m.orders = orderKeys.size;
    Object.values(m.byCh).forEach((c) => { c.orders = c.orders.size; });
    // ratios only over rows that report the input (GMV Max has no impressions/clicks), so they don't get skewed
    const newAd = (channel) => ({ channel, spend: 0, impressions: 0, clicks: 0, orders: 0, revenue: 0, spendClicked: 0, spendOrdered: 0, revenueOrdered: 0, clickOrders: 0, impClicks: 0 });
    const addAd = (t, a) => {
      t.spend += a.spend; t.impressions += a.impressions; t.clicks += a.clicks; t.orders += a.orders; t.revenue += a.revenue;
      if (a.clicks) { t.spendClicked += a.spend; t.clickOrders += a.orders; }
      if (a.orders) { t.spendOrdered += a.spend; t.revenueOrdered += a.revenue; }
      if (a.impressions) t.impClicks += a.clicks;
    };
    m.adTot = newAd('');
    ads.forEach((a) => {
      m.adSpend += a.spend; m.adRevenue += a.revenue;
      addAd(m.adTot, a);
      addAd(m.byAd[a.channel] = m.byAd[a.channel] || newAd(a.channel), a);
      const ck = `${a.channel}:${a.campaign || '(tanpa nama)'}`;
      addAd(m.byCamp[ck] = m.byCamp[ck] || { ...newAd(a.channel), name: a.campaign || '(tanpa nama)' }, a);
    });
    m.adRoas = m.adSpend ? m.adRevenue / m.adSpend : NaN;
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

  // income = finished orders whose money reached the wallet, dated by release date; never mixed with orders
  const payDay = (s) => s.releaseDate || s.date || '';
  const TOPUP = 'Biaya Isi Saldo Otomatis (dari Penghasilan)';
  // the payout is already net of the ad top-up; when that channel's ad spend is also in the Iklan menu, add the
  // top-up back so the same money is not counted twice (once inside the payout, once as ad spend)
  const topupBack = (inc, m) => Object.entries(inc.byCh).reduce((s, [k, c]) => s + (m.byAd[k]?.spend ? -c.topup : 0), 0);
  function computeIncome(from, to) {
    const MI = window.MarketImport;
    const rows = data.settlements.filter((s) => payDay(s) >= from && payDay(s) <= to);
    const t = { rows, payout: 0, price: 0, fees: 0, orders: 0, topup: 0, groups: {}, byCh: {} };
    rows.forEach((s) => {
      const c = t.byCh[s.channel] = t.byCh[s.channel] || { payout: 0, price: 0, fees: 0, orders: 0, topup: 0 };
      t.payout += s.payout; c.payout += s.payout;
      if (s.type !== 'Penyesuaian') { t.price += s.productPrice || 0; c.price += s.productPrice || 0; t.orders++; c.orders++; }
      const detail = s.detail && Object.keys(s.detail).length ? s.detail : { 'Biaya marketplace': -Math.abs(s.fees || 0), ...(s.shipping ? { Ongkir: s.shipping } : {}) };
      Object.entries(detail).forEach(([k, v]) => {
        // Shopee ad-balance top-up taken from earnings is ad spend, not a marketplace fee
        if (k === TOPUP) { t.topup += v; c.topup += v; t.groups['Top-up saldo iklan'] = (t.groups['Top-up saldo iklan'] || 0) + v; return; }
        const g = s.type === 'Penyesuaian' ? 'Penyesuaian' : MI.feeGroup(k);
        t.groups[g] = (t.groups[g] || 0) + v;
        if (!MI.NOT_FEES.includes(g)) { t.fees += v; c.fees += v; }
      });
    });
    t.cogs = t.price * cogsRate();
    return t;
  }
  function computeLive(from, to) {
    const rows = (data.live || []).filter((l) => l.date >= from && l.date <= to);
    const t = { rows, sessions: rows.length, minutes: 0, gmv: 0, orders: 0, items: 0, views: 0, impressions: 0, pImp: 0, pClicks: 0, followers: 0, likes: 0, comments: 0, shares: 0, watch: 0 };
    rows.forEach((l) => {
      t.minutes += l.minutes; t.gmv += l.gmv; t.orders += l.orders; t.items += l.items; t.views += l.views; t.impressions += l.impressions;
      t.pImp += l.productImpressions; t.pClicks += l.productClicks; t.followers += l.followers; t.likes += l.likes; t.comments += l.comments; t.shares += l.shares;
      t.watch += l.avgWatch * l.views;
    });
    t.gmvHour = t.minutes ? t.gmv / (t.minutes / 60) : 0;
    t.avgWatch = t.views ? t.watch / t.views : 0;
    return t;
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

  // ---------- month calendars (omzet / ad GMV / ad spend per day) ----------
  // shown month follows the end of the selected range; ‹ › moves it without touching the range
  let calShift = 0;
  const calMonth = () => { const d = parse(range.to); return new Date(d.getFullYear(), d.getMonth() + calShift, 1); };
  const calMoney = (n) => (n >= 1e6 ? `Rp${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 2 })}jt` : n >= 1e3 ? `Rp${Math.round(n / 1e3)}rb` : `Rp${Math.round(n)}`);
  const niceStep = (n) => { if (!n) return 0; const p = Math.pow(10, Math.floor(Math.log10(n))); return Math.max(1, Math.round(n / p)) * p; };
  // days: { 'YYYY-MM-DD': { v, n } }  ->  v = amount, n = count shown under it
  function calendar({ title, days, unit, tiers, sideSub, extra }) {
    const first = calMonth(), y = first.getFullYear(), mo = first.getMonth();
    const len = new Date(y, mo + 1, 0).getDate();
    const key = (d) => iso(new Date(y, mo, d));
    let total = 0, count = 0, best = null, active = 0;
    for (let d = 1; d <= len; d++) {
      const x = days[key(d)];
      if (!x) continue;
      total += x.v; count += x.n || 0; if (x.v) active++;
      if (!best || x.v > best.v) best = { d, ...x };
    }
    const elapsed = iso(new Date(y, mo + 1, 0)) <= today() ? len : Math.max(1, parse(today()).getDate());
    const avg = total / (first > parse(today()) ? 1 : elapsed);
    // fixed thresholds when given (omzet), otherwise relative to this month's daily average
    const [hi, mid] = tiers || [niceStep(avg * 1.5), niceStep(avg * 0.75)];
    const tier = (v) => (!v ? 'zero' : v >= hi ? 'hi' : v >= mid ? 'mid' : 'lo');
    const lead = (first.getDay() + 6) % 7; // Monday first
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell empty"></div>');
    for (let d = 1; d <= len; d++) {
      const x = days[key(d)] || { v: 0, n: 0 };
      cells.push(`<div class="cal-cell ${tier(x.v)}"><b>${d}</b>${x.v ? `<strong>${calMoney(x.v)}</strong>${x.n ? `<small>${num(x.n)} ${unit}</small>` : ''}` : ''}${extra && x.v ? `<small>${extra(x)}</small>` : ''}</div>`);
    }
    const weeks = [[1, 7], [8, 14], [15, 21], [22, 28], [29, len]].filter(([a]) => a <= len)
      .map(([a, b]) => { let s = 0; for (let d = a; d <= b; d++) s += days[key(d)]?.v || 0; return [a === 29 ? '29–akhir' : `${a}–${b}`, s]; });
    const mlabel = `${MONTHS_LONG[mo]} ${y}`;
    return `
      <section class="panel solid cal-panel">
        <div class="panel-head"><h2>${esc(title)} · ${mlabel}</h2>
          <span class="cal-nav"><button class="btn sm" type="button" data-cal="-1" aria-label="Bulan sebelumnya">‹</button><button class="btn sm" type="button" data-cal="1" aria-label="Bulan berikutnya">›</button></span></div>
        <div class="cal-wrap">
          <div>
            <div class="cal-grid cal-head">${['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'].map((h) => `<span>${h}</span>`).join('')}</div>
            <div class="cal-grid">${cells.join('')}</div>
            <div class="cal-legend"><span><i class="hi"></i>min. ${calMoney(hi)}</span><span><i class="mid"></i>${calMoney(mid)} – ${calMoney(hi)}</span><span><i class="lo"></i>&lt; ${calMoney(mid)}</span></div>
          </div>
          <div class="cal-side">
            <div class="cal-card"><span>Total ${esc(title.toLowerCase())}</span><b>${money(total)}</b><small>${count ? `${num(count)} ${unit}` : `${active} hari ada data`}</small></div>
            <div class="cal-card"><span>Rata-rata per hari</span><b>${money(avg)}</b><small>${sideSub || `dari ${elapsed} hari`}</small></div>
            <div class="cal-card"><span>Hari terbaik</span><b>${best && best.v ? `${best.d} ${MONTHS[mo]} · ${calMoney(best.v)}` : '–'}</b><small>${best && best.n ? `${num(best.n)} ${unit}` : ''}</small></div>
            <table class="cal-weeks"><thead><tr><th>Minggu</th><th>${esc(title.split(' ')[0])}</th></tr></thead><tbody>${weeks.map(([l, s]) => `<tr><td>${l}</td><td>${s ? calMoney(s) : '–'}</td></tr>`).join('')}</tbody></table>
          </div>
        </div>
      </section>`;
  }
  // per-day maps for the calendar month
  function calDays() {
    const first = calMonth();
    const from = iso(first), to = iso(new Date(first.getFullYear(), first.getMonth() + 1, 0));
    const sales = {}, gmv = {}, spend = {};
    const orders = {};
    saleLines(from, to).filter((r) => r.state === 'completed').forEach((r) => {
      const x = sales[r.date] = sales[r.date] || { v: 0, n: 0 };
      x.v += r.net; (orders[r.date] = orders[r.date] || new Set()).add(r.orderKey);
    });
    Object.entries(orders).forEach(([d, s]) => { sales[d].n = s.size; });
    data.ads.filter((a) => a.date >= from && a.date <= to).forEach((a) => {
      const g = gmv[a.date] = gmv[a.date] || { v: 0, n: 0, spend: 0 };
      g.v += a.revenue; g.n += a.orders; g.spend += a.spend;
      const s = spend[a.date] = spend[a.date] || { v: 0, n: 0, rev: 0 };
      s.v += a.spend; s.rev += a.revenue;
    });
    return { sales, gmv, spend };
  }

  // ---------- dashboard ----------
  function delta(cur, prev, invert = false, neutral = false) {
    if (!prev || !Number.isFinite(prev) || !Number.isFinite(cur)) return '<div class="k-delta">— vs periode lalu</div>';
    const d = (cur - prev) / Math.abs(prev);
    const good = invert ? d < 0 : d > 0;
    return `<div class="k-delta ${d === 0 || neutral ? '' : good ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${pct(Math.abs(d))} vs periode lalu</div>`;
  }

  // ad channels whose campaign table is collapsed (remembered in this browser)
  let campHidden = new Set();
  try { campHidden = new Set(JSON.parse(localStorage.getItem('ballopCampHidden') || '[]')); } catch {}
  let dashTab = 'overview';
  try { dashTab = localStorage.getItem('ballopDashTab2') || 'overview'; } catch {}
  function renderDashboard() {
    const v = $('#view-dashboard');
    if (!loaded) { v.innerHTML = '<p class="muted">Memuat…</p>'; return; }
    const { from, to } = range;
    const len = daysBetween(from, to);
    const m = compute(from, to);
    const p = compute(addDays(from, -len), addDays(from, -1));
    const hasData = data.sales.length || data.ads.length || data.orders.length || data.offline.length || data.settlements.length || data.live.length;
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
    // group size/variant lines into one model: catalog name, or the listing name without its "(43)" / "(EU 38)" suffix
    const t5map = {};
    Object.entries(m.byProduct).forEach(([id, x]) => {
      const pr = product(id), name = pr ? pr.name : pname(id).replace(/\s*\((?:EU\s*)?\d+(?:[.,]\d+)?\)\s*$/i, '').replace(/\s+[–-]\s+Sepatu.*$/i, '').trim();
      const g = t5map[name] = t5map[name] || { id, revenue: 0, units: 0, ch: {}, sizes: 0 };
      g.revenue += x.revenue; g.units += x.units; g.sizes++;
      Object.entries(x.ch || {}).forEach(([c, u]) => { g.ch[c] = (g.ch[c] || 0) + u; });
    });
    const top5 = Object.entries(t5map).sort((a, b) => b[1].units - a[1].units || b[1].revenue - a[1].revenue).slice(0, 5).map(([name, g]) => [g.id, g, name]);
    const top5Html = `<section class="panel solid top5">
        <div class="panel-head"><h2>Top 5 produk paling laku</h2><span class="muted small">${fmtDay(from)}${from !== to ? ` – ${fmtDay(to)}` : ''} · urut unit terjual</span></div>
        ${top5.length ? `<ol class="t5-list">${top5.map(([id, x, nm], i) => { const pr = product(id); return `<li><span class="t5-rank r${i + 1}">${i + 1}</span><span class="t5-dot" style="background:${pr ? pr.color : '#2a78d6'}"></span><div class="t5-name"><b title="${esc(nm)}">${esc(nm)}</b><small class="muted">${Object.entries(x.ch || {}).sort((a, b) => b[1] - a[1]).map(([c, u]) => `${esc((SALES_CH[c] || {}).label || c)} ${num(u)}`).join(' · ')}</small></div><div class="t5-val"><b>${num(x.units)} pcs</b><small class="muted">${money(x.revenue)} · ${pct(m.units ? x.units / m.units : NaN)}</small></div></li>`; }).join('')}</ol>` : '<p class="muted" style="padding:14px">Belum ada produk terjual di periode ini.</p>'}
      </section>`;
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

    // ads numbers are platform attribution, not real sales: their own tab, one section per ad channel
    const adKpis = (x, hero) => `
        <div class="kpis">
          <div class="kpi solid${hero ? ' hero' : ''}"><div class="k-label">Biaya iklan</div><div class="k-value">${money(x.spend)}</div></div>
          <div class="kpi solid"><div class="k-label">Revenue atribusi</div><div class="k-value">${x.revenue ? money(x.revenue) : '–'}</div></div>
          <div class="kpi solid"><div class="k-label">ROAS</div><div class="k-value">${ratio(x.spend ? x.revenue / x.spend : NaN)}</div></div>
          <div class="kpi solid"><div class="k-label">Order atribusi</div><div class="k-value">${dash(x.orders)}</div></div>
          <div class="kpi solid"><div class="k-label">Cost per order</div><div class="k-value">${x.orders ? money(x.spendOrdered / x.orders) : '–'}</div></div>
          <div class="kpi solid"><div class="k-label">AOV iklan (revenue ÷ order)</div><div class="k-value">${x.orders ? money(x.revenueOrdered / x.orders) : '–'}</div></div>
          <div class="kpi solid"><div class="k-label">Impresi</div><div class="k-value">${dash(x.impressions)}</div></div>
          <div class="kpi solid"><div class="k-label">CTR · CPC</div><div class="k-value">${x.impressions ? pct(x.impClicks / x.impressions) : '–'} · ${x.clicks ? compact(x.spendClicked / x.clicks) : '–'}</div></div>
        </div>`;
    const campTable = (rows) => `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Campaign</th><th class="num">Spend</th><th class="num">Revenue atribusi</th><th class="num">ROAS</th><th class="num">Order</th><th class="num">Cost / order</th><th class="num">Impresi</th><th class="num">CTR</th><th class="num">CPC</th></tr></thead>
          <tbody>${rows.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${money(x.spend)}</td><td class="num">${x.revenue ? money(x.revenue) : '–'}</td><td class="num">${ratio(x.spend ? x.revenue / x.spend : NaN)}</td><td class="num">${dash(x.orders)}</td><td class="num">${x.orders ? money(x.spend / x.orders) : '–'}</td><td class="num">${dash(x.impressions)}</td><td class="num">${x.impressions ? pct(x.impClicks / x.impressions) : '–'}</td><td class="num">${x.clicks ? money(x.spendClicked / x.clicks) : '–'}</td></tr>`).join('')}</tbody>
        </table></div>`;
    const cd = calDays();
    const adsDashboard = () => {
      const chs = Object.entries(ADS_CH).filter(([k]) => m.byAd[k]).sort((a, b) => m.byAd[b[0]].spend - m.byAd[a[0]].spend);
      if (!chs.length) return '<p class="muted">Belum ada data iklan di periode ini.</p>';
      return `
      <h2 class="ads-h">Semua channel</h2>
      ${adKpis(m.adTot, true)}
      ${calendar({ title: 'GMV iklan (atribusi)', days: cd.gmv, unit: 'order' })}
      ${calendar({ title: 'Spending iklan', days: cd.spend, unit: '', extra: (x) => `ROAS ${ratio(x.v ? x.rev / x.v : NaN)}` })}
      <section class="panel solid">
        <div class="panel-head"><h2>Biaya iklan per channel</h2>${legend(adSeries)}</div>
        <div class="chart" id="chAds"></div>
      </section>
      ${chs.map(([k, c]) => `
      <h2 class="ads-h"><i style="background:${c.color}"></i>Performa Iklan ${esc(c.label.replace(/ Ads$/, ''))}</h2>
      ${adKpis(m.byAd[k])}
      <section class="panel solid">
        <div class="panel-head"><h2>Campaign ${esc(c.label)}</h2><span class="muted small">${num(Object.values(m.byCamp).filter((x) => x.channel === k).length)} campaign</span>
          <button class="btn sm" type="button" data-camp="${k}">${campHidden.has(k) ? '▾ Tampilkan' : '▴ Sembunyikan'}</button></div>
        ${campHidden.has(k) ? '' : campTable(Object.values(m.byCamp).filter((x) => x.channel === k).sort((a, b) => b.spend - a.spend))}
      </section>`).join('')}
      <p class="muted small">Angka atribusi dari dashboard iklan (bisa termasuk pesanan yang nanti batal/retur); omzet real ada di section Order, uang cair di Income. CTR, CPC & cost per order hanya dari iklan yang mengisi datanya (GMV Max tanpa impresi/klik). “–” = tidak ada data.</p>`;
    };

    // four separate sources: orders (what came in), income (money that reached the wallet), ads, LIVE
    const inc = computeIncome(from, to), incP = computeIncome(addDays(from, -len), addDays(from, -1));
    const live = computeLive(from, to), liveP = computeLive(addDays(from, -len), addDays(from, -1));
    // offline: toko, distributor, reseller, event (completed sales), piutang = not yet paid
    const offOf = (a, b) => {
      const rows = data.offline.filter((x) => x.date >= a && x.date <= b && x.status === 'completed');
      const val = (x) => x.qty * x.price - x.discount;
      const t = { rows, omzet: 0, units: 0, trx: new Set(), unpaid: 0, byOutlet: {}, byType: {}, byProd: {} };
      rows.forEach((x) => {
        const v = val(x); t.omzet += v; t.units += x.qty; t.trx.add(x.invoice || x.id);
        if (x.payment !== 'lunas') t.unpaid += v;
        const o = t.byOutlet[x.outlet || '(tanpa nama)'] = t.byOutlet[x.outlet || '(tanpa nama)'] || { v: 0, q: 0, type: x.type }; o.v += v; o.q += x.qty;
        t.byType[x.type] = (t.byType[x.type] || 0) + v;
        const pk = pname(x.productId); const p = t.byProd[pk] = t.byProd[pk] || { v: 0, q: 0 }; p.v += v; p.q += x.qty;
      });
      t.trx = t.trx.size;
      return t;
    };
    const off = offOf(from, to), offP = offOf(addDays(from, -len), addDays(from, -1));
    const allUnpaid = data.offline.filter((x) => x.status === 'completed' && x.payment !== 'lunas');
    const overdue = allUnpaid.filter((x) => x.dueDate && x.dueDate < today());
    const hours = (min) => `${Math.floor(min / 60)}j ${String(min % 60).padStart(2, '0')}m`;
    const S = dashTab === 'overview' ? summary(from, to) : null;
    const SP = dashTab === 'overview' ? summary(addDays(from, -len), addDays(from, -1)) : null;
    const SECTIONS = {
      overview: { label: 'Ringkasan', sub: 'semua channel digabung', color: '#111318', icon: '▦',
        value: money(m.revenue), meta: `omzet bersih ${compact(inc.payout)} · iklan ${compact(m.adSpend)}`, d: delta(m.revenue, p.revenue) },
      order: { label: 'Order', sub: 'pesanan masuk dari export order', color: '#2a78d6', icon: '◈',
        value: money(m.revenue), meta: `${num(m.orders)} pesanan · ${num(m.units)} pasang`, d: delta(m.revenue, p.revenue) },
      income: { label: 'Income', sub: 'dana cair ke saldo, setelah fee', color: '#0e8a4f', icon: '₪',
        value: money(inc.payout), meta: `${num(inc.orders)} pesanan cair · fee ${inc.price ? pct(Math.abs(inc.fees) / inc.price) : '–'}`, d: delta(inc.payout, incP.payout) },
      ads: { label: 'Iklan', sub: 'spending & atribusi platform iklan', color: '#e8552b', icon: '◎',
        value: money(m.adSpend), meta: `ROAS ${ratio(m.adRoas)} · GMV ${compact(m.adRevenue)}`, d: delta(m.adSpend, p.adSpend, true, true) },
      offline: { label: 'Offline', sub: 'toko, distributor, reseller, event', color: '#0e8a8a', icon: '⌂',
        value: money(off.omzet), meta: `${num(off.trx)} transaksi · ${num(off.units)} pcs`, d: delta(off.omzet, offP.omzet) },
      live: { label: 'Live', sub: 'TikTok LIVE (GMV atribusi)', color: '#6250d6', icon: '●',
        value: money(live.gmv), meta: `${num(live.sessions)} sesi · ${hours(live.minutes)} · ${num(live.orders)} order`, d: delta(live.gmv, liveP.gmv) },
    };
    if (!SECTIONS[dashTab]) dashTab = 'overview';
    const sec = SECTIONS[dashTab];
    const secHead = (title, note, go) => `<div class="sec-head" style="--sec:${sec.color}"><div><h2>${title}</h2><p>${note}</p></div>${go ? `<button class="btn sm" type="button" data-go="${go[0]}">${go[1]} →</button>` : ''}</div>`;
    const kpi = (label, value, d = '', hero = false) => `<div class="kpi solid${hero ? ' hero' : ''}"><div class="k-label">${label}</div><div class="k-value">${value}</div>${d}</div>`;

    const orderTab = () => `
      ${secHead('Order', 'Semua pesanan yang masuk dari export order marketplace, offline & manual. Tanggal = tanggal pesanan dibuat. Belum dipotong fee — lihat Income untuk uang yang benar-benar cair.', ['online', 'Order data'])}
      <div class="kpis">
        ${kpi('Omzet pesanan (selesai + diproses)', money(m.revenue), delta(m.revenue, p.revenue), true)}
        ${kpi('Pesanan · AOV', `${num(m.orders)} · ${compact(m.aov)}`, delta(m.orders, p.orders))}
        ${kpi('Unit terjual', `${num(m.units)} pasang`, delta(m.units, p.units))}
        ${kpi('Pesanan masuk (semua status)', num(m.allOrders), delta(m.allOrders, p.allOrders))}
        ${kpi('Batal · nilai', `${num(m.cancelled)} · ${compact(m.cancelValue)}`, delta(m.cancelled, p.cancelled, true))}
        ${kpi('Retur · nilai', `${num(m.returnOrders)} · ${compact(m.returnValue)}`, delta(m.returnOrders, p.returnOrders, true))}
        ${kpi('Tingkat batal + retur', pct(m.allOrders ? (m.cancelled + m.returnOrders) / m.allOrders : NaN), delta(m.allOrders ? (m.cancelled + m.returnOrders) / m.allOrders : NaN, p.allOrders ? (p.cancelled + p.returnOrders) / p.allOrders : NaN, true))}
        ${kpi('Diskon penjual (dari harga coret)', money(m.discount), delta(m.discount, p.discount, true, true))}
      </div>
      ${top5Html}
      <div class="target solid">
        <div class="target-top"><b>Target ${MONTHS[td.getMonth()]} ${td.getFullYear()}</b><span>${money(mRev)} dari ${target ? money(target) : '(atur di Pengaturan)'}</span><span class="spacer"></span>
          <span>${target ? `${pct(mRev / target)} · proyeksi akhir bulan ${money(projected)}` : ''}</span></div>
        <div class="track" title="Garis = posisi hari ini dalam bulan"><i style="width:${target ? Math.min(100, (mRev / target) * 100) : 0}%"></i><em style="left:${(td.getDate() / mDays) * 100}%"></em></div>
      </div>
      <section class="panel solid">
        <div class="panel-head"><h2>Omzet order per channel</h2>${legend(salesSeries)}</div>
        <div class="chart" id="chSales"></div>
      </section>
      <section class="panel solid">
        <div class="panel-head"><h2>Order per channel</h2><span class="muted small">pesanan masuk → selesai, batal, retur</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Channel</th><th class="num">Omzet</th><th class="num">Unit</th><th class="num">Masuk</th><th class="num">Selesai</th><th class="num">Batal</th><th class="num">Retur</th><th class="num">% batal+retur</th><th class="num">Nilai batal</th></tr></thead>
          <tbody>${Object.entries(SALES_CH).filter(([k]) => m.byState[k]).map(([k, c]) => { const x = m.byCh[k] || { revenue: 0, units: 0 }, s = m.byState[k]; return `<tr><td><span class="ch"><i style="background:${c.color}"></i>${c.label}</span></td><td class="num">${money(x.revenue)}</td><td class="num">${num(x.units)}</td><td class="num">${num(s.all)}</td><td class="num">${num(s.completed)}</td><td class="num">${num(s.cancelled)}</td><td class="num">${num(s.returned)}</td><td class="num">${pct(s.all ? (s.cancelled + s.returned) / s.all : NaN)}</td><td class="num">${money(s.cancelValue)}</td></tr>`; }).join('') || '<tr><td colspan="9" class="muted">Belum ada order di periode ini.</td></tr>'}</tbody>
        </table></div>
      </section>
      ${calendar({ title: 'Omzet order', days: cd.sales, unit: 'order', tiers: [8e6, 4e6] })}
      <div class="grid-3">
        <section class="panel solid">
          <div class="panel-head"><h2>Produk terlaris</h2><span class="muted small">omzet · unit</span></div>
          <div class="hbar">${topProducts.map(([id, x]) => { const pr = product(id); return `<div class="hbar-row"><span class="hb-name" title="${esc(pname(id))}">${esc(pname(id))}</span><span class="hb-track"><i style="width:${(x.revenue / maxTop) * 100}%;background:${pr ? pr.color : '#2a78d6'}"></i></span><span class="hb-val">${compact(x.revenue)} · ${num(x.units)}</span></div>`; }).join('') || '<p class="muted">Belum ada order.</p>'}</div>
        </section>
        <section class="panel solid">
          <div class="panel-head"><h2>Stok menipis</h2><button class="btn sm" type="button" data-go="stock">Kelola stok</button></div>
          <div class="alert-list">${alerts.slice(0, 8).map((a) => `<div><span>${esc(a.name)}${a.size ? ` · ${esc(a.size)}` : ''}</span><span class="badge ${a.left <= 0 ? 'bad' : 'warn'}">${a.left <= 0 ? 'HABIS' : `sisa ${a.left}`}</span></div>`).join('') || '<p class="muted">Semua stok aman.</p>'}</div>
        </section>
      </div>`;

    const incomeTab = () => {
      const MI = window.MarketImport;
      const fg = MI.GROUP_ORDER.filter((g) => inc.groups[g] && !MI.NOT_FEES.includes(g)).map((g) => [g, Math.abs(inc.groups[g])]).sort((a, b) => b[1] - a[1]);
      const maxF = Math.max(1, ...fg.map(([, x]) => x));
      const ads = m.adSpend, opex = m.expenses;
      const back = topupBack(inc, m);
      const profit = inc.payout + back - inc.cogs - ads - opex;
      const incSeries = Object.entries(SALES_CH).map(([key, c]) => ({ key, ...c })).filter((s) => inc.byCh[s.key]);
      return `
      ${secHead('Income', 'Pesanan yang sudah selesai dan dananya sudah masuk ke saldo penjual setelah dipotong semua fee. Tanggal = tanggal dana dilepaskan.', ['income', 'Rincian income'])}
      <div class="kpis">
        ${kpi('Omzet bersih (cair)', money(inc.payout), delta(inc.payout, incP.payout), true)}
        ${kpi('GMV kotor', money(inc.price), delta(inc.price, incP.price))}
        ${kpi('Total fee marketplace', `${money(Math.abs(inc.fees))}`, `<div class="k-delta">${inc.price ? pct(Math.abs(inc.fees) / inc.price) : '–'} dari harga produk</div>`)}
        ${kpi('Pesanan cair', num(inc.orders), delta(inc.orders, incP.orders))}
        ${kpi('Voucher & subsidi', money(inc.groups['Voucher & subsidi'] || 0))}
        ${kpi('Ongkir netto', money(inc.groups['Biaya pengiriman'] || 0))}
        ${kpi('Refund · penyesuaian', `${compact(inc.groups['Pengembalian dana'] || 0)} · ${compact(inc.groups.Penyesuaian || 0)}`)}
        ${kpi('Omzet bersih ÷ GMV kotor', inc.price ? pct(inc.payout / inc.price) : '–', delta(inc.price ? inc.payout / inc.price : NaN, incP.price ? incP.payout / incP.price : NaN))}
      </div>
      <section class="panel solid">
        <div class="panel-head"><h2>Omzet bersih per channel</h2>${legend(incSeries)}</div>
        <div class="chart" id="chIncome"></div>
      </section>
      <div class="grid-3">
        <section class="panel solid">
          <div class="panel-head"><h2>Potongan fee terbesar</h2><span class="muted small">% dari harga produk</span></div>
          <div class="hbar">${fg.map(([g, x]) => `<div class="hbar-row"><span class="hb-name">${esc(g)}</span><span class="hb-track"><i style="width:${(x / maxF) * 100}%;background:#e34948"></i></span><span class="hb-val">${compact(x)} · ${inc.price ? pct(x / inc.price) : '–'}</span></div>`).join('') || '<p class="muted">Belum ada income di periode ini.</p>'}</div>
        </section>
        <section class="panel solid">
          <div class="panel-head"><h2>Laba rugi (basis dana cair)</h2></div>
          <table class="pl">
            <tr><td>Harga produk</td><td>${money(inc.price)}</td></tr>
            <tr class="sub"><td>Fee, voucher, ongkir, refund</td><td>−${money(inc.price - inc.payout)}</td></tr>
            <tr class="mid"><td>Dana cair</td><td>${money(inc.payout)}</td></tr>
            <tr class="sub"><td>HPP (estimasi ${pct(cogsRate())})</td><td>−${money(inc.cogs)}</td></tr>
            <tr class="sub"><td>Biaya iklan</td><td>−${money(ads)}</td></tr>${back ? `<tr class="sub"><td>Koreksi top-up iklan (sudah di spend)</td><td>+${money(back)}</td></tr>` : ''}
            <tr class="sub"><td>Biaya operasional</td><td>−${money(opex)}</td></tr>
            <tr class="total"><td>Laba bersih</td><td style="color:${profit < 0 ? 'var(--danger)' : 'var(--good)'}">${money(profit)}</td></tr>
          </table>
          <p class="muted small">Top-up saldo iklan Shopee yang dipotong dari penghasilan (${money(Math.abs(inc.topup))}) dihitung sebagai biaya iklan, bukan fee${back ? `; karena spend iklan Shopee sudah tercatat di menu Iklan, ${money(back)} ditambahkan kembali supaya tidak dobel` : ''}.</p>
        </section>
      </div>
      <section class="panel solid">
        <div class="panel-head"><h2>Income per channel</h2></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Channel</th><th class="num">Pesanan cair</th><th class="num">Harga produk</th><th class="num">Fee</th><th class="num">Fee %</th><th class="num">Dana cair</th></tr></thead>
          <tbody>${['shopee', 'tiktok', 'tokopedia', 'lazada', 'blibli'].map((k) => { const x = inc.byCh[k]; return `<tr><td>${chBadge(SALES_CH, k)}</td>${x ? `<td class="num">${num(x.orders)}</td><td class="num">${money(x.price)}</td><td class="num">${money(Math.abs(x.fees))}</td><td class="num">${x.price ? pct(Math.abs(x.fees) / x.price) : '–'}</td><td class="num"><b>${money(x.payout)}</b></td>` : '<td colspan="5" class="muted">belum ada file income</td>'}</tr>`; }).slice(0, 3).join('')}</tbody>
        </table></div>
      </section>`;
    };

    const offlineTab = () => {
      const outlets = Object.entries(off.byOutlet).sort((a, b) => b[1].v - a[1].v);
      const maxO = Math.max(1, ...outlets.map(([, x]) => x.v));
      const prods = Object.entries(off.byProd).sort((a, b) => b[1].v - a[1].v).slice(0, 8);
      const maxP = Math.max(1, ...prods.map(([, x]) => x.v));
      const TYPES = { toko: 'Toko', distributor: 'Distributor', reseller: 'Reseller', event: 'Event / bazar' };
      return `
      ${secHead('Offline', 'Penjualan langsung di luar marketplace: toko, distributor, reseller, dan event / bazar (dari menu Penjualan offline). Piutang = transaksi tempo / belum bayar.', ['offline', 'Penjualan offline'])}
      <div class="kpis">
        ${kpi('Omzet offline', money(off.omzet), delta(off.omzet, offP.omzet), true)}
        ${kpi('Transaksi', num(off.trx), delta(off.trx, offP.trx))}
        ${kpi('Unit terjual', `${num(off.units)} pcs`, delta(off.units, offP.units))}
        ${kpi('Rata-rata per transaksi', off.trx ? money(off.omzet / off.trx) : '–')}
        ${kpi('Piutang periode ini', money(off.unpaid), '<div class="k-delta">belum lunas / tempo</div>')}
        ${kpi('Total piutang berjalan', money(allUnpaid.reduce((t2, x) => t2 + x.qty * x.price - x.discount, 0)), `<div class="k-delta${overdue.length ? ' down' : ''}">${num(overdue.length)} lewat jatuh tempo</div>`)}
        ${Object.entries(TYPES).filter(([k]) => off.byType[k]).slice(0, 2).map(([k, l]) => kpi(`Omzet ${l.toLowerCase()}`, money(off.byType[k]))).join('')}
      </div>
      <section class="panel solid">
        <div class="panel-head"><h2>Omzet offline</h2></div>
        <div class="chart" id="chOffline"></div>
      </section>
      <div>
        <section class="panel solid"><div class="panel-head"><h2>Per outlet / event</h2><span class="muted small">omzet · pcs</span></div>
          <div class="hbar">${outlets.map(([n, x]) => `<div class="hbar-row"><span class="hb-name" title="${esc(n)}">${esc(n)} <small class="muted">${esc(TYPES[x.type] || '')}</small></span><span class="hb-track"><i style="width:${(x.v / maxO) * 100}%;background:#0e8a8a"></i></span><span class="hb-val">${compact(x.v)} · ${num(x.q)}</span></div>`).join('') || '<p class="muted">Belum ada penjualan offline di periode ini.</p>'}</div>
        </section>
      </div>
      ${allUnpaid.length ? `<section class="panel solid"><div class="panel-head"><h2>Piutang belum lunas</h2><span class="muted small">${num(allUnpaid.length)} transaksi</span></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Tanggal</th><th>Outlet</th><th>Produk</th><th class="num">Nilai</th><th>Jatuh tempo</th><th>Status</th></tr></thead>
        <tbody>${allUnpaid.sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9')).slice(0, 20).map((x) => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.outlet)}</td><td>${esc(pname(x.productId))}</td><td class="num">${money(x.qty * x.price - x.discount)}</td><td>${x.dueDate ? fmtDate(x.dueDate) : '–'}</td><td><span class="badge ${x.dueDate && x.dueDate < today() ? 'bad' : 'warn'}">${x.dueDate && x.dueDate < today() ? 'Lewat tempo' : x.payment === 'tempo' ? 'Tempo' : 'Belum bayar'}</span></td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
    };
    const liveTab = () => {
      const top = [...live.rows].sort((a, b) => b.gmv - a.gmv);
      const best = top[0];
      return `
      ${secHead('Live', 'Sesi TikTok LIVE dari export Creator Live Performance. GMV = atribusi TikTok (bisa termasuk pesanan yang nanti batal).', ['online', 'Import data live'])}
      ${live.sessions ? `
      <div class="kpis">
        ${kpi('GMV live', money(live.gmv), delta(live.gmv, liveP.gmv), true)}
        ${kpi('Sesi · durasi', `${num(live.sessions)} · ${hours(live.minutes)}`, delta(live.minutes, liveP.minutes))}
        ${kpi('GMV per jam', money(live.gmvHour), delta(live.gmvHour, liveP.gmvHour))}
        ${kpi('Order · item', `${num(live.orders)} · ${num(live.items)}`, delta(live.orders, liveP.orders))}
        ${kpi('Views', num(live.views), delta(live.views, liveP.views))}
        ${kpi('Rata-rata nonton', `${Math.round(live.avgWatch)} detik`)}
        ${kpi('CTR produk', live.pImp ? pct(live.pClicks / live.pImp) : '–', `<div class="k-delta">${num(live.pClicks)} klik dari ${compact(live.pImp)} impresi</div>`)}
        ${kpi('Follower baru', num(live.followers), delta(live.followers, liveP.followers))}
      </div>
      <section class="panel solid">
        <div class="panel-head"><h2>GMV live</h2>${best ? `<span class="muted small">sesi terbaik ${fmtDate(best.date)} ${esc(best.start)} · ${money(best.gmv)}</span>` : ''}</div>
        <div class="chart" id="chLive"></div>
      </section>
      <section class="panel solid">
        <div class="panel-head"><h2>Semua sesi live</h2><span class="muted small">${num(live.sessions)} sesi · urut GMV</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Tanggal</th><th>Jam</th><th>Judul</th><th class="num">Durasi</th><th class="num">GMV</th><th class="num">Order</th><th class="num">Views</th><th class="num">Klik produk</th><th class="num">CTR</th><th class="num">Like</th><th class="num">Follower</th></tr></thead>
          <tbody>${top.map((l) => `<tr><td>${fmtDate(l.date)}</td><td>${esc(l.start)}–${esc(l.end)}</td><td>${esc(l.title)}</td><td class="num">${hours(l.minutes)}</td><td class="num"><b>${l.gmv ? money(l.gmv) : '–'}</b></td><td class="num">${num(l.orders)}</td><td class="num">${num(l.views)}</td><td class="num">${num(l.productClicks)}</td><td class="num">${l.productImpressions ? pct(l.productClicks / l.productImpressions) : '–'}</td><td class="num">${compact(l.likes)}</td><td class="num">${num(l.followers)}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>` : '<section class="panel solid"><p class="muted" style="text-align:center;padding:30px">Belum ada sesi live di periode ini. Import file Creator Live Performance di menu Order data.</p></section>'}`;
    };

    v.innerHTML = `
      <header class="dash-head glass">
        <img class="dh-logo" src="/img/ballop-wordmark-dark.png" alt="BALLOP">
        <div class="dh-title"><h1>Dashboard Report</h1><p>${sec.label} · ${from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)} · ${len} hari`}</p></div>
        <span class="dh-actions"><button class="btn btn-export" id="expPdf" type="button">⬇ Export PDF report</button><button class="btn" id="expReport" type="button">CSV</button></span>
      </header>
      <div class="toolbar">
        <div class="seg glass">${RANGES.map(([k, l]) => `<button type="button" data-r="${k}" class="${range.key === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="range-custom">dari <input type="date" id="rFrom" value="${from}"> s/d <input type="date" id="rTo" value="${to}"></span>
      </div>
      ${!hasData ? `<div class="demo-note glass"><b>Belum ada data penjualan / iklan.</b> Import data di menu Order data & Iklan, atau coba dengan data contoh dulu. <button class="btn sm blue" id="demoFill" type="button">Isi data contoh</button></div>` : ''}
      ${hasDemo ? `<div class="demo-note glass"><span class="badge warn">Data contoh</span> Angka di bawah memakai data contoh. <button class="btn sm danger" id="demoClear" type="button">Hapus data contoh</button></div>` : ''}
      <div class="ov-grid">${Object.entries(SECTIONS).map(([k, s]) => `
        <button type="button" class="ov-card${dashTab === k ? ' on' : ''}" data-tab="${k}" style="--sec:${s.color}">
          <span class="ov-top"><i>${s.icon}</i><b>${s.label}</b><small>${s.sub}</small></span>
          <span class="ov-value">${s.value}</span>
          <span class="ov-meta">${s.meta}</span>
          ${s.d}
        </button>`).join('')}</div>
      <div class="sec-body">${dashTab === 'overview' ? overviewTab(S, SP) : dashTab === 'ads' ? `${secHead('Iklan', 'Spending dan angka atribusi dari dashboard iklan (bukan omzet real).', ['ads', 'Data iklan'])}${adsDashboard(m, p)}` : dashTab === 'income' ? incomeTab() : dashTab === 'live' ? liveTab() : dashTab === 'offline' ? offlineTab() : orderTab()}</div>
      ${reportPanel()}`;

    const chartEl = (id) => document.getElementById(id);
    if (chartEl('chSales')) stackedBars(chartEl('chSales'), bks, salesSeries.length ? salesSeries : [{ key: '_', label: 'Omzet', color: '#2a78d6' }],
      (b, key) => sumBy(m.salesRows, b, (r) => r.channel === key, (r) => r.net), money);
    if (chartEl('chAds')) stackedBars(chartEl('chAds'), bks, adSeries.length ? adSeries : [{ key: '_', label: 'Iklan', color: '#6250d6' }],
      (b, key) => sumBy(m.adRows, b, (r) => r.channel === key, (r) => r.spend), money);
    if (chartEl('chIncome')) { const inc = computeIncome(from, to); const ser = Object.entries(SALES_CH).map(([key, c]) => ({ key, ...c })).filter((s) => inc.byCh[s.key]);
      stackedBars(chartEl('chIncome'), bks, ser.length ? ser : [{ key: '_', label: 'Dana cair', color: '#0e8a4f' }], (b, key) => inc.rows.reduce((t, x) => (payDay(x) >= b.from && payDay(x) <= b.to && x.channel === key ? t + x.payout : t), 0), money); }
    if (chartEl('chOffline')) stackedBars(chartEl('chOffline'), bks, [{ key: 'off', label: 'Omzet offline', color: '#0e8a8a' }], (b) => data.offline.reduce((t, x) => (x.status === 'completed' && x.date >= b.from && x.date <= b.to ? t + x.qty * x.price - x.discount : t), 0), money);
    if (chartEl('chLive')) stackedBars(chartEl('chLive'), bks, [{ key: 'tiktok', label: 'GMV live', color: '#6250d6' }], (b) => (data.live || []).reduce((t, l) => (l.date >= b.from && l.date <= b.to ? t + l.gmv : t), 0), money);
    $$('[data-camp]', v).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.camp;
      if (campHidden.has(k)) campHidden.delete(k); else campHidden.add(k);
      try { localStorage.setItem('ballopCampHidden', JSON.stringify([...campHidden])); } catch {}
      renderDashboard();
    }));
    $$('[data-cal]', v).forEach((b) => b.addEventListener('click', () => { calShift += Number(b.dataset.cal); renderDashboard(); }));
    $$('[data-tab]', v).forEach((b) => b.addEventListener('click', () => { dashTab = b.dataset.tab; try { localStorage.setItem('ballopDashTab2', dashTab); } catch {} renderDashboard(); }));

    $$('[data-r]', v).forEach((b) => b.addEventListener('click', () => { setRange(b.dataset.r); calShift = 0; renderDashboard(); }));
    const custom = () => { const f = $('#rFrom').value, t2 = $('#rTo').value; if (f && t2 && f <= t2) { setRange('custom', f, t2); renderDashboard(); } };
    $('#rFrom').addEventListener('change', custom);
    $('#rTo').addEventListener('change', custom);
    $$('[data-go]', v).forEach((b) => b.addEventListener('click', () => window.A.showView(b.dataset.go)));
    $('#demoFill')?.addEventListener('click', fillDemo);
    $('#demoClear')?.addEventListener('click', clearDemo);
    $('#expReport').addEventListener('click', () => exportReport(m));
    $('#expPdf').addEventListener('click', exportPdfReport);
    bindReport();
  }

  // ---------- ringkasan: one summary of every source, used by the dashboard and the PDF report ----------
  const MARKET_CH = ['shopee', 'tiktok', 'tokopedia', 'lazada', 'blibli'];
  const offlineOf = (a, b) => {
    const rows = data.offline.filter((x) => x.date >= a && x.date <= b && x.status === 'completed');
    const t = { omzet: 0, units: 0, trx: new Set() };
    rows.forEach((x) => { t.omzet += x.qty * x.price - x.discount; t.units += x.qty; t.trx.add(x.invoice || x.id); });
    t.trx = t.trx.size;
    return t;
  };
  // period rows for trend tables: months for long ranges, weeks for mid, days for short
  function periodRows(from, to) {
    const out = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return out;
    const n = daysBetween(from, to);
    if (n > 62) {
      let d = parse(from); d = new Date(d.getFullYear(), d.getMonth(), 1);
      while (iso(d) <= to) {
        const end = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
        out.push({ from: iso(d) < from ? from : iso(d), to: end > to ? to : end, label: `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` });
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }
    } else {
      const step = n > 14 ? 7 : 1;
      for (let c = from; c <= to; c = addDays(c, step)) {
        const end = addDays(c, step - 1) > to ? to : addDays(c, step - 1);
        out.push({ from: c, to: end, label: step === 1 ? fmtDate(c) : `${fmtDay(c)} – ${fmtDay(end)}` });
      }
    }
    return out;
  }
  function summary(from, to) {
    const m = compute(from, to);
    const inc = computeIncome(from, to);
    const live = computeLive(from, to);
    const off = offlineOf(from, to);
    const allOrders = Object.values(m.byState).reduce((s, x) => s + x.all, 0);
    const channels = [...MARKET_CH, 'website', 'offline', 'other'].map((k) => {
      const o = m.byCh[k], s = m.byState[k], i = inc.byCh[k], a = m.byAd[k];
      if (!o && !s && !i && !a) return null;
      const c = { key: k, label: SALES_CH[k]?.label || k, color: SALES_CH[k]?.color || '#888', omzet: o?.revenue || 0, units: o?.units || 0, orders: o?.orders || 0,
        all: s?.all || 0, cancelled: s?.cancelled || 0, returned: s?.returned || 0, gmv: i?.price || 0, net: i?.payout || 0, fees: Math.abs(i?.fees || 0),
        adSpend: a?.spend || 0, adRevenue: a?.revenue || 0, topup: Math.abs(i?.topup || 0) };
      // contribution margin: money in (payout, or omzet for channels without a payout file) − HPP − ad spend
      const base = k === 'offline' || !i ? c.omzet : c.net + (c.adSpend ? c.topup : 0);
      c.base = base; c.hpp = (k === 'offline' || !i ? c.omzet : c.gmv) * cogsRate();
      c.margin = base - c.hpp - c.adSpend;
      return c;
    }).filter(Boolean);
    const adOnly = Object.entries(m.byAd).filter(([k]) => !channels.some((c) => c.key === k)).map(([k, a]) => ({ key: k, label: ADS_CH[k]?.label || k, spend: a.spend, revenue: a.revenue }));
    const trend = periodRows(from, to).map((b) => {
      const x = compute(b.from, b.to), y = computeIncome(b.from, b.to), l = computeLive(b.from, b.to);
      return { ...b, omzet: x.revenue, orders: x.orders, units: x.units, gmv: y.price, net: y.payout, fees: Math.abs(y.fees), ads: x.adSpend, adRev: x.adRevenue, live: l.gmv, offline: offlineOf(b.from, b.to).omzet };
    });
    // product groups: catalog name, or the listing name without its size suffix
    const prod = {};
    Object.entries(m.byProduct).forEach(([id, x]) => {
      const pr = product(id), name = pr ? pr.name : pname(id).replace(/\s*\((?:EU\s*)?\d+(?:[.,]\d+)?\)\s*$/i, '').replace(/\s+[–-]\s+Sepatu.*$/i, '').trim();
      const g = prod[name] = prod[name] || { name, revenue: 0, units: 0, color: pr?.color };
      g.revenue += x.revenue; g.units += x.units;
    });
    const products = Object.values(prod).sort((a, b) => b.units - a.units || b.revenue - a.revenue);
    const hpp = inc.price * cogsRate();
    const td = parse(today()), mStart = iso(new Date(td.getFullYear(), td.getMonth(), 1)), mDays = new Date(td.getFullYear(), td.getMonth() + 1, 0).getDate();
    const mtd = compute(mStart, today()), mtdOff = offlineOf(mStart, today()).omzet;
    const st = window.A.settings || {};
    const targets = [['shopee', st.targetShopee], ['tiktok', st.targetTiktok], ['tokopedia', st.targetTokopedia], ['offline', st.targetOffline]].filter(([, t]) => t > 0)
      .map(([k, t]) => { const v = k === 'offline' ? mtdOff : (mtd.byCh[k]?.revenue || 0); return { key: k, label: SALES_CH[k]?.label || k, color: SALES_CH[k]?.color || '#888', target: t, value: v, pct: v / t, projected: (v / td.getDate()) * mDays }; });
    const targetMonth = `${MONTHS_LONG[td.getMonth()]} ${td.getFullYear()}`, dayPct = td.getDate() / mDays;
    const back = topupBack(inc, m);
    const profit = inc.payout + back - hpp - m.adSpend - m.expenses;
    return { from, to, m, inc, live, off, allOrders, channels, adOnly, trend, products, hpp, profit, back, targets, targetMonth, dayPct,
      cancelRate: allOrders ? (m.cancelled + m.returnOrders) / allOrders : NaN, feeRate: inc.price ? Math.abs(inc.fees) / inc.price : NaN };
  }

  function overviewTab(S, P) {
    const { m, inc, live, off } = S;
    const kpi = (label, value, d = '', hero = false) => `<div class="kpi solid${hero ? ' hero' : ''}"><div class="k-label">${label}</div><div class="k-value">${value}</div>${d}</div>`;
    const totOmzet = S.channels.reduce((s, c) => s + c.omzet, 0) || 1;
    const maxT = Math.max(1, ...S.trend.map((t) => Math.max(t.omzet, t.net)));
    const maxP = Math.max(1, ...S.products.slice(0, 8).map((p) => p.units));
    return `
      <div class="sec-head" style="--sec:#111318"><div><h2>Ringkasan semua channel</h2><p>Gabungan Shopee, TikTok Shop, Tokopedia, offline, iklan dan live untuk periode yang dipilih. Omzet pesanan = tanggal pesanan dibuat; omzet bersih = dana yang sudah cair (tanggal dana dilepas).</p></div></div>
      <div class="kpis">
        ${kpi('Omzet pesanan', money(m.revenue), delta(m.revenue, P.m.revenue), true)}
        ${kpi('GMV kotor (cair)', money(inc.price), delta(inc.price, P.inc.price))}
        ${kpi('Omzet bersih (cair)', money(inc.payout), delta(inc.payout, P.inc.payout))}
        ${kpi('Fee marketplace', money(Math.abs(inc.fees)), `<div class="k-delta">${pct(S.feeRate)} dari GMV kotor</div>`)}
        ${kpi('Pesanan · unit', `${num(m.orders)} · ${num(m.units)}`, delta(m.orders, P.m.orders))}
        ${kpi('AOV', money(m.aov), delta(m.aov, P.m.aov))}
        ${kpi('Biaya iklan · ROAS', `${compact(m.adSpend)} · ${ratio(m.adRoas)}`, delta(m.adSpend, P.m.adSpend, true, true))}
        ${kpi('Laba bersih (estimasi)', `<span style="color:${S.profit < 0 ? 'var(--danger)' : 'var(--good)'}">${money(S.profit)}</span>`, delta(S.profit, P.profit))}
      </div>
      <section class="panel solid">
        <div class="panel-head"><h2>Per channel</h2><span class="muted small">pesanan masuk · dana cair · iklan</span></div>
        <div class="mixbar">${S.channels.filter((c) => c.omzet).map((c) => `<i style="width:${(c.omzet / totOmzet) * 100}%;background:${c.color}" title="${esc(c.label)} ${pct(c.omzet / totOmzet)}"></i>`).join('')}</div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Channel</th><th class="num">Omzet pesanan</th><th class="num">Share</th><th class="num">Pesanan</th><th class="num">Unit</th><th class="num">Batal+retur</th><th class="num">GMV kotor</th><th class="num">Fee</th><th class="num">Omzet bersih</th><th class="num">Iklan</th><th class="num">ROAS</th></tr></thead>
          <tbody>${S.channels.map((c) => `<tr><td><span class="ch"><i style="background:${c.color}"></i>${esc(c.label)}</span></td><td class="num"><b>${money(c.omzet)}</b></td><td class="num">${pct(c.omzet / totOmzet)}</td><td class="num">${num(c.orders)}</td><td class="num">${num(c.units)}</td><td class="num">${c.all ? pct((c.cancelled + c.returned) / c.all) : '–'}</td><td class="num">${c.gmv ? money(c.gmv) : '–'}</td><td class="num">${c.gmv ? `${money(c.fees)} <small class="muted">${pct(c.fees / c.gmv)}</small>` : '–'}</td><td class="num"><b>${c.net ? money(c.net) : '–'}</b></td><td class="num">${c.adSpend ? money(c.adSpend) : '–'}</td><td class="num">${ratio(c.adSpend ? c.adRevenue / c.adSpend : NaN)}</td></tr>`).join('') || '<tr><td colspan="11" class="muted">Belum ada data di periode ini.</td></tr>'}
          ${S.channels.length > 1 ? `<tr class="tot"><td><b>Total</b></td><td class="num"><b>${money(m.revenue)}</b></td><td class="num">100%</td><td class="num">${num(m.orders)}</td><td class="num">${num(m.units)}</td><td class="num">${pct(S.cancelRate)}</td><td class="num">${money(inc.price)}</td><td class="num">${money(Math.abs(inc.fees))}</td><td class="num"><b>${money(inc.payout)}</b></td><td class="num">${money(m.adSpend)}</td><td class="num">${ratio(m.adRoas)}</td></tr>` : ''}</tbody>
        </table></div>
      </section>
      <section class="panel solid">
        <div class="panel-head"><h2>Laba rugi per channel</h2><span class="muted small">margin kontribusi = uang masuk − HPP − iklan</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Channel</th><th class="num">GMV kotor</th><th class="num">Fee marketplace</th><th class="num">Omzet bersih</th><th class="num">HPP (est.)</th><th class="num">Iklan</th><th class="num">Margin kontribusi</th><th class="num">% dari GMV</th></tr></thead>
          <tbody>${S.channels.map((c) => { const g = c.key === 'offline' || !c.gmv ? c.omzet : c.gmv; return `<tr><td><span class="ch"><i style="background:${c.color}"></i>${esc(c.label)}</span></td><td class="num">${money(g)}</td><td class="num">${c.gmv ? money(c.fees) : '–'}</td><td class="num">${money(c.base)}</td><td class="num">−${money(c.hpp)}</td><td class="num">${c.adSpend ? `−${money(c.adSpend)}` : '–'}</td><td class="num"><b style="color:${c.margin < 0 ? 'var(--danger)' : 'var(--good)'}">${money(c.margin)}</b></td><td class="num">${g ? pct(c.margin / g) : '–'}</td></tr>`; }).join('')}
          <tr class="tot"><td>Total kontribusi</td><td></td><td></td><td></td><td></td><td></td><td class="num">${money(S.channels.reduce((s, c) => s + c.margin, 0))}</td><td></td></tr>
          ${S.adOnly.length ? `<tr><td colspan="6" class="muted">Iklan tanpa channel penjualan (${esc(S.adOnly.map((a) => a.label).join(', '))})</td><td class="num">−${money(S.adOnly.reduce((s, a) => s + a.spend, 0))}</td><td></td></tr>` : ''}
          <tr><td colspan="6" class="muted">Biaya operasional</td><td class="num">−${money(m.expenses)}</td><td></td></tr></tbody>
        </table></div>
        <p class="muted small">HPP estimasi ${pct(cogsRate())} dari GMV (atur di Pengaturan). Channel tanpa file income (mis. offline) memakai omzet pesanan.</p>
      </section>
      ${S.targets.length ? `<section class="panel solid">
        <div class="panel-head"><h2>Target ${S.targetMonth}</h2><span class="muted small">omzet pesanan bulan berjalan · garis = posisi hari ini</span></div>
        ${S.targets.map((t) => `<div class="tgt-row"><span class="ch"><i style="background:${t.color}"></i>${esc(t.label)}</span>
          <div class="track"><i style="width:${Math.min(100, t.pct * 100)}%;background:${t.color}"></i><em style="left:${S.dayPct * 100}%"></em></div>
          <span class="tgt-val"><b>${pct(t.pct)}</b> · ${compact(t.value)} / ${compact(t.target)} · proyeksi ${compact(t.projected)}</span></div>`).join('')}
      </section>` : '<p class="muted small">Isi target per channel di Pengaturan untuk melihat progres target.</p>'}
      <section class="panel solid">
        <div class="panel-head"><h2>Tren per ${S.trend.length && daysBetween(S.from, S.to) > 62 ? 'bulan' : daysBetween(S.from, S.to) > 14 ? 'minggu' : 'hari'}</h2><span class="legend"><span><i style="background:#2a78d6"></i>Omzet pesanan</span><span><i style="background:#0e8a4f"></i>Omzet bersih</span></span></div>
        <div class="table-wrap"><table class="data trend">
          <thead><tr><th>Periode</th><th style="width:28%"></th><th class="num">Omzet pesanan</th><th class="num">Pesanan</th><th class="num">GMV kotor</th><th class="num">Omzet bersih</th><th class="num">Iklan</th><th class="num">ROAS</th><th class="num">Live</th><th class="num">Offline</th></tr></thead>
          <tbody>${S.trend.map((t) => `<tr><td>${esc(t.label)}</td><td><div class="tbar"><i style="width:${(t.omzet / maxT) * 100}%;background:#2a78d6"></i><i style="width:${(t.net / maxT) * 100}%;background:#0e8a4f"></i></div></td><td class="num"><b>${money(t.omzet)}</b></td><td class="num">${num(t.orders)}</td><td class="num">${money(t.gmv)}</td><td class="num">${money(t.net)}</td><td class="num">${money(t.ads)}</td><td class="num">${ratio(t.ads ? t.adRev / t.ads : NaN)}</td><td class="num">${t.live ? compact(t.live) : '–'}</td><td class="num">${t.offline ? compact(t.offline) : '–'}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      <div class="grid-3">
        <section class="panel solid"><div class="panel-head"><h2>Produk terlaris</h2><span class="muted small">unit · omzet pesanan</span></div>
          <div class="hbar">${S.products.slice(0, 8).map((p) => `<div class="hbar-row"><span class="hb-name" title="${esc(p.name)}">${esc(p.name)}</span><span class="hb-track"><i style="width:${(p.units / maxP) * 100}%;background:${p.color || '#2a78d6'}"></i></span><span class="hb-val">${num(p.units)} · ${compact(p.revenue)}</span></div>`).join('') || '<p class="muted">Belum ada produk terjual.</p>'}</div>
        </section>
        <section class="panel solid"><div class="panel-head"><h2>Laba rugi</h2><span class="muted small">basis dana cair</span></div>
          <table class="pl">
            <tr><td>GMV kotor</td><td>${money(inc.price)}</td></tr>
            <tr class="sub"><td>Fee, voucher, ongkir, refund</td><td>−${money(inc.price - inc.payout)}</td></tr>
            <tr class="mid"><td>Omzet bersih</td><td>${money(inc.payout)}</td></tr>
            <tr class="sub"><td>HPP (estimasi ${pct(cogsRate())})</td><td>−${money(S.hpp)}</td></tr>
            <tr class="sub"><td>Biaya iklan</td><td>−${money(m.adSpend)}</td></tr>${S.back ? `<tr class="sub"><td>Koreksi top-up iklan (sudah di spend)</td><td>+${money(S.back)}</td></tr>` : ''}
            <tr class="sub"><td>Biaya operasional</td><td>−${money(m.expenses)}</td></tr>
            <tr class="total"><td>Laba bersih</td><td style="color:${S.profit < 0 ? 'var(--danger)' : 'var(--good)'}">${money(S.profit)}</td></tr>
          </table>
          <div class="alert-list" style="margin-top:10px">
            <div><span>TikTok LIVE · ${num(live.sessions)} sesi</span><b>${money(live.gmv)}</b></div>
            <div><span>Offline · ${num(off.trx)} transaksi</span><b>${money(off.omzet)}</b></div>
          </div>
        </section>
      </div>`;
  }

  // ---------- PDF report: a print-ready A4 page with logo, opened in a new tab ----------
  function exportPdfReport() {
    if (!range.from || !range.to) setRange(range.key === 'custom' ? '30d' : range.key);
    const R = window.PdfReport;
    const { rp, chg, tile, tiles, h2, table, dot, bars } = R;
    const S = summary(range.from, range.to);
    const len = daysBetween(range.from, range.to);
    const P = summary(addDays(range.from, -len), addDays(range.from, -1));
    const { m, inc, live, off } = S;
    const totOmzet = S.channels.reduce((s, c) => s + c.omzet, 0) || 1;
    const maxT = Math.max(1, ...S.trend.map((t) => Math.max(t.omzet, t.net)));
    const unit = len > 62 ? 'bulan' : len > 14 ? 'minggu' : 'hari';
    const body = `
  ${h2('Ringkasan utama', '▲▼ dibanding periode sebelumnya dengan panjang yang sama')}
  ${tiles([
    tile('Omzet pesanan', rp(m.revenue), `${num(m.orders)} pesanan ${chg(m.revenue, P.m.revenue)}`, true),
    tile('GMV kotor (cair)', rp(inc.price), `${num(inc.orders)} cair ${chg(inc.price, P.inc.price)}`),
    tile('Omzet bersih (cair)', rp(inc.payout), `${pct(inc.price ? inc.payout / inc.price : NaN)} dari GMV ${chg(inc.payout, P.inc.payout)}`),
    tile('Laba bersih (estimasi)', `<span class="${S.profit < 0 ? 'neg' : 'pos'}">${rp(S.profit)}</span>`, chg(S.profit, P.profit)),
    tile('Unit terjual', `${num(m.units)} pasang`, chg(m.units, P.m.units)),
    tile('AOV', rp(m.aov), chg(m.aov, P.m.aov)),
    tile('Fee marketplace', rp(Math.abs(inc.fees)), `${pct(S.feeRate)} dari GMV`),
    tile('Batal + retur', pct(S.cancelRate), `${num(m.cancelled + m.returnOrders)} pesanan ${chg(S.cancelRate, P.cancelRate, true)}`),
    tile('Biaya iklan', rp(m.adSpend), chg(m.adSpend, P.m.adSpend, true)),
    tile('ROAS iklan', ratio(m.adRoas), `GMV iklan ${compact(m.adRevenue)} ${chg(m.adRoas, P.m.adRoas)}`),
    tile('TikTok LIVE', rp(live.gmv), `${num(live.sessions)} sesi ${chg(live.gmv, P.live.gmv)}`),
    tile('Offline', rp(off.omzet), `${num(off.trx)} transaksi ${chg(off.omzet, P.off.omzet)}`),
  ])}
  <div class="avoid">
  ${h2('Kinerja per channel', 'omzet pesanan = tanggal pesanan · omzet bersih = tanggal dana cair')}
  <div class="mix">${S.channels.filter((c) => c.omzet).map((c) => `<i style="width:${(c.omzet / totOmzet) * 100}%;background:${c.color}"></i>`).join('')}</div>
  ${table([['Channel'], ['Omzet pesanan', 1], ['Share', 1], ['Pesanan', 1], ['Unit', 1], ['Batal+retur', 1], ['GMV kotor', 1], ['Fee', 1], ['Omzet bersih', 1], ['Iklan', 1], ['ROAS', 1]],
    [...S.channels.map((c) => [`${dot(c.color)}${esc(c.label)}`, `<b>${rp(c.omzet)}</b>`, pct(c.omzet / totOmzet), num(c.orders), num(c.units), c.all ? pct((c.cancelled + c.returned) / c.all) : '–', c.gmv ? rp(c.gmv) : '–', c.gmv ? pct(c.fees / c.gmv) : '–', `<b>${c.net ? rp(c.net) : '–'}</b>`, c.adSpend ? rp(c.adSpend) : '–', ratio(c.adSpend ? c.adRevenue / c.adSpend : NaN)]),
      ...S.adOnly.map((a) => [`${dot('#999')}${esc(a.label)} <span class="muted">(iklan)</span>`, '–', '–', '–', '–', '–', '–', '–', '–', rp(a.spend), ratio(a.spend ? a.revenue / a.spend : NaN)])],
    ['Total', rp(m.revenue), '100%', num(m.orders), num(m.units), pct(S.cancelRate), rp(inc.price), pct(S.feeRate), rp(inc.payout), rp(m.adSpend), ratio(m.adRoas)])}
  </div>
  <div class="avoid">
  ${h2('Laba rugi per channel', 'margin kontribusi = uang masuk − HPP − iklan')}
  ${table([['Channel'], ['GMV kotor', 1], ['Fee', 1], ['Omzet bersih', 1], ['HPP (est.)', 1], ['Iklan', 1], ['Margin kontribusi', 1], ['% GMV', 1]],
    S.channels.map((c) => { const g = c.key === 'offline' || !c.gmv ? c.omzet : c.gmv; return [`${dot(c.color)}${esc(c.label)}`, rp(g), c.gmv ? rp(c.fees) : '–', rp(c.base), `−${rp(c.hpp)}`, c.adSpend ? `−${rp(c.adSpend)}` : '–', `<b class="${c.margin < 0 ? 'neg' : 'pos'}">${rp(c.margin)}</b>`, g ? pct(c.margin / g) : '–']; }),
    ['Total kontribusi', '', '', '', '', '', rp(S.channels.reduce((s, c) => s + c.margin, 0)), ''])}
  </div>
  ${S.targets.length ? `${h2(`Target ${S.targetMonth}`, 'omzet pesanan bulan berjalan')}${table([['Channel'], ['Realisasi', 1], ['Target', 1], ['Capaian', 1], ['Proyeksi akhir bulan', 1]], S.targets.map((t) => [`${dot(t.color)}${esc(t.label)}`, rp(t.value), rp(t.target), `<b>${pct(t.pct)}</b>`, rp(t.projected)]))}` : ''}
  ${h2(`Tren per ${unit}`, `${dot('#2a78d6')}omzet pesanan ${dot('#0e8a4f')}omzet bersih`)}
  ${table([['Periode'], [''], ['Omzet pesanan', 1], ['Pesanan', 1], ['Unit', 1], ['GMV kotor', 1], ['Omzet bersih', 1], ['Iklan', 1], ['ROAS', 1], ['Live', 1], ['Offline', 1]],
    S.trend.map((t) => [esc(t.label), bars([[t.omzet, '#2a78d6'], [t.net, '#0e8a4f']], maxT), `<b>${rp(t.omzet)}</b>`, num(t.orders), num(t.units), rp(t.gmv), rp(t.net), rp(t.ads), ratio(t.ads ? t.adRev / t.ads : NaN), t.live ? rp(t.live) : '–', t.offline ? rp(t.offline) : '–']))}
  <div class="two">
    <div>${h2('Produk terlaris', 'urut unit terjual')}
      ${table([['Produk'], ['Unit', 1], ['Omzet', 1], ['Share', 1]], S.products.slice(0, 10).map((p, i) => [`<span class="rank">${i + 1}</span>${esc(p.name)}`, num(p.units), rp(p.revenue), pct(m.units ? p.units / m.units : NaN)]), null, 'Belum ada produk terjual.')}</div>
    <div>${h2('Laba rugi', 'basis dana cair')}
      <table class="pl"><tbody>
        <tr><td>GMV kotor</td><td class="n">${rp(inc.price)}</td></tr>
        <tr class="sub"><td>Fee, voucher, ongkir, refund</td><td class="n">−${rp(inc.price - inc.payout)}</td></tr>
        <tr class="mid"><td>Omzet bersih</td><td class="n">${rp(inc.payout)}</td></tr>
        <tr class="sub"><td>HPP (estimasi ${pct(cogsRate())})</td><td class="n">−${rp(S.hpp)}</td></tr>
        <tr class="sub"><td>Biaya iklan</td><td class="n">−${rp(m.adSpend)}</td></tr>${S.back ? `<tr class="sub"><td>Koreksi top-up iklan (sudah di spend)</td><td class="n">+${rp(S.back)}</td></tr>` : ''}
        <tr class="sub"><td>Biaya operasional</td><td class="n">−${rp(m.expenses)}</td></tr>
        <tr class="total"><td>Laba bersih</td><td class="n ${S.profit < 0 ? 'neg' : 'pos'}">${rp(S.profit)}</td></tr>
      </tbody></table></div>
  </div>`;
    R.open({ title: 'Laporan Penjualan', period: `${R.period(range.from, range.to)} · ${num(len)} hari`,
      meta: [['Periode', R.period(range.from, range.to)], ['Pembanding', R.period(P.from, P.to)], ['Channel', esc(S.channels.map((c) => c.label).join(', ') || '–')]],
      body, note: `Sumber: export order, income, iklan &amp; Creator Live Performance tiap marketplace. HPP memakai estimasi ${pct(cogsRate())} dari GMV kotor bila HPP produk belum diisi. Angka iklan = atribusi platform.` });
  }

  // ---------- daily report text (WhatsApp) ----------
  // ad saldo and the closing line are typed by hand and remembered in this browser only (never in the code)
  const SALDO = [['shopee', 'Sisa saldo iklan shopee'], ['tiktok', 'Sisa saldo iklan tiktok'], ['cpas', 'Sisa saldo iklan CPAS shopee']];
  const FOOTER = 'Semua data tersebut bisa diakses dan dilihat melalui : https://ballop.web.id/admin menggunakan user name : ballop dan password : ';
  const repGet = () => { try { return JSON.parse(localStorage.getItem('ballopReport') || '{}'); } catch { return {}; } };
  const MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const longDate = (s) => { const d = parse(s); return `${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`; };
  // the report uses comma thousands (Rp 2,576,481) and a dot for decimals, unlike the rest of the admin
  const repMoney = (n) => `Rp ${Math.round(n || 0).toLocaleString('en-US')}`;
  const repRatio = (n) => (Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}×` : '–');
  // "1500000" or "1.500.000" -> "Rp 1,500,000"; anything else is kept as typed
  const saldoText = (v) => { const n = Number(String(v).replace(/[^0-9]/g, '')); return /^[\s\d.,rpRP]*$/.test(v) && n ? repMoney(n) : v; };
  // the report date is the end of the selected range; totals are month-to-date up to that date
  function reportText() {
    const r = repGet(), d = parse(range.to);
    const m = compute(iso(new Date(d.getFullYear(), d.getMonth(), 1)), range.to);
    return [
      `Selamat pagi mister, berikut ini daily report untuk Ballop E-Commerce per tanggal ${longDate(range.to)} :`, '',
      `1. Total pengeluaran iklan selama bulan ini : ${repMoney(m.adSpend)}`,
      `2. Total GMV yang dihasilkan selama bulan ini : ${repMoney(m.adRevenue)}`,
      `3. Roas yang dihasilkan selama bulan ini : ${repRatio(m.adRoas)}`,
      ...SALDO.map(([k, l], i) => `${i + 4}. ${l} : ${saldoText(r[k] || '') || '-'}`),
      '', '', r.footer ?? FOOTER,
    ].join('\n');
  }
  function reportPanel() {
    const r = repGet();
    return `
      <section class="panel solid report-panel">
        <div class="panel-head"><h2>Teks daily report</h2><span class="muted small">angka iklan bulan berjalan s/d tanggal akhir periode yang dipilih; saldo & kalimat penutup diisi manual (tersimpan di browser ini)</span></div>
        <div class="row three">${SALDO.map(([k, l]) => `<label>${l}<input type="text" inputmode="numeric" data-rep="${k}" value="${esc(r[k] || '')}" placeholder="mis. 1500000"></label>`).join('')}</div>
        <label>Kalimat penutup<textarea data-rep="footer" rows="2">${esc(r.footer ?? FOOTER)}</textarea></label>
        <pre class="report-text" id="reportText"></pre>
        <button class="btn report-copy" id="reportCopy" type="button">⧉ Copy teks report</button>
      </section>`;
  }
  function bindReport() {
    const show = () => { $('#reportText').textContent = reportText(); };
    show();
    $$('[data-rep]').forEach((el) => el.addEventListener('input', () => {
      const r = repGet(); r[el.dataset.rep] = el.value;
      try { localStorage.setItem('ballopReport', JSON.stringify(r)); } catch {}
      show();
    }));
    $('#reportCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(reportText()); toast('Teks report disalin'); } catch { toast('Tidak bisa menyalin', true); }
    });
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
        { k: 'campaign', label: 'Nama campaign', type: 'select', options: (f, row) => [...new Set([...ADS_CAMPAIGNS, row?.campaign].filter(Boolean))].map((c) => [c, c]) },
        { k: 'spend', label: 'Spending (cost)', type: 'number', step: 1000, half: 1 },
        { k: 'orders', label: 'Order (atribusi / SKU order)', type: 'number', half: 1 },
        { k: 'revenue', label: 'Revenue (atribusi / gross revenue)', type: 'number', step: 1000 },
        { k: 'impressions', label: 'Impresi', type: 'number', half: 1 },
        { k: 'clicks', label: 'Klik', type: 'number', half: 1 },
        { k: 'note', label: 'Catatan' },
      ],
      // GMV Max only reports cost, orders and revenue: hide impressions/clicks for it
      sync: (f) => {
        const gmv = isGmvMax(f.campaign.value);
        f.impressions.closest('.row').hidden = gmv;
        if (gmv) { f.impressions.value = ''; f.clicks.value = ''; if (f.channel.value !== 'tiktok' && ADS_CH.tiktok) f.channel.value = 'tiktok'; }
      },
      summary: (f) => {
        const sp = Number(f.spend.value) || 0, cl = Number(f.clicks.value) || 0, im = Number(f.impressions.value) || 0, rv = Number(f.revenue.value) || 0, od = Number(f.orders.value) || 0;
        if (isGmvMax(f.campaign.value)) return `Cost per order ${od ? money(sp / od) : '–'} · ROI ${ratio(sp ? rv / sp : NaN)}`;
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
        { k: 'qty', label: 'Jumlah (pasang)', type: 'number', min: 1, def: 1, half: 1 },
        { k: 'price', label: 'Harga satuan', type: 'number', step: 1000, half: 1 },
        { k: 'discount', label: 'Diskon (total)', type: 'number', step: 1000, half: 1 },
        { k: 'payment', label: 'Pembayaran', type: 'select', options: () => Object.entries(PAY), half: 1 },
        { k: 'dueDate', label: 'Jatuh tempo (kalau tempo)', type: 'date', optional: 1, half: 1 },
        { k: 'status', label: 'Status', type: 'select', options: () => Object.entries(STATUS) },
        { k: 'note', label: 'Catatan' },
      ],
      summary: (f) => `Total ${money((Number(f.qty.value) || 0) * (Number(f.price.value) || 0) - (Number(f.discount.value) || 0))}`,
      columns: [
        { label: 'Tanggal', get: (r) => fmtDate(r.date) },
        { label: 'Jenis', get: (r) => OFF_TYPES[r.type] },
        { label: 'Toko / distributor', get: (r) => esc(r.outlet || '–') },
        { label: 'Invoice', get: (r) => esc(r.invoice || '–') },
        { label: 'Qty', num: true, get: (r) => num(r.qty), sum: (r) => r.qty },
        { label: 'Total', num: true, get: (r) => money(r.qty * r.price - r.discount), sum: (r) => r.qty * r.price - r.discount, fmt: money },
        { label: 'Bayar', get: (r) => `<span class="badge ${r.payment === 'lunas' ? 'live' : r.payment === 'tempo' ? 'warn' : 'bad'}">${PAY[r.payment]}${r.payment === 'tempo' && r.dueDate ? ` · ${fmtDay(r.dueDate)}` : ''}</span>` },
        { label: 'Status', get: (r) => `<span class="badge ${r.status === 'completed' ? 'live' : 'warn'}">${STATUS[r.status]}</span>` },
      ],
      filters: ['status', { k: 'type', label: 'Semua jenis', options: () => Object.entries(OFF_TYPES) }, { k: 'payment', label: 'Semua pembayaran', options: () => Object.entries(PAY) }],
      csv: ['date', 'type', 'outlet', 'invoice', 'qty', 'price', 'discount', 'payment', 'dueDate', 'status', 'note'],
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
    const views = { stock: renderStock, stock3pl: () => extraViews.stock3pl?.(), offline: renderOffline, kol: renderKol, cashflow: renderFinance, sales: renderSales, ads: renderAds };
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
      if (['sales', 'stock'].includes(name) && !r.productId) { skipped++; return; }
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
      const attrs = fd.type === 'number' ? `type="number" step="${fd.step > 1 ? 'any' : fd.step || 1}"${fd.allowNeg ? '' : `min="${fd.min ?? 0}"`}` : fd.type === 'date' ? `type="date"${fd.optional ? '' : ' required'}` : `type="text" maxlength="200"${fd.list ? ` list="${id}-list"` : ''}`;
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
    cfg.fields.forEach((fd) => { if (fd.type === 'select') fillSelect(f[fd.k], fd.options(f, row)); });
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
    const upd = () => { cfg.sync?.(f); if (cfg.summary) $('#recSummary').textContent = cfg.summary(f); };
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
    renderLedger('ads', '#view-ads', { before: `${cards ? `<div class="sum-cards">${cards}</div>` : ''}<div id="adCal"></div>` });
    window.AdsCal?.mount('#adCal');
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
  const R_period = (r) => (window.PdfReport ? window.PdfReport.period(r.from, r.to) : `${r.from} – ${r.to}`);
  function renderOnline() {
    const v = $('#view-online');
    const r = periodOf(ost);
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
      <header class="bar"><div><h1>Order data</h1><p class="muted">Import file export Shopee, TikTok Shop, dan Lazada (Tokopedia & Blibli lewat rekap / input manual). Order yang sama di-import ulang akan di-update, tidak dobel.</p></div></header>
      <section class="panel solid import-panel">
        <div class="panel-head"><h2>Import file marketplace</h2><button class="btn sm" type="button" id="impTpl">⬇ Template 4 sheet</button></div>
        <label class="drop" id="impDrop">
          <input type="file" id="impFiles" accept=".xlsx,.xls,.csv" multiple hidden>
          <b>Pilih / seret file export (.xlsx / .csv)</b>
          <span>Order & Income Shopee / TikTok Shop, Order Lazada. Boleh 1 file berisi beberapa sheet, atau beberapa file sekaligus.</span>
        </label>
        <div id="impPreview"></div>
      </section>
      <div style="margin-top:16px">${rangeBar(ost)}</div>
      <div class="filters-row">
        <select data-o="channel"><option value="">Semua marketplace</option>${['shopee', 'tiktok', 'tokopedia', 'lazada', 'blibli'].map((k) => `<option value="${k}"${ost.channel === k ? ' selected' : ''}>${SALES_CH[k].label}</option>`).join('')}</select>
        <select data-o="state"><option value="">Semua status</option>${Object.entries(ORDER_STATE).map(([k, l]) => `<option value="${k}"${ost.state === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <input type="search" data-o="q" placeholder="Cari order / produk / kota…" value="${esc(ost.q)}">
        <span class="spacer"></span>
        <button class="btn sm btn-export" type="button" id="ordPdf">⬇ Export PDF</button><button class="btn sm" type="button" id="ordExport">CSV</button>
      </div>
      ${(() => { const miss = ['shopee', 'tiktok', 'tokopedia', 'lazada'].filter((k) => (!ost.channel || ost.channel === k) && !data.orders.some((x) => x.channel === k && inR(x)) && data.settlements.some((s) => s.channel === k && (s.releaseDate || s.date) >= r.from && (s.releaseDate || s.date) <= r.to));
        return miss.length ? `<div class="demo-note glass"><span class="badge warn">Data order belum lengkap</span> Ada income ${miss.map((k) => SALES_CH[k].label).join(', ')} di periode ini tapi file order-nya belum di-import, jadi pesanan & omzet tampil 0. Import file export order (Pesanan Saya › Export) untuk ${esc(R_period(r))} di kotak import di atas.</div>` : ''; })()}
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
          <tbody>${rows.slice(0, ost.limit).map((x) => { const pay = payoutBy.get(`${x.channel}:${x.orderId}`); return `<tr><td>${fmtDate(x.date)}</td><td>${chBadge(SALES_CH, x.channel)}</td><td><button class="raw-link" type="button" data-raw="orders" data-key="${esc(x.key)}">${esc(x.orderId)}</button></td><td title="${esc(x.productName)}">${esc(x.productName.length > 42 ? `${x.productName.slice(0, 40)}…` : x.productName)}</td><td>${esc(x.variation)}</td><td class="num">${num(x.qty)}</td><td class="num">${money(x.net)}</td><td class="num">${pay != null ? money(pay) : '<span class="muted">–</span>'}</td><td><span class="badge ${x.state === 'completed' ? 'live' : x.state === 'pending' ? '' : x.state === 'returned' ? 'warn' : 'bad'}" title="${esc(x.status)}">${ORDER_STATE[x.state]}</span></td></tr>`; }).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">Belum ada pesanan di filter ini.</td></tr>'}</tbody>
        </table></div>
        ${rows.length > ost.limit ? `<p style="text-align:center"><button class="btn sm" type="button" id="ordMore">Tampilkan lebih banyak</button></p>` : ''}
      </section>`;

    $$('[data-o]', v).forEach((el) => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
      ost[el.dataset.o] = el.value; ost.limit = 150;
      if (el.tagName === 'INPUT') { clearTimeout(ost.t); ost.t = setTimeout(renderOnline, 250); } else renderOnline();
    }));
    bindRangeBar(v, ost, renderOnline);
    window.RawPopup.bind(v);
    $('#ordMore')?.addEventListener('click', () => { ost.limit += 300; renderOnline(); });
    $('#ordPdf').addEventListener('click', () => {
      const R = window.PdfReport;
      const omzet = live.reduce((s, x) => s + x.net, 0);
      const byCh = {};
      rows.forEach((x) => { const c = byCh[x.channel] = byCh[x.channel] || { all: new Set(), done: new Set(), cancelled: new Set(), returned: new Set(), omzet: 0, units: 0 };
        c.all.add(x.orderId); if (x.state === 'completed' || x.state === 'pending') { c.done.add(x.orderId); c.omzet += x.net; c.units += x.qty; } if (x.state === 'cancelled') c.cancelled.add(x.orderId); if (x.state === 'returned') c.returned.add(x.orderId); });
      const chs = Object.entries(byCh).sort((a, b) => b[1].omzet - a[1].omzet);
      const filt = [ost.channel ? SALES_CH[ost.channel].label : 'Semua marketplace', ost.state ? ORDER_STATE[ost.state] : 'Semua status', ost.q ? `cari "${esc(ost.q)}"` : ''].filter(Boolean).join(' · ');
      const dayMap = {};
      rows.forEach((x) => { const c = dayMap[x.date] = dayMap[x.date] || { all: new Set(), done: new Set(), cancelled: new Set(), returned: new Set(), omzet: 0, units: 0 }; const k = `${x.channel}:${x.orderId}`;
        c.all.add(k); if (x.state === 'completed' || x.state === 'pending') { c.done.add(k); c.omzet += x.net; c.units += x.qty; } if (x.state === 'cancelled') c.cancelled.add(k); if (x.state === 'returned') c.returned.add(k); });
      const perDay = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0]));
      const body = `
        ${R.h2('Ringkasan pesanan')}
        ${R.tiles([
          R.tile('Pesanan masuk', num(orders.size), `${num(live.reduce((s, x) => s + x.qty, 0))} pasang`, true),
          R.tile('Omzet (setelah diskon)', R.rp(omzet), `AOV ${orders.size ? R.rp(omzet / orders.size) : '–'}`),
          R.tile('Omzet bersih (cair)', R.rp(sett.reduce((s, x) => s + x.payout, 0)), `${num(sett.length)} transaksi income`),
          R.tile('Fee marketplace', R.rp(sett.reduce((s, x) => s + Math.abs(x.fees), 0)), 'admin, layanan, afiliasi'),
          R.tile('Batal · retur', `${num(cnt('cancelled'))} · ${num(cnt('returned'))}`, 'pesanan'),
        ], 5)}
        ${R.h2('Per channel')}
        ${R.table([['Channel'], ['Pesanan', 1], ['Selesai/diproses', 1], ['Batal', 1], ['Retur', 1], ['Unit', 1], ['Omzet', 1], ['Share', 1]],
          chs.map(([k, c]) => [`${R.dot(SALES_CH[k]?.color || '#888')}${esc(SALES_CH[k]?.label || k)}`, num(c.all.size), num(c.done.size), num(c.cancelled.size), num(c.returned.size), num(c.units), `<b>${R.rp(c.omzet)}</b>`, R.pct(omzet ? c.omzet / omzet : NaN)]),
          ['Total', num(chs.reduce((s, [, c]) => s + c.all.size, 0)), num(orders.size), num(cnt('cancelled')), num(cnt('returned')), num(live.reduce((s, x) => s + x.qty, 0)), R.rp(omzet), '100%'])}
        <div class="two">
          <div>${R.h2('Produk terlaris', 'omzet · pasang')}${R.table([['Produk'], ['Pasang', 1], ['Omzet', 1]], top.slice(0, 10).map(([n, x], i) => [`<span class="rank">${i + 1}</span>${esc(n)}`, num(x.units), R.rp(x.revenue)]))}</div>
          <div>${R.h2('Provinsi teratas', 'pasang')}${R.table([['Provinsi'], ['Pasang', 1]], cities.map(([c, q]) => [esc(c), num(q)]))}</div>
        </div>
        ${R.h2('Pesanan per tanggal', 'akumulasi per tanggal pesanan dibuat')}
        ${R.table([['Tanggal'], ['Pesanan masuk', 1], ['Selesai/diproses', 1], ['Batal', 1], ['Retur', 1], ['Pasang', 1], ['Omzet', 1]],
          perDay.map(([d, x]) => [fmtDate(d), num(x.all.size), num(x.done.size), num(x.cancelled.size), num(x.returned.size), num(x.units), `<b>${R.rp(x.omzet)}</b>`]),
          ['Total', num(perDay.reduce((s, [, x]) => s + x.all.size, 0)), num(orders.size), num(cnt('cancelled')), num(cnt('returned')), num(live.reduce((s, x) => s + x.qty, 0)), R.rp(omzet)])}`;
      R.open({ title: 'Laporan Order', period: R.period(r.from, r.to), meta: [['Periode', R.period(r.from, r.to)], ['Filter', filt]], body,
        note: 'Tanggal = tanggal pesanan dibuat. Omzet = subtotal setelah diskon, belum dipotong fee marketplace.' });
    });
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
      for (const target of ['orders', 'settlements', 'live']) {
        const rows = pending.found.filter((f) => window.MarketImport.KINDS[f.kind].target === target).flatMap((f) => f.rows);
        for (let i = 0; i < rows.length; i += 400) {
          btn.textContent = `Mengimport ${num(i)} / ${num(rows.length)}…`;
          const res = await api('/api/import', json('POST', { kind: target, rows: rows.slice(i, i + 400) }));
          added += res.added; updated += res.updated;
        }
      }
      [data.orders, data.settlements, data.live] = await Promise.all([api('/api/orders'), api('/api/settlements'), api('/api/live')]);
      pending = null;
      window.RawPopup?.reset();
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
      <div style="display:flex;align-items:center"><button class="btn btn-export" type="button" id="offPdf">⬇ Export PDF</button></div>
    </div>` });
    $('#offPdf')?.addEventListener('click', () => offlinePdf(r));
  }
  function offlinePdf(r) {
    const R = window.PdfReport;
    const all = data.offline.filter((x) => x.date >= r.from && x.date <= r.to);
    const done = all.filter((x) => x.status === 'completed');
    const val = (x) => x.qty * x.price - x.discount;
    const total = done.reduce((s, x) => s + val(x), 0), units = done.reduce((s, x) => s + x.qty, 0);
    const unpaidP = done.filter((x) => x.payment !== 'lunas');
    const unpaidAll = data.offline.filter((x) => x.status === 'completed' && x.payment !== 'lunas');
    const group = (key) => { const g = {}; done.forEach((x) => { const k = key(x); const o = g[k] = g[k] || { v: 0, q: 0, n: 0, unpaid: 0, type: x.type }; o.v += val(x); o.q += x.qty; o.n++; if (x.payment !== 'lunas') o.unpaid += val(x); }); return Object.entries(g).sort((a, b) => b[1].v - a[1].v); };
    const outlets = group((x) => x.outlet || '(tanpa nama)');
    const types = group((x) => OFF_TYPES[x.type] || x.type);
    const days = group((x) => x.date).sort((a, b) => a[0].localeCompare(b[0]));
    const body = `
      ${R.h2('Ringkasan penjualan offline')}
      ${R.tiles([
        R.tile('Omzet offline', R.rp(total), `${num(done.length)} transaksi`, true),
        R.tile('Pasang terjual', num(units), `rata-rata ${done.length ? R.rp(total / done.length) : '–'} / transaksi`),
        R.tile('Piutang periode ini', R.rp(unpaidP.reduce((s, x) => s + val(x), 0)), `${num(unpaidP.length)} transaksi belum lunas`),
        R.tile('Total piutang berjalan', R.rp(unpaidAll.reduce((s, x) => s + val(x), 0)), `${num(unpaidAll.filter((x) => x.dueDate && x.dueDate < today()).length)} lewat jatuh tempo`),
      ])}
      <div class="two">
        <div>${R.h2('Per toko / distributor', 'omzet')}${R.table([['Toko / distributor'], ['Jenis'], ['Trx', 1], ['Pasang', 1], ['Omzet', 1]], outlets.map(([n, x], i) => [`<span class="rank">${i + 1}</span>${esc(n)}`, esc(OFF_TYPES[x.type] || ''), num(x.n), num(x.q), `<b>${R.rp(x.v)}</b>`]), null, 'Belum ada penjualan offline.')}</div>
        <div>${R.h2('Per jenis')}${R.table([['Jenis'], ['Trx', 1], ['Pasang', 1], ['Omzet', 1], ['Share', 1]], types.map(([n, x]) => [esc(n), num(x.n), num(x.q), R.rp(x.v), R.pct(total ? x.v / total : NaN)]))}</div>
      </div>
      ${R.h2('Penjualan per tanggal', 'akumulasi')}
      ${R.table([['Tanggal'], ['Transaksi', 1], ['Pasang', 1], ['Belum lunas', 1], ['Omzet', 1]], days.map(([d, x]) => [fmtDate(d), num(x.n), num(x.q), x.unpaid ? R.rp(x.unpaid) : '–', `<b>${R.rp(x.v)}</b>`]), ['Total', num(done.length), num(units), R.rp(unpaidP.reduce((s, x) => s + val(x), 0)), R.rp(total)])}
      ${unpaidAll.length ? `${R.h2('Piutang belum lunas', `${num(unpaidAll.length)} transaksi`)}${R.table([['Tanggal'], ['Toko / distributor'], ['Invoice'], ['Nilai', 1], ['Jatuh tempo'], ['Status']], unpaidAll.sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9')).map((x) => [fmtDate(x.date), esc(x.outlet), esc(x.invoice || '–'), R.rp(val(x)), x.dueDate ? fmtDate(x.dueDate) : '–', x.dueDate && x.dueDate < today() ? '<span class="chip bad">Lewat tempo</span>' : `<span class="chip warn">${PAY[x.payment]}</span>`]))}` : ''}`;
    R.open({ title: 'Laporan Penjualan Offline', period: R.period(r.from, r.to), meta: [['Periode', R.period(r.from, r.to)], ['Cakupan', 'Toko, distributor, reseller, event']], body,
      note: 'Hanya transaksi berstatus selesai. Piutang = pembayaran tempo / belum bayar.', sign: ['Dibuat oleh', 'Mengetahui'] });
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
      offline: renderOffline, kol: renderKol, finance: renderFinance,
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
    data, LEDGERS, openRecord, save, renderLedger, fillSelect, refresh, productOptions, pname, chBadge, SALES_CH, ADS_CH, ADS_CAMPAIGNS,
    fmtDate, fmtDay, money, num, compact, pct, esc, today, addDays, toCsv, rangeBar, bindRangeBar, periodOf, summary, exportPdfReport, overviewTab,
    get loaded() { return loaded; },
    registerView(name, fn) { extraViews[name] = fn; },
  };
})();
