/**
 * osu-web backend — accounts, scores, leaderboards, friends, multiplayer (WebSocket)
 * Single-process Node server. Data persisted to server/data/db.json.
 * Frontend is served statically from ./public.
 */
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'server', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) { console.error('DB load error', e); }
  return { users: [], scores: [], beatmaps: [], friends: [], sessions: {}, nextUserId: 1, nextScoreId: 1, nextMapId: 1 };
}
let db = loadDB();
function saveDB() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) { console.error(e); }
}

// Seed demo users + scores so leaderboards/multiplayer feel alive offline too
function seed() {
  if (db.users.length) return;
  const demos = [
    { username: 'peppy', country: 'AU', pp: 12450, playcount: 18234, acc: 98.42 },
    { username: 'WhiteCat', country: 'JP', pp: 11890, playcount: 15210, acc: 97.88 },
    { username: 'mrekk', country: 'DE', pp: 11230, playcount: 9870, acc: 97.21 },
    { username: 'Ryu', country: 'US', pp: 10980, playcount: 12450, acc: 96.75 },
    { username: 'Cookiezi', country: 'US', pp: 10750, playcount: 8930, acc: 96.40 },
    { username: 'TaikoMaster', country: 'KR', pp: 9840, playcount: 11200, acc: 95.90 },
    { username: 'CatchQueen', country: 'FR', pp: 9120, playcount: 7650, acc: 95.20 },
    { username: 'ManiaGod', country: 'CN', pp: 8760, playcount: 13400, acc: 94.80 },
  ];
  demos.forEach(d => {
    const id = db.nextUserId++;
    db.users.push({
      id, username: d.username, country: d.country, pp: d.pp, playcount: d.playcount,
      accuracy: d.acc, level: Math.floor(Math.sqrt(d.pp / 10)) + 1,
      passwordHash: hashPassword('demo1234'), createdAt: Date.now() - Math.floor(Math.random()*1e11),
      avatarColor: '#' + crypto.randomBytes(3).toString('hex'),
      bio: 'Demo player — welcome to osu-web!',
      isBot: true
    });
  });
  saveDB();
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const h = crypto.scryptSync(pw, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(h, 'hex'));
  } catch { return false; }
}
function makeToken(userId) {
  const t = crypto.randomBytes(32).toString('hex');
  db.sessions[t] = { userId, expires: Date.now() + 1000*60*60*24*30 };
  saveDB();
  return t;
}
function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || '');
  const s = db.sessions[token];
  if (!s || s.expires < Date.now()) return null;
  return db.users.find(u => u.id === s.userId) || null;
}
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, country: u.country, pp: u.pp, playcount: u.playcount, accuracy: u.accuracy, level: u.level, avatarColor: u.avatarColor, bio: u.bio, createdAt: u.createdAt, isBot: !!u.isBot };
}
seed();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR));

// ---------- Auth ----------
app.post('/api/auth/register', (req, res) => {
  const { username, password, country } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-20 chars (letters, numbers, _)' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'Username already taken' });
  const id = db.nextUserId++;
  const user = { id, username, country: (country || 'US').toUpperCase().slice(0,2), pp: 0, playcount: 0, accuracy: 0, level: 1, passwordHash: hashPassword(password), createdAt: Date.now(), avatarColor: '#' + crypto.randomBytes(3).toString('hex'), bio: '' };
  db.users.push(user); saveDB();
  const token = makeToken(id);
  res.json({ token, user: publicUser(user) });
});
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.users.find(x => x.username.toLowerCase() === String(username||'').toLowerCase());
  if (!u || !verifyPassword(password || '', u.passwordHash)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = makeToken(u.id);
  res.json({ token, user: publicUser(u) });
});
app.get('/api/auth/me', (req, res) => {
  const u = authUser(req);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: publicUser(u) });
});
app.post('/api/auth/logout', (req, res) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  delete db.sessions[token]; saveDB();
  res.json({ ok: true });
});

