// BALLOP admin: ad spend calendar on the Iklan page. Each day shows the spend already typed in (or "belum
// input"); clicking a day opens a popup with every campaign of that day, added / edited / removed in one save.
(() => {
  const { $, $$, api, json, toast } = window.A;
  const B = window.Biz;
  const { esc, num, money, today } = B;
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const longDay = (d) => { const [y, m, n] = d.split('-').map(Number); return `${n} ${MONTHS[m - 1]} ${y}`; };
  const short = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt` : n >= 1e3 ? `${Math.round(n / 1e3)}rb` : num(n));
  const ratio = (n) => (Number.isFinite(n) && n > 0 ? `${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}×` : '–');
  const canEdit = () => window.A.can('ads') && !window.A.me?.readOnly;
  const st = { month: today().slice(0, 7) };
  const est = { range: 'mtd', from: '', to: '', limit: 150 };

  // ---------- PDF: one day (from the popup, may be unsaved) or a period ----------
  function adsPdf(from, to, list) {
    const P = window.PdfReport, CH = B.ADS_CH;
    const num = P.num, ratio = (n) => (Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}×` : '–');
    const rows = list || B.data.ads.filter((a) => a.date >= from && a.date <= to);
    const agg = (key) => { const g = {}; rows.forEach((a) => { const k = key(a); const x = g[k] = g[k] || { spend: 0, revenue: 0, orders: 0, impressions: 0, clicks: 0, impWithClicks: 0, spendClicked: 0, ch: a.channel, n: 0 };
      x.spend += a.spend || 0; x.revenue += a.revenue || 0; x.orders += a.orders || 0; x.n++;
      if (a.impressions) { x.impressions += a.impressions; x.impWithClicks += a.clicks || 0; }
      if (a.clicks) { x.clicks += a.clicks; x.spendClicked += a.spend || 0; } }); return g; };
    const tot = Object.values(agg(() => 'all'))[0] || { spend: 0, revenue: 0, orders: 0, impressions: 0, clicks: 0, impWithClicks: 0, spendClicked: 0 };
    const roas = (x) => ratio(x.spend ? x.revenue / x.spend : NaN);
    const ctr = (x) => (x.impressions ? P.pct(x.impWithClicks / x.impressions) : '–');
    const cpc = (x) => (x.clicks ? P.rp(x.spendClicked / x.clicks) : '–');
    const cpo = (x) => (x.orders ? P.rp(x.spend / x.orders) : '–');
    const chLabel = (k) => (CH[k] || CH.other).label, chColor = (k) => (CH[k] || CH.other).color;
    const byCh = Object.entries(agg((a) => a.channel)).sort((a, b) => b[1].spend - a[1].spend);
    const byCamp = Object.entries(agg((a) => `${a.channel}|${a.campaign || '(no name)'}`)).sort((a, b) => b[1].spend - a[1].spend);
    const byDay = Object.entries(agg((a) => a.date)).sort((a, b) => a[0].localeCompare(b[0]));
    const one = from === to;
    const body = `
      ${P.h2('Ads summary', 'revenue &amp; orders = attribution from the ad dashboards')}
      ${P.tiles([
        P.tile('Total spend', P.rp(tot.spend), `${num(byCamp.length)} campaigns · ${num(byCh.length)} channels`, true),
        P.tile('Ad revenue / GMV', P.rp(tot.revenue), `${num(tot.orders)} orders`),
        P.tile('ROAS', roas(tot), 'revenue ÷ spend'),
        P.tile('Cost per order', cpo(tot)),
        P.tile('Impressions', num(tot.impressions)),
        P.tile('Clicks', num(tot.clicks), `CTR ${ctr(tot)}`),
        P.tile('CPC', cpc(tot)),
        P.tile('Ad AOV', tot.orders ? P.rp(tot.revenue / tot.orders) : '–'),
      ])}
      ${P.h2('By channel')}
      ${P.table([['Channel'], ['Spend', 1], ['Share', 1], ['Revenue', 1], ['ROAS', 1], ['Orders', 1], ['Cost/order', 1], ['Impressions', 1], ['Clicks', 1], ['CTR', 1], ['CPC', 1]],
        byCh.map(([k, x]) => [`${P.dot(chColor(k))}${esc(chLabel(k))}`, `<b>${P.rp(x.spend)}</b>`, P.pct(tot.spend ? x.spend / tot.spend : NaN), P.rp(x.revenue), roas(x), num(x.orders), cpo(x), num(x.impressions), num(x.clicks), ctr(x), cpc(x)]),
        ['Total', P.rp(tot.spend), '100%', P.rp(tot.revenue), roas(tot), num(tot.orders), cpo(tot), num(tot.impressions), num(tot.clicks), ctr(tot), cpc(tot)], 'No ad spend yet.')}
      ${(() => { const typeOf = (a) => (/dari Seller Centre/.test(a.note || '') ? (a.note || '').split(' · ')[0].replace('Iklan Produk', 'Product Ads').replace('Iklan Toko+', 'Shop Ads').replace('Iklan Live', 'Live Ads').replace('Iklan Banner', 'Banner Ads') : /cpas/i.test(a.campaign) ? 'CPAS (Meta × Shopee)' : /gmv max/i.test(a.campaign) ? 'GMV Max' : a.channel === 'meta' ? 'Meta Ads' : a.channel === 'tiktok' ? 'TikTok Ads Manager' : 'Other');
        const bt = Object.entries(agg(typeOf)).sort((a, b) => b[1].spend - a[1].spend);
        return `${P.h2('By ad type')}${P.table([['Ad type'], ['Spend', 1], ['Share', 1], ['Revenue', 1], ['ROAS', 1], ['Orders', 1], ['Cost/order', 1], ['CTR', 1], ['CPC', 1]],
          bt.map(([k, x]) => [`${P.dot(chColor(x.ch))}${esc(k)}`, `<b>${P.rp(x.spend)}</b>`, P.pct(tot.spend ? x.spend / tot.spend : NaN), P.rp(x.revenue), roas(x), num(x.orders), cpo(x), ctr(x), cpc(x)]))}`; })()}
      ${one ? '' : `${P.h2('By date', 'all campaigns combined')}
      ${P.table([['Date'], ['Spend', 1], ['Revenue', 1], ['ROAS', 1], ['Orders', 1], ['Cost/order', 1], ['Clicks', 1]],
        byDay.map(([d, x]) => [P.longDate(d), `<b>${P.rp(x.spend)}</b>`, P.rp(x.revenue), roas(x), num(x.orders), cpo(x), num(x.clicks)]),
        ['Total', P.rp(tot.spend), P.rp(tot.revenue), roas(tot), num(tot.orders), cpo(tot), num(tot.clicks)])}`}`;
    P.open({ title: one ? 'Daily Ads Report' : 'Ads Report', period: P.period(from, to), onePage: one || byDay.length <= 10,
      meta: [[one ? 'Date' : 'Period', P.period(from, to)], ['Channel', esc(byCh.map(([k]) => chLabel(k)).join(', ') || '–')], ...(one ? [] : [['Days with data', `${num(byDay.length)} days`]])],
      body, note: 'Revenue, orders, impressions &amp; clicks = attribution from each platform ad dashboard (may include orders later cancelled). CTR &amp; CPC only from campaigns that report impressions/clicks.' });
  }
  const NUMS = [['spend', 'Spend (Rp)'], ['impressions', 'Impresi'], ['clicks', 'Klik'], ['orders', 'Order'], ['revenue', 'Revenue / GMV (Rp)']];

  function mount(sel) {
    const box = $(sel);
    if (!box) return;
    const CH = B.ADS_CH;
    const [y, m] = st.month.split('-').map(Number);
    const len = new Date(y, m, 0).getDate(), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, t = today();
    const days = {};
    B.data.ads.forEach((a) => { if (!a.date.startsWith(st.month)) return; const d = days[a.date] = days[a.date] || { spend: 0, revenue: 0, n: 0, ch: new Set() }; d.spend += a.spend; d.revenue += a.revenue; d.n++; d.ch.add(a.channel); });
    const vals = Object.values(days);
    const tot = vals.reduce((s, d) => s + d.spend, 0), rev = vals.reduce((s, d) => s + d.revenue, 0);
    const past = Math.min(len, t.slice(0, 7) === st.month ? Number(t.slice(8)) : t > st.month ? len : 0);
    const cells = [...Array(lead)].map(() => '<div class="dc empty"></div>');
    for (let n = 1; n <= len; n++) {
      const d = `${st.month}-${String(n).padStart(2, '0')}`, x = days[d], future = d > t;
      cells.push(`<button type="button" class="dc${x ? ' done' : future ? ' future' : ' todo'}${d === t ? ' today' : ''}" data-adday="${d}" ${future ? 'disabled' : ''}>
        <span class="dc-n">${n}</span>${x ? `<strong class="ac-spend">Rp ${short(x.spend)}</strong><small>ROAS ${ratio(x.spend ? x.revenue / x.spend : NaN)}</small><span class="ac-dots">${[...x.ch].map((c) => `<i style="background:${(CH[c] || CH.other).color}" title="${esc((CH[c] || CH.other).label)}"></i>`).join('')}</span>` : future ? '' : '<span class="dc-no">Belum input</span>'}</button>`);
    }
    box.innerHTML = `<section class="panel solid d-cal ac-cal">
      <div class="panel-head"><h2>Kalender spending iklan · ${MONTHS[m - 1]} ${y}</h2>
        <span class="muted small">${num(vals.length)}/${num(past)} hari diisi · spend ${money(tot)} · ROAS ${ratio(tot ? rev / tot : NaN)}</span>
        <span class="cal-nav"><button class="btn sm" type="button" data-acm="-1" aria-label="Bulan sebelumnya">‹</button><button class="btn sm" type="button" data-acm="0">Bulan ini</button><button class="btn sm" type="button" data-acm="1" aria-label="Bulan berikutnya">›</button></span></div>
      <div class="ac-export"><b>Export laporan iklan</b>${B.rangeBar(est)}<button class="btn sm btn-export" type="button" id="acPdf">⬇ Export PDF</button></div>
      <div class="dc-grid dc-head">${['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'].map((h) => `<span>${h}</span>`).join('')}</div>
      <div class="dc-grid">${cells.join('')}</div>
      <div class="dc-legend"><span><i class="done"></i>Sudah input</span><span><i class="todo"></i>Belum input</span>${Object.entries(CH).filter(([k]) => k !== 'other').map(([, c]) => `<span><i style="background:${c.color};border-radius:50%"></i>${esc(c.label)}</span>`).join('')}<span class="muted">Klik tanggal untuk input / edit spending hari itu.</span></div>
    </section>`;
    $$('[data-acm]', box).forEach((b) => b.addEventListener('click', () => {
      const n = Number(b.dataset.acm);
      if (!n) st.month = today().slice(0, 7); else { const d = new Date(y, m - 1 + n, 1); st.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
      mount(sel);
    }));
    $$('[data-adday]', box).forEach((b) => b.addEventListener('click', () => dayPopup(b.dataset.adday)));
    B.bindRangeBar(box.querySelector('.ac-export'), est, () => mount(sel));
    $('#acPdf', box).addEventListener('click', () => { const r = B.periodOf(est); adsPdf(r.from, r.to); });
  }

  // all campaigns of one day; rows can be added, changed and removed, saved together
  function dayPopup(d) {
    const CH = B.ADS_CH;
    const rows = B.data.ads.filter((a) => a.date === d).map((a) => ({ ...a }));
    const had = rows.length;
    // last day with data gives the campaign list to start an empty day from
    const prevDay = B.data.ads.map((a) => a.date).filter((x) => x < d).sort().pop();
    const camps = [...new Set([...B.ADS_CAMPAIGNS, ...B.data.ads.map((a) => a.campaign).filter(Boolean)])].sort();
    let dirty = false;
    const box = document.createElement('div');
    box.className = 'raw-pop';
    box.innerHTML = `<div class="raw-card ac-pop">
      <header><div><span class="muted small">Spending iklan</span><h2>${longDay(d)}</h2></div><div class="d-flowmini" id="acSum"></div><button class="btn sm" type="button" data-close>✕</button></header>
      <div class="raw-body"><div id="acNote"></div><div class="table-wrap"><table class="data ac-table"><thead><tr><th>Channel</th><th>Campaign</th>${NUMS.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th class="num">ROAS</th><th></th></tr></thead><tbody id="acRows"></tbody></table></div>
        ${canEdit() ? `<div class="ac-add"><button class="btn sm" type="button" id="acAdd">+ Tambah campaign</button>${!had && prevDay ? `<button class="btn sm" type="button" id="acCopy">Salin daftar campaign dari ${longDay(prevDay)}</button>` : ''}</div>` : ''}</div>
      <footer>${canEdit() && had ? '<button class="btn sm danger" type="button" id="acDel">🗑 Hapus semua input hari ini</button>' : ''}<span class="spacer"></span><button class="btn sm btn-export" type="button" id="acDayPdf">⬇ PDF hari ini</button><button class="btn sm" type="button" data-close>Tutup</button>${canEdit() ? '<button class="btn sm primary" type="button" id="acSave">Simpan</button>' : ''}</footer>
    </div><datalist id="acCamps">${camps.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;
    document.body.appendChild(box);
    const dis = canEdit() ? '' : 'disabled';
    const sum = () => {
      const s = rows.reduce((t, r) => t + (r.spend || 0), 0), v = rows.reduce((t, r) => t + (r.revenue || 0), 0);
      $('#acSum', box).innerHTML = `<span class="out">SPEND <b>${money(s)}</b></span><span class="in">REVENUE <b>${money(v)}</b></span><span class="end">ROAS <b>${ratio(s ? v / s : NaN)}</b></span>`;
      $('#acNote', box).innerHTML = had ? `<div class="d-note ok"><b>✓ Tanggal ini sudah diinput</b><span>${num(had)} campaign tersimpan · ubah angka lalu Simpan untuk edit</span></div>` : '<div class="d-note"><b>Belum ada input untuk tanggal ini</b><span>Tambah campaign satu per satu, atau salin daftar campaign dari hari sebelumnya.</span></div>';
    };
    const draw = () => {
      $('#acRows', box).innerHTML = rows.map((r, i) => `<tr data-ai="${i}">
        <td><select data-af="channel" ${dis}>${Object.entries(CH).map(([k, c]) => `<option value="${k}"${r.channel === k ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></td>
        <td><input list="acCamps" data-af="campaign" value="${esc(r.campaign || '')}" placeholder="Nama campaign" class="ac-camp" ${dis}></td>
        ${NUMS.map(([k]) => `<td class="num"><input class="d-in ac-num" type="number" min="0" data-af="${k}" value="${r[k] || ''}" placeholder="0" ${dis}></td>`).join('')}
        <td class="num" data-roas>${ratio(r.spend ? r.revenue / r.spend : NaN)}</td>
        <td>${canEdit() ? `<button class="icon-btn" type="button" data-adel="${i}" title="Hapus">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:22px">Belum ada campaign.</td></tr>';
      $$('[data-af]', box).forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const r = rows[Number(el.closest('tr').dataset.ai)];
        r[el.dataset.af] = el.type === 'number' ? Math.max(0, Number(el.value) || 0) : el.value;
        el.closest('tr').querySelector('[data-roas]').textContent = ratio(r.spend ? r.revenue / r.spend : NaN);
        dirty = true; sum();
      }));
      $$('[data-adel]', box).forEach((b) => b.addEventListener('click', () => { rows.splice(Number(b.dataset.adel), 1); dirty = true; draw(); }));
      sum();
    };
    const blankRow = (o = {}) => ({ id: '', date: d, channel: 'shopee', campaign: '', spend: 0, impressions: 0, clicks: 0, orders: 0, revenue: 0, note: '', ...o });
    $('#acAdd', box)?.addEventListener('click', () => { const last = rows[rows.length - 1]; rows.push(blankRow({ channel: last?.channel || 'shopee' })); dirty = true; draw(); $$('.ac-camp', box).pop()?.focus(); });
    $('#acCopy', box)?.addEventListener('click', (e) => { B.data.ads.filter((a) => a.date === prevDay).forEach((a) => rows.push(blankRow({ channel: a.channel, campaign: a.campaign }))); e.target.remove(); dirty = true; draw(); });
    const put = async (list, msg) => {
      try { B.data.ads = await api('/api/ads', json('PUT', list)); dirty = false; box.remove(); toast(msg); B.refresh(); } catch (e) { toast(e.message, true); }
    };
    $('#acSave', box)?.addEventListener('click', () => {
      const keep = rows.filter((r) => r.spend || r.revenue || r.impressions || r.clicks || r.orders || r.campaign.trim());
      put([...B.data.ads.filter((a) => a.date !== d), ...keep.map((r) => ({ ...r, date: d }))], `Spending ${longDay(d)} tersimpan`);
    });
    $('#acDel', box)?.addEventListener('click', () => { if (confirm(`Hapus semua input iklan ${longDay(d)}?`)) put(B.data.ads.filter((a) => a.date !== d), `Input iklan ${longDay(d)} dihapus`); });
    $('#acDayPdf', box).addEventListener('click', () => adsPdf(d, d, rows.filter((r) => r.spend || r.revenue || r.impressions || r.clicks || r.orders).map((r) => ({ ...r, date: d }))));
    const close = () => { if (dirty && !confirm('Perubahan belum disimpan. Tutup?')) return; box.remove(); };
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-close]')) close(); });
    draw();
  }

  window.AdsCal = { mount, pdf: adsPdf };
})();
