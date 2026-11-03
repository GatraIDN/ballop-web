// BALLOP admin: products per marketplace. Tabs on the Produk page: an SKU summary that compares price and
// stock of the same product across channels (and the warehouse), one tab per marketplace with its listings
// and SKUs (editable), and the website catalog (the old Produk list, which feeds the landing page).
(() => {
  const { $, $$, api, json, toast } = window.A;
  const B = window.Biz;
  const { esc, num, money, pct, today, fmtDate } = B;

  const CH = { shopee: { label: 'Shopee', color: '#eb6834' }, tiktok: { label: 'TikTok Shop / Tokopedia', short: 'TikTok', color: '#2a78d6' }, blibli: { label: 'Blibli', color: '#1f8ff0' } };
  const CHS = Object.keys(CH);
  const st = { tab: 'summary', q: '', gap: false, mismatch: false, open: '', status: '' };
  try { Object.assign(st, JSON.parse(localStorage.getItem('ballopListings') || '{}'), { open: '' }); } catch {}
  const remember = () => { try { localStorage.setItem('ballopListings', JSON.stringify({ tab: st.tab })); } catch {} };
  const canEdit = () => window.A.can('products') && !window.A.me?.readOnly;
  const who = () => window.A.me?.user?.name || window.A.me?.user?.username || 'admin';
  const stamp = () => { const d = new Date(); return `${today()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const products = () => window.A.products || [];
  const pLabel = (p) => `${p.name} ${p.series}`.trim();
  const sizeKey = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 1e4; };
  const range = (vs, k) => { const xs = vs.map((v) => v[k]).filter((x) => x > 0); if (!xs.length) return null; return [Math.min(...xs), Math.max(...xs)]; };
  const rangeText = (r) => (!r ? '–' : r[0] === r[1] ? money(r[0]) : `${money(r[0])} – ${money(r[1])}`);
  const sum = (vs, k) => vs.reduce((s, v) => s + (v[k] || 0), 0);
  // warehouse good stock per catalog product + EU size (stock taking rows)
  const whRows = (p) => (B.data.stock3pl || []).filter((r) => (r.product || '').toUpperCase() === `BALLOP ${p.name}`.toUpperCase() && (r.color || '').toUpperCase() === (p.series || '').toUpperCase());
  const euOf = (s) => String(s || '').replace(/^EU\s*/i, '').replace(',', '.').trim();

  // ---------- tabs on the Produk page ----------
  function mount() {
    const v = $('#view-products');
    if (!v || $('#lsTabs', v)) return;
    const head = v.querySelector('header.bar');
    head.insertAdjacentHTML('beforebegin', '<div class="seg glass ls-tabs" id="lsTabs"></div>');
    v.insertAdjacentHTML('beforeend', '<div id="lsView"></div>');
  }
  function render() {
    mount();
    const v = $('#view-products');
    const tabs = [['summary', '◔ Ringkasan SKU'], ...CHS.map((c) => [c, CH[c].label]), ['catalog', 'Katalog website (LP)']];
    $('#lsTabs', v).innerHTML = tabs.map(([k, l]) => `<button type="button" data-lstab="${k}" class="${st.tab === k ? 'on' : ''}">${CH[k] ? `<i class="ls-dot" style="background:${CH[k].color}"></i>` : ''}${l}${CH[k] ? ` <small>${num(B.data.listings.filter((x) => x.channel === k).length)}</small>` : ''}</button>`).join('');
    $$('[data-lstab]', v).forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.lstab; st.open = ''; remember(); render(); }));
    // the catalog tab is the original page; the others replace it
    [...v.children].forEach((el) => { if (el.id !== 'lsTabs' && el.id !== 'lsView') el.hidden = st.tab !== 'catalog'; });
    const box = $('#lsView', v);
    box.hidden = st.tab === 'catalog';
    if (st.tab === 'catalog') { box.innerHTML = ''; return; }
    box.innerHTML = st.tab === 'summary' ? summary() : channel(st.tab);
    bind(box);
  }

  // ---------- SKU summary: same product across channels ----------
  function compare() {
    return products().map((p) => {
      const per = Object.fromEntries(CHS.map((c) => [c, B.data.listings.filter((l) => l.channel === c && l.productId === p.id).flatMap((l) => l.variants)]));
      const wh = whRows(p);
      if (!CHS.some((c) => per[c].length) && !wh.length) return null;
      const lows = CHS.map((c) => range(per[c], 'price')?.[0]).filter(Boolean);
      const gap = lows.length > 1 ? Math.max(...lows) - Math.min(...lows) : 0;
      const stock = Object.fromEntries(CHS.map((c) => [c, sum(per[c], 'stock')]));
      const whGood = wh.reduce((s, r) => s + r.available, 0);
      const mism = wh.length ? CHS.filter((c) => per[c].length && stock[c] !== whGood) : [];
      return { p, per, wh, lows, gap, gapPct: lows.length > 1 ? gap / Math.min(...lows) : 0, stock, whGood, mism };
    }).filter(Boolean);
  }
  function summary() {
    const rows = compare();
    const q = st.q.toLowerCase();
    const shown = rows.filter((r) => (!q || pLabel(r.p).toLowerCase().includes(q)) && (!st.gap || r.gap > 0) && (!st.mismatch || r.mism.length))
      .sort((a, b) => b.gap - a.gap || pLabel(a.p).localeCompare(pLabel(b.p)));
    const unlinked = B.data.listings.filter((l) => !l.productId);
    const chCard = (c) => {
      const ls = B.data.listings.filter((l) => l.channel === c), vs = ls.flatMap((l) => l.variants);
      return `<div class="ls-ch" style="--c:${CH[c].color}"><b>${CH[c].label}</b><span><strong>${num(ls.length)}</strong> listing · <strong>${num(vs.length)}</strong> SKU</span>
        <span>Stok <strong>${num(sum(vs, 'stock'))}</strong> · habis <strong>${num(vs.filter((v) => !v.stock).length)}</strong> SKU</span>
        <span>Harga ${rangeText(range(vs, 'price'))}</span><span class="muted">${num(ls.filter((l) => l.productId).length)}/${num(ls.length)} terhubung ke katalog</span></div>`;
    };
    const cell = (r, c) => { const rg = range(r.per[c], 'price'); return r.per[c].length ? `<td class="num">${rangeText(rg)}${r.lows.length > 1 && rg && rg[0] === Math.min(...r.lows) ? ' <span class="badge live">termurah</span>' : ''}</td>` : '<td class="num muted">–</td>'; };
    return `
      <header class="bar"><div><h1>Ringkasan SKU</h1><p class="muted">Perbandingan harga & stok produk yang sama di setiap channel dan di gudang. Data dari "Harga dan Stok E-comerce" (${esc(latest())}).</p></div></header>
      <div class="st-cards">
        <div class="st-card hero"><span>Produk dibandingkan</span><b>${num(rows.length)}</b><small>produk katalog × channel</small></div>
        <div class="st-card warn" data-quick="gap"><span>Harga beda antar channel</span><b>${num(rows.filter((r) => r.gap > 0).length)}</b><small>klik untuk filter</small></div>
        <div class="st-card bad" data-quick="mismatch"><span>Stok beda dgn gudang</span><b>${num(rows.filter((r) => r.mism.length).length)}</b><small>klik untuk filter</small></div>
        <div class="st-card"><span>Listing belum terhubung</span><b>${num(unlinked.length)}</b><small>bundle / produk tanpa katalog</small></div>
      </div>
      <div class="ls-chs">${CHS.map(chCard).join('')}</div>
      <div class="st-filters solid"><label class="grow">Cari produk<input type="search" data-lsq placeholder="mis. Padel Pulse, Tivat…" value="${esc(st.q)}"></label>
        <label class="d-toggle"><input type="checkbox" data-lsf="gap"${st.gap ? ' checked' : ''}> Hanya harga beda</label>
        <label class="d-toggle"><input type="checkbox" data-lsf="mismatch"${st.mismatch ? ' checked' : ''}> Hanya stok beda dgn gudang</label></div>
      <section class="panel solid"><div class="table-wrap"><table class="data ls-cmp">
        <thead><tr><th>Produk</th>${CHS.map((c) => `<th class="num" style="color:${CH[c].color}">Harga ${CH[c].short || CH[c].label}</th>`).join('')}<th class="num">Selisih harga</th>${CHS.map((c) => `<th class="num">Stok ${CH[c].short || CH[c].label}</th>`).join('')}<th class="num">Stok gudang</th><th></th></tr></thead>
        <tbody>${shown.map((r) => `<tr class="ls-row${st.open === r.p.id ? ' on' : ''}" data-lsopen="${esc(r.p.id)}">
          <td><b>${esc(r.p.name)}</b> <span class="muted">${esc(r.p.series)}</span></td>${CHS.map((c) => cell(r, c)).join('')}
          <td class="num">${r.gap ? `<b class="ls-gap">${money(r.gap)}</b><small class="muted"> ${pct(r.gapPct)}</small>` : '<span class="muted">sama</span>'}</td>
          ${CHS.map((c) => `<td class="num${r.mism.includes(c) ? ' ls-bad' : ''}">${r.per[c].length ? num(r.stock[c]) : '–'}</td>`).join('')}
          <td class="num"><b>${r.wh.length ? num(r.whGood) : '–'}</b></td><td class="muted">${st.open === r.p.id ? '▴' : '▾'}</td></tr>
          ${st.open === r.p.id ? `<tr class="ls-detail"><td colspan="${CHS.length * 2 + 4}">${perSize(r)}</td></tr>` : ''}`).join('') || '<tr><td colspan="10" class="muted" style="text-align:center;padding:30px">Tidak ada produk di filter ini.</td></tr>'}</tbody>
      </table></div></section>
      ${unlinked.length ? `<section class="panel solid" style="margin-top:14px"><div class="panel-head"><h2>Listing belum terhubung ke katalog</h2><span class="muted small">pilih produk katalog supaya ikut dibandingkan</span></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Channel</th><th>Nama listing</th><th class="num">SKU</th><th class="num">Stok</th><th>Hubungkan ke</th></tr></thead>
        <tbody>${unlinked.map((l) => `<tr><td>${chip(l.channel)}</td><td title="${esc(l.name)}">${esc(l.name.length > 70 ? `${l.name.slice(0, 68)}…` : l.name)}</td><td class="num">${num(l.variants.length)}</td><td class="num">${num(sum(l.variants, 'stock'))}</td><td>${linkSelect(l)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
  }
  // per size: price & stock in every channel next to the warehouse
  function perSize(r) {
    const sizes = [...new Set([...CHS.flatMap((c) => r.per[c].map((v) => euOf(v.size))), ...r.wh.map((w) => euOf(w.size))])].filter(Boolean).sort((a, b) => sizeKey(a) - sizeKey(b));
    const at = (c, s) => r.per[c].filter((v) => euOf(v.size) === s);
    return `<table class="ls-sizes"><thead><tr><th>Size EU</th>${CHS.map((c) => `<th colspan="2" style="color:${CH[c].color}">${CH[c].short || CH[c].label}</th>`).join('')}<th>Gudang</th></tr>
      <tr class="sub"><th></th>${CHS.map(() => '<th>Harga</th><th>Stok</th>').join('')}<th>Good</th></tr></thead>
      <tbody>${sizes.map((s) => {
        const wh = r.wh.filter((w) => euOf(w.size) === s).reduce((t, w) => t + w.available, 0);
        const prices = CHS.map((c) => at(c, s)[0]?.price).filter(Boolean);
        const low = prices.length ? Math.min(...prices) : 0;
        return `<tr><td><b>${esc(s)}</b></td>${CHS.map((c) => { const vs = at(c, s); if (!vs.length) return '<td class="muted">–</td><td class="muted">–</td>'; const pr = vs[0].price, sk = sum(vs, 'stock');
          return `<td class="${prices.length > 1 && pr > low ? 'ls-hi' : ''}">${money(pr)}</td><td class="${r.wh.length && sk !== wh ? 'ls-bad' : ''}">${num(sk)}</td>`; }).join('')}<td><b>${r.wh.length ? num(wh) : '–'}</b></td></tr>`;
      }).join('')}</tbody></table><p class="muted small">Merah = stok channel beda dengan stok gudang · oranye = harga lebih mahal dari channel termurah.</p>`;
  }
  const chip = (c) => `<span class="ch"><i style="background:${CH[c]?.color || '#8a8f99'}"></i>${CH[c]?.short || CH[c]?.label || c}</span>`;
  const linkSelect = (l) => `<select data-link="${esc(l.id)}" ${canEdit() ? '' : 'disabled'}><option value="">— belum terhubung —</option>${products().map((p) => `<option value="${esc(p.id)}"${l.productId === p.id ? ' selected' : ''}>${esc(pLabel(p))}</option>`).join('')}</select>`;
  const latest = () => { const d = B.data.listings.map((l) => l.updatedAt).filter(Boolean).sort().pop(); return d ? fmtDate(d.slice(0, 10)) : '–'; };

  // ---------- one marketplace ----------
  function channel(c) {
    const all = B.data.listings.filter((l) => l.channel === c);
    const q = st.q.toLowerCase();
    const shown = all.filter((l) => (!q || `${l.name} ${l.parentSku} ${l.variants.map((v) => v.sku).join(' ')}`.toLowerCase().includes(q))
      && (!st.status || (st.status === 'habis' ? l.variants.every((v) => !v.stock) : st.status === 'promo' ? l.variants.some((v) => v.oldPrice > v.price) : st.status === 'unlinked' ? !l.productId : true)))
      .sort((a, b) => sum(b.variants, 'stock') - sum(a.variants, 'stock'));
    const vs = all.flatMap((l) => l.variants);
    return `
      <header class="bar"><div><h1>${CH[c].label}</h1><p class="muted">${c === 'shopee' ? 'Produk Shopee yang terhubung ke katalog tampil di landing page, harganya ikut Shopee. ' : ''}Klik baris untuk lihat & edit harga / stok per SKU.</p></div></header>
      <div class="st-cards">
        <div class="st-card hero" style="background:linear-gradient(150deg, ${CH[c].color}, color-mix(in srgb, ${CH[c].color} 60%, #000))"><span>Listing</span><b>${num(all.length)}</b><small>${num(vs.length)} SKU</small></div>
        <div class="st-card"><span>Total stok</span><b>${num(sum(vs, 'stock'))}</b><small>${num(vs.filter((v) => !v.stock).length)} SKU habis</small></div>
        <div class="st-card"><span>Harga</span><b class="ls-sm">${rangeText(range(vs, 'price'))}</b><small>harga hari ini</small></div>
        <div class="st-card warn"><span>Sedang promo</span><b>${num(all.filter((l) => l.variants.some((v) => v.oldPrice > v.price)).length)}</b><small>listing ada harga coret</small></div>
        ${c === 'shopee' ? `<div class="st-card"><span>Terjual</span><b>${num(sum(vs, 'sold'))}</b><small>pcs (data Shopee)</small></div>` : ''}
        <div class="st-card"><span>Terhubung katalog</span><b>${num(all.filter((l) => l.productId).length)}/${num(all.length)}</b><small>${c === 'shopee' ? 'tampil di LP' : 'ikut ringkasan'}</small></div>
      </div>
      <div class="st-filters solid"><label class="grow">Cari<input type="search" data-lsq placeholder="Nama listing, SKU…" value="${esc(st.q)}"></label>
        <label>Tampilkan<select data-lss><option value="">Semua listing</option><option value="promo"${st.status === 'promo' ? ' selected' : ''}>Sedang promo</option><option value="habis"${st.status === 'habis' ? ' selected' : ''}>Stok habis</option><option value="unlinked"${st.status === 'unlinked' ? ' selected' : ''}>Belum terhubung katalog</option></select></label></div>
      ${listTable(c, shown)}`;
  }
  // one row per listing; the SKUs open in a popup
  function listRow(l) {
    const vs = [...l.variants].sort((a, b) => sizeKey(euOf(a.size)) - sizeKey(euOf(b.size)));
    const pr = range(vs, 'price'), old = range(vs, 'oldPrice');
    const disc = pr && old && old[1] > pr[0] ? 1 - pr[0] / old[1] : 0;
    const stock = sum(vs, 'stock'), out = vs.filter((v) => !v.stock).length;
    const p = products().find((x) => x.id === l.productId);
    const img = p?.images?.[0];
    const short = l.name.replace(/^BALLOP\s+/i, '').split(/\s+[–-]\s+|\s+Sepatu|\s+Sandal|\s+Sneakers/i)[0];
    return `<tr class="ll-row" data-lsrow="${esc(l.id)}">
      <td><div class="ll-prod"><span class="ll-thumb" style="--c:${CH[l.channel].color}">${img ? `<img src="${esc(img)}" alt="">` : esc(short.slice(0, 2).toUpperCase())}</span>
        <span class="ll-txt"><b title="${esc(l.name)}">${esc(short)}</b><small>${esc(l.parentSku || '–')} · ${num(vs.length)} SKU${l.status && l.status !== 'Aktif' ? ` · ${esc(l.status)}` : ''}</small></span></div></td>
      <td class="num"><b class="ll-price">${rangeText(pr)}</b>${disc ? `<small class="ll-old"><s>${money(old[1])}</s></small>` : ''}</td>
      <td class="num">${disc ? `<span class="ll-disc">−${Math.round(disc * 100)}%</span>` : '<span class="muted">–</span>'}</td>
      <td><div class="ll-stock"><span><b>${num(stock)}</b>${out ? `<small class="bad">${num(out)} habis</small>` : ''}</span><i><em style="width:${vs.length ? ((vs.length - out) / vs.length) * 100 : 0}%"></em></i></div></td>
      ${l.channel === 'shopee' ? `<td class="num">${num(sum(vs, 'sold'))}</td>` : ''}
      <td>${p ? `<span class="ll-link">${esc(pLabel(p))}</span>` : '<span class="ll-link none">Belum terhubung</span>'}</td>
      <td class="ll-go">›</td></tr>`;
  }
  function listTable(c, shown) {
    return `<section class="panel solid ll-panel"><div class="table-wrap"><table class="data ll-table">
      <thead><tr><th>Produk</th><th class="num">Harga</th><th class="num">Diskon</th><th>Stok · size tersedia</th>${c === 'shopee' ? '<th class="num">Terjual</th>' : ''}<th>Katalog${c === 'shopee' ? ' / LP' : ''}</th><th></th></tr></thead>
      <tbody>${shown.map(listRow).join('') || `<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">Tidak ada listing di filter ini.</td></tr>`}</tbody></table></div></section>`;
  }

  // listing detail: every SKU with editable price / stock and the catalog link
  function openListing(id) {
    const l = B.data.listings.find((x) => x.id === id);
    const vs = l.variants.map((v) => ({ ...v }));
    const order = vs.map((v, i) => i).sort((a, b) => sizeKey(euOf(vs[a].size)) - sizeKey(euOf(vs[b].size)));
    const box = document.createElement('div');
    box.className = 'raw-pop';
    const disc = (v) => (v.oldPrice > v.price && v.price ? `−${Math.round((1 - v.price / v.oldPrice) * 100)}%` : '–');
    box.innerHTML = `<div class="raw-card ll-pop" style="--c:${CH[l.channel].color}">
      <header><div><span class="muted small"><i class="ls-dot" style="background:${CH[l.channel].color}"></i>${CH[l.channel].label} · ID ${esc(l.listingId)}</span><h2>${esc(l.name)}</h2></div><button class="btn sm" type="button" data-close>✕</button></header>
      <div class="ll-popbar"><label>Produk katalog ${linkSelect(l)}</label>${l.promo ? `<span class="badge warn">${esc(l.promo)}</span>` : ''}<span class="muted small">Update ${esc(l.updatedAt || '–')}${l.updatedBy ? ` · ${esc(l.updatedBy)}` : ''}</span></div>
      <div class="raw-body"><table class="data ll-skus"><thead><tr><th>Size</th><th>SKU</th>${l.channel === 'blibli' ? '<th>Lokasi</th>' : ''}<th class="num">Harga hari ini</th><th class="num">Harga coret</th><th class="num">Diskon</th><th class="num">Stok</th>${l.channel === 'shopee' ? '<th class="num">Terjual</th>' : ''}</tr></thead>
        <tbody>${order.map((i) => { const v = vs[i]; return `<tr><td><span class="d-size">${esc(euOf(v.size) || '–')}</span></td><td class="small muted">${esc(v.sku)}</td>${l.channel === 'blibli' ? `<td class="small">${esc(v.location)}</td>` : ''}
          <td class="num"><input class="d-in ls-in" type="number" min="0" data-vi="${i}" data-vk="price" value="${v.price || ''}" ${canEdit() ? '' : 'disabled'}></td>
          <td class="num"><input class="d-in ls-in" type="number" min="0" data-vi="${i}" data-vk="oldPrice" value="${v.oldPrice || ''}" ${canEdit() ? '' : 'disabled'}></td>
          <td class="num"><span class="ll-disc sm" data-disc="${i}">${disc(v)}</span></td>
          <td class="num"><input class="d-in" type="number" min="0" data-vi="${i}" data-vk="stock" value="${v.stock}" ${canEdit() ? '' : 'disabled'}></td>${l.channel === 'shopee' ? `<td class="num">${num(v.sold)}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>
      <footer>${canEdit() ? '<button class="btn sm" type="button" data-same>Samakan harga semua size</button>' : ''}<span class="spacer"></span><button class="btn sm" type="button" data-close>Tutup</button>${canEdit() ? '<button class="btn sm primary" type="button" data-save>Simpan</button>' : ''}</footer></div>`;
    document.body.appendChild(box);
    let dirty = false;
    const close = () => { if (dirty && !confirm('Perubahan belum disimpan. Tutup?')) return; box.remove(); };
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-close]')) close(); });
    $$('[data-vi]', box).forEach((el) => el.addEventListener('input', () => {
      const v = vs[Number(el.dataset.vi)];
      v[el.dataset.vk] = Math.max(0, Number(el.value) || 0);
      box.querySelector(`[data-disc="${el.dataset.vi}"]`).textContent = disc(v);
      dirty = true;
    }));
    $('[data-same]', box)?.addEventListener('click', () => {
      const first = order[0];
      ['price', 'oldPrice'].forEach((k) => $$(`[data-vk="${k}"]`, box).forEach((el) => { el.value = vs[first][k] || ''; el.dispatchEvent(new Event('input')); }));
    });
    $('[data-link]', box).addEventListener('change', () => { dirty = true; });
    $('[data-save]', box)?.addEventListener('click', async () => {
      if (await saveListing(id, { variants: vs, productId: $('[data-link]', box).value }, 'Listing disimpan')) box.remove();
    });
  }

  // ---------- events ----------
  const drafts = new Map(); // listing id -> variants copy
  function bind(box) {
    $$('[data-lsq]', box).forEach((el) => el.addEventListener('input', () => { st.q = el.value; clearTimeout(st.t); st.t = setTimeout(() => { render(); const q = $('[data-lsq]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); }));
    $$('[data-lsf]', box).forEach((el) => el.addEventListener('change', () => { st[el.dataset.lsf] = el.checked; render(); }));
    $$('[data-quick]', box).forEach((el) => el.addEventListener('click', () => { st[el.dataset.quick] = !st[el.dataset.quick]; render(); }));
    $$('[data-lss]', box).forEach((el) => el.addEventListener('change', () => { st.status = el.value; render(); }));
    $$('[data-lsopen]', box).forEach((tr) => tr.addEventListener('click', () => { st.open = st.open === tr.dataset.lsopen ? '' : tr.dataset.lsopen; render(); }));
    $$('[data-lscard]', box).forEach((b) => b.addEventListener('click', () => { st.open = st.open === b.dataset.lscard ? '' : b.dataset.lscard; drafts.clear(); render(); }));
    $$('[data-lsrow]', box).forEach((tr) => tr.addEventListener('click', () => openListing(tr.dataset.lsrow)));
    $$('[data-link]', box).forEach((el) => el.addEventListener('change', () => saveListing(el.dataset.link, { productId: el.value }, el.value ? 'Listing dihubungkan ke katalog' : 'Hubungan ke katalog dilepas')));
    $$('[data-vi]', box).forEach((el) => el.addEventListener('input', () => {
      const id = st.open, l = B.data.listings.find((x) => x.id === id);
      const vs = drafts.get(id) || l.variants.map((v) => ({ ...v }));
      vs[Number(el.dataset.vi)][el.dataset.vk] = Math.max(0, Number(el.value) || 0);
      drafts.set(id, vs);
      const v = vs[Number(el.dataset.vi)], d = box.querySelector(`[data-disc="${el.dataset.vi}"]`);
      if (d) d.textContent = v.oldPrice > v.price && v.price ? `${Math.round((1 - v.price / v.oldPrice) * 100)}%` : '–';
    }));
    $$('[data-lsall]', box).forEach((b) => b.addEventListener('click', () => {
      const ins = $$('[data-vk="price"]', box), olds = $$('[data-vk="oldPrice"]', box);
      ins.forEach((el) => { el.value = ins[0].value; el.dispatchEvent(new Event('input')); });
      olds.forEach((el) => { el.value = olds[0].value; el.dispatchEvent(new Event('input')); });
    }));
    $$('[data-lssave]', box).forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.lssave;
      if (!drafts.has(id)) { toast('Belum ada perubahan'); return; }
      saveListing(id, { variants: drafts.get(id) }, 'Harga & stok disimpan');
    }));
  }
  async function saveListing(id, patch, msg) {
    const list = B.data.listings.map((l) => (l.id === id ? { ...l, ...patch, updatedAt: stamp(), updatedBy: who() } : l));
    try {
      B.data.listings = await api('/api/listings', json('PUT', list));
      drafts.delete(id);
      toast(msg);
      render();
      return true;
    } catch (e) { toast(e.message, true); return false; }
  }

  // the Produk view belongs to admin.js; render the tabs whenever it opens or the catalog changes
  const whenLoaded = (fn) => { if (B.loaded) { fn(); return; } const t = setInterval(() => { if (B.loaded) { clearInterval(t); fn(); } }, 200); };
  document.addEventListener('admin:view', (e) => { if (e.detail === 'products') whenLoaded(render); });
  document.addEventListener('admin:products', () => { if (!$('#view-products')?.hidden && B.loaded) render(); });
})();
