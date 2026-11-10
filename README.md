# osu-web — browser recreation of osu!

A fully functional, browser-based recreation of [ppy/osu](https://github.com/ppy/osu) (rhythm is just a *click* away), adapted to run directly in a web browser with a Node backend.

## Features

**Gameplay — all 4 rulesets**
- **osu! standard** — circles, sliders (L/B/C/P curves, repeats, ticks, follow-ball scoring), spinners, approach circles, follow points, combo colours from beatmap
- **Taiko** — don/ka scrolling notes, big notes (require don+ka), D/F/J/K keys
- **Catch** — catcher movement (CS-sized), falling fruit, arrows/mouse
- **Mania** — 4K–10K lanes, holds with head+tail judgement, D/F/J/K etc. key mapping

**Systems**
- `.osu` parser (v14 compatible, tested against real ppy/osu test maps) + `.osz`/`.zip` import via JSZip, drag & drop, multi-difficulty sets, background images from `.osz`
- Scoring, accuracy, combo, HP drain/fail, hit windows from OD, preempt from AR, radius from CS, SV from timing points
- Mods: DT, HT, NC, HD, HR, EZ, NF, SD, PF, FL, RX (auto-hit), AP (autoplay/watch)
- Procedural WebAudio music for built-in maps + imported audio (.mp3/.ogg) with DT/HT playback-rate support, hitsounds, audio offset
- Replay recording/playback (JSON export/import, local library, watch mode, live spectate streaming)
- Song select with search/filter/sort, star difficulty estimate, preview, per-map leaderboards
- Results screen with rank (XH/X/SH/S/A/B/C/D/F), PP estimate, verified score submission
- **Beatmap editor** — metadata/difficulty sliders, canvas placement per mode, pattern generator, playtest, `.osu` export, save to library
- **Skins** — Default, Triangles, Argonian, Sunset (distinct colours/shapes), follow points + hit explosions toggles, background dim

**Online (backend + WebSocket)**
- Registration/auth (scrypt-hashed passwords, token sessions), profiles & stats, country rankings
- Global / per-beatmap leaderboards, friends, player search
- Real-time multiplayer lobbies (create/join/ready/start, password-protected, synced mods, countdown), synchronized live score sync, spectator (live scores + replay stream), chat
- Score verification (accuracy/counts/rank/replay checks), replay fetch endpoint
- Offline fallback: scores saved locally when server unreachable

**Interface**
- Main menu, Play (song select), Gameplay HUD, Results, Multiplayer, Editor, Leaderboards, Profile, Settings, Help
- Consistent navigation, chat panel, status bar, responsive layout

## Run

```bash
npm install
npm start          # http://localhost:3000
```

Open `http://localhost:3000` in your browser. No build step — frontend is plain HTML/CSS/JS served by `server.js`.

## Architecture

```
server.js              Express + ws backend (auth, verified scores, leaderboards, friends, lobbies, chat, spectate)
public/
  index.html           SPA shell
  css/app.css          Theme (osu! pink)
  js/utils.js          Helpers, modes, mods, ranks
  js/api.js            REST + WebSocket client (offline fallback)
  js/beatmap.js        .osu parser/serializer, timing, slider paths, star estimate, backgrounds
  js/audio.js          WebAudio engine (procedural + imported audio, hitsounds)
  js/builtin.js        6 built-in maps (2× osu!, Taiko, Catch, 4K + 7K Mania)
  js/replay.js         Replay record/playback/export
  js/engine.js         Game engine: input, judgement, scoring, Canvas renderers per mode, skins
  js/editor.js         Beatmap editor logic (create/edit/export)
  js/app.js            Router, screens, import, multiplayer UI, profile, settings
server/data/db.json    JSON database (users, scores, sessions) — gitignored
```

## Controls

| Mode | Controls |
|------|----------|
| osu! | Mouse / `Z` / `X` to click, mouse circles to spin |
| Taiko | `D`/`J` = Don (red), `F`/`K` = Ka (blue), big notes need both |
| Catch | `←`/`→` or mouse |
| Mania 4K | `D` `F` `J` `K` (6K: `S` `D` `F` `J` `K` `L`, etc.) |

## Notes

- Reference implementation studied from `ppy/osu` (C#): ruleset structure (`osu.Game.Rulesets.*`), `.osu` format, timing/OD/AR/CS formulas, scoring concepts. Reimplemented independently in JS/Canvas for the browser.
- PP/star values are lightweight estimates (not the exact ppy algorithm) but monotonic with difficulty/accuracy/mods.
- Multiplayer is real (WebSocket lobbies + live scores + replay streaming) — open two browser windows to test.
