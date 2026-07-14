// Telegram bot for Davarnet - full button-based UI
// Uses Node's built-in fetch, long polling, no extra deps.

const BOT_TOKEN = process.env.BOT_TOKEN;
const PANEL_URL = (process.env.PANEL_URL || '').replace(/\/$/, '');
const BOT_SECRET = process.env.BOT_SECRET || '';
const DATA_DIR = process.env.DATA_DIR || '/botdata';

const fs = require('fs');
const path = require('path');
const tls = require('tls');

if (!BOT_TOKEN) { console.error('BOT_TOKEN env var is required'); process.exit(1); }
if (!PANEL_URL) { console.error('PANEL_URL env var is required'); process.exit(1); }
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const REMINDED_FILE = path.join(DATA_DIR, 'reminded.json');
const STREAKS_FILE = path.join(DATA_DIR, 'streaks.json');
const ANNIV_FILE = path.join(DATA_DIR, 'anniversaries.json');
const EASTER_FILE = path.join(DATA_DIR, 'easter.json');

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback));
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
function saveJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function loadSessions() { return loadJson(SESSIONS_FILE, {}); }
function saveSessions(s) { saveJson(SESSIONS_FILE, s); }
function loadReminded() { return loadJson(REMINDED_FILE, {}); }
function saveReminded(r) { saveJson(REMINDED_FILE, r); }
function loadStreaks() { return loadJson(STREAKS_FILE, {}); }
function saveStreaks(s) { saveJson(STREAKS_FILE, s); }
function loadAnniv() { return loadJson(ANNIV_FILE, {}); }
function saveAnniv(a) { saveJson(ANNIV_FILE, a); }
function loadEaster() { return loadJson(EASTER_FILE, {}); }
function saveEaster(e) { saveJson(EASTER_FILE, e); }

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const PHRASES = {
  configCreated: ['🎉 کانفیگ ساخته شد!', '✅ آماده‌ست، بفرما!', '🚀 ساخته شد، خوش بگذره!'],
  configDeleted: ['🗑️ حذف شد.', 'باشه، پاکش کردم 🗑️', 'رفت که رفت 👋'],
  nothingHere: ['هنوز کانفیگی نساختی 🤔', 'اینجا خالیه، یکی بساز 👆', 'فعلاً چیزی نیست، بزن بسازیم!'],
};

