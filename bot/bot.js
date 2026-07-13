// Minimal Telegram bot using long polling + Node's built-in fetch (no extra deps).

const BOT_TOKEN = process.env.BOT_TOKEN;
const PANEL_URL = (process.env.PANEL_URL || '').replace(/\/$/, ''); // e.g. https://xxxx.up.railway.app
const BOT_SECRET = process.env.BOT_SECRET || '';
const DATA_DIR = process.env.DATA_DIR || '/botdata';

const fs = require('fs');
const path = require('path');

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN env var is required');
  process.exit(1);
}
if (!PANEL_URL) {
  console.error('PANEL_URL env var is required');
  process.exit(1);
}
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
function loadSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}');
  return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
}
function saveSessions(s) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s, null, 2));
}

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method, params) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}
function send(chatId, text) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
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

const HELP_TEXT = `<b>دستورات ربات Davarnet</b>

/login — ورود به حساب (قدم به قدم)
/logout — خروج
/list — نمایش کانفیگ‌های من
/new اسم [روز_انقضا] — ساخت کانفیگ جدید
/delete آیدی — حذف یه کانفیگ
/help — همین راهنما`;

// tracks users mid-login: chatId -> { step: 'username' | 'password', username? }
const pendingLogin = new Map();

async function tryLogin(chatId, u, p) {
  try {
    const result = await panel('/bot/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    if (!result.ok) return send(chatId, '❌ نام کاربری یا رمز عبور اشتباهه. دوباره امتحان کن: /login');
    const sessions = loadSessions();
    sessions[chatId] = u;
    saveSessions(sessions);
    return send(chatId, `✅ وارد شدی به عنوان <b>${u}</b>.\n\n${HELP_TEXT}`);
  } catch (e) {
    return send(chatId, '❌ خطا در ورود: ' + e.message);
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  // handle step-by-step login flow first (plain text replies, no leading slash)
  if (!text.startsWith('/') && pendingLogin.has(chatId)) {
    const state = pendingLogin.get(chatId);
    if (state.step === 'username') {
      pendingLogin.set(chatId, { step: 'password', username: text });
      return send(chatId, '🔑 حالا رمز عبورت رو بفرست:');
    }
    if (state.step === 'password') {
      pendingLogin.delete(chatId);
      return tryLogin(chatId, state.username, text);
    }
  }

  if (!text.startsWith('/')) return;

  const [cmd, ...args] = text.split(/\s+/);
  const sessions = loadSessions();
  const username = sessions[chatId];

  if (cmd === '/start' || cmd === '/help') {
    return send(chatId, `سلام 👋 به ربات <b>Davarnet</b> خوش اومدی.\n\n${HELP_TEXT}`);
  }

  if (cmd === '/login') {
    const [u, p] = args;
    // old one-line format still works: /login username password
    if (u && p) return tryLogin(chatId, u, p);
    // new step-by-step format
    pendingLogin.set(chatId, { step: 'username' });
    return send(chatId, '👤 یوزرنیمت رو بفرست:');
  }

  if (cmd === '/logout') {
    delete sessions[chatId];
    saveSessions(sessions);
    return send(chatId, 'خارج شدی.');
  }

  if (!username) {
    return send(chatId, 'اول باید وارد بشی: /login یوزرنیم رمزعبور');
  }

  if (cmd === '/list') {
    try {
      const clients = await panel(`/bot/clients?username=${encodeURIComponent(username)}`);
      if (clients.length === 0) return send(chatId, 'هنوز کانفیگی نساختی. با /new اسم بساز.');
      const lines = clients.map((c) => {
        const status = c.expired ? '❌ منقضی' : '✅ فعال';
        return `• <b>${c.name}</b> (${status})\nآیدی: <code>${c.id}</code>\nمصرف: ${fmtBytes(c.traffic)}\n${c.link}`;
      });
      return send(chatId, lines.join('\n\n'));
    } catch (e) {
      return send(chatId, '❌ خطا: ' + e.message);
    }
  }

  if (cmd === '/new') {
    const name = args[0];
    const expiryDays = args[1] ? Number(args[1]) : null;
    if (!name) return send(chatId, 'فرمت درست: /new اسم [روز_انقضا]');
    try {
      const client = await panel('/bot/clients', {
        method: 'POST',
        body: JSON.stringify({ username, name, expiryDays }),
      });
      return send(chatId, `🎉 کانفیگ ساخته شد.\nآیدی: <code>${client.id}</code>\n${client.link}`);
    } catch (e) {
      return send(chatId, '❌ خطا: ' + e.message);
    }
  }

  if (cmd === '/delete') {
    const id = args[0];
    if (!id) return send(chatId, 'فرمت درست: /delete آیدی');
    try {
      await panel(`/bot/clients/${encodeURIComponent(id)}?username=${encodeURIComponent(username)}`, { method: 'DELETE' });
      return send(chatId, '🗑️ حذف شد.');
    } catch (e) {
      return send(chatId, '❌ خطا: ' + e.message);
    }
  }

  return send(chatId, 'دستور ناشناخته. /help رو بزن.');
}

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
          }
        }
      }
    } catch (e) {
      console.error('poll error', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

console.log('Davarnet Telegram bot started, polling...');
pollLoop();
