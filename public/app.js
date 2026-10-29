// BALLOP catalog: showroom shelves + SKU view.
// Every catalog <-> SKU change is a shared-element morph: the shoe you clicked is cloned into a
// fixed "flyer" that travels from its old box to its new box while the scenes around it swap.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ms = (t) => (reduce ? 1 : t);
  const EASE = 'cubic-bezier(.7, 0, .2, 1)';
  const EASE_OUT = 'cubic-bezier(.16, 1, .3, 1)';
  const SPRING = 'cubic-bezier(.34, 1.4, .5, 1)';
  const HERO_ROT = -8;

  const state = { products: [], settings: {}, current: null, angle: 0, size: null, busy: false, open: false, filter: 'ALL', fall: [] };

  const el = {
    shelves: $('#shelves'), filters: $('#filters'), sku: $('#sku'), hero: $('#heroImg'), stage: $('#stage'),
    picker: $('#picker'), angles: $('#angles'), ghost: $('#ghost'), sizes: $('#skuSizes'),
    cart: $('#cart'), cartCount: $('#cartCount'), toast: $('#toast'),
  };

  // ---------- helpers ----------
  const hueCss = (p) => `hue-rotate(${p.hue || 0}deg)`;
  const money = (n) => `${state.settings.currency || 'Rp'} ${Number(n || 0).toLocaleString('id-ID')}`;
  const byId = (id) => state.products.find((p) => p.id === id);
  const slotOf = (id) => el.shelves.querySelector(`.slot[data-id="${CSS.escape(id)}"]`);
  const visibleList = () => state.products;
  const wait = (t) => new Promise((r) => setTimeout(r, t));
  const decode = (img) => (img.complete && img.naturalWidth ? Promise.resolve() : img.decode().catch(() => {}));

  // layout box of an element ignoring its own CSS transform (hover lift, hero tilt)
  function layoutRect(node) {
    const parent = node.offsetParent;
    if (!parent) return node.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    return { left: p.left + node.offsetLeft, top: p.top + node.offsetTop, width: node.offsetWidth, height: node.offsetHeight };
  }
  // the visible image inside an object-fit: contain box
  function contentRect(img, r = img.getBoundingClientRect()) {
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh) return r;
    const ratio = nw / nh;
    let w = r.width, h = r.height;
    if (w / h > ratio) w = h * ratio; else h = w / ratio;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }
  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  // Fly an image from box a to box b along a slight arc. Resolves with the flyer still on screen,
  // so the caller can reveal the real element underneath before removing it (no flicker).
  function fly(src, filter, a, b, { rotA = 0, rotB = 0, arc = -70, duration = 900, easing = EASE, fadeOut = false } = {}) {
    const img = new Image();
    img.src = src;
    img.className = 'flyer';
    img.alt = '';
    Object.assign(img.style, {
      left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`,
      transformOrigin: '50% 50%', filter: `${filter} drop-shadow(0 26px 24px rgba(17,19,24,.25))`,
    });
    document.body.appendChild(img);
    const ca = center(a), cb = center(b);
    const dx = cb.x - ca.x, dy = cb.y - ca.y, s = b.width / a.width;
    const frames = [
      { transform: `rotate(${rotA}deg)`, opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 + arc}px) scale(${(1 + s) / 2}) rotate(${(rotA + rotB) / 2 - 7}deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${rotB}deg)`, opacity: fadeOut ? 0 : 1 },
    ];
    const anim = img.animate(frames, { duration: ms(duration), easing, fill: 'forwards' });
    return anim.finished.then(() => img);
  }
  // remove after the real element has painted; the timer covers tabs where rAF is paused
  const land = (flyer) => {
    requestAnimationFrame(() => requestAnimationFrame(() => flyer.remove()));
    setTimeout(() => flyer.remove(), 150);
  };

  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  // ---------- cart (per-browser convenience only) ----------
  const cart = {
    load() { try { return JSON.parse(localStorage.getItem('ballop-cart') || '[]'); } catch { return []; } },
    save(items) { try { localStorage.setItem('ballop-cart', JSON.stringify(items)); } catch { /* private mode */ } },
  };
  const renderCart = () => { el.cartCount.textContent = cart.load().length; };

  // ---------- catalog ----------
  function renderShelves() {
    el.shelves.innerHTML = '';
    state.products.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot enter';
      b.dataset.id = p.id;
      b.dataset.cat = (p.category || '').toUpperCase();
      b.style.setProperty('--a', p.accent);
      b.style.setProperty('--hue', hueCss(p));
      b.style.animationDelay = `${i * 70}ms`;
      b.setAttribute('aria-label', `${p.name} ${p.series}, ${money(p.price)}`);
      b.innerHTML = `
        <div class="shoe"><img alt="" loading="${i < 10 ? 'eager' : 'lazy'}"></div>
        <div class="ledge"></div><div class="led"></div><div class="spill"></div>
        <div class="tag"><b></b><span></span><em></em></div>`;
      $('img', b).src = p.images[0] || '';
      $('b', b).textContent = p.name;
      $('span', b).textContent = p.series;
      $('em', b).textContent = money(p.price);
      b.addEventListener('animationend', () => b.classList.remove('enter'), { once: true });
      const on = () => { if (!state.open) { b.classList.add('hot'); el.shelves.classList.add('hovering'); } };
      const off = () => { b.classList.remove('hot'); el.shelves.classList.remove('hovering'); };
      b.addEventListener('mouseenter', on);
      b.addEventListener('mouseleave', off);
      b.addEventListener('focus', on);
      b.addEventListener('blur', off);
      b.addEventListener('click', () => openSku(p, b, true));
      el.shelves.appendChild(b);
    });
    // LED strips flick on one after another the first time the showroom scrolls into view
    const io = new IntersectionObserver(([en]) => {
      if (!en.isIntersecting) return;
      io.disconnect();
      $$('.slot', el.shelves).forEach((s, i) => {
        setTimeout(() => s.classList.add('flick'), ms(300 + i * 90));
        setTimeout(() => s.classList.remove('flick'), ms(700 + i * 90));
      });
    }, { threshold: 0.25 });
    io.observe(el.shelves);
  }

  // idle: when nobody is hovering, one shelf at a time lights up on its own
  let idleI = -1;
  setInterval(() => {
    if (reduce || state.open || document.hidden || el.shelves.classList.contains('hovering')) return;
    const r = el.shelves.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    const slots = $$('.slot:not(.hidden)', el.shelves);
    if (!slots.length) return;
    idleI = (idleI + 1) % slots.length;
    const s = slots[idleI];
    s.classList.add('flick', 'idle');
    setTimeout(() => s.classList.remove('flick', 'idle'), 1500);
  }, 1900);

  function renderFilters() {
    const cats = [...new Set(state.products.map((p) => (p.category || '').toUpperCase()).filter(Boolean))];
    el.filters.innerHTML = '';
    if (cats.length < 2) return;
    ['ALL', ...cats].forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c === 'ALL' ? BALLOP.t('catalog.all', 'SEMUA') : c;
      b.classList.toggle('on', c === state.filter);
      b.addEventListener('click', () => setFilter(c));
      el.filters.appendChild(b);
    });
  }

  function setFilter(c) {
    state.filter = c;
    $$('button', el.filters).forEach((b, i) => b.classList.toggle('on', (i === 0 ? 'ALL' : b.textContent) === c));
    let k = 0;
    $$('.slot', el.shelves).forEach((s) => {
      const show = c === 'ALL' || s.dataset.cat === c;
      s.classList.toggle('hidden', !show);
      if (show) {
        s.classList.remove('enter'); void s.offsetWidth;
        s.style.animationDelay = `${k++ * 60}ms`;
        s.classList.add('enter');
      }
    });
  }

  // other shelves fall back while the SKU view opens, rise again on close
  function catalogOut(fromSlot) {
    const origin = fromSlot ? center(fromSlot.getBoundingClientRect()) : { x: innerWidth / 2, y: innerHeight / 2 };
    state.fall = $$('.slot:not(.hidden)', el.shelves).filter((s) => s !== fromSlot).map((s) => {
      const c = center(s.getBoundingClientRect());
      const d = Math.hypot(c.x - origin.x, c.y - origin.y);
      return s.animate(
        [{ transform: 'none', opacity: 1 }, { transform: `translate(${(c.x - origin.x) * 0.08}px, 50px) scale(.9)`, opacity: 0 }],
        { duration: ms(600), delay: ms(d * 0.25), easing: EASE, fill: 'forwards' },
      );
    });
  }
  function catalogIn() {
    state.fall.forEach((a) => a.cancel());
    state.fall = [];
    $$('.slot:not(.hidden)', el.shelves).forEach((s, i) => s.animate(
      [{ transform: 'translateY(40px) scale(.94)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: ms(800), delay: ms(250 + i * 45), easing: EASE_OUT, fill: 'backwards' },
    ));
  }

  // ---------- SKU view ----------
  function fill(p) {
    state.current = p;
    state.angle = 0;
    state.size = null;
    const sku = el.sku;
    sku.style.setProperty('--c', p.color);
    sku.style.setProperty('--a', p.accent);
    sku.style.setProperty('--hue', hueCss(p));
    el.hero.src = p.images[0] || '';
    el.hero.alt = `${p.name} ${p.series}`;
    $('#skuSeries').textContent = [p.category, p.series].filter(Boolean).join(' / ');
    $('#skuName').textContent = p.name;
    $('#skuPrice').textContent = money(p.price);
    $('#skuOld').textContent = p.oldPrice > p.price ? money(p.oldPrice) : '';
    $('#skuDesc').textContent = p.description;
    el.ghost.textContent = p.name;

    el.sizes.innerHTML = '';
    p.sizes.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', () => {
        state.size = s;
        $$('button', el.sizes).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
      });
      el.sizes.appendChild(b);
    });

    const feats = $('#skuFeatures');
    feats.innerHTML = '';
    p.features.forEach((f) => { const li = document.createElement('li'); li.textContent = f; feats.appendChild(li); });

    el.angles.innerHTML = '';
    if (p.images.length > 1) {
      p.images.forEach((src, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = i === 0 ? 'on' : '';
        b.setAttribute('aria-label', `Foto ${i + 1}`);
        const im = new Image(); im.src = src; im.alt = '';
        b.appendChild(im);
        b.addEventListener('click', () => setAngle(i));
        el.angles.appendChild(b);
      });
    }

    el.picker.innerHTML = '';
    visibleList().forEach((q) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = q.id;
      b.className = q.id === p.id ? 'on' : '';
      b.style.setProperty('--sw', q.color);
      b.setAttribute('aria-label', `${q.name} ${q.series}`);
      const im = new Image(); im.src = q.images[0] || ''; im.alt = ''; im.style.filter = hueCss(q);
      b.appendChild(im);
      b.addEventListener('click', () => switchTo(q, im));
      el.picker.appendChild(b);
    });
  }

  // staggered entrance for the text column, stripes and giant name
  function revealContent(delay = 0, light = false) {
    $$('.r', el.sku).forEach((n, i) => n.animate(
      [{ transform: 'translateY(28px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: ms(light ? 550 : 800), delay: ms(delay + i * 55), easing: EASE_OUT, fill: 'backwards' },
    ));
    el.ghost.animate(
      [{ transform: 'translate(-50%, 70px)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1 }],
      { duration: ms(1000), delay: ms(delay + 100), easing: EASE_OUT, fill: 'backwards' },
    );
    if (!light) {
      $$('.stripes i', el.sku).forEach((s, i) => s.animate(
        [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
        { duration: ms(900), delay: ms(delay + i * 90), easing: EASE_OUT, fill: 'backwards' },
      ));
      $$('button', el.picker).forEach((b, i) => b.animate(
        [{ transform: 'translateX(30px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: ms(700), delay: ms(delay + 200 + i * 40), easing: EASE_OUT, fill: 'backwards' },
      ));
      el.angles.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms(600), delay: ms(delay + 500), fill: 'backwards' });
    }
  }
  function hideContent(duration = 220) {
    [...$$('.r', el.sku), el.ghost].forEach((n) => n.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: ms(duration), easing: 'ease-in', fill: 'forwards' },
    ));
  }

  async function openSku(p, slot, push) {
    if (state.busy || state.open || !p) return;
    state.busy = true;
    state.open = true;
    if (push) history.pushState({ sku: p.id }, '', `#/p/${encodeURIComponent(p.id)}`);

    const slotImg = slot && $('.shoe img', slot);
    let from = null, rotA = 0;
    if (slotImg && slotImg.naturalWidth) {
      const r = contentRect(slotImg, layoutRect(slotImg));
      // start where the hovered shoe actually is: lifted 14px, scaled 1.06 around its bottom centre
      const lifted = slot.classList.contains('hot');
      const k = lifted ? 1.06 : 1;
      const bottom = r.top + r.height - (lifted ? 14 : 0);
      from = { left: r.left + r.width / 2 - (r.width * k) / 2, top: bottom - r.height * k, width: r.width * k, height: r.height * k };
      rotA = lifted ? -3 : 0;
    }

    $$('.slot', el.shelves).forEach((s) => s.classList.remove('hot'));
    el.shelves.classList.remove('hovering');
    fill(p);
    document.body.classList.add('locked', 'sku-open');
    el.sku.classList.add('open');
    el.sku.setAttribute('aria-hidden', 'false');
    el.sku.scrollTop = 0;
    el.hero.style.opacity = '0';
    await decode(el.hero);

    const origin = from ? center(from) : { x: innerWidth / 2, y: innerHeight / 2 };
    el.sku.animate(
      [{ clipPath: `circle(0px at ${origin.x}px ${origin.y}px)` }, { clipPath: `circle(${Math.hypot(innerWidth, innerHeight)}px at ${origin.x}px ${origin.y}px)` }],
      { duration: ms(1000), easing: EASE },
    );
    catalogOut(slot);
    revealContent(260);

    if (from) {
      slotImg.style.visibility = 'hidden';
      const to = layoutRect(el.hero);
      const flyer = await fly(p.images[0], hueCss(p), from, to, { rotA, rotB: HERO_ROT, arc: -90, duration: 1000 });
      el.hero.style.opacity = '';
      land(flyer);
      slotImg.style.visibility = '';
    } else {
      el.hero.style.opacity = '';
      await el.hero.animate(
        [{ transform: `translateY(-60vh) rotate(${HERO_ROT - 14}deg)`, opacity: 0 }, { transform: `rotate(${HERO_ROT}deg)`, opacity: 1 }],
        { duration: ms(1000), easing: SPRING },
      ).finished;
    }
    state.busy = false;
  }

  async function closeSku() {
    if (state.busy || !state.open) return;
    state.busy = true;
    const p = state.current;
    if (state.filter !== 'ALL' && (p.category || '').toUpperCase() !== state.filter) setFilter('ALL');
    const slot = slotOf(p.id);
    const slotImg = slot && $('.shoe img', slot);

    // keep the target shelf in view so the shoe has somewhere to land
    if (slot) {
      const r = slot.getBoundingClientRect();
      if (r.top < 80 || r.bottom > innerHeight - 20) window.scrollTo({ top: scrollY + r.top - innerHeight / 2 + r.height / 2, behavior: 'instant' });
    }

    document.body.classList.remove('sku-open');
    const heroBox = layoutRect(el.hero);
    const to = slotImg && slotImg.naturalWidth ? contentRect(slotImg, layoutRect(slotImg)) : null;
    const origin = to ? center(to) : { x: innerWidth / 2, y: innerHeight / 2 };

    let flight = Promise.resolve(null);
    if (to && p.images[0]) {
      slotImg.style.visibility = 'hidden';
      el.hero.style.opacity = '0';
      flight = fly(p.images[0], hueCss(p), heroBox, to, { rotA: HERO_ROT, rotB: 0, arc: -60, duration: 900 });
    }
    catalogIn();
    hideContent(260);
    await el.sku.animate(
      [{ clipPath: `circle(${Math.hypot(innerWidth, innerHeight)}px at ${origin.x}px ${origin.y}px)` }, { clipPath: `circle(0px at ${origin.x}px ${origin.y}px)` }],
      { duration: ms(900), easing: EASE, fill: 'forwards' },
    ).finished.then((a) => {
      el.sku.classList.remove('open');
      el.sku.setAttribute('aria-hidden', 'true');
      a.cancel();
    });
    const flyer = await flight;
    if (slotImg) slotImg.style.visibility = '';
    if (flyer) land(flyer);
    $$('.r', el.sku).concat(el.ghost).forEach((n) => n.getAnimations().forEach((a) => a.cancel()));
    el.hero.style.opacity = '';
    document.body.classList.remove('locked');
    state.open = false;
    state.busy = false;
    if (slot) slot.focus({ preventScroll: true });
  }

  // switch SKU inside the view: the old shoe drops out, the picked thumbnail morphs into the hero
  async function switchTo(p, thumbImg) {
    if (state.busy || !state.open || !p || p === state.current) return;
    state.busy = true;
    const old = state.current;
    const list = visibleList();
    const dir = list.indexOf(p) > list.indexOf(old) ? 1 : -1;
    history.replaceState({ sku: p.id }, '', `#/p/${encodeURIComponent(p.id)}`);

    // outgoing shoe
    const oldBox = layoutRect(el.hero);
    const out = new Image();
    out.src = el.hero.src;
    out.className = 'flyer';
    Object.assign(out.style, {
      left: `${oldBox.left}px`, top: `${oldBox.top}px`, width: `${oldBox.width}px`, height: `${oldBox.height}px`,
      transformOrigin: '50% 50%', filter: `${hueCss(old)} drop-shadow(0 26px 24px rgba(17,19,24,.25))`, zIndex: 25,
    });
    document.body.appendChild(out);
    out.animate(
      [{ transform: `rotate(${HERO_ROT}deg)`, opacity: 1 }, { transform: `translate(${-dir * 40}px, 55vh) rotate(${HERO_ROT + 22}deg) scale(.85)`, opacity: 0 }],
      { duration: ms(700), easing: 'cubic-bezier(.55, 0, .75, .2)', fill: 'forwards' },
    ).finished.then(() => out.remove());

    const thumbBox = thumbImg ? contentRect(thumbImg) : null;
    el.hero.style.opacity = '0';
    // stripes fold up, take the new colour, drop back down
    $$('.stripes i', el.sku).forEach((s, i) => s.animate(
      [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)', offset: 0.42 }, { transform: 'scaleY(1)' }],
      { duration: ms(1000), delay: ms(i * 70), easing: EASE },
    ));
    await Promise.all([...$$('.r', el.sku), el.ghost].map((n) => n.animate(
      [{ opacity: 1 }, { opacity: 0 }], { duration: ms(200), easing: 'ease-in', fill: 'forwards' },
    ).finished));
    fill(p);
    [...$$('.r', el.sku), el.ghost].forEach((n) => n.getAnimations().forEach((a) => a.cancel()));
    revealContent(40, true);
    await decode(el.hero);

    const to = layoutRect(el.hero);
    const from = thumbBox || { left: to.left, top: to.top - innerHeight * 0.7, width: to.width, height: to.height };
    const flyer = await fly(p.images[0], hueCss(p), from, to, {
      rotA: thumbBox ? 0 : HERO_ROT - 16, rotB: HERO_ROT, arc: thumbBox ? -50 : 0, duration: 850,
      easing: thumbBox ? EASE : SPRING,
    });
    el.hero.style.opacity = '';
    land(flyer);
    state.busy = false;
  }

  async function setAngle(i) {
    const p = state.current;
    if (!p || i === state.angle || state.busy) return;
    const dir = i > state.angle ? 1 : -1;
    state.angle = i;
    $$('button', el.angles).forEach((b, k) => b.classList.toggle('on', k === i));
    await el.hero.animate(
      [{ transform: `rotate(${HERO_ROT}deg)`, opacity: 1 }, { transform: `translateX(${-dir * 50}px) rotate(${HERO_ROT - dir * 6}deg) scale(.94)`, opacity: 0 }],
      { duration: ms(200), easing: 'ease-in', fill: 'forwards' },
    ).finished;
    el.hero.src = p.images[i];
    await decode(el.hero);
    el.hero.getAnimations().forEach((a) => a.cancel());
    el.hero.animate(
      [{ transform: `translateX(${dir * 60}px) rotate(${HERO_ROT + dir * 6}deg) scale(.94)`, opacity: 0 }, { transform: `rotate(${HERO_ROT}deg)`, opacity: 1 }],
      { duration: ms(600), easing: SPRING },
    );
  }

  function step(delta) {
    const list = visibleList();
    const i = list.indexOf(state.current);
    const next = list[(i + delta + list.length) % list.length];
    const thumb = el.picker.querySelector(`button[data-id="${CSS.escape(next.id)}"] img`);
    switchTo(next, thumb);
  }

  // ---------- actions ----------
  $('#addCart').addEventListener('click', async () => {
    const p = state.current;
    if (!state.size) {
      el.sizes.classList.remove('shake'); void el.sizes.offsetWidth; el.sizes.classList.add('shake');
      toast(BALLOP.t('sku.pickSize', 'Pilih ukuran dulu ya'));
      return;
    }
    const items = cart.load();
    items.push({ id: p.id, size: state.size });
    cart.save(items);
    const box = el.cart.getBoundingClientRect();
    const target = { left: box.left + box.width / 2 - 20, top: box.top + box.height / 2 - 12, width: 40, height: 24 };
    const hb = layoutRect(el.hero);
    const flyer = await fly(el.hero.src, hueCss(p), hb, { ...target, height: (40 * hb.height) / hb.width }, { rotA: HERO_ROT, rotB: 0, arc: -120, duration: 750, fadeOut: true });
    flyer.remove();
    renderCart();
    el.cart.classList.remove('bump'); void el.cart.offsetWidth; el.cart.classList.add('bump');
    toast(`${p.name} ${p.series} (${state.size}) ${BALLOP.t('sku.added', 'masuk keranjang')}`);
  });

  $('#buyNow').addEventListener('click', () => {
    const p = state.current;
    if (p.buyUrl) { window.open(p.buyUrl, '_blank', 'noopener'); return; }
    const wa = state.settings.whatsapp;
    if (!wa) { toast(BALLOP.t('sku.noLink', 'Link beli belum diatur di admin')); return; }
    const msg = `Halo ${state.settings.brand || 'BALLOP'}, saya mau order ${p.name} ${p.series}${state.size ? ` ukuran ${state.size}` : ''} (${money(p.price)}).`;
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  });

  el.cart.addEventListener('click', () => {
    const n = cart.load().length;
    toast(n ? `${n} ${BALLOP.t('sku.cartCount', 'item di keranjang')}` : BALLOP.t('sku.cartEmpty', 'Keranjang masih kosong'));
  });

  $('#back').addEventListener('click', () => {
    if (history.state && history.state.sku) history.back();
    else { history.replaceState(null, '', location.pathname); closeSku(); }
  });

  addEventListener('popstate', () => {
    const id = decodeURIComponent((location.hash.match(/^#\/p\/(.+)$/) || [])[1] || '');
    const p = id && byId(id);
    if (!p && state.open) closeSku();
    else if (p && !state.open) openSku(p, slotOf(p.id), false);
    else if (p && state.open && p !== state.current) switchTo(p, null);
  });

  addEventListener('keydown', (e) => {
    if (!state.open) return;
    if (e.key === 'Escape') $('#back').click();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  });

  // ---------- boot ----------
  Promise.all([
    BALLOP.content,
    fetch('/api/products').then((r) => r.json()),
    fetch('/api/settings').then((r) => r.json()).catch(() => ({})),
  ]).then(([, products, settings]) => {
    state.products = products.filter((p) => p.images && p.images.length);
    state.settings = settings || {};
    renderFilters();
    renderShelves();
    renderCart();
    const id = decodeURIComponent((location.hash.match(/^#\/p\/(.+)$/) || [])[1] || '');
    if (id && byId(id)) setTimeout(() => openSku(byId(id), null, false), 300);
  }).catch(() => {
    el.shelves.innerHTML = '<p class="hint">Katalog gagal dimuat. Jalankan server: <code>npm start</code></p>';
  });
})();
