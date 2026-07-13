// Telegram bot for Davarnet - button-based UI (reply keyboard + inline keyboards)
// Uses Node's built-in fetch, long polling, no extra deps.

const BOT_TOKEN = process.env.BOT_TOKEN;
const PANEL_URL = (process.env.PANEL_URL || '').replace(/\/$/, '');
const BOT_SECRET = process.env.BOT_SECRET || '';
const DATA_DIR = process.env.DATA_DIR || '/botdata';

const fs = require('fs');
const path = require('path');

if (!BOT_TOKEN) { console.error('BOT_TOKEN env var is required'); process.exit(1); }
if (!PANEL_URL) { console.error('PANEL_URL env var is required'); process.exit(1); }
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
function loadSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');
  return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
}
function saveSessions(s) { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s, null, 2)); }

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

// ---------- keyboards ----------
function loggedOutKeyboard() {
  return { keyboard: [[{ text: '🔑 ورود' }]], resize_keyboard: true };
}
function loggedInKeyboard() {
  return {
    keyboard: [
      [{ text: '📋 کانفیگ‌های من' }, { text: '➕ کانفیگ جدید' }],
      [{ text: '🚪 خروج' }],
    ],
    resize_keyboard: true,
  };
}
function expiryInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'بدون انقضا', callback_data: 'exp:0' },
        { text: '۷ روز', callback_data: 'exp:7' },
      ],
      [
        { text: '۳۰ روز', callback_data: 'exp:30' },
        { text: '۹۰ روز', callback_data: 'exp:90' },
      ],
    ],
  };
}
function deleteInlineKeyboard(id) {
  return { inline_keyboard: [[{ text: '🗑 حذف این کانفیگ', callback_data: `delconfirm:${id}` }]] };
}
function confirmDeleteKeyboard(id) {
  return {
    inline_keyboard: [[
      { text: '✅ بله، حذف شود', callback_data: `delyes:${id}` },
      { text: '❌ انصراف', callback_data: 'delno' },
    ]],
  };
}

// ---------- per-chat conversation state (in-memory) ----------
// pending[chatId] = { type: 'login_username' | 'login_password' | 'new_name' | 'new_expiry', ...data }
const pending = new Map();

function getUsername(chatId) {
  const sessions = loadSessions();
  return sessions[chatId];
}
function setUsername(chatId, username) {
  const sessions = loadSessions();
  sessions[chatId] = username;
  saveSessions(sessions);
}
function clearUsername(chatId) {
  const sessions = loadSessions();
  delete sessions[chatId];
  saveSessions(sessions);
}

async function showMainMenu(chatId, text) {
  const username = getUsername(chatId);
  await send(chatId, text, { reply_markup: username ? loggedInKeyboard() : loggedOutKeyboard() });
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
    setUsername(chatId, u);
    await showMainMenu(chatId, `✅ خوش اومدی <b>${u}</b>! از دکمه‌های پایین استفاده کن.`);
  } catch (e) {
    await send(chatId, '❌ خطا در ورود: ' + e.message);
  }
}

async function listConfigs(chatId) {
  const username = getUsername(chatId);
  try {
    const clients = await panel(`/bot/clients?username=${encodeURIComponent(username)}`);
    if (clients.length === 0) {
      return send(chatId, 'هنوز کانفیگی نساختی. رو «➕ کانفیگ جدید» بزن.');
    }
    for (const c of clients) {
      const status = c.expired ? '❌ منقضی' : '✅ فعال';
      const text = `<b>${c.name}</b> (${status})\nمصرف: ${fmtBytes(c.traffic)}\n\n${c.link}`;
      await send(chatId, text, { reply_markup: deleteInlineKeyboard(c.id) });
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
  const username = getUsername(chatId);
  try {
    const client = await panel('/bot/clients', {
      method: 'POST',
      body: JSON.stringify({ username, name, expiryDays: expiryDays || null }),
    });
    await send(chatId, `🎉 کانفیگ ساخته شد!\n\n${client.link}`, { reply_markup: deleteInlineKeyboard(client.id) });
    await showMainMenu(chatId, 'کار دیگه‌ای هست؟');
  } catch (e) {
    await send(chatId, '❌ خطا: ' + e.message);
  }
}

async function deleteConfig(chatId, id) {
  const username = getUsername(chatId);
  try {
    await panel(`/bot/clients/${encodeURIComponent(id)}?username=${encodeURIComponent(username)}`, { method: 'DELETE' });
    await send(chatId, '🗑️ حذف شد.');
  } catch (e) {
    await send(chatId, '❌ خطا: ' + e.message);
  }
}

// ---------- message handler ----------
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!text) return;

  const state = pending.get(chatId);

  // mid-conversation replies (typed, not button taps)
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
      return send(chatId, 'مدت اعتبار این کانفیگ چقدر باشه؟', { reply_markup: expiryInlineKeyboard() });
    }
  }

  // button taps (reply keyboard sends the button's label as plain text)
  if (text === '🔑 ورود') return startLogin(chatId);
  if (text === '📋 کانفیگ‌های من') return listConfigs(chatId);
  if (text === '➕ کانفیگ جدید') return startNewConfig(chatId);
  if (text === '🚪 خروج') {
    clearUsername(chatId);
    return showMainMenu(chatId, 'خارج شدی.');
  }

  if (text === '/start' || text === '/help') {
    return showMainMenu(chatId, 'سلام 👋 به <b>Davarnet</b> خوش اومدی. از دکمه‌های پایین صفحه استفاده کن.');
  }

  // fallback
  return showMainMenu(chatId, 'از دکمه‌های پایین استفاده کن 👇');
}

// ---------- callback (inline button) handler ----------
async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const data = cb.data;

  if (data.startsWith('exp:')) {
    const days = Number(data.split(':')[1]);
    const state = pending.get(chatId);
    pending.delete(chatId);
    await answerCallback(cb.id);
    const name = state && state.name ? state.name : 'کانفیگ';
    return createConfig(chatId, name, days);
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

  return answerCallback(cb.id);
}

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

console.log('Davarnet Telegram bot started (button UI), polling...');
pollLoop();
