'use strict';
// Storage layer.
// 1) SUPABASE_URL + SUPABASE_SERVICE_KEY set -> a private Supabase Storage bucket (free, no operation limits).
// 2) otherwise -> private Vercel Blob store (BLOB_READ_WRITE_TOKEN).
// 3) STORE_DIR set -> plain files, for local testing.
const fs = require('fs');
const path = require('path');

const DIR = process.env.STORE_DIR || '';
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SB_BUCKET = process.env.SUPABASE_BUCKET || 'diary';
const SB = !DIR && !!SB_URL && !!SB_KEY;

// ---------- Supabase Storage (plain REST, no packages) ----------
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
// Legacy keys (start with "eyJ") are JWTs and go in both headers; new "sb_secret_" keys go in apikey only.
function sbHeaders(extra) { const h = { apikey: SB_KEY }; if (SB_KEY.indexOf('eyJ') === 0) h.Authorization = 'Bearer ' + SB_KEY; return Object.assign(h, extra || {}); }
let sbReady = null;
function sbEnsure() {
  if (!sbReady) {
    sbReady = fetch(SB_URL + '/storage/v1/bucket', {
      method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: SB_BUCKET, name: SB_BUCKET, public: false })
    }).then(() => true, () => true); // already exists, or the bucket was made by hand: both are fine
  }
  return sbReady;
}
async function sbGet(pathname) {
  await sbEnsure();
  const r = await fetch(SB_URL + '/storage/v1/object/' + SB_BUCKET + '/' + encPath(pathname), { headers: sbHeaders() });
  if (r.status === 400 || r.status === 404) return null;
  if (!r.ok) throw new Error('Storage read failed (' + r.status + ')');
  return Buffer.from(await r.arrayBuffer());
}
async function sbPut(pathname, buf, contentType) {
  await sbEnsure();
  const r = await fetch(SB_URL + '/storage/v1/object/' + SB_BUCKET + '/' + encPath(pathname), {
    method: 'POST', headers: sbHeaders({ 'x-upsert': 'true', 'Content-Type': contentType || 'application/octet-stream', 'Cache-Control': 'no-cache' }), body: buf
  });
  if (!r.ok) throw new Error('Storage write failed (' + r.status + '): ' + (await r.text()).slice(0, 200));
}
async function sbListDir(dir, search) {
  await sbEnsure();
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(SB_URL + '/storage/v1/object/list/' + SB_BUCKET, {
      method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix: dir, limit: 100, offset: offset, search: search || '' })
    });
    if (!r.ok) throw new Error('Storage list failed (' + r.status + ')');
    const items = await r.json();
    out.push.apply(out, items);
    if (items.length < 100) break;
  }
  return out;
}
async function sbListPaths(prefix) {
  const i = prefix.lastIndexOf('/');
  const dir = i >= 0 ? prefix.slice(0, i) : '';
  const rest = i >= 0 ? prefix.slice(i + 1) : prefix;
  const out = [];
  const items = await sbListDir(dir, rest);
  for (const it of items) {
    if (!it.name.startsWith(rest)) continue;
    const full = (dir ? dir + '/' : '') + it.name;
    if (it.id === null || it.id === undefined) {
      const sub = await sbListPaths(full + '/');
      sub.forEach((x) => out.push(x));
    } else out.push(full);
  }
  return out;
}
async function sbRemove(paths) {
  for (let k = 0; k < paths.length; k += 100) {
    const r = await fetch(SB_URL + '/storage/v1/object/' + SB_BUCKET, {
      method: 'DELETE', headers: sbHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: paths.slice(k, k + 100) })
    });
    if (!r.ok) throw new Error('Storage delete failed (' + r.status + ')');
  }
}

async function blobLib() { return require('@vercel/blob'); }

async function readJson(pathname) {
  if (DIR) {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, pathname), 'utf8')); } catch (e) { return null; }
  }
  if (SB) { const buf = await sbGet(pathname); if (!buf) return null; try { return JSON.parse(buf.toString('utf8')); } catch (e) { return null; } }
  const b = await blobLib();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    if (typeof b.get === 'function') {
      const r = await b.get(pathname, { access: 'private', token });
      if (!r || !r.stream) return null;
      const text = await new Response(r.stream).text();
      return JSON.parse(text);
    }
    const meta = await b.head(pathname, { token });
    const res = await fetch(meta.downloadUrl || meta.url, { headers: { authorization: 'Bearer ' + token } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function writeJson(pathname, data) {
  const body = JSON.stringify(data);
  if (DIR) {
    const f = path.join(DIR, pathname);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
    return;
  }
  if (SB) return sbPut(pathname, Buffer.from(body), 'application/json');
  const b = await blobLib();
  await b.put(pathname, body, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN
  });
}

async function listPaths(prefix) {
  if (DIR) {
    const base = path.join(DIR, prefix);
    const dir = prefix.endsWith('/') ? base : path.dirname(base);
    const out = [];
    (function walk(d) {
      if (!fs.existsSync(d)) return;
      fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
          const rel = path.relative(DIR, p).split(path.sep).join('/');
          if (rel.startsWith(prefix)) out.push(rel);
        }
      });
    })(dir);
    return out;
  }
  if (SB) return sbListPaths(prefix);
  const b = await blobLib();
  const out = [];
  let cursor;
  do {
    const r = await b.list({ prefix, cursor, token: process.env.BLOB_READ_WRITE_TOKEN });
    r.blobs.forEach(function (x) { out.push(x.pathname); });
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

async function readBuffer(pathname) {
  if (DIR) {
    try { return fs.readFileSync(path.join(DIR, pathname)); } catch (e) { return null; }
  }
  if (SB) return sbGet(pathname);
  const b = await blobLib();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    if (typeof b.get === 'function') {
      const r = await b.get(pathname, { access: 'private', token });
      if (!r || !r.stream) return null;
      return Buffer.from(await new Response(r.stream).arrayBuffer());
    }
    const meta = await b.head(pathname, { token });
    const res = await fetch(meta.downloadUrl || meta.url, { headers: { authorization: 'Bearer ' + token } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (e) { return null; }
}

async function writeBuffer(pathname, buf, contentType) {
  if (DIR) {
    const f = path.join(DIR, pathname);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, buf);
    return;
  }
  if (SB) return sbPut(pathname, buf, contentType);
  const b = await blobLib();
  await b.put(pathname, buf, {
    access: 'private', addRandomSuffix: false, allowOverwrite: true,
    contentType: contentType || 'application/octet-stream', token: process.env.BLOB_READ_WRITE_TOKEN
  });
}

async function removePrefix(prefix) {
  if (DIR) {
    const dir = path.join(DIR, prefix);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    return;
  }
  if (SB) { const ps = await sbListPaths(prefix); if (ps.length) await sbRemove(ps); return; }
  const b = await blobLib();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  let cursor;
  do {
    const r = await b.list({ prefix, cursor, token });
    if (r.blobs.length) await b.del(r.blobs.map((x) => x.url), { token });
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
}

module.exports = { readJson, writeJson, listPaths, readBuffer, writeBuffer, removePrefix };
