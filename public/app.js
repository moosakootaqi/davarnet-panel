let me = null;
let meta = { domain: '', wsPath: '', maxConfigs: 0 };

// ---------- theme ----------
function applyThemeIcon() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = isLight ? '☀️' : '🌙';
}
document.getElementById('themeToggle').addEventListener('click', () => {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('davarnet-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('davarnet-theme', 'light');
  }
  applyThemeIcon();
});
applyThemeIcon();

function toast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطای ناشناخته');
  return data;
}

function buildLink(client) {
  const domain = meta.domain;
  const wsPath = encodeURIComponent(meta.wsPath || '/');
  return `vless://${client.uuid}@${domain}:443?encryption=none&security=tls&sni=${domain}&type=ws&host=${domain}&path=${wsPath}#${encodeURIComponent(client.name)}`;
}

function formatBytes(bytes) {
  if (!bytes) return '۰ مگابایت';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} مگابایت`;
  return `${(mb / 1024).toFixed(2)} گیگابایت`;
}

function daysLeft(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function showLogin() {
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('appView').classList.add('hidden');
}
function showApp() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';
  try {
    me = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    await afterLogin();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  me = null;
  showLogin();
});

async function afterLogin() {
  document.getElementById('whoami').textContent = `${me.username} ${me.role === 'admin' ? '(ادمین)' : ''}`;
  document.getElementById('tabs').classList.toggle('hidden', me.role !== 'admin');
  meta = await api('/api/meta');
  showApp();
  updateLimitInfo();
  await loadClients();
  if (me.role === 'admin') await loadUsers();
}

function updateLimitInfo() {
  const el = document.getElementById('limitInfo');
  if (me.role === 'admin' || !meta.maxConfigs) {
    el.textContent = '';
    return;
  }
  el.textContent = `حداکثر ${meta.maxConfigs} کانفیگ فعال مجاز است`;
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('clientsTab').classList.toggle('hidden', tab !== 'clients');
    document.getElementById('usersTab').classList.toggle('hidden', tab !== 'users');
  });
});

async function loadClients() {
  const clients = await api('/api/clients');
  const list = document.getElementById('clientsList');

  list.innerHTML = !meta.domain ? '<div class="empty-state">⚠️ دامنه اینباند هنوز تنظیم نشده (INBOUND_DOMAIN)</div>' : '';

  if (clients.length === 0) {
    list.innerHTML += '<div class="empty-state">هنوز کانفیگی ساخته نشده. یکی بساز 👆</div>';
    return;
  }

  window._clients = clients;

  clients.forEach((c) => {
    const left = daysLeft(c.expiresAt);
    let badge = '';
    if (c.expired) badge = '<span class="badge expired">منقضی شده</span>';
    else if (left !== null && left <= 3) badge = `<span class="badge expiring">${left} روز مانده</span>`;

    const card = document.createElement('div');
    card.className = 'glass-card client-card' + (c.expired ? ' is-expired' : '');
    card.innerHTML = `
      <div class="client-top">
        <div>
          <div class="client-name">${escapeHtml(c.name)} ${badge}</div>
          ${me.role === 'admin' ? `<div class="client-owner">مالک: ${escapeHtml(c.owner)}</div>` : ''}
        </div>
        <div class="client-date">${new Date(c.createdAt).toLocaleDateString('fa-IR')}</div>
      </div>
      ${c.note ? `<div class="client-note">${escapeHtml(c.note)}</div>` : ''}
      <div class="traffic-row">
        <span>مصرف: ${formatBytes(c.traffic)}</span>
        <div class="traffic-bar"><div class="traffic-bar-fill" style="width:${Math.min(100, (c.traffic / (1024*1024*1024)) * 20)}%"></div></div>
      </div>
      <div class="client-link">${meta.domain ? buildLink(c) : '—'}</div>
      <div class="client-actions">
        <button class="btn ghost small" data-action="copy" data-id="${c.id}">کپی لینک</button>
        <button class="btn ghost small" data-action="qr" data-id="${c.id}">نمایش QR</button>
        <button class="btn danger small" data-action="delete" data-id="${c.id}">حذف</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleClientAction(btn.dataset.action, btn.dataset.id));
  });
}

