// BALLOP admin, website copy: the page-content editor (every text on the landing page) and the journal (blog).
(() => {
  const { $, $$, api, json, toast } = window.A;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- content schema: what the editor shows, in page order ----------
  // field: [key, label, type?, extra?]  type: text | area | image | list | array | number | check
  const SCHEMA = [
    { key: 'hero', title: 'Hero (paling atas)', anchor: '#top', fields: [
      ['pill', 'Label kecil'], ['title', 'Judul besar', 'area'], ['lead', 'Deskripsi', 'area'],
      ['cta1', 'Tombol 1 (ke koleksi)'], ['cta2', 'Tombol 2 (ke event)'], ['image', 'Foto sepatu hero', 'image'],
    ] },
    { key: 'marquee', title: 'Teks berjalan', anchor: '#story', fields: [['items', 'Kalimat (satu per baris)', 'list']] },
    { key: 'story', title: 'Brand story', anchor: '#story', fields: [
      ['eyebrow', 'Label section'], ['word1', 'Kata 1'], ['word2', 'Kata 2'], ['word3', 'Hasil gabungan'],
      ['p1', 'Paragraf 1 (pakai **tebal**)', 'area'], ['p2', 'Paragraf 2', 'area'],
      ['stats', 'Angka', 'array', { fields: [['value', 'Angka', 'number'], ['suffix', 'Akhiran (K, %, +)'], ['label', 'Keterangan'], ['plain', 'Tanpa titik ribuan (tahun)', 'check']], blank: { value: 0, suffix: '', label: '', plain: false } }],
      ['timeline', 'Timeline', 'array', { fields: [['year', 'Tahun'], ['text', 'Keterangan']], blank: { year: '', text: '' } }],
    ] },
    { key: 'catalog', title: 'Koleksi', anchor: '#koleksi', fields: [['eyebrow', 'Label section'], ['title', 'Judul', 'area'], ['hint', 'Petunjuk'], ['all', 'Label filter "semua"']] },
    { key: 'tech', title: 'Teknologi', anchor: '#teknologi', fields: [
      ['eyebrow', 'Label section'], ['title', 'Judul', 'area'], ['image', 'Foto sepatu', 'image'],
      ['features', 'Fitur + titik di foto', 'array', { fields: [['title', 'Nama fitur'], ['text', 'Penjelasan', 'area'], ['x', 'Posisi titik X (% dari kiri)', 'number'], ['y', 'Posisi titik Y (% dari atas)', 'number']], blank: { title: '', text: '', x: 50, y: 50 } }],
    ] },
    { key: 'events', title: 'Event', anchor: '#event', fields: [
      ['eyebrow', 'Label section'], ['title', 'Judul', 'area'], ['sub', 'Deskripsi', 'area'], ['more', 'Tombol detail'],
      ['upcoming', 'Label event akan datang'], ['done', 'Label event selesai'], ['info', 'Tombol link event'], ['empty', 'Teks kalau kosong'],
    ] },
    { key: 'gallery', title: 'Galeri', anchor: '#galeri', fields: [['eyebrow', 'Label section'], ['title', 'Judul', 'area'], ['all', 'Label filter "semua"'], ['empty', 'Teks kalau kosong']] },
    { key: 'blog', title: 'Jurnal / blog', anchor: '#jurnal', fields: [
      ['eyebrow', 'Label section'], ['title', 'Judul di halaman depan', 'area'], ['sub', 'Deskripsi', 'area'], ['more', 'Tombol semua artikel'], ['read', 'Tombol baca'],
      ['pageTitle', 'Judul halaman /blog'], ['pageSub', 'Deskripsi halaman /blog', 'area'], ['search', 'Placeholder pencarian'],
      ['related', 'Judul artikel lainnya'], ['back', 'Tombol kembali'], ['share', 'Label bagikan'], ['empty', 'Teks kalau kosong'],
    ] },
    { key: 'cta', title: 'Beli di mana', anchor: '#toko', fields: [['eyebrow', 'Label section'], ['title', 'Judul', 'area'], ['sub', 'Deskripsi', 'area'], ['giant', 'Teks raksasa latar']] },
    { key: 'sku', title: 'Halaman detail produk', anchor: '#koleksi', fields: [
      ['back', 'Tombol kembali'], ['addCart', 'Tombol keranjang'], ['buyNow', 'Tombol beli'], ['pickSize', 'Pesan pilih ukuran'],
      ['added', 'Pesan masuk keranjang'], ['noLink', 'Pesan link beli kosong'], ['cartEmpty', 'Pesan keranjang kosong'], ['cartCount', 'Teks jumlah keranjang'],
    ] },
    { key: 'nav', title: 'Menu navigasi', anchor: '#top', fields: [['story', 'Story'], ['koleksi', 'Koleksi'], ['teknologi', 'Teknologi'], ['event', 'Event'], ['galeri', 'Galeri'], ['blog', 'Jurnal'], ['toko', 'Toko']] },
    { key: 'footer', title: 'Footer', anchor: '#toko', fields: [['line', 'Kalimat footer'], ['copyright', 'Nama di copyright']] },
    { key: 'seo', title: 'SEO (Google & share link)', anchor: '#top', fields: [['title', 'Judul tab / Google'], ['description', 'Deskripsi Google', 'area']] },
  ];

  let content = {};
  let dirty = false;
  let built = false;

  function field(path, label, type, extra, value) {
    const id = `ce-${path.replace(/\W/g, '-')}`;
    if (type === 'area') return `<label for="${id}">${label}<textarea id="${id}" data-p="${path}" rows="3">${esc(value)}</textarea></label>`;
    if (type === 'number') return `<label for="${id}">${label}<input id="${id}" type="number" data-p="${path}" data-num="1" value="${esc(value ?? 0)}"></label>`;
    if (type === 'check') return `<label class="check"><input type="checkbox" data-p="${path}" data-bool="1"${value ? ' checked' : ''}> ${label}</label>`;
    if (type === 'list') return `<label for="${id}">${label}<textarea id="${id}" data-p="${path}" data-list="1" rows="4">${esc((value || []).join('\n'))}</textarea></label>`;
    if (type === 'image') {
      return `<div class="ce-img"><img src="${esc(value || '/img/ballop-mark-dark.png')}" alt="" data-preview="${path}">
        <div><p class="muted small" style="margin:0 0 6px">${label}</p><label class="btn sm">Ganti foto<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" data-upload="${path}" hidden></label>
        <input type="hidden" data-p="${path}" value="${esc(value || '')}"></div></div>`;
    }
    if (type === 'array') {
      const items = value || [];
      return `<div class="ce-arr-wrap"><p class="muted small" style="margin:0 0 6px;font-weight:700">${label}</p><div class="ce-arr" data-arr="${path}">${items.map((it, i) => `
        <div class="ce-arr-item">
          ${extra.fields.map(([k, l, t]) => field(`${path}.${i}.${k}`, l, t, null, it[k])).join('')}
          <div class="ce-arr-tools"><button type="button" data-up="${path}" data-i="${i}" title="Naik">↑</button><button type="button" data-down="${path}" data-i="${i}" title="Turun">↓</button><button type="button" data-del="${path}" data-i="${i}" title="Hapus">✕</button></div>
        </div>`).join('')}</div><button class="btn sm" type="button" data-add="${path}" style="margin-top:8px">+ Tambah</button></div>`;
    }
    return `<label for="${id}">${label}<input id="${id}" type="text" data-p="${path}" value="${esc(value)}"></label>`;
  }

  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  function setPath(obj, path, v) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k, i) => { if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {}; o = o[k]; });
    o[keys[keys.length - 1]] = v;
  }
  const schemaArray = (path) => {
    const [sec, key] = path.split('.');
    return SCHEMA.find((s) => s.key === sec).fields.find((f) => f[0] === key)[3];
  };

  function renderContent() {
    const v = $('#view-content');
    v.innerHTML = `
      <header class="bar"><div><h1>Konten halaman</h1><p class="muted">Semua teks di halaman depan. Baris baru di judul = pindah baris di website.</p></div>
        <a class="btn" href="/" target="_blank" rel="noopener">Lihat website ↗</a></header>
      <div class="ce-layout">
        <nav class="ce-nav glass">${SCHEMA.map((s, i) => `<button type="button" data-jump="${s.key}" class="${i ? '' : 'on'}">${esc(s.title)}</button>`).join('')}</nav>
        <div>
          <div class="ce-sections">${SCHEMA.map((s) => `
            <section class="ce-section solid" id="ce-${s.key}">
              <h2>${esc(s.title)}<a href="/${s.anchor}" target="_blank" rel="noopener">lihat ↗</a></h2>
              <div class="ce-fields">${s.fields.map(([k, l, t, x]) => field(`${s.key}.${k}`, l, t || 'text', x, getPath(content, `${s.key}.${k}`))).join('')}</div>
            </section>`).join('')}</div>
          <div class="savebar glass"><p class="muted" id="ceState">${dirty ? '<span class="dirty-dot"></span> Ada perubahan belum disimpan' : 'Semua tersimpan'}</p>
            <button class="btn" type="button" id="ceReset">Batalkan perubahan</button><button class="btn primary" type="button" id="ceSave">Simpan konten</button></div>
        </div>
      </div>`;
    built = true;
    wireContent(v);
  }

  function markDirty() {
    dirty = true;
    $('#ceState').innerHTML = '<span class="dirty-dot"></span> Ada perubahan belum disimpan';
  }
  function wireContent(v) {
    v.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.dataset.p) return;
      let val = el.value;
      if (el.dataset.num) val = Number(val) || 0;
      if (el.dataset.bool) val = el.checked;
      if (el.dataset.list) val = el.value.split('\n').map((x) => x.trim()).filter(Boolean);
      setPath(content, el.dataset.p, val);
      markDirty();
    });
    v.addEventListener('change', async (e) => {
      const el = e.target;
      if (el.dataset.bool) { setPath(content, el.dataset.p, el.checked); markDirty(); }
      if (el.dataset.upload && el.files[0]) {
        try {
          const [url] = await window.A.uploadFiles(el.files);
          setPath(content, el.dataset.upload, url);
          $(`[data-preview="${el.dataset.upload}"]`, v).src = url;
          $(`input[type=hidden][data-p="${el.dataset.upload}"]`, v).value = url;
          markDirty();
        } catch (err) { toast(err.message, true); }
      }
    });
    v.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const path = b.dataset.add || b.dataset.del || b.dataset.up || b.dataset.down;
      if (b.dataset.jump) {
        $$('.ce-nav button', v).forEach((x) => x.classList.toggle('on', x === b));
        $(`#ce-${b.dataset.jump}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (!path) return;
      const arr = getPath(content, path) || [];
      const i = Number(b.dataset.i);
      if (b.dataset.add) arr.push(structuredClone(schemaArray(path).blank));
      if (b.dataset.del) arr.splice(i, 1);
      if (b.dataset.up && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      if (b.dataset.down && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      setPath(content, path, arr);
      markDirty();
      const y = scrollY;
      renderContent();
      scrollTo({ top: y });
    });
    $('#ceSave', v).addEventListener('click', async () => {
      try {
        content = await api('/api/content', json('PUT', content));
        dirty = false;
        $('#ceState').textContent = 'Semua tersimpan';
        toast('Konten disimpan. Refresh website untuk melihat.');
      } catch (err) { toast(err.message, true); }
    });
    $('#ceReset', v).addEventListener('click', async () => {
      if (dirty && !confirm('Buang semua perubahan yang belum disimpan?')) return;
      content = await api('/api/content');
      dirty = false;
      renderContent();
    });
  }
  addEventListener('beforeunload', (e) => { if (dirty || peDirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- journal ----------
  let posts = [];
  let pIndex = -1;
  let pWorking = null;
  let peDirty = false;
  const pForm = $('#postForm');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const fmtDate = (iso) => { const [y, m, d] = (iso || '').split('-').map(Number); return y ? `${d} ${MONTHS[m - 1]} ${y}` : ''; };
  const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

  function renderPosts() {
    const v = $('#view-posts');
    const sorted = posts.map((p, i) => ({ p, i })).sort((a, b) => b.p.date.localeCompare(a.p.date));
    v.innerHTML = `
      <header class="bar"><div><h1>Jurnal</h1><p class="muted">${posts.length} artikel · ${posts.filter((p) => p.published).length} terbit. Artikel unggulan tampil besar di halaman depan.</p></div>
        <a class="btn" href="/blog" target="_blank" rel="noopener">Lihat jurnal ↗</a>
        <button class="btn primary" id="addPost" type="button">+ Tulis artikel</button></header>
      <ul class="list">${sorted.map(({ p, i }) => `
        <li class="item ev-row${p.published ? '' : ' off'}" data-i="${i}">
          <div class="thumb">${p.cover ? `<img src="${esc(p.cover)}" alt="" class="${window.A.isPng(p.cover) ? 'contain' : ''}">` : ''}</div>
          <div class="meta"><b>${esc(p.title)}</b><span>${esc(fmtDate(p.date))}${p.tags.length ? ` · ${esc(p.tags.join(', '))}` : ''}${p.featured ? ' · ★ unggulan' : ''}</span></div>
          <span class="badge ${p.published ? 'live' : ''}">${p.published ? 'TERBIT' : 'DRAF'}</span>
          <button class="toggle${p.published ? ' on' : ''}" type="button" data-pub="${i}" title="Terbit / draf" aria-pressed="${p.published}"></button>
          <div class="row-actions"><button class="icon" type="button" data-edit="${i}" title="Edit">✎</button><a class="icon" href="/blog/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener" title="Buka">↗</a></div>
        </li>`).join('') || '<li class="empty">Belum ada artikel. Klik “+ Tulis artikel”.</li>'}</ul>`;
    $('#addPost', v).addEventListener('click', () => openPost(-1));
    $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => openPost(Number(b.dataset.edit))));
    $$('.item[data-i]', v).forEach((li) => li.addEventListener('dblclick', () => openPost(Number(li.dataset.i))));
    $$('[data-pub]', v).forEach((b) => b.addEventListener('click', async () => {
      const p = posts[Number(b.dataset.pub)];
      p.published = !p.published;
      await savePosts(p.published ? 'Artikel diterbitkan' : 'Artikel jadi draf');
    }));
  }

  async function savePosts(msg) {
    try {
      posts = await api('/api/posts', json('PUT', posts));
      renderPosts();
      if (msg) toast(msg);
    } catch (e) { toast(e.message, true); }
  }

  function openPost(i) {
    pIndex = i;
    pWorking = structuredClone(i >= 0 ? posts[i] : {
      id: '', slug: '', title: '', excerpt: '', cover: '', body: '', tags: [], author: window.A.settings.brand ? `Tim ${window.A.settings.brand}` : '',
      date: new Date().toISOString().slice(0, 10), published: false, featured: false,
    });
    const f = pForm.elements;
    ['title', 'slug', 'date', 'author', 'excerpt', 'body'].forEach((k) => { f[k].value = pWorking[k] || ''; });
    f.tags.value = (pWorking.tags || []).join(', ');
    f.published.checked = pWorking.published;
    f.featured.checked = pWorking.featured;
    $('#peTitle').textContent = i >= 0 ? 'Edit artikel' : 'Artikel baru';
    $('#postDelete').hidden = i < 0;
    renderCover();
    preview();
    peDirty = false;
    $('#postEditor').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => f.title.focus(), 50);
  }
  function closePost() {
    if (peDirty && !confirm('Tutup tanpa menyimpan?')) return;
    peDirty = false;
    $('#postEditor').hidden = true;
    document.body.style.overflow = '';
  }
  $$('[data-post-close]').forEach((b) => b.addEventListener('click', closePost));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#postEditor').hidden) closePost(); });

  function renderCover() {
    $('#peCover').innerHTML = pWorking.cover ? `<img src="${esc(pWorking.cover)}" alt="" class="${window.A.isPng(pWorking.cover) ? 'contain' : ''}">` : 'Belum ada cover';
  }
  function preview() {
    const f = pForm.elements;
    $('#pePreview').innerHTML = `<h1 style="font-size:30px;line-height:1.1;color:var(--ink);margin:0 0 10px">${esc(f.title.value || 'Judul artikel')}</h1>
      ${f.excerpt.value ? `<p style="font-size:18px">${esc(f.excerpt.value)}</p>` : ''}${window.renderMarkdown(f.body.value)}`;
    const words = f.body.value.trim() ? f.body.value.trim().split(/\s+/).length : 0;
    $('#peStats').textContent = `${words} kata · ±${Math.max(1, Math.round(words / 200))} menit baca · URL: /blog/${f.slug.value || slugify(f.title.value) || '…'}`;
  }
  pForm.addEventListener('input', () => { peDirty = true; preview(); });

  // markdown toolbar
  const ta = $('#peBody');
  function wrap(before, after = '', placeholder = 'teks') {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || placeholder;
    ta.setRangeText(before + sel + after, s, e, 'select');
    ta.selectionStart = s + before.length;
    ta.selectionEnd = s + before.length + sel.length;
    ta.focus();
    peDirty = true;
    preview();
  }
  function linePrefix(prefix) {
    const s = ta.selectionStart;
    const start = ta.value.lastIndexOf('\n', s - 1) + 1;
    ta.setRangeText(prefix, start, start, 'end');
    ta.focus();
    peDirty = true;
    preview();
  }
  $('#mdTools').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-md]');
    if (!b) return;
    const k = b.dataset.md;
    if (k === 'h2') linePrefix('## ');
    else if (k === 'h3') linePrefix('### ');
    else if (k === 'b') wrap('**', '**');
    else if (k === 'i') wrap('*', '*');
    else if (k === 'ul') linePrefix('- ');
    else if (k === 'ol') linePrefix('1. ');
    else if (k === 'q') linePrefix('> ');
    else if (k === 'hr') wrap('\n\n---\n\n', '', '');
    else if (k === 'link') { const url = prompt('Alamat link (https://…)'); if (url) wrap('[', `](${url})`, 'teks link'); }
    else if (k === 'yt') { const url = prompt('Link video YouTube'); if (url) wrap(`\n\n${url}\n\n`, '', ''); }
  });
  $('#peImgFile').addEventListener('change', async (e) => {
    try {
      const [url] = await window.A.uploadFiles(e.target.files);
      if (url) wrap(`\n\n![`, `](${url})\n\n`, 'keterangan foto');
    } catch (err) { toast(err.message, true); }
    e.target.value = '';
  });
  $('#peCoverFile').addEventListener('change', async (e) => {
    try {
      const [url] = await window.A.uploadFiles(e.target.files);
      if (url) { pWorking.cover = url; renderCover(); peDirty = true; }
    } catch (err) { toast(err.message, true); }
    e.target.value = '';
  });
  $('#peCoverClear').addEventListener('click', () => { pWorking.cover = ''; renderCover(); peDirty = true; });
  // drop an image straight into the text
  ta.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  ta.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    try {
      const urls = await window.A.uploadFiles(e.dataTransfer.files);
      urls.forEach((u) => wrap('\n\n![', `](${u})\n\n`, 'keterangan foto'));
    } catch (err) { toast(err.message, true); }
  });

  pForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = pForm.elements;
    Object.assign(pWorking, {
      title: f.title.value.trim(), slug: slugify(f.slug.value || f.title.value), date: f.date.value, author: f.author.value.trim(),
      excerpt: f.excerpt.value.trim(), body: f.body.value, tags: f.tags.value.split(',').map((x) => x.trim()).filter(Boolean),
      published: f.published.checked, featured: f.featured.checked,
    });
    if (pWorking.featured) posts.forEach((p) => { if (p !== posts[pIndex]) p.featured = false; });
    if (pIndex >= 0) posts[pIndex] = pWorking; else posts.push(pWorking);
    peDirty = false;
    await savePosts(pIndex >= 0 ? 'Artikel disimpan' : 'Artikel dibuat');
    pIndex = posts.findIndex((p) => p.slug === pWorking.slug || (pWorking.id && p.id === pWorking.id));
    if (pIndex >= 0) { pWorking = structuredClone(posts[pIndex]); f.slug.value = pWorking.slug; $('#postDelete').hidden = false; preview(); }
  });
  $('#postDelete').addEventListener('click', async () => {
    if (pIndex < 0 || !confirm(`Hapus artikel "${posts[pIndex].title}"? Tidak bisa dibatalkan.`)) return;
    posts.splice(pIndex, 1);
    peDirty = false;
    closePost();
    await savePosts('Artikel dihapus');
  });

  // ---------- wiring ----------
  document.addEventListener('admin:ready', async () => {
    try {
      [content, posts] = await Promise.all([api('/api/content'), api('/api/posts?all=1')]);
    } catch (e) { toast(e.message, true); return; }
    renderPosts();
    if (!$('#view-content').hidden) renderContent();
  });
  document.addEventListener('admin:view', (e) => {
    if (e.detail === 'content' && !built) renderContent();
    if (e.detail === 'posts') renderPosts();
  });
})();
