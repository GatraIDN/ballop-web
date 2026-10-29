// BALLOP landing: everything around the catalog (app.js owns the catalog + SKU view).
// All copy comes from /api/content (admin > Konten); the HTML holds the same text as fallback.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const { esc, inline, t } = window.BALLOP;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const isPng = (src) => /\.png($|\?)/i.test(src || '');
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];
  const MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  $('#year').textContent = new Date().getFullYear();

  // ---------- big logo that docks into the header ----------
  const logo = $('#morphLogo');
  const space = $('#heroLogo');
  const slot = $('#brandSlot');
  const bar = $('#top-bar');
  let start = null, end = null;

  function measureLogo() {
    const r = space.getBoundingClientRect();
    start = { left: r.left, top: r.top + scrollY, width: r.width }; // document coords, so it scrolls in sync at first
    const s = slot.getBoundingClientRect();
    end = { left: s.left, top: s.top, width: s.width };
    logo.style.width = `${start.width}px`;
    placeLogo();
  }
  function placeLogo() {
    if (!start) return;
    const range = Math.max(innerHeight * 0.55, 260);
    const k = easeInOut(clamp(scrollY / range));
    // at k=0 the logo sits on the hero (moves with the page), at k=1 it is pinned in the header
    const x = lerp(start.left, end.left, k);
    const y = lerp(start.top - scrollY, end.top, k);
    const s = lerp(1, end.width / start.width, k);
    logo.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
    logo.classList.toggle('docked', k > 0.98);
    bar.classList.toggle('scrolled', k > 0.98);
  }

  // ---------- hero parallax + pointer tilt ----------
  const heroShoe = $('#heroShoe');
  const heroCopy = $('.hero-copy');
  function heroScroll() {
    const p = clamp(scrollY / innerHeight);
    if (p >= 1) return;
    heroShoe.style.transform = `translate3d(0, ${scrollY * 0.35}px, 0) rotate(${p * 14}deg) scale(${1 - p * 0.15})`;
    heroCopy.style.opacity = String(1 - p * 1.6);
    heroCopy.style.transform = `translateY(${scrollY * 0.15}px)`;
  }
  if (finePointer && !reduce) {
    const tilt = $('.hero-shoe .tilt');
    $('.hero').addEventListener('pointermove', (e) => {
      tilt.style.setProperty('--tx', `${(e.clientX / innerWidth - 0.5) * 22}deg`);
      tilt.style.setProperty('--ty', `${-(e.clientY / innerHeight - 0.5) * 14}deg`);
    });
    $('.hero').addEventListener('pointerleave', () => { tilt.style.setProperty('--tx', '0deg'); tilt.style.setProperty('--ty', '0deg'); });
  }

  // ---------- marquee leans with scroll speed ----------
  const marquee = $('#marquee');
  let lastY = scrollY, skew = 0;
  function marqueeSkew() {
    const v = scrollY - lastY;
    lastY = scrollY;
    skew = lerp(skew, clamp(v * -0.25, -10, 10), 0.15);
    if (Math.abs(skew) < 0.01) skew = 0;
    marquee.style.setProperty('--skew', `${skew.toFixed(2)}deg`);
    return skew !== 0;
  }

  // ---------- active nav link ----------
  const navLinks = $$('.links a');
  const sections = navLinks.map((a) => $(a.getAttribute('href')));
  function activeLink() {
    const mid = innerHeight * 0.4;
    let idx = -1;
    sections.forEach((s, i) => { if (s && s.getBoundingClientRect().top < mid) idx = i; });
    navLinks.forEach((a, i) => a.classList.toggle('on', i === idx));
  }

  let ticking = false;
  function frame() {
    ticking = false;
    placeLogo();
    heroScroll();
    activeLink();
    if (!reduce && marqueeSkew()) requestTick();
  }
  function requestTick() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  addEventListener('scroll', requestTick, { passive: true });
  addEventListener('resize', () => { measureLogo(); requestTick(); });

  // ---------- reveal on scroll ----------
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      revealIO.unobserve(en.target);
      if (en.target.classList.contains('stat')) countUp($('b', en.target));
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  function observeReveal(root = document) {
    // stagger siblings that reveal together
    const groups = new Map();
    $$('[data-reveal]:not(.in), .merge:not(.in), .timeline:not(.in)', root).forEach((n) => {
      const g = groups.get(n.parentElement) || [];
      g.push(n);
      groups.set(n.parentElement, g);
      revealIO.observe(n);
    });
    groups.forEach((g) => g.forEach((n, i) => n.style.setProperty('--rd', `${Math.min(i, 8) * 0.08}s`)));
  }

  // sections with idle loops only animate while visible
  const liveIO = new IntersectionObserver((entries) => entries.forEach((en) => en.target.classList.toggle('live', en.isIntersecting)), { rootMargin: '10% 0px' });
  $$('section[data-live]').forEach((s) => liveIO.observe(s));

  function countUp(b) {
    const target = Number(b.dataset.count) || 0;
    const suffix = b.dataset.suffix || '';
    const plain = b.dataset.plain === '1';
    const fmt = (n) => (plain ? String(n) : n.toLocaleString('id-ID')) + suffix;
    if (reduce) { b.textContent = fmt(target); return; }
    const from = plain ? Math.max(0, target - 40) : 0;
    const t0 = performance.now(), dur = 1800;
    const step = (now) => {
      const k = clamp((now - t0) / dur);
      b.textContent = fmt(Math.round(lerp(from, target, 1 - Math.pow(1 - k, 4))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(() => { b.textContent = fmt(target); }, dur + 300); // exact value even if rAF is throttled
  }

  // ---------- content-driven pieces ----------
  function renderMarquee(c) {
    const items = (c.marquee && c.marquee.items && c.marquee.items.length) ? c.marquee.items : ['GALLOP LIGHTLY, BALLOP!'];
    const once = items.map((s) => `<span>${esc(s)}</span><b>✦</b>`).join('');
    marquee.innerHTML = once + once;
  }

  // WORD1 + WORD2 = WORD3: the letters of word3 found in word1/word2 glow in turn while idle
  function renderMerge(c) {
    const st = c.story || {};
    const w1 = st.word1 || 'BAREFOOT', w2 = st.word2 || 'GALLOP', w3 = st.word3 || 'BALLOP';
    const marks = [new Set(), new Set()];
    let wi = 0, pos = 0, k = 0;
    const words = [w1, w2];
    for (const ch of w3) {
      while (wi < 2) {
        const at = words[wi].toUpperCase().indexOf(ch.toUpperCase(), pos);
        if (at >= 0) { marks[wi].add(at); pos = at + 1; break; }
        wi += 1; pos = 0;
      }
    }
    const spell = (w, set) => [...w].map((ch, i) => (set.has(i) ? `<span class="k" style="--i:${k++}">${esc(ch)}</span>` : esc(ch))).join('');
    const h = $('#merge');
    h.setAttribute('aria-label', `${w1} + ${w2} = ${w3}`);
    h.innerHTML = `<span class="w1" aria-hidden="true">${spell(w1, marks[0])}</span><span class="plus" aria-hidden="true">+</span><span class="w2" aria-hidden="true">${spell(w2, marks[1])}</span><span class="eq" aria-hidden="true">=</span><span class="w3" aria-hidden="true">${esc(w3)}</span>`;
  }

  function renderStats(c) {
    const stats = (c.story && c.story.stats) || [];
    $('#stats').innerHTML = stats.map((s) => `
      <div class="stat solid" data-reveal>
        <b data-count="${Number(s.value) || 0}" data-suffix="${esc(s.suffix || '')}" data-plain="${s.plain ? 1 : 0}">${s.plain ? esc(s.value) : (Number(s.value) || 0).toLocaleString('id-ID')}${esc(s.suffix || '')}</b>
        <span>${esc(s.label)}</span>
      </div>`).join('');
    const tl = (c.story && c.story.timeline) || [];
    $('#tlTrack').innerHTML = tl.map((x, i) => `<li data-reveal class="${i === tl.length - 1 ? 'now' : ''}"><b>${esc(x.year)}</b><span>${esc(x.text)}</span></li>`).join('');
    $('#tlTrack').style.setProperty('--n', Math.max(tl.length, 1));
  }

  const TECH_ICONS = [
    '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z"/>',
    '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/>',
    '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
    '<path d="M8 3c-2 0-3 2-3 5s1 7 3 9 4 1 4-2-1-5-1-8-1-4-3-4zM16 7c2 0 3 2 3 4s-1 5-3 6-3 0-3-2 0-3 1-5 0-3 2-3z"/>',
    '<ellipse cx="10" cy="9" rx="6" ry="6.5"/><path d="M14 14l6 6"/><circle cx="18" cy="5" r="1.6"/>',
    '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  ];
  let techTimer = 0;
  function renderTech(c) {
    const feats = (c.tech && c.tech.features) || [];
    const stage = $('#techStage');
    $$('.hot-dot', stage).forEach((d) => d.remove());
    feats.forEach((f, i) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'hot-dot';
      d.dataset.f = i;
      d.style.setProperty('--x', `${clamp(Number(f.x) || 50, 0, 100)}%`);
      d.style.setProperty('--y', `${clamp(Number(f.y) || 50, 0, 100)}%`);
      d.setAttribute('aria-label', f.title || '');
      stage.appendChild(d);
    });
    $('#techList').innerHTML = feats.map((f, i) => `
      <li data-f="${i}" data-reveal class="glass">
        <svg viewBox="0 0 24 24" aria-hidden="true">${TECH_ICONS[i % TECH_ICONS.length]}</svg>
        <div><b>${esc(f.title)}</b><span>${esc(f.text)}</span></div>
      </li>`).join('');

    // auto-cycle while idle, hold for a while after the visitor points at something
    const items = $$('#techList li'), dots = $$('.hot-dot', stage);
    let cur = 0, hold = 0;
    const set = (i) => {
      cur = i;
      items.forEach((li) => li.classList.toggle('on', Number(li.dataset.f) === i));
      dots.forEach((d) => d.classList.toggle('on', Number(d.dataset.f) === i));
    };
    const pick = (i) => { set(i); hold = Date.now() + 8000; };
    [...items, ...dots].forEach((n) => {
      n.addEventListener('mouseenter', () => pick(Number(n.dataset.f)));
      n.addEventListener('click', () => pick(Number(n.dataset.f)));
    });
    set(0);
    clearInterval(techTimer);
    techTimer = setInterval(() => {
      if (!items.length || !$('#teknologi').classList.contains('live') || Date.now() < hold || reduce) return;
      set((cur + 1) % items.length);
    }, 3200);
  }

  // ---------- mobile menu ----------
  const burger = $('#burger');
  const setMenu = (open) => {
    document.body.classList.toggle('menu-open', open);
    document.body.classList.toggle('noscroll', open);
    burger.setAttribute('aria-expanded', String(open));
  };
  burger.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  $$('#menu a').forEach((a) => a.addEventListener('click', () => setMenu(false)));

  // ---------- lightbox (shared by gallery + event photos) ----------
  const lb = { el: $('#lightbox'), img: $('#lbImg'), cap: $('#lbCap'), count: $('#lbCount'), list: [], i: 0 };
  async function openLightbox(list, i, fromEl) {
    lb.list = list;
    lb.el.hidden = false;
    lb.el.classList.remove('closing');
    document.body.classList.add('noscroll');
    await showShot(i, 0);
    // morph: start the big image at the thumbnail's box
    if (fromEl && !reduce) {
      const a = fromEl.getBoundingClientRect(), b = lb.img.getBoundingClientRect();
      if (b.width) {
        lb.img.animate(
          [{ transform: `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px, ${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(${a.width / b.width})` }, { transform: 'none' }],
          { duration: 600, easing: 'cubic-bezier(.16, 1, .3, 1)' },
        );
      }
    }
    $('.lb-x', lb.el).focus({ preventScroll: true });
  }
  async function showShot(i, dir) {
    const n = lb.list.length;
    lb.i = (i + n) % n;
    const s = lb.list[lb.i];
    if (dir && !reduce) await lb.img.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 60}px) scale(.96)` }], { duration: 180, easing: 'ease-in', fill: 'forwards' }).finished;
    lb.img.src = s.image;
    lb.img.alt = s.caption || '';
    lb.img.className = isPng(s.image) ? 'contain' : '';
    lb.cap.textContent = s.caption || '';
    lb.count.textContent = n > 1 ? `${lb.i + 1} / ${n}` : '';
    await lb.img.decode().catch(() => {});
    lb.img.getAnimations().forEach((a) => a.cancel());
    if (dir && !reduce) lb.img.animate([{ opacity: 0, transform: `translateX(${dir * 60}px) scale(.96)` }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    $('.lb-nav.prev', lb.el).hidden = n < 2;
    $('.lb-nav.next', lb.el).hidden = n < 2;
  }
  function closeLightbox() {
    if (lb.el.hidden) return;
    lb.el.classList.add('closing');
    setTimeout(() => {
      lb.el.hidden = true;
      if ($('#eventModal').hidden) document.body.classList.remove('noscroll');
    }, reduce ? 0 : 280);
  }
  $('.lb-x', lb.el).addEventListener('click', closeLightbox);
  $('.lb-nav.prev', lb.el).addEventListener('click', () => showShot(lb.i - 1, -1));
  $('.lb-nav.next', lb.el).addEventListener('click', () => showShot(lb.i + 1, 1));
  lb.el.addEventListener('click', (e) => { if (e.target === lb.el) closeLightbox(); });
  let touchX = null;
  lb.el.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  lb.el.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50 && lb.list.length > 1) showShot(lb.i + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  });

  // ---------- events ----------
  let events = [];
  const dateParts = (iso) => {
    const [y, m, d] = (iso || '').split('-').map(Number);
    return y ? { y, m, d } : null;
  };
  const isUpcoming = (iso) => {
    const p = dateParts(iso);
    if (!p) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return new Date(p.y, p.m - 1, p.d) >= today;
  };
  const pin = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

  function renderEvents() {
    const list = $('#eventList');
    if (!events.length) {
      list.innerHTML = `<p class="empty-note solid" data-reveal>${esc(t('events.empty', 'Belum ada event.'))}</p>`;
      observeReveal(list);
      return;
    }
    list.innerHTML = events.map((ev, i) => {
      const p = dateParts(ev.date);
      const up = isUpcoming(ev.date);
      const cover = ev.cover || ev.photos[0] || '';
      return `
        <article class="event-card solid${i === 0 ? ' featured' : ''}" data-reveal>
          <div class="ev-cover">
            ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" class="${isPng(cover) ? 'contain' : ''}">` : ''}
            ${p ? `<div class="ev-date glass"><b>${p.d}</b><span>${MONTHS[p.m - 1]} ${String(p.y).slice(2)}</span></div>` : ''}
            <span class="ev-tag${up ? ' up' : ''}">${esc(up ? t('events.upcoming', 'SEGERA') : t('events.done', 'SELESAI'))}</span>
          </div>
          <div class="ev-body">
            <h3>${esc(ev.title)}</h3>
            ${ev.venue ? `<p class="ev-venue">${pin}${esc(ev.venue)}${ev.city ? `, ${esc(ev.city)}` : ''}</p>` : ''}
            ${ev.summary ? `<p class="ev-sum">${esc(ev.summary)}</p>` : ''}
            <span class="ev-more">${esc(t('events.more', 'Lihat detail'))} <i>→</i></span>
          </div>
          <button class="stretch" type="button" data-ev="${i}" aria-label="${esc(ev.title)}"></button>
        </article>`;
    }).join('');
    $$('[data-ev]', list).forEach((b) => b.addEventListener('click', () => openEvent(events[Number(b.dataset.ev)], b)));
    observeReveal(list);
  }

  const modal = $('#eventModal');
  let modalReturn = null;
  function openEvent(ev, from) {
    modalReturn = from;
    const p = dateParts(ev.date);
    const cover = ev.cover || ev.photos[0] || '';
    $('#emCover').innerHTML = cover ? `<img src="${esc(cover)}" alt="" class="${isPng(cover) ? 'contain' : ''}">` : '';
    $('#emWhen').textContent = [p ? `${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}` : '', ev.time].filter(Boolean).join(' · ');
    $('#emTitle').textContent = ev.title;
    $('#emVenue').textContent = [ev.venue, ev.address].filter(Boolean).join(' — ');
    $('#emDesc').textContent = ev.description || ev.summary || '';
    $('#emHighlights').innerHTML = (ev.highlights || []).map((h) => `<li>${esc(h)}</li>`).join('');
    const shots = (ev.photos || []).map((src) => ({ image: src, caption: ev.title }));
    $('#emPhotos').innerHTML = shots.map((s, i) => `<button type="button" data-i="${i}" aria-label="Foto ${i + 1}"><img src="${esc(s.image)}" alt="" loading="lazy" class="${isPng(s.image) ? 'contain' : ''}"></button>`).join('');
    $$('#emPhotos button').forEach((b) => b.addEventListener('click', () => openLightbox(shots, Number(b.dataset.i), $('img', b))));
    const link = $('#emLink');
    link.hidden = !ev.link;
    if (ev.link) link.href = ev.link;
    modal.hidden = false;
    modal.classList.remove('closing');
    $('.modal-card', modal).scrollTop = 0;
    document.body.classList.add('noscroll');
    $('.modal-x', modal).focus({ preventScroll: true });
  }
  function closeEvent() {
    if (modal.hidden) return;
    modal.classList.add('closing');
    setTimeout(() => {
      modal.hidden = true;
      document.body.classList.remove('noscroll');
      if (modalReturn) modalReturn.focus({ preventScroll: true });
    }, reduce ? 0 : 320);
  }
  $$('[data-close]', modal).forEach((b) => b.addEventListener('click', closeEvent));

  addEventListener('keydown', (e) => {
    if (!lb.el.hidden) {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowRight') showShot(lb.i + 1, 1);
      else if (e.key === 'ArrowLeft') showShot(lb.i - 1, -1);
      return;
    }
    if (!modal.hidden && e.key === 'Escape') closeEvent();
    if (document.body.classList.contains('menu-open') && e.key === 'Escape') setMenu(false);
  });

  // ---------- gallery ----------
  let gallery = [];
  let galleryFilter = 'all';
  function renderGallery() {
    const wrap = $('#masonry');
    const chips = $('#galleryChips');
    const evIds = [...new Set(gallery.map((g) => g.eventId).filter(Boolean))].filter((id) => events.some((e) => e.id === id));
    chips.innerHTML = evIds.length
      ? [['all', t('gallery.all', 'SEMUA')], ...evIds.map((id) => [id, events.find((e) => e.id === id).title])]
        .map(([id, label]) => `<button type="button" data-g="${esc(id)}" class="${id === galleryFilter ? 'on' : ''}">${esc(label.length > 34 ? `${label.slice(0, 32)}…` : label)}</button>`).join('')
      : '';
    $$('button', chips).forEach((b) => b.addEventListener('click', () => filterGallery(b.dataset.g)));

    if (!gallery.length) {
      wrap.innerHTML = `<p class="empty-note solid" style="grid-column:1/-1">${esc(t('gallery.empty', 'Galeri masih kosong.'))}</p>`;
      return;
    }
    wrap.innerHTML = gallery.map((g, i) => `
      <button class="shot${g.wide ? ' wide' : ''}" type="button" data-i="${i}" data-reveal="scale" style="--kb:${12 + (i % 5) * 2}s">
        <img src="${esc(g.image)}" alt="${esc(g.caption)}" loading="lazy" class="${isPng(g.image) ? 'contain' : ''}">
        ${g.caption ? `<figcaption class="glass">${esc(g.caption)}</figcaption>` : ''}
      </button>`).join('');
    $$('.shot', wrap).forEach((b) => b.addEventListener('click', () => {
      const visible = gallery.filter((g) => galleryFilter === 'all' || g.eventId === galleryFilter);
      openLightbox(visible, visible.indexOf(gallery[Number(b.dataset.i)]), $('img', b));
    }));
    observeReveal(wrap);
  }
  function filterGallery(id) {
    galleryFilter = id;
    $$('#galleryChips button').forEach((b) => b.classList.toggle('on', b.dataset.g === id));
    $$('#masonry .shot').forEach((s) => {
      const g = gallery[Number(s.dataset.i)];
      const show = id === 'all' || g.eventId === id;
      s.classList.toggle('gone', !show);
      if (show && !reduce) s.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    });
  }

  // ---------- journal (latest posts) ----------
  const fmtDate = (iso) => {
    const p = dateParts(iso);
    return p ? `${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}` : '';
  };
  function renderPosts(posts) {
    const grid = $('#postGrid');
    const list = [...posts].sort((a, b) => Number(b.featured) - Number(a.featured) || b.date.localeCompare(a.date)).slice(0, 3);
    if (!list.length) { $('#jurnal').hidden = true; return; }
    grid.innerHTML = list.map((p, i) => `
      <a class="post-card solid${i === 0 ? ' big' : ''}" href="/blog/${encodeURIComponent(p.slug)}" data-reveal>
        <div class="pc-cover">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy" class="${isPng(p.cover) ? 'contain' : ''}">` : ''}</div>
        <div class="pc-body">
          <p class="pc-meta">${(p.tags || []).slice(0, 2).map((x) => `<span>${esc(x)}</span>`).join('')}<time>${esc(fmtDate(p.date))}</time></p>
          <h3>${esc(p.title)}</h3>
          ${p.excerpt ? `<p class="pc-ex">${esc(p.excerpt)}</p>` : ''}
          <span class="ev-more">${esc(t('blog.read', 'Baca'))} <i>→</i></span>
        </div>
      </a>`).join('');
    observeReveal(grid);
  }

  // ---------- store links ----------
  const ICONS = {
    ig: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 20l1.5-4A8 8 0 1 1 9 19.4z"/></svg>',
    tt: '<svg viewBox="0 0 24 24"><path d="M14 3v11a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.5 2.6 2.4 4.4 5 4.6"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  };
  function renderStores(s) {
    const links = [];
    if (s.instagram) links.push({ href: `https://instagram.com/${s.instagram}`, icon: 'ig', title: 'Instagram', sub: `@${s.instagram}`, color: '#c13584' });
    if (s.tiktok) links.push({ href: `https://www.tiktok.com/@${s.tiktok}`, icon: 'tt', title: 'TikTok', sub: `@${s.tiktok}`, color: '#111318' });
    links.push({ href: s.shopee || 'https://shopee.co.id/search?keyword=ballop', icon: 'bag', title: 'Shopee', sub: s.shopee ? 'Toko resmi' : 'Cari "BALLOP"', color: '#ee4d2d' });
    if (s.tiktokShop) links.push({ href: s.tiktokShop, icon: 'bag', title: 'TikTok Shop', sub: 'Toko resmi', color: '#111318' });
    links.push({ href: s.tokopedia || 'https://www.tokopedia.com/search?q=ballop', icon: 'bag', title: 'Tokopedia', sub: s.tokopedia ? 'Toko resmi' : 'Cari "BALLOP"', color: '#03ac0e' });
    if (s.whatsapp) links.push({ href: `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(`Halo ${s.brand || 'BALLOP'}, saya mau tanya produk.`)}`, icon: 'chat', title: 'WhatsApp', sub: 'Chat & order', color: '#25d366' });
    if (s.email) links.push({ href: `mailto:${s.email}`, icon: 'mail', title: 'Email', sub: s.email, color: '#2f7fd3' });
    $('#storeLinks').innerHTML = links.map((l) => `
      <a class="store glass" href="${esc(l.href)}" target="_blank" rel="noopener" style="--sc:${l.color}">
        ${ICONS[l.icon]}<span><b>${esc(l.title)}</b><small>${esc(l.sub)}</small></span>
      </a>`).join('');
  }

  // ---------- boot ----------
  const getJson = (u, fb) => fetch(u).then((r) => (r.ok ? r.json() : fb)).catch(() => fb);
  let isReady = false;
  const ready = () => {
    measureLogo();
    frame();
    if (isReady) return;
    isReady = true;
    document.body.classList.add('ready');
  };

  BALLOP.content.then((c) => {
    BALLOP.apply(c);
    renderMarquee(c);
    renderMerge(c);
    renderStats(c);
    renderTech(c);
    observeReveal();
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(ready);
  });
  // never wait longer than this for copy or fonts
  setTimeout(ready, 1500);

  Promise.all([BALLOP.content, getJson('/api/settings', {}), getJson('/api/events', []), getJson('/api/gallery', []), getJson('/api/posts', [])])
    .then(([, s, ev, gal, posts]) => {
      renderStores(s);
      events = ev;
      gallery = gal;
      renderEvents();
      renderGallery();
      renderPosts(posts);
    });

  addEventListener('load', measureLogo);
})();
