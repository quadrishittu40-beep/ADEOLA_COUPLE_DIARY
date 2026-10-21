'use strict';
const crypto = require('crypto');
const store = require('./_store');

const TZ = 'Africa/Lagos';
const NAMES = { quadri: 'Shittu Quadri Adeshina', olamide: 'Ibrahim Raimo Olamide' };
const SESSION_DAYS = 180;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET is not set');
  return s;
}
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function makeToken(user) {
  const payload = b64(JSON.stringify({ u: user.id, w: user.who, e: Date.now() + SESSION_DAYS * 864e5 }));
  return payload + '.' + sign(payload);
}
function readToken(tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  const parts = tok.split('.');
  const good = sign(parts[0]);
  const a = Buffer.from(parts[1] || ''), c = Buffer.from(good);
  if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!p.e || p.e < Date.now()) return null;
    return { id: p.u, who: p.w };
  } catch (e) { return null; }
}
function cookies(req) {
  const o = {};
  String(req.headers.cookie || '').split(';').forEach(function (kv) {
    const i = kv.indexOf('=');
    if (i > 0) o[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim());
  });
  return o;
}
function setSession(res, token) {
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  res.setHeader('Set-Cookie', 'sid=' + (token ? encodeURIComponent(token) : '') + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge);
}
function session(req) { return readToken(cookies(req).sid); }

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return await new Promise(function (ok) {
    let d = '';
    req.on('data', function (c) { d += c; if (d.length > 400000) req.destroy(); });
    req.on('end', function () { try { ok(JSON.parse(d || '{}')); } catch (e) { ok({}); } });
    req.on('error', function () { ok({}); });
  });
}

// ---- dates in the couple's own time zone ----
function todayStr(now) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now || new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return p.year + '-' + p.month + '-' + p.day;
}
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2024 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > dim(y, mo)) return null;
  return { y: y, m: mo, d: d };
}
// A week file covers days 1-7, 8-14, 15-21, 22-28 and the rest of the month. It seals after its last day.
function weekEnd(y, m, d) { return Math.min(Math.ceil(d / 7) * 7, dim(y, m)); }
function isSealed(dateStr, today) {
  const p = parseDate(dateStr);
  const end = p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(weekEnd(p.y, p.m, p.d)).padStart(2, '0');
  return today > end;
}

// ---- users ----
const emailId = (email) => crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 40);
function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }

async function allUsers() {
  const paths = await store.listPaths('users/');
  const list = await Promise.all(paths.map((p) => store.readJson(p)));
  return list.filter(Boolean);
}

module.exports = { store, NAMES, json, body, session, setSession, makeToken, todayStr, parseDate, isSealed, dim, emailId, hashPw, allUsers };
