'use strict';
const crypto = require('crypto');
const L = require('./_lib');

module.exports = async function (req, res) {
  try {
    if (req.method !== 'POST') return L.json(res, 405, { error: 'Use POST.' });
    const b = await L.body(req);
    const action = b.action;

    if (action === 'logout') { L.setSession(res, null); return L.json(res, 200, { ok: true }); }

    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return L.json(res, 400, { error: 'Enter a valid email address.' });
    if (password.length < 8) return L.json(res, 400, { error: 'Use a password of at least 8 characters.' });
    if (password.length > 200) return L.json(res, 400, { error: 'That password is too long.' });
    const id = L.emailId(email);

    if (action === 'register') {
      const who = b.who;
      if (who !== 'quadri' && who !== 'olamide') return L.json(res, 400, { error: 'Choose Quadri or Olamide.' });
      const users = await L.allUsers();
      if (users.some((u) => u.id === id)) return L.json(res, 409, { error: 'That email already has an account. Log in instead.' });
      if (users.some((u) => u.who === who)) return L.json(res, 409, { error: L.NAMES[who] + ' already has an account.' });
      if (users.length >= 2) return L.json(res, 403, { error: 'This diary already has its two accounts.' });
      const salt = crypto.randomBytes(16).toString('hex');
      const user = { id: id, email: email, who: who, salt: salt, hash: L.hashPw(password, salt), created: Date.now() };
      await L.store.writeJson('users/' + id + '.json', user);
      L.setSession(res, L.makeToken(user));
      return L.json(res, 200, { ok: true, who: who });
    }

    if (action === 'login') {
      const user = await L.store.readJson('users/' + id + '.json');
      const fake = '0'.repeat(128);
      const got = user ? L.hashPw(password, user.salt) : L.hashPw(password, 'x'.repeat(32)) && fake;
      const ok = user && got.length === user.hash.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(user.hash));
      if (!ok) { await new Promise((r) => setTimeout(r, 600)); return L.json(res, 401, { error: 'Email or password is not right.' }); }
      L.setSession(res, L.makeToken(user));
      return L.json(res, 200, { ok: true, who: user.who });
    }

    return L.json(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    console.error(e);
    return L.json(res, 500, { error: 'Something went wrong on the server.' });
  }
};
