// Drakzx web server — ZERO external dependencies (pure Node.js built-ins).
// Run with: node server.js   (no "npm install" needed at all)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const OWNER_USERNAME = 'Drakzx';
const OWNER_PASSWORD = 'Owner1!!';
// Fixed shared secret — the client checks username/password locally (no
// network round-trip needed just to log in) and then uses this same secret
// as the "owner token" for every authenticated request. Change this to your
// own random string if you want extra safety.
const OWNER_SECRET = 'drakzx-owner-secret-2026';

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      projects: [
        { id: 'proj_seed_1', title: 'PikaBot', desc: 'WhatsApp bot bertema Pikachu dengan berbagai fitur menu interaktif.', codeName: 'menu-handler.js', code: '', likes: 0, comments: [] },
        { id: 'proj_seed_2', title: 'Bio Page', desc: 'Halaman profil personal ini — dibuat dengan HTML, CSS, dan JS murni.', codeName: 'card-structure.html', code: '', likes: 0, comments: [] }
      ],
      polls: []
    };
  }
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return { projects: [], polls: [] }; }
}
function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
let db = loadData();

let activeTokens = new Set();
function getToken(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
function isOwnerReq(req) {
  const t = getToken(req);
  return t === OWNER_SECRET;
}
function newId(prefix) { return prefix + '_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'); }

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() / 2)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  files.forEach(function(f) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const size = f.data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, f.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + f.data.length;
  });

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat(localParts.concat([centralBuf, end]));
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
  if (!boundary) return [];
  const boundaryBuf = Buffer.from('--' + boundary);
  const parts = [];
  let start = buffer.indexOf(boundaryBuf);
  while (start !== -1) {
    const next = buffer.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;
    const chunk = buffer.slice(start + boundaryBuf.length, next);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerStr = chunk.slice(0, headerEnd).toString('utf8');
      let data = chunk.slice(headerEnd + 4);
      if (data.slice(-2).toString() === '\r\n') data = data.slice(0, -2);
      const nameMatch = /name="([^"]+)"/.exec(headerStr);
      const filenameMatch = /filename="([^"]*)"/.exec(headerStr);
      parts.push({ name: nameMatch ? nameMatch[1] : '', filename: filenameMatch ? filenameMatch[1] : null, data: data });
    }
    start = next;
  }
  return parts;
}

