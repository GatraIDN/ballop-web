// TikTok/Tokopedia stock sync, run in the tab seller-id.tokopedia.com/product/manage?tab=active.
// The page often re-renders and drops globals, so state lives in localStorage and each call runs ~30 s:
//   1. once:  localStorage.__WH = '<wh.json content>'; localStorage.__MATCH = '<match.js>'; localStorage.__RUN = '<this whole file>';
//             localStorage.__doneT = '{}'; localStorage.__logT = '[]'; localStorage.__unT = '{}';
//   2. repeat: eval(localStorage.__RUN); await new Promise(r => setTimeout(r, 34000)); localStorage.__state
//      until __state === 'complete' AND every product is loaded (scroll to the bottom between runs: lazy list, 46+ products).
//   3. read results: JSON.parse(localStorage.__logT) (changes), JSON.parse(localStorage.__unT) (unmatched SKUs).
// Compares with "Total stock" in the popover (list number = available only, without reserved).
(async () => {
  window.__WH = JSON.parse(localStorage.__WH);
  if (!window.__matchKey && localStorage.__MATCH) eval(localStorage.__MATCH);
  if (!window.__matchKey) { localStorage.__state = 'need match.js in localStorage.__MATCH'; return; }
  const sl = (ms) => new Promise((r) => setTimeout(r, ms)); const T0 = Date.now();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const done = JSON.parse(localStorage.__doneT || '{}'), log = JSON.parse(localStorage.__logT || '[]'), un = JSON.parse(localStorage.__unT || '{}');
  const save = () => { localStorage.__doneT = JSON.stringify(done); localStorage.__logT = JSON.stringify(log); localStorage.__unT = JSON.stringify(un); };
  const vis = () => [...document.querySelectorAll('.core-popover-inner-content')].filter((e) => e.offsetParent && /Total stock/.test(e.innerText));
  const cancel = (p) => [...p.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Cancel')?.click();
  async function upd(inp, want) {
    for (const p of vis()) { cancel(p); await sl(200); }
    inp.scrollIntoView({ block: 'center' }); await sl(300);
    for (const ty of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) inp.dispatchEvent(new MouseEvent(ty, { bubbles: true }));
    inp.focus();
    let pop; for (let i = 0; i < 15 && !(pop = vis()[0]); i++) await sl(200);
    if (!pop) return 'nopop';
    const ti = pop.querySelector('input'); if (!ti) { cancel(pop); return 'noinput'; }
    const tot = parseInt(ti.value, 10);
    if (tot === want) { cancel(pop); return 'same'; }
    ti.focus(); setter.call(ti, String(want));
    ti.dispatchEvent(new Event('input', { bubbles: true })); ti.dispatchEvent(new Event('change', { bubbles: true }));
    await sl(300);
    const sb = [...pop.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Save');
    if (!sb || sb.disabled) return 'savedisabled';
    sb.click(); for (let i = 0; i < 20; i++) { await sl(250); if (!pop.offsetParent) break; }
    await sl(500);
    return `ok total ${tot}>${want}`;
  }
  [...document.querySelectorAll('*')].filter((e) => e.children.length <= 2 && /^Expand$/.test((e.innerText || '').trim())).forEach((e) => e.click());
  await sl(1500);
  let name = null, pid = null;
  for (const tr of document.querySelectorAll('tr')) {
    if (Date.now() - T0 > 30000) { localStorage.__state = 'partial'; save(); return; }
    const t = tr.innerText || ''; const idm = t.match(/ID:(\d{10,})/);
    if (idm && !/_skuRow/.test(tr.className)) { name = t.split('\n').map((s) => s.trim()).filter(Boolean)[0]; pid = idm[1]; continue; }
    if (!pid || !/_skuRow/.test(tr.className)) continue;
    const v = t.split('\n').map((s) => s.trim()).filter(Boolean)[0];
    const inp = tr.querySelector('input.core-input'); if (!inp) continue;
    const key = `${pid}|${v}`; if (done[key]) continue;
    if (/bundle|set\b/i.test(name)) { done[key] = 'bundle'; continue; }
    const wh = window.__matchKey(name, v);
    if (!wh) { un[`${name.slice(0, 40)}|${v}`] = parseInt(inp.value, 10); done[key] = 'un'; continue; }
    let res; try { res = await upd(inp, window.__WH[wh]); } catch (e) { res = `ERR ${e.message}`; }
    done[key] = res;
    if (res !== 'same') log.push(`${name.slice(6, 34)}|${v}|list ${inp.value}|${res}`);
    save();
  }
  localStorage.__state = 'complete'; save();
})();
