// BALLOP API, shared by the local server (serve.js) and the Vercel function (api/[...path].js).
//   GET  /api/<public collection>                products, events, gallery, posts (+ ?all=1 for staff)
//   GET  /api/content, /api/settings             landing copy + site settings (public)
//   POST /api/login {username, password}          GET /api/me          POST /api/password {current, next}
//   GET|PUT /api/<collection>                     staff, checked against the user's roles (MODULES)
//   POST /api/import {kind, rows}                 merge marketplace orders / settlements (dedupe by key)
//   GET|PUT /api/users                            admin only
//   POST /api/upload-url, /api/upload             any staff;  GET /api/backup, POST /api/restore  admin
const crypto = require('crypto');
const store = require('./store');

const DEFAULT_PASSWORD = process.env.BALLOP_ADMIN_PASSWORD || 'ballop123';
const TOKEN_TTL = 12 * 60 * 60 * 1000;
const MAX_UPLOAD = 12 * 1024 * 1024;
// signs login tokens so any serverless instance can verify them without shared memory
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`ballop:${process.env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_PASSWORD}`).digest('hex');

// ---------- roles + permissions ----------
const ROLES = ['admin', 'ecommerce', 'offline', 'gudang', 'creative', 'marketing', 'finance'];
// module -> roles that may use it (admin always may)
const MODULES = {
  dashboard: ['finance', 'ecommerce', 'marketing', 'offline'],
  online: ['ecommerce', 'finance'],
  offline: ['offline', 'finance'],
  ads: ['marketing', 'ecommerce'],
  stock3pl: ['gudang', 'ecommerce'],
  mutasi: ['gudang'],
  kol: ['creative', 'marketing'],
  finance: ['finance'],
  products: ['ecommerce', 'creative', 'gudang'],
  website: ['creative'],
  users: [],
  settings: [],
};
// collection -> module that may write it; read also allowed for `alsoRead` modules
const COLLECTION_MODULE = {
  sales: 'online', orders: 'online', settlements: 'online', offline: 'offline', ads: 'ads',
  stock3pl: 'stock3pl', stock: 'mutasi', kol: 'kol', cashflow: 'finance', expenses: 'finance',
  products: 'products', events: 'website', gallery: 'website', posts: 'website',
};
const DASHBOARD_READS = ['sales', 'orders', 'settlements', 'offline', 'ads', 'stock', 'stock3pl', 'expenses', 'cashflow', 'kol'];
const can = (user, mod) => !!user && (user.roles.includes('admin') || (MODULES[mod] || []).some((r) => user.roles.includes(r)));
const canRead = (user, coll) => can(user, COLLECTION_MODULE[coll]) || (DASHBOARD_READS.includes(coll) && can(user, 'dashboard'));
const modulesOf = (user) => Object.keys(MODULES).filter((m) => can(user, m));

const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

// Vercel may have parsed the body already; locally we read the stream
function readBody(req, limit) {
  if (req.body !== undefined && req.body !== null) {
    const b = req.body;
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(typeof b === 'string' ? b : JSON.stringify(b));
    if (buf.length > limit) return Promise.reject(new Error('too large'));
    return Promise.resolve(buf);
  }
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJsonBody = async (req, limit) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  return JSON.parse((await readBody(req, limit)).toString() || 'null');
};

// ---------- tokens, users, passwords ----------
// The owner account ("admin" + BALLOP_ADMIN_PASSWORD, or the hash in kv `auth`) always exists so nobody
// gets locked out; staff accounts live in kv `users` with scrypt hashes.
const OWNER = '__owner';
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const makeToken = (uid) => { const p = `${Date.now() + TOKEN_TTL}.${Buffer.from(uid).toString('base64url')}`; return `${p}.${sign(p)}`; };
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function ownerPasswordOk(pw) {
  const auth = await store.get('auth', null);
  return auth ? same(hashPw(pw, auth.salt), auth.hash) : same(pw, DEFAULT_PASSWORD);
}
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, roles: u.roles, active: u.active !== false });