function collectBody(req) {
  return new Promise(function(resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function(chunk) {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) { req.destroy(); reject(new Error('payload too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', function() { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await collectBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { return {}; }
}

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.zip': 'application/zip'
};
function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, function(err, data) {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), function(err2, data2) {
        if (err2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
  });
  res.end(body);
}

async function handleApi(req, res, pathname, query) {
  const method = req.method;

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req);
    if (body.username === OWNER_USERNAME && body.password === OWNER_PASSWORD) {
      return sendJson(res, 200, { token: OWNER_SECRET, username: OWNER_USERNAME });
    }
    return sendJson(res, 401, { error: 'Invalid credentials' });
  }
  if (pathname === '/api/auth/verify' && method === 'GET') {
    return sendJson(res, isOwnerReq(req) ? 200 : 401, { ok: isOwnerReq(req) });
  }

  if (pathname === '/api/projects' && method === 'GET') {
    return sendJson(res, 200, db.projects);
  }
  if (pathname === '/api/projects' && method === 'POST') {
    if (!isOwnerReq(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readJson(req);
    if (!body.title || !String(body.title).trim()) return sendJson(res, 400, { error: 'title required' });
    const proj = { id: newId('proj'), title: String(body.title).trim(), desc: (body.desc && String(body.desc).trim()) || 'Tidak ada deskripsi.', likes: 0, comments: [] };
    if (body.code && String(body.code).trim()) {
      proj.codeName = (body.codeName && String(body.codeName).trim()) || 'snippet';
      proj.code = body.code;
    }
    db.projects.push(proj);
    saveData(db);
    return sendJson(res, 201, proj);
  }

  let m = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (m && method === 'DELETE') {
    if (!isOwnerReq(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const idx = db.projects.findIndex(function(p) { return p.id === m[1]; });
    if (idx === -1) return sendJson(res, 404, { error: 'not found' });
    db.projects.splice(idx, 1);
    saveData(db);
    const zipPath = path.join(UPLOADS_DIR, m[1] + '.zip');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    return sendJson(res, 200, { ok: true });
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)\/like$/);
  if (m && method === 'POST') {
    const proj = db.projects.find(function(p) { return p.id === m[1]; });
    if (!proj) return sendJson(res, 404, { error: 'not found' });
    proj.likes = (proj.likes || 0) + 1;
    saveData(db);
    return sendJson(res, 200, { likes: proj.likes });
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)\/comments$/);
  if (m && method === 'POST') {
    const proj = db.projects.find(function(p) { return p.id === m[1]; });
    if (!proj) return sendJson(res, 404, { error: 'not found' });
    const body = await readJson(req);
    if (!body.text || !String(body.text).trim()) return sendJson(res, 400, { error: 'text required' });
    const comment = { id: newId('cmt'), name: (body.name && String(body.name).trim()) || 'Anonim', text: String(body.text).trim() };
    proj.comments = proj.comments || [];
    proj.comments.push(comment);
    saveData(db);
    return sendJson(res, 201, comment);
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)\/comments\/([^/]+)$/);
  if (m && method === 'DELETE') {
    if (!isOwnerReq(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const proj = db.projects.find(function(p) { return p.id === m[1]; });
    if (!proj) return sendJson(res, 404, { error: 'not found' });
    proj.comments = (proj.comments || []).filter(function(c) { return c.id !== m[2]; });
    saveData(db);
    return sendJson(res, 200, { ok: true });
  }

  m = pathname.match(/^\/api\/projects\/([^/]+)\/files$/);
  if (m && method === 'POST') {
    if (!isOwnerReq(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const proj = db.projects.find(function(p) { return p.id === m[1]; });
    if (!proj) return sendJson(res, 404, { error: 'not found' });
    const contentType = req.headers['content-type'] || '';
    const buf = await collectBody(req);
    const parts = parseMultipart(buf, contentType).filter(function(p) { return p.filename; });
    if (!parts.length) return sendJson(res, 400, { error: 'no files uploaded' });
    const zipBuf = buildZip(parts.map(function(p) { return { name: p.filename, data: p.data }; }));
    fs.writeFileSync(path.join(UPLOADS_DIR, proj.id + '.zip'), zipBuf);
    proj.hasFiles = true;
    saveData(db);
    return sendJson(res, 200, { ok: true, url: '/api/projects/' + proj.id + '/files' });
  }
  if (m && method === 'GET') {
    const zipPath = path.join(UPLOADS_DIR, m[1] + '.zip');
    if (!fs.existsSync(zipPath)) return sendJson(res, 404, { error: 'no files for this project' });
    const data = fs.readFileSync(zipPath);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="' + m[1] + '-files.zip"' });
    return res.end(data);
  }

  if (pathname === '/api/polls' && method === 'GET') {
    return sendJson(res, 200, db.polls);
  }
  if (pathname === '/api/polls' && method === 'POST') {
    if (!isOwnerReq(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const body = await readJson(req);
    if (!body.question || !String(body.question).trim()) return sendJson(res, 400, { error: 'question required' });
    if (!Array.isArray(body.options) || body.options.length < 2) return sendJson(res, 400, { error: 'at least 2 options required' });
    const poll = { id: newId('poll'), question: String(body.question).trim(), options: body.options.map(function(o) { return { text: String(o).trim(), votes: 0 }; }) };
    db.polls.push(poll);
    saveData(db);
    return sendJson(res, 201, poll);
  }

  m = pathname.match(/^\/api\/polls\/([^/]+)$/);
  if (m && method === 'DELETE') {
    if (!isOwnerReq(req)) return sendJson(res, 401, { error: 'Unauthorized' });
    const idx = db.polls.findIndex(function(p) { return p.id === m[1]; });
    if (idx === -1) return sendJson(res, 404, { error: 'not found' });
    db.polls.splice(idx, 1);
    saveData(db);
    return sendJson(res, 200, { ok: true });
  }

  m = pathname.match(/^\/api\/polls\/([^/]+)\/vote$/);
  if (m && method === 'POST') {
    const poll = db.polls.find(function(p) { return p.id === m[1]; });
    if (!poll) return sendJson(res, 404, { error: 'not found' });
    const body = await readJson(req);
    if (typeof body.optionIndex !== 'number' || !poll.options[body.optionIndex]) {
      return sendJson(res, 400, { error: 'invalid optionIndex' });
    }
    poll.options[body.optionIndex].votes++;
    saveData(db);
    return sendJson(res, 200, poll);
  }

  return sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer(async function(req, res) {
  try {
    const parsed = url.parse(req.url, true);
    const pathname = decodeURIComponent(parsed.pathname);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
      });
      return res.end();
    }

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname, parsed.query);
    }
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, function() {
  console.log('Drakzx server running on http://localhost:' + PORT);
});