const FORTUNES = [
  '🔮 امروز پینگت پایین می‌مونه، دلت شاد!',
  '🔮 امروز روز خوبیه برای دانلود بدون قطعی 📥',
  '🔮 یه اتصال پایدار در انتظارته امروز 🌐',
  '🔮 امروز حتی فیلترینگ هم جلودار تو نیست 😎',
  '🔮 سرعتت امروز مثل باد میشه 🌬️',
  '🔮 امروز روز خوبیه، یه کانفیگ جدید بساز 🎁',
];
const JOKES = [
  '😹 چرا کامپیوترا سرما می‌خورن؟ چون پنجره‌هاشون رو باز میذارن!',
  '😹 وی‌پی‌ان به دوستش گفت: من همیشه یه راه فرار دارم 😏',
  '😹 پسورد قوی مثل شوخی خوبه؛ هیچکس حدس نمی‌زنه ولی جفتشون یادت میره 🤷',
  '😹 فرق سرور خوب با بد چیه؟ سرور خوب وقتی قطع میشه معذرت‌خواهی می‌کنه 😄',
  '😹 من به سرورم گفتم دوستت دارم، گفت Connection timeout ⏱️',
];

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method, params) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}
function send(chatId, text, extra = {}) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}
function sendPhoto(chatId, photoUrl, caption) {
  return tg('sendPhoto', { chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' });
}
function answerCallback(id, text) {
  return tg('answerCallbackQuery', { callback_query_id: id, text: text || '' });
}

async function panel(pathName, options = {}) {
  const res = await fetch(`${PANEL_URL}${pathName}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': BOT_SECRET, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطای پنل');
  return data;
}

function fmtBytes(bytes) {
  if (!bytes) return '0MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}
function qrUrlFor(link) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(link)}`;
}

// ---------- sessions ----------
function getSession(chatId) { return loadSessions()[chatId] || null; }
function setSession(chatId, username, role) {
  const s = loadSessions();
  s[chatId] = { username, role };
  saveSessions(s);
}
function clearSession(chatId) {
  const s = loadSessions();
  delete s[chatId];
  saveSessions(s);
}

// ---------- streaks ----------
function todayStr() { return new Date().toISOString().slice(0, 10); }
function touchStreak(chatId) {
  const streaks = loadStreaks();
  const today = todayStr();
  const entry = streaks[chatId] || { lastDate: null, count: 0 };
  if (entry.lastDate === today) return { count: entry.count, incremented: false };
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  entry.count = entry.lastDate === yesterday ? entry.count + 1 : 1;
  entry.lastDate = today;
  streaks[chatId] = entry;
  saveStreaks(streaks);
  return { count: entry.count, incremented: true };
}

// ---------- keyboards ----------
function loggedOutKeyboard() {
  return { keyboard: [[{ text: '🔑 ورود' }]], resize_keyboard: true };
}
function loggedInKeyboard(isAdmin) {
  const rows = [
    [{ text: '📋 کانفیگ‌های من' }, { text: '➕ کانفیگ جدید' }],
    [{ text: '👤 حساب من' }, { text: 'ℹ️ راهنما' }],
    [{ text: '📥 دانلود اپ' }, { text: '📶 تست سرعت' }],
    [{ text: '🔮 فال روز' }, { text: '😹 یه جوک بگو' }],
  ];
  if (isAdmin) rows.push([{ text: '👑 مدیریت کاربران' }]);
  rows.push([{ text: '🚪 خروج' }]);
  return { keyboard: rows, resize_keyboard: true };
}
function expiryInlineKeyboard(prefix) {
  return {
    inline_keyboard: [
      [{ text: 'بدون انقضا', callback_data: `${prefix}:0` }, { text: '۷ روز', callback_data: `${prefix}:7` }],
      [{ text: '۳۰ روز', callback_data: `${prefix}:30` }, { text: '۹۰ روز', callback_data: `${prefix}:90` }],
    ],
  };
}
function configActionsKeyboard(id) {
  return {
    inline_keyboard: [
      [{ text: '📷 QR Code', callback_data: `qr:${id}` }, { text: '✏️ تغییر اسم', callback_data: `rename:${id}` }],
      [{ text: '⏳ تمدید', callback_data: `extend:${id}` }, { text: '🗑 حذف', callback_data: `delconfirm:${id}` }],
    ],
  };
}
function confirmDeleteKeyboard(id) {
  return {
    inline_keyboard: [[
      { text: '✅ بله، حذف شود', callback_data: `delyes:${id}` },
      { text: '❌ انصراف', callback_data: 'delno' },
    ]],
  };
}
function adminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📋 لیست کاربران', callback_data: 'admin:list' }],
      [{ text: '➕ کاربر جدید', callback_data: 'admin:new' }],
      [{ text: '🗑 حذف کاربر', callback_data: 'admin:del' }],
    ],
  };
}

// ---------- conversation state ----------
const pending = new Map();

async function showMainMenu(chatId, text) {
  const session = getSession(chatId);
  await send(chatId, text, { reply_markup: session ? loggedInKeyboard(session.role === 'admin') : loggedOutKeyboard() });
}

async function startLogin(chatId) {
  pending.set(chatId, { type: 'login_username' });
  await send(chatId, '👤 یوزرنیمت رو بفرست:', { reply_markup: { remove_keyboard: true } });
}

async function tryLogin(chatId, u, p) {
  try {
    const result = await panel('/bot/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    if (!result.ok) {
      await send(chatId, '❌ نام کاربری یا رمز عبور اشتباهه.');
      return startLogin(chatId);
    }
    setSession(chatId, u, result.role);
    await showMainMenu(chatId, `✅ خوش اومدی <b>${u}</b>! از دکمه‌های پایین استفاده کن.`);
  } catch (e) {
    await send(chatId, '❌ خطا در ورود: ' + e.message);
  }
}

async function listConfigs(chatId) {
  const session = getSession(chatId);
  try {
    const clients = await panel(`/bot/clients?username=${encodeURIComponent(session.username)}`);
    if (clients.length === 0) return send(chatId, `${pick(PHRASES.nothingHere)} رو «➕ کانفیگ جدید» بزن.`);
    for (const c of clients) {
      const status = c.expired ? '❌ منقضی' : '✅ فعال';
      const expiryLine = c.expiresAt ? `\nانقضا: ${new Date(c.expiresAt).toLocaleDateString('fa-IR')}` : '\nانقضا: ندارد';
      const text = `<b>${c.name}</b> (${status})\nمصرف: ${fmtBytes(c.traffic)}${expiryLine}\n\n${c.link}`;
      await send(chatId, text, { reply_markup: configActionsKeyboard(c.id) });
    }
  } catch (e) {
    await send(chatId, '❌ خطا: ' + e.message);
  }
}

