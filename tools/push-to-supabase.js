// Copy the local data/*.json (and photos in public/uploads) into Supabase. Run once before/after the
// first Vercel deploy. Rewrites /uploads/... links to the Storage URLs.
// usage (PowerShell):
//   $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."; node tools/push-to-supabase.js
const fs = require('fs');
const path = require('path');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Isi dulu SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const store = require('../lib/store');
const DATA = path.join(__dirname, '..', 'data');
const UPLOADS = path.join(__dirname, '..', 'public', 'uploads');
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };

(async () => {
  // 1. photos
  const map = {};
  if (fs.existsSync(UPLOADS)) {
    for (const f of fs.readdirSync(UPLOADS)) {
      const type = TYPES[path.extname(f).toLowerCase()];
      if (!type) continue;
      map[`/uploads/${f}`] = await store.saveUpload(type, fs.readFileSync(path.join(UPLOADS, f)));
      console.log('foto', f);
    }
  }
  // 2. data, with upload links rewritten
  const files = fs.readdirSync(DATA).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    let text = fs.readFileSync(path.join(DATA, f), 'utf8');
    Object.entries(map).forEach(([from, to]) => { text = text.split(from).join(to); });
    await store.set(path.basename(f, '.json'), JSON.parse(text));
    console.log('data', f);
  }
  console.log(`Selesai: ${files.length} data, ${Object.keys(map).length} foto.`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
