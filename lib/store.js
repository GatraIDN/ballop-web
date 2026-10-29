// Where BALLOP keeps its data. Two backends with the same interface:
//   - Supabase (when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set): table `kv` + Storage bucket `uploads`
//   - local files (default): data/<name>.json + public/uploads/
// Every collection is one JSON value under one key, matching how the admin saves whole lists.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(ROOT, 'public', 'uploads');
const BUCKET = process.env.SUPABASE_BUCKET || 'uploads';
// accept the URL copied with a trailing /rest/v1/ too
const SB_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const useSupabase = !!(SB_URL && SB_KEY);

const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'application/pdf': '.pdf' };
const newName = (type) => `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${IMAGE_EXT[type] || ''}`;

// ---------- local files ----------
const local = {
  name: 'local',
  async get(key, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA, `${key}.json`), 'utf8')); } catch { return fallback; }
  },
  async set(key, value) {
    // write to a temp file first so a crash never leaves half a JSON file
    const f = path.join(DATA, `${key}.json`);
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(value, null, 2));
    fs.renameSync(`${f}.tmp`, f);
  },
  // the browser posts the file body to /api/upload
  async uploadTarget() { return { mode: 'server' }; },
  async saveUpload(type, buf) {
    fs.mkdirSync(UPLOADS, { recursive: true });
    const name = newName(type);
    fs.writeFileSync(path.join(UPLOADS, name), buf);
    return `/uploads/${name}`;
  },
};

// ---------- Supabase (REST, no SDK) ----------
// new-style keys (sb_secret_…) go in `apikey` only; legacy service_role JWTs also as Bearer
const sbHeaders = (extra = {}) => ({ apikey: SB_KEY, ...(SB_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SB_KEY}` } : {}), ...extra });
async function sbFetch(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}
const supabase = {
  name: 'supabase',
  async get(key, fallback) {
    const res = await sbFetch(`${SB_URL}/rest/v1/kv?key=eq.${encodeURIComponent(key)}&select=value`, { headers: sbHeaders() });
    const rows = await res.json();
    return rows.length ? rows[0].value : fallback;
  },
  async set(key, value) {
    await sbFetch(`${SB_URL}/rest/v1/kv?on_conflict=key`, {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
  },
  // the browser uploads straight to Storage with a one-time signed URL (Vercel caps request bodies at 4.5 MB)
  async uploadTarget(type) {
    if (!IMAGE_EXT[type]) throw new Error('Hanya gambar (png/jpg/webp/gif/avif) atau PDF');
    const objectPath = newName(type);
    const res = await sbFetch(`${SB_URL}/storage/v1/object/upload/sign/${BUCKET}/${objectPath}`, {
      method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json' }), body: '{}',
    });
    const { url } = await res.json();
    return {
      mode: 'signed',
      uploadUrl: `${SB_URL}/storage/v1${url}`,
      publicUrl: `${SB_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`,
    };
  },
  async saveUpload(type, buf) {
    const objectPath = newName(type);
    await sbFetch(`${SB_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: 'POST', headers: sbHeaders({ 'Content-Type': type, 'x-upsert': 'false' }), body: buf,
    });
    return `${SB_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
  },
};

module.exports = useSupabase ? supabase : local;
module.exports.IMAGE_EXT = IMAGE_EXT;