function handleClientAction(action, id) {
  const client = window._clients.find((c) => c.id === id);
  if (!client) return;
  if (action === 'copy') {
    navigator.clipboard.writeText(buildLink(client));
    toast('لینک کپی شد ✅');
  } else if (action === 'qr') {
    openQrModal(client);
  } else if (action === 'delete') {
    deleteClient(id);
  }
}

async function deleteClient(id) {
  if (!confirm('این کانفیگ حذف بشه؟')) return;
  try {
    await api('/api/clients/' + id, { method: 'DELETE' });
    toast('حذف شد');
    await loadClients();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('addClientBtn').addEventListener('click', async () => {
  const nameEl = document.getElementById('newClientName');
  const noteEl = document.getElementById('newClientNote');
  const expiryEl = document.getElementById('newClientExpiry');
  const name = nameEl.value.trim();
  if (!name) return toast('اسم کانفیگ رو وارد کن', 'error');
  try {
    await api('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name, note: noteEl.value.trim(), expiryDays: expiryEl.value ? Number(expiryEl.value) : null }),
    });
    nameEl.value = '';
    noteEl.value = '';
    expiryEl.value = '';
    toast('کانفیگ ساخته شد 🎉');
    await loadClients();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function loadUsers() {
  const users = await api('/api/users');
  const list = document.getElementById('usersList');
  list.innerHTML = '';
  users.forEach((u) => {
    const card = document.createElement('div');
    card.className = 'glass-card client-card';
    card.innerHTML = `
      <div class="client-top">
        <div class="client-name">${escapeHtml(u.username)} ${u.role === 'admin' ? '👑' : ''}</div>
        <div class="client-date">${new Date(u.createdAt).toLocaleDateString('fa-IR')}</div>
      </div>
      <div class="client-actions">
        ${u.role !== 'admin' ? `<button class="btn danger small" data-user="${u.username}">حذف کاربر</button>` : ''}
      </div>
    `;
    list.appendChild(card);
  });
  list.querySelectorAll('button[data-user]').forEach((btn) => {
    btn.addEventListener('click', () => deleteUser(btn.dataset.user));
  });
}

async function deleteUser(username) {
  if (!confirm(`کاربر "${username}" و همه کانفیگ‌هاش حذف بشه؟`)) return;
  try {
    await api('/api/users/' + username, { method: 'DELETE' });
    toast('کاربر حذف شد');
    await loadUsers();
    await loadClients();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('addUserBtn').addEventListener('click', async () => {
  const nameEl = document.getElementById('newUserName');
  const passEl = document.getElementById('newUserPass');
  const username = nameEl.value.trim();
  const password = passEl.value;
  if (!username || !password) return toast('نام کاربری و رمز عبور رو وارد کن', 'error');
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify({ username, password }) });
    nameEl.value = '';
    passEl.value = '';
    toast('کاربر ساخته شد 🎉');
    await loadUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
});

function openQrModal(client) {
  const modal = document.getElementById('qrModal');
  const body = document.getElementById('qrModalBody');
  document.getElementById('qrModalTitle').textContent = client.name;
  body.innerHTML = '';
  new QRCode(body, { text: buildLink(client), width: 220, height: 220, colorDark: '#0b0e1a', colorLight: '#ffffff' });
  modal.classList.remove('hidden');
}
document.getElementById('qrModalClose').addEventListener('click', () => {
  document.getElementById('qrModal').classList.add('hidden');
});
document.getElementById('qrModal').addEventListener('click', (e) => {
  if (e.target.id === 'qrModal') document.getElementById('qrModal').classList.add('hidden');
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

(async () => {
  try {
    me = await api('/api/me');
    await afterLogin();
  } catch (err) {
    showLogin();
  }
})();
