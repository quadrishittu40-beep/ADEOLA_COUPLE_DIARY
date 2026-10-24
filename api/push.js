'use strict';
const L = require('./_lib');
const P = require('./_push');

const file = (who) => 'push/' + who + '.json';
async function load(who) { return (await L.store.readJson(file(who))) || { subs: [] }; }

module.exports = async function (req, res) {
  try {
    const s = L.session(req);
    if (!s) return L.json(res, 401, { error: 'Log in first.' });
    if (req.method === 'GET') {
      const cur = await load(s.who);
      return L.json(res, 200, { key: process.env.VAPID_PUBLIC_KEY || null, devices: cur.subs.length });
    }
    if (req.method !== 'POST') return L.json(res, 405, { error: 'Method not allowed.' });
    const b = await L.body(req);
    const cur = await load(s.who);

    if (b.action === 'subscribe') {
      const sub = b.sub || {};
      if (typeof sub.endpoint !== 'string' || sub.endpoint.indexOf('https://') !== 0 || sub.endpoint.length > 1000) return L.json(res, 400, { error: 'That device cannot receive reminders.' });
      cur.subs = cur.subs.filter((x) => x.endpoint !== sub.endpoint);
      cur.subs.push({ endpoint: sub.endpoint, added: Date.now() });
      cur.subs = cur.subs.slice(-5);
      await L.store.writeJson(file(s.who), cur);
      return L.json(res, 200, { ok: true, devices: cur.subs.length });
    }
    if (b.action === 'unsubscribe') {
      cur.subs = cur.subs.filter((x) => x.endpoint !== b.endpoint);
      await L.store.writeJson(file(s.who), cur);
      return L.json(res, 200, { ok: true, devices: cur.subs.length });
    }
    if (b.action === 'test') {
      if (!cur.subs.length) return L.json(res, 400, { error: 'No device is set up for reminders yet.' });
      const out = await Promise.all(cur.subs.map(P.sendPush));
      const keep = cur.subs.filter((_, i) => !out[i].gone);
      if (keep.length !== cur.subs.length) { cur.subs = keep; await L.store.writeJson(file(s.who), cur); }
      const sent = out.filter((o) => o.ok).length;
      if (!sent) return L.json(res, 502, { error: 'The reminder could not be delivered. Turn reminders off and on again.' });
      return L.json(res, 200, { ok: true, sent: sent });
    }
    return L.json(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    console.error(e);
    return L.json(res, 500, { error: 'Something went wrong on the server.' });
  }
};