async function startNewConfig(chatId) {
  pending.set(chatId, { type: 'new_name' });
  await send(chatId, '✏️ اسم این کانفیگ چی باشه؟ (مثلاً "گوشی من")');
}

async function createConfig(chatId, name, expiryDays) {
  const session = getSession(chatId);
  try {
    const client = await panel('/bot/clients', {
      method: 'POST',
      body: JSON.stringify({ username: session.username, name, expiryDays: expiryDays || null }),
    });
    await send(chatId, `${pick(PHRASES.configCreated)}\n\n${client.link}`, { reply_markup: configActionsKeyboard(client.id) });
    await showMainMenu(chatId, 'کار دیگه‌ای هست؟');
  } catch (e) {
    await send(chatId, '❌ خطا: ' + e.message);
  }
}

async function deleteConfig(chatId, id) {
  const session = getSession(chatId);
  try {
    await panel(`/bot/clients/${encodeURIComponent(id)}?username=${encodeURIComponent(session.username)}`, { method: 'DELETE' });
    await send(chatId, pick(PHRASES.configDeleted));
  } catch (e) {
    await send(chatId, '❌ خطا: ' + e.message);
  }
}

async function showProfile(chatId) {
  const session = getSession(chatId);
  try {
    const p = await panel(`/bot/profile?username=${encodeURIComponent(session.username)}`);
    const limitLine = p.maxConfigs > 0 ? `${p.activeConfigs} / ${p.maxConfigs}` : `${p.activeConfigs} (نامحدود)`;
    const streaks = loadStreaks();
    const streak = (streaks[chatId] && streaks[chatId].count) || 0;
    const ageDays = p.createdAt ? Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 86400000) : null;
    const badge = ageDays === null ? '' : ageDays >= 180 ? '🥇 کاربر طلایی' : ageDays >= 30 ? '🥈 کاربر باتجربه' : '🥉 عضو جدید';
    const text = `👤 <b>${p.username}</b> ${badge}\nنقش: ${p.role === 'admin' ? 'ادمین' : 'کاربر'}\nکانفیگ‌های فعال: ${limitLine}\nکل کانفیگ‌ها: ${p.totalConfigs}\nمجموع مصرف: ${fmtBytes(p.totalTraffic)}\n🔥 استریک: ${streak} روز متوالی`;
    await send(chatId, text);
  } catch (e) {
    await send(chatId, '❌ خطا: ' + e.message);
  }
}

function tcpPing(host, port = 443, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      if (done) return;
      done = true;
      const ms = Date.now() - start;
      socket.end();
      resolve(ms);
    });
    socket.on('error', () => { if (!done) { done = true; resolve(null); } });
    socket.on('timeout', () => { if (!done) { done = true; socket.destroy(); resolve(null); } });
  });
}

async function showDownloadLinks(chatId) {
  const text = `📥 <b>دانلود اپلیکیشن کلاینت</b>

<b>اندروید:</b>
v2rayNG (رایگان، متن‌باز)
https://play.google.com/store/apps/details?id=com.v2ray.ang
یا از گیت‌هاب: https://github.com/2dust/v2rayNG/releases

<b>iOS:</b>
Streisand (رایگان)
https://apps.apple.com/app/streisand/id6450534064

<b>ویندوز:</b>
v2rayN
https://github.com/2dust/v2rayN/releases

<b>راهنمای وصل شدن:</b>
۱. اپ رو نصب کن
۲. لینک کانفیگتو کپی کن
۳. تو اپ، گزینه Import from Clipboard رو بزن
۴. وصل شو ✅`;
  await send(chatId, text);
}

