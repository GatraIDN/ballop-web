// BALLOP admin: read Shopee / TikTok Shop exports (xlsx or csv, one workbook with several sheets or
// several files) and turn them into normalized order lines + settlements. Each sheet is recognised by
// its column headers, so file and sheet names do not matter.
window.MarketImport = (() => {
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  let loading = null;
  const loadXlsx = () => {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    loading = loading || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = XLSX_URL;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('Gagal memuat pembaca Excel, cek koneksi internet'));
      document.head.appendChild(s);
    });
    return loading;
  };

  // ---------- value parsing ----------
  // "399.900" (Shopee, dot thousands), 339900, "-5000", "1.234,5" -> numbers
  function toNum(v) {
    if (typeof v === 'number') return v;
    let s = String(v ?? '').trim();
    if (!s || s === '-') return 0;
    s = s.replace(/[^\d,.-]/g, '');
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    return Number(s) || 0;
  }
  const pad = (n) => String(n).padStart(2, '0');
  // "25/10/2026 23:56:47", "2026-10-01 00:00", "2026/10/03", Date objects -> "2026-10-25"
  function toDate(v) {
    if (v instanceof Date && !Number.isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    const s = String(v ?? '').trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    // "28 Oct 2026 10:00" / "28 Okt 2026" (Lazada)
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    const mon = m && ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase().replace('mei', 'may').replace('agu', 'aug').replace('okt', 'oct').replace('des', 'dec'));
    if (m && mon >= 0) return `${m[3]}-${pad(mon + 1)}-${pad(m[1])}`;
    return '';
  }
  const text = (v) => String(v ?? '').trim();
  const sizeOf = (variation) => { const t = text(variation).match(/size\s*[:=]\s*([0-9]{2}(?:[.,]5)?|XS|S|M|L|XL|XXL)/i); if (t) return t[1].toUpperCase(); const m = text(variation).match(/(?:^|,|\s)\s*([0-9]{2}(?:[.,]5)?|XS|S|M|L|XL|XXL)\s*$/i); return m ? m[1].toUpperCase() : ''; };
  function stateOf(status, returnedQty, qty, extra = '') {
    const s = `${status} ${extra}`.toLowerCase();
    if (/batal|cancel/.test(s)) return 'cancelled';
    if ((returnedQty && returnedQty >= qty) || /pengembalian|return|refund|dikembalikan/.test(s)) return 'returned';
    if (/selesai|completed|delivered|terkirim/.test(s)) return 'completed';
    return 'pending';
  }

  // ---------- income breakdown ----------
  // Shopee income columns grouped like the report's own Summary sheet; amounts keep the export's sign (− = deducted)
  const FEE_GROUPS = [
    ['Pengembalian dana', ['Jumlah Pengembalian Dana ke Pembeli']],
    ['Voucher & subsidi', ['Voucher disponsor oleh Penjual', 'Cashback Koin disponsori Penjual', 'Diskon Produk dari Shopee', 'Voucher co-fund disponsor oleh Penjual', 'Cashback Koin Co-fund disponsori Penjual']],
    ['Biaya pengiriman', ['Ongkir Dibayar Pembeli', 'Ongkos Kirim yang Dibayarkan ke Jasa Kirim', 'Potongan Ongkos Kirim dari Jasa Kirim', 'Gratis Ongkir dari Shopee', 'Ongkos Kirim Pengembalian Barang', 'Return to Seller Fee', 'Pengembalian Biaya Kirim']],
    ['Biaya platform', ['Biaya Administrasi (termasuk PPN 11%)', 'Biaya Proses Pesanan', 'Biaya Pembayaran']],
    ['Biaya Gratis Ongkir XTRA', ['Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori F)', 'Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori H)']],
    ['Biaya layanan', ['Biaya Transaksi', 'Biaya Layanan Shopee Video XTRA', 'Biaya Layanan Promo XTRA', 'Biaya Layanan Shopee Live XTRA']],
    ['Biaya promosi', ['Biaya Kampanye', 'Biaya Komisi AMS', 'Biaya Isi Saldo Otomatis (dari Penghasilan)']],
    ['Biaya lainnya', ['Premi', 'FBS Fee', 'Biaya Program Hemat Biaya Kirim']],
    ['Pajak', ['PPh 22']],
  ];
  const SHOPEE_DETAIL = FEE_GROUPS.flatMap(([, ks]) => ks);
  const NOT_FEES = ['Pengembalian dana', 'Voucher & subsidi', 'Biaya pengiriman', 'Penyesuaian'];
  // group of any breakdown line, also for TikTok / Tokopedia column names
  function feeGroup(k) {
    const g = FEE_GROUPS.find(([, ks]) => ks.includes(k));
    if (g) return g[0];
    if (/^Biaya Gratis Ongkir XTRA/i.test(k)) return 'Biaya Gratis Ongkir XTRA';
    if (/penyesuaian|kompensasi|setelah dana dilepaskan/i.test(k)) return 'Penyesuaian';
    if (/pengembalian dana|refund/i.test(k)) return 'Pengembalian dana';
    if (/voucher|diskon|cashback|subsidi/i.test(k)) return 'Voucher & subsidi';
    if (/ongkir|ongkos kirim|pengiriman|shipping/i.test(k)) return 'Biaya pengiriman';
    if (/pajak|pph|ppn|tax/i.test(k)) return 'Pajak';
    if (/komisi|afiliasi|affiliate|promosi|kampanye|iklan|ams/i.test(k)) return 'Biaya promosi';
    if (/layanan|service|transaksi/i.test(k)) return 'Biaya layanan';
    if (/admin|platform|proses|pembayaran|payment/i.test(k)) return 'Biaya platform';
    return 'Biaya lainnya';
  }
  const GROUP_ORDER = ['Pengembalian dana', 'Voucher & subsidi', 'Biaya pengiriman', 'Biaya platform', 'Biaya Gratis Ongkir XTRA', 'Biaya layanan', 'Biaya promosi', 'Biaya lainnya', 'Pajak', 'Penyesuaian'];

  // ---------- sheet recognisers ----------
  // each: find(headerRow) -> boolean, rows(objects) -> normalized records
  const KINDS = {
    tiktokOrders: {
      label: 'Order TikTok Shop', target: 'orders',
      match: (h) => h.includes('Order ID') && (h.includes('Seller SKU') || h.includes('SKU ID')),
      map: (r) => {
        const orderId = text(r['Order ID']);
        if (!/^\d{6,}$/.test(orderId)) return null; // skips the description row under the headers
        const qty = toNum(r.Quantity);
        const ret = toNum(r['Sku Quantity of return']);
        return {
          key: `tiktok:${orderId}:${text(r['SKU ID']) || text(r['Seller SKU'])}`, channel: 'tiktok', orderId,
          status: text(r['Order Status']), state: stateOf(r['Order Status'], ret, qty, r['Cancelation/Return Type']),
          date: toDate(r['Created Time']), sku: text(r['Seller SKU']) || text(r['SKU ID']), productName: text(r['Product Name']),
          variation: text(r.Variation), size: sizeOf(r.Variation), qty, returnedQty: ret,
          unitPrice: toNum(r['SKU Unit Original Price']), gross: toNum(r['SKU Subtotal Before Discount']),
          platformDiscount: toNum(r['SKU Platform Discount']), sellerDiscount: toNum(r['SKU Seller Discount']),
          net: toNum(r['SKU Subtotal After Discount']), buyerPaid: toNum(r['Order Amount']),
          province: text(r.Province), city: text(r['Regency and City']), courier: text(r['Shipping Provider Name']), payment: text(r['Payment Method']),
        };
      },
    },
    shopeeOrders: {
      label: 'Order Shopee', target: 'orders',
      match: (h) => h.includes('No. Pesanan') && h.includes('Status Pesanan'),
      map: (r) => {
        const orderId = text(r['No. Pesanan']);
        if (!orderId) return null;
        const qty = toNum(r.Jumlah);
        const ret = toNum(r['Returned quantity']);
        const unit = toNum(r['Harga Awal']);
        const after = toNum(r['Harga Setelah Diskon']);
        const sku = text(r['Nomor Referensi SKU']) || text(r['SKU Induk']);
        return {
          key: `shopee:${orderId}:${sku}:${text(r['Nama Variasi'])}`, channel: 'shopee', orderId,
          status: text(r['Status Pesanan']), state: stateOf(r['Status Pesanan'], ret, qty, r['Status Pembatalan/ Pengembalian']),
          date: toDate(r['Waktu Pesanan Dibuat']), sku, productName: text(r['Nama Produk']),
          variation: text(r['Nama Variasi']), size: sizeOf(r['Nama Variasi']), qty, returnedQty: ret,
          unitPrice: unit, gross: unit * qty, sellerDiscount: toNum(r['Diskon Dari Penjual']), platformDiscount: toNum(r['Diskon Dari Shopee']),
          net: toNum(r['Subtotal Pesanan']) || after * qty, buyerPaid: toNum(r['Total Pembayaran']),
          province: text(r.Provinsi), city: text(r['Kota/Kabupaten']), courier: text(r['Opsi Pengiriman']), payment: text(r['Metode Pembayaran']),
        };
      },
    },
    // Lazada Seller Center order export: one row per item unit (camelCase or spaced headers)
    lazadaOrders: {
      label: 'Order Lazada', target: 'orders',
      match: (h) => (h.includes('orderNumber') || h.includes('Order Number')) && (h.includes('sellerSku') || h.includes('Seller SKU')),
      map: (r) => {
        const g = (...ks) => { for (const k of ks) if (r[k] !== undefined && r[k] !== '') return r[k]; return ''; };
        const orderId = text(g('orderNumber', 'Order Number'));
        const itemId = text(g('orderItemId', 'Order Item Id'));
        if (!orderId) return null;
        const status = text(g('status', 'Status'));
        const unit = toNum(g('unitPrice', 'Unit Price'));
        const paid = toNum(g('paidPrice', 'Paid Price'));
        const variation = text(g('variation', 'Variation'));
        return {
          key: `lazada:${orderId}:${itemId || text(g('sellerSku', 'Seller SKU'))}`, channel: 'lazada', orderId, status,
          state: stateOf(status, 0, 1, g('refundAmount', 'Refund Amount') ? 'refund' : ''), date: toDate(g('createTime', 'Created at', 'Created At')),
          sku: text(g('sellerSku', 'Seller SKU')), productName: text(g('itemName', 'Item Name')), variation, size: sizeOf(variation),
          qty: 1, returnedQty: 0, unitPrice: unit, gross: unit, sellerDiscount: Math.abs(toNum(g('sellerDiscountTotal', 'Seller Discount Total'))),
          platformDiscount: Math.max(0, unit - paid - Math.abs(toNum(g('sellerDiscountTotal', 'Seller Discount Total')))), net: paid || unit,
          buyerPaid: paid, city: text(g('shippingCity', 'Shipping City')), province: text(g('shippingRegion', 'Shipping Region')),
          courier: text(g('shippingProvider', 'Shipping Provider')), payment: text(g('payMethod', 'Payment Method')),
        };
      },
    },
    tiktokIncome: {
      label: 'Income / dana cair TikTok Shop', target: 'settlements',
      match: (h) => h.includes('ID Pesanan/Penyesuaian') || h.includes('Order/adjustment ID'),
      map: (r) => {
        const idv = text(r['ID Pesanan/Penyesuaian'] ?? r['Order/adjustment ID']);
        if (!idv) return null;
        const type = text(r['Jenis transaksi'] ?? r.Type);
        const sumOf = (pred) => Object.entries(r).reduce((s, [k, v]) => (pred(k) ? s + toNum(v) : s), 0);
        return {
          key: `tiktok:${idv}:${type}`, channel: 'tiktok', orderId: text(r['ID pesanan terkait']) || idv, type,
          date: toDate(r['Waktu pemesanan']), releaseDate: toDate(r['Waktu penyelesaian'] ?? r['Waktu pembayaran pesanan']),
          productPrice: toNum(r['Subtotal setelah diskon penjual']), payout: toNum(r['Jumlah penyelesaian pembayaran'] ?? r['Total Pendapatan']),
          fees: toNum(r['Total Biaya']), adminFee: toNum(r['Biaya komisi platform']),
          serviceFee: sumOf((k) => /^Biaya layanan|^Biaya pemrosesan|^Biaya Pembayaran$/i.test(k)),
          affiliateFee: sumOf((k) => /^Komisi (Afiliasi|mitra afiliasi|Iklan Toko afiliasi|dinamis)/i.test(k)),
          shipping: toNum(r.Ongkir), refund: toNum(r['Total pengembalian dana setelah diskon']), sellerDiscount: toNum(r['Diskon penjual']),
        };
      },
    },
    shopeeIncome: {
      label: 'Income / dana cair Shopee', target: 'settlements',
      match: (h) => h.includes('Lihat berdasarkan') && h.includes('No. Pesanan'),
      map: (r) => {
        const by = text(r['Lihat berdasarkan']).toLowerCase();
        const orderId = text(r['No. Pesanan']);
        if (!orderId) return null;
        // per-SKU rows repeat the order totals; only the product name + its price are kept, attached in finish()
        if (by === 'sku') return { sku: true, orderId, date: '', name: text(r['Nama Produk']), productId: text(r['ID Produk']), price: toNum(r['Harga Produk']) };
        if (by !== 'order') return null;
        const n = (k) => toNum(r[k]);
        const detail = {};
        SHOPEE_DETAIL.forEach((k) => { if (n(k)) detail[k] = n(k); });
        const sumG = (pred) => Object.entries(detail).reduce((t, [k, v]) => (pred(feeGroup(k)) ? t + v : t), 0);
        const admin = n('Biaya Administrasi (termasuk PPN 11%)');
        const aff = n('Biaya Komisi AMS');
        const fees = sumG((g) => !NOT_FEES.includes(g));
        return {
          key: `shopee:${orderId}:${text(r['No. Pengajuan']).replace(/^-$/, '')}`, channel: 'shopee', orderId, type: text(r['Tipe Pesanan']),
          date: toDate(r['Waktu Pesanan Dibuat']), releaseDate: toDate(r['Tanggal Dana Dilepaskan']), productPrice: n('Harga Produk'),
          payout: n('Total Penghasilan'), fees, adminFee: admin, serviceFee: fees - admin - aff, affiliateFee: aff, shipping: sumG((g) => g === 'Biaya pengiriman'),
          refund: n('Jumlah Pengembalian Dana ke Pembeli'), sellerDiscount: n('Voucher disponsor oleh Penjual'),
          detail, items: [], buyerPaid: n('Jumlah Dibayar Pembeli'), courier: text(r['Nama Kurir']), payment: text(r['Metode pembayaran pembeli']),
        };
      },
      finish: (rows) => {
        const byOrder = new Map(rows.filter((x) => !x.sku).map((x) => [x.orderId, x]));
        rows.filter((x) => x.sku).forEach((x) => byOrder.get(x.orderId)?.items.push({ name: x.name, productId: x.productId, price: x.price }));
        return [...byOrder.values()];
      },
    },
    // TikTok Shop Creator "Live Performance" export: one row per LIVE session
    tiktokLive: {
      label: 'Live performance TikTok', target: 'live',
      match: (h) => h.includes('Room ID') && h.includes('Attributed GMV'),
      map: (r) => {
        const roomId = text(r['Room ID']);
        if (!/^\d{6,}$/.test(roomId)) return null;
        const dur = text(r.Duration).match(/(?:(\d+)h)?\s*(?:(\d+)m)?/);
        return {
          key: `tiktok:live:${roomId}`, channel: 'tiktok', roomId, title: text(r['Room Title']), date: toDate(r['Start Time']),
          start: text(r['Start Time']).slice(11, 16), end: text(r['End Time']).slice(11, 16), minutes: (Number(dur?.[1]) || 0) * 60 + (Number(dur?.[2]) || 0),
          gmv: toNum(r['Attributed GMV']), items: toNum(r['Attributed items sold']), orders: toNum(r['Attributed orders']), customers: toNum(r.Customers),
          views: toNum(r.Views), impressions: toNum(r.Impressions), productImpressions: toNum(r['Product Impressions']), productClicks: toNum(r['Product clicks']),
          avgWatch: toNum(r['Avg. viewing duration']), followers: toNum(r['New followers']), comments: toNum(r.Comments), shares: toNum(r.Shares), likes: toNum(r.Likes),
        };
      },
    },
    // "Adjustment" sheet of the Shopee income report: refunds after payout, compensations
    shopeeAdjust: {
      label: 'Penyesuaian Shopee', target: 'settlements',
      match: (h) => h.includes('Tanggal Penyesuaian Dibuat') && h.includes('Biaya Penyesuaian'),
      map: (r) => {
        const date = toDate(r['Tanggal Penyesuaian Dibuat']);
        const amount = toNum(r['Biaya Penyesuaian']);
        if (!date || !amount) return null;
        const what = text(r['Tipe Penyesuaian | Deskripsi']) || 'Penyesuaian';
        const orderId = text(r['No. Pesanan Terhubung']);
        return {
          key: `shopee:adj:${date}:${orderId}:${amount}`, channel: 'shopee', orderId, type: 'Penyesuaian', date, releaseDate: date,
          payout: amount, fees: 0, detail: { [what]: amount }, note: text(r['Alasan Penyesuaian']),
        };
      },
    },
  };

  // find the header row (first 20 rows, Shopee puts notes above it) and the kind it belongs to
  function readSheet(aoa) {
    for (let i = 0; i < Math.min(20, aoa.length); i++) {
      const head = (aoa[i] || []).map(text);
      const kind = Object.keys(KINDS).find((k) => KINDS[k].match(head));
      if (!kind) continue;
      const out = [];
      aoa.slice(i + 1).forEach((row) => {
        if (!row || !row.some((c) => text(c))) return;
        const obj = {};
        head.forEach((h, j) => { if (h && !(h in obj)) obj[h] = row[j]; });
        const rec = KINDS[kind].map(obj);
        if (rec && rec.date !== undefined) out.push(rec);
      });
      return { kind, rows: KINDS[kind].finish ? KINDS[kind].finish(out) : out };
    }
    return null;
  }

  async function readFiles(files) {
    const XLSX = await loadXlsx();
    const found = [];
    const unknown = [];
    for (const file of files) {
      const buf = await file.arrayBuffer();
      const isCsv = /\.csv$/i.test(file.name);
      const wb = isCsv
        ? XLSX.read(new TextDecoder('utf-8').decode(buf).replace(/^﻿/, ''), { type: 'string', raw: true })
        : XLSX.read(buf, { type: 'array', cellDates: true });
      wb.SheetNames.forEach((sn) => {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
        const res = readSheet(aoa);
        if (res) found.push({ file: file.name, sheet: sn, ...res });
        else unknown.push(`${file.name}${wb.SheetNames.length > 1 ? ` › ${sn}` : ''}`);
      });
    }
    return { found, unknown };
  }

  // a blank workbook with the 4 sheets in the marketplace column layout
  async function template() {
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    const sheets = {
      OrderTiktok: ['Order ID', 'Order Status', 'Cancelation/Return Type', 'SKU ID', 'Seller SKU', 'Product Name', 'Variation', 'Quantity', 'Sku Quantity of return', 'SKU Unit Original Price', 'SKU Subtotal Before Discount', 'SKU Platform Discount', 'SKU Seller Discount', 'SKU Subtotal After Discount', 'Order Amount', 'Created Time', 'Shipping Provider Name', 'Province', 'Regency and City', 'Payment Method'],
      IncomeTiktok: ['ID Pesanan/Penyesuaian', 'Jenis transaksi', 'Waktu pemesanan', 'Waktu pembayaran pesanan', 'Jumlah penyelesaian pembayaran', 'Subtotal setelah diskon penjual', 'Diskon penjual', 'Total pengembalian dana setelah diskon', 'Total Biaya', 'Biaya komisi platform', 'Ongkir', 'Komisi Afiliasi', 'ID pesanan terkait'],
      OrderShopee: ['No. Pesanan', 'Status Pesanan', 'Status Pembatalan/ Pengembalian', 'Opsi Pengiriman', 'Metode Pembayaran', 'Waktu Pesanan Dibuat', 'SKU Induk', 'Nama Produk', 'Nomor Referensi SKU', 'Nama Variasi', 'Harga Awal', 'Harga Setelah Diskon', 'Jumlah', 'Returned quantity', 'Subtotal Pesanan', 'Diskon Dari Penjual', 'Diskon Dari Shopee', 'Total Pembayaran', 'Kota/Kabupaten', 'Provinsi'],
      IncomeShopee: ['No.', 'Lihat berdasarkan', 'No. Pesanan', 'No. Pengajuan', 'Waktu Pesanan Dibuat', 'Tanggal Dana Dilepaskan', 'Tipe Pesanan', 'Total Penghasilan', 'Harga Produk', 'Jumlah Pengembalian Dana ke Pembeli', 'Ongkir Dibayar Pembeli', 'Ongkos Kirim yang Dibayarkan ke Jasa Kirim', 'Voucher disponsor oleh Penjual', 'Biaya Administrasi (termasuk PPN 11%)', 'Biaya Proses Pesanan', 'Biaya Layanan Promo XTRA', 'Biaya Komisi AMS', 'Premi'],
    };
    Object.entries(sheets).forEach(([n, h]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([h]), n));
    XLSX.writeFile(wb, 'template-penjualan-ballop.xlsx');
  }

  return { readFiles, template, KINDS, toNum, toDate, feeGroup, GROUP_ORDER, NOT_FEES };
})();
