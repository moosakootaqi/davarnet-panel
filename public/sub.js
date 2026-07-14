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

function formatBytes(bytes) {
  if (!bytes) return '۰ مگابایت';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} مگابایت`;
  return `${(mb / 1024).toFixed(2)} گیگابایت`;
}

const subId = window.location.pathname.split('/').filter(Boolean).pop();
let pingDomain = '';

async function init() {
  try {
    const res = await fetch(`/sub/${subId}/data`);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    render(data);
  } catch (e) {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('notFoundState').classList.remove('hidden');
  }
}

function render(data) {
  pingDomain = data.pingDomain;

  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');

  document.getElementById('configName').textContent = data.name;
  document.getElementById('configNote').textContent = data.note || '';

  const badge = document.getElementById('statusBadge');
  if (data.expired) {
    badge.textContent = 'منقضی شده';
    badge.className = 'badge expired';
  } else {
    badge.textContent = 'فعال';
    badge.className = 'badge';
    badge.style.background = 'rgba(34,197,94,0.15)';
    badge.style.color = '#4ade80';
    badge.style.border = '1px solid rgba(34,197,94,0.3)';
  }

  if (data.expiresAt) {
    const total = new Date(data.expiresAt).getTime() - new Date(data.createdAt).getTime();
    const remaining = new Date(data.expiresAt).getTime() - Date.now();
    const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
    const daysLeft = Math.ceil(remaining / 86400000);
    document.getElementById('expiryBig').textContent = data.expired ? 'منقضی شده' : `${daysLeft} روز مانده`;
    document.getElementById('expiryBar').style.width = `${data.expired ? 0 : pct}%`;
    document.getElementById('expiryDetail').textContent = `تاریخ انقضا: ${new Date(data.expiresAt).toLocaleDateString('fa-IR')}`;
  } else {
    document.getElementById('expiryBig').textContent = 'بدون انقضا ♾️';
    document.getElementById('expiryBar').style.width = '100%';
    document.getElementById('expiryDetail').textContent = 'این کانفیگ تاریخ انقضا نداره';
  }

  document.getElementById('trafficBig').textContent = formatBytes(data.traffic);
  document.getElementById('uploadDetail').textContent = `آپلود: ${formatBytes(data.uplink)}`;
  document.getElementById('downloadDetail').textContent = `دانلود: ${formatBytes(data.downlink)}`;

  document.getElementById('subLinkBox').textContent = data.subUrl || window.location.href;

  document.getElementById('copyBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(data.subUrl || window.location.href);
    toast('لینک ساب کپی شد ✅');
  });

  document.getElementById('qrBtn').addEventListener('click', () => {
    const modal = document.getElementById('qrModal');
    const body = document.getElementById('qrModalBody');
    body.innerHTML = '';
    new QRCode(body, { text: data.subUrl || window.location.href, width: 220, height: 220, colorDark: '#0b0e1a', colorLight: '#ffffff' });
    modal.classList.remove('hidden');
  });
}

document.getElementById('qrModalClose').addEventListener('click', () => {
  document.getElementById('qrModal').classList.add('hidden');
});
document.getElementById('qrModal').addEventListener('click', (e) => {
  if (e.target.id === 'qrModal') document.getElementById('qrModal').classList.add('hidden');
});

document.getElementById('pingBtn').addEventListener('click', async () => {
  if (!pingDomain) return;
  const resultEl = document.getElementById('pingResult');
  resultEl.textContent = 'در حال تست...';
  resultEl.className = 'sub-big-value ping-value';

  const attempts = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    try {
      await fetch(`https://${pingDomain}/`, { mode: 'no-cors', cache: 'no-store' });
    } catch (e) { /* opaque response or network-level error, timing still useful */ }
    attempts.push(performance.now() - start);
  }
  const avg = Math.round(attempts.reduce((a, b) => a + b, 0) / attempts.length);

  let cls = 'good';
  let label = 'عالی 🟢';
  if (avg >= 400) { cls = 'bad'; label = 'ضعیف 🔴'; }
  else if (avg >= 150) { cls = 'mid'; label = 'خوب 🟡'; }

  resultEl.textContent = `${avg}ms — ${label}`;
  resultEl.className = `sub-big-value ping-value ${cls}`;
});

init();
