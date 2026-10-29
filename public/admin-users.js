// BALLOP admin: team accounts. Admin creates users, gives them one or more roles (division), resets
// passwords and deactivates people who leave. The server enforces the same roles on every request.
(() => {
  const { $, $$, api, json, toast } = window.A;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROLE_INFO = {
    admin: ['Admin', 'Semua menu, pengguna, pengaturan'],
    ecommerce: ['E-commerce', 'Penjualan online & manual, import marketplace, iklan, produk, stok 3PL'],
    offline: ['Offline', 'Penjualan offline (toko, distributor, event)'],
    gudang: ['Gudang', 'Stok 3PL, barang masuk & keluar, produk'],
    creative: ['Creative', 'KOL seeding, jurnal, event, galeri, konten website, produk'],
    marketing: ['Marketing', 'Iklan, KOL seeding'],
    finance: ['Finance', 'Keuangan, biaya, penjualan (lihat), ringkasan'],
  };
  let users = [];
  let draft = []; // editable copy
  let dirty = false;

  function render() {
    const v = $('#view-users');
    v.innerHTML = `
      <header class="bar"><div><h1>Pengguna & akses</h1><p class="muted">Buat akun untuk tim. Menu yang muncul mengikuti role; satu orang boleh punya beberapa role.</p></div>
        <button class="btn primary" type="button" id="uAdd">+ Tambah pengguna</button></header>
      <div class="demo-note glass"><span class="badge">Owner</span> Akun <b>admin</b> bawaan (password dari Pengaturan / env) selalu bisa masuk dan tidak tampil di daftar ini.</div>
      <div class="role-legend">${Object.entries(ROLE_INFO).map(([k, [l, d]]) => `<span><b>${l}</b> ${esc(d)}</span>`).join('')}</div>
      <div class="user-list">${draft.map((u, i) => `
        <section class="user-card solid${u.active ? '' : ' off'}" data-i="${i}">
          <div class="row">
            <label>Username (untuk login)<input data-k="username" value="${esc(u.username)}" autocapitalize="off" spellcheck="false"${u.id ? '' : ' autofocus'}></label>
            <label>Nama<input data-k="name" value="${esc(u.name)}"></label>
          </div>
          <div class="role-picks">${Object.entries(ROLE_INFO).map(([k, [l]]) => `<label class="chip-check"><input type="checkbox" data-role="${k}"${u.roles.includes(k) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
          <div class="row">
            <label>${u.id ? 'Reset password (kosongkan kalau tidak diganti)' : 'Password (min. 8 karakter)'}<input type="text" data-k="password" value="${esc(u.password || '')}" autocomplete="new-password" placeholder="${u.id ? '••••••••' : ''}"></label>
            <div class="user-actions">
              <label class="check"><input type="checkbox" data-k="active"${u.active ? ' checked' : ''}> Aktif</label>
              <button class="btn sm danger" type="button" data-del="${i}">Hapus</button>
            </div>
          </div>
        </section>`).join('') || '<p class="empty">Belum ada pengguna tim. Klik “+ Tambah pengguna”.</p>'}</div>
      <div class="savebar glass"><p class="muted">${dirty ? '<span class="dirty-dot"></span> Ada perubahan belum disimpan' : 'Semua tersimpan'}</p>
        <button class="btn" type="button" id="uReset">Batalkan</button><button class="btn primary" type="button" id="uSave">Simpan pengguna</button></div>`;

    $('#uAdd').addEventListener('click', () => { draft.push({ username: '', name: '', roles: [], active: true, password: '' }); dirty = true; render(); });
    $('#uReset').addEventListener('click', () => { draft = structuredClone(users); dirty = false; render(); });
    $('#uSave').addEventListener('click', save);
    $$('.user-card', v).forEach((card) => {
      const u = draft[Number(card.dataset.i)];
      card.addEventListener('input', (e) => {
        const k = e.target.dataset.k;
        if (k === 'active') u.active = e.target.checked;
        else if (k) u[k] = e.target.value;
        if (e.target.dataset.role) {
          const r = e.target.dataset.role;
          u.roles = e.target.checked ? [...new Set([...u.roles, r])] : u.roles.filter((x) => x !== r);
        }
        dirty = true;
        $('.savebar .muted', v).innerHTML = '<span class="dirty-dot"></span> Ada perubahan belum disimpan';
      });
    });
    $$('[data-del]', v).forEach((b) => b.addEventListener('click', () => {
      const u = draft[Number(b.dataset.del)];
      if (!confirm(`Hapus pengguna "${u.username || 'baru'}"? Dia tidak bisa login lagi.`)) return;
      draft.splice(Number(b.dataset.del), 1);
      dirty = true;
      render();
    }));
  }

  async function save() {
    const bad = draft.find((u) => !u.username || !u.roles.length || (!u.id && (u.password || '').length < 8));
    if (bad) { toast(!bad.username ? 'Username wajib diisi' : !bad.roles.length ? `Pilih minimal 1 role untuk ${bad.username}` : `Password ${bad.username} minimal 8 karakter`, true); return; }
    try {
      users = await api('/api/users', json('PUT', draft));
      draft = structuredClone(users);
      dirty = false;
      render();
      toast('Pengguna disimpan');
    } catch (e) { toast(e.message, true); }
  }

  document.addEventListener('admin:view', async (e) => {
    if (e.detail !== 'users' || !window.A.can('users')) return;
    if (!dirty) {
      try { users = await api('/api/users'); } catch (err) { toast(err.message, true); return; }
      draft = structuredClone(users);
    }
    render();
  });
})();