async function showSpeedTest(chatId) {
  await send(chatId, '⏳ در حال بررسی وضعیت سرور...');
  try {
    const start = Date.now();
    await panel('/bot/health');
    const panelMs = Date.now() - start;
    const metaData = await panel('/bot/meta');
    let tunnelMs = null;
    if (metaData.domain) tunnelMs = await tcpPing(metaData.domain, 443);

    function verdict(ms) {
      if (ms === null) return '❌ در دسترس نیست';
      if (ms < 150) return `${ms}ms 🟢 عالی`;
      if (ms < 400) return `${ms}ms 🟡 خوب`;
      return `${ms}ms 🔴 ضعیف`;
    }

    const text = `📶 <b>وضعیت سرور</b>

پنل: ${verdict(panelMs)}
اتصال VPN: ${verdict(tunnelMs)}

⚠️ این عدد فقط سلامت سرور رو نشون میده، نه سرعت اینترنت شخصی خودت.`;
    await send(chatId, text);
  } catch (e) {
    await send(chatId, '❌ خطا در بررسی: ' + e.message);
  }
}

// ---------- admin ----------
async function adminListUsers(chatId) {
  const session = getSession(chatId);
  try {
    const users = await panel(`/bot/admin/users?actingUsername=${encodeURIComponent(session.username)}`);
    const lines = users.map((u) => `${u.role === 'admin' ? '👑' : '•'} ${u.username}`);
    await send(chatId, `<b>لیست کاربران:</b>\n\n${lines.join('\n')}`);
  } catch (e) {
    await send(chatId, '❌ خطا: ' + e.message);
  }
}
async function adminDeleteUserPrompt(chatId) {
  const session = getSession(chatId);
  try {
    const users = await panel(`/bot/admin/users?actingUsername=${encodeURIComponent(session.username)}`);
    const nonAdmins = users.filter((u) => u.role !== 'admin');
    if (nonAdmins.length === 0) return send(chatId, 'کاربر عادی‌ای برای حذف وجود نداره.');
    const keyboard = nonAdmins.map((u) => [{ text: u.username, callback_data: `admindel:${u.username}` }]);
    await send(chatId, 'کدوم کاربر حذف بشه؟', { reply_markup: { inline_keyboard: keyboard } });
  } catch (e) {
    await send(chatId, '❌ خطا: ' + e.message);
  }
}

// ---------- message handler ----------
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!text) return;

  // hidden easter egg
  if (text === 'آبراکادابرا') {
    const session = getSession(chatId);
    if (!session) return send(chatId, '✨ یه چیزی حس کردم... ولی اول باید وارد بشی 😄');
    const easter = loadEaster();
    if (easter[session.username]) return send(chatId, '😄 قبلاً این جادو رو امتحان کردی!');
    try {
      const clients = await panel(`/bot/clients?username=${encodeURIComponent(session.username)}`);
      const activeClient = clients.find((c) => !c.expired);
      if (activeClient) {
        await panel(`/bot/clients/${encodeURIComponent(activeClient.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ username: session.username, addDays: 3 }),
        });
        await send(chatId, `🎉✨ جادو کار کرد! ۳ روز به کانفیگ «${activeClient.name}» اضافه شد.`);
      } else {
        return send(chatId, '✨ جادو رو حس کردم ولی کانفیگ فعالی نداری. یکی بساز و دوباره امتحان کن!');
      }
      easter[session.username] = true;
      saveEaster(easter);
    } catch (e) {
      await send(chatId, '❌ جادو شکست خورد: ' + e.message);
    }
    return;
  }

  const activeSession = getSession(chatId);
  if (activeSession) {
    const { count, incremented } = touchStreak(chatId);
    if (incremented && [3, 7, 14, 30, 60, 100].includes(count)) {
      send(chatId, `🔥 عالیه! ${count} روز متوالیه که سر می‌زنی!`);
    }
  }

  const state = pending.get(chatId);
  if (state) {
    if (state.type === 'login_username') {
      pending.set(chatId, { type: 'login_password', username: text });
      return send(chatId, '🔑 حالا رمز عبورت رو بفرست:');
    }
    if (state.type === 'login_password') {
      pending.delete(chatId);
      return tryLogin(chatId, state.username, text);
    }
    if (state.type === 'new_name') {
      pending.set(chatId, { type: 'new_expiry', name: text });
      return send(chatId, 'مدت اعتبار این کانفیگ چقدر باشه؟', { reply_markup: expiryInlineKeyboard('exp') });
    }
    if (state.type === 'rename_name') {
      pending.delete(chatId);
      const session = getSession(chatId);
      try {
        await panel(`/bot/clients/${encodeURIComponent(state.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ username: session.username, name: text }),
        });
        await send(chatId, '✅ اسم عوض شد.');
      } catch (e) {
        await send(chatId, '❌ خطا: ' + e.message);
      }
      return;
    }
    if (state.type === 'admin_new_username') {
      pending.set(chatId, { type: 'admin_new_password', username: text });
      return send(chatId, '🔑 رمز عبور این کاربر چی باشه؟');
    }
    if (state.type === 'admin_new_password') {
      pending.delete(chatId);
      const session = getSession(chatId);
      try {
        await panel('/bot/admin/users', {
          method: 'POST',
          body: JSON.stringify({ actingUsername: session.username, username: state.username, password: text }),
        });
        await send(chatId, `✅ کاربر «${state.username}» ساخته شد.`);
      } catch (e) {
        await send(chatId, '❌ خطا: ' + e.message);
      }
      return;
    }
  }

  if (text === '🔑 ورود') return startLogin(chatId);
  if (text === '📋 کانفیگ‌های من') return listConfigs(chatId);
  if (text === '➕ کانفیگ جدید') return startNewConfig(chatId);
  if (text === '👤 حساب من') return showProfile(chatId);
  if (text === '📥 دانلود اپ') return showDownloadLinks(chatId);
  if (text === '📶 تست سرعت') return showSpeedTest(chatId);
  if (text === '🔮 فال روز') return send(chatId, pick(FORTUNES));
  if (text === '😹 یه جوک بگو') return send(chatId, pick(JOKES));
  if (text === 'ℹ️ راهنما') {
    return send(chatId, 'از دکمه‌های پایین صفحه استفاده کن:\n📋 دیدن کانفیگ‌ها\n➕ ساخت کانفیگ جدید\n👤 اطلاعات حساب\n📥 دانلود اپ\n📶 تست سرعت سرور\n🚪 خروج از حساب');
  }
  if (text === '👑 مدیریت کاربران') {
    return send(chatId, 'یکی رو انتخاب کن:', { reply_markup: adminMenuKeyboard() });
  }
  if (text === '🚪 خروج') {
    clearSession(chatId);
    return showMainMenu(chatId, 'خارج شدی.');
  }
  if (text === '/start' || text === '/help') {
    return showMainMenu(chatId, 'سلام 👋 به <b>Davarnet</b> خوش اومدی. از دکمه‌های پایین صفحه استفاده کن.');
  }

  return showMainMenu(chatId, 'از دکمه‌های پایین استفاده کن 👇');
}

