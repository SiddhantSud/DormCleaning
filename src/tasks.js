// Daily bed list: syncing from the sheet, marking beds done, scores and streaks.
const { db } = require('./db');
const config = require('./config');
const { fetchAllotment } = require('./sheet');

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
}

function nowHHMM() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

function shiftDate(date, days) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Pull the sheet into today's list. Beds whose instruction hasn't changed keep their
// done state, so a mid-morning edit to the sheet never wipes finished work.
async function syncToday() {
  const date = today();
  const beds = await fetchAllotment();
  const existing = new Map(
    db.prepare('SELECT * FROM tasks WHERE date = ?').all(date).map(t => [`${t.room}|${t.bed}`, t]));

  const insert = db.prepare('INSERT INTO tasks (date, room, bed, action, position) VALUES (?, ?, ?, ?, ?)');
  const update = db.prepare(`UPDATE tasks SET action = ?, position = ?,
      done_by = CASE WHEN action = ? THEN done_by ELSE NULL END,
      done_at = CASE WHEN action = ? THEN done_at ELSE NULL END
    WHERE date = ? AND room = ? AND bed = ?`);
  const remove = db.prepare('DELETE FROM tasks WHERE date = ? AND room = ? AND bed = ?');

  let changed = false;
  db.exec('BEGIN');
  try {
    for (const b of beds) {
      const key = `${b.room}|${b.bed}`;
      const old = existing.get(key);
      if (!old) { insert.run(date, b.room, b.bed, b.action, b.position); changed = true; }
      else if (old.action !== b.action || old.position !== b.position) {
        update.run(b.action, b.position, b.action, b.action, date, b.room, b.bed); changed = true;
      }
      existing.delete(key);
    }
    for (const old of existing.values()) { remove.run(date, old.room, old.bed); changed = true; }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { date, changed, beds: beds.length };
}

function markDone(room, bed, staff) {
  const date = today();
  const r = db.prepare(`UPDATE tasks SET done_by = ?, done_at = ?
    WHERE date = ? AND room = ? AND bed = ? AND action != 'leave' AND done_by IS NULL`)
    .run(staff, new Date().toISOString(), date, room, bed);
  return r.changes > 0;
}

function undoDone(room, bed) {
  const r = db.prepare('UPDATE tasks SET done_by = NULL, done_at = NULL WHERE date = ? AND room = ? AND bed = ?')
    .run(today(), room, bed);
  return r.changes > 0;
}

function addPhoto(room, staff, file) {
  db.prepare('INSERT INTO photos (date, room, staff, file, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(today(), room, staff, file, new Date().toISOString());
}

function roomStatus(date, room) {
  const rows = db.prepare("SELECT done_by FROM tasks WHERE date = ? AND room = ? AND action != 'leave'").all(date, room);
  return { total: rows.length, done: rows.filter(r => r.done_by).length };
}

function dayStatus(date) {
  const rows = db.prepare("SELECT done_by FROM tasks WHERE date = ? AND action != 'leave'").all(date);
  return { total: rows.length, done: rows.filter(r => r.done_by).length };
}

// Points per person between two dates (inclusive). The first photo of each room per day scores.
function scores(from, to) {
  const totals = {};
  const add = (name, pts) => { totals[name] = (totals[name] || 0) + pts; };
  for (const t of db.prepare("SELECT action, done_by FROM tasks WHERE date BETWEEN ? AND ? AND done_by IS NOT NULL").all(from, to)) {
    add(t.done_by, config.points[t.action] || 0);
  }
  for (const p of db.prepare(`SELECT staff FROM photos WHERE id IN (
      SELECT MIN(id) FROM photos WHERE date BETWEEN ? AND ? GROUP BY date, room)`).all(from, to)) {
    add(p.staff, config.points.photo);
  }
  return Object.entries(totals).map(([name, points]) => ({ name, points })).sort((a, b) => b.points - a.points);
}

// Consecutive days where every bed got done. Days with nothing to do don't break the streak.
function streak() {
  let count = 0;
  let date = today();
  const first = dayStatus(date);
  if (!(first.total > 0 && first.done === first.total)) date = shiftDate(date, -1);
  for (let i = 0; i < 365; i++, date = shiftDate(date, -1)) {
    const s = dayStatus(date);
    const hasDay = db.prepare('SELECT 1 FROM tasks WHERE date = ? LIMIT 1').get(date);
    if (!hasDay) break;
    if (s.total === 0) continue;
    if (s.done < s.total) break;
    count++;
  }
  return count;
}

function state(date = today()) {
  const tasks = db.prepare('SELECT room, bed, action, position, done_by, done_at FROM tasks WHERE date = ? ORDER BY position').all(date);
  const photos = db.prepare('SELECT id, room, staff, file, created_at FROM photos WHERE date = ? ORDER BY id').all(date);

  const rooms = [];
  const byRoom = new Map();
  for (const t of tasks) {
    if (!byRoom.has(t.room)) { const r = { room: t.room, beds: [], photos: [] }; byRoom.set(t.room, r); rooms.push(r); }
    byRoom.get(t.room).beds.push({ bed: t.bed, action: t.action, doneBy: t.done_by, doneAt: t.done_at });
  }
  for (const p of photos) byRoom.get(p.room)?.photos.push({ id: p.id, staff: p.staff, url: `/photos/${p.file}`, at: p.created_at });

  for (const r of rooms) {
    const work = r.beds.filter(b => b.action !== 'leave');
    r.total = work.length;
    r.done = work.filter(b => b.doneBy).length;
    r.complete = r.total > 0 && r.done === r.total;
  }
  // Rooms with work first (in route order), rooms where everyone is staying go last.
  rooms.sort((a, b) => (a.total === 0) - (b.total === 0));

  const totals = { change: 0, set: 0, leave: 0, done: 0, total: 0 };
  for (const t of tasks) {
    totals[t.action]++;
    if (t.action !== 'leave') { totals.total++; if (t.done_by) totals.done++; }
  }

  return {
    date,
    ready: tasks.length > 0,
    refreshTime: config.refreshTime,
    rooms,
    totals,
    nextRoom: rooms.find(r => r.total > 0 && !r.complete)?.room ?? null,
    leaderboard: { today: scores(date, date), week: scores(shiftDate(date, -6), date) },
    streak: streak(),
    staff: config.staff,
    points: config.points,
  };
}

module.exports = { today, nowHHMM, syncToday, markDone, undoDone, addPhoto, roomStatus, dayStatus, state };
