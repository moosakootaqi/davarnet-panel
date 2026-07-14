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

// ---------- accent color picker ----------
const savedColor = JSON.parse(localStorage.getItem('davarnet-color') || 'null');
if (savedColor) {
  document.documentElement.style.setProperty('--accent', savedColor.c1);
  document.documentElement.style.setProperty('--accent-2', savedColor.c2);
}
document.querySelectorAll('.swatch').forEach((btn) => {
  if (savedColor && btn.dataset.c1 === savedColor.c1) btn.classList.add('active');
  btn.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.documentElement.style.setProperty('--accent', btn.dataset.c1);
    document.documentElement.style.setProperty('--accent-2', btn.dataset.c2);
    localStorage.setItem('davarnet-color', JSON.stringify({ c1: btn.dataset.c1, c2: btn.dataset.c2 }));
  });
});

// ---------- mascot ----------
const MASCOT_FACES = {
  happy: `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="var(--accent)" opacity="0.15"/><circle cx="21" cy="26" r="3.2" fill="var(--text)"/><circle cx="39" cy="26" r="3.2" fill="var(--text)"/><path d="M18 36 Q30 46 42 36" stroke="var(--text)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  neutral: `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="var(--warning)" opacity="0.15"/><circle cx="21" cy="26" r="3.2" fill="var(--text)"/><circle cx="39" cy="26" r="3.2" fill="var(--text)"/><path d="M20 38 Q30 34 40 38" stroke="var(--text)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  worried: `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="var(--danger)" opacity="0.15"/><circle cx="21" cy="27" r="3.2" fill="var(--text)"/><circle cx="39" cy="27" r="3.2" fill="var(--text)"/><path d="M19 40 Q30 32 41 40" stroke="var(--text)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
};
function updateMascot(clients) {
  const mascotEl = document.getElementById('mascot');
  const speechEl = document.getElementById('mascotSpeech');
  if (!mascotEl) return;
  const active = clients.filter((c) => !c.expired);
  const hasExpired = clients.some((c) => c.expired);
  const soon = active
    .map((c) => (c.expiresAt ? Math.ceil((new Date(c.expiresAt).getTime() - Date.now()) / 86400000) : null))
    .filter((d) => d !== null);
  const minLeft = soon.length ? Math.min(...soon) : null;

  if (hasExpired) {
    mascotEl.innerHTML = MASCOT_FACES.worried;
    speechEl.textContent = 'یکی از کانفیگ‌هات منقضی شده، یه سر بزن 👀';
  } else if (minLeft !== null && minLeft <= 3) {
    mascotEl.innerHTML = MASCOT_FACES.neutral;
    speechEl.textContent = `یه کانفیگ ${minLeft} روز دیگه منقضی میشه، تمدیدش کن 🙂`;
  } else if (clients.length === 0) {
    mascotEl.innerHTML = MASCOT_FACES.neutral;
    speechEl.textContent = 'هنوز کانفیگی نساختی، شروع کن! 👋';
  } else {
    mascotEl.innerHTML = MASCOT_FACES.happy;
    speechEl.textContent = 'همه‌چی مرتبه ✨';
  }
}

// ---------- confetti + sound celebration ----------
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) { /* audio not available, ignore */ }
}
function celebrate() {
  playBeep();
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#6366f1', '#8b5cf6', '#22d3ee', '#f59e0b', '#f43f5e'];
  const pieces = Array.from({ length: 80 }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * 120,
    y: canvas.height / 3,
    vx: (Math.random() - 0.5) * 9,
    vy: Math.random() * -9 - 3,
    size: Math.random() * 6 + 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * 360,
    vr: (Math.random() - 0.5) * 12,
  }));
  let frame = 0;
  function tick() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach((p) => {
      p.vy += 0.25;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });
    if (frame < 90) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  tick();
}

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
  updateLoyaltyBadge();
  await loadClients();
  if (me.role === 'admin') await loadUsers();
}

function updateLoyaltyBadge() {
  const el = document.getElementById('badge');
  if (!me.createdAt) { el.textContent = ''; return; }
  const days = Math.floor((Date.now() - new Date(me.createdAt).getTime()) / (24 * 60 * 60 * 1000));
  if (days >= 180) el.textContent = '🥇 کاربر طلایی';
  else if (days >= 30) el.textContent = '🥈 کاربر باتجربه';
  else el.textContent = '🥉 عضو جدید';
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
  updateMascot(clients);

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
    celebrate();
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
