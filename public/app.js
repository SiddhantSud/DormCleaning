/* Dorm bed cleaning — staff web app (no build step, plain JS). */
(() => {
  const { LANGS, t: translate } = window.I18N;
  const $app = document.getElementById('app');
  const LOCALES = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', ne: 'ne-NP' };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  const ui = {
    lang: store.get('lang'),
    staff: store.get('staff'),
    pin: store.get('managerPin'),
    tab: 'today',
    data: null,
    offline: false,
    pushOn: false,
    pop: null,          // "room|bed" to animate after the next render
    pending: new Set(), // beds being saved
  };

  const t = (key, params) => translate(ui.lang || 'en', key, params);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name, cls = 'ic') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

  // ---------------- API ----------------
  async function api(path, body, extra = {}) {
    const opts = body instanceof FormData
      ? { method: 'POST', body }
      : body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) } : {};
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  }

  async function load() {
    try {
      ui.data = await api('/api/state');
      ui.offline = false;
    } catch {
      ui.offline = true;
    }
    render();
  }

  let reloadTimer;
  function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 250); }

  function connectLive() {
    const es = new EventSource('/api/events');
    es.onmessage = scheduleReload;
    es.onopen = () => { if (ui.offline) load(); };
    es.onerror = () => { ui.offline = true; render(); };
  }

  // ---------------- Feedback ----------------
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function floatPoints(x, y, pts) {
    const el = document.createElement('div');
    el.className = 'float-pts';
    el.textContent = `+${pts}`;
    el.style.left = `${x - 16}px`;
    el.style.top = `${y - 20}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  function confetti(amount = 80) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.getElementById('confetti');
    const ctx = c.getContext('2d');
    const dpr = devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colours = ['#2563eb', '#d97706', '#16a34a', '#0f766e', '#eab308', '#ec4899'];
    const bits = Array.from({ length: amount }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * .35,
      vx: (Math.random() - .5) * 12, vy: -Math.random() * 12 - 4,
      r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, c: colours[(Math.random() * colours.length) | 0],
    }));
    const start = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const b of bits) {
        b.vy += .35; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
      }
      if (now - start < 2600) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(start);
  }

  function buzz(pattern) { try { navigator.vibrate && navigator.vibrate(pattern); } catch {} }

  // ---------------- Actions ----------------
  async function markDone(room, bed, evt) {
    const key = `${room}|${bed}`;
    if (ui.pending.has(key)) return;
    const r = ui.data.rooms.find(x => x.room === room);
    const b = r.beds.find(x => x.bed === bed);
    const pts = ui.data.points[b.action] || 0;

    // Update the screen straight away; the server confirms in the background.
    b.doneBy = ui.staff; b.doneAt = new Date().toISOString();
    r.done++; r.complete = r.done === r.total;
    ui.data.totals.done++;
    ui.pop = key;
    ui.pending.add(key);
    floatPoints(evt.clientX, evt.clientY, pts);
    buzz(30);
    bumpMyScore(pts);
    render();

    if (r.complete) {
      setTimeout(() => { toast(`✅ ${t('roomDone', { room })}`); confetti(70); buzz([60, 40, 60]); }, 250);
    }
    if (ui.data.totals.done === ui.data.totals.total) setTimeout(() => confetti(180), 700);

    try { await api('/api/done', { room, bed, staff: ui.staff }); }
    catch (e) { toast(e.message); }
    finally { ui.pending.delete(key); load(); }
  }

  function bumpMyScore(pts) {
    for (const list of [ui.data.leaderboard.today, ui.data.leaderboard.week]) {
      const me = list.find(x => x.name === ui.staff);
      if (me) me.points += pts; else list.push({ name: ui.staff, points: pts });
      list.sort((a, b) => b.points - a.points);
    }
  }

  async function undo(room, bed) {
    closeSheet();
    try { await api('/api/undo', { room, bed }); } catch (e) { toast(e.message); }
    load();
  }

  // Shrink photos on the phone before upload — quicker on slow connections.
  async function shrink(file, max = 1600) {
    const img = await createImageBitmap(file).catch(() => null);
    if (!img) return file;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', .82));
  }

  function pickPhoto(room) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      toast(t('uploading'));
      try {
        const fd = new FormData();
        fd.append('room', room);
        fd.append('staff', ui.staff);
        fd.append('photo', await shrink(file), `${room}.jpg`);
        await api('/api/photo', fd);
        toast(`📷 ${t('photoAdded')}`);
        buzz(30);
        load();
      } catch (e) { toast(e.message); }
    };
    input.click();
  }

  // ---------------- Push notifications ----------------
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function urlB64ToUint8(base64) {
    const pad = '='.repeat((4 - base64.length % 4) % 4);
    const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  async function refreshPushState() {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    ui.pushOn = !!sub && Notification.permission === 'granted';
    if (sub) api('/api/push/subscribe', { subscription: sub, staff: ui.staff, lang: ui.lang, managerPin: ui.pin }).catch(() => {});
    render();
  }

  async function enablePush() {
    if (!pushSupported()) { toast('📵 ' + t('alertsBlocked')); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast(t('alertsBlocked')); return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api('/api/push/key');
      const sub = await reg.pushManager.getSubscription()
        || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) });
      await api('/api/push/subscribe', { subscription: sub, staff: ui.staff, lang: ui.lang, managerPin: ui.pin });
      ui.pushOn = true;
      toast(`🔔 ${t('alertsEnabled')}`);
      render();
    } catch (e) { toast(e.message); }
  }

  // ---------------- Bottom sheets ----------------
  function openSheet(html, onMount) {
    closeSheet();
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    scrim.addEventListener('click', e => { if (e.target === scrim) closeSheet(); });
    document.body.appendChild(scrim);
    onMount && onMount(scrim.querySelector('.sheet'));
  }
  function closeSheet() { document.querySelector('.scrim')?.remove(); }

  function languageSheet() {
    openSheet(`<h3>${icon('globe')} Language</h3>
      <div class="grid2">${LANGS.map(l => `<button class="choice ${l.code === ui.lang ? 'on' : ''}" data-lang="${l.code}">${l.name}</button>`).join('')}</div>`,
      sheet => sheet.addEventListener('click', e => {
        const code = e.target.closest('[data-lang]')?.dataset.lang;
        if (!code) return;
        ui.lang = code; store.set('lang', code);
        document.documentElement.lang = code;
        closeSheet(); render(); refreshPushState();
      }));
  }

  function bedSheet(room, bed) {
    const b = ui.data.rooms.find(r => r.room === room).beds.find(x => x.bed === bed);
    const time = new Date(b.doneAt).toLocaleTimeString(LOCALES[ui.lang], { hour: 'numeric', minute: '2-digit' });
    openSheet(`<h3>${t('room')} ${esc(room)} · ${t('bed')} ${esc(bed)}</h3>
      <p class="note">✅ ${esc(t('doneBy', { name: b.doneBy }))} · ${time}</p>
      <div class="row"><button class="secondary" data-close>OK</button><button class="secondary" data-undo>↩ ${t('undo')}</button></div>`,
      sheet => {
        sheet.querySelector('[data-close]').onclick = closeSheet;
        sheet.querySelector('[data-undo]').onclick = () => undo(room, bed);
      });
  }

  function managerSheet() {
    if (!ui.pin) {
      openSheet(`<h3>${icon('key')} Manager</h3>
        <input class="text-in" type="password" inputmode="numeric" placeholder="PIN" autocomplete="off">
        <div class="err" hidden></div>
        <button class="primary">OK</button>`,
        sheet => {
          const input = sheet.querySelector('input');
          input.focus();
          sheet.querySelector('.primary').onclick = async () => {
            try {
              await api('/api/manager/check', {}, { 'x-manager-pin': input.value });
              ui.pin = input.value; store.set('managerPin', input.value);
              managerSheet();
            } catch (e) { const err = sheet.querySelector('.err'); err.hidden = false; err.textContent = e.message; }
          };
        });
      return;
    }
    const headers = { 'x-manager-pin': ui.pin };
    openSheet(`<h3>${icon('key')} Manager</h3>
      <p class="note">The list is read from the Google Sheet every day at ${esc(ui.data?.refreshTime || '')} and re-checked during the day. Use "Sync now" right after editing the sheet.</p>
      <div class="row" style="flex-direction:column">
        <button class="secondary" data-act="sync">🔄 Sync from sheet now</button>
        <button class="secondary" data-act="alerts">🔔 Alert me when rooms are finished</button>
        <button class="secondary" data-act="test">📣 Send test notification</button>
        <button class="secondary" data-act="logout">Log out of manager</button>
      </div>`,
      sheet => sheet.addEventListener('click', async e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        try {
          if (act === 'sync') { const r = await api('/api/manager/sync', {}, headers); toast(`🔄 ${r.beds} beds synced`); load(); }
          if (act === 'alerts') await enablePush();
          if (act === 'test') { const r = await api('/api/manager/test-push', {}, headers); toast(`📣 Sent to ${r.sent} phone(s)`); }
          if (act === 'logout') { ui.pin = null; store.set('managerPin', null); closeSheet(); render(); }
        } catch (err) { toast(err.message); }
      }));
  }

  // ---------------- Rendering ----------------
  function render() {
    document.documentElement.lang = ui.lang || 'en';
    if (!ui.lang || !ui.staff) return renderOnboarding();
    if (!ui.data) { $app.innerHTML = `<div class="wrap"><div class="center"><div class="big-emoji">🛏️</div></div></div>`; return; }
    renderMain();
    if (ui.pop) {
      const el = $app.querySelector(`[data-key="${CSS.escape(ui.pop)}"]`);
      el && el.classList.add('pop');
      ui.pop = null;
    }
  }

  function renderOnboarding(force) {
    const staffList = ui.data?.staff || [];
    // Don't redraw (and wipe a half-typed name) when live updates arrive.
    const shown = $app.querySelector('.onboard');
    if (shown && !force && shown.querySelectorAll('[data-name]').length === staffList.length) return;
    let chosen = ui.staff || '';
    $app.innerHTML = `<div class="wrap onboard">
      <h2>${icon('globe')} Language · भाषा · ಭಾಷೆ</h2>
      <div class="grid2" id="langs">${LANGS.map(l => `<button class="choice ${l.code === ui.lang ? 'on' : ''}" data-lang="${l.code}">${l.name}</button>`).join('')}</div>
      <h2>${icon('user')} ${t('whoAreYou')}</h2>
      <div class="grid2" id="people">${staffList.map(n => `<button class="choice ${n === chosen ? 'on' : ''}" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <input class="text-in" id="other" placeholder="${esc(t('otherName'))}" value="${staffList.includes(chosen) ? '' : esc(chosen)}" maxlength="40">
      <button class="primary" id="go" ${chosen && ui.lang ? '' : 'disabled'}>${t('start')} →</button>
    </div>`;
    const go = $app.querySelector('#go');
    const check = () => { go.disabled = !(chosen && ui.lang); };
    $app.querySelector('#langs').onclick = e => {
      const code = e.target.closest('[data-lang]')?.dataset.lang;
      if (code) { ui.lang = code; store.set('lang', code); renderOnboarding(true); }
    };
    $app.querySelector('#people').onclick = e => {
      const name = e.target.closest('[data-name]')?.dataset.name;
      if (!name) return;
      chosen = name;
      $app.querySelectorAll('#people .choice').forEach(b => b.classList.toggle('on', b.dataset.name === name));
      $app.querySelector('#other').value = '';
      check();
    };
    $app.querySelector('#other').oninput = e => {
      chosen = e.target.value.trim();
      $app.querySelectorAll('#people .choice').forEach(b => b.classList.remove('on'));
      check();
    };
    go.onclick = () => {
      ui.staff = chosen; store.set('staff', chosen);
      render(); refreshPushState();
    };
  }

  function bedTile(room, b) {
    const key = `${room}|${b.bed}`;
    if (b.action === 'leave') {
      return `<div class="bed leave" title="${esc(t('leaveHint'))}">
        <div class="no"><small>${t('bed')}</small>${esc(b.bed)}</div>
        <div class="act">${icon('leave')}${t('leave')}</div></div>`;
    }
    const done = !!b.doneBy;
    return `<button class="bed ${b.action} ${done ? 'done' : ''}" data-key="${esc(key)}" data-room="${esc(room)}" data-bed="${esc(b.bed)}"
        aria-label="${esc(`${t('bed')} ${b.bed}: ${t(b.action)}${done ? ' – ' + t('doneBy', { name: b.doneBy }) : ''}`)}">
      <span class="mark">${done ? icon('done') : ''}</span>
      <div class="no"><small>${t('bed')}</small>${esc(b.bed)}</div>
      <div class="act">${done ? `${icon(b.action)}${esc(b.doneBy)}` : `${icon(b.action)}${t(b.action)}`}</div>
    </button>`;
  }

  function roomCard(r, isNext) {
    const pips = r.beds.filter(b => b.action !== 'leave').map(b => `<i class="${b.doneBy ? 'd' : ''}"></i>`).join('');
    const counts = ['change', 'set'].map(a => {
      const n = r.beds.filter(b => b.action === a).length;
      return n ? `<span class="chip ${a}">${icon(a)} ${n}</span>` : '';
    }).join('');
    const photoFirst = r.photos.length === 0;
    return `<section class="room ${isNext ? 'next' : ''} ${r.complete ? 'complete' : ''}" id="room-${esc(r.room)}">
      <div class="room-head">
        <div class="room-letter">${r.complete ? icon('done') : esc(r.room)}</div>
        <div class="grow">
          <div class="room-name">${t('room')} ${esc(r.room)} <span class="room-sub">· ${r.done}/${r.total}</span></div>
          <div class="pips">${pips}</div>
        </div>
        ${isNext ? `<span class="badge-next">${t('startHere')}</span>` : `<div class="chips">${r.complete ? '' : counts}</div>`}
      </div>
      <div class="beds">${r.beds.map(b => bedTile(r.room, b)).join('')}</div>
      ${r.complete ? `<div class="room-photo">
          <button class="photo-btn" data-photo="${esc(r.room)}">${icon('camera')} ${t('takePhoto')}
            ${photoFirst ? `<span class="plus">+${ui.data.points.photo}</span>` : ''}</button>
          <div class="thumbs">${r.photos.slice(-3).map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="${esc(`${t('room')} ${r.room} – ${p.staff}`)}" loading="lazy"></a>`).join('')}</div>
        </div>` : ''}
    </section>`;
  }

  function board() {
    const list = ui.data.leaderboard[ui.tab];
    const max = Math.max(1, ...list.map(x => x.points));
    const rows = list.map((p, i) => `<div class="rank ${p.name === ui.staff ? 'me' : ''}">
        <div class="pos">${i === 0 ? icon('crown') : i + 1}</div>
        <div class="who">${esc(p.name)}${i === 0 && ui.tab === 'today' ? `<small>${t('star')}</small>` : ''}</div>
        <div class="bar-wrap"><i style="width:${(p.points / max) * 100}%"></i></div>
        <div class="pts">${p.points} <small>${t('pts')}</small></div>
      </div>`).join('');
    return `<section class="board">
      <div class="board-head"><h2>🏆 ${t('score')}</h2>
        <div class="tabs">${['today', 'week'].map(k => `<button data-tab="${k}" class="${ui.tab === k ? 'on' : ''}">${t(k)}</button>`).join('')}</div>
      </div>
      ${rows || `<div class="empty">—</div>`}
    </section>`;
  }

  function renderMain() {
    const d = ui.data;
    const dateLabel = new Date(d.date + 'T12:00:00').toLocaleDateString(LOCALES[ui.lang], { weekday: 'long', day: 'numeric', month: 'long' });
    const header = `<header class="top"><div class="top-row">
        <div class="grow"><h1>${t('appTitle')}</h1><div class="date">${esc(dateLabel)} · ${esc(ui.staff)}</div></div>
        <button class="icon-btn ${ui.pushOn ? 'on' : ''}" id="bell" aria-label="${esc(ui.pushOn ? t('alertsEnabled') : t('alertsOn'))}">${icon('bell')}</button>
        <button class="icon-btn" id="globe" aria-label="Language">${icon('globe')}</button>
      </div></header>`;
    const offline = ui.offline ? `<div class="banner">📶 ${t('offline')}</div>` : '';

    if (!d.ready) {
      $app.innerHTML = `${header}<div class="wrap">${offline}<div class="center"><div>
        <div class="big-emoji">⏳</div><h2>${t('notReady', { time: d.refreshTime })}</h2>
        <p>${ui.pushOn ? '🔔 ' + t('alertsEnabled') : ''}</p></div></div>${footer()}</div>`;
      bindCommon();
      return;
    }

    const work = d.rooms.filter(r => r.total > 0);
    const quiet = d.rooms.filter(r => r.total === 0);
    const left = d.totals.total - d.totals.done;
    const pct = d.totals.total ? d.totals.done / d.totals.total : 1;
    const C = 2 * Math.PI * 42;
    const mine = d.leaderboard.today.find(x => x.name === ui.staff)?.points || 0;

    const hero = `<section class="hero">
      <div class="ring"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="42" fill="none" stroke-width="10"/>
        <circle class="bar" cx="50" cy="50" r="42" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
        <div class="num"><div><b>${d.totals.done}</b><small>/ ${d.totals.total}</small></div></div></div>
      <div class="hero-stats">
        <div class="hero-title">${left === 0 ? '🎉 ' + t('allDone') : t('bedsLeft', { n: left })}</div>
        <div class="chips">
          <span class="chip change">${icon('change')} ${d.totals.change}</span>
          <span class="chip set">${icon('set')} ${d.totals.set}</span>
          <span class="chip">${icon('leave')} ${d.totals.leave}</span>
        </div>
        <div class="chips">
          <span class="chip me">⭐ ${mine} ${t('pts')}</span>
          ${d.streak ? `<span class="chip fire">${icon('fire')} ${t('streak', { n: d.streak })}</span>` : ''}
        </div>
      </div></section>`;

    const legendOpen = store.get('legendClosed') ? '' : 'open';
    const legend = `<details class="legend" ${legendOpen} id="legend">
      <summary><span class="dots"><i style="background:var(--change)"></i><i style="background:var(--set)"></i><i style="background:var(--leave)"></i><i style="background:var(--done)"></i></span>${t('legend')}</summary>
      ${['change', 'set', 'leave'].map(a => `<div class="legend-row"><div class="sw bed ${a}" style="min-height:0;padding:0;border-width:2px">${icon(a)}</div>
        <div><b>${t(a)}</b><span>${t(a + 'Hint')}</span></div></div>`).join('')}
      <div class="legend-row"><div class="sw bed done" style="min-height:0;padding:0">${icon('done')}</div>
        <div><b>✓</b><span>${t('tapWhenDone')}</span></div></div>
    </details>`;

    const celebrate = left === 0 && d.totals.total ? `<div class="celebrate"><b>🎉 ${t('allDone')}</b>${t('pushAllDoneBody')}</div>` : '';

    $app.innerHTML = `${header}<div class="wrap">
      ${offline}${hero}${celebrate}${legend}
      ${work.map(r => roomCard(r, r.room === d.nextRoom)).join('')}
      ${quiet.length ? `<div class="quiet-title">${icon('leave')} ${t('nothingToDo')}</div>
        <div class="quiet">${quiet.map(r => `<span>${t('room')} ${esc(r.room)}</span>`).join('')}</div>` : ''}
      ${board()}
      ${footer()}
    </div>`;

    bindCommon();
    $app.querySelectorAll('button.bed').forEach(el => el.addEventListener('click', e => {
      const { room, bed } = el.dataset;
      const b = d.rooms.find(r => r.room === room).beds.find(x => x.bed === bed);
      b.doneBy ? bedSheet(room, bed) : markDone(room, bed, e);
    }));
    $app.querySelectorAll('[data-photo]').forEach(el => el.onclick = () => pickPhoto(el.dataset.photo));
    $app.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { ui.tab = el.dataset.tab; render(); });
    $app.querySelector('#legend').addEventListener('toggle', e => store.set('legendClosed', e.target.open ? null : '1'));
  }

  function footer() {
    return `<div class="foot">
      <button id="switch">${icon('user')} ${t('switchPerson')}</button>
      <button id="manager">${icon('key')} Manager</button>
    </div>`;
  }

  function bindCommon() {
    $app.querySelector('#bell').onclick = () => ui.pushOn ? toast(`🔔 ${t('alertsEnabled')}`) : enablePush();
    $app.querySelector('#globe').onclick = languageSheet;
    $app.querySelector('#switch').onclick = () => { ui.staff = null; store.set('staff', null); renderOnboarding(true); };
    $app.querySelector('#manager').onclick = managerSheet;
  }

  // ---------------- Start ----------------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(refreshPushState).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  render();
  load();
  connectLive();
})();
