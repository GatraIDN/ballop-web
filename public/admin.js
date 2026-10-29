// BALLOP admin core: auth, navigation, shared helpers (window.A), products, events, gallery, settings.
// admin-biz.js (sales, stock, ads, reports) and admin-content.js (page copy, journal) plug in through window.A.
// Every change is saved to the server right away.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const store = {
    get() { try { return sessionStorage.getItem('ballop-admin') || ''; } catch { return ''; } },
    set(v) { try { v ? sessionStorage.setItem('ballop-admin', v) : sessionStorage.removeItem('ballop-admin'); } catch { /* private mode */ } },
  };
  let token = store.get();
  let products = [];
  let settings = {};
  let events = [];
  let gallery = [];
  let editing = null; // working copy of the product open in the drawer
  let editingIndex = -1;

  const money = (n) => `${settings.currency || 'Rp'} ${Number(n || 0).toLocaleString('id-ID')}`;
  const normHue = (h) => ((((Number(h) || 0) + 180) % 360) + 360) % 360 - 180;
  const hueCss = (h) => `hue-rotate(${h || 0}deg)`;
  const splitList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  function toast(text, bad = false) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.toggle('bad', bad);
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
    if (res.status === 401 && path !== '/api/login') { logout(); throw new Error('Sesi habis, login lagi'); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
    return body;
  }
  const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

  async function saveAll(msg = 'Tersimpan') {
    try {
      products = await api('/api/products', json('PUT', products));
      renderList();
      document.dispatchEvent(new CustomEvent('admin:products'));
      toast(msg);
    } catch (e) { toast(e.message, true); }
  }

  // ---------- auth ----------
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginErr').textContent = '';
    try {
      const r = await fetch('/api/login', json('POST', { password: $('#password').value }));
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Gagal login');
      token = body.token;
      store.set(token);
      boot();
    } catch (err) { $('#loginErr').textContent = err.message; }
  });

  function logout() {
    token = '';
    store.set('');
    $('#app').hidden = true;
    $('#login').hidden = false;
  }
  $('#logout').addEventListener('click', logout);

  async function boot() {
    try {
      [products, settings, events, gallery] = await Promise.all([
        api('/api/products?all=1'), api('/api/settings'), api('/api/events?all=1'), api('/api/gallery?all=1'),
      ]);
    } catch { return; }
    $('#login').hidden = true;
    $('#app').hidden = false;
    renderList();
    renderEvents();
    renderGallery();
    fillSettings();
    document.dispatchEvent(new CustomEvent('admin:ready'));
    showView((location.hash.match(/^#([a-z]+)$/) || [])[1] || 'dashboard');
  }

  // ---------- navigation ----------
  function showView(name) {
    if (!$(`#view-${name}`)) name = 'dashboard';
    $$('.nav[data-view]').forEach((x) => x.classList.toggle('on', x.dataset.view === name));
    $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
    const btn = $(`.nav[data-view="${name}"]`);
    $('#mobileTitle').textContent = btn ? btn.lastChild.textContent.trim() : '';
    history.replaceState(null, '', `#${name}`);
    document.body.classList.remove('side-open');
    scrollTo({ top: 0 });
    document.dispatchEvent(new CustomEvent('admin:view', { detail: name }));
  }
  $$('.nav[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#sideOpen').addEventListener('click', () => document.body.classList.add('side-open'));
  $('#sideClose').addEventListener('click', () => document.body.classList.remove('side-open'));

  // ---------- product list ----------
  $('#search').addEventListener('input', renderList);

  function renderList() {
    const q = $('#search').value.trim().toLowerCase();
    const list = $('#list');
    list.innerHTML = '';
    $('#count').textContent = `${products.length} produk · ${products.filter((p) => p.visible).length} tampil`;
    const shown = products.filter((p) => !q || `${p.name} ${p.series} ${p.category} ${p.sku}`.toLowerCase().includes(q));
    if (!shown.length) {
      list.innerHTML = `<li class="empty">${products.length ? 'Tidak ada yang cocok.' : 'Belum ada produk. Klik “+ Produk baru”.'}</li>`;
      return;
    }
    shown.forEach((p) => {
      const i = products.indexOf(p);
      const li = document.createElement('li');
      li.className = `item${p.visible ? '' : ' off'}`;
      li.draggable = !q;
      li.dataset.index = i;
      li.innerHTML = `
        <span class="grip" title="Seret untuk urutkan">⋮⋮</span>
        <div class="thumb"><img alt=""></div>
        <div class="meta"><b></b><span></span></div>
        <span class="price"></span>
        <button class="toggle" type="button" title="Tampil di katalog"></button>
        <div class="row-actions">
          <button class="icon" type="button" data-act="edit" title="Edit">✎</button>
          <button class="icon" type="button" data-act="dup" title="Duplikat">⧉</button>
        </div>`;
      $('.thumb', li).style.setProperty('--sw', p.color);
      const img = $('.thumb img', li);
      img.src = p.images[0] || '/img/ballop-mark-white.png';
      img.style.filter = hueCss(p.hue);
      $('.meta b', li).textContent = p.name;
      $('.meta span', li).textContent = [p.sku, p.series, p.category].filter(Boolean).join(' · ');
      $('.price', li).textContent = money(p.price);
      const tg = $('.toggle', li);
      tg.classList.toggle('on', p.visible);
      tg.setAttribute('aria-pressed', String(p.visible));
      tg.addEventListener('click', () => { p.visible = !p.visible; saveAll(p.visible ? 'Ditampilkan' : 'Disembunyikan'); });
      $('[data-act=edit]', li).addEventListener('click', () => openEditor(i));
      $('[data-act=dup]', li).addEventListener('click', () => {
        const copy = { ...structuredClone(p), id: `${p.id}-copy-${Date.now().toString(36)}`, series: `${p.series} (copy)` };
        products.splice(i + 1, 0, copy);
        saveAll('Produk diduplikat');
      });
      li.addEventListener('dblclick', () => openEditor(i));
      wireDrag(li, list, (from, to) => {
        const [moved] = products.splice(from, 1);
        products.splice(to, 0, moved);
        saveAll('Urutan disimpan');
      });
      list.appendChild(li);
    });
  }

  // tiny HTML5 drag-to-reorder used by both the product list and the photo grid
  function wireDrag(node, container, onMove) {
    node.addEventListener('dragstart', (e) => {
      container.dataset.from = node.dataset.index;
      node.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.dataset.index);
    });
    node.addEventListener('dragend', () => { node.classList.remove('dragging'); $$('.over', container).forEach((n) => n.classList.remove('over')); });
    node.addEventListener('dragover', (e) => { if (container.dataset.from != null) { e.preventDefault(); node.classList.add('over'); } });
    node.addEventListener('dragleave', () => node.classList.remove('over'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      node.classList.remove('over');
      const from = Number(container.dataset.from), to = Number(node.dataset.index);
      delete container.dataset.from;
      if (Number.isInteger(from) && from !== to) onMove(from, to);
    });
  }

  $('#addProduct').addEventListener('click', () => openEditor(-1));

  // ---------- editor drawer ----------
  const form = $('#editor');

  function openEditor(i) {
    editingIndex = i;
    const base = i >= 0 ? products[i] : {
      id: '', sku: '', name: 'PRODUK BARU', series: '', category: products[0]?.category || '', price: 0, oldPrice: 0, cost: 0, lowStock: 0,
      color: '#5b9bd5', accent: '#e8552b', hue: 0, description: '', features: [], sizes: ['39', '40', '41', '42', '43', '44'],
      images: [], buyUrl: '', visible: true,
    };
    editing = structuredClone(base);
    editing.hue = normHue(editing.hue);
    $('#editorTitle').textContent = i >= 0 ? 'Edit produk' : 'Produk baru';
    $('#deleteProduct').hidden = i < 0;
    const f = form.elements;
    f.name.value = editing.name;
    f.series.value = editing.series;
    f.category.value = editing.category;
    f.visible.checked = editing.visible;
    f.price.value = editing.price;
    f.oldPrice.value = editing.oldPrice || '';
    f.sku.value = editing.sku || '';
    f.cost.value = editing.cost || '';
    f.lowStock.value = editing.lowStock || '';
    f.color.value = editing.color;
    f.accent.value = editing.accent;
    f.hue.value = editing.hue;
    f.description.value = editing.description;
    f.sizes.value = editing.sizes.join(', ');
    f.features.value = editing.features.join(', ');
    f.buyUrl.value = editing.buyUrl;
    $('#cats').innerHTML = [...new Set(products.map((p) => p.category).filter(Boolean))].map((c) => `<option value="${c.replace(/"/g, '&quot;')}">`).join('');
    renderImages();
    updatePreview();
    $('#scrim').hidden = false;
    requestAnimationFrame(() => { $('#scrim').classList.add('show'); $('#drawer').classList.add('open'); });
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('.form', form).scrollTop = 0;
  }

  function closeEditor() {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#scrim').classList.remove('show');
    setTimeout(() => { $('#scrim').hidden = true; }, 350);
    editing = null;
  }
  $('#closeDrawer').addEventListener('click', closeEditor);
  $('#cancelEdit').addEventListener('click', closeEditor);
  $('#scrim').addEventListener('click', () => { if (editing) closeEditor(); if (evEditing) closeEvEditor(); });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (editing) closeEditor();
    if (evEditing) closeEvEditor();
  });

  function updatePreview() {
    const f = form.elements;
    const pv = $('#preview');
    pv.style.setProperty('--c', f.color.value);
    pv.style.setProperty('--a', f.accent.value);
    pv.style.setProperty('--hue', hueCss(f.hue.value));
    $('#images').style.setProperty('--hue', hueCss(f.hue.value));
    $('#hueOut').textContent = `${f.hue.value}°`;
    const img = $('#pvImg');
    img.src = editing.images[0] || '/img/ballop-mark-white.png';
  }
  form.addEventListener('input', (e) => { if (['color', 'accent', 'hue'].includes(e.target.name)) updatePreview(); });

  function renderImages() {
    const ul = $('#images');
    ul.innerHTML = '';
    editing.images.forEach((src, i) => {
      const li = document.createElement('li');
      li.className = i === 0 ? 'main' : '';
      li.draggable = true;
      li.dataset.index = i;
      li.title = i === 0 ? 'Foto utama' : 'Seret ke posisi pertama untuk jadi foto utama';
      const im = new Image(); im.src = src; im.alt = '';
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Hapus foto');
      x.addEventListener('click', () => { editing.images.splice(i, 1); renderImages(); updatePreview(); });
      li.append(im, x);
      li.addEventListener('dblclick', () => { editing.images.unshift(...editing.images.splice(i, 1)); renderImages(); updatePreview(); });
      wireDrag(li, ul, (from, to) => {
        const [m] = editing.images.splice(from, 1);
        editing.images.splice(to, 0, m);
        renderImages(); updatePreview();
      });
      ul.appendChild(li);
    });
  }

  // upload image files one by one, returns their public urls
  async function uploadFiles(files) {
    const urls = [];
    for (const file of [...files].filter((f) => f.type.startsWith('image/'))) {
      if (file.size > 12 * 1024 * 1024) { toast(`${file.name} lebih dari 12MB`, true); continue; }
      // online (Supabase) the file goes straight to Storage via a signed URL; locally it is posted to the server
      const target = await api('/api/upload-url', json('POST', { type: file.type }));
      if (target.mode === 'signed') {
        const res = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file });
        if (!res.ok) throw new Error(`Upload gagal (${res.status})`);
        urls.push(target.publicUrl);
      } else {
        const { url } = await api('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        urls.push(url);
      }
    }
    return urls;
  }
  function dropZone(node, onFiles) {
    node.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); node.classList.add('over'); } });
    node.addEventListener('dragleave', () => node.classList.remove('over'));
    node.addEventListener('drop', (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      node.classList.remove('over');
      onFiles(e.dataTransfer.files);
    });
  }

  async function upload(files) {
    const drop = $('#drop');
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    drop.classList.add('busy');
    try {
      for (const file of list) {
        if (file.size > 12 * 1024 * 1024) { toast(`${file.name} lebih dari 12MB`, true); continue; }
        const { url } = await api('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        if (editing) editing.images.push(url);
      }
      renderImages(); updatePreview();
      toast(`${list.length} foto diupload. Klik Simpan.`);
    } catch (e) { toast(e.message, true); }
    drop.classList.remove('busy');
  }
  $('#files').addEventListener('change', (e) => { upload(e.target.files); e.target.value = ''; });
  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    Object.assign(editing, {
      name: f.name.value.trim().toUpperCase(),
      series: f.series.value.trim().toUpperCase(),
      category: f.category.value.trim(),
      visible: f.visible.checked,
      price: Number(f.price.value) || 0,
      oldPrice: Number(f.oldPrice.value) || 0,
      sku: f.sku.value.trim().toUpperCase(),
      cost: Number(f.cost.value) || 0,
      lowStock: Number(f.lowStock.value) || 0,
      color: f.color.value,
      accent: f.accent.value,
      hue: Number(f.hue.value) || 0,
      description: f.description.value.trim(),
      sizes: splitList(f.sizes.value),
      features: splitList(f.features.value),
      buyUrl: f.buyUrl.value.trim(),
    });
    if (!editing.images.length) { toast('Upload minimal 1 foto dulu', true); return; }
    if (editingIndex >= 0) products[editingIndex] = editing;
    else {
      const base = slug(`${editing.name} ${editing.series}`) || 'produk';
      editing.id = products.some((p) => p.id === base) ? `${base}-${Date.now().toString(36)}` : base;
      products.push(editing);
    }
    closeEditor();
    saveAll(editingIndex >= 0 ? 'Produk disimpan' : 'Produk ditambahkan');
  });

  $('#deleteProduct').addEventListener('click', () => {
    if (editingIndex < 0) return;
    const p = products[editingIndex];
    if (!confirm(`Hapus ${p.name} ${p.series}? Tidak bisa dibatalkan.`)) return;
    products.splice(editingIndex, 1);
    closeEditor();
    saveAll('Produk dihapus');
  });

  // ---------- settings ----------
  function fillSettings() {
    const f = $('#settingsForm').elements;
    f.brand.value = settings.brand || 'BALLOP';
    f.currency.value = settings.currency || 'Rp';
    f.whatsapp.value = settings.whatsapp || '';
    f.instagram.value = settings.instagram || '';
    f.tiktok.value = settings.tiktok || '';
    f.shopee.value = settings.shopee || '';
    f.tokopedia.value = settings.tokopedia || '';
    f.email.value = settings.email || '';
    f.tiktokShop.value = settings.tiktokShop || '';
    f.monthlyTarget.value = settings.monthlyTarget || '';
    f.lowStock.value = settings.lowStock || 5;
  }
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      const body = {};
      ['brand', 'currency', 'whatsapp', 'instagram', 'tiktok', 'shopee', 'tiktokShop', 'tokopedia', 'email', 'monthlyTarget', 'lowStock'].forEach((k) => { body[k] = f[k].value.trim(); });
      settings = await api('/api/settings', json('PUT', body));
      fillSettings();
      renderList();
      document.dispatchEvent(new CustomEvent('admin:settings'));
      toast('Pengaturan disimpan');
    } catch (err) { toast(err.message, true); }
  });

  // ---------- events ----------
  const evForm = $('#evEditor');
  const EV_FIELDS = ['title', 'date', 'time', 'venue', 'city', 'address', 'summary', 'description', 'link'];
  let evEditing = null;
  let evIndex = -1;
  let pendingGallery = []; // freshly uploaded event photos that should also land in the gallery
  const isPng = (src) => /\.png($|\?)/i.test(src || '');
  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '');
  const fmtDate = (iso) => {
    const [y, m, d] = (iso || '').split('-').map(Number);
    return y ? new Date(y, m - 1, d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Tanpa tanggal';
  };
  const upcoming = (iso) => {
    if (!iso) return false;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return new Date(`${iso}T00:00:00`) >= t;
  };

  async function saveEvents(msg) {
    try {
      events = (await api('/api/events', json('PUT', events))).sort(byDate);
      renderEvents();
      renderGallery();
      if (msg) toast(msg);
    } catch (e) { toast(e.message, true); }
  }

  function renderEvents() {
    events.sort(byDate);
    $('#evCount').textContent = `${events.length} event · ${events.filter((e) => e.visible).length} tampil`;
    const list = $('#evList');
    list.innerHTML = events.length ? '' : '<li class="empty">Belum ada event. Klik “+ Posting event”.</li>';
    events.forEach((ev, i) => {
      const li = document.createElement('li');
      li.className = `item ev-row${ev.visible ? '' : ' off'}`;
      const cover = ev.cover || ev.photos[0] || '';
      const up = upcoming(ev.date);
      li.innerHTML = `
        <div class="thumb"><img alt=""></div>
        <div class="meta"><b></b><span></span></div>
        <span class="badge${up ? ' up' : ''}">${up ? 'SEGERA' : 'SELESAI'}</span>
        <button class="toggle" type="button" title="Tampil di website"></button>
        <div class="row-actions"><button class="icon" type="button" data-act="edit" title="Edit">✎</button></div>`;
      const img = $('.thumb img', li);
      img.src = cover || '/img/ballop-mark-white.png';
      img.className = !cover || isPng(cover) ? 'contain' : '';
      $('.meta b', li).textContent = ev.title;
      $('.meta span', li).textContent = [fmtDate(ev.date), ev.venue, `${ev.photos.length} foto`].filter(Boolean).join(' · ');
      const tg = $('.toggle', li);
      tg.classList.toggle('on', ev.visible);
      tg.setAttribute('aria-pressed', String(ev.visible));
      tg.addEventListener('click', () => { ev.visible = !ev.visible; saveEvents(ev.visible ? 'Event ditampilkan' : 'Event disembunyikan'); });
      $('[data-act=edit]', li).addEventListener('click', () => openEvEditor(i));
      li.addEventListener('dblclick', () => openEvEditor(i));
      list.appendChild(li);
    });
  }

  function openEvEditor(i) {
    evIndex = i;
    pendingGallery = [];
    const base = i >= 0 ? events[i] : {
      id: '', title: '', date: new Date().toISOString().slice(0, 10), time: '', venue: '', address: '', city: '',
      summary: '', description: '', highlights: [], cover: '', photos: [], link: '', visible: true,
    };
    evEditing = structuredClone(base);
    if (evEditing.cover && !evEditing.photos.includes(evEditing.cover)) evEditing.photos.unshift(evEditing.cover);
    const f = evForm.elements;
    EV_FIELDS.forEach((k) => { f[k].value = evEditing[k] || ''; });
    f.highlights.value = (evEditing.highlights || []).join('\n');
    f.visible.checked = evEditing.visible;
    $('#evTitle').textContent = i >= 0 ? 'Edit event' : 'Posting event';
    $('#deleteEvent').hidden = i < 0;
    renderEvImages();
    $('#scrim').hidden = false;
    requestAnimationFrame(() => { $('#scrim').classList.add('show'); $('#evDrawer').classList.add('open'); });
    $('#evDrawer').setAttribute('aria-hidden', 'false');
    $('.form', evForm).scrollTop = 0;
  }
  function closeEvEditor() {
    $('#evDrawer').classList.remove('open');
    $('#evDrawer').setAttribute('aria-hidden', 'true');
    $('#scrim').classList.remove('show');
    setTimeout(() => { if (!editing && !evEditing) $('#scrim').hidden = true; }, 350);
    evEditing = null;
  }
  $$('[data-ev-close]').forEach((b) => b.addEventListener('click', closeEvEditor));

  function renderEvImages() {
    const ul = $('#evImages');
    ul.innerHTML = '';
    evEditing.photos.forEach((src, i) => {
      const li = document.createElement('li');
      li.className = i === 0 ? 'main' : '';
      li.draggable = true;
      li.dataset.index = i;
      li.title = i === 0 ? 'Cover' : 'Seret ke posisi pertama untuk jadi cover';
      const im = new Image(); im.src = src; im.alt = '';
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Hapus foto');
      x.addEventListener('click', () => { evEditing.photos.splice(i, 1); renderEvImages(); });
      li.append(im, x);
      wireDrag(li, ul, (from, to) => {
        const [m] = evEditing.photos.splice(from, 1);
        evEditing.photos.splice(to, 0, m);
        renderEvImages();
      });
      ul.appendChild(li);
    });
  }

  async function uploadEvent(files) {
    const drop = $('#evDrop');
    drop.classList.add('busy');
    try {
      const urls = await uploadFiles(files);
      if (evEditing) evEditing.photos.push(...urls);
      pendingGallery.push(...urls);
      if (evEditing) renderEvImages();
      if (urls.length) toast(`${urls.length} foto diupload. Klik Simpan.`);
    } catch (e) { toast(e.message, true); }
    drop.classList.remove('busy');
  }
  $('#evFiles').addEventListener('change', (e) => { uploadEvent(e.target.files); e.target.value = ''; });
  dropZone($('#evDrop'), uploadEvent);

  evForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = evForm.elements;
    EV_FIELDS.forEach((k) => { evEditing[k] = f[k].value.trim(); });
    evEditing.highlights = f.highlights.value.split('\n').map((x) => x.trim()).filter(Boolean);
    evEditing.visible = f.visible.checked;
    evEditing.cover = evEditing.photos[0] || '';
    const isNew = evIndex < 0;
    if (isNew) {
      const base = slug(`${evEditing.title} ${evEditing.date}`) || 'event';
      evEditing.id = events.some((x) => x.id === base) ? `${base}-${Date.now().toString(36)}` : base;
      events.push(evEditing);
    } else events[evIndex] = evEditing;
    const ev = evEditing;
    const toGallery = f.toGallery.checked ? pendingGallery.filter((u) => ev.photos.includes(u)) : [];
    closeEvEditor();
    await saveEvents(isNew ? 'Event diposting' : 'Event disimpan');
    if (toGallery.length) {
      gallery.unshift(...toGallery.map((image) => ({ id: '', image, caption: ev.title, eventId: ev.id, wide: false, visible: true })));
      await saveGallery(`${toGallery.length} foto juga masuk Galeri`);
    }
  });

  $('#deleteEvent').addEventListener('click', async () => {
    if (evIndex < 0) return;
    const ev = events[evIndex];
    if (!confirm(`Hapus event "${ev.title}"? Foto di Galeri tetap ada. Tidak bisa dibatalkan.`)) return;
    events.splice(evIndex, 1);
    gallery.forEach((g) => { if (g.eventId === ev.id) g.eventId = ''; });
    closeEvEditor();
    await saveEvents('Event dihapus');
    await saveGallery();
  });
  $('#addEvent').addEventListener('click', () => openEvEditor(-1));

  // ---------- gallery ----------
  async function saveGallery(msg) {
    try {
      gallery = await api('/api/gallery', json('PUT', gallery));
      renderGallery();
      if (msg) toast(msg);
    } catch (e) { toast(e.message, true); }
  }
  // captions save a moment after typing stops, without re-rendering under the cursor
  let galTimer = 0;
  const saveCaptionsSoon = () => {
    clearTimeout(galTimer);
    galTimer = setTimeout(async () => {
      try { gallery = await api('/api/gallery', json('PUT', gallery)); toast('Caption tersimpan'); } catch (e) { toast(e.message, true); }
    }, 800);
  };

  function renderGallery() {
    $('#galCount').textContent = `${gallery.length} foto · ${gallery.filter((g) => g.visible).length} tampil`;
    const grid = $('#galGrid');
    grid.innerHTML = gallery.length ? '' : '<li class="empty" style="grid-column:1/-1">Galeri kosong. Upload foto dulu.</li>';
    gallery.forEach((g, i) => {
      const li = document.createElement('li');
      li.className = `gal-item${g.visible ? '' : ' off'}`;
      li.innerHTML = `
        <div class="gal-img" draggable="true" title="Seret untuk urutkan"><img alt=""><button class="x" type="button" aria-label="Hapus foto">✕</button></div>
        <div class="gal-fields">
          <input type="text" maxlength="160" placeholder="Caption" aria-label="Caption">
          <select aria-label="Event"><option value="">— Tanpa event —</option></select>
          <div class="gal-flags">
            <label><input type="checkbox" data-k="wide"> Besar</label>
            <label><input type="checkbox" data-k="visible"> Tampil</label>
          </div>
        </div>`;
      const img = $('img', li);
      img.src = g.image;
      img.className = isPng(g.image) ? 'contain' : '';
      const cap = $('input[type=text]', li);
      cap.value = g.caption;
      cap.addEventListener('input', () => { g.caption = cap.value; saveCaptionsSoon(); });
      const sel = $('select', li);
      events.forEach((ev) => sel.add(new Option(ev.title, ev.id)));
      sel.value = g.eventId || '';
      sel.addEventListener('change', () => { g.eventId = sel.value; saveGallery('Galeri tersimpan'); });
      $$('[data-k]', li).forEach((c) => {
        c.checked = !!g[c.dataset.k];
        c.addEventListener('change', () => { g[c.dataset.k] = c.checked; saveGallery('Galeri tersimpan'); });
      });
      $('.x', li).addEventListener('click', () => {
        if (!confirm('Hapus foto ini dari galeri?')) return;
        gallery.splice(i, 1);
        saveGallery('Foto dihapus');
      });
      // drag by the photo, drop on any card
      const handle = $('.gal-img', li);
      handle.addEventListener('dragstart', (e) => {
        grid.dataset.from = i;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      });
      handle.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        delete grid.dataset.from;
        $$('.over', grid).forEach((n) => n.classList.remove('over'));
      });
      li.addEventListener('dragover', (e) => { if (grid.dataset.from != null) { e.preventDefault(); li.classList.add('over'); } });
      li.addEventListener('dragleave', () => li.classList.remove('over'));
      li.addEventListener('drop', (e) => {
        if (grid.dataset.from == null) return;
        e.preventDefault();
        const from = Number(grid.dataset.from);
        delete grid.dataset.from;
        if (from === i) return;
        const [m] = gallery.splice(from, 1);
        gallery.splice(i, 0, m);
        saveGallery('Urutan disimpan');
      });
      grid.appendChild(li);
    });
  }

  async function uploadGallery(files) {
    const drop = $('#galDrop');
    drop.classList.add('busy');
    drop.textContent = 'Mengupload…';
    try {
      const urls = await uploadFiles(files);
      gallery.unshift(...urls.map((image) => ({ id: '', image, caption: '', eventId: '', wide: false, visible: true })));
      if (urls.length) await saveGallery(`${urls.length} foto ditambahkan`);
    } catch (e) { toast(e.message, true); }
    drop.classList.remove('busy');
    drop.textContent = 'Seret foto ke sini untuk upload';
  }
  $('#galFiles').addEventListener('change', (e) => { uploadGallery(e.target.files); e.target.value = ''; });
  dropZone($('#galDrop'), uploadGallery);

  // ---------- password + backup ----------
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    if (f.next.value !== f.again.value) { toast('Password baru tidak sama', true); return; }
    try {
      await api('/api/password', json('POST', { current: f.current.value, next: f.next.value }));
      e.target.reset();
      toast('Password diganti');
    } catch (err) { toast(err.message, true); }
  });
  $('#backupBtn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/backup', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Gagal membuat backup');
      download(`ballop-backup-${new Date().toISOString().slice(0, 10)}.json`, await res.blob());
      toast('Backup diunduh');
    } catch (err) { toast(err.message, true); }
  });
  $('#restoreFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !confirm('Pulihkan dari backup? Semua data sekarang akan diganti isi file ini.')) return;
    try {
      await api('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await file.text() });
      toast('Data dipulihkan, memuat ulang…');
      setTimeout(() => location.reload(), 800);
    } catch (err) { toast(err.message, true); }
  });
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // shared helpers for admin-biz.js / admin-content.js
  window.A = {
    $, $$, api, json, toast, money, slug, uploadFiles, dropZone, wireDrag, download, showView, hueCss,
    get products() { return products; },
    get settings() { return settings; },
    get events() { return events; },
    isPng: (src) => /\.png($|\?)/i.test(src || ''),
    openScrim() {
      $('#scrim').hidden = false;
      requestAnimationFrame(() => $('#scrim').classList.add('show'));
    },
    closeScrim() {
      $('#scrim').classList.remove('show');
      setTimeout(() => { if (!$('.drawer.open')) $('#scrim').hidden = true; }, 350);
    },
  };

  if (token) boot();
})();