async function currentUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const [exp, uid64, sig] = h.slice(7).split('.');
  if (!exp || !uid64 || !sig || Number(exp) < Date.now() || !same(sig, sign(`${exp}.${uid64}`))) return null;
  const uid = Buffer.from(uid64, 'base64url').toString();
  if (uid === OWNER) return { id: OWNER, username: 'admin', name: 'Owner', roles: ['admin'], owner: true };
  const u = (await store.get('users', [])).find((x) => x.id === uid);
  return u && u.active !== false ? publicUser(u) : null; // deactivated users lose access immediately
}

// ---------- field cleaners ----------
const str = (v, n) => String(v ?? '').slice(0, n);
const num = (v, min = 0) => Math.max(min, Number(v) || 0);
const anyNum = (v) => Number(v) || 0;
const int = (v, min = 0) => Math.max(min, Math.round(Number(v) || 0));
const httpUrl = (v) => (/^https?:\/\//.test(v || '') ? str(v, 400) : '');
const isImg = (v) => /^(\/|https:\/\/)/.test(String(v || ''));
const img = (v) => (isImg(v) ? str(v, 400) : '');
const imgs = (v, n) => (Array.isArray(v) ? v : []).map((x) => str(x, 400)).filter(isImg).slice(0, n);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : new Date().toISOString().slice(0, 10));
const optDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
const list = (v, n, len) => (Array.isArray(v) ? v : []).map((x) => str(x, len)).filter(Boolean).slice(0, n);
const id = (v) => str(v, 80) || crypto.randomUUID();
const oneOf = (v, opts) => (opts.includes(v) ? v : opts[0]);
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

const SALES_CHANNELS = ['shopee', 'tiktok', 'tokopedia', 'lazada', 'blibli', 'website', 'offline', 'other'];
const MARKETS = ['shopee', 'tiktok', 'tokopedia', 'lazada', 'blibli'];
const AD_CHANNELS = ['meta', 'shopee', 'tiktok', 'lazada', 'blibli', 'google', 'other'];

