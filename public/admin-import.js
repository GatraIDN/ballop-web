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
    // Shopee "Pesanan diterima, namun Pembeli masih dapat mengajukan pengembalian hingga …" is a received order,
    // not a return: drop that phrase before looking for return words
    const s = `${status} ${extra}`.toLowerCase().replace(/masih dapat mengajukan pengembalian[^,;]*/g, '');
    if (/batal|cancel/.test(s)) return 'cancelled';
    if (/pesanan diterima/.test(s) && !(returnedQty && returnedQty >= qty) && !/pengembalian|return|refund|dikembalikan/.test(s)) return 'completed';
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
  // TikTok Shop income (English export): the leaf columns of its Reports sheet, placed in the same groups
  const TIKTOK_GROUPS = {'Biaya platform': ['Platform commission fee', 'Pre-order service fee', 'Mall service fee', 'Payment Fee', 'Credit card installment - Handling fee', 'Order processing fee', 'Platform special service fee', 'PayLater program fee', 'Dilayani Tokopedia fee', 'Dilayani Tokopedia handling fee'], 'Biaya pengiriman': ['Shipping costs passed on to the logistics provider', 'Replacement shipping fee (passed on to the customer)', 'Exchange shipping fee (passed on to the customer)', 'Shipping cost borne by the platform', 'Shipping cost paid by the customer', 'Refunded shipping cost paid by the customer', 'Return shipping costs (passed on to the customer)', 'Shipping cost subsidy', 'Distance shipping fee from Horizon+ Program', 'Logistics service fee', 'Insurance reimbursement', 'Failed delivery shipping fee', 'Buyer-fault return shipping fee', 'Insurance fee'], 'Biaya layanan': ['Shipping Fee Program service fee', 'Growth Xtra Program service fee', 'LIVE Specials service fee', 'Growth Xtra Program Super service fee', 'EAMS Program service fee', 'Brands Crazy Deals/Flash Sale service fee', 'Campaign resource fee', 'Installation service fee', 'Managed service plan (Per order fee)'], 'Biaya promosi': ['Affiliate Commission', 'Affiliate partner commission', 'Affiliate Shop Ads commission', 'Affiliate commission deposit', 'Affiliate commission refund', 'Affiliate Partner shop ads commission', 'Dynamic commission', 'GMV Max ad fee', 'GMV Max coupon'], 'Biaya lainnya': ['Distance item fee from Horizon+ Program'], 'Pajak': ['Article 22 Income Tax withheld', 'GMV Max coupon sales tax', 'Managed service plan (Sales tax)'], 'Pengembalian dana': ['Refund amount after discount']};
  Object.entries(TIKTOK_GROUPS).forEach(([g, ks]) => FEE_GROUPS.find(([n]) => n === g)[1].push(...ks));
  const TIKTOK_DETAIL = Object.values(TIKTOK_GROUPS).flat();
  // TikTok income export in Indonesian -> the English column names above
  const TIKTOK_ID_EN = {"ID Pesanan/Penyesuaian":"Order/Adjustment ID","Jenis transaksi":"Transaction type","Waktu pemesanan":"Order created time","Waktu pembayaran pesanan":"Order settled time","Mata uang":"Currency","Jumlah penyelesaian pembayaran":"Total settlement amount","Total Pendapatan":"Total Revenue","Subtotal setelah diskon penjual":"Subtotal after seller discounts","Subtotal sebelum diskon":"Subtotal before discount","Diskon penjual":"Seller discounts","Biaya produk sesuai jarak dari Program Horison+":"Distance item fee from Horizon+ Program","Total pengembalian dana setelah diskon":"Refund amount after discount","Total pengembalian dana sebelum diskon":"Refund amount before discount","Pengembalian dana diskon penjual":"Refund of seller discounts","Total Biaya":"Total Fees","Biaya komisi platform":"Platform commission fee","Biaya layanan pre-order":"Pre-order service fee","Biaya layanan Mall":"Mall service fee","Biaya Pembayaran":"Payment Fee","Ongkir":"Shipping cost","Ongkir yang ditalangi penyedia jasa logistik":"Shipping costs passed on to the logistics provider","Ongkir penggantian (ditanggung pembeli)":"Replacement shipping fee (passed on to the customer)","Ongkir penukaran (ditanggung pembeli)":"Exchange shipping fee (passed on to the customer)","Ongkir yang ditanggung platform":"Shipping cost borne by the platform","Ongkir yang ditanggung pembeli":"Shipping cost paid by the customer","Pengembalian ongkir yang dibayar pembeli":"Refunded shipping cost paid by the customer","Ongkir pengembalian barang (yang ditanggung pembeli)":"Return shipping costs (passed on to the customer)","Subsidi ongkir":"Shipping cost subsidy","Biaya pengiriman sesuai jarak dari Program Horison+":"Distance shipping fee from Horizon+ Program","Biaya layanan logistik":"Logistics service fee","Komisi Afiliasi":"Affiliate Commission","Komisi mitra afiliasi":"Affiliate partner commission","Komisi Iklan Toko afiliasi":"Affiliate Shop Ads commission","Deposit komisi afiliasi":"Affiliate commission deposit","Pengembalian dana komisi afiliasi":"Affiliate commission refund","Komisi iklan toko Mitra Afiliasi":"Affiliate Partner shop ads commission","Biaya layanan Program Bebas Ongkir":"Shipping Fee Program service fee","Komisi dinamis":"Dynamic commission","Biaya layanan Program Growth Xtra":"Growth Xtra Program service fee","Biaya layanan Khusus LIVE":"LIVE Specials service fee","Biaya layanan Growth Xtra Program Super":"Growth Xtra Program Super service fee","Biaya pemrosesan pesanan":"Order processing fee","Biaya layanan Program EAMS":"EAMS Program service fee","Biaya layanan Brands Crazy Deal/Flash Sale":"Brands Crazy Deals/Flash Sale service fee","Biaya Dilayani Tokopedia":"Dilayani Tokopedia fee","Biaya penanganan Dilayani Tokopedia":"Dilayani Tokopedia handling fee","Biaya program PayLater":"PayLater program fee","Biaya sumber daya campaign":"Campaign resource fee","Biaya layanan penginstalan":"Installation service fee","PPh Pasal 22 dipungut":"Article 22 Income Tax withheld","Biaya layanan khusus platform":"Platform special service fee","Biaya iklan GMV Max":"GMV Max ad fee","Voucher GMV Max":"GMV Max coupon","Pajak penjualan atas voucher GMV Max":"GMV Max coupon sales tax","Program layanan terkelola (Pajak penjualan)":"Managed service plan (Sales tax)","Program layanan terkelola (Biaya per pesanan)":"Managed service plan (Per order fee)","Ongkir pesanan gagal kirim":"Failed delivery shipping fee","Ongkir pengembalian barang karena kesalahan pembeli":"Buyer-fault return shipping fee","Jumlah penyesuaian":"Adjustment amount","ID pesanan terkait":"Related order ID","Pembayaran oleh pembeli":"Customer payment","Pengembalian dana pembeli":"Customer refund","Diskon voucher yang ditanggung penjual":"Seller co-funded voucher discount","Pengembalian dana diskon voucher yang ditanggung penjual":"Seller co-funded voucher discount refund","Diskon platform":"Platform discount","Pengembalian dana diskon platform":"Platform discount refund","Diskon voucher yang ditanggung platform":"Platform co-funded voucher discount","Pengembalian dana diskon voucher yang ditanggung platform":"Platform co-funded voucher discount refund","Diskon ongkir dari penjual":"Seller shipping cost discount","Perkiraan berat paket":"Estimated package weight","Berat paket yang bisa dikenai biaya":"Chargeable package weight","Detail produk terjual":"Details of items sold","Sumber pesanan":"Order source"};
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
          key: `tiktok:${orderId}:${text(r['SKU ID']) || text(r['Seller SKU'])}`, channel: /tokopedia/i.test(text(r['Purchase Channel'])) ? 'tokopedia' : 'tiktok', orderId,
          status: text(r['Order Status']), state: stateOf(r['Order Status'], ret, qty, r['Cancelation/Return Type']),
          date: toDate(r['Created Time']), sku: text(r['Seller SKU']) || text(r['SKU ID']), productName: text(r['Product Name']),
          variation: text(r.Variation), size: sizeOf(r.Variation), qty, returnedQty: ret,
          unitPrice: toNum(r['SKU Unit Original Price']), gross: toNum(r['SKU Subtotal Before Discount']),
          platformDiscount: toNum(r['SKU Platform Discount']), sellerDiscount: toNum(r['SKU Seller Discount']),
          // omzet = after the seller's own discount; the platform discount is funded by TikTok/Tokopedia and paid to us
          net: toNum(r['SKU Subtotal After Discount']) + toNum(r['SKU Platform Discount']), buyerPaid: toNum(r['Order Amount']),
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
      match: (h) => h.includes('ID Pesanan/Penyesuaian') || (h.some((x) => x.toLowerCase() === 'order/adjustment id') && h.includes('Total settlement amount')),
      map: (row) => {
        // Indonesian-language export: same columns in the same order, renamed; read it as the English one
        const r = { ...row };
        Object.entries(TIKTOK_ID_EN).forEach(([id, en]) => { if (row[id] !== undefined && r[en] === undefined) r[en] = row[id]; });
        const g = (...ks) => { for (const k of ks) if (r[k] !== undefined && r[k] !== '') return r[k]; return ''; };
        const idv = text(g('Order/Adjustment ID', 'Order/adjustment ID', 'ID Pesanan/Penyesuaian'));
        if (!/^\d{6,}$/.test(idv)) return null;
        const type = text(g('Transaction type', 'Type', 'Jenis transaksi'));
        const payout = toNum(g('Total settlement amount', 'Jumlah penyelesaian pembayaran', 'Total Pendapatan'));
        const base = { key: `tiktok:${idv}:${type}`, channel: /tokopedia/i.test(text(g('Order source', 'Sumber pesanan'))) ? 'tokopedia' : 'tiktok', releaseDate: toDate(g('Order settled time', 'Waktu penyelesaian', 'Waktu pembayaran pesanan')), payout };
        // ads paid from the balance, marketing packages, reimbursements ...
        if (!/^(order|pesanan)$/i.test(type)) return { ...base, orderId: text(g('Related order ID', 'ID pesanan terkait')) || idv, type: 'Penyesuaian', date: base.releaseDate, fees: 0, detail: { [type]: payout } };
        const detail = {};
        TIKTOK_DETAIL.forEach((k) => { const v = toNum(r[k]); if (v) detail[k] = v; });
        const sumG = (pred) => Object.entries(detail).reduce((t, [k, v]) => (pred(feeGroup(k)) ? t + v : t), 0);
        const fees = sumG((x) => !NOT_FEES.includes(x));
        const admin = toNum(r['Platform commission fee']);
        const aff = sumG((x) => x === 'Biaya promosi');
        return {
          ...base, orderId: idv, type: 'Order', date: toDate(g('Order created time', 'Waktu pemesanan')),
          productPrice: toNum(g('Subtotal after seller discounts', 'Subtotal setelah diskon penjual')), fees, adminFee: admin, serviceFee: fees - admin - aff, affiliateFee: aff,
          shipping: sumG((x) => x === 'Biaya pengiriman'), refund: toNum(g('Refund amount after discount', 'Total pengembalian dana setelah diskon')),
          sellerDiscount: 0, detail, items: [], buyerPaid: toNum(r['Customer payment']),
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
        rows.filter((x) => x.sku).forEach((x) => { const o = byOrder.get(x.orderId); if (o) { o.items.push({ name: x.name, productId: x.productId, price: x.price }); o.raw.push(...x.raw); } });
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
        if (!rec || rec.date === undefined) return;
        // the original row, for the detail popup
        rec.raw = [Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : v]).filter(([, v]) => text(v) !== ''))];
        out.push(rec);
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
        const ws = wb.Sheets[sn];
        // TikTok exports declare a too-small range (!ref); widen it to every cell that exists
        if (ws['!ref']) { const r = XLSX.utils.decode_range(ws['!ref']); Object.keys(ws).forEach((k) => { if (k[0] !== '!') { const c = XLSX.utils.decode_cell(k); r.e.r = Math.max(r.e.r, c.r); r.e.c = Math.max(r.e.c, c.c); } }); ws['!ref'] = XLSX.utils.encode_range(r); }
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
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
