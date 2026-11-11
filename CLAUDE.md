# Workflow Ballop (untuk Claude)

Catatan kerja dari user (GatraIDN). Berlaku di akun Claude mana pun, jadi tidak perlu dijelaskan ulang.

## Repo & deploy
- Repo `C:\Claude\ballop-web` → GitHub `GatraIDN/ballop-web`, branch `main`, auto-deploy Vercel ke **ballop.web.id**.
- **Setiap perubahan kode langsung commit + push** ke `main` tanpa tanya (git user.name `GatraIDN`). Jangan pernah commit `.env`.
- `.env` lokal menunjuk ke **Supabase production** yang sama dengan situs live. Edit di admin lokal = mengubah data asli.
- Jalankan lokal: launch config `ballop-web` di `C:\Claude\.claude\launch.json` (port 4321).
- `gh` CLI ada di `"C:\Program Files\GitHub CLI\gh.exe"` (tidak ada di PATH), login sebagai GatraIDN.

## Excel harian dari user → import ke DB
User mengirim Excel harian di `Downloads`. Update data ke kode/DB lalu commit + push otomatis (kalau ada kode yang berubah).
- **Stok 3PL** (`Stock DD.MM.xlsx`, kolom Customer/Item/UoM/W/H/Opening/…/Ending):
  ```
  cd C:/Claude/ballop-web; node --env-file=.env tools/import-stock-file.js "<file>" --date=YYYY-MM-DD
  ```
  Itu dry run. Ulangi dengan `--write` untuk menyimpan. Script menulis `stock3pl` + `stockhist` dan backup di `data/`
  (`data/` di-gitignore, jadi import data saja tidak perlu commit).
- Format lain: cek dulu `tools/` (`import-market-file.js`, `import-ads-json.js`, `import-consign.js`, `ops-to-json.py`,
  `stocktaking-to-json.py`, `apply-bundle.js`, `split-tokopedia.js`) sebelum membuat importer baru.

## Sinkron stok Shopee & TikTok dari data gudang
Permintaan rutin: "update stock di tiktok & shopee pake data gudang terbaru".
- Sumber angka: file stok gudang terbaru. **Stok = jumlah `Ending` gudang NORMAL** (Bintaro + Gunung Sindur);
  gudang DAMAGED tidak dihitung.
- Browser: Brave + ekstensi Claude in Chrome. Buat tab group baru (`tabs_context_mcp` createIfEmpty). Kedua seller
  center sudah login di Brave.
- **Edit dari daftar produk saja, jangan buka produk satu per satu:**
  - Shopee: `seller.shopee.co.id/portal/product/list/all?page=1&size=48`. Klik "Lihat Semua (n SKU Produk)" untuk
    membuka semua varian. Ikon pensil (`.quick-edit-icon`) di kolom Stok membuka popup "Atur Stok" berisi semua
    varian satu produk → isi angka → klik **Update**.
  - TikTok/Tokopedia: `seller-id.tokopedia.com/product/manage?tab=active`. Klik "Expand" per produk. Klik kolom stok
    SKU → popover "Total stock" → isi → **Save**. Bandingkan dengan **Total stock** di popover, bukan angka di list
    (angka list = available, tanpa reserved/committed). List-nya lazy-load, jadi scroll ke bawah untuk memuat produk berikutnya.
- **Lewati** listing yang **diarsipkan / delist / deactivated** (permintaan user), dan listing **bundle/set**
  (Complete Set, Match Set, Flex Set, Play & Recover, Recovery Set). Laporkan saja, jangan diubah.
- Pencocokan: nama produk + warna + ukuran EU. Nama di gudang bisa beda dari nama di marketplace:
  Wayden = WYDN S200, Veloster = BALLOSTER, Speedster "neon" = TURBO SPEEDSTER R4 NEON, Rora Mary Jane = VELCRO RORA
  MARY/MERY JANE, Bed King Acupressure (EU 39/40/42/43) = BEDKING DIET SLIPPERS, warna Black di Attivo/Ready Walk =
  ALL BLACK, Gradient White = OFF WHITE. Ukuran gudang seperti `235~240 (EU 36.5~37)` = Shopee `EU 36.5/37`.
  Kalau ragu, jangan diubah; laporkan ke user.
- Shopee punya "Stok Dikunci untuk Promosi". Total stok tetap di-set sama dengan angka gudang.

## Update order & income harian (Shopee + TikTok)
Setiap hari export **dari tanggal 1 bulan berjalan sampai hari ini** (mis. tgl 11 → 1–11, besok 1–12). Import
upsert berdasarkan key, jadi data yang diulang tidak dobel. Buka di tab baru (Brave, Claude in Chrome).
1. **Shopee order**: `seller.shopee.co.id/portal/sale/order` → Export → periode 01–hari ini → Export → Download
   (`Order.all.YYYYMMDD_YYYYMMDD.xlsx`).
