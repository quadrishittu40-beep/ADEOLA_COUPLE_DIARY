'use strict';
// Photos and videos. Files are cut into 3 MB pieces by the app (Vercel limits one request to about 4.5 MB),
// stored as private pieces, and served back with Range support so videos can play and seek.
const crypto = require('crypto');
const L = require('./_lib');

const CH = 3 * 1024 * 1024;
const SERVE_MAX = 4 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;
const MAX_ITEMS = 8;
const MIMES = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image',
  'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video'
};
const idOk = (s) => /^[a-f0-9]{24}$/.test(String(s || ''));
const metaPath = (id) => 'media/' + id + '/meta.json';
const chunkPath = (id, n) => 'media/' + id + '/c' + n + '.bin';
const entryFile = (who, date) => { const p = L.parseDate(date); return 'entries/' + p.y + '/' + who + '/' + String(p.m).padStart(2, '0') + '.json'; };

async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  return await new Promise(function (ok, fail) {
    const parts = []; let n = 0;
    req.on('data', function (c) { n += c.length; if (n > CH + 1024) { fail(new Error('too big')); req.destroy(); return; } parts.push(c); });
    req.on('end', function () { ok(Buffer.concat(parts)); });
    req.on('error', fail);
  });
}

async function serve(req, res, meta) {
  const total = meta.size;
  let start = 0, end = Math.min(total - 1, SERVE_MAX - 1), status = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (m && (m[1] !== '' || m[2] !== '')) {
    if (m[1] === '') { start = Math.max(0, total - (+m[2])); end = Math.min(total - 1, start + SERVE_MAX - 1); }
    else { start = +m[1]; end = m[2] === '' ? start + SERVE_MAX - 1 : +m[2]; end = Math.min(end, total - 1, start + SERVE_MAX - 1); }
    if (start >= total || start > end) { res.statusCode = 416; res.setHeader('Content-Range', 'bytes */' + total); return res.end(); }
    status = 206;
  } else if (total > SERVE_MAX) {
    status = 206; // too large for one response: send the first piece, the player asks for the rest
  }
  const first = Math.floor(start / CH), last = Math.floor(end / CH);
  const bufs = [];
  for (let n = first; n <= last; n++) {
    const b = await L.store.readBuffer(chunkPath(meta.id, n));
    if (!b) { res.statusCode = 404; return res.end('missing'); }
    bufs.push(b);
  }
  const all = Buffer.concat(bufs), offset = start - first * CH;
  const out = all.subarray(offset, offset + (end - start + 1));
  res.statusCode = status;
  res.setHeader('Content-Type', meta.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Length', String(out.length));
  if (status === 206) res.setHeader('Content-Range', 'bytes ' + start + '-' + (start + out.length - 1) + '/' + total);
  res.end(out);
}

module.exports = async function (req, res) {
  try {
    const s = L.session(req);
    if (!s) return L.json(res, 401, { error: 'Log in first.' });
    const q = req.query || {};
    const today = L.todayStr();

    if (req.method === 'GET') {
      if (!idOk(q.id)) return L.json(res, 400, { error: 'Bad link.' });
      const meta = await L.store.readJson(metaPath(q.id));
      if (!meta || !meta.done) return L.json(res, 404, { error: 'Not found.' });
      return await serve(req, res, meta);
    }

    if (req.method === 'POST' && q.action === 'init') {
      const b = await L.body(req);
      const type = MIMES[b.mime];
      if (!type) return L.json(res, 400, { error: 'That file type is not supported. Use JPG, PNG, WebP, GIF, MP4, MOV or WebM.' });
      const size = +b.size;
      if (!(size > 0)) return L.json(res, 400, { error: 'That file is empty.' });
      if (size > (type === 'image' ? MAX_IMAGE : MAX_VIDEO)) return L.json(res, 400, { error: type === 'image' ? 'Photos can be up to 10 MB.' : 'Videos can be up to 50 MB. Trim or compress it first.' });
      if (!L.parseDate(b.date)) return L.json(res, 400, { error: 'That date is not valid.' });
      if (b.date > today) return L.json(res, 400, { error: 'This page is not open yet.' });
      if (L.isSealed(b.date, today)) return L.json(res, 403, { error: 'This week is sealed. Nothing can be added to it.' });
      const cur = (await L.store.readJson(entryFile(s.who, b.date))) || { days: {} };
      const day = cur.days[b.date];
      if (day && day.media && day.media.length >= MAX_ITEMS) return L.json(res, 400, { error: 'A page can hold up to ' + MAX_ITEMS + ' photos and videos.' });
      const id = crypto.randomBytes(12).toString('hex');
      const chunks = Math.ceil(size / CH);
      await L.store.writeJson(metaPath(id), { id: id, who: s.who, date: b.date, mime: b.mime, type: type, size: size, name: String(b.name || '').slice(0, 120), chunks: chunks, done: false, created: Date.now() });
      return L.json(res, 200, { id: id, chunk: CH, chunks: chunks });
    }

    if (req.method === 'PUT') {
      if (!idOk(q.id)) return L.json(res, 400, { error: 'Bad upload.' });
      const meta = await L.store.readJson(metaPath(q.id));
      if (!meta || meta.who !== s.who || meta.done) return L.json(res, 404, { error: 'Upload not found.' });
      const n = +q.n;
      if (!Number.isInteger(n) || n < 0 || n >= meta.chunks) return L.json(res, 400, { error: 'Bad piece number.' });
      const buf = await rawBody(req);
      const expect = n < meta.chunks - 1 ? CH : meta.size - (meta.chunks - 1) * CH;
      if (buf.length !== expect) return L.json(res, 400, { error: 'That piece has the wrong size.' });
      await L.store.writeBuffer(chunkPath(meta.id, n), buf);
      return L.json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && q.action === 'done') {
      if (!idOk(q.id)) return L.json(res, 400, { error: 'Bad upload.' });
      const meta = await L.store.readJson(metaPath(q.id));
      if (!meta || meta.who !== s.who) return L.json(res, 404, { error: 'Upload not found.' });
      if (L.isSealed(meta.date, today)) return L.json(res, 403, { error: 'This week is sealed.' });
      if (!meta.done) {
        const have = await L.store.listPaths('media/' + meta.id + '/c');
        if (have.length !== meta.chunks) return L.json(res, 400, { error: 'The upload is incomplete. Try again.' });
        const file = entryFile(s.who, meta.date);
        const cur = (await L.store.readJson(file)) || { days: {} };
        const day = cur.days[meta.date] || { mood: '', text: '', win: '', updated: Date.now() };
        day.media = (day.media || []).filter((m) => m.id !== meta.id);
        if (day.media.length >= MAX_ITEMS) return L.json(res, 400, { error: 'A page can hold up to ' + MAX_ITEMS + ' photos and videos.' });
        day.media.push({ id: meta.id, type: meta.type, name: meta.name, size: meta.size });
        day.updated = Date.now();
        cur.days[meta.date] = day;
        await L.store.writeJson(file, cur);
        meta.done = true;
        await L.store.writeJson(metaPath(meta.id), meta);
      }
      const cur2 = (await L.store.readJson(entryFile(s.who, meta.date))) || { days: {} };
      return L.json(res, 200, { ok: true, entry: Object.assign({ date: meta.date, who: s.who }, cur2.days[meta.date]) });
    }

    if (req.method === 'DELETE') {
      if (!idOk(q.id)) return L.json(res, 400, { error: 'Bad link.' });
      const meta = await L.store.readJson(metaPath(q.id));
      if (!meta || meta.who !== s.who) return L.json(res, 404, { error: 'Not found.' });
      if (L.isSealed(meta.date, today)) return L.json(res, 403, { error: 'This week is sealed. Its pages can no longer change.' });
      const file = entryFile(s.who, meta.date);
      const cur = (await L.store.readJson(file)) || { days: {} };
      const day = cur.days[meta.date];
      let entry = null;
      if (day) {
        day.media = (day.media || []).filter((m) => m.id !== meta.id);
        if (!day.media.length) delete day.media;
        if (!day.mood && !(day.text || '').trim() && !(day.win || '').trim() && !day.media) delete cur.days[meta.date];
        else { day.updated = Date.now(); entry = Object.assign({ date: meta.date, who: s.who }, day); }
        await L.store.writeJson(file, cur);
      }
      await L.store.removePrefix('media/' + meta.id + '/');
      return L.json(res, 200, { ok: true, entry: entry });
    }

    return L.json(res, 405, { error: 'Method not allowed.' });
  } catch (e) {
    console.error(e);
    return L.json(res, 500, { error: 'Something went wrong on the server.' });
  }
};
