// Web Push notifications. VAPID keys are generated once and kept in the database.
const webpush = require('web-push');
const { db, meta } = require('./db');
const config = require('./config');

let keys = meta.get('vapid') && JSON.parse(meta.get('vapid'));
if (!keys) {
  keys = webpush.generateVAPIDKeys();
  meta.set('vapid', JSON.stringify(keys));
}
webpush.setVapidDetails(config.vapidSubject, keys.publicKey, keys.privateKey);

function subscribe(sub, { staff, lang, manager }) {
  db.prepare(`INSERT INTO push_subs (endpoint, sub, staff, lang, manager) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET sub = excluded.sub, staff = excluded.staff, lang = excluded.lang,
      manager = MAX(manager, excluded.manager)`)
    .run(sub.endpoint, JSON.stringify(sub), staff || null, lang || 'en', manager ? 1 : 0);
}

function unsubscribe(endpoint) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}

// build(lang) returns { title, body, tag }, so each phone gets the message in its own language.
async function notify(build, { managersOnly = false } = {}) {
  const subs = db.prepare(managersOnly ? 'SELECT * FROM push_subs WHERE manager = 1' : 'SELECT * FROM push_subs').all();
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification(JSON.parse(s.sub), JSON.stringify(build(s.lang || 'en')));
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) unsubscribe(s.endpoint);
      else console.warn('Push failed:', e.statusCode || e.message);
    }
  }));
  return subs.length;
}

module.exports = { publicKey: keys.publicKey, subscribe, unsubscribe, notify };
