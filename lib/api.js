// BALLOP API, shared by the local server (server.js) and the Vercel function (api/[...path].js).
//   GET  /api/<collection>                       public collections (products, events, gallery, posts)
//   GET  /api/content, /api/settings             landing copy + site settings (public)
//   POST /api/login {password} -> {token}         POST /api/password {current, next}            (admin)
//   PUT  /api/<collection>, /api/content, /api/settings                                         (admin)
//   GET  /api/sales|stock|ads|expenses            business ledgers                               (admin)
//   POST /api/upload-url {type} -> where to send the file;  POST /api/upload (raw body, local)  (admin)
//   GET  /api/backup, POST /api/restore                                                          (admin)
const crypto = require('crypto');
const store = require('./store');

const DEFAULT_PASSWORD = process.env.BALLOP_ADMIN_PASSWORD || 'ballop123';
const TOKEN_TTL = 12 * 60 * 60 * 1000;
const MAX_UPLOAD = 12 * 1024 * 1024;
// signs login tokens so any serverless instance can verify them without shared memory
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`ballop:${process.env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_PASSWORD}`).digest('hex');

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

// ---------- tokens + password ----------
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const makeToken = () => { const exp = String(Date.now() + TOKEN_TTL); return `${exp}.${sign(exp)}`; };
function isAdmin(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return false;
  const [exp, sig] = h.slice(7).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
async function checkPassword(pw) {
  const auth = await store.get('auth', null);
  const given = Buffer.from(auth ? hashPw(pw, auth.salt) : String(pw));
  const want = Buffer.from(auth ? auth.hash : DEFAULT_PASSWORD);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// ---------- field cleaners ----------
const str = (v, n) => String(v ?? '').slice(0, n);
const num = (v, min = 0) => Math.max(min, Number(v) || 0);
const int = (v, min = 0) => Math.max(min, Math.round(Number(v) || 0));
const httpUrl = (v) => (/^https?:\/\//.test(v || '') ? str(v, 400) : '');
const isImg = (v) => /^(\/|https:\/\/)/.test(String(v || ''));
const img = (v) => (isImg(v) ? str(v, 400) : '');
const imgs = (v, n) => (Array.isArray(v) ? v : []).map((x) => str(x, 400)).filter(isImg).slice(0, n);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : new Date().toISOString().slice(0, 10));
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
const list = (v, n, len) => (Array.isArray(v) ? v : []).map((x) => str(x, len)).filter(Boolean).slice(0, n);
const id = (v) => str(v, 80) || crypto.randomUUID();
const oneOf = (v, opts) => (opts.includes(v) ? v : opts[0]);
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

const SALES_CHANNELS = ['shopee', 'tiktok', 'website', 'offline', 'other'];
const AD_CHANNELS = ['meta', 'shopee', 'tiktok', 'google', 'other'];

const CLEAN = {
  products: (p, i) => ({
    id: id(p.id), sku: str(p.sku, 40), name: str(p.name, 80) || 'Untitled', series: str(p.series, 80), category: str(p.category, 40),
    price: num(p.price), oldPrice: num(p.oldPrice), cost: num(p.cost),
    color: hex(p.color, '#5b9bd5'), accent: hex(p.accent, '#e8552b'), hue: Math.round(Number(p.hue) || 0) % 360,
    description: str(p.description, 1200), features: list(p.features, 8, 40), sizes: list(p.sizes, 20, 8),
    images: imgs(p.images, 12), buyUrl: httpUrl(p.buyUrl), lowStock: int(p.lowStock), visible: p.visible !== false, order: i,
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
  stock: (s) => ({
    id: id(s.id), date: isoDate(s.date), type: oneOf(s.type, ['in', 'adjust']), productId: str(s.productId, 80),
    size: str(s.size, 8), qty: Math.round(Number(s.qty) || 0), cost: num(s.cost), note: str(s.note, 200),
  }),
  ads: (a) => ({
    id: id(a.id), date: isoDate(a.date), channel: oneOf(a.channel, AD_CHANNELS), campaign: str(a.campaign, 120),
    spend: num(a.spend), impressions: int(a.impressions), clicks: int(a.clicks), orders: int(a.orders), revenue: num(a.revenue), note: str(a.note, 200),
  }),
  expenses: (x) => ({ id: id(x.id), date: isoDate(x.date), category: str(x.category, 40) || 'Lainnya', amount: num(x.amount), note: str(x.note, 200) }),
};
// which collections the public may read, and how they are filtered
const PUBLIC = {
  products: (all) => all.filter((p) => p.visible !== false),
  events: (all) => all.filter((e) => e.visible !== false).sort((a, b) => b.date.localeCompare(a.date)),
  gallery: (all) => all.filter((g) => g.visible !== false && g.image),
  posts: (all) => all.filter((p) => p.published).sort((a, b) => b.date.localeCompare(a.date)),
};
const PRIVATE = ['sales', 'stock', 'ads', 'expenses'];

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
  if (method === 'GET' && PUBLIC[name]) {
    const all = await store.get(name, []);
    return send(res, 200, url.searchParams.get('all') === '1' && isAdmin(req) ? all : PUBLIC[name](all));
  }
  if (method === 'GET' && (name === 'settings' || name === 'content')) return send(res, 200, await store.get(name, {}));

  if (method === 'POST' && name === 'login') {
    const { password } = (await readJsonBody(req, 4096)) || {};
    if (!(await checkPassword(password || ''))) {
      await new Promise((r) => setTimeout(r, 400)); // slow down guessing
      return send(res, 401, { error: 'Password salah' });
    }
    return send(res, 200, { token: makeToken() });
  }

  if (!isAdmin(req)) return send(res, 401, { error: 'Login dulu' });

  // ----- admin -----
  if (method === 'GET' && PRIVATE.includes(name)) return send(res, 200, await store.get(name, []));
  if (method === 'PUT' && CLEAN[name]) {
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
  if (method === 'PUT' && name === 'settings') {
    const clean = cleanSettings((await readJsonBody(req, 64 * 1024)) || {});
    await store.set('settings', clean);
    return send(res, 200, clean);
  }
  if (method === 'PUT' && name === 'content') {
    const body = await readJsonBody(req, 512 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Expected an object' });
    const clean = cleanContent(body);
    await store.set('content', clean);
    return send(res, 200, clean);
  }
  if (method === 'POST' && name === 'password') {
    const { current, next } = (await readJsonBody(req, 4096)) || {};
    if (!(await checkPassword(current || ''))) return send(res, 400, { error: 'Password lama salah' });
    if (String(next || '').length < 8) return send(res, 400, { error: 'Password baru minimal 8 karakter' });
    const salt = crypto.randomBytes(16).toString('hex');
    await store.set('auth', { salt, hash: hashPw(next, salt) });
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
  if (method === 'GET' && name === 'backup') {
    const all = {};
    for (const k of [...Object.keys(CLEAN), 'settings', 'content']) all[k] = await store.get(k, k === 'settings' || k === 'content' ? {} : []);
    const stamp = new Date().toISOString().slice(0, 10);
    return send(res, 200, JSON.stringify({ app: 'ballop', version: 1, date: new Date().toISOString(), data: all }, null, 2),
      'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="ballop-backup-${stamp}.json"` });
  }
  if (method === 'POST' && name === 'restore') {
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
