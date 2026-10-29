// Load a bundle made by tools/ops-to-json.py into the store and remove all demo data.
// Local by default; set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to write to Supabase instead.
// usage: node tools/apply-bundle.js bundle.json
const fs = require('fs');
const { handle } = require('../lib/api'); // reuse the API cleaners through a fake admin request
const store = require('../lib/store');

const bundle = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// colourway -> stripe / LED colours on the website
const COLORS = {
  BLACK: ['#2b2f36', '#e8552b'], 'ALL BLACK': ['#2b2f36', '#e8552b'], WHITE: ['#5b9bd5', '#e8552b'], 'OFF WHITE': ['#c9b99a', '#2a78d6'],
  BLUE: ['#2f7fd3', '#eda100'], PINK: ['#e87ba4', '#2a78d6'], GRAY: ['#8a8f99', '#e8552b'], GREY: ['#8a8f99', '#e8552b'],
  NAVY: ['#24365c', '#eda100'], IVORY: ['#d8cfb8', '#2a78d6'], BEIGE: ['#cdb48f', '#2a78d6'], SILVER: ['#a9b0b8', '#2a78d6'],
  KHAKI: ['#9a8f5f', '#e8552b'], CHARCOAL: ['#44484f', '#e8552b'], MULTI: ['#6250d6', '#eda100'], YELLOW: ['#eda100', '#2b2f36'],
};

(async () => {
  const old = await store.get('products', []);
  const demo = old.find((p) => /padel pulse/i.test(p.name)) || {};
  // the existing photos are the white Padel Pulse
  const PHOTO_ID = 'ballop-padel-pulse-white';

  const products = bundle.products.map((p, i) => {
    const prev = old.find((o) => o.id === p.id);
    const [color, accent] = COLORS[p.series] || ['#5b9bd5', '#e8552b'];
    const isPadel = /PADEL PULSE/.test(p.name);
    const base = {
      ...p, sku: p.variants.find((v) => v.sku)?.sku.replace(/-\d+$/, '') || '', category: isPadel ? 'Padel' : /SLIPPER/.test(p.name) ? 'Slippers' : 'Sneakers',
      color, accent, hue: 0, price: isPadel ? 1499000 : 0, oldPrice: isPadel ? 2579000 : 0, cost: isPadel ? 449700 : 0,
      description: isPadel ? demo.description?.replace(/\s*\(Warna demo[^)]*\)/, '') || '' : '', features: isPadel ? demo.features || [] : [],
      images: p.id === PHOTO_ID ? (demo.images || []) : [], visible: p.id === PHOTO_ID, lowStock: 0, buyUrl: '', order: i,
    };
    // keep anything already edited in the admin (photos, prices, texts)
    return prev ? { ...base, ...prev, variants: p.variants, sizes: p.sizes } : base;
  });

  const put = (name, value) => new Promise((resolve, reject) => {
    const req = {
      method: 'PUT', url: `/api/${name}`, headers: { host: 'x', authorization: `Bearer ${adminToken()}` }, body: value,
    };
    const res = { writeHead(code) { this.code = code; }, end(b) { if (this.code >= 400) reject(new Error(`${name}: ${b}`)); else resolve(JSON.parse(b)); } };
    handle(req, res);
  });

  const sets = {
    products, stock3pl: bundle.stock3pl, orders: bundle.orders, settlements: bundle.settlements, ads: bundle.ads,
    kol: bundle.kol, offline: bundle.offline, expenses: bundle.expenses, cashflow: bundle.cashflow,
    sales: [], stock: [], // demo ledgers: cleared
  };
  for (const [name, value] of Object.entries(sets)) {
    const out = await put(name, value);
    console.log(`${name.padEnd(12)} ${out.length}`);
  }
  console.log(`Selesai (${store.name}).`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; });

// a short-lived owner token signed the same way the API does
function adminToken() {
  const crypto = require('crypto');
  const pw = process.env.BALLOP_ADMIN_PASSWORD || 'ballop123';
  const secret = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`ballop:${process.env.SUPABASE_SERVICE_ROLE_KEY || pw}`).digest('hex');
  const p = `${Date.now() + 60000}.${Buffer.from('__owner').toString('base64url')}`;
  return `${p}.${crypto.createHmac('sha256', secret).update(p).digest('hex')}`;
}