const CLEAN = {
  products: (p, i) => ({
    id: id(p.id), sku: str(p.sku, 40), name: str(p.name, 80) || 'Untitled', series: str(p.series, 80), category: str(p.category, 40),
    price: num(p.price), oldPrice: num(p.oldPrice), cost: num(p.cost),
    color: hex(p.color, '#5b9bd5'), accent: hex(p.accent, '#e8552b'), hue: Math.round(Number(p.hue) || 0) % 360,
    description: str(p.description, 1200), features: list(p.features, 8, 40), sizes: list(p.sizes, 20, 8),
    images: imgs(p.images, 12), buyUrl: httpUrl(p.buyUrl), lowStock: int(p.lowStock), visible: p.visible !== false, order: i,
    // per-size codes (warehouse / marketplace SKU), e.g. { size: '40', sizeKr: '250', sku: 'GBI-SPRT-000581' }
    variants: (Array.isArray(p.variants) ? p.variants : []).slice(0, 40).map((v) => ({ size: str(v.size, 12), sizeKr: str(v.sizeKr, 12), sku: str(v.sku, 60) })),
  }),
  events: (e) => ({
    id: id(e.id), title: str(e.title, 120) || 'Untitled event', date: isoDate(e.date), time: str(e.time, 40),
    venue: str(e.venue, 120), address: str(e.address, 240), city: str(e.city, 60), summary: str(e.summary, 240),
    description: str(e.description, 4000), highlights: list(e.highlights, 12, 80), cover: img(e.cover),
    photos: imgs(e.photos, 60), link: httpUrl(e.link), visible: e.visible !== false,
  }),
  gallery: (g) => ({ id: id(g.id), image: img(g.image), caption: str(g.caption, 160), eventId: str(g.eventId, 80), wide: !!g.wide, visible: g.visible !== false }),
  posts: (p) => ({
    id: id(p.id), slug: slugify(p.slug || p.title) || crypto.randomUUID().slice(0, 8), title: str(p.title, 160) || 'Untitled',
    excerpt: str(p.excerpt, 320), cover: img(p.cover), body: str(p.body, 60000), tags: list(p.tags, 8, 30),
    author: str(p.author, 60), date: isoDate(p.date), published: !!p.published, featured: !!p.featured,
  }),
  sales: (s) => ({
    id: id(s.id), date: isoDate(s.date), channel: oneOf(s.channel, SALES_CHANNELS), orderId: str(s.orderId, 60),
    productId: str(s.productId, 80), size: str(s.size, 8), qty: int(s.qty, 1), price: num(s.price),
    discount: num(s.discount), fee: num(s.fee), shipping: num(s.shipping),
    status: oneOf(s.status, ['completed', 'returned', 'cancelled']), note: str(s.note, 200),
  }),
  // inbound / outbound / adjustment of goods
  stock: (s) => ({
    id: id(s.id), date: isoDate(s.date), type: oneOf(s.type, ['in', 'out', 'adjust']), warehouse: str(s.warehouse, 60),
    productId: str(s.productId, 80), size: str(s.size, 8), qty: Math.round(Number(s.qty) || 0), cost: num(s.cost),
    ref: str(s.ref, 60), party: str(s.party, 80), note: str(s.note, 200),
  }),
  ads: (a) => ({
    id: id(a.id), date: isoDate(a.date), channel: oneOf(a.channel, AD_CHANNELS), campaign: str(a.campaign, 120),
    spend: num(a.spend), impressions: int(a.impressions), clicks: int(a.clicks), orders: int(a.orders), revenue: num(a.revenue), note: str(a.note, 200),
  }),
  expenses: (x) => ({ id: id(x.id), date: isoDate(x.date), category: str(x.category, 40) || 'Lainnya', amount: num(x.amount), note: str(x.note, 200) }),
  // marketplace order lines (imported from Shopee / TikTok exports)
  orders: (o) => ({
    id: id(o.id), key: str(o.key, 160), channel: oneOf(o.channel, MARKETS), orderId: str(o.orderId, 60),
    status: str(o.status, 60), state: oneOf(o.state, ['completed', 'pending', 'cancelled', 'returned']), date: isoDate(o.date),
    sku: str(o.sku, 60), productName: str(o.productName, 200), variation: str(o.variation, 80), size: str(o.size, 12),
    qty: int(o.qty), returnedQty: int(o.returnedQty), unitPrice: num(o.unitPrice), gross: num(o.gross),
    sellerDiscount: num(o.sellerDiscount), platformDiscount: num(o.platformDiscount), net: num(o.net), note: str(o.note, 120),
    buyerPaid: num(o.buyerPaid), province: str(o.province, 60), city: str(o.city, 80), courier: str(o.courier, 60), payment: str(o.payment, 40),
  }),
  // what the marketplace actually paid out per order (income / settlement exports)
  settlements: (s) => ({
    id: id(s.id), key: str(s.key, 160), channel: oneOf(s.channel, MARKETS), orderId: str(s.orderId, 60),
    type: str(s.type, 40), date: optDate(s.date), releaseDate: optDate(s.releaseDate), productPrice: anyNum(s.productPrice),
    payout: anyNum(s.payout), fees: anyNum(s.fees), adminFee: anyNum(s.adminFee), serviceFee: anyNum(s.serviceFee),
    affiliateFee: anyNum(s.affiliateFee), shipping: anyNum(s.shipping), refund: anyNum(s.refund), sellerDiscount: anyNum(s.sellerDiscount),
  }),
  offline: (s) => ({
    id: id(s.id), date: isoDate(s.date), outlet: str(s.outlet, 80), type: oneOf(s.type, ['toko', 'distributor', 'event', 'reseller']),
    invoice: str(s.invoice, 60), productId: str(s.productId, 80), size: str(s.size, 8), qty: int(s.qty, 1), price: num(s.price),
    discount: num(s.discount), payment: oneOf(s.payment, ['lunas', 'tempo', 'belum']), dueDate: optDate(s.dueDate),
    status: oneOf(s.status, ['completed', 'returned', 'cancelled']), note: str(s.note, 200),
  }),
  stock3pl: (s) => ({
    id: id(s.id), date: isoDate(s.date), warehouse: str(s.warehouse, 60) || '3PL', sku: str(s.sku, 60), productId: str(s.productId, 80),
    name: str(s.name, 160), size: str(s.size, 12), available: int(s.available), reserved: int(s.reserved), damaged: int(s.damaged), note: str(s.note, 200),
  }),
  kol: (k) => ({
    id: id(k.id), date: isoDate(k.date), name: str(k.name, 80), handle: str(k.handle, 60), platform: oneOf(k.platform, ['instagram', 'tiktok', 'youtube', 'other']),
    followers: int(k.followers), productId: str(k.productId, 80), size: str(k.size, 8), qty: int(k.qty, 1), resi: str(k.resi, 60),
    shipStatus: oneOf(k.shipStatus, ['siap', 'dikirim', 'diterima', 'batal']),
    contentStatus: oneOf(k.contentStatus, ['menunggu', 'brief', 'draft', 'revisi', 'posted', 'tidak']),
    dueDate: optDate(k.dueDate), postDate: optDate(k.postDate), postUrl: httpUrl(k.postUrl),
    type: str(k.type, 40), gmv: num(k.gmv), orders: int(k.orders), sold: int(k.sold),
    views: int(k.views), likes: int(k.likes), comments: int(k.comments), shares: int(k.shares), cost: num(k.cost), note: str(k.note, 300),
  }),
  cashflow: (c) => ({
    id: id(c.id), date: isoDate(c.date), type: oneOf(c.type, ['in', 'out']), category: str(c.category, 40) || 'Lainnya',
    account: str(c.account, 40), amount: num(c.amount), ref: str(c.ref, 60), note: str(c.note, 200),
  }),
};
// which collections the public may read, and how they are filtered
const PUBLIC = {
  products: (all) => all.filter((p) => p.visible !== false),
  events: (all) => all.filter((e) => e.visible !== false).sort((a, b) => b.date.localeCompare(a.date)),
  gallery: (all) => all.filter((g) => g.visible !== false && g.image),
  posts: (all) => all.filter((p) => p.published).sort((a, b) => b.date.localeCompare(a.date)),
};

