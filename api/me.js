'use strict';
const L = require('./_lib');

module.exports = async function (req, res) {
  try {
    const s = L.session(req);
    const users = await L.allUsers();
    const taken = { quadri: users.some((u) => u.who === 'quadri'), olamide: users.some((u) => u.who === 'olamide') };
    const valid = s && users.some((u) => u.id === s.id) ? s : null;
    return L.json(res, 200, { who: valid ? valid.who : null, taken: taken, today: L.todayStr() });
  } catch (e) {
    console.error(e);
    return L.json(res, 500, { error: 'Something went wrong on the server.' });
  }
};
