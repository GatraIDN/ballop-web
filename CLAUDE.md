# Workflow Ballop (untuk Claude)

Catatan kerja dari user (GatraIDN). Berlaku di akun Claude mana pun, jadi tidak perlu dijelaskan ulang.

## ▶ DAILY ROUTINE BALLOP ("kerjakan daily routine ballop")
Kalau user bilang **"kerjakan daily routine ballop"** (atau "daily routine", "update harian ballop"), jalankan
semua langkah di bawah **berurutan tanpa bertanya lagi**. Detail tiap langkah ada di bagian-bagian di bawahnya.
Semua yang dipakai adalah **file atau data terbaru yang di-download/diambil langsung hari itu**, bukan file lama.

**Aturan umum**
- Browser: Brave + Claude in Chrome. Mulai dengan `tabs_context_mcp {createIfEmpty:true}` dan kerjakan di tab group
  sendiri. Shopee Seller Centre dan TikTok/Tokopedia Seller Centre sudah login. Tab group bisa hilang di tengah jalan;
  kalau tool bilang tab tidak ada di group, panggil `tabs_context_mcp {createIfEmpty:true}` lagi.
- Periode harian = **tanggal 1 bulan berjalan sampai hari ini** (LIVE: sampai kemarin). Diulang setiap hari; semua
  importer upsert/replace sehingga tidak dobel.
- File hasil download masuk ke `C:\Users\danan\Downloads`. Ambil yang paling baru (`Get-ChildItem … | Sort LastWriteTime`).
- Setiap import: **dry run dulu**, cek angkanya masuk akal, baru `--write`. DB = production.
- Ada **password atau verifikasi 2 langkah**? Lewati langkah itu, lanjutkan langkah lain, dan laporkan di akhir. Claude
  tidak mengetik password atau kode verifikasi.
- Kasih update singkat ke user di tiap langkah. Di akhir, laporkan dalam satu tabel ringkasan (langkah, hasil, angka utama, yang dilewati).
- Kalau ada **kode yang berubah**: commit + push langsung (author `GatraIDN <areloa.official@gmail.com>`).
  Import data saja tidak perlu commit.

**Urutan langkah**
1. **Stok gudang → dashboard.** Pakai file stok gudang hari ini (`Stock DD.MM.xlsx` terbaru di Downloads). Kalau file
   hari ini belum ada, minta user mengirim filenya, atau minta link dashboard gudang lalu catat di sini. Import:
   `import-stock-file.js --date=<hari ini>` (lihat "Excel harian").
2. **Stok Shopee & TikTok = stok gudang.** `python -I tools/daily/wh-map.py "<Stock file>" <scratchpad>/wh.json`,
   lalu jalankan `tools/daily/match.js` + `shopee-stock.js` di Shopee (semua halaman, 48/halaman) dan `tiktok-stock.js`
   di TikTok (lihat "Sinkron stok"). Arsip/delist/bundle dilewati.
3. **Order Shopee + TikTok** (export 1–hari ini) → `import-market-file.js`.
4. **Income Shopee + TikTok** (export 1–hari ini) → `import-market-file.js`.
5. **Spending iklan** Shopee (Produk, Toko, Banner, Live, Eksternal/Meta) + TikTok (Product & LIVE GMV Max), per hari
   1–hari ini → `tools/daily/ads.js` → `import-ads-json.js`.
