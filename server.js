const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DATA_DIR = process.env.DATA_DIR || '/data';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const XRAY_CONFIG = '/tmp/config.json';
const XRAY_BIN = '/usr/local/bin/xray-core/xray';

const PANEL_PORT = process.env.PANEL_PORT || 3000;
const INBOUND_PORT = process.env.INBOUND_PORT || 8443;
const WS_PATH = process.env.WS_PATH || '/davarnet-ws';
const PUBLIC_DOMAIN = process.env.INBOUND_DOMAIN || '';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- password hashing (no external deps) ----------
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
function loadClients() {
  if (!fs.existsSync(CLIENTS_FILE)) fs.writeFileSync(CLIENTS_FILE, '[]');
  return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8'));
}
function saveClients(clients) {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
}

// ---------- xray process management ----------
let xrayProcess = null;
function writeXrayConfig(clients) {
  const config = {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        listen: '0.0.0.0',
        port: parseInt(INBOUND_PORT, 10),
        protocol: 'vless',
        settings: {
          clients: clients.map((c) => ({ id: c.uuid, level: 0, email: c.name })),
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
}
function applyConfig() {
  const clients = loadClients();
  writeXrayConfig(clients);
  restartXray();
}

// ---------- sessions (in-memory) ----------
const sessions = new Map(); // token -> { username, role, expires }
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

// ---------- app ----------
const app = express();
app.use(express.json());

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
  res.json({ username: req.session.username, role: req.session.role });
});

app.get('/api/meta', requireAuth, (req, res) => {
  res.json({ domain: PUBLIC_DOMAIN, wsPath: WS_PATH });
});

// ---- admin: user management ----
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const users = loadUsers().map((u) => ({ username: u.username, role: u.role, createdAt: u.createdAt }));
  res.json(users);
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است' });
  const users = loadUsers();
  if (users.find((u) => u.username === username)) {
    return res.status(409).json({ error: 'این نام کاربری قبلاً وجود دارد' });
  }
  users.push({
    username,
    password: hashPassword(password),
    role: 'user',
    createdAt: new Date().toISOString(),
  });
  saveUsers(users);
  res.json({ ok: true });
});

app.delete('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
  const target = req.params.username;
  if (target === ADMIN_USER) return res.status(400).json({ error: 'نمی‌توان ادمین را حذف کرد' });
  let users = loadUsers();
  users = users.filter((u) => u.username !== target);
  saveUsers(users);
  // cascade: remove their clients too
  let clients = loadClients();
  clients = clients.filter((c) => c.owner !== target);
  saveClients(clients);
  applyConfig();
  res.json({ ok: true });
});

// ---- clients (each user manages their own; admin sees all) ----
app.get('/api/clients', requireAuth, (req, res) => {
  const clients = loadClients();
  if (req.session.role === 'admin') return res.json(clients);
  res.json(clients.filter((c) => c.owner === req.session.username));
});

app.post('/api/clients', requireAuth, (req, res) => {
  const { name, note } = req.body || {};
  const cleanName = (name || 'کانفیگ').trim() || 'کانفیگ';
  const clients = loadClients();
  const client = {
    id: crypto.randomUUID(),
    uuid: crypto.randomUUID(),
    name: cleanName,
    note: (note || '').trim(),
    owner: req.session.username,
    createdAt: new Date().toISOString(),
  };
  clients.push(client);
  saveClients(clients);
  applyConfig();
  res.json(client);
});

app.delete('/api/clients/:id', requireAuth, (req, res) => {
  let clients = loadClients();
  const target = clients.find((c) => c.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });
  if (req.session.role !== 'admin' && target.owner !== req.session.username) {
    return res.status(403).json({ error: 'forbidden' });
  }
  clients = clients.filter((c) => c.id !== req.params.id);
  saveClients(clients);
  applyConfig();
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PANEL_PORT, '0.0.0.0', () => {
  loadUsers(); // ensure admin exists
  console.log('Davarnet panel listening on port', PANEL_PORT);
  applyConfig();
});