const cleanSettings = (s) => ({
  brand: str(s.brand || 'BALLOP', 40),
  currency: str(s.currency || 'Rp', 6),
  whatsapp: String(s.whatsapp || '').replace(/[^0-9]/g, '').slice(0, 20),
  instagram: String(s.instagram || '').replace(/[^a-zA-Z0-9._]/g, '').slice(0, 40),
  tiktok: String(s.tiktok || '').replace(/[^a-zA-Z0-9._]/g, '').slice(0, 40),
  shopee: httpUrl(s.shopee),
  tokopedia: httpUrl(s.tokopedia),
  tiktokShop: httpUrl(s.tiktokShop),
  email: str(s.email, 80),
  monthlyTarget: num(s.monthlyTarget),
  lowStock: int(s.lowStock) || 5,
  // share of net sales used as HPP when a line has no known product cost (0.35 = 35%)
  cogsRate: Math.min(1, num(s.cogsRate ?? 0.35)),
});
// landing copy: any JSON object of strings / numbers / arrays, size-capped
function cleanContent(c, depth = 0) {
  if (depth > 5) return null;
  if (Array.isArray(c)) return c.slice(0, 40).map((x) => cleanContent(x, depth + 1));
  if (c && typeof c === 'object') {
    const out = {};
    Object.keys(c).slice(0, 80).forEach((k) => { out[str(k, 40)] = cleanContent(c[k], depth + 1); });
    return out;
  }
  if (typeof c === 'number' || typeof c === 'boolean') return c;
  return str(c, 4000);
}

