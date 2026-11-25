'use strict';
// Emoji reactions. Each person keeps their own reactions in their own file, so two people
// reacting at the same moment can never overwrite each other. A reaction can be left on any page
// (yours or your partner's), including pages of a sealed week: it is not part of the written page.
const L = require('./_lib');
const WHO = ['quadri', 'olamide'];
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200D|\uFE0F)+$/u;
const file = (year, who) => 'reactions/' + year + '/' + who + '.json';

module.exports = async function (req, res) {
  try {
    const s = L.session(req);
    if (!s) return L.json(res, 401, { error: 'Log in to open the diary.' });
    if (req.method !== 'POST') return L.json(res, 405, { error: 'Method not allowed.' });
    const b = await L.body(req);
    const p = L.parseDate(b.date);
    if (!p) return L.json(res, 400, { error: 'That date is not valid.' });
    if (b.date > L.todayStr()) return L.json(res, 400, { error: 'This page is not open yet.' });
    if (WHO.indexOf(b.target) < 0) return L.json(res, 400, { error: 'Pick whose page.' });
    const list = [];
    (Array.isArray(b.emojis) ? b.emojis : []).forEach(function (e) {
      const t = String(e || '');
      if (t.length > 0 && t.length <= 16 && EMOJI.test(t) && list.indexOf(t) < 0 && list.length < 8) list.push(t);
    });
    const f = file(p.y, s.who);
    const cur = (await L.store.readJson(f)) || { r: {} };
    const key = b.date + '|' + b.target;
    if (list.length) cur.r[key] = list; else delete cur.r[key];
    await L.store.writeJson(f, cur);
    return L.json(res, 200, { ok: true, emojis: list });
  } catch (e) {
    return L.json(res, 500, { error: 'Something went wrong. Try again.' });
  }
};
