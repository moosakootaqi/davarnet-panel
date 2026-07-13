const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const DATA_DIR = process.env.DATA_DIR || '/data';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const XRAY_CONFIG = '/tmp/config.json';
const XRAY_BIN = '/usr/local/bin/xray-core/xray';
const STATS_API = '127.0.0.1:10085';

const PANEL_PORT = process.env.PANEL_PORT || 3000;
const INBOUND_PORT = process.env.INBOUND_PORT || 8443;
const WS_PATH = process.env.WS_PATH || '/davarnet-ws';
const PUBLIC_DOMAIN = process.env.INBOUND_DOMAIN || '';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const MAX_CONFIGS_PER_USER = parseInt(process.env.MAX_CONFIGS_PER_USER || '0', 10); // 0 = unlimited
// Shared secret the Telegram bot service must send to use /bot/* routes
const BOT_SECRET = process.env.BOT_SECRET || '';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- password hashing ----------
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- users store ----------
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    const admin = {
      username: ADMIN_USER,
      password: hashPassword(ADMIN_PASS),
      role: 'admin',
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(USERS_FILE, JSON.stringify([admin], null, 2));
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ---------- clients store ----------
function loadClientsRaw() {
  if (!fs.existsSync(CLIENTS_FILE)) fs.writeFileSync(CLIENTS_FILE, '[]');
  return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8'));
}
function saveClients(clients) {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
}
function isExpired(client) {
  return client.expiresAt && new Date(client.expiresAt).getTime() < Date.now();
}
// active = not expired. Expired ones are kept in storage (for history) but excluded from Xray + counted as inactive.
function loadClients() {
  return loadClientsRaw();
}

// ---------- xray process management ----------
let xrayProcess = null;

function writeXrayConfig(clients) {
  const activeClients = clients.filter((c) => !isExpired(c));
  const config = {
    log: { loglevel: 'warning' },
    api: { tag: 'api', listen: `127.0.0.1:10085`, services: ['HandlerService', 'StatsService'] },
    stats: {},
    policy: {
      levels: { '0': { statsUserUplink: true, statsUserDownlink: true } },
      system: { statsInboundUplink: true, statsInboundDownlink: true },
    },
    inbounds: [
      {
        listen: '0.0.0.0',
        port: parseInt(INBOUND_PORT, 10),
        protocol: 'vless',
        tag: 'vless-ws',
        settings: {
          clients: activeClients.map((c) => ({ id: c.uuid, level: 0, email: c.id })),
          decryption: 'none',
        },
        streamSettings: { network: 'ws', wsSettings: { path: WS_PATH } },
      },
    ],
    outbounds: [{ protocol: 'freedom' }],
  };
  fs.writeFileSync(XRAY_CONFIG, JSON.stringify(config, null, 2));
}
function restartXray() {
  if (xrayProcess) {
    try { xrayProcess.kill(); } catch (e) { /* ignore */ }
  }
  xrayProcess = spawn(XRAY_BIN, ['-config', XRAY_CONFIG], { stdio: 'inherit' });
  xrayProcess.on('exit', (code) => console.log('xray exited with code', code));
}
function applyConfig() {
  const clients = loadClients();
  writeXrayConfig(clients);
  restartXray();
}

// ---------- traffic stats (via xray's own stats API) ----------
function getTrafficStats() {
  try {
    const out = execFileSync(XRAY_BIN, ['api', 'statsquery', `--server=${STATS_API}`], { timeout: 5000 }).toString();
    const parsed = JSON.parse(out);
    const map = {};
    (parsed.stat || []).forEach((s) => {
      const m = s.name.match(/^user>>>(.+)>>>traffic>>>(uplink|downlink)$/);
      if (!m) return;
      const id = m[1];
      const dir = m[2];
      if (!map[id]) map[id] = { uplink: 0, downlink: 0 };
      map[id][dir] = s.value || 0;
    });
    return map;
  } catch (e) {
    return {};
  }
}

// periodically clean up long-expired clients from disk (keep for 7 days after expiry, then drop)
function pruneOldExpired() {
  const clients = loadClientsRaw();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const kept = clients.filter((c) => !c.expiresAt || new Date(c.expiresAt).getTime() > cutoff);
  if (kept.length !== clients.length) saveClients(kept);
}
setInterval(pruneOldExpired, 60 * 60 * 1000); // hourly

// ---------- sessions ----------
const sessions = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createSession(username, role) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, role, expires: Date.now() + SESSION_TTL_MS });
  return token;
}
function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  if (!match) return null;
  const token = match[1];
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  return { token, ...s };
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
}
function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  req.session = session;
  next();
}
function requireAdmin(req, res, next) {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}
function requireBotSecret(req, res, next) {
  if (!BOT_SECRET || req.headers['x-bot-secret'] !== BOT_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

// ---------- helpers shared by web + bot ----------
function countActiveConfigs(username) {
  return loadClients().filter((c) => c.owner === username && !isExpired(c)).length;
}
function createClientFor(username, name, note, expiryDays) {
  const clients = loadClients();
  const cleanName = (name || 'کانفیگ').trim() || 'کانفیگ';
  let expiresAt = null;
  if (expiryDays && Number(expiryDays) > 0) {
    expiresAt = new Date(Date.now() + Number(expiryDays) * 24 * 60 * 60 * 1000).toISOString();
  }
  const client = {
    id: crypto.randomUUID(),
    uuid: crypto.randomUUID(),
    name: cleanName,
    note: (note || '').trim(),
    owner: username,
    expiresAt,
    createdAt: new Date().toISOString(),
  };
  clients.push(client);
  saveClients(clients);
  applyConfig();
  return client;
}
function deleteClientFor(username, id, isAdmin) {
  let clients = loadClients();
  const target = clients.find((c) => c.id === id);
  if (!target) return { error: 'not found', code: 404 };
  if (!isAdmin && target.owner !== username) return { error: 'forbidden', code: 403 };
  clients = clients.filter((c) => c.id !== id);
  saveClients(clients);
  applyConfig();
  return { ok: true };
}
function buildLinkFor(client) {
  const domain = PUBLIC_DOMAIN;
  const wsPath = encodeURIComponent(WS_PATH);
  return `vless://${client.uuid}@${domain}:443?encryption=none&security=tls&sni=${domain}&type=ws&host=${domain}&path=${wsPath}#${encodeURIComponent(client.name)}`;
}

// ---------- app ----------
const app = express();
app.use(express.json());

// ===== auth =====
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const users = loadUsers();
  const user = users.find((u) => u.username === username);
  if (!user || !verifyPassword(password || '', user.password)) {
    return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
  }
  const token = createSession(user.username, user.role);
  setSessionCookie(res, token);
  res.json({ username: user.username, role: user.role });
});
app.post('/api/logout', (req, res) => {
  const session = getSession(req);
  if (session) sessions.delete(session.token);
  clearSessionCookie(res);
  res.json({ ok: true });
});
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username, role: req.session.role, maxConfigs: MAX_CONFIGS_PER_USER });
});
app.get('/api/meta', requireAuth, (req, res) => {
  res.json({ domain: PUBLIC_DOMAIN, wsPath: WS_PATH, maxConfigs: MAX_CONFIGS_PER_USER });
});

