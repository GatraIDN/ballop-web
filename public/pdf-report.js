// BALLOP admin: one print-ready A4 report template shared by every export (dashboard, order, income, CS).
// PdfReport.open({ title, period, meta: [[label, value]], body, note, onePage }) opens it in a new tab;
// the viewer saves it as PDF with the browser's print dialog. body uses the helpers below.
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const longDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const period = (from, to) => (from === to ? longDate(from) : `${longDate(from)} – ${longDate(to)}`);
  const rp = (n) => `Rp ${Math.round(n || 0).toLocaleString('id-ID')}`;
  const num = (n) => Math.round(n || 0).toLocaleString('id-ID');
  const pct = (n, d = 1) => (Number.isFinite(n) ? `${(n * 100).toLocaleString('id-ID', { maximumFractionDigits: d })}%` : '–');
  // ▲▼ change vs a previous value; inv = lower is better
  const chg = (a, b, inv) => {
    if (!b || !Number.isFinite(a) || !Number.isFinite(b)) return '';
    const d = (a - b) / Math.abs(b), good = inv ? d < 0 : d > 0;
    return `<span class="chg ${d === 0 ? '' : good ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${pct(Math.abs(d))}</span>`;
  };
  const tile = (label, value, sub = '', hero = false) => `<div class="tile${hero ? ' hero' : ''}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
  const tiles = (list, cols = 4) => `<div class="tiles" style="grid-template-columns:repeat(${cols},1fr)">${list.join('')}</div>`;
  const h2 = (title, small = '') => `<h2>${title}${small ? ` <small>${small}</small>` : ''}</h2>`;
  // cols: [label, 'n' for numeric]; rows: arrays of cell html; foot: optional total row
  const table = (cols, rows, foot, empty = 'Tidak ada data.') => `<table><thead><tr>${cols.map(([l, n]) => `<th${n ? ' class="n"' : ''}>${l}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c, i) => `<td${cols[i]?.[1] ? ' class="n"' : ''}>${c ?? ''}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="empty">${empty}</td></tr>`}
    ${foot ? `<tr class="tot">${foot.map((c, i) => `<td${cols[i]?.[1] ? ' class="n"' : ''}>${c ?? ''}</td>`).join('')}</tr>` : ''}</tbody></table>`;
  const dot = (color) => `<span class="dot" style="background:${color}"></span>`;
  const bars = (vals, max) => `<div class="tb">${vals.map(([v, c]) => `<i style="width:${max ? Math.max(0, (v / max) * 100) : 0}%;background:${c}"></i>`).join('')}</div>`;

  const CSS = `
  @page { size: A4; margin: 12mm 12mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, system-ui, sans-serif; color: #15171c; font-size: 10.5px; line-height: 1.45; background: #eceef2; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; margin: 16px auto; padding: 12mm 12mm 14mm; background: #fff; box-shadow: 0 6px 30px rgba(0,0,0,.12); }
  .bar { position: sticky; top: 0; z-index: 5; display: flex; gap: 10px; justify-content: center; align-items: center; padding: 10px; background: #15171c; color: #b9bdc6; font-size: 12px; }
  .bar button { font: 700 13px Inter, sans-serif; padding: 9px 18px; border-radius: 9px; border: 0; cursor: pointer; background: #fff; color: #15171c; }
  .bar button.alt { background: transparent; color: #fff; border: 1px solid #555; }
  @media print { body { background: #fff; } .page { margin: 0; padding: 0; width: auto; min-height: 0; box-shadow: none; } .bar { display: none; } }
  header.top { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid #15171c; }
  header.top img { height: 32px; display: block; }
  header.top .meta { text-align: right; color: #5c616b; font-size: 10px; }
  header.top .meta b { display: block; font-size: 17px; color: #15171c; letter-spacing: -.01em; }
  .lead { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px 18px; margin: 12px 0 4px; padding: 10px 14px; border-radius: 10px; background: #f4f5f8; }
  .lead span { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .08em; color: #6b7079; font-weight: 700; }
  .lead b { font-size: 11.5px; }
  h2 { font-size: 12px; margin: 16px 0 7px; padding-bottom: 5px; border-bottom: 1px solid #dfe2e8; display: flex; justify-content: space-between; align-items: baseline; gap: 10px; break-after: avoid; }
  h2 small { font-weight: 600; color: #7a7f88; font-size: 8.5px; }
  .tiles { display: grid; gap: 7px; }
  .tile { border: 1px solid #e3e6eb; border-radius: 9px; padding: 8px 10px; break-inside: avoid; min-width: 0; }
  .tile.hero { background: #15171c; color: #fff; border-color: #15171c; }
  .tile.hero > span, .tile.hero small { color: #b9bdc6; }
  .tile > span { display: block; font-size: 8.5px; font-weight: 700; color: #6b7079; text-transform: uppercase; letter-spacing: .05em; }
  .tile b { display: block; font-size: 14px; font-weight: 900; margin: 3px 0 1px; letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile small { color: #7a7f88; font-size: 8.5px; }
  .chg { font-weight: 700; } .chg.up { color: #0e8a4f; } .chg.down { color: #d93a3e; }
  .tile.hero .chg.up { color: #5fe0a2; } .tile.hero .chg.down { color: #ff8a8d; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: .05em; color: #6b7079; font-weight: 700; padding: 6px; background: #f4f5f8; }
  td { padding: 5px 6px; border-bottom: 1px solid #eceef2; vertical-align: top; }
  td.empty { text-align: center; color: #7a7f88; padding: 14px; }
  .n { text-align: right; white-space: nowrap; }
  tr.tot td { font-weight: 800; border-top: 2px solid #15171c; border-bottom: 0; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
  .mix { display: flex; height: 10px; border-radius: 5px; overflow: hidden; margin-bottom: 8px; gap: 2px; } .mix i { display: block; }
  .tb { display: grid; gap: 2px; min-width: 80px; } .tb i { display: block; height: 5px; border-radius: 3px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; break-inside: avoid; }
  .two > div { min-width: 0; }
  .pl td { padding: 6px 4px; } .pl .sub td { color: #6b7079; padding-left: 14px; } .pl .mid td { font-weight: 800; } .pl .total td { font-weight: 900; font-size: 12px; border-top: 2px solid #15171c; border-bottom: 0; }
  .pos { color: #0e8a4f; } .neg { color: #d93a3e; } .muted { color: #7a7f88; }
  .rank { display: inline-flex; width: 16px; height: 16px; border-radius: 5px; align-items: center; justify-content: center; background: #15171c; color: #fff; font-size: 8.5px; font-weight: 800; margin-right: 6px; }
  .box { border: 1px solid #e3e6eb; border-radius: 9px; padding: 9px 11px; break-inside: avoid; }
  .box p { margin: 0 0 4px; }
  .chip { display: inline-block; padding: 1px 7px; border-radius: 99px; font-size: 8.5px; font-weight: 700; background: #eceef2; }
  .chip.ok { background: #dff4ea; color: #0e8a4f; } .chip.bad { background: #fde3e3; color: #d93a3e; } .chip.warn { background: #fff1d6; color: #9a6400; }
  .avoid { break-inside: avoid; }
  .note { color: #7a7f88; font-size: 8.5px; margin-top: 16px; padding-top: 8px; border-top: 1px solid #dfe2e8; display: flex; justify-content: space-between; gap: 16px; }
  .sign { display: flex; justify-content: flex-end; gap: 40px; margin-top: 22px; break-inside: avoid; }
  .sign div { text-align: center; min-width: 150px; font-size: 9.5px; color: #5c616b; }
  .sign div i { display: block; height: 46px; border-bottom: 1px solid #15171c; margin-bottom: 4px; }
  .one-page .page { min-height: 0; }
  @media print { .one-page .page { zoom: var(--fit, 1); } }`;

  function open({ title, period: per, meta = [], body, note, sign, onePage, fileName }) {
    const now = new Date();
    const y = now.getFullYear(), mo = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
    const made = `${longDate(`${y}-${mo}-${d}`)}, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const logo = `${location.origin}/img/ballop-wordmark-dark.png`;
    const docTitle = fileName || `BALLOP ${title} ${per || ''}`.trim();
    const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(docTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body class="${onePage ? 'one-page' : ''}">
<div class="bar"><button onclick="window.print()">⬇ Simpan PDF / Print</button><button class="alt" onclick="window.close()">Tutup</button><span>Pilih "Save as PDF" di dialog print${onePage ? ' · otomatis muat 1 lembar' : ''}</span></div>
<div class="page">
  <header class="top"><img src="${logo}" alt="BALLOP"><div class="meta"><b>${esc(title)}</b>${esc(per || '')}</div></header>
  <div class="lead">${[...meta, ['Dibuat', made]].map(([l, v]) => `<div><span>${esc(l)}</span><b>${v}</b></div>`).join('')}</div>
  ${body}
  ${sign ? `<div class="sign">${sign.map((s) => `<div><i></i>${esc(s)}</div>`).join('')}</div>` : ''}
  <div class="note"><span>${note || ''}</span><span>BALLOP · ballop.web.id</span></div>
</div>
${onePage ? `<script>
  // shrink to one A4 page (printable height ≈ 271mm at 96dpi) when the content runs longer
  addEventListener('beforeprint', () => { const p = document.querySelector('.page'); p.style.zoom = 1; const h = p.scrollHeight, max = 271 * 96 / 25.4; p.style.zoom = h > max ? (max / h).toFixed(3) : 1; });
  addEventListener('afterprint', () => { document.querySelector('.page').style.zoom = 1; });
</script>` : ''}
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { window.A?.toast?.('Pop-up diblokir browser. Izinkan pop-up untuk halaman admin ini.', true); return null; }
    w.document.open(); w.document.write(html); w.document.close();
    return html;
  }

  window.PdfReport = { open, esc, rp, num, pct, chg, tile, tiles, h2, table, dot, bars, longDate, period };
})();
