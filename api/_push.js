'use strict';
// Web Push without dependencies. Sends an empty "wake-up" push signed with VAPID;
// the service worker (public/sw.js) shows the reminder text itself.
const crypto = require('crypto');

const b64u = (b) => Buffer.from(b).toString('base64url');

function vapidKeys() {
  const pub = process.env.VAPID_PUBLIC_KEY, d = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !d) return null;
  const raw = Buffer.from(pub, 'base64url');
  if (raw.length !== 65 || raw[0] !== 4) return null;
  const privateKey = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: d, x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) },
    format: 'jwk'
  });
  return { pub: pub, privateKey: privateKey };
}

function makeJwt(audience, keys, subject, nowMs) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: audience, exp: Math.floor((nowMs || Date.now()) / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return head + '.' + body + '.' + b64u(sig);
}

// Returns { ok, gone, status }. gone = the subscription no longer exists and should be removed.
async function sendPush(sub) {
  const keys = vapidKeys();
  if (!keys) return { ok: false, gone: false, status: 0, error: 'VAPID keys are not set' };
  let url;
  try { url = new URL(sub.endpoint); } catch (e) { return { ok: false, gone: true, status: 0 }; }
  if (url.protocol !== 'https:') return { ok: false, gone: true, status: 0 };
  const jwt = makeJwt(url.origin, keys, process.env.VAPID_SUBJECT || 'mailto:diary@example.com');
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { Authorization: 'vapid t=' + jwt + ', k=' + keys.pub, TTL: '43200', Urgency: 'normal', 'Content-Length': '0' }
    });
    return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch (e) {
    return { ok: false, gone: false, status: 0 };
  }
}

module.exports = { sendPush, makeJwt, vapidKeys };
