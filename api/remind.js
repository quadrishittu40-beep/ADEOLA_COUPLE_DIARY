'use strict';
// Called once a day by Vercel Cron. Reminds whoever has not written today's page.
const L = require('./_lib');
const P = require('./_push');
const WHO = ['quadri', 'olamide'];

module.exports = async function (req, res) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== 'Bearer ' + secret) return L.json(res, 401, { error: 'Not allowed.' });
    const today = L.todayStr();
    const p = L.parseDate(today);
    const report = {};
    for (const who of WHO) {
      const month = await L.store.readJson('entries/' + p.y + '/' + who + '/' + String(p.m).padStart(2, '0') + '.json');
      const e = month && month.days && month.days[today];
      if (e && ((e.text || '').trim() || (e.win || '').trim() || e.mood)) { report[who] = 'already wrote'; continue; }
      const cur = (await L.store.readJson('push/' + who + '.json')) || { subs: [] };
      if (!cur.subs.length) { report[who] = 'no device'; continue; }
      const out = await Promise.all(cur.subs.map(P.sendPush));
      const keep = cur.subs.filter((_, i) => !out[i].gone);
      if (keep.length !== cur.subs.length) { cur.subs = keep; await L.store.writeJson('push/' + who + '.json', cur); }
      report[who] = 'sent ' + out.filter((o) => o.ok).length + ' of ' + out.length;
    }
    return L.json(res, 200, { ok: true, today: today, report: report });
  } catch (e) {
    console.error(e);
    return L.json(res, 500, { error: 'Reminder run failed.' });
  }
};
