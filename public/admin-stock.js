// BALLOP admin: warehouse stock (stock3pl collection = latest stock per SKU). Current stock per SKU and a
// product × colour × size matrix; both are edited in place by the warehouse team and saved in one go.
(() => {
  const { $, $$, api, json, toast } = window.A;
  const B = window.Biz;
  const { esc, num, fmtDate, today, toCsv } = B;

  const st = { wh: '', tab: 'sum', cat: '', product: '', color: '', status: '', q: '' };
  try { Object.assign(st, JSON.parse(localStorage.getItem('ballopStock') || '{}')); } catch {}
  if (!['sum', 'now', 'size'].includes(st.tab)) st.tab = 'sum';
  const edits = new Map(); // id -> { available, damaged }
  const low = () => window.A.settings.lowStock || 5;
  const canEdit = () => window.A.can('stock3pl') && !window.A.me?.readOnly;
  const val = (r, k) => (edits.get(r.id)?.[k] ?? r[k]);
  const total = (r) => val(r, 'available') + val(r, 'damaged');
  const status = (n) => (n <= 0 ? 'habis' : n <= low() ? 'tipis' : 'aman');
  const STATUS = { habis: 'Habis', tipis: 'Tipis', aman: 'Aman' };
  // Korean mm sizes first (numeric), then letter / other sizes
  const sizeKey = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 1e4 + ['XS', 'S', 'M', 'L', 'XL', 'XXL'].indexOf(String(s).toUpperCase()); };
  // same order as the STOK TERKINI sheet (Padel Pulse first …); new SKUs go after their product
  const byItem = (a, b) => (a.order || 1e6) - (b.order || 1e6) || a.product.localeCompare(b.product) || a.color.localeCompare(b.color) || sizeKey(a.sizeKr || a.size) - sizeKey(b.sizeKr || b.size);
  const rowsAll = () => B.data.stock3pl.map((r) => ({ ...r, product: r.product || r.name || r.sku, color: r.color || '', category: r.category || 'Lainnya' }));
  const remember = () => { try { localStorage.setItem('ballopStock', JSON.stringify({ tab: st.tab, cat: st.cat, product: st.product, color: st.color, status: st.status })); } catch {} };

  function filtered(all) {
    const q = st.q.toLowerCase();
    return all.filter((r) => (!st.cat || r.category === st.cat) && (!st.product || r.product === st.product) && (!st.color || r.color === st.color)
      && (!st.status || status(val(r, 'available')) === st.status)
      && (!q || `${r.product} ${r.color} ${r.sku} ${r.note} ${r.sizeKr} ${r.size}`.toLowerCase().includes(q))).sort(byItem);
  }
  const opts = (list, cur, all) => `<option value="">${all}</option>${list.map(([v, n]) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(v)} (${num(n)})</option>`).join('')}`;
  // dropdown options in sheet order (rows are sorted with byItem first)
  const countBy = (rows, k) => Object.entries([...rows].sort(byItem).reduce((m, r) => { m[r[k]] = (m[r[k]] || 0) + 1; return m; }, {}));
  const stepper = (r, k) => `<span class="stepper${edits.get(r.id)?.[k] !== undefined && edits.get(r.id)[k] !== r[k] ? ' changed' : ''}"><button type="button" data-step="-1" data-id="${r.id}" data-k="${k}" ${canEdit() ? '' : 'disabled'}>−</button><input type="number" inputmode="numeric" min="0" value="${val(r, k)}" data-id="${r.id}" data-k="${k}" ${canEdit() ? '' : 'disabled'}><button type="button" data-step="1" data-id="${r.id}" data-k="${k}" ${canEdit() ? '' : 'disabled'}>+</button></span>`;

  // landing overview: what is plentiful, what ran out, what moves fastest, what sits still
  function summary(rows) {
    if (!rows.length) return '<section class="panel solid"><p class="muted" style="text-align:center;padding:30px">Tidak ada SKU di filter ini.</p></section>';
    const W = (r, k) => (r.whs || []).reduce((t, w) => t + (w[k] || 0), 0);
    const G = {};
    rows.forEach((r) => {
      const k = `${r.product}|${r.color}`, g = G[k] = G[k] || { k, product: r.product, color: r.color, good: 0, out: 0, inn: 0, habis: [], tipis: [] };
      const a = val(r, 'available'); g.good += a;
      g.out += W(r, 'orderOut') + W(r, 'otherOut'); g.inn += W(r, 'stockIn') + W(r, 'otherIn');
      const sz = r.size || r.sizeKr || '–'; if (a <= 0) g.habis.push(sz); else if (a <= low()) g.tipis.push(`${sz} (${a})`);
    });
    const gs = Object.values(G);
    // real sales: marketplace orders of the last 30 days, matched to a warehouse model by product + colour words
    const toks = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9.]+/g, ' ').trim().split(' ').filter((w) => w && w !== 'BALLOP');
    const models = gs.map((g) => ({ g, p: toks(g.product), c: toks(g.color) })).sort((a, b) => b.p.length - a.p.length);
    const since = B.addDays ? B.addDays(today(), -29) : today().slice(0, 8) + '01';
    const memo = {};
    const match = (name, varn) => {
      const k = `${name}|${varn}`; if (k in memo) return memo[k];
      const w = new Set(toks(`${name} ${varn}`));
      const hit = models.filter((m) => m.p.length && m.p.every((t) => w.has(t)));
      const best = hit.length ? Math.max(...hit.map((m) => m.p.length)) : 0;
      const top = hit.filter((m) => m.p.length === best);
      return (memo[k] = (top.find((m) => m.c.length && m.c.every((t) => w.has(t))) || (top.length === 1 ? top[0] : null))?.g || null);
    };
    gs.forEach((g) => { g.sold = 0; g.ch = {}; });
    (B.data.orders || []).forEach((o) => {
      if (o.date < since || o.state === 'cancelled') return;
      const g = match(o.productName || o.sku, o.variation); if (!g) return;
      const q = Math.max(0, (o.qty || 0) - (o.returnedQty || 0)); g.sold += q; g.ch[o.channel] = (g.ch[o.channel] || 0) + q;
    });
    const totSold = gs.reduce((t, g) => t + g.sold, 0);
    gs.forEach((g) => { g.cover = g.sold ? Math.round(g.good / (g.sold / 30)) : null; });
    const nm = (g) => `<b>${esc(g.product)}</b>${g.color ? ` · ${esc(g.color)}` : ''}`;
    const bars = (list, key, color) => { const mx = Math.max(1, ...list.map((g) => g[key])); return list.map((g, i) => `<div class="ss-row" data-goto="${esc(g.k)}"><span class="ss-i">${i + 1}</span><span class="ss-n">${nm(g)}</span><span class="ss-t"><i style="width:${(g[key] / mx) * 100}%;background:${color}"></i></span><span class="ss-v">${num(g[key])} pcs</span></div>`).join(''); };
    const top = [...gs].sort((a, b) => b.good - a.good).slice(0, 8);
    const fast = gs.filter((g) => g.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 8);
    const slowAll = gs.filter((g) => !g.sold && g.good > 0).sort((a, b) => b.good - a.good);
    const habisAll = gs.filter((g) => g.good <= 0);
    const habisPart = gs.filter((g) => g.good > 0 && g.habis.length).sort((a, b) => b.habis.length - a.habis.length);
    const tipis = gs.filter((g) => g.tipis.length).sort((a, b) => b.tipis.length - a.tipis.length);
    const cat = {}; rows.forEach((r) => { const c = cat[r.category] = cat[r.category] || { k: r.category, good: 0, skus: 0, habis: 0 }; c.good += val(r, 'available'); c.skus++; if (val(r, 'available') <= 0) c.habis++; });
    const cats = Object.values(cat).sort((a, b) => b.good - a.good), cmx = Math.max(1, ...cats.map((c) => c.good));
    const wh = {}; rows.forEach((r) => (r.whs || []).forEach((w) => { wh[w.wh] = (wh[w.wh] || 0) + w.ending; }));
    const whs = Object.entries(wh).sort((a, b) => b[1] - a[1]), wsum = whs.reduce((t, [, n]) => t + n, 0) || 1;
    const sz = {}; rows.forEach((r) => { const k = r.size || r.sizeKr; if (!k) return; const x = sz[k] = sz[k] || { good: 0, habis: 0 }; x.good += val(r, 'available'); if (val(r, 'available') <= 0) x.habis++; });
    const sizes = Object.entries(sz).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]) || a[0].localeCompare(b[0])), smx = Math.max(1, ...sizes.map(([, x]) => x.good));
    const totOut = gs.reduce((t, g) => t + g.out, 0), totIn = gs.reduce((t, g) => t + g.inn, 0), totGood = gs.reduce((t, g) => t + g.good, 0) || 1;
    const empty = (t) => `<p class="muted small" style="padding:10px 2px">${t}</p>`;
    return `
      <div class="ss-kpis">
        <div><span>Produk × warna</span><b>${num(gs.length)}</b><small>${num(rows.length)} SKU / size</small></div>
        <div><span>Terjual 30 hari</span><b>${num(totSold)}</b><small>order marketplace (non batal)</small></div>
        <div><span>Keluar / masuk 3PL</span><b>${num(totOut)} / ${num(totIn)}</b><small>dari export stock balance</small></div>
        <div class="bad"><span>Model habis total</span><b>${num(habisAll.length)}</b><small>semua size kosong</small></div>
        <div class="warn"><span>Model size bolong</span><b>${num(habisPart.length)}</b><small>sebagian size habis</small></div>
        <div><span>Stok diam</span><b>${num(slowAll.reduce((t, g) => t + g.good, 0))}</b><small>${num(slowAll.length)} model tidak terjual 30 hari</small></div>
      </div>
      <div class="ss-grid">
        <section class="panel solid"><div class="panel-head"><h2>🔥 Paling banyak keluar</h2><span class="muted small">laku 30 hari · sisa stok · cukup ±hari</span></div>${fast.length ? fast.map((g, i) => `<div class="ss-row" data-goto="${esc(g.k)}"><span class="ss-i">${i + 1}</span><span class="ss-n">${nm(g)}<small class="muted"> ${Object.entries(g.ch).map(([c, n]) => `${esc((B.SALES_CH[c] || {}).label || c)} ${num(n)}`).join(' · ')}</small></span><span class="ss-t"><i style="width:${(g.sold / fast[0].sold) * 100}%;background:#e8552b"></i></span><span class="ss-v">${num(g.sold)} terjual · sisa ${num(g.good)}${g.cover !== null ? ` · <b style="color:${g.cover <= 14 ? '#d23b3b' : g.cover <= 30 ? '#c98a00' : 'inherit'}">±${num(g.cover)} hr</b>` : ''}</span></div>`).join('') : empty('Belum ada order marketplace 30 hari terakhir.')}</section>
        <section class="panel solid"><div class="panel-head"><h2>📦 Stok terbanyak</h2><span class="muted small">good per model</span></div>${bars(top, 'good', '#2a78d6')}</section>
        <section class="panel solid"><div class="panel-head"><h2>⛔ Sudah habis</h2><span class="muted small">${num(habisAll.length)} model kosong · ${num(habisPart.length)} size bolong</span></div>
          <div class="ss-list">${habisAll.map((g) => `<div data-goto="${esc(g.k)}"><span>${nm(g)}</span><span class="badge bad">HABIS semua size</span></div>`).join('')}${habisPart.slice(0, 12).map((g) => `<div data-goto="${esc(g.k)}"><span>${nm(g)}<small class="muted"> sisa ${num(g.good)}</small></span><span class="ss-sz">${g.habis.map((x) => `<em>${esc(x)}</em>`).join('')}</span></div>`).join('') || (habisAll.length ? '' : empty('Tidak ada yang habis.'))}</div></section>
        <section class="panel solid"><div class="panel-head"><h2>⚠ Stok tipis</h2><span class="muted small">good ≤ ${low()} per size</span></div>
          <div class="ss-list">${tipis.slice(0, 12).map((g) => `<div data-goto="${esc(g.k)}"><span>${nm(g)}</span><span class="ss-sz warn">${g.tipis.map((x) => `<em>${esc(x)}</em>`).join('')}</span></div>`).join('') || empty('Tidak ada stok tipis.')}</div></section>
        <section class="panel solid"><div class="panel-head"><h2>💤 Stok diam</h2><span class="muted small">stok ada, tidak terjual 30 hari</span></div>${slowAll.length ? bars(slowAll.slice(0, 8), 'good', '#8a8f98') : empty('Semua model ada yang keluar.')}</section>
        <section class="panel solid"><div class="panel-head"><h2>Per kategori</h2></div>
          ${cats.map((c) => `<div class="ss-row" data-gocat="${esc(c.k)}"><span class="ss-n"><b>${esc(c.k)}</b> <small class="muted">${num(c.skus)} SKU${c.habis ? ` · ${num(c.habis)} habis` : ''}</small></span><span class="ss-t"><i style="width:${(c.good / cmx) * 100}%;background:#0e8a4f"></i></span><span class="ss-v">${num(c.good)} · ${Math.round((c.good / totGood) * 100)}%</span></div>`).join('')}
          ${whs.length ? `<h3 class="ss-h3">Per gudang</h3><div class="ss-wh">${whs.map(([w, n]) => `<div><span>${esc(w.replace(/ - NORMAL$/, ''))}</span><b>${num(n)}</b><i style="width:${(n / wsum) * 100}%"></i></div>`).join('')}</div>` : ''}</section>
        <section class="panel solid ss-wide"><div class="panel-head"><h2>Stok per size</h2><span class="muted small">total good semua model · merah = jumlah SKU habis</span></div>
          <div class="ss-sizes">${sizes.map(([k, x]) => `<div title="${esc(k)}: ${num(x.good)} pcs${x.habis ? `, ${x.habis} SKU habis` : ''}"><b>${num(x.good)}</b><span class="ss-bar"><i style="height:${Math.max(3, (x.good / smx) * 100)}%"></i></span><span>${esc(k)}</span>${x.habis ? `<em>${x.habis}</em>` : '<em class="z"></em>'}</div>`).join('')}</div></section>
      </div>`;
  }

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
      <div class="seg glass st-tabs"><button type="button" data-tab="sum" class="${st.tab === 'sum' ? 'on' : ''}">◈ Ringkasan</button><button type="button" data-tab="now" class="${st.tab === 'now' ? 'on' : ''}">Stock balance</button><button type="button" data-tab="size" class="${st.tab === 'size' ? 'on' : ''}">Stok per size</button></div>
      ${st.tab === 'sum' ? summary(rows) : `<section class="panel solid">${st.tab === 'size' ? matrix(rows) : list(rows)}</section>`}
      <div class="st-save" id="stSave" hidden><span id="stSaveText"></span><button class="btn sm" type="button" id="stUndo">Batal</button><button class="btn sm primary" type="button" id="stDo">Simpan perubahan</button></div>`;

    $$('[data-goto]', v).forEach((b) => b.addEventListener('click', () => { const [p, c] = b.dataset.goto.split('|'); st.product = p; st.color = c; st.cat = ''; st.tab = 'now'; openGroups.add(b.dataset.goto); remember(); render(); }));
    $$('[data-gocat]', v).forEach((b) => b.addEventListener('click', () => { st.cat = b.dataset.gocat; remember(); render(); }));
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
    $$('[data-wh]', v).forEach((b) => b.addEventListener('click', () => { st.wh = b.dataset.wh; render(); }));
    $$('[data-grp]', v).forEach((tr) => tr.addEventListener('click', () => { const k = tr.dataset.grp; if (openGroups.has(k)) openGroups.delete(k); else openGroups.add(k); render(); }));
    $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => openForm(B.data.stock3pl.find((x) => x.id === b.dataset.edit))));
    $('#stAdd')?.addEventListener('click', () => openForm(null));
    $('#stExport').addEventListener('click', () => {
      const head = ['Kategori', 'Produk', 'Warna', 'Size KR', 'Size EU', 'Kode SKU', 'Item pickpack', 'Good', 'Damaged', 'Total', 'Status', 'Gudang', 'Update'];
      window.A.download(`ballop-stok-${today()}.csv`, new Blob([`﻿${toCsv([head, ...rows.map((r) => [r.category, r.product, r.color, r.sizeKr, r.size, r.sku, r.note, val(r, 'available'), val(r, 'damaged'), total(r), STATUS[status(val(r, 'available'))], r.warehouse, r.updatedAt || r.date])])}`], { type: 'text/csv' }));
    });
    // the save bar floats over the page: an ancestor of the view creates a containing block for position:fixed
    document.querySelectorAll('body > #stSave').forEach((el) => el.remove());
    document.body.appendChild($('#stSave', v));
    $('#stUndo').addEventListener('click', () => { edits.clear(); render(); });
    $('#stDo').addEventListener('click', saveEdits);
    pendingBar();
    if (st.tab === 'daily') bindDaily(v);
  }

  // product · colour groups start folded; a search opens them all
  const openGroups = new Set();
  // stock balance like the 3PL export: one line per item, per warehouse or summed over all of them
  const BAL = [['opening', 'Opening'], ['stockIn', 'Stock In'], ['otherIn', 'Other In'], ['orderOut', 'Order Out'], ['otherOut', 'Other Out'], ['ending', 'Ending']];
  const whList = () => [...new Set(B.data.stock3pl.flatMap((r) => (r.whs || []).map((w) => w.wh)))].sort();
  const balOf = (r) => {
    const ws = (r.whs || []).filter((w) => !st.wh || w.wh === st.wh);
    const t = Object.fromEntries(BAL.map(([k]) => [k, ws.reduce((s, w) => s + (w[k] || 0), 0)]));
    if (!(r.whs || []).length) { t.ending = r.available + r.damaged; t.opening = t.ending; }
    return { ...t, ws };
  };
  function list(rows) {
    const whs = whList();
    if (st.wh && !whs.includes(st.wh)) st.wh = '';
    const shown = st.wh ? rows.filter((r) => (r.whs || []).some((w) => w.wh === st.wh)) : rows;
    const tot = Object.fromEntries(BAL.map(([k]) => [k, shown.reduce((s, r) => s + balOf(r)[k], 0)]));
    const whChip = (w) => `<button type="button" class="chip${st.wh === w ? ' on' : ''}" data-wh="${esc(w)}">${w ? esc(w) : 'Semua gudang (akumulasi)'} <i>${num(w ? rows.reduce((s, r) => s + ((r.whs || []).find((x) => x.wh === w)?.ending || 0), 0) : rows.reduce((s, r) => s + balOf({ ...r, whs: r.whs }).ending, 0))}</i></button>`;
    let last = '';
    const sums = {};
    shown.forEach((r) => { const k = `${r.product}|${r.color}`; const b = balOf(r); const x = sums[k] = sums[k] || { n: 0, habis: 0, tipis: 0, ...Object.fromEntries(BAL.map(([c]) => [c, 0])) }; x.n++; BAL.forEach(([c]) => { x[c] += b[c]; }); const s = status(val(r, 'available')); if (s !== 'aman') x[s]++; });
    const isOpen = (k) => !!st.q || openGroups.has(k);
    const flow = `<div class="bl-flow">${BAL.map(([k, l], i) => `<div class="bl-step${k === 'ending' ? ' end' : /Out/.test(l) ? ' out' : /In/.test(l) ? ' in' : ''}"><span>${l}</span><b>${/Out/.test(l) && tot[k] ? '−' : /In/.test(l) && tot[k] ? '+' : ''}${num(tot[k])}</b></div>${i < BAL.length - 1 ? `<i>${i === BAL.length - 2 ? '=' : /Out/.test(BAL[i + 1][1]) ? '−' : '+'}</i>` : ''}`).join('')}</div>`;
    return `
      <div class="st-chips bl-whs">${['', ...whs].map(whChip).join('')}</div>
      ${flow}
      ${!shown.length ? '<p class="muted" style="text-align:center;padding:30px">Tidak ada SKU di filter ini.</p>' : `<div class="table-wrap"><table class="data st-table bl-table">
      <thead><tr><th>Item</th><th>UoM</th><th>W/H</th>${BAL.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th>Status</th><th></th></tr></thead>
      <tbody>${shown.map((r) => {
        const grp = `${r.product}|${r.color}`;
        const x = sums[grp], open = isOpen(grp);
        const head = grp !== last ? `<tr class="st-group${open ? ' open' : ''}" data-grp="${esc(grp)}"><td colspan="3"><span class="st-caret">▾</span><b>${esc(r.product)}</b>${r.color ? ` · ${esc(r.color)}` : ''}<span class="muted small"> ${esc(r.category)} · ${num(x.n)} size</span></td>${BAL.map(([c]) => `<td class="num">${c === 'ending' ? `<b>${num(x[c])}</b>` : num(x[c])}</td>`).join('')}<td colspan="2">${x.habis ? `<span class="badge bad">${num(x.habis)} habis</span> ` : ''}${x.tipis ? `<span class="badge warn">${num(x.tipis)} tipis</span>` : ''}${!x.habis && !x.tipis ? '<span class="badge live">aman</span>' : ''}</td></tr>` : '';
        last = grp;
        const b = balOf(r), s = status(val(r, 'available'));
        return `${head}<tr data-row="${r.id}"${open ? '' : ' hidden'}><td title="${esc(r.sku)}"><span class="bl-item">${esc(r.note || r.name)}</span>${r.sku ? `<small class="muted"> ${esc(r.sku)}</small>` : ''}</td><td class="small">${esc(r.uom || 'EA')}</td>
          <td><div class="bl-wh">${(st.wh ? b.ws : r.whs || []).map((w) => `<span class="${/DAMAGED/i.test(w.wh) ? 'dmg' : ''}" title="${esc(w.wh)}">${esc(w.wh.replace(/ - NORMAL$/, '').replace('GUNUNG SINDUR', 'G. SINDUR'))} <b>${num(w.ending)}</b></span>`).join('') || '<span class="muted small">–</span>'}</div></td>
          ${BAL.map(([c]) => `<td class="num${c === 'ending' ? ' bl-end' : ''}">${c === 'ending' ? `<b>${num(b[c])}</b>` : b[c] ? num(b[c]) : '<span class="muted">–</span>'}</td>`).join('')}
          <td><span class="badge ${s === 'habis' ? 'bad' : s === 'tipis' ? 'warn' : 'live'}">${STATUS[s]}</span></td>
          <td>${canEdit() ? `<button class="icon-btn" type="button" data-edit="${r.id}" title="Edit detail">✎</button>` : ''}</td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><th colspan="3">TOTAL ${st.wh ? esc(st.wh) : 'SEMUA GUDANG'}</th>${BAL.map(([c]) => `<th class="num">${num(tot[c])}</th>`).join('')}<th colspan="2"></th></tr></tfoot></table></div>`}
      <p class="muted small">Ending = Opening + Stock In + Other In − Order Out − Other Out, per gudang (dari export stock balance 3PL). "Semua gudang" menjumlahkan BINTARO + GUNUNG SINDUR (+ damaged). Good di kartu atas = gudang normal, Damaged = gudang damaged.</p>`;
  }

  // product × colour rows, one column per Korean size; each cell edits the Good qty of that SKU
  function matrix(rows) {
    if (!rows.length) return '<p class="muted" style="text-align:center;padding:30px">Tidak ada SKU di filter ini.</p>';
    // columns are EU sizes; a model with two Korean sizes on the same EU size keeps both ("40 · 255")
    const groups = new Map();
    rows.forEach((r) => {
      const k = `${r.product}|${r.color}`;
      if (!groups.has(k)) groups.set(k, { product: r.product, color: r.color, cells: {} });
      const cells = groups.get(k).cells, eu = (r.size && r.size !== '-' ? r.size : r.sizeKr || '-').replace(/^[A-Z]+\s+(?=\d)/i, '');
      cells[cells[eu] ? `${eu} · ${r.sizeKr}` : eu] = r;
    });
    const sizes = [...new Set([...groups.values()].flatMap((g) => Object.keys(g.cells)))].sort((a, b) => sizeKey(a) - sizeKey(b) || a.localeCompare(b));
    const colTot = Object.fromEntries(sizes.map((s) => [s, 0]));
    const body = [...groups.values()].map((g) => {
      let t = 0;
      const cells = sizes.map((s) => {
        const r = g.cells[s];
        if (!r) return '<td class="mx-none"></td>';
        const n = val(r, 'available'); t += n; colTot[s] += n;
        return `<td class="mx ${status(n)}" title="${esc(r.note)} · KR ${esc(r.sizeKr)}${r.damaged ? ` · damaged ${val(r, 'damaged')}` : ''}"><input type="number" inputmode="numeric" min="0" value="${n}" data-id="${r.id}" data-k="available" ${canEdit() ? '' : 'disabled'}><small>KR ${esc(r.sizeKr || '–')}</small></td>`;
      }).join('');
      return `<tr><th class="mx-name"><b>${esc(g.product)}</b><span>${esc(g.color || '–')}</span></th>${cells}<td class="num"><b>${num(t)}</b></td></tr>`;
    }).join('');
    return `<div class="mx-legend"><span><i class="habis"></i>Habis (0)</span><span><i class="tipis"></i>Tipis (≤ ${low()})</span><span><i class="aman"></i>Aman</span><span class="muted">Kolom = size EU, angka = stok good, kecil = size KR. Kosong = size tidak ada untuk model ini.</span></div>
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

  // ---------- daily input (the STOCK-mm.yy sheet flow) ----------
  // OPENING QTY of a day = END QTY of the day before; the warehouse types SALES per channel, STOCK TAKING
  // (sample / KOL / gift / GWP), RETURN and the DAMAGED condition; END QTY = OPENING − TOTAL + RETURN.
  // stock3pl always holds the END QTY of the latest day. An entry keeps `damaged` = pcs moved good → damaged.
  const dst = { month: today().slice(0, 7), date: '' };
  const drafts = new Map(); // stock3pl id -> {shopee, tiktok, b2b, ret, damaged}
  const effect = (e) => -(e.shopee + e.tiktok + e.b2b) + e.ret - e.damaged;
  const blank = { shopee: 0, tiktok: 0, b2b: 0, ret: 0, damaged: 0 };
  const entryOf = (id, date) => B.data.stockdaily.find((e) => e.ref === id && e.date === date);
  const dval = (id) => ({ ...blank, ...(drafts.get(id) || entryOf(id, dst.date) || {}) });
  // good / damaged at the start of dst.date: undo every saved movement from that day on
  const startGood = (r) => r.available - B.data.stockdaily.reduce((s, e) => (e.ref === r.id && e.date >= dst.date ? s + effect(e) : s), 0);
  const startDmg = (r) => r.damaged - B.data.stockdaily.reduce((s, e) => (e.ref === r.id && e.date >= dst.date ? s + e.damaged : s), 0);
  const calc = (r) => {
    const e = dval(r.id), g = startGood(r), d = startDmg(r);
    const out = e.shopee + e.tiktok + e.b2b;
    return { e, open: g + d, out, good: g - out + e.ret - e.damaged, dmg: d + e.damaged, end: g + d - out + e.ret };
  };
  const MONTHS_L = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const longDay = (d) => { const [y, m, n] = d.split('-').map(Number); return `${n} ${MONTHS_L[m - 1]} ${y}`; };
  // a day marked "no sales / nothing left the warehouse" is one entry without a SKU
  const NONE = 'NO_MOVEMENT';
  function dayTotals() {
    const days = {};
    B.data.stockdaily.forEach((e) => { const d = days[e.date] = days[e.date] || { shopee: 0, tiktok: 0, b2b: 0, ret: 0, damaged: 0, skus: 0, none: false, by: '', at: '' }; if (e.key === NONE) d.none = true; else { ['shopee', 'tiktok', 'b2b', 'ret', 'damaged'].forEach((k) => { d[k] += e[k]; }); d.skus++; } if ((e.updatedAt || '') >= d.at) { d.at = e.updatedAt || ''; d.by = e.updatedBy; } });
    return days;
  }
  const endAfter = (d) => B.data.stock3pl.reduce((s, r) => s + r.available + r.damaged - B.data.stockdaily.reduce((t, e) => (e.ref === r.id && e.date > d ? t + effect(e) + e.damaged : t), 0), 0);

  // month calendar: each day shows whether the warehouse already filled it in
  function daily() {
    const [y, m] = dst.month.split('-').map(Number);
    const len = new Date(y, m, 0).getDate(), lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const days = dayTotals(), t = today();
    const key = (n) => `${dst.month}-${String(n).padStart(2, '0')}`;
    let filled = 0, out = 0, ret = 0;
    const cells = [...Array(lead)].map(() => '<div class="dc empty"></div>');
    for (let n = 1; n <= len; n++) {
      const d = key(n), x = days[d], future = d > t;
      if (x) { filled++; out += x.shopee + x.tiktok + x.b2b; ret += x.ret; }
      const quiet = x && x.none && !x.skus;
      cells.push(`<button type="button" class="dc${quiet ? ' quiet' : x ? ' done' : future ? ' future' : ' todo'}${d === t ? ' today' : ''}" data-cday="${d}" ${future ? 'disabled' : ''}>
        <span class="dc-n">${n}</span>${quiet ? '<span class="dc-quiet">Tidak ada barang keluar</span>' : x ? `<span class="dc-ok">✓ Sudah input</span><small>Keluar ${num(x.shopee + x.tiktok + x.b2b)}${x.ret ? ` · Retur ${num(x.ret)}` : ''}</small>` : future ? '' : '<span class="dc-no">Belum input</span>'}</button>`);
    }
    const past = Math.min(len, t.slice(0, 7) === dst.month ? Number(t.slice(8)) : t > dst.month ? len : 0);
    return `
      <section class="panel solid d-cal">
        <div class="panel-head"><h2>Input harian · ${MONTHS_L[m - 1]} ${y}</h2>
          <span class="muted small">${num(filled)} hari sudah diinput · keluar ${num(out)} · retur ${num(ret)}${past - filled > 0 ? ` · <b style="color:var(--warn)">${num(past - filled)} hari belum</b>` : ''}</span>
          <span class="cal-nav"><button class="btn sm" type="button" data-cmonth="-1" aria-label="Bulan sebelumnya">‹</button><button class="btn sm" type="button" data-cmonth="0">Bulan ini</button><button class="btn sm" type="button" data-cmonth="1" aria-label="Bulan berikutnya">›</button></span></div>
        <div class="dc-grid dc-head">${['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'].map((h) => `<span>${h}</span>`).join('')}</div>
        <div class="dc-grid">${cells.join('')}</div>
        <div class="dc-legend"><span><i class="done"></i>Sudah input</span><span><i class="quiet"></i>Tidak ada penjualan / barang keluar</span><span><i class="todo"></i>Belum input</span><span class="muted">Klik tanggal untuk lihat / input stok hari itu.</span></div>
      </section>`;
  }
  function bindDaily(v) {
    $$('[data-cmonth]', v).forEach((b) => b.addEventListener('click', () => {
      const n = Number(b.dataset.cmonth);
      if (!n) dst.month = today().slice(0, 7);
      else { const [y, m] = dst.month.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); dst.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
      render();
    }));
    $$('[data-cday]', v).forEach((b) => b.addEventListener('click', () => dayPopup(b.dataset.cday)));
  }

  const popup = (cls, html) => {
    const box = document.createElement('div');
    box.className = 'raw-pop';
    box.innerHTML = `<div class="raw-card ${cls}">${html}</div>`;
    document.body.appendChild(box);
    return box;
  };
  // step 1: what is on this date, with Edit / Input
  function dayPopup(d) {
    const x0 = dayTotals()[d];
    const quiet = x0 && x0.none && !x0.skus;
    const x = quiet ? null : x0;
    const box = popup('d-day', `
      <header><div><span class="muted small">Stok gudang</span><h2>${longDay(d)}</h2></div><button class="btn sm" type="button" data-close>✕</button></header>
      <div class="raw-body">${x ? `
        <div class="d-note ok"><b>✓ Tanggal ini sudah diinput</b><span>${num(x.skus)} SKU · terakhir oleh ${esc(x.by || '–')}${x.at ? ` · ${esc(x.at)}` : ''}</span></div>
        <div class="d-sum">
          <div><span>SALES SHOPEE</span><b>${num(x.shopee)}</b></div><div><span>SALES TIKTOK</span><b>${num(x.tiktok)}</b></div>
          <div><span>STOCK TAKING</span><b>${num(x.b2b)}</b></div><div><span>TOTAL</span><b>${num(x.shopee + x.tiktok + x.b2b)}</b></div>
          <div><span>RETURN</span><b>${num(x.ret)}</b></div><div class="end"><span>END QTY</span><b>${num(endAfter(d))}</b></div>
        </div>` : quiet ? `
        <div class="d-note quiet"><b>Tidak ada penjualan / barang keluar</b><span>Ditandai oleh ${esc(x0.by || '–')}${x0.at ? ` · ${esc(x0.at)}` : ''} · END QTY tetap ${num(endAfter(d))} pcs</span></div>` : `
        <div class="d-note"><b>Belum ada input untuk tanggal ini</b><span>OPENING QTY = END QTY hari sebelumnya: ${num(endAfter(B.addDays(d, -1)))} pcs</span></div>`}
      </div>
      <footer>${canEdit() && x0 ? '<button class="btn sm danger" type="button" data-del>🗑 Hapus input</button>' : ''}${canEdit() && !x0 ? '<button class="btn sm" type="button" data-none>Tidak ada barang keluar</button>' : ''}<span class="spacer"></span><button class="btn sm" type="button" data-close>Tutup</button>${canEdit() ? `<button class="btn sm primary" type="button" data-open>${x ? '✎ Edit input' : '+ Input data'}</button>` : ''}</footer>`);
    box.addEventListener('click', (e) => {
      if (e.target === box || e.target.closest('[data-close]')) box.remove();
      if (e.target.closest('[data-open]')) { box.remove(); inputPopup(d); }
      if (e.target.closest('[data-del]') && confirm(`Hapus semua input stok ${longDay(d)}? Stok dikembalikan seperti sebelum input ini.`)) { box.remove(); deleteDay(d); }
      if (e.target.closest('[data-none]')) { box.remove(); markNone(d); }
    });
  }
  async function putDaily(daily, stock, msg) {
    try {
      B.data.stockdaily = await api('/api/stockdaily', json('PUT', daily));
      if (stock) B.data.stock3pl = await api('/api/stock3pl', json('PUT', stock));
      toast(msg); render();
    } catch (e) { toast(e.message, true); }
  }
  // undo every movement of that day on the current stock, then drop the day (back to "belum input")
  function deleteDay(d) {
    const gone = B.data.stockdaily.filter((e) => e.date === d);
    const at = stamp(), by = who();
    const stock = B.data.stock3pl.map((r) => {
      const mine = gone.filter((e) => e.ref === r.id);
      if (!mine.length) return r;
      return { ...r, available: r.available - mine.reduce((s, e) => s + effect(e), 0), damaged: r.damaged - mine.reduce((s, e) => s + e.damaged, 0), updatedAt: at, updatedBy: by };
    });
    putDaily(B.data.stockdaily.filter((e) => e.date !== d), stock, `Input ${longDay(d)} dihapus`);
  }
  function markNone(d) {
    putDaily([...B.data.stockdaily, { id: '', date: d, ref: '', key: NONE, ...blank, updatedAt: stamp(), updatedBy: who() }], null, `${longDay(d)} ditandai tidak ada barang keluar`);
  }

  // step 2: the sheet block for that date, one row per SKU
  function inputPopup(d) {
    dst.date = d;
    drafts.clear();
    const f = { q: '', product: '', moving: false };
    const all = rowsAll().sort(byItem);
    const products = [...new Set(all.map((r) => r.product))];
    const box = popup('d-input', `
      <header><div><span class="muted small">Input stok harian</span><h2>${longDay(d)}</h2></div>
        <div class="d-flowmini" id="dFlow"></div><button class="btn sm" type="button" data-close>✕</button></header>
      <div class="d-tools">
        <select id="dProd"><option value="">Semua produk</option>${products.map((p) => `<option>${esc(p)}</option>`).join('')}</select>
        <input type="search" id="dQ" placeholder="Cari produk, warna, size…">
        <label class="d-toggle"><input type="checkbox" id="dMov"> Hanya yang ada isinya</label>
        <span class="muted small">Enter / ↓ = baris bawah</span>
      </div>
      <div class="raw-body d-body"><table class="data d-table">
        <thead><tr><th>ITEM PICKPACK</th><th class="num">OPENING QTY</th><th class="num d-shopee">SALES SHOPEE</th><th class="num d-tiktok">SALES TIKTOK</th><th class="num d-b2b" title="GBI - B2B - Stock Taking (Sample/KOL/Gift/GWP)">STOCK TAKING</th><th class="num">TOTAL</th><th class="num d-ret">RETURN</th><th class="num">GOOD</th><th class="num d-damaged">DAMAGED</th><th class="num">END QTY</th></tr></thead>
        <tbody id="dRows"></tbody></table></div>
      <footer><span id="dInfo" class="small"></span><span class="spacer"></span><button class="btn sm" type="button" data-close>Batal</button><button class="btn sm primary" type="button" id="dDo">Simpan</button></footer>`);
    const cell = (r, k, value) => `<td class="num d-${k}"><input class="d-in" type="number" inputmode="numeric" min="0" value="${value || ''}" placeholder="0" data-did="${r.id}" data-dk="${k}"></td>`;
    const row = (r) => { const c = calc(r); return `<tr data-drow="${r.id}" class="${drafts.has(r.id) ? 'changed' : ''}">
      <td><b>${esc(r.product)}</b> <span class="muted">${esc(r.color)}</span> <span class="d-size">${esc(r.sizeKr || '–')}${r.size && r.size !== '-' ? ` · EU ${esc(r.size)}` : ''}</span></td>
      <td class="num">${num(c.open)}</td>${cell(r, 'shopee', c.e.shopee)}${cell(r, 'tiktok', c.e.tiktok)}${cell(r, 'b2b', c.e.b2b)}
      <td class="num" data-c="out">${num(c.out)}</td>${cell(r, 'ret', c.e.ret)}<td class="num" data-c="good">${num(c.good)}</td>${cell(r, 'dmgEnd', c.dmg)}
      <td class="num"><b class="d-end${c.good < 0 ? ' neg' : ''}" data-c="end">${num(c.end)}</b></td></tr>`; };
    const flow = () => {
      let open = 0, out = 0, ret = 0, end = 0;
      all.forEach((r) => { const c = calc(r); open += c.open; out += c.out; ret += c.e.ret; end += c.end; });
      $('#dFlow', box).innerHTML = `<span>OPENING QTY <b>${num(open)}</b></span><i>−</i><span class="out">TOTAL <b>${num(out)}</b></span><i>+</i><span class="in">RETURN <b>${num(ret)}</b></span><i>=</i><span class="end">END QTY <b>${num(end)}</b></span>`;
      $('#dInfo', box).innerHTML = drafts.size ? `<b>${num(drafts.size)} SKU diubah</b>` : '<span class="muted">Belum ada perubahan</span>';
    };
    const draw = () => {
      const q = f.q.toLowerCase();
      const shown = all.filter((r) => (!f.product || r.product === f.product) && (!q || `${r.product} ${r.color} ${r.sizeKr} ${r.size} ${r.note}`.toLowerCase().includes(q))
        && (!f.moving || Object.values(dval(r.id)).some((n) => n)));
      $('#dRows', box).innerHTML = shown.map(row).join('') || '<tr><td colspan="10" class="muted" style="text-align:center;padding:24px">Tidak ada SKU.</td></tr>';
      $$('.d-in', box).forEach(bindInput);
      flow();
    };
    function bindInput(el) {
      el.addEventListener('focus', () => el.select());
      el.addEventListener('input', () => {
        const id = el.dataset.did, r = B.data.stock3pl.find((x) => x.id === id);
        const n = Math.max(0, Math.round(Number(el.value) || 0));
        const e = dval(id);
        if (el.dataset.dk === 'dmgEnd') e.damaged = Math.max(0, n - startDmg(r)); else e[el.dataset.dk] = n;
        const old = { ...blank, ...(entryOf(id, d) || {}) };
        if (['shopee', 'tiktok', 'b2b', 'ret', 'damaged'].every((k) => e[k] === old[k])) drafts.delete(id); else drafts.set(id, e);
        const tr = el.closest('tr'), c = calc(r);
        tr.classList.toggle('changed', drafts.has(id));
        tr.querySelector('[data-c="out"]').textContent = num(c.out);
        tr.querySelector('[data-c="good"]').textContent = num(c.good);
        const end = tr.querySelector('[data-c="end"]'); end.textContent = num(c.end); end.classList.toggle('neg', c.good < 0);
        flow();
      });
      el.addEventListener('keydown', (ev) => {
        if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(ev.key)) return;
        ev.preventDefault();
        const col = $$(`.d-in[data-dk="${el.dataset.dk}"]`, box);
        col[col.indexOf(el) + (ev.key === 'ArrowUp' ? -1 : 1)]?.focus();
      });
    }
    const close = () => { if (drafts.size && !confirm('Input belum disimpan. Tutup dan buang perubahan?')) return; drafts.clear(); box.remove(); };
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-close]')) close(); });
    $('#dProd', box).addEventListener('change', (e) => { f.product = e.target.value; draw(); });
    $('#dQ', box).addEventListener('input', (e) => { f.q = e.target.value; clearTimeout(f.t); f.t = setTimeout(draw, 200); });
    $('#dMov', box).addEventListener('change', (e) => { f.moving = e.target.checked; draw(); });
    $('#dDo', box).addEventListener('click', async () => { if (!drafts.size) { box.remove(); return; } if (await saveDaily()) box.remove(); });
    draw();
    $('#dQ', box).focus();
  }

  async function saveDaily() {
    const neg = [...drafts.keys()].map((id) => B.data.stock3pl.find((x) => x.id === id)).filter((r) => calc(r).good < 0);
    // stock can't go below 0 (the server clamps it), so fix those rows first
    if (neg.length) { toast(`${neg.length} SKU stok GOOD jadi minus (mis. ${neg[0].note}). Cek lagi angkanya.`, true); return false; }
    const at = stamp(), by = who();
    const daily = B.data.stockdaily.filter((e) => !(e.date === dst.date && (drafts.has(e.ref) || e.key === NONE)));
    const stock = B.data.stock3pl.map((r) => {
      if (!drafts.has(r.id)) return r;
      const e = drafts.get(r.id), old = { ...blank, ...(entryOf(r.id, dst.date) || {}) };
      if (Object.values(e).some((n) => n)) daily.push({ id: '', date: dst.date, ref: r.id, key: r.note, ...e, updatedAt: at, updatedBy: by });
      // only the change against what was saved before for this day moves the current stock
      return { ...r, available: r.available + effect(e) - effect(old), damaged: r.damaged + e.damaged - old.damaged, updatedAt: at, updatedBy: by };
    });
    try {
      B.data.stockdaily = await api('/api/stockdaily', json('PUT', daily));
      B.data.stock3pl = await api('/api/stock3pl', json('PUT', stock));
      const n = drafts.size;
      drafts.clear();
      toast(`Input ${longDay(dst.date)} tersimpan (${num(n)} SKU)`);
      render();
      return true;
    } catch (e) { toast(e.message, true); return false; }
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

  addEventListener('beforeunload', (e) => { if (edits.size || drafts.size) { e.preventDefault(); e.returnValue = ''; } });
  B.registerView('stock3pl', render);
  // the floating bar lives on <body>; hide it on other pages, show it again (with pending edits) when coming back
  document.addEventListener('admin:view', (e) => { const bar = document.querySelector('body > #stSave'); if (bar) bar.hidden = e.detail !== 'stock3pl' || !edits.size; });
})();
