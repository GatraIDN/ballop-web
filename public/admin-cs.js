// BALLOP admin: customer service. Daily report per marketplace (chat, complaints, returns, reviews, shop
// performance + the daily SOP checklist) and the Shopee shop flash sale submitted every day.
(() => {
  const { $, $$, api, json, toast } = window.A;
  const B = window.Biz;
  const { esc, num, money, pct, today, fmtDate } = B;

  const CH = { shopee: { label: 'Shopee', color: '#eb6834' }, tiktok: { label: 'TikTok Shop', color: '#2a78d6' } };
  // daily SOP; flash sale only exists on Shopee
  const TASKS = {
    shopee: [['chat', 'Balas semua chat masuk (jaga response rate)'], ['orders', 'Cek pesanan perlu dikirim & yang terlambat'], ['returns', 'Proses pengajuan retur / refund'],
      ['complaints', 'Follow up komplain sampai selesai'], ['reviews', 'Balas ulasan pembeli (terutama bintang 1–3)'], ['cancel', 'Tangani permintaan pembatalan'],
      ['perf', 'Cek Performa Toko & poin penalti'], ['flash', 'Submit Flash Sale toko untuk besok']],
    tiktok: [['chat', 'Balas semua chat masuk (jaga response rate)'], ['orders', 'Cek pesanan perlu dikirim & yang terlambat'], ['returns', 'Proses pengajuan retur / refund'],
      ['complaints', 'Follow up komplain sampai selesai'], ['reviews', 'Balas ulasan pembeli (terutama bintang 1–3)'], ['cancel', 'Tangani permintaan pembatalan'],
      ['perf', 'Cek Shop Performance Score (SPS) & pelanggaran']],
  };
  const FIELDS = [
    ['chats', 'Chat masuk'], ['replied', 'Chat dibalas'], ['responseRate', 'Chat response rate (%)'], ['responseTime', 'Rata-rata waktu balas (menit)'],
    ['complaints', 'Komplain masuk'], ['complaintsDone', 'Komplain selesai'], ['returns', 'Retur / refund masuk'], ['returnsDone', 'Retur / refund diproses'],
    ['reviews', 'Ulasan dibalas'], ['badReviews', 'Ulasan bintang 1–3'], ['cancels', 'Permintaan batal'], ['lateOrders', 'Pesanan telat di-follow up'],
  ];
  const FS_STATUS = { diajukan: 'Diajukan', disetujui: 'Disetujui', ditolak: 'Ditolak', live: 'Live', selesai: 'Selesai' };
  const FS_BADGE = { diajukan: '', disetujui: 'live', ditolak: 'bad', live: 'live', selesai: 'warn' };
  const SESSIONS = ['00:00–09:00', '09:00–12:00', '12:00–15:00', '15:00–18:00', '18:00–21:00', '21:00–24:00'];
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const longDay = (d) => { const [y, m, n] = d.split('-').map(Number); return `${n} ${MONTHS[m - 1]} ${y}`; };
  const st = { month: today().slice(0, 7) };
  const canEdit = () => window.A.can('cs') && !window.A.me?.readOnly;
  const who = () => window.A.me?.user?.name || window.A.me?.user?.username || 'admin';
  const stamp = () => { const d = new Date(); return `${today()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const rep = (d, ch) => B.data.csdaily.find((r) => r.date === d && r.channel === ch);
  const fsOf = (d) => B.data.flashsale.filter((x) => x.date === d);

  function monthStats(rows, fs) {
    const t = { days: new Set(rows.map((r) => r.date)).size, chats: 0, replied: 0, rr: [], complaints: 0, complaintsDone: 0, returns: 0, returnsDone: 0, reviews: 0, badReviews: 0, fsDays: new Set(fs.map((x) => x.date)).size, fsItems: fs.length, fsOk: fs.filter((x) => ['disetujui', 'live', 'selesai'].includes(x.status)).length, fsSold: fs.reduce((s, x) => s + x.sold, 0) };
    rows.forEach((r) => { ['chats', 'replied', 'complaints', 'complaintsDone', 'returns', 'returnsDone', 'reviews', 'badReviews'].forEach((k) => { t[k] += r[k]; }); if (r.responseRate) t.rr.push(r.responseRate); });
    t.rate = t.rr.length ? t.rr.reduce((a, b) => a + b, 0) / t.rr.length : NaN;
    return t;
  }

  function render() {
    const v = $('#view-cs');
    const [y, m] = st.month.split('-').map(Number);
    const len = new Date(y, m, 0).getDate(), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, t = today();
    const inM = (r) => r.date.startsWith(st.month);
    const rows = B.data.csdaily.filter(inM), fs = B.data.flashsale.filter(inM);
    const s = monthStats(rows, fs), sh = monthStats(rows.filter((r) => r.channel === 'shopee'), []), tt = monthStats(rows.filter((r) => r.channel === 'tiktok'), []);
    const past = Math.min(len, t.slice(0, 7) === st.month ? Number(t.slice(8)) : t > st.month ? len : 0);
    const cells = [...Array(lead)].map(() => '<div class="dc empty"></div>');
    for (let n = 1; n <= len; n++) {
      const d = `${st.month}-${String(n).padStart(2, '0')}`, future = d > t;
      const a = rep(d, 'shopee'), b = rep(d, 'tiktok'), f = fsOf(d);
      const done = [a, b, f.length].filter(Boolean).length;
      cells.push(`<button type="button" class="dc ${future ? 'future' : done === 3 ? 'done' : done ? 'part' : 'todo'}${d === t ? ' today' : ''}" data-csday="${d}" ${future ? 'disabled' : ''}>
        <span class="dc-n">${n}</span>${future ? '' : `<span class="cs-pills"><i class="${a ? 'on' : ''}" style="--c:${CH.shopee.color}">S</i><i class="${b ? 'on' : ''}" style="--c:${CH.tiktok.color}">T</i><i class="${f.length ? 'on' : ''}" style="--c:#e8a200">⚡${f.length || ''}</i></span>`}</button>`);
    }
    const chCard = (k, x) => `<div class="cs-ch" style="--c:${CH[k].color}"><b>${CH[k].label}</b>
      <span>Chat <strong>${num(x.chats)}</strong></span><span>Response rate <strong>${Number.isFinite(x.rate) ? `${x.rate.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–'}</strong></span>
      <span>Komplain selesai <strong>${num(x.complaintsDone)}/${num(x.complaints)}</strong></span><span>Retur diproses <strong>${num(x.returnsDone)}/${num(x.returns)}</strong></span>
      <span>Ulasan dibalas <strong>${num(x.reviews)}</strong> · buruk ${num(x.badReviews)}</span></div>`;

    v.innerHTML = `
      <header class="bar"><div><h1>Customer service</h1><p class="muted">Daily report CS Shopee & TikTok Shop dan submit Flash Sale Shopee setiap hari. Klik tanggal di kalender untuk isi atau lihat laporan.</p></div>
        <div class="bar-actions">${canEdit() ? `<button class="btn sm primary" type="button" data-csday="${t}">+ Laporan hari ini</button>` : ''}</div></header>
      <div class="st-cards">
        <div class="st-card hero"><span>Laporan ${MONTHS[m - 1]}</span><b>${num(s.days)}/${num(past)}</b><small>hari sudah diisi</small></div>
        <div class="st-card"><span>Chat masuk</span><b>${num(s.chats)}</b><small>${s.chats ? pct(s.replied / s.chats) : '–'} dibalas</small></div>
        <div class="st-card"><span>Response rate rata-rata</span><b>${Number.isFinite(s.rate) ? `${s.rate.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '–'}</b><small>dari laporan harian</small></div>
        <div class="st-card"><span>Komplain selesai</span><b>${num(s.complaintsDone)}/${num(s.complaints)}</b><small>retur ${num(s.returnsDone)}/${num(s.returns)}</small></div>
        <div class="st-card warn"><span>Flash sale</span><b>${num(s.fsDays)} hari</b><small>${num(s.fsItems)} produk · ${num(s.fsOk)} disetujui</small></div>
        <div class="st-card"><span>Terjual di flash sale</span><b>${num(s.fsSold)}</b><small>pcs</small></div>
      </div>
      <div class="cs-chs">${chCard('shopee', sh)}${chCard('tiktok', tt)}</div>
      <section class="panel solid d-cal">
        <div class="panel-head"><h2>Kalender laporan · ${MONTHS[m - 1]} ${y}</h2>
          <span class="cal-nav"><button class="btn sm" type="button" data-csm="-1" aria-label="Bulan sebelumnya">‹</button><button class="btn sm" type="button" data-csm="0">Bulan ini</button><button class="btn sm" type="button" data-csm="1" aria-label="Bulan berikutnya">›</button></span></div>
        <div class="dc-grid dc-head">${['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'].map((h) => `<span>${h}</span>`).join('')}</div>
        <div class="dc-grid">${cells.join('')}</div>
        <div class="dc-legend"><span><i class="done"></i>Lengkap (Shopee + TikTok + flash sale)</span><span><i class="part"></i>Sebagian</span><span><i class="todo"></i>Belum ada</span><span class="muted">S = Shopee · T = TikTok · ⚡ = produk flash sale</span></div>
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
  }

  // one popup per date: Shopee / TikTok report + flash sale list, all saved together
  function dayPopup(d) {
    const draft = { shopee: { ...(rep(d, 'shopee') || { tasks: [] }) }, tiktok: { ...(rep(d, 'tiktok') || { tasks: [] }) }, fs: fsOf(d).map((x) => ({ ...x })) };
    const had = { shopee: !!rep(d, 'shopee'), tiktok: !!rep(d, 'tiktok') };
    let tab = 'shopee', dirty = false;
    const names = [...new Set(B.data.stock3pl.map((r) => r.product).filter(Boolean))].sort();
    const box = document.createElement('div');
    box.className = 'raw-pop';
    box.innerHTML = `<div class="raw-card cs-pop">
      <header><div><span class="muted small">Daily report customer service</span><h2>${longDay(d)}</h2></div><button class="btn sm" type="button" data-close>✕</button></header>
      <div class="seg glass cs-tabs" id="csTabs"></div>
      <div class="raw-body" id="csBody"></div>
      <footer><button class="btn sm" type="button" id="csCopy">⧉ Copy teks report</button><span class="spacer"></span><button class="btn sm" type="button" data-close>Tutup</button>${canEdit() ? '<button class="btn sm primary" type="button" id="csSave">Simpan</button>' : ''}</footer>
    </div><datalist id="csProducts">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist><datalist id="csSessions">${SESSIONS.map((n) => `<option value="${n}">`).join('')}</datalist>`;
    document.body.appendChild(box);
    const dis = canEdit() ? '' : 'disabled';
    const drawTabs = () => {
      const mark = (k) => (k === 'fs' ? (draft.fs.length ? ` <i class="cs-dot on">${draft.fs.length}</i>` : ' <i class="cs-dot"></i>') : (had[k] || dirtyCh[k] ? ' <i class="cs-dot on">✓</i>' : ' <i class="cs-dot"></i>'));
      $('#csTabs', box).innerHTML = [['shopee', 'Shopee'], ['tiktok', 'TikTok Shop'], ['fs', '⚡ Flash sale Shopee']].map(([k, l]) => `<button type="button" data-cstab="${k}" class="${tab === k ? 'on' : ''}">${l}${mark(k)}</button>`).join('');
      $$('[data-cstab]', box).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.cstab; draw(); }));
    };
    const dirtyCh = { shopee: false, tiktok: false };
    const chForm = (k) => {
      const r = draft[k];
      const status = had[k] ? `<div class="d-note ok"><b>✓ Laporan ${CH[k].label} tanggal ini sudah diisi</b><span>${r.updatedBy ? `oleh ${esc(r.updatedBy)} · ${esc(r.updatedAt)}` : ''} · ubah angka di bawah lalu Simpan untuk edit</span></div>` : `<div class="d-note"><b>Belum ada laporan ${CH[k].label}</b><span>Isi checklist & angka hari ini.</span></div>`;
      return `${status}
        <h3 class="cs-h">Checklist jobdesk</h3>
        <div class="cs-tasks">${TASKS[k].map(([tk, l]) => `<label class="cs-task${(r.tasks || []).includes(tk) ? ' on' : ''}"><input type="checkbox" data-task="${tk}" ${(r.tasks || []).includes(tk) ? 'checked' : ''} ${dis}><span>${esc(l)}</span></label>`).join('')}</div>
        <h3 class="cs-h">Angka hari ini</h3>
        <div class="cs-grid">${FIELDS.map(([fk, l]) => `<label>${l}<input type="number" min="0" step="${fk === 'responseRate' || fk === 'responseTime' ? '0.1' : '1'}" inputmode="decimal" data-fk="${fk}" value="${r[fk] ?? ''}" placeholder="0" ${dis}></label>`).join('')}
          <label>${k === 'shopee' ? 'Poin penalti / performa toko' : 'Shop Performance Score'}<input type="text" data-fk="score" value="${esc(r.score || '')}" placeholder="${k === 'shopee' ? 'mis. 0 poin' : 'mis. 4.8'}" ${dis}></label></div>
        <label class="cs-note">Catatan / kendala hari ini<textarea data-fk="note" rows="3" placeholder="Komplain penting, pesanan bermasalah, eskalasi…" ${dis}>${esc(r.note || '')}</textarea></label>`;
    };
    const fsForm = () => `
      ${draft.fs.length ? `<div class="d-note ok"><b>✓ ${num(draft.fs.length)} produk flash sale tercatat untuk tanggal ini</b><span>Ubah status setelah Shopee menyetujui / menolak, isi terjual setelah sesi selesai.</span></div>` : '<div class="d-note"><b>Belum ada flash sale untuk tanggal ini</b><span>Tambahkan produk yang diajukan ke Flash Sale toko Shopee.</span></div>'}
      <div class="table-wrap"><table class="data cs-fs"><thead><tr><th>Sesi</th><th>Produk</th><th>Varian</th><th class="num">Harga normal</th><th class="num">Harga FS</th><th class="num">Diskon</th><th class="num">Stok FS</th><th class="num">Terjual</th><th>Status</th><th></th></tr></thead>
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
        <td>${canEdit() ? `<button class="icon-btn" type="button" data-fsdel="${i}" title="Hapus">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="muted" style="text-align:center;padding:20px">Belum ada produk.</td></tr>'}</tbody></table></div>
      ${canEdit() ? '<button class="btn sm" type="button" id="fsAdd" style="margin-top:10px">+ Tambah produk flash sale</button>' : ''}`;
    function draw() {
      drawTabs();
      const body = $('#csBody', box);
      body.innerHTML = tab === 'fs' ? fsForm() : chForm(tab);
      if (tab === 'fs') {
        $$('[data-fs]', body).forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
          const x = draft.fs[Number(el.closest('tr').dataset.fsi)];
          x[el.dataset.fs] = el.type === 'number' ? Number(el.value) || 0 : el.value;
          const td = el.closest('tr').querySelector('[data-disc]'); td.textContent = x.normalPrice && x.price ? pct(1 - x.price / x.normalPrice) : '–';
          dirty = true;
        }));
        $$('[data-fsdel]', body).forEach((b) => b.addEventListener('click', () => { draft.fs.splice(Number(b.dataset.fsdel), 1); dirty = true; draw(); }));
        $('#fsAdd', body)?.addEventListener('click', () => { const last = draft.fs[draft.fs.length - 1]; draft.fs.push({ id: '', date: d, session: last?.session || '', product: '', variant: '', normalPrice: 0, price: 0, stock: 0, sold: 0, status: 'diajukan' }); dirty = true; draw(); $$('[data-fs="product"]', body).pop()?.focus(); });
      } else {
        const r = draft[tab], ch = tab;
        $$('[data-task]', body).forEach((el) => el.addEventListener('change', () => {
          r.tasks = $$('[data-task]', body).filter((c) => c.checked).map((c) => c.dataset.task);
          el.closest('.cs-task').classList.toggle('on', el.checked); dirty = true; dirtyCh[ch] = true; drawTabs();
        }));
        $$('[data-fk]', body).forEach((el) => el.addEventListener('input', () => {
          r[el.dataset.fk] = el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value;
          // chat response rate follows from replied / incoming when not typed in
          if ((el.dataset.fk === 'chats' || el.dataset.fk === 'replied') && r.chats && !body.querySelector('[data-fk="responseRate"]').dataset.typed) {
            r.responseRate = Math.round(((r.replied || 0) / r.chats) * 1000) / 10; body.querySelector('[data-fk="responseRate"]').value = r.responseRate;
          }
          if (el.dataset.fk === 'responseRate') el.dataset.typed = '1';
          dirty = true; if (!dirtyCh[ch]) { dirtyCh[ch] = true; drawTabs(); }
        }));
      }
    }
    const close = () => { if (dirty && !confirm('Perubahan belum disimpan. Tutup?')) return; box.remove(); };
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-close]')) close(); });
    $('#csCopy', box).addEventListener('click', async () => { try { await navigator.clipboard.writeText(reportText(d, draft)); toast('Teks report disalin'); } catch { toast('Tidak bisa menyalin', true); } });
    $('#csSave', box)?.addEventListener('click', async () => {
      const at = stamp(), by = who();
      let daily = B.data.csdaily.filter((r) => r.date !== d || !['shopee', 'tiktok'].some((k) => r.channel === k && (had[k] || dirtyCh[k])));
      ['shopee', 'tiktok'].forEach((k) => { if (had[k] || dirtyCh[k]) daily.push({ ...draft[k], id: draft[k].id || '', date: d, channel: k, updatedAt: dirtyCh[k] ? at : draft[k].updatedAt, updatedBy: dirtyCh[k] ? by : draft[k].updatedBy }); });
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
      if (!r.date && !Object.keys(r).some((x) => FIELDS.some(([f]) => f === x))) return [`*${CH[k].label}*`, '- belum diisi'];
      return [`*${CH[k].label}*`,
        `- Chat masuk ${num(r.chats || 0)}, dibalas ${num(r.replied || 0)}${r.responseRate ? ` (response rate ${r.responseRate}%)` : ''}${r.responseTime ? `, rata-rata ${r.responseTime} menit` : ''}`,
        `- Komplain ${num(r.complaints || 0)} (selesai ${num(r.complaintsDone || 0)}), retur/refund ${num(r.returns || 0)} (diproses ${num(r.returnsDone || 0)})`,
        `- Ulasan dibalas ${num(r.reviews || 0)}, ulasan bintang 1–3: ${num(r.badReviews || 0)}`,
        `- Permintaan batal ${num(r.cancels || 0)}, pesanan telat di-follow up ${num(r.lateOrders || 0)}${r.score ? `, ${k === 'shopee' ? 'performa toko' : 'SPS'}: ${r.score}` : ''}`,
        ...(r.note ? [`- Catatan: ${r.note}`] : [])];
    };
    const fs = draft.fs.filter((x) => x.product.trim());
    return [`Daily report Customer Service BALLOP · ${longDay(d)}`, '', ...line('shopee'), '', ...line('tiktok'), '', '*Flash sale Shopee*',
      ...(fs.length ? fs.map((x) => `- ${x.session ? `${x.session} · ` : ''}${x.product}${x.variant ? ` ${x.variant}` : ''}: ${money(x.price)}${x.normalPrice ? ` (normal ${money(x.normalPrice)})` : ''}, stok ${num(x.stock)} · ${FS_STATUS[x.status || 'diajukan']}`) : ['- belum ada yang diajukan'])].join('\n');
  }

  B.registerView('cs', render);
})();
