// BALLOP admin: warehouse stock (stock3pl collection = latest stock per SKU). Current stock per SKU and a
// product × colour × size matrix; both are edited in place by the warehouse team and saved in one go.
(() => {
  const { $, $$, api, json, toast } = window.A;
  const B = window.Biz;
  const { esc, num, fmtDate, today, toCsv } = B;

  const st = { tab: 'now', cat: '', product: '', color: '', status: '', q: '' };
  try { Object.assign(st, JSON.parse(localStorage.getItem('ballopStock') || '{}')); } catch {}
  const edits = new Map(); // id -> { available, damaged }
  const low = () => window.A.settings.lowStock || 5;
  const canEdit = () => window.A.can('stock3pl') && !window.A.me?.readOnly;
  const val = (r, k) => (edits.get(r.id)?.[k] ?? r[k]);
  const total = (r) => val(r, 'available') + val(r, 'damaged');
  const status = (n) => (n <= 0 ? 'habis' : n <= low() ? 'tipis' : 'aman');
  const STATUS = { habis: 'Habis', tipis: 'Tipis', aman: 'Aman' };
  // Korean mm sizes first (numeric), then letter / other sizes
  const sizeKey = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 1e4 + ['XS', 'S', 'M', 'L', 'XL', 'XXL'].indexOf(String(s).toUpperCase()); };
  const byItem = (a, b) => a.product.localeCompare(b.product) || a.color.localeCompare(b.color) || sizeKey(a.sizeKr || a.size) - sizeKey(b.sizeKr || b.size);
  const rowsAll = () => B.data.stock3pl.map((r) => ({ ...r, product: r.product || r.name || r.sku, color: r.color || '', category: r.category || 'Lainnya' }));
  const remember = () => { try { localStorage.setItem('ballopStock', JSON.stringify({ tab: st.tab, cat: st.cat, product: st.product, color: st.color, status: st.status })); } catch {} };

  function filtered(all) {
    const q = st.q.toLowerCase();
    return all.filter((r) => (!st.cat || r.category === st.cat) && (!st.product || r.product === st.product) && (!st.color || r.color === st.color)
      && (!st.status || status(val(r, 'available')) === st.status)
      && (!q || `${r.product} ${r.color} ${r.sku} ${r.note} ${r.sizeKr} ${r.size}`.toLowerCase().includes(q))).sort(byItem);
  }
  const opts = (list, cur, all) => `<option value="">${all}</option>${list.map(([v, n]) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(v)} (${num(n)})</option>`).join('')}`;
  const countBy = (rows, k) => Object.entries(rows.reduce((m, r) => { m[r[k]] = (m[r[k]] || 0) + 1; return m; }, {})).sort((a, b) => a[0].localeCompare(b[0]));
  const stepper = (r, k) => `<span class="stepper${edits.get(r.id)?.[k] !== undefined && edits.get(r.id)[k] !== r[k] ? ' changed' : ''}"><button type="button" data-step="-1" data-id="${r.id}" data-k="${k}" ${canEdit() ? '' : 'disabled'}>−</button><input type="number" inputmode="numeric" min="0" value="${val(r, k)}" data-id="${r.id}" data-k="${k}" ${canEdit() ? '' : 'disabled'}><button type="button" data-step="1" data-id="${r.id}" data-k="${k}" ${canEdit() ? '' : 'disabled'}>+</button></span>`;

  function render() {
    const v = $('#view-stock3pl');
    const all = rowsAll();
    const inCat = all.filter((r) => !st.cat || r.category === st.cat);
    if (st.product && !inCat.some((r) => r.product === st.product)) st.product = '';
    const inProd = inCat.filter((r) => !st.product || r.product === st.product);
    if (st.color && !inProd.some((r) => r.color === st.color)) st.color = '';
    const rows = filtered(all);
    const good = rows.reduce((s, r) => s + val(r, 'available'), 0), dmg = rows.reduce((s, r) => s + val(r, 'damaged'), 0);
    const cnt = (s) => rows.filter((r) => status(val(r, 'available')) === s).length;
    const dates = all.map((r) => r.updatedAt || r.date).filter(Boolean).sort();
    const cats = countBy(all, 'category');

    v.innerHTML = `
      <header class="bar"><div><h1>Stok gudang</h1><p class="muted">Stok terakhir per SKU di ${esc([...new Set(all.map((r) => r.warehouse))].join(', ') || 'gudang')}${dates.length ? ` · update terakhir ${fmtDate(dates[dates.length - 1].slice(0, 10))}` : ''}. ${canEdit() ? 'Ubah angka langsung di tabel, lalu tekan Simpan.' : 'Hanya bisa dilihat.'}</p></div>
        <div class="bar-actions">${canEdit() ? '<button class="btn sm primary" type="button" id="stAdd">+ SKU baru</button>' : ''}<button class="btn sm" type="button" id="stExport">⬇ Export</button></div></header>
      <div class="st-cards">
        <div class="st-card hero"><span>Total stok</span><b>${num(good + dmg)}</b><small>pasang / pcs di filter ini</small></div>
        <div class="st-card"><span>Good</span><b>${num(good)}</b><small>siap jual</small></div>
        <div class="st-card"><span>Damaged</span><b>${num(dmg)}</b><small>rusak / cacat</small></div>
        <div class="st-card"><span>SKU</span><b>${num(rows.length)}</b><small>${num(new Set(rows.map((r) => `${r.product}|${r.color}`)).size)} produk × warna</small></div>
        <div class="st-card bad" data-quick="habis"><span>Habis</span><b>${num(cnt('habis'))}</b><small>SKU good = 0</small></div>
        <div class="st-card warn" data-quick="tipis"><span>Tipis</span><b>${num(cnt('tipis'))}</b><small>good ≤ ${low()}</small></div>
      </div>
      <div class="st-chips"><button type="button" class="chip${!st.cat ? ' on' : ''}" data-cat="">Semua kategori <i>${num(all.length)}</i></button>${cats.map(([c, n]) => `<button type="button" class="chip${st.cat === c ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)} <i>${num(n)}</i></button>`).join('')}</div>
      <div class="st-filters solid">
        <label>Produk / SKU<select data-f="product">${opts(countBy(inCat, 'product'), st.product, 'Semua produk')}</select></label>
        <label>Varian / warna<select data-f="color">${opts(countBy(inProd, 'color'), st.color, 'Semua warna')}</select></label>
        <label>Status<select data-f="status"><option value="">Semua status</option>${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${st.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="grow">Cari<input type="search" data-f="q" placeholder="Nama, kode SKU, size…" value="${esc(st.q)}"></label>
        ${st.cat || st.product || st.color || st.status || st.q ? '<button class="btn sm" type="button" id="stReset">Reset filter</button>' : ''}
      </div>
      <div class="seg glass st-tabs"><button type="button" data-tab="now" class="${st.tab === 'now' ? 'on' : ''}">Stok terkini per SKU</button><button type="button" data-tab="size" class="${st.tab === 'size' ? 'on' : ''}">Stok per size</button></div>
      <section class="panel solid">${st.tab === 'size' ? matrix(rows) : list(rows)}</section>
      <div class="st-save" id="stSave" hidden><span id="stSaveText"></span><button class="btn sm" type="button" id="stUndo">Batal</button><button class="btn sm primary" type="button" id="stDo">Simpan perubahan</button></div>`;

    $$('[data-cat]', v).forEach((b) => b.addEventListener('click', () => { st.cat = b.dataset.cat; remember(); render(); }));
    $$('[data-quick]', v).forEach((b) => b.addEventListener('click', () => { st.status = st.status === b.dataset.quick ? '' : b.dataset.quick; remember(); render(); }));
    $$('[data-tab]', v).forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; remember(); render(); }));
    $$('[data-f]', v).forEach((el) => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
      st[el.dataset.f] = el.value; remember();
      if (el.tagName === 'INPUT') { clearTimeout(st.t); st.t = setTimeout(() => { render(); const q = $('[data-f="q"]', v); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); } else render();
    }));
    $('#stReset')?.addEventListener('click', () => { Object.assign(st, { cat: '', product: '', color: '', status: '', q: '' }); remember(); render(); });
    $$('input[data-id]', v).forEach((el) => el.addEventListener('input', () => setVal(el.dataset.id, el.dataset.k, el.value, el)));
    $$('button[data-step]', v).forEach((b) => b.addEventListener('click', () => {
      const r = B.data.stock3pl.find((x) => x.id === b.dataset.id);
      const input = b.parentElement.querySelector('input');
      setVal(b.dataset.id, b.dataset.k, Math.max(0, val(r, b.dataset.k) + Number(b.dataset.step)), input);
    }));
    $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => openForm(B.data.stock3pl.find((x) => x.id === b.dataset.edit))));
    $('#stAdd')?.addEventListener('click', () => openForm(null));
    $('#stExport').addEventListener('click', () => {
      const head = ['Kategori', 'Produk', 'Warna', 'Size KR', 'Size EU', 'Kode SKU', 'Item pickpack', 'Good', 'Damaged', 'Total', 'Status', 'Gudang', 'Update'];
      window.A.download(`ballop-stok-${today()}.csv`, new Blob([`﻿${toCsv([head, ...rows.map((r) => [r.category, r.product, r.color, r.sizeKr, r.size, r.sku, r.note, val(r, 'available'), val(r, 'damaged'), total(r), STATUS[status(val(r, 'available'))], r.warehouse, r.updatedAt || r.date])])}`], { type: 'text/csv' }));
    });
    $('#stUndo').addEventListener('click', () => { edits.clear(); render(); });
    $('#stDo').addEventListener('click', saveEdits);
    pendingBar();
  }

  function list(rows) {
    if (!rows.length) return '<p class="muted" style="text-align:center;padding:30px">Tidak ada SKU di filter ini.</p>';
    let last = '';
    return `<div class="table-wrap"><table class="data st-table">
      <thead><tr><th>Produk · warna</th><th>Size KR</th><th>Size EU</th><th>Kode SKU</th><th class="num">Good</th><th class="num">Damaged</th><th class="num">Total</th><th>Status</th><th class="num" title="Keluar bulan ini: Shopee / TikTok / Offline">Keluar bln ini</th><th>Update</th><th></th></tr></thead>
      <tbody>${rows.map((r) => {
        const grp = `${r.product}|${r.color}`;
        const head = grp !== last ? `<tr class="st-group"><td colspan="11"><b>${esc(r.product)}</b>${r.color ? ` · ${esc(r.color)}` : ''}<span class="muted small"> ${esc(r.category)}</span></td></tr>` : '';
        last = grp;
        const s = status(val(r, 'available'));
        const out = r.outShopee + r.outTiktok + r.outOffline;
        return `${head}<tr data-row="${r.id}"><td class="muted small" title="${esc(r.note)}">${esc(r.note || r.name)}</td><td><b>${esc(r.sizeKr || '–')}</b></td><td>${esc(r.size || '–')}</td><td class="small">${esc(r.sku || '–')}</td>
          <td class="num">${stepper(r, 'available')}</td><td class="num">${stepper(r, 'damaged')}</td><td class="num"><b data-total="${r.id}">${num(total(r))}</b></td>
          <td><span class="badge ${s === 'habis' ? 'bad' : s === 'tipis' ? 'warn' : 'live'}" data-status="${r.id}">${STATUS[s]}</span></td>
          <td class="num small" title="Shopee ${r.outShopee} · TikTok ${r.outTiktok} · Offline ${r.outOffline}">${out ? num(out) : '–'}</td>
          <td class="small muted" title="${esc(r.updatedBy || '')}">${r.updatedAt ? fmtDate(r.updatedAt.slice(0, 10)) : '–'}</td>
          <td>${canEdit() ? `<button class="icon-btn" type="button" data-edit="${r.id}" title="Edit detail">✎</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  // product × colour rows, one column per Korean size; each cell edits the Good qty of that SKU
  function matrix(rows) {
    if (!rows.length) return '<p class="muted" style="text-align:center;padding:30px">Tidak ada SKU di filter ini.</p>';
    const sizes = [...new Set(rows.map((r) => r.sizeKr || r.size || '-'))].sort((a, b) => sizeKey(a) - sizeKey(b));
    const groups = new Map();
    rows.forEach((r) => { const k = `${r.product}|${r.color}`; if (!groups.has(k)) groups.set(k, { product: r.product, color: r.color, cells: {} }); groups.get(k).cells[r.sizeKr || r.size || '-'] = r; });
    const colTot = Object.fromEntries(sizes.map((s) => [s, 0]));
    const body = [...groups.values()].map((g) => {
      let t = 0;
      const cells = sizes.map((s) => {
        const r = g.cells[s];
        if (!r) return '<td class="mx-none"></td>';
        const n = val(r, 'available'); t += n; colTot[s] += n;
        return `<td class="mx ${status(n)}" title="${esc(r.note)} · EU ${esc(r.size)}${r.damaged ? ` · damaged ${val(r, 'damaged')}` : ''}"><input type="number" inputmode="numeric" min="0" value="${n}" data-id="${r.id}" data-k="available" ${canEdit() ? '' : 'disabled'}><small>EU ${esc(r.size || '–')}</small></td>`;
      }).join('');
      return `<tr><th class="mx-name"><b>${esc(g.product)}</b><span>${esc(g.color || '–')}</span></th>${cells}<td class="num"><b>${num(t)}</b></td></tr>`;
    }).join('');
    return `<div class="mx-legend"><span><i class="habis"></i>Habis (0)</span><span><i class="tipis"></i>Tipis (≤ ${low()})</span><span><i class="aman"></i>Aman</span><span class="muted">Angka = stok good. Kosong = size tidak ada untuk model ini.</span></div>
      <div class="table-wrap mx-wrap"><table class="mx-table"><thead><tr><th class="mx-name">Produk · warna</th>${sizes.map((s) => `<th>${esc(s)}</th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody>${body}</tbody><tfoot><tr><th class="mx-name">Total</th>${sizes.map((s) => `<td><b>${num(colTot[s])}</b></td>`).join('')}<td class="num"><b>${num(Object.values(colTot).reduce((a, b) => a + b, 0))}</b></td></tr></tfoot></table></div>`;
  }

  function setVal(id, k, raw, input) {
    const r = B.data.stock3pl.find((x) => x.id === id);
    const n = Math.max(0, Math.round(Number(raw) || 0));
    const e = { ...(edits.get(id) || {}) };
    e[k] = n;
    if ((e.available ?? r.available) === r.available && (e.damaged ?? r.damaged) === r.damaged) edits.delete(id); else edits.set(id, e);
    if (input && String(input.value) !== String(n) && raw !== '') input.value = n;
    // live feedback without re-rendering (keeps focus while typing)
    input?.closest('.stepper')?.classList.toggle('changed', n !== r[k]);
    const cell = input?.closest('td.mx');
    if (cell) { cell.classList.remove('habis', 'tipis', 'aman'); cell.classList.add(status(n)); cell.classList.toggle('changed', n !== r[k]); }
    const tot = document.querySelector(`[data-total="${id}"]`);
    if (tot) tot.textContent = num(total(r));
    const badge = document.querySelector(`[data-status="${id}"]`);
    if (badge) { const s = status(val(r, 'available')); badge.className = `badge ${s === 'habis' ? 'bad' : s === 'tipis' ? 'warn' : 'live'}`; badge.textContent = STATUS[s]; }
    pendingBar();
  }
  function pendingBar() {
    const bar = $('#stSave');
    if (!bar) return;
    bar.hidden = !edits.size;
    let diff = 0;
    edits.forEach((e, id) => { const r = B.data.stock3pl.find((x) => x.id === id); diff += (e.available ?? r.available) - r.available + (e.damaged ?? r.damaged) - r.damaged; });
    $('#stSaveText').innerHTML = `<b>${num(edits.size)} SKU diubah</b> · selisih ${diff > 0 ? '+' : ''}${num(diff)} pcs`;
  }
  const stamp = () => { const d = new Date(); return `${today()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const who = () => window.A.me?.user?.name || window.A.me?.user?.username || 'admin';
  async function put(list, msg) {
    try {
      B.data.stock3pl = await api('/api/stock3pl', json('PUT', list));
      edits.clear();
      toast(msg);
      render();
    } catch (e) { toast(e.message, true); }
  }
  function saveEdits() {
    const n = edits.size;
    put(B.data.stock3pl.map((r) => (edits.has(r.id) ? { ...r, ...edits.get(r.id), updatedAt: stamp(), updatedBy: who() } : r)), `${num(n)} SKU tersimpan`);
  }

  // add / edit one SKU in a popup (reuses the raw popup look)
  function openForm(r) {
    const all = rowsAll();
    const list = (k) => [...new Set(all.map((x) => x[k]).filter(Boolean))].sort();
    const x = r || { product: st.product, color: st.color, category: st.cat, warehouse: all[0]?.warehouse || 'GBI Bintaro', available: 0, damaged: 0 };
    const box = document.createElement('div');
    box.className = 'raw-pop';
    const field = (k, label, opt = {}) => `<label class="${opt.full ? 'full' : ''}">${label}<input name="${k}" value="${esc(x[k] ?? '')}" ${opt.type ? `type="${opt.type}" min="0"` : ''} ${opt.list ? `list="dl-${k}"` : ''}>${opt.list ? `<datalist id="dl-${k}">${list(k).map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}</label>`;
    box.innerHTML = `<form class="raw-card st-form">
      <header><div><span class="muted small">Stok gudang</span><h2>${r ? 'Edit SKU' : 'SKU baru'}</h2></div><button class="btn sm" type="button" data-close>✕</button></header>
      <div class="raw-body"><div class="st-form-grid">
        ${field('product', 'Produk', { list: 1, full: 1 })}${field('color', 'Warna / varian', { list: 1 })}${field('category', 'Kategori', { list: 1 })}
        ${field('sizeKr', 'Size KR (mm)')}${field('size', 'Size EU')}${field('sku', 'Kode SKU gudang')}${field('warehouse', 'Gudang', { list: 1 })}
        ${field('note', 'Item pickpack (key)', { full: 1 })}${field('available', 'Good', { type: 'number' })}${field('damaged', 'Damaged', { type: 'number' })}
      </div>${r?.updatedAt ? `<p class="muted small">Terakhir diubah ${esc(r.updatedAt)}${r.updatedBy ? ` oleh ${esc(r.updatedBy)}` : ''}</p>` : ''}</div>
      <footer>${r ? '<button class="btn sm danger" type="button" data-del>Hapus SKU</button>' : ''}<span class="spacer"></span><button class="btn sm" type="button" data-close>Batal</button><button class="btn sm primary" type="submit">Simpan</button></footer>
    </form>`;
    document.body.appendChild(box);
    const close = () => box.remove();
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-close]')) close(); });
    box.querySelector('[name="product"]').focus();
    box.querySelector('[data-del]')?.addEventListener('click', () => {
      if (!confirm(`Hapus SKU ${r.note || r.name}?`)) return;
      close(); edits.delete(r.id);
      put(B.data.stock3pl.filter((y) => y.id !== r.id), 'SKU dihapus');
    });
    box.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (!f.product.trim()) { toast('Nama produk wajib diisi', true); return; }
      const up = (s) => String(s || '').trim().toUpperCase();
      const rec = {
        ...(r || { id: '', date: today(), reserved: 0, outShopee: 0, outTiktok: 0, outOffline: 0 }),
        product: up(f.product), color: up(f.color), category: f.category.trim(), sizeKr: f.sizeKr.trim(), size: f.size.trim().replace(',', '.'),
        sku: f.sku.trim(), warehouse: f.warehouse.trim() || 'GBI Bintaro', note: f.note.trim() || `${up(f.product)} - ${up(f.color)} - ${f.sizeKr.trim()} (EU ${f.size.trim()})`,
        available: Math.max(0, Number(f.available) || 0), damaged: Math.max(0, Number(f.damaged) || 0), updatedAt: stamp(), updatedBy: who(),
      };
      rec.name = `${rec.product} ${rec.color}`.trim();
      close();
      if (r) edits.delete(r.id);
      put(r ? B.data.stock3pl.map((y) => (y.id === r.id ? rec : y)) : [...B.data.stock3pl, rec], r ? 'SKU diperbarui' : 'SKU ditambahkan');
    });
  }

  addEventListener('beforeunload', (e) => { if (edits.size) { e.preventDefault(); e.returnValue = ''; } });
  B.registerView('stock3pl', render);
})();
