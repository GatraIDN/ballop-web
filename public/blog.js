// BALLOP Jurnal: /blog lists posts, /blog/<slug> reads one. Navigation stays in-page and uses the
// View Transitions API (where supported) so the clicked cover morphs into the article cover.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const { esc, t } = window.BALLOP;
  const isPng = (src) => /\.png($|\?)/i.test(src || '');
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const fmtDate = (iso) => { const [y, m, d] = (iso || '').split('-').map(Number); return y ? `${d} ${MONTHS[m - 1]} ${y}` : ''; };
  const readMin = (body) => Math.max(1, Math.round(String(body || '').split(/\s+/).length / 200));

  let posts = [];
  let tag = '';
  $('#year').textContent = new Date().getFullYear();

  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2000);
  }

  const card = (p, big) => `
    <a class="post-card solid${big ? ' big' : ''}" href="/blog/${encodeURIComponent(p.slug)}" data-slug="${esc(p.slug)}">
      <div class="pc-cover">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy" class="${isPng(p.cover) ? 'contain' : ''}">` : ''}</div>
      <div class="pc-body">
        <p class="pc-meta">${(p.tags || []).slice(0, 2).map((x) => `<span>${esc(x)}</span>`).join('')}<time>${esc(fmtDate(p.date))}</time></p>
        <h3>${esc(p.title)}</h3>
        ${p.excerpt ? `<p class="pc-ex">${esc(p.excerpt)}</p>` : ''}
        <span class="ev-more">${esc(t('blog.read', 'Baca'))} <i>→</i></span>
      </div>
    </a>`;

  function renderList() {
    const q = $('#search').value.trim().toLowerCase();
    const shown = posts.filter((p) => (!tag || (p.tags || []).includes(tag))
      && (!q || `${p.title} ${p.excerpt} ${(p.tags || []).join(' ')} ${p.body}`.toLowerCase().includes(q)));
    $('#grid').innerHTML = shown.length
      ? shown.map((p, i) => card(p, i === 0 && !q && !tag)).join('')
      : `<p class="empty-note solid">${esc(t('blog.empty', 'Belum ada artikel.'))}</p>`;
    wireCards($('#grid'));
  }

  function renderTags() {
    const all = [...new Set(posts.flatMap((p) => p.tags || []))];
    $('#tags').innerHTML = all.length ? [['', 'SEMUA'], ...all.map((x) => [x, x])]
      .map(([v, label]) => `<button type="button" data-tag="${esc(v)}" class="${v === tag ? 'on' : ''}">${esc(label)}</button>`).join('') : '';
    $$('#tags button').forEach((b) => b.addEventListener('click', () => {
      tag = b.dataset.tag;
      $$('#tags button').forEach((x) => x.classList.toggle('on', x === b));
      renderList();
    }));
  }

  function renderPost(p) {
    document.title = `${p.title} — BALLOP`;
    $('#pMeta').innerHTML = `${(p.tags || []).map((x) => `<span>${esc(x)}</span>`).join('')}<time>${esc(fmtDate(p.date))} · ${readMin(p.body)} menit baca</time>`;
    $('#pTitle').textContent = p.title;
    $('#pEx').textContent = p.excerpt || '';
    $('#pBy').textContent = p.author ? `Oleh ${p.author}` : '';
    $('#pCover').innerHTML = p.cover ? `<img src="${esc(p.cover)}" alt="" class="${isPng(p.cover) ? 'contain' : ''}">` : '';
    $('#pCover').hidden = !p.cover;
    $('#pBody').innerHTML = window.renderMarkdown(p.body);
    const url = location.href;
    $('#shareWa').href = `https://wa.me/?text=${encodeURIComponent(`${p.title} ${url}`)}`;
    const rel = posts.filter((x) => x !== p).sort((a, b) => {
      const shared = (x) => (x.tags || []).filter((tg) => (p.tags || []).includes(tg)).length;
      return shared(b) - shared(a) || b.date.localeCompare(a.date);
    }).slice(0, 3);
    $('.b-related').hidden = !rel.length;
    $('#related').innerHTML = rel.map((x) => card(x)).join('');
    wireCards($('#related'));
  }

  $('#shareCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); toast('Link disalin'); } catch { toast(location.href); }
  });

  function slugFromPath() {
    const m = location.pathname.match(/^\/blog\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function show() {
    const slug = slugFromPath();
    const p = slug && posts.find((x) => x.slug === slug);
    $('#listView').hidden = !!p;
    $('#postView').hidden = !p;
    if (p) renderPost(p);
    else {
      document.title = 'Jurnal — BALLOP Indonesia';
      renderList();
    }
  }

  // in-page navigation with a cover morph
  function go(href, coverEl) {
    const doIt = () => { history.pushState(null, '', href); show(); scrollTo({ top: 0, behavior: 'instant' }); };
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { doIt(); return; }
    if (coverEl) coverEl.style.viewTransitionName = 'cover';
    const vt = document.startViewTransition(() => {
      if (coverEl) coverEl.style.viewTransitionName = '';
      doIt();
      const target = $('#pCover img') || $('#grid .pc-cover img');
      if (target) target.style.viewTransitionName = 'cover';
    });
    vt.finished.finally(() => $$('[style*="view-transition-name"]').forEach((n) => { n.style.viewTransitionName = ''; }));
  }
  function wireCards(root) {
    $$('a.post-card', root).forEach((a) => a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      go(a.getAttribute('href'), $('.pc-cover img', a));
    }));
  }
  $('#backLink').addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    go('/blog', $('#pCover img'));
  });
  addEventListener('popstate', show);
  $('#search').addEventListener('input', renderList);

  Promise.all([BALLOP.content, fetch('/api/posts').then((r) => r.json()).catch(() => [])]).then(([c, list]) => {
    BALLOP.apply(c);
    $('#search').placeholder = t('blog.search', 'Cari artikel…');
    posts = list;
    renderTags();
    show();
  });
})();
