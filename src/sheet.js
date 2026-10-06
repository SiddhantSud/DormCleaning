// Reads the "Dorm Cleaning Allotment" tab of the Google Sheet and turns it into bed tasks.
const config = require('./config');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Sheet dropdown values: "Change Bedsheet", "Set", "Leave".
function normaliseAction(value) {
  const v = (value || '').trim().toLowerCase();
  if (v.startsWith('change')) return 'change';
  if (v.startsWith('set')) return 'set';
  return 'leave';
}

// Rooms are only written on the first bed of each room, so carry the room down.
function parseAllotment(csv) {
  const rows = parseCsv(csv).slice(1);
  const beds = [];
  let room = '';
  for (const [roomCell, bedCell, actionCell] of rows) {
    if (roomCell && roomCell.trim()) room = roomCell.trim();
    const bed = (bedCell || '').trim();
    if (!room || !bed) continue;
    beds.push({ room, bed, action: normaliseAction(actionCell) });
  }
  return beds;
}

// Cleaning order: rooms in the order they appear on the sheet (so the manager controls the
// route by ordering rows), and inside each room the heavier "change" beds come before "set".
function orderBeds(beds) {
  const roomOrder = [...new Set(beds.map(b => b.room))];
  const weight = { change: 0, set: 1, leave: 2 };
  return beds
    .map((b, i) => ({ ...b, i }))
    .sort((a, b) =>
      roomOrder.indexOf(a.room) - roomOrder.indexOf(b.room) ||
      weight[a.action] - weight[b.action] ||
      a.i - b.i)
    .map(({ i, ...b }, position) => ({ ...b, position }));
}

async function fetchAllotment() {
  if (config.sheetCsvFile) return orderBeds(parseAllotment(require('fs').readFileSync(config.sheetCsvFile, 'utf8')));
  const url = `https://docs.google.com/spreadsheets/d/${config.sheetId}/export?format=csv&gid=${config.sheetGid}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet download failed (${res.status}). Is the sheet shared as "Anyone with the link can view"?`);
  const text = await res.text();
  if (text.trimStart().startsWith('<')) throw new Error('Sheet returned a login page. Share it as "Anyone with the link can view".');
  return orderBeds(parseAllotment(text));
}

module.exports = { fetchAllotment, parseAllotment, orderBeds, parseCsv };
