// BALLOP admin: content creator workspace. Monthly content plan (PDF + target), the content pipeline
// (board / calendar), links of everything that went live, and per-post metrics.
(() => {
  const { $, $$, api, json, toast } = window.A;
  const B = window.Biz;
  const { esc, num, compact, pct, fmtDate, fmtDay, today } = B;

  const STATUS = { ide: 'Ide', brief: 'Brief', produksi: 'Produksi', editing: 'Editing', review: 'Review', terjadwal: 'Terjadwal', posted: 'Sudah tayang', batal: 'Batal' };
  const FLOW = ['ide', 'brief', 'produksi', 'editing', 'review', 'terjadwal', 'posted'];
  const PLATFORM = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', shopee: 'Shopee Video', facebook: 'Facebook', website: 'Website / Jurnal', other: 'Lainnya' };
  const PCOLOR = { instagram: '#e87ba4', tiktok: '#2a78d6', youtube: '#e34948', shopee: '#eb6834', facebook: '#6250d6', website: '#1baf7a', other: '#8a8f99' };
  const FORMATS = ['Reels', 'Video TikTok', 'Carousel', 'Feed foto', 'Story', 'Live', 'YouTube Shorts', 'Video panjang', 'Artikel'];
  const PILLARS = ['Edukasi', 'Produk', 'Promo', 'Event', 'Komunitas', 'UGC / testimoni', 'Behind the scene', 'Hiburan'];
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const eng = (c) => c.likes + c.comments + c.shares + c.saves;
  const shownDate = (c) => (c.status === 'posted' && c.postDate) || c.date;
  const late = (c) => c.dueDate && c.dueDate < today() && !['posted', 'batal'].includes(c.status);

  const st = { month: today().slice(0, 7), tab: 'board', pdfOpen: '' };
  const inMonth = (d) => (d || '').slice(0, 7) === st.month;

  // ---------- record editor (reuses the shared drawer) ----------
  B.LEDGERS.contents = {
    title: 'Konten', add: '+ Konten', ownView: true,
    fields: [
      { k: 'title', label: 'Judul / ide konten' },
      { k: 'date', label: 'Rencana tayang', type: 'date', half: 1 },
      { k: 'dueDate', label: 'Deadline draft', type: 'date', optional: 1, half: 1 },
      { k: 'platform', label: 'Platform', type: 'select', options: () => Object.entries(PLATFORM), half: 1 },
      { k: 'format', label: 'Format', half: 1, list: () => FORMATS },
      { k: 'pillar', label: 'Pilar konten', half: 1, list: () => PILLARS },
      { k: 'status', label: 'Status', type: 'select', options: () => Object.entries(STATUS), half: 1 },
      { k: 'pic', label: 'PIC (tim)', half: 1, list: () => [...new Set(B.data.contents.map((c) => c.pic).filter(Boolean))] },
      { k: 'creator', label: 'Talent / KOL', half: 1, list: () => [...new Set(B.data.contents.map((c) => c.creator).filter(Boolean))] },
      { k: 'productId', label: 'Produk yang ditampilkan', type: 'select', options: () => [['', '— tidak spesifik —'], ...B.productOptions()] },
      { k: 'hook', label: 'Hook / caption singkat', type: 'area', rows: 2 },
      { k: 'brief', label: 'Brief / script', type: 'area', rows: 4 },
      { k: 'assetUrl', label: 'Link aset (Drive / Canva)', half: 1 },
      { k: 'postUrl', label: 'Link konten yang sudah tayang', half: 1 },
      { k: 'postDate', label: 'Tanggal tayang', type: 'date', optional: 1, half: 1 },
      { k: 'cost', label: 'Biaya produksi', type: 'number', step: 1000, half: 1 },
      { k: 'views', label: 'Views', type: 'number', half: 1 },
      { k: 'reach', label: 'Reach', type: 'number', half: 1 },
      { k: 'likes', label: 'Likes', type: 'number', half: 1 },
      { k: 'comments', label: 'Komentar', type: 'number', half: 1 },
      { k: 'shares', label: 'Share', type: 'number', half: 1 },
      { k: 'saves', label: 'Save', type: 'number', half: 1 },
      { k: 'note', label: 'Catatan' },
    ],
    onChange(f, k) {
      if (k === 'status' && f.status.value === 'posted' && !f.postDate.value) f.postDate.value = today();
    },
    summary: (f) => {
      const v = Number(f.views.value) || 0;
      const e = ['likes', 'comments', 'shares', 'saves'].reduce((s, k) => s + (Number(f[k].value) || 0), 0);
      return `Engagement ${num(e)} · ER ${pct(v ? e / v : NaN)}`;
    },
    columns: [], filters: [], csv: [],
  };
  const openContent = (i, preset = {}) => {
    B.openRecord('contents', i);
    if (i < 0) {
      const f = $('#recEditor').elements;
      f.date.value = preset.date || (inMonth(today()) ? today() : `${st.month}-01`);
      f.status.value = preset.status || 'ide';
      if (preset.planId) f.note.value = '';
    }
  };

  // ---------- render ----------
  function render() {
    const v = $('#view-konten');
    const all = B.data.contents;
    const month = all.filter((c) => inMonth(shownDate(c)) && c.status !== 'batal');
    const posted = all.filter((c) => c.status === 'posted' && inMonth(c.postDate || c.date));
    const plans = B.data.contentplans.filter((p) => p.month === st.month);
    const target = plans.reduce((s, p) => s + p.target, 0);
    const views = posted.reduce((s, c) => s + c.views, 0);
    const engagement = posted.reduce((s, c) => s + eng(c), 0);
    const lateN = all.filter(late).length;
    const [y, m] = st.month.split('-').map(Number);

    v.innerHTML = `
      <header class="bar">
        <div><h1>Konten</h1><p class="muted">Content plan, produksi, jadwal tayang, dan link konten.</p></div>
        <input type="month" class="field" id="kMonth" value="${st.month}" aria-label="Bulan">
        <button class="btn primary" type="button" id="kAdd">+ Konten</button>
      </header>
      <div class="sum-cards">
        <div class="sum-card solid"><div class="k-label">Tayang ${MONTHS[m - 1]}</div><div class="k-value">${num(posted.length)}${target ? ` / ${num(target)}` : ''}</div>
          ${target ? `<div class="track" style="margin-top:8px"><i style="width:${Math.min(100, (posted.length / target) * 100)}%"></i></div><div class="k-sub">${pct(posted.length / target)} dari target</div>` : '<div class="k-sub">target belum diisi di content plan</div>'}</div>
        <div class="sum-card solid"><div class="k-label">Direncanakan bulan ini</div><div class="k-value">${num(month.length)}</div><div class="k-sub">${num(month.filter((c) => c.status !== 'posted').length)} belum tayang</div></div>
        <div class="sum-card solid"><div class="k-label">Telat deadline</div><div class="k-value" style="color:${lateN ? 'var(--danger)' : 'inherit'}">${num(lateN)}</div><div class="k-sub">semua bulan</div></div>
        <div class="sum-card solid"><div class="k-label">Views konten tayang</div><div class="k-value">${compact(views)}</div><div class="k-sub">engagement ${compact(engagement)} · ER ${pct(views ? engagement / views : NaN)}</div></div>
      </div>
      <section class="panel solid" style="margin-bottom:14px">
        <div class="panel-head"><h2>Content plan ${MONTHS[m - 1]} ${y}</h2>
          <label class="btn sm primary">⬆ Upload PDF content plan<input type="file" id="kPdf" accept="application/pdf,.pdf" hidden></label></div>
        <div class="plan-list">${plans.map((p) => `
          <div class="plan-row">
            <span class="plan-ic">PDF</span>
            <div class="plan-meta"><b>${esc(p.title || p.fileName || 'Content plan')}</b><span class="muted small">${esc(p.fileName)} · diupload ${fmtDate(p.date)}${p.uploadedBy ? ` oleh ${esc(p.uploadedBy)}` : ''}${p.note ? ` · ${esc(p.note)}` : ''}</span></div>
            <label class="plan-target">Target<input type="number" min="0" value="${p.target}" data-target="${esc(p.id)}"></label>
            <button class="btn sm" type="button" data-view-pdf="${esc(p.id)}">${st.pdfOpen === p.id ? 'Tutup' : 'Lihat'}</button>
            <a class="btn sm" href="${esc(p.file)}" target="_blank" rel="noopener">↗</a>
            <button class="btn sm" type="button" data-extract="${esc(p.id)}">Ambil daftar konten</button>
            <button class="icon" type="button" data-del-plan="${esc(p.id)}" title="Hapus">✕</button>
          </div>
          ${st.pdfOpen === p.id ? `<iframe class="pdf-frame" src="${esc(p.file)}#view=FitH" title="${esc(p.title)}"></iframe>` : ''}`).join('') || '<p class="muted">Belum ada content plan untuk bulan ini. Upload PDF-nya, lalu isi target jumlah konten.</p>'}</div>
        <div id="kExtract"></div>
      </section>
      <div class="seg glass" style="margin-bottom:12px">${[['board', 'Board'], ['calendar', 'Kalender'], ['links', 'Link konten'], ['recap', 'Rekap']].map(([k, l]) => `<button type="button" data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="kBody"></div>`;

    $('#kMonth').addEventListener('change', (e) => { if (e.target.value) { st.month = e.target.value; render(); } });
    $('#kAdd').addEventListener('click', () => openContent(-1));
    $$('[data-tab]', v).forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; render(); }));
    $('#kPdf').addEventListener('change', (e) => { uploadPlan(e.target.files[0]); e.target.value = ''; });
    $$('[data-target]', v).forEach((inp) => inp.addEventListener('change', () => {
      const p = B.data.contentplans.find((x) => x.id === inp.dataset.target);
      p.target = Number(inp.value) || 0;
      B.save('contentplans', 'Target disimpan');
    }));
    $$('[data-view-pdf]', v).forEach((b) => b.addEventListener('click', () => { st.pdfOpen = st.pdfOpen === b.dataset.viewPdf ? '' : b.dataset.viewPdf; render(); }));
    $$('[data-del-plan]', v).forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Hapus content plan ini? Konten yang sudah dibuat tidak ikut terhapus.')) return;
      B.data.contentplans = B.data.contentplans.filter((p) => p.id !== b.dataset.delPlan);
      B.save('contentplans', 'Content plan dihapus');
    }));
    $$('[data-extract]', v).forEach((b) => b.addEventListener('click', () => extract(B.data.contentplans.find((p) => p.id === b.dataset.extract))));

    ({ board: renderBoard, calendar: renderCalendar, links: renderLinks, recap: renderRecap })[st.tab](month, posted);
  }

  const card = (c) => {
    const i = B.data.contents.indexOf(c);
    return `<article class="k-card solid${late(c) ? ' late' : ''}" draggable="true" data-i="${i}">
      <span class="k-plat" style="--pc:${PCOLOR[c.platform]}">${PLATFORM[c.platform]}${c.format ? ` · ${esc(c.format)}` : ''}</span>
      <b>${esc(c.title)}</b>
      <span class="muted small">${fmtDay(shownDate(c))}${c.pic ? ` · ${esc(c.pic)}` : ''}${late(c) ? ' · <b style="color:var(--danger)">telat</b>' : ''}</span>
      ${c.postUrl ? `<a class="small" href="${esc(c.postUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Lihat konten ↗</a>` : ''}
    </article>`;
  };

  function renderBoard(month) {
    const body = $('#kBody');
    body.innerHTML = `<div class="k-board">${FLOW.map((s) => {
      const items = month.filter((c) => c.status === s).sort((a, b) => shownDate(a).localeCompare(shownDate(b)));
      return `<section class="k-col" data-status="${s}"><header><b>${STATUS[s]}</b><span class="badge">${items.length}</span></header>
        <div class="k-drop">${items.map(card).join('')}</div>
        <button class="k-add" type="button" data-add="${s}">+ tambah</button></section>`;
    }).join('')}</div>`;
    wireCards(body);
    $$('[data-add]', body).forEach((b) => b.addEventListener('click', () => openContent(-1, { status: b.dataset.add })));
    // drag a card to another column to change its status
    $$('.k-col', body).forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('over');
        const c = B.data.contents[Number(e.dataTransfer.getData('text/plain'))];
        if (!c || c.status === col.dataset.status) return;
        c.status = col.dataset.status;
        if (c.status === 'posted' && !c.postDate) c.postDate = today();
        B.save('contents', `Status: ${STATUS[c.status]}`);
      });
    });
  }
  function wireCards(root) {
    $$('.k-card', root).forEach((el) => {
      el.addEventListener('click', () => openContent(Number(el.dataset.i)));
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', el.dataset.i); el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });
  }

  function renderCalendar(month) {
    const [y, m] = st.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="k-day empty"></div>');
    for (let d = 1; d <= days; d++) {
      const iso = `${st.month}-${String(d).padStart(2, '0')}`;
      const items = month.filter((c) => shownDate(c) === iso);
      cells.push(`<div class="k-day${iso === today() ? ' now' : ''}" data-day="${iso}"><span class="k-dn">${d}</span>
        ${items.map((c) => `<button type="button" class="k-chip${c.status === 'posted' ? ' done' : ''}" style="--pc:${PCOLOR[c.platform]}" data-i="${B.data.contents.indexOf(c)}" title="${esc(`${STATUS[c.status]} · ${c.title}`)}">${esc(c.title)}</button>`).join('')}</div>`);
    }
    $('#kBody').innerHTML = `<div class="k-cal solid">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => `<div class="k-wd">${d}</div>`).join('')}${cells.join('')}</div>
      <p class="muted small">Klik tanggal kosong untuk menambah konten. Warna = platform; konten yang sudah tayang tampil tebal.</p>`;
    $$('.k-chip', $('#kBody')).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); openContent(Number(b.dataset.i)); }));
    $$('.k-day[data-day]', $('#kBody')).forEach((d) => d.addEventListener('click', () => openContent(-1, { date: d.dataset.day })));
  }

  function renderLinks(_, posted) {
    const rows = [...posted].sort((a, b) => (b.postDate || b.date).localeCompare(a.postDate || a.date));
    $('#kBody').innerHTML = `
      <div class="filters-row"><span class="muted small">${num(rows.length)} konten tayang di bulan ini</span><span class="spacer"></span>
        <button class="btn sm" type="button" id="kCopy">Salin semua link</button><button class="btn sm" type="button" id="kCsv">⬇ Export CSV</button></div>
      <div class="table-wrap solid"><table class="data">
        <thead><tr><th>Tayang</th><th>Platform</th><th>Judul</th><th>PIC / talent</th><th>Link</th><th class="num">Views</th><th class="num">Engagement</th><th class="num">ER</th></tr></thead>
        <tbody>${rows.map((c) => `<tr class="click" data-i="${B.data.contents.indexOf(c)}"><td>${fmtDate(c.postDate || c.date)}</td>
          <td><span class="ch"><i style="background:${PCOLOR[c.platform]}"></i>${PLATFORM[c.platform]}</span></td><td>${esc(c.title)}</td>
          <td>${esc([c.pic, c.creator].filter(Boolean).join(' · ') || '–')}</td>
          <td>${c.postUrl ? `<a href="${esc(c.postUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(c.postUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 38))}…</a>` : '<span class="badge warn">link belum diisi</span>'}</td>
          <td class="num">${num(c.views)}</td><td class="num">${num(eng(c))}</td><td class="num">${pct(c.views ? eng(c) / c.views : NaN)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">Belum ada konten yang tayang bulan ini.</td></tr>'}</tbody>
      </table></div>`;
    $$('tr.click', $('#kBody')).forEach((tr) => tr.addEventListener('click', () => openContent(Number(tr.dataset.i))));
    $('#kCopy').addEventListener('click', async () => {
      const text = rows.filter((c) => c.postUrl).map((c) => `${fmtDate(c.postDate || c.date)} · ${PLATFORM[c.platform]} · ${c.title}\n${c.postUrl}`).join('\n\n');
      try { await navigator.clipboard.writeText(text); toast('Link disalin'); } catch { toast('Tidak bisa menyalin', true); }
    });
    $('#kCsv').addEventListener('click', () => {
      const head = ['postDate', 'platform', 'format', 'pillar', 'title', 'pic', 'creator', 'postUrl', 'views', 'reach', 'likes', 'comments', 'shares', 'saves'];
      window.A.download(`ballop-konten-${st.month}.csv`, new Blob([`﻿${B.toCsv([head, ...rows.map((c) => head.map((k) => c[k]))])}`], { type: 'text/csv' }));
    });
  }

  function renderRecap(month, posted) {
    const group = (key, labels) => {
      const g = {};
      month.forEach((c) => { const k = c[key] || '(kosong)'; g[k] = g[k] || { plan: 0, posted: 0, views: 0 }; g[k].plan++; });
      posted.forEach((c) => { const k = c[key] || '(kosong)'; g[k] = g[k] || { plan: 0, posted: 0, views: 0 }; g[k].posted++; g[k].views += c.views; });
      const rows = Object.entries(g).sort((a, b) => b[1].plan - a[1].plan);
      const max = Math.max(1, ...rows.map(([, x]) => x.plan));
      return rows.map(([k, x]) => `<div class="hbar-row"><span class="hb-name">${esc(labels ? labels[k] || k : k)}</span><span class="hb-track"><i style="width:${(x.posted / max) * 100}%;background:${key === 'platform' ? PCOLOR[k] || '#8a8f99' : '#2a78d6'}"></i></span><span class="hb-val">${x.posted}/${x.plan} · ${compact(x.views)} views</span></div>`).join('') || '<p class="muted">–</p>';
    };
    const top = [...posted].sort((a, b) => b.views - a.views).slice(0, 5);
    const people = {};
    month.forEach((c) => { if (c.pic) { people[c.pic] = people[c.pic] || { all: 0, done: 0 }; people[c.pic].all++; if (c.status === 'posted') people[c.pic].done++; } });
    $('#kBody').innerHTML = `
      <div class="grid-2" style="margin-top:0">
        <section class="panel solid"><div class="panel-head"><h2>Per platform</h2><span class="muted small">tayang / rencana</span></div><div class="hbar">${group('platform', PLATFORM)}</div></section>
        <section class="panel solid"><div class="panel-head"><h2>Per pilar konten</h2><span class="muted small">tayang / rencana</span></div><div class="hbar">${group('pillar')}</div></section>
        <section class="panel solid"><div class="panel-head"><h2>Konten terbaik</h2><span class="muted small">views</span></div>
          <div class="alert-list">${top.map((c) => `<div><span>${esc(c.title)} <span class="muted small">· ${PLATFORM[c.platform]}</span></span><b>${compact(c.views)}</b></div>`).join('') || '<p class="muted">Belum ada data views.</p>'}</div></section>
        <section class="panel solid"><div class="panel-head"><h2>Per PIC</h2><span class="muted small">selesai / dipegang</span></div>
          <div class="alert-list">${Object.entries(people).map(([p, x]) => `<div><span>${esc(p)}</span><b>${x.done} / ${x.all}</b></div>`).join('') || '<p class="muted">PIC belum diisi.</p>'}</div></section>
      </div>`;
  }

  // ---------- PDF content plan ----------
  async function uploadPlan(file) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { toast('Pilih file PDF', true); return; }
    try {
      toast('Mengupload PDF…');
      const target = await api('/api/upload-url', json('POST', { type: 'application/pdf' }));
      let url;
      if (target.mode === 'signed') {
        const res = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: file });
        if (!res.ok) throw new Error(`Upload gagal (${res.status})`);
        url = target.publicUrl;
      } else {
        url = (await api('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file })).url;
      }
      const [y, m] = st.month.split('-').map(Number);
      const plan = { id: '', month: st.month, title: `Content plan ${MONTHS[m - 1]} ${y}`, file: url, fileName: file.name, target: 0, note: '', uploadedBy: window.A.me?.user?.name || '', date: today() };
      B.data.contentplans.push(plan);
      await B.save('contentplans', 'Content plan diupload. Isi target, lalu "Ambil daftar konten".');
    } catch (e) { toast(e.message, true); }
  }

  // read the PDF text with pdf.js and turn lines into suggested content items
  let pdfjs = null;
  async function loadPdfJs() {
    if (pdfjs) return pdfjs;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Gagal memuat pembaca PDF'));
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    pdfjs = window.pdfjsLib;
    return pdfjs;
  }
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, aug: 8, ags: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
  function guess(line) {
    const [y] = st.month.split('-').map(Number);
    let date = '';
    let t = line;
    // use whichever date appears first in the line ("12 Okt ... 10.10" -> 12 Oct)
    const num = line.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
    const word = line.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\b/);
    const numOk = num && Number(num[2]) >= 1 && Number(num[2]) <= 12;
    const wordOk = word && MON[word[2].toLowerCase()];
    if (wordOk && (!numOk || word.index < num.index)) {
      date = `${y}-${String(MON[word[2].toLowerCase()]).padStart(2, '0')}-${String(word[1]).padStart(2, '0')}`;
      t = t.replace(word[0], '');
    } else if (numOk) {
      date = `${num[3] ? (num[3].length === 2 ? `20${num[3]}` : num[3]) : y}-${String(num[2]).padStart(2, '0')}-${String(num[1]).padStart(2, '0')}`;
      t = t.replace(num[0], '');
    }
    const l = line.toLowerCase();
    const platform = /tiktok|tik tok/.test(l) ? 'tiktok' : /youtube|shorts/.test(l) ? 'youtube' : /shopee/.test(l) ? 'shopee' : /facebook|fb\b/.test(l) ? 'facebook' : /instagram|\big\b|reels|feed|story|carousel/.test(l) ? 'instagram' : 'instagram';
    const format = /carousel/.test(l) ? 'Carousel' : /reels?/.test(l) ? 'Reels' : /story/.test(l) ? 'Story' : /live/.test(l) ? 'Live' : /shorts/.test(l) ? 'YouTube Shorts' : /tiktok|video/.test(l) ? 'Video TikTok' : /feed|foto|photo/.test(l) ? 'Feed foto' : '';
    const pillar = PILLARS.find((p) => l.includes(p.toLowerCase().split(' ')[0])) || '';
    const title = t.replace(/^(senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|mon|tue|wed|thu|fri|sat|sun)[a-z]*,?/i, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–|•:.]+|[\s\-–|•:.]+$/g, '');
    const valid = date && date.slice(0, 7) === st.month && date.slice(8) >= '01' && date.slice(8) <= '31';
    return { date: valid ? date : '', title: title.slice(0, 160), platform, format, pillar, pick: !!valid && title.length > 3 };
  }
  async function extract(plan) {
    const box = $('#kExtract');
    box.innerHTML = '<p class="muted">Membaca PDF…</p>';
    try {
      const lib = await loadPdfJs();
      const doc = await lib.getDocument({ url: plan.file }).promise;
      const lines = [];
      for (let p = 1; p <= Math.min(doc.numPages, 40); p++) {
        const tc = await (await doc.getPage(p)).getTextContent();
        // group text pieces into lines by their vertical position
        const rows = new Map();
        tc.items.forEach((it) => { const yk = Math.round(it.transform[5] / 3); rows.set(yk, [...(rows.get(yk) || []), it]); });
        [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => {
          const s = its.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
          if (s.length > 3) lines.push(s);
        });
      }
      const sug = lines.map(guess);
      if (!sug.length) { box.innerHTML = '<p class="muted">Tidak ada teks di PDF (mungkin hasil scan / gambar). Tambah konten manual.</p>'; return; }
      box.innerHTML = `
        <div class="panel-head" style="margin-top:14px"><h2>Daftar konten dari PDF</h2><span class="muted small">${sug.filter((s) => s.pick).length} baris bertanggal dicentang otomatis. Periksa & ubah sebelum dibuat.</span></div>
        <div class="table-wrap"><table class="data extract">
          <thead><tr><th></th><th>Tanggal</th><th>Judul</th><th>Platform</th><th>Format</th><th>Pilar</th></tr></thead>
          <tbody>${sug.map((s, i) => `<tr data-i="${i}"><td><input type="checkbox"${s.pick ? ' checked' : ''}></td>
            <td><input type="date" value="${s.date}"></td><td><input value="${esc(s.title)}" style="min-width:260px"></td>
            <td><select>${Object.entries(PLATFORM).map(([k, l]) => `<option value="${k}"${k === s.platform ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
            <td><input value="${esc(s.format)}" list="kFormats"></td><td><input value="${esc(s.pillar)}" list="kPillars"></td></tr>`).join('')}</tbody>
        </table></div>
        <datalist id="kFormats">${FORMATS.map((f) => `<option value="${f}">`).join('')}</datalist><datalist id="kPillars">${PILLARS.map((f) => `<option value="${f}">`).join('')}</datalist>
        <div class="filters-row" style="margin-top:10px"><span class="spacer"></span><button class="btn sm" type="button" id="kxCancel">Tutup</button>
          <button class="btn sm primary" type="button" id="kxGo">Buat konten yang dicentang</button></div>`;
      $('#kxCancel').addEventListener('click', () => { box.innerHTML = ''; });
      $('#kxGo').addEventListener('click', async () => {
        const make = $$('tbody tr', box).filter((tr) => $('input[type=checkbox]', tr).checked).map((tr) => {
          const [, d, t, , f, pl] = $$('input, select', tr);
          return { id: '', date: d.value || `${st.month}-01`, title: t.value, platform: $('select', tr).value, format: f.value, pillar: pl.value, status: 'ide', planId: plan.id };
        }).filter((c) => c.title);
        if (!make.length) { toast('Centang minimal 1 baris', true); return; }
        B.data.contents.push(...make);
        if (!plan.target) plan.target = make.length;
        await B.save('contentplans');
        await B.save('contents', `${make.length} konten dibuat dari PDF`);
        box.innerHTML = '';
      });
    } catch (e) { box.innerHTML = ''; toast(e.message, true); }
  }

  B.registerView('konten', render);
})();