// ===== admin: users =====
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  res.json(loadUsers().map((u) => ({ username: u.username, role: u.role, createdAt: u.createdAt })));
});
app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است' });
  const users = loadUsers();
  if (users.find((u) => u.username === username)) return res.status(409).json({ error: 'این نام کاربری قبلاً وجود دارد' });
  users.push({ username, password: hashPassword(password), role: 'user', createdAt: new Date().toISOString() });
  saveUsers(users);
  res.json({ ok: true });
});
app.delete('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
  const target = req.params.username;
  if (target === ADMIN_USER) return res.status(400).json({ error: 'نمی‌توان ادمین را حذف کرد' });
  let users = loadUsers();
  users = users.filter((u) => u.username !== target);
  saveUsers(users);
  let clients = loadClients();
  clients = clients.filter((c) => c.owner !== target);
  saveClients(clients);
  applyConfig();
  res.json({ ok: true });
});

// ===== clients (web) =====
app.get('/api/clients', requireAuth, (req, res) => {
  const all = loadClients();
  const mine = req.session.role === 'admin' ? all : all.filter((c) => c.owner === req.session.username);
  const traffic = getTrafficStats();
  const enriched = mine.map((c) => ({
    ...c,
    expired: isExpired(c),
    traffic: traffic[c.id] ? traffic[c.id].uplink + traffic[c.id].downlink : 0,
  }));
  res.json(enriched);
});

app.post('/api/clients', requireAuth, (req, res) => {
  const { name, note, expiryDays } = req.body || {};
  if (req.session.role !== 'admin' && MAX_CONFIGS_PER_USER > 0) {
    if (countActiveConfigs(req.session.username) >= MAX_CONFIGS_PER_USER) {
      return res.status(403).json({ error: `حداکثر ${MAX_CONFIGS_PER_USER} کانفیگ فعال مجاز است` });
    }
  }
  const client = createClientFor(req.session.username, name, note, expiryDays);
  res.json(client);
});

app.delete('/api/clients/:id', requireAuth, (req, res) => {
  const result = deleteClientFor(req.session.username, req.params.id, req.session.role === 'admin');
  if (result.error) return res.status(result.code).json({ error: result.error });
  res.json(result);
});

