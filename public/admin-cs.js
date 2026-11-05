// BALLOP admin: customer service. Daily report per marketplace (chat analytics, checklist, notes
// performance + the daily SOP checklist) and the Shopee shop flash sale submitted every day.
(() => {
  const { $, $$, api, json, toast } = window.A;
  const B = window.Biz;
  const { esc, num, money, pct, today, fmtDate } = B;

  // shopee = official brand store, shopeeglobal = Shopee Global (cross-border) store; flash sale only on the official store
  const CH = { shopee: { label: 'Shopee Official', short: 'S', color: '#eb6834' }, shopeeglobal: { label: 'Shopee Global', short: 'G', color: '#b23c17' }, tiktok: { label: 'TikTok Shop', short: 'T', color: '#2a78d6' } };
  const CHS = Object.keys(CH);
  const isShopee = (k) => k !== 'tiktok';
  const chTag = (k) => `<span class="ch"><i style="background:${CH[k]?.color || '#888'}"></i>${esc(CH[k]?.label || k)}</span>`;
  // daily SOP; flash sale only exists on Shopee
  const TASKS = {
    shopee: [['chat', 'Balas semua chat masuk (jaga response rate)'], ['orders', 'Cek pesanan perlu dikirim & yang terlambat'], ['flash', 'Submit Flash Sale toko untuk besok']],
    tiktok: [['chat', 'Balas semua chat masuk (jaga response rate)'], ['orders', 'Cek pesanan perlu dikirim & yang terlambat']],
  };
  // copied by hand from Shopee Seller Centre > Data > Layanan > Chat, and Tokopedia/TikTok Seller > Analitik layanan > Ringkasan
  // kind: n = count, p = percent, rp = rupiah, t = duration (typed 00:15:48 or minutes, stored as minutes)
  const STATS = {
    shopee: [
      ['Kunjungan & pertanyaan', [['visitors', 'Total pengunjung', 'n'], ['chats', 'Jumlah chat', 'n'], ['askers', 'Pengunjung bertanya', 'n'], ['askRate', 'Pertanyaan diajukan', 'p']]],
      ['Tanggapan chat', [['replied', 'Chat dibalas', 'n'], ['unreplied', 'Chat belum dibalas', 'n'], ['responseTime', 'Waktu respon rata-rata', 't'], ['csat', 'CSAT', 'p'], ['respConv', 'Tingkat konversi (chat yang direspon)', 'p']]],
      ['Pesanan dibuat dari chat', [['buyers', 'Total pembeli', 'n'], ['orders', 'Pesanan', 'n'], ['products', 'Produk', 'n'], ['sales', 'Penjualan', 'rp'], ['chatConv', 'Tingkat konversi (chat dibalas)', 'p']]],
    ],
    tiktok: [
      ['Aktivitas', [['sessions', 'Sesi hari ini', 'n'], ['agentsOnline', 'Agen online', 'n'], ['agentsActive', 'Agen aktif', 'n']]],
      ['Volume chat', [['chats', 'Jumlah chat', 'n'], ['chatAI', 'Chat AI saja', 'n'], ['chatAgent', 'Chat agen saja', 'n'], ['chatAIAgent', 'Chat AI ke agen', 'n']]],
      ['Performa layanan', [['csat', 'Tingkat kepuasan', 'p'], ['resp12h', 'Persentase respons dalam 12 jam', 'p'], ['responseTime', 'Waktu respons rata-rata', 't']]],
      ['Konversi penjualan', [['sales', 'Pendapatan setelah merespons', 'rp'], ['orders', 'Pesanan setelah merespons', 'n'], ['chatConv', 'Konversi penjualan', 'p']]],
      ['Risiko chat', [['riskSessions', 'Risiko chat (sesi)', 'n'], ['riskAgents', 'Agen yang terpengaruh', 'n'], ['riskPct', 'Persentase risiko', 'p']]],
    ],
  };
  TASKS.shopeeglobal = TASKS.shopee.filter(([k]) => k !== 'flash');
  STATS.shopeeglobal = STATS.shopee;
  const statKeys = (k) => STATS[k].flatMap(([, list]) => list);
  // Shopee > Promosi > Flash Sale Toko Saya > Kriteria Utama (periode Kemarin / per hari); saved on the Shopee record
  const FS_PERF = [['fsSales', 'Penjualan', 'rp'], ['fsOrders', 'Pesanan', 'n'], ['fsBuyers', 'Total pembeli', 'n'], ['fsClick', 'Persentase klik', 'p'], ['fsViews', 'Jumlah produk dilihat', 'n']];
  // "00:15:48" / "15:48" / "45.7" -> minutes
  const toMin = (v) => { const x = String(v ?? '').trim(); if (!x) return 0; if (x.includes(':')) { const p = x.split(':').map(Number); return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p[0] + p[1] / 60; } return Number(x.replace(',', '.')) || 0; };
  const fmtMin = (m) => { if (!m) return '–'; const t = Math.round(m * 60); const h = Math.floor(t / 3600), mi = Math.floor((t % 3600) / 60), se = t % 60; return h ? `${h}j ${mi}m` : `${mi}m ${String(se).padStart(2, '0')}d`; };
  const statVal = (kind, v) => (kind === 'p' ? (v || v === 0 ? `${Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%` : '–') : kind === 'rp' ? money(v || 0) : kind === 't' ? fmtMin(v) : num(v || 0));
  // response rate kept on the record for the monthly cards: Shopee = replied / chats, TikTok = respons ≤ 12 jam
  const syncRate = (k, r) => { r.responseRate = isShopee(k) ? (r.chats ? Math.round(((r.replied || 0) / r.chats) * 1000) / 10 : 0) : (r.resp12h || 0); };
  const FIELDS = []; // operational counts (komplain, retur, ulasan …) are no longer reported
  const FS_STATUS = { diajukan: 'Diajukan', disetujui: 'Disetujui', ditolak: 'Ditolak', live: 'Live', selesai: 'Selesai' };
  const FS_BADGE = { diajukan: '', disetujui: 'live', ditolak: 'bad', live: 'live', selesai: 'warn' };
  const SESSIONS = ['00:00–09:00', '09:00–12:00', '12:00–15:00', '15:00–18:00', '18:00–21:00', '21:00–24:00'];
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const longDay = (d) => { const [y, m, n] = d.split('-').map(Number); return `${n} ${MONTHS[m - 1]} ${y}`; };
  const st = { month: today().slice(0, 7) };
  const sst = { ch: 'all', range: 'mtd', from: '', to: '', limit: 150 };
  const canEdit = () => window.A.can('cs') && !window.A.me?.readOnly;
  const who = () => window.A.me?.user?.name || window.A.me?.user?.username || 'admin';
  const stamp = () => { const d = new Date(); return `${today()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const rep = (d, ch) => B.data.csdaily.find((r) => r.date === d && r.channel === ch);
  const fsOf = (d) => B.data.flashsale.filter((x) => x.date === d);

  function monthStats(rows, fs) {
    const t = { days: new Set(rows.map((r) => r.date)).size, chats: 0, replied: 0, rr: [], complaints: 0, complaintsDone: 0, returns: 0, returnsDone: 0, reviews: 0, badReviews: 0, fsDays: new Set(fs.map((x) => x.date)).size, fsItems: fs.length, fsOk: fs.filter((x) => ['disetujui', 'live', 'selesai'].includes(x.status)).length, fsSold: fs.reduce((s, x) => s + x.sold, 0) };
    t.orders = 0; t.sales = 0;
    rows.forEach((r) => { ['chats', 'replied', 'orders', 'sales'].forEach((k) => { t[k] += Number(r[k]) || 0; }); if (r.responseRate) t.rr.push(r.responseRate); });
    t.rate = t.rr.length ? t.rr.reduce((a, b) => a + b, 0) / t.rr.length : NaN;
    return t;
  }

  const fmtClock = (m) => { const t = Math.round(m * 60); return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((x) => String(x).padStart(2, '0')).join(':'); };
  // totals of daily records (one channel or both): sums, and chat-weighted averages for time / satisfaction
  function chatTotals(rows) {
    const t = { days: new Set(rows.map((r) => r.date)).size, reports: rows.length, visitors: 0, chats: 0, replied: 0, unreplied: 0, orders: 0, buyers: 0, sales: 0, riskSessions: 0, fsSales: 0, fsOrders: 0, fsBuyers: 0, fsViews: 0, chatAI: 0, chatAgent: 0, chatAIAgent: 0, complaints: 0, complaintsDone: 0, returns: 0, returnsDone: 0, badReviews: 0, reviews: 0 };
    let tw = 0, tt = 0, cw = 0, cs = 0, rw = 0, rr = 0;
    rows.forEach((r) => {
      Object.keys(t).forEach((k) => { if (k !== 'days' && k !== 'reports') t[k] += Number(r[k]) || 0; });
      const w = r.chats || 1;
      if (r.responseTime) { tw += w; tt += r.responseTime * w; }
      if (r.csat) { cw += w; cs += r.csat * w; }
      if (r.responseRate) { rw += w; rr += r.responseRate * w; }
    });
    t.responseTime = tw ? tt / tw : 0; t.csat = cw ? cs / cw : NaN; t.rate = rw ? rr / rw : NaN;
    t.conv = t.chats ? t.orders / t.chats : NaN;
    return t;
  }
  const chRows = (ch, from, to) => B.data.csdaily.filter((r) => r.date >= from && r.date <= to && (ch === 'all' ? CHS.includes(r.channel) : r.channel === ch));
  const pctTxt = (v) => (Number.isFinite(v) ? `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–');

  function summaryPanel() {
    const r = B.periodOf(sst);
    const t = chatTotals(chRows(sst.ch, r.from, r.to));
    const days = [...new Set(chRows(sst.ch, r.from, r.to).map((x) => x.date))].sort().reverse();
    const card = (l, v, sub = '', hero) => `<div class="st-card${hero ? ' hero' : ''}"><span>${l}</span><b>${v}</b><small>${sub}</small></div>`;
    return `
      <section class="panel solid cs-sum">
        <div class="panel-head"><h2>Ringkasan analitik chat</h2>
          <span class="dh-actions"><span class="seg glass">${[['all', 'Gabungan'], ...CHS.map((k) => [k, CH[k].label])].map(([k, l]) => `<button type="button" data-sch="${k}" class="${sst.ch === k ? 'on' : ''}">${l}</button>`).join('')}</span>
          <button class="btn sm btn-export" type="button" id="csPdfPeriod">⬇ Export PDF</button></span></div>
        ${B.rangeBar(sst)}
        <div class="st-cards" style="margin-top:12px">
          ${card('Jumlah chat', num(t.chats), `${num(t.days)} hari dilaporkan`, true)}
          ${card('Chat dibalas', pctTxt(t.rate), `${num(t.replied)} dibalas · ${num(t.unreplied)} belum`)}
          ${card('Waktu respon rata-rata', fmtMin(t.responseTime), 'tertimbang jumlah chat')}
          ${card('Kepuasan / CSAT', pctTxt(t.csat), 'rata-rata tertimbang')}
          ${card('Pesanan dari chat', num(t.orders), `konversi ${Number.isFinite(t.conv) ? pct(t.conv) : '–'}`)}
          ${card('Penjualan dari chat', money(t.sales), `${num(t.buyers)} pembeli`)}
          ${sst.ch !== 'tiktok' ? card('⚡ Penjualan flash sale', money(t.fsSales), `${num(t.fsOrders)} pesanan · ${num(t.fsViews)} produk dilihat`) : ''}
        </div>
        <div class="table-wrap" style="margin-top:12px"><table class="data">
          <thead><tr><th>Tanggal</th><th>Channel</th><th class="num">Pengunjung</th><th class="num">Chat</th><th class="num">Dibalas</th><th class="num">Waktu respon</th><th class="num">CSAT</th><th class="num">Pesanan</th><th class="num">Penjualan</th><th class="num">Konversi</th><th></th></tr></thead>
          <tbody>${days.flatMap((d) => CHS.filter((k) => sst.ch === 'all' || sst.ch === k).map((k) => rep(d, k)).filter(Boolean)).map((x) => `<tr data-csday="${x.date}" style="cursor:pointer"><td>${fmtDate(x.date)}</td><td>${chTag(x.channel)}</td><td class="num">${x.visitors ? num(x.visitors) : '–'}</td><td class="num">${num(x.chats)}</td><td class="num">${pctTxt(x.responseRate)}</td><td class="num">${fmtMin(x.responseTime)}</td><td class="num">${x.csat ? pctTxt(x.csat) : '–'}</td><td class="num">${num(x.orders)}</td><td class="num">${money(x.sales || 0)}</td><td class="num">${x.chatConv ? pctTxt(x.chatConv) : '–'}</td><td><button class="btn sm" type="button" data-cspdf="${x.date}">PDF</button></td></tr>`).join('') || '<tr><td colspan="11" class="muted" style="text-align:center;padding:24px">Belum ada laporan di periode ini.</td></tr>'}</tbody>
        </table></div>
      </section>`;
  }

  // ---------- PDF ----------
  const P = () => window.PdfReport;
  function chBlock(k, r) {
    const { tile, tiles, h2, table } = P();
    if (!r) return `${h2(CH[k].label)}<div class="box muted">Belum ada laporan ${CH[k].label} untuk tanggal ini.</div>`;
    const groups = STATS[k].map(([g, list]) => [g, list.filter(([fk]) => r[fk] || r[fk] === 0)]).filter(([, l]) => l.length);
    const done = (r.tasks || []).length, all = TASKS[k].length;
    return `
      ${h2(`${P().dot(CH[k].color)}${CH[k].label}`, `jobdesk ${done}/${all} · ${r.updatedBy ? `diisi ${esc(r.updatedBy)}` : ''}`)}
      ${tiles([
        tile('Jumlah chat', num(r.chats), isShopee(k) ? `${num(r.visitors)} pengunjung` : `AI ${num(r.chatAI)} · agen ${num(r.chatAgent)} · AI→agen ${num(r.chatAIAgent)}`, true),
        tile(isShopee(k) ? 'Chat dibalas' : 'Respons ≤ 12 jam', pctTxt(r.responseRate), isShopee(k) ? `${num(r.replied)} dibalas · ${num(r.unreplied)} belum` : ''),
        tile('Waktu respon rata-rata', fmtMin(r.responseTime)),
        tile(isShopee(k) ? 'CSAT' : 'Tingkat kepuasan', r.csat || r.csat === 0 ? pctTxt(r.csat) : '–'),
        tile('Pesanan dari chat', num(r.orders), `konversi ${r.chatConv ? pctTxt(r.chatConv) : '–'}`),
        tile('Penjualan dari chat', money(r.sales || 0), isShopee(k) ? `${num(r.buyers)} pembeli · ${num(r.products)} produk` : ''),
        tile(isShopee(k) ? 'Konversi chat dibalas' : 'Konversi penjualan', r.chatConv ? pctTxt(r.chatConv) : '–', ''),
        tile(isShopee(k) ? 'Pengunjung bertanya' : 'Risiko chat', isShopee(k) ? num(r.askers) : `${num(r.riskSessions)} sesi`, isShopee(k) ? `pertanyaan diajukan ${r.askRate ? pctTxt(r.askRate) : '–'}` : `${r.riskPct ? pctTxt(r.riskPct) : '0%'} dari chat`),
      ])}
      <div class="two" style="margin-top:8px">
        <div>${table([['Metrik'], ['Nilai', 1]], groups.flatMap(([g, l]) => [[`<b>${esc(g)}</b>`, ''], ...l.map(([fk, lab, kind]) => [`<span class="muted">${esc(lab)}</span>`, statVal(kind, r[fk])])]), null, 'Data analitik belum diisi.')}</div>
        <div><div class="box"><p><b>Jobdesk</b></p>${TASKS[k].map(([tk, l]) => `<p>${(r.tasks || []).includes(tk) ? '<span class="chip ok">✓</span>' : '<span class="chip">–</span>'} ${esc(l)}</p>`).join('')}</div>
          ${r.note ? `<div class="box" style="margin-top:8px"><p><b>Catatan</b></p><p>${esc(r.note)}</p></div>` : ''}</div>
      </div>`;
  }
  function dayPdf(d, draft) {
    const R = P();
    const recs = Object.fromEntries(CHS.map((k) => [k, draft ? (draft[k].date || Object.keys(draft[k]).length > 1 ? draft[k] : null) : rep(d, k)]));
    Object.entries(recs).forEach(([k, r]) => { if (r) syncRate(k, r); });
    const a = recs.shopee;
    const t = chatTotals(Object.values(recs).filter(Boolean));
    const fsl = (draft ? draft.fs : fsOf(d)).filter((x) => (x.product || '').trim());
    const body = `
      ${R.h2('Gabungan Shopee Official + Shopee Global + TikTok Shop', 'rata-rata waktu respon & kepuasan ditimbang jumlah chat')}
      ${R.tiles([
        R.tile('Total chat', num(t.chats), `${num(t.reports)} channel dilaporkan`, true),
        R.tile('Chat dibalas', pctTxt(t.rate)),
        R.tile('Waktu respon rata-rata', fmtMin(t.responseTime)),
        R.tile('Kepuasan / CSAT', pctTxt(t.csat)),
        R.tile('Pesanan dari chat', num(t.orders), `konversi ${Number.isFinite(t.conv) ? pct(t.conv) : '–'}`),
        R.tile('Penjualan dari chat', money(t.sales)),
      ], 6)}
      ${CHS.map((k) => chBlock(k, recs[k])).join('')}
      ${a && FS_PERF.some(([k]) => a[k]) ? `${R.h2('⚡ Performa flash sale Shopee', 'Promosi › Flash Sale Toko Saya')}${R.tiles([
        R.tile('Penjualan', money(a.fsSales || 0), '', true), R.tile('Pesanan', num(a.fsOrders)), R.tile('Total pembeli', num(a.fsBuyers)),
        R.tile('Penjualan / pembeli', a.fsBuyers ? money((a.fsSales || 0) / a.fsBuyers) : '–'), R.tile('Persentase klik', pctTxt(a.fsClick)), R.tile('Produk dilihat', num(a.fsViews)),
      ], 6)}` : ''}
      ${fsl.length ? `${R.h2('⚡ Produk flash sale Shopee', `${num(fsl.length)} produk`)}${R.table([['Sesi'], ['Produk'], ['Harga normal', 1], ['Harga FS', 1], ['Stok', 1], ['Terjual', 1], ['Status']], fsl.map((x) => [esc(x.session), `${esc(x.product)} <span class="muted">${esc(x.variant || '')}</span>`, money(x.normalPrice), `<b>${money(x.price)}</b>`, num(x.stock), num(x.sold), FS_STATUS[x.status || 'diajukan']]))}` : ''}`;
    R.open({ title: 'Daily Report Customer Service', period: longDay(d), onePage: true,
      meta: [['Tanggal', longDay(d)], ['Channel', 'Shopee Official · Shopee Global · TikTok Shop / Tokopedia'], ['Disusun oleh', esc(Object.values(recs).find((x) => x?.updatedBy)?.updatedBy || who())]],
      body, sign: ['Customer Service', 'Mengetahui'], note: 'Angka analitik disalin dari Shopee Seller Centre (Layanan › Chat) dan Seller Center TikTok/Tokopedia (Analitik layanan). Waktu: GMT+7.' });
  }
  function periodPdf() {
    const R = P();
    const r = B.periodOf(sst);
    const chs = sst.ch === 'all' ? CHS : [sst.ch];
    const per = chs.map((k) => [k, chatTotals(chRows(k, r.from, r.to))]);
    const all = chatTotals(chRows(sst.ch, r.from, r.to));
    const days = [...new Set(chRows(sst.ch, r.from, r.to).map((x) => x.date))].sort();
    const body = `
      ${R.h2(sst.ch === 'all' ? 'Gabungan semua channel' : CH[sst.ch].label)}
      ${R.tiles([
        R.tile('Jumlah chat', num(all.chats), `${num(all.days)} hari dilaporkan`, true),
        R.tile('Chat dibalas', pctTxt(all.rate), `${num(all.unreplied)} belum dibalas`),
        R.tile('Waktu respon rata-rata', fmtMin(all.responseTime)),
        R.tile('Kepuasan / CSAT', pctTxt(all.csat)),
        R.tile('Pesanan dari chat', num(all.orders), `konversi ${Number.isFinite(all.conv) ? pct(all.conv) : '–'}`),
        R.tile('Penjualan dari chat', money(all.sales)),
      ], 3)}
      ${sst.ch !== 'tiktok' && all.fsSales ? R.tiles([R.tile('⚡ Penjualan flash sale', money(all.fsSales), '', true), R.tile('Pesanan flash sale', num(all.fsOrders)), R.tile('Pembeli flash sale', num(all.fsBuyers)), R.tile('Produk dilihat', num(all.fsViews))]) : ''}
      ${chs.length > 1 ? `${R.h2('Per channel')}${R.table([['Channel'], ['Hari', 1], ['Chat', 1], ['Dibalas', 1], ['Waktu respon', 1], ['CSAT', 1], ['Pesanan', 1], ['Penjualan', 1], ['Konversi', 1]],
        per.map(([k, x]) => [`${R.dot(CH[k].color)}${CH[k].label}`, num(x.days), num(x.chats), pctTxt(x.rate), fmtMin(x.responseTime), pctTxt(x.csat), num(x.orders), money(x.sales), Number.isFinite(x.conv) ? pct(x.conv) : '–']),
        ['Total', num(all.days), num(all.chats), pctTxt(all.rate), fmtMin(all.responseTime), pctTxt(all.csat), num(all.orders), money(all.sales), Number.isFinite(all.conv) ? pct(all.conv) : '–'])}` : ''}
      ${R.h2('Harian')}
      ${R.table([['Tanggal'], ['Channel'], ['Pengunjung', 1], ['Chat', 1], ['Dibalas', 1], ['Waktu respon', 1], ['CSAT', 1], ['Pesanan', 1], ['Penjualan', 1], ['Konversi', 1]],
        days.flatMap((d) => chs.map((k) => rep(d, k)).filter(Boolean)).map((x) => [fmtDate(x.date), CH[x.channel].label, x.visitors ? num(x.visitors) : '–', num(x.chats), pctTxt(x.responseRate), fmtMin(x.responseTime), x.csat ? pctTxt(x.csat) : '–', num(x.orders), money(x.sales || 0), x.chatConv ? pctTxt(x.chatConv) : '–']), null, 'Belum ada laporan di periode ini.')}`;
    R.open({ title: 'Laporan Customer Service', period: R.period(r.from, r.to), onePage: days.length <= 14,
      meta: [['Periode', R.period(r.from, r.to)], ['Channel', sst.ch === 'all' ? 'Gabungan semua channel' : CH[sst.ch].label]],
      body, sign: ['Customer Service', 'Mengetahui'], note: 'Rata-rata waktu respon & kepuasan ditimbang jumlah chat per hari. Sumber: input harian CS dari Seller Centre.' });
  }

  function render() {
    const v = $('#view-cs');
    const [y, m] = st.month.split('-').map(Number);
    const len = new Date(y, m, 0).getDate(), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, t = today();
    const inM = (r) => r.date.startsWith(st.month);
    const rows = B.data.csdaily.filter(inM), fs = B.data.flashsale.filter(inM);
    const s = monthStats(rows, fs);
    const past = Math.min(len, t.slice(0, 7) === st.month ? Number(t.slice(8)) : t > st.month ? len : 0);
    const cells = [...Array(lead)].map(() => '<div class="dc empty"></div>');
    for (let n = 1; n <= len; n++) {
      const d = `${st.month}-${String(n).padStart(2, '0')}`, future = d > t;
      const f = fsOf(d);
      const has = CHS.map((k) => !!rep(d, k));
      const done = [...has, f.length].filter(Boolean).length;
      cells.push(`<button type="button" class="dc ${future ? 'future' : done === CHS.length + 1 ? 'done' : done ? 'part' : 'todo'}${d === t ? ' today' : ''}" data-csday="${d}" ${future ? 'disabled' : ''}>
        <span class="dc-n">${n}</span>${future ? '' : `<span class="cs-pills">${CHS.map((k, i) => `<i class="${has[i] ? 'on' : ''}" style="--c:${CH[k].color}">${CH[k].short}</i>`).join('')}<i class="${f.length ? 'on' : ''}" style="--c:#e8a200">⚡${f.length || ''}</i></span>`}</button>`);
    }
    const chCard = (k, x) => `<div class="cs-ch" style="--c:${CH[k].color}"><b>${CH[k].label}</b>
      <span>Chat <strong>${num(x.chats)}</strong></span><span>Response rate <strong>${Number.isFinite(x.rate) ? `${x.rate.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–'}</strong></span>
      <span>Pesanan dari chat <strong>${num(x.orders)}</strong></span><span>Penjualan dari chat <strong>${money(x.sales)}</strong></span></div>`;

    v.innerHTML = `
      <header class="bar"><div><h1>Customer service</h1><p class="muted">Daily report CS Shopee Official, Shopee Global & TikTok Shop, dan submit Flash Sale Shopee Official setiap hari. Klik tanggal di kalender untuk isi atau lihat laporan.</p></div>
        <div class="bar-actions"><button class="btn sm btn-export" type="button" data-cspdf="${t}">⬇ PDF hari ini</button>${canEdit() ? `<button class="btn sm primary" type="button" data-csday="${t}">+ Laporan hari ini</button>` : ''}</div></header>
      <div class="st-cards">
        <div class="st-card hero"><span>Laporan ${MONTHS[m - 1]}</span><b>${num(s.days)}/${num(past)}</b><small>hari sudah diisi</small></div>
        <div class="st-card"><span>Chat masuk</span><b>${num(s.chats)}</b><small>${s.chats ? pct(s.replied / s.chats) : '–'} dibalas</small></div>
        <div class="st-card"><span>Response rate rata-rata</span><b>${Number.isFinite(s.rate) ? `${s.rate.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–'}</b><small>dari laporan harian</small></div>
        <div class="st-card"><span>Penjualan dari chat</span><b>${money(s.sales)}</b><small>${num(s.orders)} pesanan</small></div>
        <div class="st-card warn"><span>Flash sale</span><b>${num(s.fsDays)} hari</b><small>${num(s.fsItems)} produk · ${num(s.fsOk)} disetujui</small></div>
        <div class="st-card"><span>Terjual di flash sale</span><b>${num(s.fsSold)}</b><small>pcs</small></div>
      </div>
      <div class="cs-chs">${CHS.map((k) => chCard(k, monthStats(rows.filter((r) => r.channel === k), []))).join('')}</div>
      ${summaryPanel()}
      <section class="panel solid d-cal">
        <div class="panel-head"><h2>Kalender laporan · ${MONTHS[m - 1]} ${y}</h2>
          <span class="cal-nav"><button class="btn sm" type="button" data-csm="-1" aria-label="Bulan sebelumnya">‹</button><button class="btn sm" type="button" data-csm="0">Bulan ini</button><button class="btn sm" type="button" data-csm="1" aria-label="Bulan berikutnya">›</button></span></div>
        <div class="dc-grid dc-head">${['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'].map((h) => `<span>${h}</span>`).join('')}</div>
        <div class="dc-grid">${cells.join('')}</div>
        <div class="dc-legend"><span><i class="done"></i>Lengkap (semua channel + flash sale)</span><span><i class="part"></i>Sebagian</span><span><i class="todo"></i>Belum ada</span><span class="muted">S = Shopee Official · G = Shopee Global · T = TikTok · ⚡ = produk flash sale</span></div>
      </section>
      <div class="grid-3">
        <section class="panel solid"><div class="panel-head"><h2>Flash sale ${MONTHS[m - 1]}</h2><span class="muted small">${num(fs.length)} produk</span></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Tanggal</th><th>Sesi</th><th>Produk</th><th class="num">Harga normal</th><th class="num">Harga FS</th><th class="num">Diskon</th><th class="num">Stok</th><th class="num">Terjual</th><th>Status</th></tr></thead>
          <tbody>${fs.sort((a, b) => b.date.localeCompare(a.date) || a.session.localeCompare(b.session)).map((x) => `<tr data-csday="${x.date}" style="cursor:pointer"><td>${fmtDate(x.date)}</td><td>${esc(x.session)}</td><td>${esc(x.product)}${x.variant ? ` <span class="muted">${esc(x.variant)}</span>` : ''}</td><td class="num">${money(x.normalPrice)}</td><td class="num"><b>${money(x.price)}</b></td><td class="num">${x.normalPrice ? pct(1 - x.price / x.normalPrice) : '–'}</td><td class="num">${num(x.stock)}</td><td class="num">${num(x.sold)}</td><td><span class="badge ${FS_BADGE[x.status]}">${FS_STATUS[x.status]}</span></td></tr>`).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">Belum ada flash sale bulan ini.</td></tr>'}</tbody></table></div>
        </section>
        <section class="panel solid"><div class="panel-head"><h2>Jobdesk harian CS</h2></div>
          <ol class="cs-sop">${TASKS.shopee.map(([, l]) => `<li>${esc(l)}</li>`).join('')}</ol>
          <p class="muted small">TikTok Shop sama, tanpa flash sale; cek Shop Performance Score. Target umum: semua chat dibalas di jam kerja, komplain & retur tidak menggantung lebih dari 1×24 jam.</p>
        </section>
      </div>`;
    $$('[data-csm]', v).forEach((b) => b.addEventListener('click', () => {
      const n = Number(b.dataset.csm);
      if (!n) st.month = today().slice(0, 7); else { const d = new Date(y, m - 1 + n, 1); st.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
      render();
    }));
    $$('[data-csday]', v).forEach((b) => b.addEventListener('click', () => dayPopup(b.dataset.csday)));
    $$('[data-cspdf]', v).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); dayPdf(b.dataset.cspdf); }));
    $$('[data-sch]', v).forEach((b) => b.addEventListener('click', () => { sst.ch = b.dataset.sch; render(); }));
    B.bindRangeBar(v.querySelector('.cs-sum'), sst, render);
    $('#csPdfPeriod').addEventListener('click', periodPdf);
  }

  // one popup per date: Shopee / TikTok report + flash sale list, all saved together
  function dayPopup(d) {
    const draft = { ...Object.fromEntries(CHS.map((k) => [k, { ...(rep(d, k) || { tasks: [] }) }])), fs: fsOf(d).map((x) => ({ ...x })) };
    const had = Object.fromEntries(CHS.map((k) => [k, !!rep(d, k)]));
    let dirty = false;
    const names = [...new Set(B.data.stock3pl.map((r) => r.product).filter(Boolean))].sort();
    const dirtyCh = Object.fromEntries(CHS.map((k) => [k, false]));
    const box = document.createElement('div');
    box.className = 'raw-pop';
    box.innerHTML = `<div class="raw-card cs-pop">
      <header><div><span class="muted small">Daily report customer service</span><h2>${longDay(d)}</h2></div><div class="cs-state" id="csState"></div><button class="btn sm" type="button" data-close>✕</button></header>
      <div class="raw-body" id="csBody"></div>
      <footer><button class="btn sm" type="button" id="csCopy">⧉ Copy teks report</button><button class="btn sm btn-export" type="button" id="csPdfDay">⬇ PDF report hari ini</button><span class="spacer"></span><button class="btn sm" type="button" data-close>Tutup</button>${canEdit() ? '<button class="btn sm primary" type="button" id="csSave">Simpan</button>' : ''}</footer>
    </div><datalist id="csProducts">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist><datalist id="csSessions">${SESSIONS.map((n) => `<option value="${n}">`).join('')}</datalist>`;
    document.body.appendChild(box);
    const dis = canEdit() ? '' : 'disabled';

    // one form: a row per number, a column per channel; Tab walks down a column (one seller centre at a time)
    const SECTIONS = [
      ['Chat masuk', ['visitors', 'sessions', 'chats', 'askers', 'askRate', 'chatAI', 'chatAgent', 'chatAIAgent']],
      ['Respon chat', ['replied', 'unreplied', 'resp12h', 'responseTime', 'csat', 'respConv']],
      ['Penjualan dari chat', ['buyers', 'orders', 'products', 'sales', 'chatConv']],
      ['Agen & risiko (TikTok)', ['agentsOnline', 'agentsActive', 'riskSessions', 'riskAgents', 'riskPct']],
    ];
    const statDef = (key) => { const hit = CHS.map((k) => statKeys(k).find(([fk]) => fk === key)).filter(Boolean); if (!hit.length) return null; const labels = [...new Set(hit.map((x) => x[1]))]; return { label: labels.join(' / '), kind: hit[0][2] }; };
    const has = (k, key) => statKeys(k).some(([fk]) => fk === key);
    const unit = (kind) => (kind === 'p' ? '%' : kind === 'rp' ? 'Rp' : kind === 't' ? 'jam:mnt:dtk' : '');
    let tabi = 0; const tabIdx = {};
    const ti = (k) => { tabIdx[k] = (tabIdx[k] || 0) + 1; return CHS.indexOf(k) * 1000 + tabIdx[k] + 1; };
    const cell = (k, key, kind) => {
      if (!has(k, key)) return '<td class="na">–</td>';
      const r = draft[k], v = r[key];
      return kind === 't'
        ? `<td><input type="text" class="cs-in" data-ch="${k}" data-sk="${key}" data-kind="t" value="${v ? fmtClock(v) : ''}" placeholder="00:15:48" tabindex="${ti(k)}" ${dis}></td>`
        : `<td><input type="number" class="cs-in" min="0" step="${kind === 'p' ? '0.01' : '1'}" inputmode="decimal" data-ch="${k}" data-sk="${key}" data-kind="${kind}" value="${v ?? ''}" placeholder="0" tabindex="${ti(k)}" ${dis}></td>`;
    };
    const head = `<thead><tr><th>Isi angka hari ini</th>${CHS.map((k) => `<th style="--c:${CH[k].color}"><span class="cs-colh"><i></i>${esc(CH[k].label)}</span><small>${isShopee(k) ? 'Seller Centre › Data › Layanan › Chat' : 'Analitik layanan › Ringkasan pesan'}</small></th>`).join('')}</tr></thead>`;
    const formHtml = () => {
      Object.keys(tabIdx).forEach((k) => delete tabIdx[k]);
      const statRows = SECTIONS.map(([title, keys]) => {
        const rows = keys.map((key) => [key, statDef(key)]).filter(([, def]) => def);
        return `<tr class="cs-sec"><td colspan="${CHS.length + 1}">${esc(title)}</td></tr>${rows.map(([key, def]) => `<tr><th>${esc(def.label)}${unit(def.kind) ? ` <small>${unit(def.kind)}</small>` : ''}</th>${CHS.map((k) => cell(k, key, def.kind)).join('')}</tr>`).join('')}`;
      }).join('');
      const opRows = `<tr><th>Catatan / kendala</th>${CHS.map((k) => `<td><textarea class="cs-in" rows="2" data-ch="${k}" data-fk="note" placeholder="Komplain penting, eskalasi…" tabindex="${ti(k)}" ${dis}>${esc(draft[k].note || '')}</textarea></td>`).join('')}</tr>`;
      const tasks = [...new Map(CHS.flatMap((k) => TASKS[k]).map(([tk, l]) => [tk, l])).entries()];
      const taskRows = tasks.map(([tk, l]) => `<tr><th>${esc(l)}</th>${CHS.map((k) => (TASKS[k].some(([x]) => x === tk) ? `<td class="cs-chk"><input type="checkbox" data-ch="${k}" data-task="${tk}" ${(draft[k].tasks || []).includes(tk) ? 'checked' : ''} ${dis}></td>` : '<td class="na">–</td>')).join('')}</tr>`).join('');
      return `
        <div class="table-wrap cs-mx-wrap"><table class="cs-mx">${head}<tbody>${statRows}
          <tr class="cs-sec"><td colspan="${CHS.length + 1}">Catatan</td></tr>${opRows}
          <tr class="cs-sec"><td colspan="${CHS.length + 1}">Checklist jobdesk <span class="cs-allbtns">${canEdit() ? CHS.map((k) => `<button type="button" class="btn sm" data-allt="${k}">✓ semua ${esc(CH[k].label)}</button>`).join('') : ''}</span></td></tr>${taskRows}
        </tbody></table></div>
        <p class="muted small">Kosongkan saja angka yang tidak ada. Tekan Tab untuk pindah ke kolom bawahnya (satu channel dulu sampai selesai). Channel yang tidak diisi sama sekali tidak ikut disimpan.</p>
        <h3 class="cs-h">⚡ Flash sale Shopee Official</h3>
        ${fsForm()}`;
    };
    const fsForm = () => `
      <div class="cs-sgroup"><b>Performa hari ini <span class="muted small">Shopee › Data › Promosi › Flash Sale Toko Saya › Kriteria Utama</span></b><div class="cs-grid">${FS_PERF.map(([fk, l, kind]) => `<label>${esc(l)}${kind === 'p' ? ' (%)' : kind === 'rp' ? ' (Rp)' : ''}<input type="number" min="0" step="${kind === 'p' ? '0.01' : '1'}" inputmode="decimal" data-fp="${fk}" value="${draft.shopee[fk] ?? ''}" placeholder="0" ${dis}></label>`).join('')}
        <label>Penjualan per pembeli<input type="text" value="${draft.shopee.fsBuyers ? money((draft.shopee.fsSales || 0) / draft.shopee.fsBuyers) : '–'}" disabled data-fpb></label></div></div>
      <div class="table-wrap"><table class="data cs-fs"><thead><tr><th>Sesi</th><th>Produk diajukan</th><th>Varian</th><th class="num">Harga normal</th><th class="num">Harga FS</th><th class="num">Diskon</th><th class="num">Stok FS</th><th class="num">Terjual</th><th>Status</th><th></th></tr></thead>
      <tbody>${draft.fs.map((x, i) => `<tr data-fsi="${i}">
        <td><input list="csSessions" data-fs="session" value="${esc(x.session || '')}" placeholder="12:00–15:00" ${dis}></td>
        <td><input list="csProducts" data-fs="product" value="${esc(x.product || '')}" placeholder="Nama produk" class="wide" ${dis}></td>
        <td><input data-fs="variant" value="${esc(x.variant || '')}" placeholder="Warna / size" ${dis}></td>
        <td class="num"><input type="number" min="0" data-fs="normalPrice" value="${x.normalPrice || ''}" ${dis}></td>
        <td class="num"><input type="number" min="0" data-fs="price" value="${x.price || ''}" ${dis}></td>
        <td class="num" data-disc>${x.normalPrice && x.price ? pct(1 - x.price / x.normalPrice) : '–'}</td>
        <td class="num"><input type="number" min="0" data-fs="stock" value="${x.stock || ''}" class="sm" ${dis}></td>
        <td class="num"><input type="number" min="0" data-fs="sold" value="${x.sold || ''}" class="sm" ${dis}></td>
        <td><select data-fs="status" ${dis}>${Object.entries(FS_STATUS).map(([sk, l]) => `<option value="${sk}"${(x.status || 'diajukan') === sk ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
        <td>${canEdit() ? `<button class="icon-btn" type="button" data-fsdel="${i}" title="Hapus">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="muted" style="text-align:center;padding:16px">Belum ada produk yang diajukan.</td></tr>'}</tbody></table></div>
      ${canEdit() ? '<button class="btn sm" type="button" id="fsAdd" style="margin-top:10px">+ Tambah produk flash sale</button>' : ''}`;
    const drawState = () => {
      $('#csState', box).innerHTML = CHS.map((k) => `<span class="cs-st${had[k] || dirtyCh[k] ? ' on' : ''}" style="--c:${CH[k].color}" title="${had[k] && draft[k].updatedBy ? `diisi ${esc(draft[k].updatedBy)} · ${esc(draft[k].updatedAt || '')}` : ''}">${had[k] || dirtyCh[k] ? '✓' : '○'} ${esc(CH[k].label)}</span>`).join('');
    };
    const touch = (k) => { dirty = true; if (k && !dirtyCh[k]) { dirtyCh[k] = true; drawState(); } };
    function draw() {
      const body = $('#csBody', box);
      body.innerHTML = formHtml();
      drawState();
      // one listener for the whole form
      body.oninput = (e) => {
        const el = e.target, k = el.dataset.ch;
        if (el.dataset.sk) { const r = draft[k]; r[el.dataset.sk] = el.dataset.kind === 't' ? toMin(el.value) : (el.value === '' ? 0 : Number(el.value)); syncRate(k, r); touch(k); }
        else if (el.dataset.fk) { draft[k][el.dataset.fk] = el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value; touch(k); }
        else if (el.dataset.fp) { draft.shopee[el.dataset.fp] = el.value === '' ? 0 : Number(el.value); const pb = body.querySelector('[data-fpb]'); pb.value = draft.shopee.fsBuyers ? money((draft.shopee.fsSales || 0) / draft.shopee.fsBuyers) : '–'; touch('shopee'); }
        else if (el.dataset.fs) { const x = draft.fs[Number(el.closest('tr').dataset.fsi)]; x[el.dataset.fs] = el.type === 'number' ? Number(el.value) || 0 : el.value; el.closest('tr').querySelector('[data-disc]').textContent = x.normalPrice && x.price ? pct(1 - x.price / x.normalPrice) : '–'; touch(); }
      };
      body.onchange = (e) => {
        const el = e.target;
        if (el.dataset.task) { const k = el.dataset.ch; draft[k].tasks = $$(`[data-task][data-ch="${k}"]`, body).filter((c) => c.checked).map((c) => c.dataset.task); touch(k); }
        else if (el.dataset.fs && el.tagName === 'SELECT') { draft.fs[Number(el.closest('tr').dataset.fsi)].status = el.value; touch(); }
      };
      $$('[data-allt]', body).forEach((btn) => btn.addEventListener('click', () => { const k = btn.dataset.allt; const boxes = $$(`[data-task][data-ch="${k}"]`, body); const on = !boxes.every((c) => c.checked); boxes.forEach((c) => { c.checked = on; }); draft[k].tasks = on ? TASKS[k].map(([tk]) => tk) : []; touch(k); }));
      $$('[data-fsdel]', body).forEach((btn) => btn.addEventListener('click', () => { draft.fs.splice(Number(btn.dataset.fsdel), 1); touch(); draw(); }));
      $('#fsAdd', body)?.addEventListener('click', () => { const last = draft.fs[draft.fs.length - 1]; draft.fs.push({ id: '', date: d, session: last?.session || '', product: '', variant: '', normalPrice: 0, price: 0, stock: 0, sold: 0, status: 'diajukan' }); touch(); const top = body.scrollTop; draw(); body.scrollTop = top; $$('[data-fs="product"]', body).pop()?.focus(); });
    }
    const close = () => { if (dirty && !confirm('Perubahan belum disimpan. Tutup?')) return; box.remove(); };
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-close]')) close(); });
    $('#csCopy', box).addEventListener('click', async () => { try { await navigator.clipboard.writeText(reportText(d, draft)); toast('Teks report disalin'); } catch { toast('Tidak bisa menyalin', true); } });
    $('#csPdfDay', box).addEventListener('click', () => dayPdf(d, draft));
    $('#csSave', box)?.addEventListener('click', async () => {
      const at = stamp(), by = who();
      let daily = B.data.csdaily.filter((r) => r.date !== d || !CHS.some((k) => r.channel === k && (had[k] || dirtyCh[k])));
      CHS.forEach((k) => { if (!had[k] && !dirtyCh[k]) return; syncRate(k, draft[k]); daily.push({ ...draft[k], id: draft[k].id || '', date: d, channel: k, updatedAt: dirtyCh[k] ? at : draft[k].updatedAt, updatedBy: dirtyCh[k] ? by : draft[k].updatedBy }); });
      const fsRows = [...B.data.flashsale.filter((x) => x.date !== d), ...draft.fs.filter((x) => x.product.trim()).map((x) => ({ ...x, date: d, updatedAt: at, updatedBy: by }))];
      try {
        B.data.csdaily = await api('/api/csdaily', json('PUT', daily));
        B.data.flashsale = await api('/api/flashsale', json('PUT', fsRows));
        dirty = false; box.remove(); toast(`Laporan ${longDay(d)} tersimpan`); render();
      } catch (e) { toast(e.message, true); }
    });
    draw();
  }

  function reportText(d, draft) {
    const line = (k) => {
      const r = draft[k];
      if (!r.date && !Object.keys(r).some((x) => FIELDS.some(([f]) => f === x) || statKeys(k).some(([f]) => f === x))) return [`*${CH[k].label}*`, '- belum diisi'];
      return [`*${CH[k].label}*`,
        ...statKeys(k).filter(([fk]) => r[fk]).map(([fk, l, kind]) => `- ${l}: ${statVal(kind, r[fk])}`),
        ...(r.note ? [`- Catatan: ${r.note}`] : [])];
    };
    const fs = draft.fs.filter((x) => x.product.trim());
    const p = draft.shopee;
    return [`Daily report Customer Service BALLOP · ${longDay(d)}`, '', ...CHS.flatMap((k) => [...line(k), '']), '*Flash sale Shopee Official*',
      ...(FS_PERF.some(([k]) => p[k]) ? [`- Penjualan ${money(p.fsSales || 0)} · ${num(p.fsOrders || 0)} pesanan · ${num(p.fsBuyers || 0)} pembeli · klik ${p.fsClick || 0}% · ${num(p.fsViews || 0)} produk dilihat`] : []),
      ...(fs.length ? fs.map((x) => `- ${x.session ? `${x.session} · ` : ''}${x.product}${x.variant ? ` ${x.variant}` : ''}: ${money(x.price)}${x.normalPrice ? ` (normal ${money(x.normalPrice)})` : ''}, stok ${num(x.stock)} · ${FS_STATUS[x.status || 'diajukan']}`) : ['- belum ada yang diajukan'])].join('\n');
  }

  B.registerView('cs', render);
})();