6. **Saldo iklan** (Shopee, Iklan Meta Shopee, TikTok, Meta Billing) → `tools/daily/save-adbudget.js`.
7. **Data LIVE TikTok** (export bulan berjalan, sampai kemarin) → `import-market-file.js`.
8. **Laporan akhir** ke user: tabel per langkah, angka (order baru, omzet, spend, saldo, SKU stok yang berubah),
   dan daftar yang dilewati atau perlu dicek.

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
- Helper siap pakai di `tools/daily/`: `wh-map.py` (stok gudang → wh.json), `match.js` (pencocokan nama/warna/size),
  `shopee-stock.js` (`__shopeeScan()` lalu `__shopeeApply()` per halaman), `tiktok-stock.js` (cara pakai ada di komentar
  file: state disimpan di localStorage karena halaman sering reload; jalankan per 30 detik sampai `complete`, scroll
  ke bawah untuk memuat produk lain). Output tool terpotong ±1.500 karakter, jadi ambil hasilnya sepotong-sepotong.

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
- Helper siap pakai: `tools/daily/ads.js` (paste ke tab, ikuti komentar di file: hook → klik/ubah tanggal → panggil fungsi).
- Simpan baris `[tanggal, tipe, judul, spend, gmv, order, impresi, klik]` ke `shopee.json` / `tiktok.json` (scratchpad),
  lalu: `cd C:/Claude/ballop-web; node --env-file=.env tools/import-ads-json.js shopee.json tiktok.json` (dry run) → `--write`.
- Cek silang: total spend per hari harus sama dengan angka di dashboard Seller Centre.

## Update data LIVE harian (TikTok)
- `seller-id.tokopedia.com/compass/live-analysis/live-details` (Analytics › LIVE & video › LIVE › Details).
  Date picker → mode **Month** → bulan berjalan. Hasilnya tanggal 1 sampai **kemarin**, karena data hari ini belum
  tersedia → **Export** → ikon daftar export → Download (`Live Analysis<timestamp>.xlsx`).
- Import: `node --env-file=.env tools/import-market-file.js "<file>"` (dry run) → `--write`. Satu baris per sesi LIVE,
  key = tanggal + jam mulai. Sesi lama yang sudah punya Room ID dicocokkan lewat tanggal + jam mulai, jadi tidak dobel.

## Update saldo iklan harian (menu "Sisa saldo iklan", data `adbudget`)
Satu record per tanggal: `shopee`, `shopeeExt`, `tiktok`, `metaCampaign`, `metaCpas`. Kalau tanggalnya sama, record lama diganti.
- `shopee`: angka "Saldo Iklan" pertama di `seller.shopee.co.id/portal/marketing/pas/index`.
- `shopeeExt`: "Meta Saldo Iklan" di `seller.shopee.co.id/portal/web-shopping-ads/dashboard`.
- `tiktok`: "Available cash balance" di Payment Portfolio TikTok Business Center (BC "BALLOP INDONESIA").
  Business Center sering minta **verifikasi 2 langkah**. User yang harus menyelesaikannya.
- `metaCampaign` / `metaCpas`: Meta Billing › akun "Campaign Ads" dan "CPAS Shopee".
- Simpan: `node --env-file=.env tools/daily/save-adbudget.js YYYY-MM-DD shopee=… shopeeExt=… [tiktok=…] [metaCampaign=…] [metaCpas=…]`
  (dry run) → tambah `--write`. Saldo yang tidak diisi otomatis disalin dari record terakhir dan dicatat di `note`.

## Laporan penjualan Weekly Eagle (bulanan)
Baca dulu `C:\Claude\data\sales\tools\TUTORIAL-weekly-eagle.md` (script `calc.py`, `ttread.py`, `build2.ps1`,
template 3 channel). Raw data di `C:\Claude\data\sales\<YYYY-MM>\`. Channel: Shopee, TikTok, Tokopedia (Tokopedia
dipisah dari export TikTok lewat kolom `Purchase Channel`). Minggu mulai Senin, minggu parsial di ujung bulan
digabung, item "TIDAK UNTUK DI JUAL" dikecualikan, bulan sebelumnya dihitung ulang dari raw data.

## Merapikan file stok untuk dibaca
Kalau user minta "rapihin data stock": buat salinan `<nama> - Rapi.xlsx` di Downloads dengan sheet Ringkasan Produk
(stok akhir per gudang + total), Stok per Size (pivot gudang jadi kolom) dan Data Lengkap (nama item dipecah jadi
Produk/Warna/Size/EU, ditambah kolom cek). File asli jangan diubah.
