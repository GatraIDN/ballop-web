// Landing copy from the admin's Konten editor. Elements opt in with:
//   data-t="hero.title"   -> textContent (newlines kept)
//   data-md="story.p1"    -> inline **bold** / *italic*
//   data-src="hero.image" -> img src
window.BALLOP = (() => {
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');

  const content = fetch('/api/content').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  let current = {};
  content.then((c) => { current = c || {}; });

  function apply(c, root = document) {
    root.querySelectorAll('[data-t]').forEach((el) => {
      const v = get(c, el.dataset.t);
      if (typeof v === 'string' || typeof v === 'number') el.textContent = v;
    });
    root.querySelectorAll('[data-md]').forEach((el) => {
      const v = get(c, el.dataset.md);
      if (typeof v === 'string') el.innerHTML = inline(v);
    });
    root.querySelectorAll('[data-src]').forEach((el) => {
      const v = get(c, el.dataset.src);
      if (typeof v === 'string' && /^(\/|https:\/\/)/.test(v)) el.src = v;
    });
    const seo = c.seo || {};
    if (seo.title && document.body.dataset.page !== 'blog') document.title = seo.title;
    if (seo.description) document.querySelector('meta[name="description"]')?.setAttribute('content', seo.description);
  }

  // t('sku.added', 'masuk keranjang') — current copy with a fallback
  const t = (path, fallback = '') => {
    const v = get(current, path);
    return v == null || v === '' ? fallback : v;
  };

  return { content, get, esc, inline, apply, t };
})();