// ---------- Users / Profiles / Search ----------
app.get('/api/users/search', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const list = db.users.filter(u => !q || u.username.toLowerCase().includes(q)).map(publicUser);
  res.json({ users: list.slice(0, 50) });
});
app.get('/api/users/:id', (req, res) => {
  const u = db.users.find(x => x.id === Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found' });
  const scores = db.scores.filter(s => s.userId === u.id).sort((a,b)=>b.pp-a.pp).slice(0,20);
  res.json({ user: publicUser(u), scores });
});
app.put('/api/users/me', (req, res) => {
  const u = authUser(req);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  const { bio, country, avatarColor } = req.body || {};
  if (bio !== undefined) u.bio = String(bio).slice(0, 500);
  if (country) u.country = String(country).toUpperCase().slice(0,2);
  if (avatarColor) u.avatarColor = String(avatarColor);
  saveDB();
  res.json({ user: publicUser(u) });
});

// ---------- Leaderboards ----------
app.get('/api/leaderboard/global', (req, res) => {
  const mode = req.query.mode ? Number(req.query.mode) : null;
  let users = [...db.users].sort((a,b)=>b.pp-a.pp);
  // per-mode pp stored on user as ppByMode if present
  if (mode !== null) users.sort((a,b)=>((b.ppByMode&&b.ppByMode[mode])||0)-((a.ppByMode&&a.ppByMode[mode])||0));
  res.json({ leaderboard: users.slice(0,100).map((u,i)=>({ rank:i+1, ...publicUser(u) })) });
});
app.get('/api/leaderboard/country', (req, res) => {
  const byCountry = {};
  db.users.forEach(u => { byCountry[u.country] = (byCountry[u.country]||0) + (u.pp||0); });
  const list = Object.entries(byCountry).map(([country, pp])=>({ country, pp, players: db.users.filter(u=>u.country===country).length })).sort((a,b)=>b.pp-a.pp);
  res.json({ countries: list });
});
app.get('/api/leaderboard/map/:mapId', (req, res) => {
  const mapId = String(req.params.mapId);
  const scores = db.scores.filter(s=>String(s.mapId)===mapId).sort((a,b)=>b.score-a.score).slice(0,100);
  res.json({ scores: scores.map(s=>({ ...s, username: (db.users.find(u=>u.id===s.userId)||{}).username || 'Unknown' })) });
});

// ---------- Scores (with verification) ----------
function verifyScore(s) {
  const errors = [];
  const counts = s.counts || {};
  const c300 = Number(counts['300']||0), c100 = Number(counts['100']||0), c50 = Number(counts['50']||0), miss = Number(counts.miss||0);
  const total = c300+c100+c50+miss;
  if (total <= 0) errors.push('No objects judged');
  if (total > 10000) errors.push('Too many objects');
  const acc = Number(s.accuracy||0);
  if (acc < 0 || acc > 100) errors.push('Accuracy out of range');
  // accuracy must match counts (within 0.5%)
  if (total > 0) {
    const expected = ((c300*300 + c100*100 + c50*50) / (total*300)) * 100;
    if (Math.abs(expected - acc) > 0.6) errors.push(`Accuracy mismatch (expected ${expected.toFixed(2)}%)`);
  }
  if (Number(s.maxCombo||0) > total) errors.push('Max combo exceeds object count');
  if (Number(s.score||0) < 0 || Number(s.score||0) > 100000000) errors.push('Score out of range');
  if (Number(s.pp||0) < 0 || Number(s.pp||0) > 2000) errors.push('PP out of range');
  if (!['XH','X','SH','S','A','B','C','D','F'].includes(String(s.rank||'F'))) errors.push('Invalid rank');
  // rank must be consistent with accuracy/miss (basic check)
  if (s.passed) {
    const rank = String(s.rank||'F');
    if (miss===0 && acc>=90 && !['XH','X','SH','S'].includes(rank)) errors.push('Rank too low for accuracy');
    if (acc < 50 && rank !== 'F' && rank !== 'D') errors.push('Rank too high for accuracy');
  }
  // replay must exist for passed scores (anti-cheat: no replay = no leaderboard)
  const replay = s.replay;
  if (s.passed && (!replay || !Array.isArray(replay) || replay.length === 0)) {
    // allow builtin test scores without replay? No — require replay for leaderboard eligibility
    errors.push('Replay required for passed scores');
  }
  if (Array.isArray(replay) && replay.length > 200000) errors.push('Replay too large');
  return { ok: errors.length===0, errors };
}
app.post('/api/scores', (req, res) => {
  const u = authUser(req);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  const s = req.body || {};
  const v = verifyScore(s);
  if (!v.ok) return res.status(400).json({ error: 'Score verification failed: ' + v.errors.join('; ') });
  const score = {
    id: db.nextScoreId++, userId: u.id, mapId: String(s.mapId||'builtin'), mapTitle: String(s.mapTitle||'Unknown'),
    mode: Number(s.mode||0), score: Number(s.score||0), maxCombo: Number(s.maxCombo||0),
    counts: s.counts||{}, accuracy: Number(s.accuracy||0), rank: String(s.rank||'F'), pp: Number(s.pp||0),
    mods: String(s.mods||''), passed: !!s.passed, replay: s.replay||null, verified: true, createdAt: Date.now()
  };
  db.scores.push(score);
  // update profile stats
  u.playcount = (u.playcount||0)+1;
  // simple pp aggregation: total pp = sum of top scores pp (cap)
  const top = db.scores.filter(x=>x.userId===u.id).sort((a,b)=>b.pp-a.pp).slice(0,50);
  u.pp = Math.round(top.reduce((a,b)=>a+b.pp,0));
  u.ppByMode = u.ppByMode||{};
  const modeTop = db.scores.filter(x=>x.userId===u.id && x.mode===score.mode).sort((a,b)=>b.pp-a.pp).slice(0,50);
  u.ppByMode[score.mode] = Math.round(modeTop.reduce((a,b)=>a+b.pp,0));
  // running accuracy (simple average weighted by playcount)
  u.accuracy = u.playcount<=1 ? score.accuracy : Math.round(((u.accuracy*(u.playcount-1)+score.accuracy)/u.playcount)*100)/100;
  u.level = Math.floor(Math.sqrt((u.pp||0)/10))+1;
  saveDB();
  res.json({ score, user: publicUser(u) });
});
app.get('/api/scores/user/:id', (req, res) => {
  const scores = db.scores.filter(s=>s.userId===Number(req.params.id)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,100);
  res.json({ scores });
});
app.get('/api/scores/:id/replay', (req, res) => {
  const s = db.scores.find(x=>x.id===Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Score not found' });
  if (!s.replay) return res.status(404).json({ error: 'No replay for this score' });
  res.json({ replay: s.replay, meta: { mapId: s.mapId, mapTitle: s.mapTitle, mode: s.mode, score: s.score, accuracy: s.accuracy, rank: s.rank } });
});

// ---------- Friends ----------
app.get('/api/friends', (req, res) => {
  const u = authUser(req);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  const rels = db.friends.filter(f=>f.userId===u.id);
  const friends = rels.map(r=>publicUser(db.users.find(x=>x.id===r.friendId))).filter(Boolean);
  res.json({ friends });
});
app.post('/api/friends', (req, res) => {
  const u = authUser(req);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  const friendId = Number(req.body.friendId);
  if (!friendId || friendId===u.id) return res.status(400).json({ error: 'Invalid friend' });
  if (!db.users.some(x=>x.id===friendId)) return res.status(404).json({ error: 'User not found' });
  if (db.friends.some(f=>f.userId===u.id&&f.friendId===friendId)) return res.status(409).json({ error: 'Already friends' });
  db.friends.push({ userId: u.id, friendId, createdAt: Date.now() });
  saveDB();
  res.json({ ok: true });
});
app.delete('/api/friends/:id', (req, res) => {
  const u = authUser(req);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  db.friends = db.friends.filter(f=>!(f.userId===u.id&&f.friendId===Number(req.params.id)));
  saveDB();
  res.json({ ok: true });
});

// ---------- Beatmaps (metadata registry; files live client-side in IndexedDB) ----------
app.get('/api/beatmaps', (req, res) => res.json({ beatmaps: db.beatmaps }));
app.post('/api/beatmaps', (req, res) => {
  const u = authUser(req);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  const b = req.body || {};
  const entry = { id: 'u' + (db.nextMapId++), title: String(b.title||'Untitled'), artist: String(b.artist||'Unknown'), creator: String(b.creator||u.username), version: String(b.version||'Normal'), mode: Number(b.mode||0), bpm: Number(b.bpm||120), difficulty: Number(b.difficulty||3), length: Number(b.length||60), uploaderId: u.id, createdAt: Date.now() };
  db.beatmaps.push(entry); saveDB();
  res.json({ beatmap: entry });
});

// ---------- Health ----------
app.get('/api/health', (req,res)=>res.json({ ok:true, users: db.users.length, scores: db.scores.length, time: Date.now() }));

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Multiplayer + chat state (in-memory)
const lobbies = new Map(); // id -> {id, name, hostId, mapId, mode, players:Set, ready:Set, started, scores:Map}
const clients = new Map(); // ws -> {userId, username}
let nextLobbyId = 1;
const bots = [
  { id: 9001, username: 'Bot_Rin', country: 'JP' },
  { id: 9002, username: 'Bot_Kai', country: 'US' },
  { id: 9003, username: 'Bot_Mika', country: 'DE' },
];

function broadcastLobby(lobby, msg) {
  const data = JSON.stringify(msg);
  lobby.players.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
}
function lobbySnapshot(lobby) {
  return {
    id: lobby.id, name: lobby.name, hostId: lobby.hostId, mapId: lobby.mapId, mode: lobby.mode,
    hasPassword: !!lobby.password, mods: lobby.mods || [],
    playerCount: lobby.players.size, readyCount: lobby.ready.size,
    players: [...lobby.players].map(ws => { const c = clients.get(ws); return c ? { userId: c.userId, username: c.username } : { userId: 0, username: 'Guest' }; }),
    ready: [...lobby.ready].map(ws => { const c = clients.get(ws); return c ? c.username : 'Guest'; }),
    started: lobby.started,
    scores: [...lobby.scores.entries()].map(([ws, s]) => ({ username: (clients.get(ws)||{}).username || 'Guest', score: s.score, combo: s.combo, acc: s.acc }))
  };
}
function sendLobbyList() {
  const list = [...lobbies.values()].map(lobbySnapshot);
  const data = JSON.stringify({ type: 'lobby_list', lobbies: list });
  wss.clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
}

wss.on('connection', (ws, req) => {
  // token via query ?token=
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token') || '';
  const sess = db.sessions[token];
  let user = sess ? db.users.find(u=>u.id===sess.userId) : null;
  const guestName = 'Guest_' + Math.floor(Math.random()*9000+1000);
  clients.set(ws, { userId: user ? user.id : 0, username: user ? user.username : guestName });
  ws.send(JSON.stringify({ type: 'welcome', username: clients.get(ws).username, userId: clients.get(ws).userId }));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const me = clients.get(ws);
    if (msg.type === 'chat') {
      const out = { type: 'chat', username: me.username, text: String(msg.text||'').slice(0,500), time: Date.now() };
      wss.clients.forEach(c => { if (c.readyState===WebSocket.OPEN) c.send(JSON.stringify(out)); });
    } else if (msg.type === 'lobby_create') {
      const id = nextLobbyId++;
      const lobby = { id, name: String(msg.name||'Lobby').slice(0,60), hostId: me.userId, mapId: String(msg.mapId||'builtin-1'), mode: Number(msg.mode||0), password: String(msg.password||'').slice(0,20), mods: Array.isArray(msg.mods)?msg.mods.slice(0,12):[], players: new Set([ws]), ready: new Set(), started: false, scores: new Map() };
      lobbies.set(id, lobby);
      ws.send(JSON.stringify({ type: 'lobby_joined', lobby: lobbySnapshot(lobby) }));
      sendLobbyList();
    } else if (msg.type === 'lobby_join') {
      const lobby = lobbies.get(Number(msg.lobbyId));
      if (!lobby) return ws.send(JSON.stringify({ type: 'error', error: 'Lobby not found' }));
      if (lobby.password && String(msg.password||'') !== lobby.password) return ws.send(JSON.stringify({ type: 'error', error: 'Wrong password' }));
      lobby.players.add(ws);
      ws.send(JSON.stringify({ type: 'lobby_joined', lobby: lobbySnapshot(lobby) }));
      broadcastLobby(lobby, { type: 'lobby_update', lobby: lobbySnapshot(lobby) });
      sendLobbyList();
    } else if (msg.type === 'lobby_leave') {
      lobbies.forEach((lobby, id) => {
        if (lobby.players.has(ws)) {
          lobby.players.delete(ws); lobby.ready.delete(ws); lobby.scores.delete(ws);
          if (lobby.players.size===0) lobbies.delete(id);
          else broadcastLobby(lobby, { type: 'lobby_update', lobby: lobbySnapshot(lobby) });
        }
      });
      sendLobbyList();
    } else if (msg.type === 'lobby_ready') {
      const lobby = lobbies.get(Number(msg.lobbyId));
      if (!lobby) return;
      if (msg.ready) lobby.ready.add(ws); else lobby.ready.delete(ws);
      broadcastLobby(lobby, { type: 'lobby_update', lobby: lobbySnapshot(lobby) });
    } else if (msg.type === 'lobby_start') {
      const lobby = lobbies.get(Number(msg.lobbyId));
      if (!lobby) return;
      if (Array.isArray(msg.mods)) lobby.mods = msg.mods.slice(0,12);
      lobby.started = true;
      broadcastLobby(lobby, { type: 'multi_start', lobbyId: lobby.id, mapId: lobby.mapId, mode: lobby.mode, mods: lobby.mods, startAt: Date.now()+3000 });
      sendLobbyList();
    } else if (msg.type === 'multi_score') {
      const lobby = lobbies.get(Number(msg.lobbyId));
      if (!lobby) return;
      lobby.scores.set(ws, { score: Number(msg.score||0), combo: Number(msg.combo||0), acc: Number(msg.acc||0) });
      broadcastLobby(lobby, { type: 'multi_score_update', lobbyId: lobby.id, scores: [...lobby.scores.entries()].map(([w,s])=>({ username:(clients.get(w)||{}).username||'Guest', ...s })) });
    } else if (msg.type === 'spectate_replay') {
      // live replay streaming: relay replay event chunks to lobby (spectators watch)
      const lobby = lobbies.get(Number(msg.lobbyId));
      if (!lobby) return;
      const events = Array.isArray(msg.events) ? msg.events.slice(-200) : [];
      broadcastLobby(lobby, { type: 'spectate_replay_update', lobbyId: lobby.id, username: me.username, events, mapTime: Number(msg.mapTime||0) });
    } else if (msg.type === 'spectate') {
      ws.send(JSON.stringify({ type: 'spectate_info', message: 'Spectator mode: live scores + replay stream. Join a lobby to spectate.' }));
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
    lobbies.forEach((lobby, id) => {
      if (lobby.players.has(ws)) {
        lobby.players.delete(ws); lobby.ready.delete(ws); lobby.scores.delete(ws);
        if (lobby.players.size===0) lobbies.delete(id);
        else broadcastLobby(lobby, { type: 'lobby_update', lobby: lobbySnapshot(lobby) });
      }
    });
    sendLobbyList();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`osu-web server listening on http://0.0.0.0:${PORT}`);
  console.log(`  API: /api/health  WS: /ws`);
});
