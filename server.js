const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./src/config');
const tasks = require('./src/tasks');
const push = require('./src/push');
const { meta } = require('./src/db');
const { t } = require('./public/i18n');

const photoDir = path.join(config.dataDir, 'photos');
fs.mkdirSync(photoDir, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(photoDir, { maxAge: '7d' }));

// ---- Live updates: every open phone gets a ping when anything changes ----
const clients = new Set();
function broadcast(event = {}) {
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(msg);
}
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

// ---- Notifications ----
async function notifyListReady() {
  const s = tasks.state();
  if (!s.totals.total) return;
  await push.notify(lang => ({
    title: t(lang, 'pushListTitle'),
    body: `🔴 ${s.totals.change} ${t(lang, 'change')} · 🟡 ${s.totals.set} ${t(lang, 'set')}`,
    tag: 'daily-list',
  }));
}

async function afterBedDone(room, staff) {
  const r = tasks.roomStatus(tasks.today(), room);
  if (r.total && r.done === r.total) {
    await push.notify(lang => ({
      title: t(lang, 'pushRoomDoneTitle', { room }),
      body: t(lang, 'pushRoomDoneBody', { name: staff }),
      tag: `room-${room}`,
    }), { managersOnly: true });
  }
  const d = tasks.dayStatus(tasks.today());
  if (d.total && d.done === d.total) {
    await push.notify(lang => ({ title: t(lang, 'pushAllDoneTitle'), body: t(lang, 'pushAllDoneBody'), tag: 'all-done' }));
  }
}

// First sync of the day sends the "list is ready" notification.
async function sync({ announce }) {
  const result = await tasks.syncToday();
  if (result.changed) broadcast({ type: 'sync' });
  if (announce && meta.get('announced') !== result.date) {
    meta.set('announced', result.date);
    await notifyListReady();
  }
  return result;
}

// ---- API ----
const asyncRoute = fn => (req, res) => fn(req, res).catch(e => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});

function requireManager(req, res, next) {
  if (req.get('x-manager-pin') === config.managerPin) return next();
  res.status(401).json({ error: 'Wrong PIN' });
}

function staffName(req) {
  const name = String(req.body.staff || '').trim().slice(0, 40);
  if (!name) throw Object.assign(new Error('Missing name'), { status: 400 });
  return name;
}

app.get('/api/state', (req, res) => res.json(tasks.state(req.query.date || undefined)));

app.post('/api/done', asyncRoute(async (req, res) => {
  const staff = staffName(req);
  const { room, bed } = req.body;
  const ok = tasks.markDone(room, bed, staff);
  if (ok) { broadcast({ type: 'done', room, bed, staff }); afterBedDone(room, staff).catch(console.error); }
  res.json({ ok });
}));

app.post('/api/undo', asyncRoute(async (req, res) => {
  const { room, bed } = req.body;
  const ok = tasks.undoDone(room, bed);
  if (ok) broadcast({ type: 'undo', room, bed });
  res.json({ ok });
}));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(photoDir, tasks.today());
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const room = String(req.body.room || 'room').replace(/[^\w-]/g, '');
      cb(null, `${room}-${Date.now()}.jpg`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

app.post('/api/photo', upload.single('photo'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo' });
  const staff = staffName(req);
  const room = String(req.body.room || '');
  tasks.addPhoto(room, staff, `${tasks.today()}/${req.file.filename}`);
  broadcast({ type: 'photo', room, staff });
  res.json({ ok: true });
}));

app.get('/api/push/key', (req, res) => res.json({ key: push.publicKey }));

app.post('/api/push/subscribe', (req, res) => {
  const { subscription, staff, lang, managerPin } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Bad subscription' });
  push.subscribe(subscription, { staff, lang, manager: managerPin === config.managerPin });
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  if (req.body.endpoint) push.unsubscribe(req.body.endpoint);
  res.json({ ok: true });
});

// Manager tools
app.post('/api/manager/check', requireManager, (req, res) => res.json({ ok: true }));
app.post('/api/manager/sync', requireManager, asyncRoute(async (req, res) => res.json(await sync({ announce: true }))));
app.post('/api/manager/test-push', requireManager, asyncRoute(async (req, res) => {
  const sent = await push.notify(() => ({ title: '🔔 Test', body: 'Notifications are working', tag: 'test' }));
  res.json({ sent });
}));

app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

// ---- Daily schedule ----
async function tick() {
  const now = tasks.nowHHMM();
  const date = tasks.today();
  try {
    if (now >= config.refreshTime) {
      const last = Number(meta.get('lastSync') || 0);
      const due = meta.get('announced') !== date || Date.now() - last > config.resyncMinutes * 60000;
      if (due) {
        meta.set('lastSync', Date.now());
        await sync({ announce: true });
      }
    }
    if (now >= config.reminderTime && meta.get('reminded') !== date && meta.get('announced') === date) {
      meta.set('reminded', date);
      const s = tasks.state();
      const left = s.totals.total - s.totals.done;
      if (left > 0) {
        await push.notify(lang => ({
          title: t(lang, 'pushReminderTitle', { n: left }),
          body: s.nextRoom ? t(lang, 'pushNextRoom', { room: s.nextRoom }) : '',
          tag: 'reminder',
        }));
      }
    }
  } catch (e) {
    console.error('Scheduled sync failed:', e.message);
  }
}

app.listen(config.port, () => {
  console.log(`Dorm bed cleaning app running at http://localhost:${config.port}`);
  console.log(`Daily list at ${config.refreshTime}, reminder at ${config.reminderTime} (${config.timezone})`);
  tick();
  setInterval(tick, 30000);
});
