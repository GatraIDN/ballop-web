# BALLOP Indonesia: website + admin

Landing page, jurnal/blog, dan dashboard admin (konten + penjualan, stok, iklan, laporan) untuk BALLOP.
Tanpa framework dan tanpa `npm install`: cukup Node 18+ (server `http` bawaan), halaman pakai vanilla JS.

```bash
cd ballop
npm start                                   # http://localhost:4321   admin: /admin   jurnal: /blog
```

Password admin awal `ballop123`. Ganti di **Admin > Pengaturan > Ganti password** (disimpan ter-hash di
`data/auth.json`). Port lain: `$env:PORT=4322; npm start`.

## Deploy ke Vercel + Supabase

Lokal pakai file (`data/`, `public/uploads/`). Online, data disimpan di tabel Supabase `kv` dan foto di
Supabase Storage (bucket `uploads`). Pilihan otomatis: kalau env `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
ada, server pakai Supabase.

1. **Supabase**: buat project, buka **SQL Editor**, jalankan isi `supabase/setup.sql`.
   Ambil `Project URL` dan `service_role` key di **Project Settings > API**.
2. **Pindahkan data lokal** (sekali saja, dari folder `ballop`):
   ```powershell
   $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."; node tools/push-to-supabase.js
   ```
3. **Vercel**: push repo ke GitHub, **Add New Project**, Root Directory = `ballop`, Framework = Other.
   Environment Variables:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_SECRET`: string acak panjang (untuk token login)
   - `BALLOP_ADMIN_PASSWORD`: password awal (sampai diganti di admin)
4. Deploy. Atau lewat CLI: `npx vercel --prod` dari folder `ballop`.

Catatan: `service_role` key rahasia (akses penuh database). Taruh hanya di env Vercel, jangan di kode/GitHub.
Restore backup online dibatasi ±4,5 MB per request oleh Vercel.

## Tim, role, dan data operasional

- **Login**: username + password. Owner = `admin` + password admin. Tim dibuat di **Admin › Pengguna & akses**,
  satu orang boleh banyak role: admin, ecommerce, offline, gudang, creative, marketing, finance.
  Sidebar per divisi hanya menampilkan menu sesuai role; server juga menolak akses di luar role.
- **Penjualan online**: import file export Shopee / TikTok Shop (Order + Income), xlsx atau csv, 1 file berisi
  beberapa sheet atau beberapa file. Kolom dikenali otomatis; import ulang = update, tidak dobel.
- Menu lain: Penjualan offline (toko/distributor/event, piutang tempo), Stok 3PL (snapshot gudang),
  Barang masuk & keluar, KOL seeding (kirim, konten, views, GMV), Keuangan (kas masuk/keluar), Biaya.
- HPP: pakai HPP produk / restock; kalau tidak ada, estimasi `Pengaturan › Rasio HPP default` (35%).

Isi ulang semua data dari file operasional + stock taking (menghapus data lama di menu bisnis):
```bash
python tools/ops-to-json.py "BALLOP_통합운영시트.xlsx" "STOCK TAKING - BALLOP.xlsx" bundle.json
node tools/apply-bundle.js bundle.json      # lokal; set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY untuk online
```

## Halaman

| URL | Isi |
|---|---|
| `/` | Hero (logo besar → pindah ke header saat scroll), story, koleksi rak LED + halaman SKU (morph), teknologi, event, galeri, jurnal, toko |
| `/blog` | Daftar artikel, cari, filter tag |
| `/blog/<slug>` | Baca artikel, share WhatsApp / salin link, artikel terkait |
| `/admin` | Dashboard admin |

Semua teks di halaman depan diambil dari **Admin > Konten halaman** (`data/content.json`).
Tema: putih, kartu glass (seperti notifikasi iPhone) dan kartu solid putih dengan shadow lembut.

## Admin

**Bisnis**
- **Ringkasan**: omzet bersih, laba bersih, unit, pesanan + AOV, biaya iklan, ROAS, CPA, margin (dengan
  perbandingan periode sebelumnya); target bulanan + proyeksi; grafik omzet per channel dan biaya iklan per
  channel; tabel per channel; ROAS per marketplace; produk terlaris; laba rugi; stok menipis; export CSV.
- **Penjualan**: satu baris = satu produk dalam order (Shopee, TikTok Shop, Website/WA, Offline, Lainnya),
  harga, diskon, fee marketplace, ongkir ditanggung, status (selesai / retur / batal).
- **Stok**: sisa per produk per ukuran = barang masuk + penyesuaian − terjual. Restock bisa sekaligus semua
  ukuran. Nilai stok pakai rata-rata harga modal restock (atau HPP produk).
- **Iklan**: spending harian per channel (Meta, Shopee Ads, TikTok Ads, Google, Lainnya) + impresi, klik,
  order dan revenue atribusi → CTR, CPC, ROAS.
- **Biaya**: biaya operasional (gaji, packaging, event, KOL, dll), masuk ke laba rugi.
- Semua ledger: filter, cari, klik baris untuk edit, **import/export CSV** (unduh template dulu; tanggal
  `2026-10-28` atau `28/10/2026`, produk dikenali dari kode SKU).
- **Data contoh**: tombol "Isi data contoh" / "Hapus data contoh" di Ringkasan (baris bertanda `[DEMO]`).

**Website**: Produk (SKU, HPP, batas stok rendah, foto, warna), Event, Galeri, Jurnal (editor markdown +
pratinjau, upload foto/cover, YouTube, draf/terbit, unggulan), Konten halaman.

**Sistem**: Pengaturan (link toko Shopee / TikTok Shop / Tokopedia, sosmed, WhatsApp, target omzet bulanan,
batas stok rendah), ganti password, backup & restore semua data.

## File

| Path | Fungsi |
|---|---|
| `serve.js` | server + API (`/api/<koleksi>`, `/api/content`, `/api/settings`, login, upload, backup) |
| `data/*.json` | semua data (produk, event, galeri, posts, sales, stock, ads, expenses, content, settings) |
| `public/index.html` `content.js` `site.js` `site.css` | landing |
| `public/app.js` `style.css` | katalog rak LED + halaman SKU, token tema bersama |
| `public/blog.*` `md.js` | jurnal + renderer markdown |
| `public/admin.*` `admin-biz.js` `admin-content.js` | admin (core, bisnis, konten) |
| `public/uploads/` | foto hasil upload |
| `tools/cutout.py` | hapus background putih foto produk → PNG transparan |
| `tools/seed-content.js` | isi awal konten & artikel (`--force` untuk menimpa) |

## Catatan

- Foto demo cuma 1 colorway asli (Sky Ember); 7 warna lain hasil geser hue. Ganti dengan foto asli.
- Keranjang hanya di browser pengunjung. Buy Now membuka link beli produk atau WhatsApp.
- Backup tidak termasuk foto: salin folder `public/uploads` terpisah.
- Sebelum online: ganti password admin dan pasang HTTPS (misalnya di belakang Nginx/Caddy).