async function route(req, res, url) {
  const name = url.pathname.split('/').filter(Boolean)[1];
  const method = req.method;

  // ----- public -----
  if (method === 'GET' && PUBLIC[name] && url.searchParams.get('all') !== '1') return send(res, 200, PUBLIC[name](await store.get(name, [])));
  if (method === 'GET' && (name === 'settings' || name === 'content')) return send(res, 200, await store.get(name, {}));

  if (method === 'POST' && name === 'login') {
    const { username = '', password = '' } = (await readJsonBody(req, 4096)) || {};
    const uname = String(username).trim().toLowerCase() || 'admin';
    const users = await store.get('users', []);
    const u = users.find((x) => x.username === uname);
    let uid = null;
    if (u && u.active !== false && same(hashPw(password, u.salt), u.hash)) uid = u.id;
    else if (!u && uname === 'admin' && (await ownerPasswordOk(password))) uid = OWNER;
    if (!uid) {
      await new Promise((r) => setTimeout(r, 400)); // slow down guessing
      return send(res, 401, { error: 'Username atau password salah' });
    }
    return send(res, 200, { token: makeToken(uid) });
  }

  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: 'Login dulu' });

  // ----- staff -----
  if (method === 'GET' && name === 'me') return send(res, 200, { user, modules: modulesOf(user), roles: ROLES });

  if (CLEAN[name]) {
    if (method === 'GET') {
      if (!canRead(user, name) && !PUBLIC[name]) return send(res, 403, { error: 'Tidak punya akses' });
      return send(res, 200, await store.get(name, []));
    }
    if (method === 'PUT') {
      if (!can(user, COLLECTION_MODULE[name])) return send(res, 403, { error: 'Tidak punya akses untuk mengubah data ini' });
      const body = await readJsonBody(req, 4 * 1024 * 1024);
      if (!Array.isArray(body)) return send(res, 400, { error: 'Expected an array' });
      const clean = body.map(CLEAN[name]);
      if (name === 'posts') { // keep slugs unique
        const seen = new Set();
        clean.forEach((p) => { let s = p.slug, n = 2; while (seen.has(s)) s = `${p.slug}-${n++}`; p.slug = s; seen.add(s); });
      }
      await store.set(name, clean);
      return send(res, 200, clean);
    }
  }

  // merge imported marketplace rows: same key = replace (re-importing a newer export updates status)
  if (method === 'POST' && name === 'import') {
    if (!can(user, 'online')) return send(res, 403, { error: 'Tidak punya akses' });
    const { kind, rows } = (await readJsonBody(req, 4 * 1024 * 1024)) || {};
    if (!['orders', 'settlements'].includes(kind) || !Array.isArray(rows)) return send(res, 400, { error: 'Format import salah' });
    const all = await store.get(kind, []);
    const byKey = new Map(all.map((r, i) => [r.key, i]));
    let added = 0, updated = 0;
    rows.map(CLEAN[kind]).forEach((r) => {
      if (!r.key) return;
      if (byKey.has(r.key)) { const i = byKey.get(r.key); r.id = all[i].id; all[i] = r; updated++; } else { byKey.set(r.key, all.length); all.push(r); added++; }
    });
    await store.set(kind, all);
    return send(res, 200, { added, updated, total: all.length });
  }

  if (method === 'POST' && name === 'password') {
    const { current, next } = (await readJsonBody(req, 4096)) || {};
    if (String(next || '').length < 8) return send(res, 400, { error: 'Password baru minimal 8 karakter' });
    const salt = crypto.randomBytes(16).toString('hex');
    if (user.owner) {
      if (!(await ownerPasswordOk(current || ''))) return send(res, 400, { error: 'Password lama salah' });
      await store.set('auth', { salt, hash: hashPw(next, salt) });
    } else {
      const users = await store.get('users', []);
      const u = users.find((x) => x.id === user.id);
      if (!u || !same(hashPw(current || '', u.salt), u.hash)) return send(res, 400, { error: 'Password lama salah' });
      Object.assign(u, { salt, hash: hashPw(next, salt) });
      await store.set('users', users);
    }
    return send(res, 200, { ok: true });
  }
  if (method === 'POST' && name === 'upload-url') {
    const { type } = (await readJsonBody(req, 4096)) || {};
    if (!store.IMAGE_EXT[type]) return send(res, 415, { error: 'Hanya png/jpg/webp/gif/avif' });
    return send(res, 200, await store.uploadTarget(type));
  }
  if (method === 'POST' && name === 'upload') {
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    if (!store.IMAGE_EXT[type]) return send(res, 415, { error: 'Hanya png/jpg/webp/gif/avif' });
    return send(res, 200, { url: await store.saveUpload(type, await readBody(req, MAX_UPLOAD)) });
  }

  // ----- admin only -----
  const admin = user.roles.includes('admin');
  if (name === 'users') {
    if (!admin) return send(res, 403, { error: 'Khusus admin' });
    if (method === 'GET') return send(res, 200, (await store.get('users', [])).map(publicUser));
    if (method === 'PUT') {
      const body = await readJsonBody(req, 256 * 1024);
      if (!Array.isArray(body)) return send(res, 400, { error: 'Expected an array' });
      const old = new Map((await store.get('users', [])).map((u) => [u.id, u]));
      const seen = new Set();
      const out = [];
      for (const b of body) {
        const username = String(b.username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);
        if (!username || seen.has(username)) return send(res, 400, { error: `Username "${username || '(kosong)'}" kosong atau dobel` });
        if (username === 'admin' && !old.has(b.id) && !b.password) return send(res, 400, { error: 'Username admin butuh password' });
        seen.add(username);
        const prev = old.get(b.id) || {};
        const u = {
          id: prev.id || crypto.randomUUID(), username, name: str(b.name, 60) || username,
          roles: list(b.roles, ROLES.length, 20).filter((r) => ROLES.includes(r)), active: b.active !== false,
          salt: prev.salt, hash: prev.hash,
        };
        if (b.password) {
          if (String(b.password).length < 8) return send(res, 400, { error: `Password ${username} minimal 8 karakter` });
          u.salt = crypto.randomBytes(16).toString('hex');
          u.hash = hashPw(b.password, u.salt);
        }
        if (!u.hash) return send(res, 400, { error: `User baru ${username} butuh password` });
        out.push(u);
      }
      await store.set('users', out);
      return send(res, 200, out.map(publicUser));
    }
  }
  if (method === 'PUT' && name === 'settings') {
    if (!admin) return send(res, 403, { error: 'Khusus admin' });
    const clean = cleanSettings((await readJsonBody(req, 64 * 1024)) || {});
    await store.set('settings', clean);
    return send(res, 200, clean);
  }
  if (method === 'PUT' && name === 'content') {
    if (!can(user, 'website')) return send(res, 403, { error: 'Tidak punya akses' });
    const body = await readJsonBody(req, 512 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Expected an object' });
    const clean = cleanContent(body);
    await store.set('content', clean);
    return send(res, 200, clean);
  }
  if (method === 'GET' && name === 'backup') {
    if (!admin) return send(res, 403, { error: 'Khusus admin' });
    const all = {};
    for (const k of [...Object.keys(CLEAN), 'settings', 'content']) all[k] = await store.get(k, k === 'settings' || k === 'content' ? {} : []);
    const stamp = new Date().toISOString().slice(0, 10);
    return send(res, 200, JSON.stringify({ app: 'ballop', version: 2, date: new Date().toISOString(), data: all }, null, 2),
      'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="ballop-backup-${stamp}.json"` });
  }
  if (method === 'POST' && name === 'restore') {
    if (!admin) return send(res, 403, { error: 'Khusus admin' });
    const body = await readJsonBody(req, 32 * 1024 * 1024);
    const data = body && body.app === 'ballop' && body.data;
    if (!data) return send(res, 400, { error: 'File backup tidak valid' });
    for (const k of Object.keys(CLEAN)) if (Array.isArray(data[k])) await store.set(k, data[k].map(CLEAN[k]));
    if (data.settings) await store.set('settings', cleanSettings(data.settings));
    if (data.content) await store.set('content', cleanContent(data.content));
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Not found' });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    await route(req, res, url);
  } catch (e) {
    const code = e.message === 'too large' ? 413 : e.message.startsWith('Supabase') ? 502 : 400;
    send(res, code, { error: code === 413 ? 'File/data terlalu besar' : e.message });
  }
}

module.exports = { handle, send, store, DEFAULT_PASSWORD };