// ===== bot API (used only by the Telegram bot service, protected by shared secret) =====
app.post('/bot/login', requireBotSecret, (req, res) => {
  const { username, password } = req.body || {};
  const users = loadUsers();
  const user = users.find((u) => u.username === username);
  if (!user || !verifyPassword(password || '', user.password)) {
    return res.status(401).json({ ok: false });
  }
  res.json({ ok: true, role: user.role });
});
app.get('/bot/meta', requireBotSecret, (req, res) => {
  res.json({ domain: PUBLIC_DOMAIN, wsPath: WS_PATH, maxConfigs: MAX_CONFIGS_PER_USER });
});
app.get('/bot/health', requireBotSecret, (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});
app.get('/bot/clients', requireBotSecret, (req, res) => {
  const username = req.query.username;
  if (!username) return res.status(400).json({ error: 'username required' });
  const clients = loadClients().filter((c) => c.owner === username);
  res.json(clients.map((c) => ({ ...c, expired: isExpired(c), link: buildLinkFor(c) })));
});
app.post('/bot/clients', requireBotSecret, (req, res) => {
  const { username, name, note, expiryDays } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  if (MAX_CONFIGS_PER_USER > 0 && countActiveConfigs(username) >= MAX_CONFIGS_PER_USER) {
    return res.status(403).json({ error: `حداکثر ${MAX_CONFIGS_PER_USER} کانفیگ فعال مجاز است` });
  }
  const client = createClientFor(username, name, note, expiryDays);
  res.json({ ...client, link: buildLinkFor(client) });
});
app.delete('/bot/clients/:id', requireBotSecret, (req, res) => {
  const username = req.query.username;
  const result = deleteClientFor(username, req.params.id, false);
  if (result.error) return res.status(result.code).json({ error: result.error });
  res.json(result);
});

// rename and/or extend an existing config
app.patch('/bot/clients/:id', requireBotSecret, (req, res) => {
  const { username, name, addDays } = req.body || {};
  const clients = loadClients();
  const target = clients.find((c) => c.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });
  if (target.owner !== username) return res.status(403).json({ error: 'forbidden' });
  if (name) target.name = String(name).trim().slice(0, 60) || target.name;
  if (addDays) {
    const base = target.expiresAt && new Date(target.expiresAt).getTime() > Date.now()
      ? new Date(target.expiresAt).getTime()
      : Date.now();
    target.expiresAt = new Date(base + Number(addDays) * 24 * 60 * 60 * 1000).toISOString();
  }
  saveClients(clients);
  applyConfig();
  res.json({ ...target, expired: isExpired(target), link: buildLinkFor(target) });
});

// profile summary for the "حساب من" button
app.get('/bot/profile', requireBotSecret, (req, res) => {
  const username = req.query.username;
  const users = loadUsers();
  const user = users.find((u) => u.username === username);
  if (!user) return res.status(404).json({ error: 'not found' });
  const mine = loadClients().filter((c) => c.owner === username);
  const traffic = getTrafficStats();
  const totalTraffic = mine.reduce((sum, c) => sum + (traffic[c.id] ? traffic[c.id].uplink + traffic[c.id].downlink : 0), 0);
  res.json({
    username: user.username,
    role: user.role,
    activeConfigs: mine.filter((c) => !isExpired(c)).length,
    totalConfigs: mine.length,
    totalTraffic,
    maxConfigs: MAX_CONFIGS_PER_USER,
  });
});

// configs expiring within N days system-wide, used by the bot's reminder job
app.get('/bot/admin/expiring', requireBotSecret, (req, res) => {
  const withinDays = parseInt(req.query.withinDays || '2', 10);
  const cutoff = Date.now() + withinDays * 24 * 60 * 60 * 1000;
  const clients = loadClients().filter((c) => c.expiresAt && !isExpired(c) && new Date(c.expiresAt).getTime() <= cutoff);
  res.json(clients.map((c) => ({ id: c.id, name: c.name, owner: c.owner, expiresAt: c.expiresAt })));
});

// ===== bot admin routes (require the acting user to actually be an admin) =====
function requireActingAdmin(req, res, next) {
  const actingUsername = req.body.actingUsername || req.query.actingUsername;
  const users = loadUsers();
  const user = users.find((u) => u.username === actingUsername);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}
app.get('/bot/admin/users', requireBotSecret, requireActingAdmin, (req, res) => {
  res.json(loadUsers().map((u) => ({ username: u.username, role: u.role, createdAt: u.createdAt })));
});
app.post('/bot/admin/users', requireBotSecret, requireActingAdmin, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است' });
  const users = loadUsers();
  if (users.find((u) => u.username === username)) return res.status(409).json({ error: 'این نام کاربری قبلاً وجود دارد' });
  users.push({ username, password: hashPassword(password), role: 'user', createdAt: new Date().toISOString() });
  saveUsers(users);
  res.json({ ok: true });
});
app.delete('/bot/admin/users/:username', requireBotSecret, requireActingAdmin, (req, res) => {
  const target = req.params.username;
  if (target === ADMIN_USER) return res.status(400).json({ error: 'نمی‌توان ادمین را حذف کرد' });
  let users = loadUsers();
  users = users.filter((u) => u.username !== target);
  saveUsers(users);
  let clients = loadClients();
  clients = clients.filter((c) => c.owner !== target);
  saveClients(clients);
  applyConfig();
  res.json({ ok: true });
});

// ===== static pages =====
// "/" = public landing page. "/panel" = the actual login + dashboard app.
app.use(express.static(path.join(__dirname, 'public'), { index: 'landing.html' }));
app.get('/panel', (req, res) => res.sendFile(path.join(__dirname, 'public', 'panel.html')));

app.listen(PANEL_PORT, () => {
  loadUsers();
  console.log('Davarnet panel listening on port', PANEL_PORT);
  applyConfig();
});
