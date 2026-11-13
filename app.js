const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, 'public');
const port = Number(process.env.PORT) || 3000;
const sessions = new Map();
const attempts = new Map();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 4096) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function cookieValue(req, key) {
  const cookies = (req.headers.cookie || '').split(';');
  const pair = cookies.map(part => part.trim()).find(part => part.startsWith(`${key}=`));
  return pair ? pair.slice(key.length + 1) : '';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/api/admin-login') {
    const secret = process.env.ADMIN_PASSWORD;
    if (!secret) return sendJson(res, 503, { error: 'Admin password is not configured' });
    let body;
    try { body = await readJson(req); } catch { return sendJson(res, 400, { error: 'Invalid request' }); }
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (attempts.get(ip) || []).filter(time => now - time < 10 * 60 * 1000);
    if (recent.length >= 5) return sendJson(res, 429, { error: 'Too many attempts' });
    const supplied = Buffer.from(String(body.password || ''), 'utf8');
    const expected = Buffer.from(secret, 'utf8');
    const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (!valid) {
      recent.push(now);
      attempts.set(ip, recent);
      return sendJson(res, 401, { error: 'Invalid password' });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, now + 12 * 60 * 60 * 1000);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `egor_admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`,
      'Cache-Control': 'no-store'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin-logout') {
    const token = cookieValue(req, 'egor_admin_session');
    sessions.delete(token);
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': 'egor_admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
      'Cache-Control': 'no-store'
    });
  }

  let relative;
  try { relative = decodeURIComponent(url.pathname).slice(1) || 'index.html'; }
  catch { return res.writeHead(400).end('Bad request'); }
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end('Forbidden');

  fs.readFile(file, (error, body) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      ...(path.basename(file) === 'index.html' ? { 'Cache-Control': 'no-cache' } : {})
    });
    res.end(body);
  });
});

server.listen(port, '0.0.0.0', () => console.log(`Egor Mini App listening on ${port}`));
