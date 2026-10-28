'use strict';
const L = require('./_lib');
const WHO = ['quadri', 'olamide'];
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const MOODS = ['Radiant', 'Content', 'Calm', 'Tired', 'Heavy', ''];

module.exports = async function (req, res) {
  try {
    const s = L.session(req);
    if (!s) return L.json(res, 401, { error: 'Log in to open the diary.' });
    const today = L.todayStr();

    if (req.method === 'GET') {
      const year = +(req.query && req.query.year);
      if (!(year >= 2024 && year <= 2100)) return L.json(res, 400, { error: 'Give a year.' });
      const out = {};
      await Promise.all(WHO.map(async function (who) {
        const paths = await L.store.listPaths('entries/' + year + '/' + who + '/');
        const files = await Promise.all(paths.map((p) => L.store.readJson(p)));
        files.forEach(function (f) {
          if (!f || !f.days) return;
          Object.keys(f.days).forEach(function (date) { out[date + '_' + who] = Object.assign({ date: date, who: who }, f.days[date]); });
        });
      }));
      return L.json(res, 200, { entries: out, today: today, who: s.who });
    }

    if (req.method === 'PUT') {
      const b = await L.body(req);
      const p = L.parseDate(b.date);
      if (!p) return L.json(res, 400, { error: 'That date is not valid.' });
      if (b.date > today) return L.json(res, 400, { error: 'This page is not open yet.' });
      if (L.isSealed(b.date, today)) return L.json(res, 403, { error: 'This week is sealed. Its pages can no longer change.' });
      const mood = MOODS.indexOf(b.mood || '') >= 0 ? (b.mood || '') : '';
      const rec = { mood: mood, text: clip(b.text, 20000), win: clip(b.win, 200), updated: Date.now() };
      const file = 'entries/' + p.y + '/' + s.who + '/' + String(p.m).padStart(2, '0') + '.json';
      const cur = (await L.store.readJson(file)) || { days: {} };
      const prev = cur.days[b.date];
      if (prev && Array.isArray(prev.media) && prev.media.length) rec.media = prev.media;
      const empty = !rec.mood && !rec.text.trim() && !rec.win.trim() && !rec.media;
      if (empty) delete cur.days[b.date]; else cur.days[b.date] = rec;
      await L.store.writeJson(file, cur);
      return L.json(res, 200, { ok: true, entry: empty ? null : Object.assign({ date: b.date, who: s.who }, rec) });
    }

    return L.json(res, 405, { error: 'Method not allowed.' });
  } catch (e) {
    console.error(e);
    return L.json(res, 500, { error: 'Something went wrong on the server.' });
  }
};
