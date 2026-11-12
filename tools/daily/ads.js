// Daily ad spend helpers (run in the browser tab of each platform, logged in). Each returns rows
// [date, type, title, spend, gmv, orders, impressions, clicks] for tools/import-ads-json.js.
// Dates: from = 1st of the month 00:00 WIB, to = today 23:59:59 WIB.
//   const from = Math.floor(new Date('2026-11-01T00:00:00+07:00')/1000), to = Math.floor(new Date('2026-11-12T23:59:59+07:00')/1000);

// ---- 1. Shopee Iklan Shopee: tab seller.shopee.co.id/portal/marketing/pas/index ----
// a) capture the graph request (URL carries session params, body carries a device fingerprint):
//    paste __hookShopeeGraph(), then click the "Iklan Produk" tab once.
window.__hookShopeeGraph = () => {
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) { if (/get_time_graph/.test(this.__u || '')) { window.__gUrl = this.__u; window.__gBody = b; } return os.apply(this, arguments); };
  return 'hooked: click the Iklan Produk tab, then check window.__gUrl';
};
// b) rows for product (P), shop (S), banner (B), live (L). cost and broad_gmv are scaled by 100000.
window.__shopeeAdRows = async (from, to) => {
  const B = JSON.parse(window.__gBody); const rows = [];
  for (const [ct, t, title] of [['product_homepage_v2', 'P', 'Semua Iklan Produk'], ['shop_homepage', 'S', 'Semua Iklan Toko'], ['search_brand_homepage', 'B', 'Semua Iklan Banner'], ['live_stream_homepage', 'L', 'Semua Iklan Live']]) {
    const body = { ...B, campaign_type: ct, filter_params: { campaign_type: ct }, start_time: from, end_time: to, agg_interval: 24 };
    const j = await (await fetch(window.__gUrl, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    const d = {};
    for (const p of j.data?.report_by_time || []) {
      const day = new Date((+p.key + 7 * 3600) * 1000).toISOString().slice(0, 10); const m = p.metrics;
      const x = (d[day] = d[day] || [0, 0, 0, 0, 0]); x[0] += m.cost; x[1] += m.broad_gmv; x[2] += m.broad_order; x[3] += m.impression; x[4] += m.click;
    }
    for (const [day, v] of Object.entries(d)) if (v[0] || v[1]) rows.push([day, t, title, Math.round(v[0] / 1e5), Math.round(v[1] / 1e5), v[2], v[3], v[4]]);
  }
  return rows;
};

// ---- 2. Shopee Iklan Eksternal (Meta/CPAS): tab seller.shopee.co.id/portal/web-shopping-ads/dashboard ----
// The page itself calls /api/selleradmin/v1/report/account/list; same-origin GET with cookies works directly.
window.__shopeeExtRows = async (from, to) => {
  const u = new URL('/api/selleradmin/v1/report/account/list', location.origin);
  Object.entries({ start_time: from, end_time: to, channel_type: 102, data_group_by_type: 2 }).forEach(([k, v]) => u.searchParams.set(k, v));
  const j = await (await fetch(u, { credentials: 'include' })).json();
  const day = (s) => { const [d, m, y] = s.slice(0, 10).split('/'); return `${y}-${m}-${d}`; };
  const sale = Object.fromEntries((j.data?.sale_list || []).map((s) => [day(s.date), s]));
  return (j.data?.adv_list || []).filter((a) => +a.expense_local).map((a) => { const s = sale[day(a.date)] || {}; return [day(a.date), 'E', 'Iklan Meta (CPAS)', Math.round(+a.expense_local), Math.round(+(s.gmv_local || 0)), +(s.orders || 0), +a.impressions, +a.clicks]; });
};
// If the call fails (code != 0), capture the page's own URL instead (hook XHR, change the period) and swap the params.

// ---- 3. TikTok GMV Max: tab seller-id.tokopedia.com/ads-creation/dashboard?mpa=1&type=product ----
// a) capture: paste __hookTikTokStat(), then change the dashboard date range once.
window.__hookTikTokStat = () => {
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) { if (/post_overview_stat/.test(this.__u || '')) { window.__tUrl = this.__u; window.__tBody = b; } return os.apply(this, arguments); };
  const of = window.fetch;
  window.fetch = function (u, o) { const s = String(u?.url || u); if (/post_overview_stat/.test(s)) { window.__tUrl = s; window.__tBody = o?.body; } return of.apply(this, arguments); };
  return 'hooked: change the date range, then check window.__tUrl';
};
// b) per day: external_type 304 = Product GMV Max (G), 305 = LIVE GMV Max (GL).
window.__tiktokAdRows = async (fromDay, toDay) => {
  const B = JSON.parse(window.__tBody); const rows = [];
  for (let d = new Date(`${fromDay}T00:00:00Z`); d <= new Date(`${toDay}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    for (const [ext, t, title] of [['304', 'G', 'Product GMV Max'], ['305', 'GL', 'LIVE GMV Max']]) {
      const body = { ...B, query_list: ['cost', 'onsite_roi2_shopping_value', 'onsite_roi2_shopping_sku'], start_time: day, end_time: day, campaign_shop_automation_type: 2, external_type_list: [ext] };
      const s = (await (await fetch(window.__tUrl, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()).data?.statistics || {};
      if (+s.cost || +s.onsite_roi2_shopping_value) rows.push([day, t, title, Math.round(+s.cost), Math.round(+s.onsite_roi2_shopping_value), +s.onsite_roi2_shopping_sku, 0, 0]);
    }
  }
  return rows;
};
// Tool output is truncated around 1.5k chars: return rows in slices, e.g. rows.slice(0,15).map(r=>r.join(',')).join(';')
'ad helpers ready';
