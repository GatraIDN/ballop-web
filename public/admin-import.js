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
  const sizeOf = (variation) => { const t = text(variation).match(/size\s*[:=]\s*([0-9]{2}(?:[.,]5)?|XS|S|M|L|XL|XXL)/i); if (t) return t[1].toUpperCase(); const m = text(variation).match(/(?:,|\s)\s*([0-9]{2}(?:[.,]5)?|XS|S|M|L|XL|XXL)\s*$/i); return m ? m[1].toUpperCase() : ''; };
  function stateOf(status, returnedQty, qty, extra = '') {
    const s = `${status} ${extra}`.toLowerCase();
    if (/batal|cancel/.test(s)) return 'cancelled';
    if ((returnedQty && returnedQty >= qty) || /pengembalian|return|refund|dikembalikan/.test(s)) return 'returned';
    if (/selesai|completed|delivered|terkirim/.test(s)) return 'completed';
    return 'pending';
  }

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
        if (text(r['Lihat berdasarkan']).toLowerCase() !== 'order') return null; // per-SKU rows repeat the order totals
        const orderId = text(r['No. Pesanan']);
        if (!orderId) return null;
        const n = (k) => toNum(r[k]);
        const service = ['Biaya Proses Pesanan', 'Biaya Pembayaran', 'Biaya Transaksi', 'Biaya Layanan Shopee Video XTRA', 'Biaya Layanan Promo XTRA',
          'Biaya Layanan Shopee Live XTRA', 'Biaya Kampanye', 'Premi', 'FBS Fee'].reduce((s, k) => s + n(k), 0);
        const admin = n('Biaya Administrasi (termasuk PPN 11%)');
        const aff = n('Biaya Komisi AMS');
        return {
          key: `shopee:${orderId}:${text(r['No. Pengajuan']).replace(/^-$/, '')}`, channel: 'shopee', orderId, type: text(r['Tipe Pesanan']),
          date: toDate(r['Waktu Pesanan Dibuat']), releaseDate: toDate(r['Tanggal Dana Dilepaskan']), productPrice: n('Harga Produk'),
          payout: n('Total Penghasilan'), fees: admin + service + aff + n('PPh 22'), adminFee: admin, serviceFee: service, affiliateFee: aff,
          shipping: n('Ongkir Dibayar Pembeli') + n('Ongkos Kirim yang Dibayarkan ke Jasa Kirim') + n('Gratis Ongkir dari Shopee') + n('Potongan Ongkos Kirim dari Jasa Kirim'),
          refund: n('Jumlah Pengembalian Dana ke Pembeli'), sellerDiscount: n('Voucher disponsor oleh Penjual'),
        };
      },
    },
  };

  // find the header row (first 6 rows) and the kind it belongs to
  function readSheet(aoa) {
    for (let i = 0; i < Math.min(6, aoa.length); i++) {
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
      return { kind, rows: out };
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

  return { readFiles, template, KINDS, toNum, toDate };
})();