// ---------- callback handler ----------
async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const data = cb.data;
  const session = getSession(chatId);

  if (data.startsWith('exp:')) {
    const days = Number(data.split(':')[1]);
    const state = pending.get(chatId);
    pending.delete(chatId);
    await answerCallback(cb.id);
    const name = state && state.name ? state.name : 'کانفیگ';
    return createConfig(chatId, name, days);
  }

  if (data.startsWith('qr:')) {
    const id = data.split(':')[1];
    await answerCallback(cb.id);
    try {
      const clients = await panel(`/bot/clients?username=${encodeURIComponent(session.username)}`);
      const client = clients.find((c) => c.id === id);
      if (!client) return send(chatId, 'پیدا نشد.');
      return sendPhoto(chatId, qrUrlFor(client.link), client.name);
    } catch (e) {
      return send(chatId, '❌ خطا: ' + e.message);
    }
  }

  if (data.startsWith('rename:')) {
    const id = data.split(':')[1];
    pending.set(chatId, { type: 'rename_name', id });
    await answerCallback(cb.id);
    return send(chatId, '✏️ اسم جدید رو بفرست:');
  }

  if (data.startsWith('extend:')) {
    const id = data.split(':')[1];
    await answerCallback(cb.id);
    return send(chatId, 'چقدر تمدید بشه؟', { reply_markup: expiryInlineKeyboard(`extendopt:${id}`) });
  }

  if (data.startsWith('extendopt:')) {
    const parts = data.split(':');
    const id = parts[1];
    const days = Number(parts[2]);
    await answerCallback(cb.id);
    try {
      await panel(`/bot/clients/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ username: session.username, addDays: days }),
      });
      return send(chatId, days > 0 ? `✅ ${days} روز تمدید شد.` : '✅ ثبت شد.');
    } catch (e) {
      return send(chatId, '❌ خطا: ' + e.message);
    }
  }

  if (data.startsWith('delconfirm:')) {
    const id = data.split(':')[1];
    await answerCallback(cb.id);
    return send(chatId, 'مطمئنی می‌خوای این کانفیگ حذف بشه؟', { reply_markup: confirmDeleteKeyboard(id) });
  }
  if (data.startsWith('delyes:')) {
    const id = data.split(':')[1];
    await answerCallback(cb.id, 'در حال حذف...');
    return deleteConfig(chatId, id);
  }
  if (data === 'delno') {
    await answerCallback(cb.id, 'لغو شد');
    return send(chatId, 'باشه، حذف نشد.');
  }

  if (data === 'admin:list') { await answerCallback(cb.id); return adminListUsers(chatId); }
  if (data === 'admin:new') {
    await answerCallback(cb.id);
    pending.set(chatId, { type: 'admin_new_username' });
    return send(chatId, '👤 یوزرنیم کاربر جدید رو بفرست:');
  }
  if (data === 'admin:del') { await answerCallback(cb.id); return adminDeleteUserPrompt(chatId); }
  if (data.startsWith('admindel:')) {
    const username = data.split(':')[1];
    await answerCallback(cb.id, 'در حال حذف...');
    try {
      await panel(`/bot/admin/users/${encodeURIComponent(username)}?actingUsername=${encodeURIComponent(session.username)}`, { method: 'DELETE' });
      return send(chatId, `🗑️ کاربر «${username}» حذف شد.`);
    } catch (e) {
      return send(chatId, '❌ خطا: ' + e.message);
    }
  }

  return answerCallback(cb.id);
}

// ---------- expiry reminder job ----------
async function checkExpiringConfigs() {
  try {
    const expiring = await panel('/bot/admin/expiring?withinDays=2');
    if (expiring.length === 0) return;
    const reminded = loadReminded();
    const sessions = loadSessions();
    for (const c of expiring) {
      if (reminded[c.id]) continue;
      const chatId = Object.keys(sessions).find((id) => sessions[id].username === c.owner);
      if (chatId) {
        const days = Math.max(0, Math.ceil((new Date(c.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
        await send(chatId, `⏳ کانفیگ «${c.name}» تا ${days} روز دیگه منقضی میشه. اگه لازمه تمدیدش کن.`);
      }
      reminded[c.id] = true;
    }
    saveReminded(reminded);
  } catch (e) {
    console.error('reminder check failed', e.message);
  }
}
setInterval(checkExpiringConfigs, 6 * 60 * 60 * 1000);
setTimeout(checkExpiringConfigs, 30 * 1000);

// ---------- anniversary job ----------
async function checkAnniversaries() {
  try {
    const sessions = loadSessions();
    const anniv = loadAnniv();
    const usernames = [...new Set(Object.values(sessions).map((s) => s.username))];
    for (const username of usernames) {
      const chatId = Object.keys(sessions).find((id) => sessions[id].username === username);
      if (!chatId) continue;
      const profile = await panel(`/bot/profile?username=${encodeURIComponent(username)}`).catch(() => null);
      if (!profile || !profile.createdAt) continue;
      const ageDays = Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / 86400000);
      const monthNumber = Math.floor(ageDays / 30);
      if (monthNumber < 1) continue;
      if (anniv[username] === monthNumber) continue;
      anniv[username] = monthNumber;
      const label = monthNumber === 1 ? 'یه ماهه' : `${monthNumber} ماهه`;
      await send(chatId, `🎉 تبریک! ${label} با <b>Davarnet</b> همراهی، ممنون که هستی 💜`);
    }
    saveAnniv(anniv);
  } catch (e) {
    console.error('anniversary check failed', e.message);
  }
}
setInterval(checkAnniversaries, 12 * 60 * 60 * 1000);
setTimeout(checkAnniversaries, 45 * 1000);

// ---------- polling loop ----------
let offset = 0;
async function pollLoop() {
  while (true) {
    try {
      const res = await tg('getUpdates', { offset, timeout: 30 });
      if (res.ok && res.result) {
        for (const update of res.result) {
          offset = update.update_id + 1;
          if (update.message) {
            handleMessage(update.message).catch((e) => console.error('handleMessage error', e));
          } else if (update.callback_query) {
            handleCallback(update.callback_query).catch((e) => console.error('handleCallback error', e));
          }
        }
      }
    } catch (e) {
      console.error('poll error', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

console.log('Davarnet Telegram bot started (v2, full feature set), polling...');
pollLoop();