2. **Shopee income**: `seller.shopee.co.id/portal/finance/income` → tab "Sudah Dilepas" → periode "Dalam bulan ini"
   → Export → ikon daftar laporan → Download (`Income.sudah dilepas.id.….xlsx`).
3. **TikTok order**: `seller-id.tokopedia.com/order` → tab All → Filter → Time created "Current month" → Apply →
   Export → format Excel → Export → Download (`All order-YYYY-MM-DD-HH_MM.xlsx`).
4. **TikTok income**: `seller-id.tokopedia.com/finance/bills` → Statements → View by statements → Export → "This month"
   → OK → Export → Export history → Download (`income_<timestamp>(UTC+7).xlsx`).
5. Import tiap file (dry run dulu, lalu `--write`):
   `cd C:/Claude/ballop-web; node --env-file=.env tools/import-market-file.js "<file>" --write`
   Order Tokopedia otomatis dipisah dari export TikTok (kolom Purchase Channel / Order source).
- Kalau halaman meminta password, minta user yang memasukkannya. Claude tidak mengetik atau mengisi password.

## Update spending iklan harian (Shopee + TikTok)
Sama seperti order/income: tiap hari tarik **tanggal 1 sampai hari ini**, data **per hari**. Import mengganti
baris iklan Shopee & GMV Max di rentang tanggal itu, jadi tidak dobel. Ambil lewat API internal halaman (fetch dari
tab yang sudah login), bukan download file:
- **Shopee Iklan Shopee** (`seller.shopee.co.id/portal/marketing/pas/index`): tangkap URL + body request
  `POST /api/pas/v1/report/get_time_graph/` (hook XHR, lalu klik tab Iklan Produk). Kirim ulang dengan
  `start_time`/`end_time` (unix, WIB 00:00 tgl 1 sampai 23:59:59 hari ini), `agg_interval: 96` (= per hari; 24 = per 6 jam),
  `campaign_type` + `filter_params.campaign_type`:
  `product_homepage_v2` (Iklan Produk → tipe P), `shop_homepage` (Iklan Toko → S), `search_brand_homepage` (Banner → B),
  `live_stream_homepage` (Live → L). Metrics: `cost`, `broad_gmv` (keduanya **dibagi 100000**), `broad_order`,
  `impression`, `click`. Jangan pakai `new_cpc_homepage` (gabungan produk + toko).
- **Shopee Iklan Eksternal** (`seller.shopee.co.id/portal/web-shopping-ads/dashboard`): tangkap URL
  `GET /api/selleradmin/v1/report/account/list`, ganti `channel_type=102` (Iklan Meta/CPAS; 104 = eksternal lain),
  `data_group_by_type=2` (per hari), `start_time`/`end_time` unix. `adv_list` berisi expense_local/impressions/clicks,
  `sale_list` berisi gmv_local/orders → tipe E.
- **TikTok GMV Max** (`seller-id.tokopedia.com/ads-creation/dashboard`): tangkap URL + body
  `POST /oec_ads/shopping/v1/oec/stat/post_overview_stat` (ubah tanggal di dashboard). Kirim per hari
  (`start_time` = `end_time` = `YYYY-MM-DD`, `campaign_shop_automation_type: 2`) dengan `external_type_list: ["304"]`
  = **Product GMV Max** (tipe G) dan `["305"]` = **LIVE GMV Max** (tipe GL). Metrics: `cost`,
  `onsite_roi2_shopping_value` (gross revenue), `onsite_roi2_shopping_sku` (order).
- Simpan baris `[tanggal, tipe, judul, spend, gmv, order, impresi, klik]` ke `shopee.json` / `tiktok.json` (scratchpad),
  lalu: `cd C:/Claude/ballop-web; node --env-file=.env tools/import-ads-json.js shopee.json tiktok.json` (dry run) → `--write`.
- Cek silang: total spend per hari harus sama dengan angka di dashboard Seller Centre.

## Laporan penjualan Weekly Eagle (bulanan)
Baca dulu `C:\Claude\data\sales\tools\TUTORIAL-weekly-eagle.md` (script `calc.py`, `ttread.py`, `build2.ps1`,
template 3 channel). Raw data di `C:\Claude\data\sales\<YYYY-MM>\`. Channel: Shopee, TikTok, Tokopedia (Tokopedia
dipisah dari export TikTok lewat kolom `Purchase Channel`). Minggu mulai Senin, minggu parsial di ujung bulan
digabung, item "TIDAK UNTUK DI JUAL" dikecualikan, bulan sebelumnya dihitung ulang dari raw data.

## Merapikan file stok untuk dibaca
Kalau user minta "rapihin data stock": buat salinan `<nama> - Rapi.xlsx` di Downloads dengan sheet Ringkasan Produk
(stok akhir per gudang + total), Stok per Size (pivot gudang jadi kolom) dan Data Lengkap (nama item dipecah jadi
Produk/Warna/Size/EU, ditambah kolom cek). File asli jangan diubah.
