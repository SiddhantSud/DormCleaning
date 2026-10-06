# Dorm Bed Cleaning System

A phone-friendly web app for the housekeeping team. Every day it reads the
**Dorm Cleaning Allotment** tab of the Google Sheet and shows the staff which beds
to clean, in which order, and lets them tick beds off, photograph finished rooms
and earn points.

## How it works

| Sheet value       | In the app            | Colour | Icon |
|-------------------|-----------------------|--------|------|
| `Change Bedsheet` | Change bedsheet       | Red    | ⇄ arrows |
| `Set`             | Dust & reset          | Amber  | ✦ sparkle |
| `Leave`           | Do not touch (guest staying) | Grey, striped | ⊘ |
| *(after tapping)* | Done                  | Green  | ✓ |

Each instruction has its own colour, icon and pattern, so staff can tell them apart even without reading the labels. Labels are available in English, Hindi, Kannada and Nepali.

- **Daily refresh** – at `REFRESH_TIME` (default 10:00) the list is pulled from the sheet
  and everyone with alerts on gets a notification. The sheet is re-read every
  `RESYNC_MINUTES` after that, so later edits show up; finished beds stay finished unless
  their instruction changes. The manager can also press **Sync now**.
- **Cleaning order** – rooms follow the order of rows in the sheet (reorder the sheet to
  change the route). Inside a room, "change" beds come before "set" beds. The next room is
  highlighted with **Start here**. Rooms where every guest is staying go to the bottom.
- **Mark as done** – tap a bed. Tap a done bed to see who did it, or to undo.
  All phones update live.
- **Room photos** – once a room is finished, a **Take room photo** button opens the camera.
  Photos are shrunk on the phone before upload and kept in `data/photos/<date>/`.
- **Game** – points per bed (change 10, set 5, first photo of a room 5), a team progress
  ring, confetti when a room or the whole day is finished, *Star of the day*, a weekly
  scoreboard and a streak counter for days where every bed got done.
- **Read aloud** – a **Listen to today's work** button (and a 🔊 on each room) reads out the
  remaining beds in the chosen language using the phone's built-in voice. If the phone has
  no voice for that language it reads in English (Nepali uses a Hindi voice if there's no Nepali one).
- **Push notifications** – the bell button turns on alerts in each person's language:
  list ready, a reminder at `REMINDER_TIME` if beds are pending, and "all done".
  Managers can also get an alert for each finished room (Manager → *Alert me…*).

## Run it

Requires Node.js 22.5 or newer (uses the built-in SQLite).

```bash
npm install
cp .env.example .env   # then edit MANAGER_PIN, STAFF, times
npm start
```

Open http://localhost:3000. To try it without touching the real sheet, set
`SHEET_CSV_FILE=test/demo-sheet.csv DATA_DIR=data-demo REFRESH_TIME=00:00`.

The Google Sheet must stay shared as **Anyone with the link → Viewer** so the server can read it.

## Putting it online

Staff phones need to reach the server over **HTTPS**, which push notifications and installing the app both require.
Any Node host with a persistent disk works, for example Railway, Render (with a disk), Fly.io or a small VPS.
Keep the `data/` folder on persistent storage: it holds the database, photos and the push keys.

On the phones: open the site → browser menu → **Add to Home screen**, then tap the bell.
On iPhone, notifications only work after the app has been added to the Home Screen (iOS 16.4+).

## Settings (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `SHEET_ID`, `SHEET_GID` | your sheet / first tab | Which sheet and tab to read |
| `TIMEZONE` | `Asia/Kolkata` | Timezone for "today" and the schedule |
| `REFRESH_TIME` | `10:00` | Daily list + notification |
| `REMINDER_TIME` | `11:30` | Reminder if beds are still pending |
| `RESYNC_MINUTES` | `15` | Re-read the sheet during the day |
| `STAFF` | `Caji,Akka,Volunteer` | Names on the "Who are you?" screen |
| `MANAGER_PIN` | `1234` | PIN for the Manager panel — **change it** |
| `DATA_DIR` | `./data` | Database and photos |

## Adding a language

Copy the `en` block in `public/i18n.js`, translate it, and add the language to `LANGS`.
The translations were machine-drafted, so have a native speaker check them.

## Tests

```bash
npm test
```
