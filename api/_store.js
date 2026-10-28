'use strict';
// Storage layer. Production: private Vercel Blob store (BLOB_READ_WRITE_TOKEN).
// Local testing: set STORE_DIR to use plain files instead.
const fs = require('fs');
const path = require('path');

const DIR = process.env.STORE_DIR || '';

async function blobLib() { return require('@vercel/blob'); }

async function readJson(pathname) {
  if (DIR) {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, pathname), 'utf8')); } catch (e) { return null; }
  }
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
