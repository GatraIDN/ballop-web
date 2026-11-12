// Shopee stock sync, run in the tab seller.shopee.co.id/portal/product/list/all?page=N&size=48 (do every page).
// Paste match.js first (with window.__WH set). Then:
//   await __shopeeScan()          -> {products, variants, diffs, unmatched, archived}
//   await __shopeeApply()         -> writes the diffs through the pencil "Atur Stok" popup, returns a log
// Skips archived/delisted listings (no pencil) and bundles/sets.
(() => {
  const sl = (ms) => new Promise((r) => setTimeout(r, ms));
  const BUNDLE = /bundle|complete set|match set|flex set|play & recover|recovery set|payday/i;
  async function expandAll() {
    const els = [...document.querySelectorAll('*')].filter((e) => /^Lihat Semua \(/.test((e.textContent || '').trim()) && ![...e.children].some((c) => /^Lihat Semua \(/.test(c.textContent.trim())));
    els.forEach((e) => e.click());
    await sl(4000);
  }
  function extract() {
    const L = document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
    const out = []; let cur = null;
    for (let i = 0; i < L.length; i++) {
      if (/^ID Produk: \d+/.test(L[i])) {
        let j = i - 1, parent = '';
        if (L[j].startsWith('SKU Induk:')) { parent = L[j].slice(10).trim(); j--; }
        cur = { name: L[j], parent, id: L[i].match(/\d+/)[0], vars: [] }; out.push(cur);
      } else if (cur && L[i].startsWith('Kode Variasi:')) {
        const s = L.slice(i + 2, i + 7).find((x) => /^\d+( \(Tersedia \d+\))?$/.test(x));
        cur.vars.push({ v: L[i - 1], stock: parseInt(s, 10) });
      }
    }
    return out;
  }
  const rowOf = (pid) => [...document.querySelectorAll('.item-id')].find((e) => e.textContent.includes(pid))?.closest('.eds-table__row');
  window.__shopeeScan = async () => {
    await expandAll();
    const prods = extract(); const diffs = {}; const unmatched = []; const archived = [];
    for (const p of prods) {
      const row = rowOf(p.id);
      if (BUNDLE.test(p.name + ' ' + p.parent)) continue;
      if (!row?.querySelector('.quick-edit-icon') || /Diarsipkan|Delist/.test(row.innerText)) { archived.push(p.name.slice(0, 50)); continue; }
      for (const v of p.vars) {
        const k = window.__matchKey(`${p.name} ${p.parent}`, v.v);
        if (!k) { unmatched.push(`${p.name.slice(0, 40)} | ${v.v} = ${v.stock}`); continue; }
        const want = window.__WH[k];
        if (want !== v.stock) (diffs[p.id] = diffs[p.id] || { name: p.name, t: {} }).t[v.v] = want;
      }
    }
    window.__shopeeDiffs = diffs;
    return { products: prods.length, variants: prods.reduce((a, p) => a + p.vars.length, 0), diffs, unmatched, archived };
  };
  async function upd(pid, targets) {
    const row = rowOf(pid); if (!row) return 'norow';
    const ic = row.querySelector('.quick-edit-icon'); if (!ic) return 'noedit';
    ic.click();
    let m; for (let i = 0; i < 30 && !(m = [...document.querySelectorAll('.list-stock-edit-modal')].find((x) => x.offsetParent)); i++) await sl(200);
    if (!m) return 'nomodal';
    await sl(500);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const log = [];
    for (const inp of [...m.querySelectorAll('input.eds-input__input')].slice(1)) {
      let r = inp; while (r && !r.innerText.includes('SKU:')) r = r.parentElement;
      const label = r ? r.innerText.trim().split('\n')[0].trim() : '';
      if (label in targets && String(targets[label]) !== inp.value) {
        log.push(`${label}:${inp.value}>${targets[label]}`);
        inp.focus(); setter.call(inp, String(targets[label]));
        inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); inp.blur();
      }
    }
    await sl(400);
    const btn = (t) => [...m.querySelectorAll('button')].find((b) => b.innerText.trim() === t);
    if (!log.length) { btn('Batal').click(); await sl(500); return 'nochange'; }
    btn('Update').click();
    for (let i = 0; i < 40 && m.offsetParent; i++) await sl(250);
    return (m.offsetParent ? 'STILL OPEN ' : 'ok ') + log.join(', ');
  }
  window.__shopeeApply = async () => {
    const out = [];
    for (const [pid, d] of Object.entries(window.__shopeeDiffs || {})) { out.push(`${d.name.slice(0, 40)} -> ${await upd(pid, d.t)}`); await sl(600); }
    return out;
  };
  return 'shopee stock helpers ready';
})();
