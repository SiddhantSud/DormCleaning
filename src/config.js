// All settings come from environment variables (or a .env file), with sensible defaults.
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;

module.exports = {
  port: Number(env.PORT || 3000),
  sheetId: env.SHEET_ID || '1WfkDTbo9UXPH1MXUY8V1QMARbrnK4y38yFFIm47ORNI',
  sheetGid: env.SHEET_GID || '443242266',
  // For testing without the live sheet: path to a local CSV with the same columns.
  sheetCsvFile: env.SHEET_CSV_FILE || '',
  timezone: env.TIMEZONE || 'Asia/Kolkata',
  // When the day's list is pulled from the sheet and staff are notified.
  refreshTime: env.REFRESH_TIME || '10:00',
  // If beds are still pending at this time, staff get a reminder.
  reminderTime: env.REMINDER_TIME || '11:30',
  // How often (minutes) to quietly re-read the sheet during the day, so late edits show up.
  resyncMinutes: Number(env.RESYNC_MINUTES || 15),
  managerPin: env.MANAGER_PIN || '1234',
  staff: (env.STAFF || 'Caji,Akka,Volunteer').split(',').map(s => s.trim()).filter(Boolean),
  vapidSubject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
  dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
  points: { change: 10, set: 5, photo: 5, roomBonus: 5 },
};
