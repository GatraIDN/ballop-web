// BALLOP admin: team accounts. Admin creates users, gives them one or more roles (division), resets
// passwords and deactivates people who leave. The server enforces the same roles on every request.
(() => {
  const { $, $$, api, json, toast } = window.A;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROLE_INFO = {
    admin: ['Admin', 'Semua menu, pengguna, pengaturan'],
    ecommerce: ['E-commerce', 'Penjualan online & manual, import marketplace, iklan, produk, stok 3PL'],
    cs: ['Customer service', 'Daily report CS Shopee & TikTok, submit flash sale Shopee'],
    offline: ['Offline', 'Penjualan offline (toko, distributor, event)'],
    gudang: ['Gudang', 'Stok 3PL, barang masuk & keluar, produk'],
    creative: ['Creative', 'KOL seeding, jurnal, event, galeri, konten website, produk'],
    marketing: ['Marketing', 'Iklan, KOL seeding'],
    finance: ['Finance', 'Keuangan, biaya, penjualan (lihat), ringkasan'],
    viewer: ['Viewer', 'Hanya lihat Ringkasan (penjualan & iklan), tidak bisa mengubah apa pun'],
  };
  let users = [];
  const ROLE_COLOR = { admin: '#111318', ecommerce: '#2a78d6', cs: '#e8a200', offline: '#6250d6', gudang: '#0e8a4f', creative: '#e87ba4', marketing: '#eb6834', finance: '#1baf7a', viewer: '#8a8f99' };
  const st = { q: '', role: '' };
  const num = (n) => Number(n || 0).toLocaleString('id-ID');
  const initials = (u) => (u.name || u.username || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const roleChip = (k) => `<span class="u-role" style="--c:${ROLE_COLOR[k] || '#8a8f99'}">${esc(ROLE_INFO[k]?.[0] || k)}</span>`;

  function render() {
    const v = $('#view-users');
    const q = st.q.toLowerCase();
    const list = users.filter((u) => (!st.role || u.roles.includes(st.role)) && (!q || `${u.username} ${u.name}`.toLowerCase().includes(q)));
    const count = (k) => users.filter((u) => u.roles.includes(k)).length;
    v.innerHTML = `
      <header class="bar"><div><h1>Pengguna & akses</h1><p class="muted">Akun tim dan role-nya. Menu yang muncul mengikuti role; satu orang boleh punya beberapa role. Klik kartu untuk edit.</p></div>
        <div class="bar-actions"><button class="btn sm" type="button" id="uRoles">ⓘ Penjelasan role</button><button class="btn sm primary" type="button" id="uAdd">+ Tambah pengguna</button></div></header>
      <div class="st-cards u-cards">
        <div class="st-card hero"><span>Pengguna tim</span><b>${num(users.length)}</b><small>${num(users.filter((u) => u.active).length)} aktif</small></div>
        <div class="st-card"><span>Nonaktif</span><b>${num(users.filter((u) => !u.active).length)}</b><small>tidak bisa login</small></div>
        <div class="st-card"><span>Owner</span><b>admin</b><small>akun bawaan, selalu bisa masuk</small></div>
      </div>
      <div class="st-chips"><button type="button" class="chip${!st.role ? ' on' : ''}" data-urole="">Semua <i>${num(users.length)}</i></button>${Object.entries(ROLE_INFO).map(([k, [l]]) => `<button type="button" class="chip${st.role === k ? ' on' : ''}" data-urole="${k}">${l} <i>${num(count(k))}</i></button>`).join('')}</div>
      <div class="st-filters solid"><label class="grow">Cari<input type="search" id="uQ" placeholder="Nama atau username…" value="${esc(st.q)}"></label></div>
      <div class="u-grid">${list.map((u) => `
        <button type="button" class="u-card${u.active ? '' : ' off'}" data-uid="${esc(u.id)}">
          <span class="u-ava" style="--c:${ROLE_COLOR[u.roles[0]] || '#8a8f99'}">${esc(initials(u))}</span>
          <span class="u-main"><b>${esc(u.name || u.username)}</b><small>@${esc(u.username)}</small><span class="u-roles">${u.roles.map(roleChip).join('')}</span></span>
          <span class="badge ${u.active ? 'live' : 'bad'}">${u.active ? 'Aktif' : 'Nonaktif'}</span>
        </button>`).join('') || `<p class="muted" style="grid-column:1/-1;text-align:center;padding:30px">${users.length ? 'Tidak ada pengguna di filter ini.' : 'Belum ada pengguna tim. Klik “+ Tambah pengguna”.'}</p>`}</div>`;
    $('#uAdd').addEventListener('click', () => openForm(null));
    $('#uRoles').addEventListener('click', rolesPopup);
    $$('[data-urole]', v).forEach((b) => b.addEventListener('click', () => { st.role = b.dataset.urole; render(); }));
    $('#uQ').addEventListener('input', (e) => { st.q = e.target.value; clearTimeout(st.t); st.t = setTimeout(() => { render(); const q2 = $('#uQ'); q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }, 250); });
    $$('[data-uid]', v).forEach((b) => b.addEventListener('click', () => openForm(users.find((u) => u.id === b.dataset.uid))));
  }

  const popup = (html) => {
    const box = document.createElement('div');
    box.className = 'raw-pop';
    box.innerHTML = html;
    document.body.appendChild(box);
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-close]')) box.remove(); });
    return box;
  };
  function rolesPopup() {
    popup(`<div class="raw-card u-pop"><header><div><span class="muted small">Pengguna & akses</span><h2>Penjelasan role</h2></div><button class="btn sm" type="button" data-close>✕</button></header>
      <div class="raw-body"><div class="u-rolelist">${Object.entries(ROLE_INFO).map(([k, [, d]]) => `<div>${roleChip(k)}<span>${esc(d)}</span></div>`).join('')}</div>
      <p class="muted small">Akun <b>admin</b> bawaan (password dari Pengaturan / env) selalu bisa masuk dan tidak tampil di daftar.</p></div></div>`);
  }

  // add / edit one user; saving sends the whole list like before
  function openForm(u) {
    const x = u ? structuredClone(u) : { username: '', name: '', roles: [], active: true, password: '' };
    const box = popup(`<form class="raw-card u-pop" autocomplete="off">
      <header><span class="u-ava lg" style="--c:${ROLE_COLOR[x.roles[0]] || '#8a8f99'}">${esc(initials(x))}</span><div><span class="muted small">${u ? 'Edit pengguna' : 'Pengguna baru'}</span><h2>${esc(x.name || x.username || 'Pengguna baru')}</h2></div><button class="btn sm" type="button" data-close>✕</button></header>
      <div class="raw-body">
        <div class="st-form-grid">
          <label>Username (untuk login)<input name="username" value="${esc(x.username)}" autocapitalize="off" spellcheck="false"></label>
          <label>Nama<input name="name" value="${esc(x.name)}"></label>
          <label class="full">${u ? 'Reset password (kosongkan kalau tidak diganti)' : 'Password (min. 8 karakter)'}<span class="u-pass"><input name="password" type="password" autocomplete="new-password" placeholder="${u ? '••••••••' : 'min. 8 karakter'}"><button class="btn sm" type="button" data-show>Lihat</button></span></label>
        </div>
        <h3 class="cs-h">Role / akses menu</h3>
        <div class="u-picks">${Object.entries(ROLE_INFO).map(([k, [l, d]]) => `<label class="u-pick${x.roles.includes(k) ? ' on' : ''}" style="--c:${ROLE_COLOR[k]}"><input type="checkbox" name="role" value="${k}"${x.roles.includes(k) ? ' checked' : ''}><span><b>${l}</b><small>${esc(d)}</small></span></label>`).join('')}</div>
        <label class="u-switch"><input type="checkbox" name="active"${x.active ? ' checked' : ''}><i></i><span><b>Akun aktif</b><small>Nonaktifkan kalau orangnya sudah tidak di tim, tanpa menghapus akun.</small></span></label>
      </div>
      <footer>${u ? '<button class="btn sm danger" type="button" data-del>Hapus pengguna</button>' : ''}<span class="spacer"></span><button class="btn sm" type="button" data-close>Batal</button><button class="btn sm primary" type="submit">Simpan</button></footer>
    </form>`);
    const form = box.querySelector('form');
    form.elements.username.focus();
    $$('.u-pick input', form).forEach((c) => c.addEventListener('change', () => c.closest('.u-pick').classList.toggle('on', c.checked)));
    form.querySelector('[data-show]').addEventListener('click', (e) => { const p = form.elements.password; p.type = p.type === 'password' ? 'text' : 'password'; e.target.textContent = p.type === 'password' ? 'Lihat' : 'Sembunyikan'; });
    form.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm(`Hapus pengguna "${u.username}"? Dia tidak bisa login lagi.`)) return;
      if (await save(users.filter((y) => y.id !== u.id), 'Pengguna dihapus')) box.remove();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rec = { ...x, username: form.elements.username.value.trim(), name: form.elements.name.value.trim(), roles: $$('input[name="role"]:checked', form).map((c) => c.value), active: form.elements.active.checked, password: form.elements.password.value };
      if (!rec.username) { toast('Username wajib diisi', true); return; }
      if (!rec.roles.length) { toast('Pilih minimal 1 role', true); return; }
      if ((!u || rec.password) && rec.password.length < 8) { toast('Password minimal 8 karakter', true); return; }
      if (users.some((y) => y.id !== x.id && y.username.toLowerCase() === rec.username.toLowerCase())) { toast('Username sudah dipakai', true); return; }
      if (await save(u ? users.map((y) => (y.id === u.id ? rec : y)) : [...users, rec], u ? 'Pengguna diperbarui' : 'Pengguna ditambahkan')) box.remove();
    });
  }

  async function save(list, msg) {
    try {
      users = await api('/api/users', json('PUT', list));
      render();
      toast(msg);
      return true;
    } catch (e) { toast(e.message, true); return false; }
  }

  document.addEventListener('admin:view', async (e) => {
    if (e.detail !== 'users' || !window.A.can('users')) return;
    try { users = await api('/api/users'); } catch (err) { toast(err.message, true); return; }
    render();
  });
})();
