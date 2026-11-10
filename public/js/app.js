// app.js — UI router, screens, song select, import, multiplayer, profile, settings
(() => {
  const screenEl = $('#screen');
  let currentScreen = 'menu';
  let selectedMapId = null;
  let selectedMods = [];
  let gameInstance = null;
  let builtinMaps = BuiltinMaps.all();
  let importedMaps = []; // {bm, audioBlob?, audioUrl?}
  let lobbyState = null;
  let liveScores = [];
  let settings = loadSettings();
  let filterMode = -1, filterQuery = '', sortBy = 'title';

  function loadSettings(){
    try{ return { volume:0.8, offset:0, skin:'default', bgDim:0.3, showFPS:false, keyBindings:{}, ...JSON.parse(localStorage.getItem('osuweb_settings')||'{}') }; }
    catch{ return { volume:0.8, offset:0, skin:'default', bgDim:0.3 }; }
  }
  function saveSettings(){ localStorage.setItem('osuweb_settings', JSON.stringify(settings)); AudioEngine.setVolume(settings.volume); }

  // ---------- IndexedDB for imported maps ----------
  const IDB = (() => {
    let db=null;
    function open(){
      return new Promise((res,rej)=>{
        if(db) return res(db);
        const r=indexedDB.open('osuweb',1);
        r.onupgradeneeded=()=>{ r.result.createObjectStore('maps',{keyPath:'id'}); };
        r.onsuccess=()=>{ db=r.result; res(db); };
        r.onerror=()=>rej(r.error);
      });
    }
    async function put(map){ const d=await open(); return new Promise((res,rej)=>{ const tx=d.transaction('maps','readwrite'); tx.objectStore('maps').put(map); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
    async function all(){ const d=await open(); return new Promise((res,rej)=>{ const tx=d.transaction('maps','readonly'); const rq=tx.objectStore('maps').getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>rej(rq.error); }); }
    async function del(id){ const d=await open(); return new Promise((res,rej)=>{ const tx=d.transaction('maps','readwrite'); tx.objectStore('maps').delete(id); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
    return { put, all, del };
  })();

  async function loadImported(){
    try{
      const rows = await IDB.all();
      importedMaps = rows.map(r=>({ bm: r.bm, audioBlob: r.audioBlob||null, audioUrl: r.audioUrl||null, id: r.id }));
    }catch{ importedMaps=[]; }
  }
  function allMaps(){
    const b = builtinMaps.map(bm=>({ bm, builtin:true, id: bm.id }));
    const im = importedMaps.map(m=>({ bm: m.bm, builtin:false, id: m.id, audioBlob: m.audioBlob, audioUrl: m.audioUrl }));
    return [...b, ...im];
  }
  function findMap(id){ return allMaps().find(m=>m.id===id); }

  // ---------- Navigation ----------
  function navigate(screen){
    currentScreen=screen;
    $$('.navbtn').forEach(b=>b.classList.toggle('active', b.dataset.nav===screen || (screen==='game'&&b.dataset.nav==='play') || (screen==='results'&&b.dataset.nav==='play')));
    if (screen==='menu') renderMenu();
    else if (screen==='play') renderPlay();
    else if (screen==='multiplayer') renderMultiplayer();
    else if (screen==='leaderboards') renderLeaderboards();
    else if (screen==='profile') renderProfile();
    else if (screen==='settings') renderSettings();
    else if (screen==='game') renderGame();
    else if (screen==='results') renderResults();
    window.scrollTo(0,0);
  }
  $$('.navbtn').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
  $('.logo').addEventListener('click',()=>navigate('menu'));

  // ---------- MENU ----------
  function renderMenu(){
    const user=Api.user;
    screenEl.innerHTML = `
      <div class="menu-hero">
        <div class="big">osu<em>!</em> <span style="font-size:28px;color:var(--muted)">web</span></div>
        <p class="muted" style="font-size:16px">rhythm is just a <b>click</b> away — now in your browser. All 4 rulesets, beatmap import, replays & multiplayer.</p>
        ${user?`<p><span class="pill">👋 ${esc(user.username)}</span> <span class="pill">${fmtInt(user.pp)} pp</span> <span class="pill">Lv ${user.level}</span></p>`:`<p class="muted">Playing as Guest — <a href="#" id="menu-login" style="color:var(--accent)">login</a> to save scores & climb leaderboards.</p>`}
      </div>
      <div class="menu-grid">
        <div class="menu-tile" data-go="play"><h3>▶ Play</h3><p>Song select, mods, import .osu / .osz beatmaps</p></div>
        <div class="menu-tile" data-go="multiplayer"><h3>👥 Multiplayer</h3><p>Lobbies, live scores, spectator, chat</p></div>
        <div class="menu-tile" data-go="leaderboards"><h3>🏆 Leaderboards</h3><p>Global, country & per-beatmap rankings</p></div>
        <div class="menu-tile" data-go="profile"><h3>👤 Profile</h3><p>Stats, top scores, friends, replays</p></div>
        <div class="menu-tile" data-go="settings"><h3>⚙ Settings</h3><p>Audio, offset, skins, keys, gameplay</p></div>
        <div class="menu-tile" data-go="help"><h3>❓ Help</h3><p>How to play each mode, import guide</p></div>
      </div>
      <div class="card" style="margin-top:18px">
        <h2>Quick start</h2>
        <p class="muted">Pick a built-in map below or drag & drop a <b>.osu</b> / <b>.osz</b> file anywhere on the Play screen. Use <span class="kbd">Z</span>/<span class="kbd">X</span> or mouse to click in osu!, <span class="kbd">D</span><span class="kbd">F</span><span class="kbd">J</span><span class="kbd">K</span> in Taiko/Mania, arrows in Catch.</p>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="quick-play">Play Neon Skyline (osu!)</button>
          <button class="btn secondary" id="quick-import">Import beatmap</button>
          <input type="file" id="quick-file" accept=".osu,.osz,.zip" class="hidden">
        </div>
      </div>`;
    $$('.menu-tile').forEach(t=>t.addEventListener('click',()=>{ if(t.dataset.go==='help') renderHelp(); else navigate(t.dataset.go); }));
    const ml=$('#menu-login'); if(ml) ml.addEventListener('click',e=>{e.preventDefault(); openAuth();});
    $('#quick-play').addEventListener('click',()=>{ selectedMapId='builtin-osu-1'; navigate('game'); });
    $('#quick-import').addEventListener('click',()=>$('#quick-file').click());
    $('#quick-file').addEventListener('change',e=>handleImportFiles(e.target.files));
  }

  function renderHelp(){
    screenEl.innerHTML=`
      <h1>Help</h1>
      <div class="grid2">
        <div class="card"><h2>osu! standard</h2><p class="muted">Click circles when the approach ring closes. Follow sliders — keep your cursor on the ball. Spin spinners by moving your mouse in circles. Keys: <span class="kbd">Z</span>/<span class="kbd">X</span> or mouse.</p></div>
        <div class="card"><h2>Taiko</h2><p class="muted">Notes scroll right→left. <span class="kbd">D</span>/<span class="kbd">J</span> = Don (red), <span class="kbd">F</span>/<span class="kbd">K</span> = Ka (blue). Big notes need both hands (press two keys).</p></div>
        <div class="card"><h2>Catch</h2><p class="muted">Move the catcher with <span class="kbd">←</span><span class="kbd">→</span> or mouse to catch falling fruit. Don't let fruit hit the ground!</p></div>
        <div class="card"><h2>Mania</h2><p class="muted">Notes fall down lanes. Press lane keys when notes hit the judgement line. 4K: <span class="kbd">D</span><span class="kbd">F</span><span class="kbd">J</span><span class="kbd">K</span>. Holds: keep key held.</p></div>
      </div>
      <div class="card" style="margin-top:16px"><h2>Importing beatmaps</h2><p class="muted">Drag & drop <b>.osu</b> files or <b>.osz</b> archives (zip containing .osu + audio). Multi-difficulty sets import all difficulties. Audio files (.mp3/.ogg) are supported. Your maps are stored locally in IndexedDB — no upload needed.</p></div>
      <div class="card" style="margin-top:16px"><h2>Replays</h2><p class="muted">Every play is recorded. From the results screen you can save, export (.json), or watch replays. Autoplay (AP) watches a replay.</p></div>
      <button class="btn" onclick="window.__nav('menu')">Back to menu</button>`;
  }
  window.__nav=navigate;

  // ---------- PLAY / SONG SELECT ----------
  function renderPlay(){
    const maps=allMaps();
    screenEl.innerHTML=`
      <h1>Play</h1>
      <p class="muted">Select a beatmap, pick mods, then play. Drag & drop .osu / .osz to import.</p>
      <div class="song-toolbar">
        <input id="search" placeholder="Search title, artist, creator…">
        <div class="mode-tabs">
          <button class="mode-tab ${filterMode===-1?'active':''}" data-mode="-1">All</button>
          ${MODES.map(m=>`<button class="mode-tab ${filterMode===m.id?'active':''}" data-mode="${m.id}">${m.icon} ${m.name}</button>`).join('')}
        </div>
        <select id="sort" style="max-width:180px">
          <option value="title">Sort: Title</option>
          <option value="stars">Sort: Difficulty</option>
          <option value="bpm">Sort: BPM</option>
          <option value="length">Sort: Length</option>
        </select>
        <span class="spacer"></span>
        <button class="btn secondary" id="import-btn">Import</button>
        <input type="file" id="import-file" accept=".osu,.osz,.zip,.mp3,.ogg" multiple class="hidden">
      </div>
      <div class="dropzone" id="dropzone">Drag & drop .osu / .osz here, or click Import</div>
      <div class="grid2" style="margin-top:16px">
        <div>
          <h2>Beatmaps <span class="muted" id="map-count"></span></h2>
          <div class="song-list" id="song-list"></div>
        </div>
        <div>
          <h2>Mods</h2>
          <div class="card" id="mods-box"></div>
          <h2 style="margin-top:16px">Selected</h2>
          <div class="card" id="selected-box"></div>
          <div class="row" style="margin-top:12px">
            <button class="btn" id="play-btn" disabled>▶ Play</button>
            <button class="btn secondary" id="preview-btn" disabled>Preview</button>
            <button class="btn ghost" id="delete-btn" disabled>Delete</button>
          </div>
          <div class="card" style="margin-top:12px">
            <h2>Leaderboard (this map)</h2>
            <div id="map-lb"><p class="muted">Select a map to view scores.</p></div>
          </div>
        </div>
      </div>`;
    const searchEl=$('#search'); searchEl.value=filterQuery;
    searchEl.addEventListener('input',()=>{ filterQuery=searchEl.value; renderSongList(); });
    $$('.mode-tab').forEach(b=>b.addEventListener('click',()=>{ filterMode=Number(b.dataset.mode); renderPlay(); }));
    $('#sort').addEventListener('change',e=>{ sortBy=e.target.value; renderSongList(); });
    $('#import-btn').addEventListener('click',()=>$('#import-file').click());
    $('#import-file').addEventListener('change',e=>handleImportFiles(e.target.files));
    const dz=$('#dropzone');
    dz.addEventListener('click',()=>$('#import-file').click());
    ['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault(); dz.classList.add('drag');}));
    ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault(); dz.classList.remove('drag');}));
    dz.addEventListener('drop',e=>handleImportFiles(e.dataTransfer.files));
    // global drop
    document.ondragover=e=>e.preventDefault();
    document.ondrop=e=>{ e.preventDefault(); if(currentScreen==='play') handleImportFiles(e.dataTransfer.files); };
    renderMods(); renderSongList(); renderSelected();
  }
  function renderMods(){
    $('#mods-box').innerHTML = MOD_LIST.map(m=>`
      <label style="display:flex;gap:10px;align-items:center;margin:6px 0;cursor:pointer">
        <input type="checkbox" data-mod="${m.id}" ${selectedMods.includes(m.id)?'checked':''} style="width:auto">
        <b>${m.id}</b> <span class="muted">${m.name} — ${m.desc} <span class="pill">×${m.mult}</span></span>
      </label>`).join('') + `<p class="muted" style="font-size:12px">DT/HT/NC are mutually exclusive. RX = relax (no fail, auto-hits simplified). AP = autoplay watch.</p>`;
    $$('#mods-box input').forEach(cb=>cb.addEventListener('change',()=>{
      const id=cb.dataset.mod;
      if (cb.checked){ selectedMods.push(id); if(['DT','HT','NC'].includes(id)) selectedMods=selectedMods.filter(x=>x===id||!['DT','HT','NC'].includes(x)); }
      else selectedMods=selectedMods.filter(x=>x!==id);
      renderMods(); renderSelected();
    }));
  }
  function renderSongList(){
    let maps=allMaps();
    if (filterMode>=0) maps=maps.filter(m=>m.bm.mode===filterMode);
    if (filterQuery){ const q=filterQuery.toLowerCase(); maps=maps.filter(m=> (m.bm.title+' '+m.bm.artist+' '+m.bm.creator+' '+m.bm.version).toLowerCase().includes(q)); }
    if (sortBy==='title') maps.sort((a,b)=>a.bm.title.localeCompare(b.bm.title));
    else if (sortBy==='stars') maps.sort((a,b)=>(b.bm.starDifficulty||0)-(a.bm.starDifficulty||0));
    else if (sortBy==='bpm') maps.sort((a,b)=>(b.bm.bpm||0)-(a.bm.bpm||0));
    else if (sortBy==='length') maps.sort((a,b)=>(b.bm.length||0)-(a.bm.length||0));
    $('#map-count').textContent=`(${maps.length})`;
    const list=$('#song-list');
    if (!maps.length){ list.innerHTML='<p class="muted">No beatmaps found. Import one!</p>'; return; }
    list.innerHTML=maps.map(m=>{
      const mode=MODES[m.bm.mode]||MODES[0];
      const stars=m.bm.starDifficulty||0;
      const starCol=stars<2?'#4ade80':stars<3.5?'#fbbf24':stars<5?'#fb923c':'#f87171';
      return `<div class="song-row ${selectedMapId===m.id?'selected':''}" data-id="${esc(m.id)}">
        <div class="song-thumb" style="background:${mode.color}22;border:1px solid ${mode.color}">${mode.icon}</div>
        <div class="song-meta">
          <div class="song-title">${esc(m.bm.artist)} - ${esc(m.bm.title)} <span class="muted">[${esc(m.bm.version)}]</span></div>
          <div class="song-sub">by ${esc(m.bm.creator)} · ${m.bm.hitObjects.length} objects · ${fmtTime(m.bm.length||0)}</div>
          <div class="song-stats" style="margin-top:4px">
            <span class="pill mode">${mode.name}</span>
            <span class="pill">${Math.round(m.bm.bpm||120)} BPM</span>
            <span class="pill" style="color:${starCol}">★ ${stars.toFixed(2)}</span>
            <span class="pill">AR ${m.bm.ar} · CS ${m.bm.cs} · OD ${m.bm.od} · HP ${m.bm.hp}</span>
            ${m.builtin?'':'<span class="pill">Imported</span>'}
          </div>
        </div>
      </div>`;
    }).join('');
    $$('.song-row').forEach(r=>r.addEventListener('click',()=>{ selectedMapId=r.dataset.id; renderSongList(); renderSelected(); }));
  }
  function renderSelected(){
    const m=findMap(selectedMapId);
    const box=$('#selected-box');
    const playBtn=$('#play-btn'), prevBtn=$('#preview-btn'), delBtn=$('#delete-btn');
    if (!m){ box.innerHTML='<p class="muted">No map selected.</p>'; playBtn.disabled=true; prevBtn.disabled=true; delBtn.disabled=true; return; }
    const mode=MODES[m.bm.mode];
    box.innerHTML=`<b>${esc(m.bm.artist)} - ${esc(m.bm.title)}</b> <span class="muted">[${esc(m.bm.version)}]</span><br>
      <span class="pill mode">${mode.name}</span> <span class="pill">${Math.round(m.bm.bpm)} BPM</span> <span class="pill">★ ${m.bm.starDifficulty.toFixed(2)}</span>
      <p class="muted" style="margin:8px 0 0">Mods: ${selectedMods.length?selectedMods.join(' '):'—'} · Score mult ×${modMult(selectedMods).toFixed(2)} · Speed ×${modSpeed(selectedMods)}</p>`;
    playBtn.disabled=false; prevBtn.disabled=false; delBtn.disabled=!!m.builtin;
    playBtn.onclick=()=>navigate('game');
    prevBtn.onclick=()=>previewMap(m);
    delBtn.onclick=async()=>{ if(!confirm('Delete this beatmap?'))return; await IDB.del(m.id); await loadImported(); selectedMapId=null; renderPlay(); status('Deleted'); };
    // map leaderboard
    Api.mapLB(m.id).then(d=>{
      const el=$('#map-lb'); if(!el) return;
      if (!d.scores || !d.scores.length){ el.innerHTML='<p class="muted">No scores yet — be the first!</p>'; return; }
      el.innerHTML=`<table><tr><th>#</th><th>Player</th><th>Score</th><th>Acc</th><th>Rank</th><th>PP</th></tr>${d.scores.slice(0,10).map((s,i)=>`<tr><td>${i+1}</td><td>${esc(s.username)}</td><td>${fmtInt(s.score)}</td><td>${fmtAcc(s.accuracy)}</td><td><span class="pill rank" style="background:${gradeColor(s.rank)};color:#111">${s.rank}</span></td><td>${fmtInt(s.pp)}</td></tr>`).join('')}</table>`;
    });
  }
  async function previewMap(m){
    status('Previewing '+m.bm.title+'…');
    AudioEngine.ensureCtx();
    if (m.audioBlob){ try{ await AudioEngine.loadAudioFile(m.audioBlob); }catch{} }
    else if (m.audioUrl){ try{ await AudioEngine.loadAudioFile(m.audioUrl); }catch{} }
    AudioEngine.playMusic(m.bm.previewTime||0, m.bm.bpm);
    setTimeout(()=>{ if(currentScreen==='play') AudioEngine.stopMusic(); }, 10000);
  }

  // ---------- IMPORT ----------
  async function handleImportFiles(files){
    if (!files || !files.length) return;
    status('Importing…');
    let imported=0;
    for (const file of files){
      try{
        const name=file.name.toLowerCase();
        if (name.endsWith('.osu')){
          const text=await file.text();
          const bm=BeatmapParser.parseOsu(text);
          const id='imp-'+uid();
          bm.id=id;
          await IDB.put({ id, bm, audioBlob:null, audioUrl:null });
          imported++;
        } else if (name.endsWith('.osz')||name.endsWith('.zip')){
          const zip=await JSZip.loadAsync(file);
          let audioBlob=null;
          const osuFiles=[];
          for (const [path, entry] of Object.entries(zip.files)){
            if (entry.dir) continue;
            const lower=path.toLowerCase();
            if (lower.endsWith('.osu')) osuFiles.push({ path, entry });
            else if (lower.endsWith('.mp3')||lower.endsWith('.ogg')||lower.endsWith('.wav')) audioBlob=await entry.async('blob');
          }
          if (!osuFiles.length) throw new Error('No .osu files in archive');
          for (const {entry} of osuFiles){
            const text=await entry.async('text');
            const bm=BeatmapParser.parseOsu(text);
            const id='imp-'+uid();
            bm.id=id;
            await IDB.put({ id, bm, audioBlob, audioUrl:null });
            imported++;
          }
        } else if (name.endsWith('.mp3')||name.endsWith('.ogg')||name.endsWith('.wav')){
          // attach to most recent imported map without audio? Just store as standalone? Require .osu first.
          status('Audio file received — import a .osu / .osz to use it.');
        }
      }catch(e){ console.error(e); status('Import failed: '+e.message); }
    }
    await loadImported();
    status(`Imported ${imported} beatmap(s)`);
    if (currentScreen==='play') renderPlay();
  }

  // ---------- GAME ----------
  function renderGame(){
    const m=findMap(selectedMapId);
    if (!m){ navigate('play'); return; }
    screenEl.innerHTML=`
      <div class="row" style="margin-bottom:10px">
        <button class="btn ghost" id="quit-btn">← Quit</button>
        <b>${esc(m.bm.artist)} - ${esc(m.bm.title)} [${esc(m.bm.version)}]</b>
        <span class="pill mode">${MODES[m.bm.mode].name}</span>
        <span class="pill">${selectedMods.join(' ')||'No mods'}</span>
        <span class="spacer"></span>
        <span class="muted" id="game-status">Ready</span>
      </div>
      <div id="game-wrap">
        <canvas id="game-canvas"></canvas>
        <div id="game-hud"></div>
        <div id="game-overlay">
          <div class="box">
            <h2 style="font-size:28px">${esc(m.bm.title)}</h2>
            <p class="muted">${MODES[m.bm.mode].name} · ${Math.round(m.bm.bpm)} BPM · ★ ${m.bm.starDifficulty.toFixed(2)} · ${m.bm.hitObjects.length} objects</p>
            <p class="muted" style="font-size:13px">${m.bm.mode===0?'Mouse / Z / X to click':m.bm.mode===1?'D/J = Don, F/K = Ka':m.bm.mode===2?'Arrows / mouse to move':'Lane keys to hit notes'}</p>
            <button class="btn" id="start-btn" style="font-size:18px;padding:12px 32px">▶ Start</button>
            <div class="progress-track"><div id="load-bar" style="width:0%"></div></div>
            <p class="muted" id="load-msg" style="font-size:12px">Click Start to play</p>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="row">
          <button class="btn secondary" id="pause-btn">⏸ Pause</button>
          <button class="btn ghost" id="restart-btn">↻ Restart</button>
          <span class="muted" id="live-hud"></span>
          <span class="spacer"></span>
          <span class="muted" id="mp-status"></span>
        </div>
        <div id="mp-scores" style="margin-top:8px"></div>
      </div>`;
    $('#quit-btn').addEventListener('click',()=>{ cleanupGame(); navigate('play'); });
    $('#pause-btn').addEventListener('click',()=>{ if(gameInstance){ if(gameInstance.state==='playing'){ gameInstance.pause(); $('#pause-btn').textContent='▶ Resume'; } else if(gameInstance.state==='paused'){ gameInstance.resume(); $('#pause-btn').textContent='⏸ Pause'; } } });
    $('#restart-btn').addEventListener('click',()=>{ cleanupGame(); renderGame(); });
    $('#start-btn').addEventListener('click', async ()=>{
      $('#game-overlay').style.display='none';
      await startGame(m);
    });
  }
  function cleanupGame(){ if(gameInstance){ gameInstance.destroy(); gameInstance=null; } AudioEngine.stopMusic(); }
  async function startGame(m){
    cleanupGame();
    const canvas=$('#game-canvas');
    // load audio
    if (m.audioBlob){ try{ await AudioEngine.loadAudioFile(m.audioBlob); }catch(e){ console.warn(e);} }
    else if (m.audioUrl){ try{ await AudioEngine.loadAudioFile(m.audioUrl); }catch{} }
    // else procedural (no buffer)
    const multiplayer = lobbyState && lobbyState.started ? { lobbyId: lobbyState.id, sendScore:(s,c,a)=>Api.sendWS({type:'multi_score', lobbyId:lobbyState.id, score:s, combo:c, acc:a}) } : null;
    gameInstance = new GameEngine.Game(canvas, m.bm, {
      mods: selectedMods, settings,
      onFinish: (res)=>{ window.__lastResults=res; window.__lastMap=m; navigate('results'); },
      onScoreUpdate: (g)=>{
        const el=$('#live-hud'); if(el) el.textContent=`Score ${fmtInt(g.score)} · ${g.combo}x · ${fmtAcc(g.accuracy())} · HP ${Math.round(g.hp)}%`;
        if (multiplayer){
          const el2=$('#mp-scores');
          if (el2 && liveScores.length) el2.innerHTML=liveScores.map(s=>`<div class="live-score"><span>${esc(s.username)}</span><span>${fmtInt(s.score)} · ${s.combo}x · ${fmtAcc(s.acc)}</span></div>`).join('');
        }
      },
      multiplayer
    });
    await gameInstance.start();
    status('Playing: '+m.bm.title);
  }

  // ---------- RESULTS ----------
  function renderResults(){
    const res=window.__lastResults, m=window.__lastMap;
    if (!res){ navigate('play'); return; }
    const rankCol=gradeColor(res.rank);
    screenEl.innerHTML=`
      <h1>${res.passed?'Results':'Failed'} <span class="muted" style="font-size:18px">${esc(res.mapArtist)} - ${esc(res.mapTitle)} [${esc(res.mapVersion)}]</span></h1>
      <div class="grid2">
        <div class="card" style="text-align:center">
          <div class="rank-big rank-${res.rank}" style="color:${rankCol}">${res.rank}</div>
          <div class="stat-grid" style="margin-top:14px">
            <div class="stat"><div class="v">${fmtInt(res.score)}</div><div class="k">Score</div></div>
            <div class="stat"><div class="v">${fmtAcc(res.accuracy)}</div><div class="k">Accuracy</div></div>
            <div class="stat"><div class="v">${res.maxCombo}x</div><div class="k">Max combo</div></div>
            <div class="stat"><div class="v">${fmtInt(res.pp)} pp</div><div class="k">Performance</div></div>
          </div>
          <table style="margin-top:12px"><tr><th>300</th><th>100</th><th>50</th><th>Miss</th></tr>
          <tr><td>${res.counts['300']}</td><td>${res.counts['100']}</td><td>${res.counts['50']}</td><td>${res.counts.miss}</td></tr></table>
          <p class="muted">Mods: ${res.mods||'—'} · Mode: ${MODES[res.mode].name}</p>
        </div>
        <div>
          <div class="card">
            <h2>Actions</h2>
            <div class="row">
              <button class="btn" id="retry-btn">↻ Retry</button>
              <button class="btn secondary" id="songsel-btn">Song select</button>
              <button class="btn ghost" id="watch-btn">▶ Watch replay</button>
            </div>
            <div class="row" style="margin-top:10px">
              <button class="btn secondary" id="save-replay-btn">Save replay</button>
              <button class="btn ghost" id="export-replay-btn">Export replay</button>
              <button class="btn ghost" id="submit-btn">Submit score</button>
            </div>
            <p class="muted" id="submit-msg" style="font-size:13px"></p>
          </div>
          <div class="card" style="margin-top:12px">
            <h2>Map leaderboard</h2>
            <div id="res-lb"><p class="muted">Loading…</p></div>
          </div>
        </div>
      </div>`;
    $('#retry-btn').addEventListener('click',()=>navigate('game'));
    $('#songsel-btn').addEventListener('click',()=>navigate('play'));
    $('#watch-btn').addEventListener('click',()=>{
      if (!res.replayEvents || !res.replayEvents.length){ status('No replay data (autoplay)'); return; }
      selectedMods=['AP'];
      // store replay for game
      window.__watchReplay={ events: res.replayEvents, meta: { mapId: res.mapId, title: res.mapTitle } };
      navigate('game');
      // auto-start with replay
      setTimeout(async ()=>{
        const mm=findMap(res.mapId) || m;
        if (!mm) return;
        $('#game-overlay').style.display='none';
        cleanupGame();
        const canvas=$('#game-canvas');
        if (mm.audioBlob){ try{ await AudioEngine.loadAudioFile(mm.audioBlob);}catch{} }
        gameInstance=new GameEngine.Game(canvas, mm.bm, { mods:['AP'], settings, replayPlayback: window.__watchReplay, onFinish:()=>navigate('results') });
        await gameInstance.start();
      }, 100);
    });
    $('#save-replay-btn').addEventListener('click',()=>{
      const name=(res.mapTitle+'-'+Date.now()).slice(0,60);
      Replay.saveToLocalStorage(name, { meta:res, events:res.replayEvents });
      status('Replay saved: '+name);
    });
    $('#export-replay-btn').addEventListener('click',()=>{
      const payload=JSON.stringify({ format:'osu-web-replay-v1', meta:res, events:res.replayEvents }, null, 2);
      Replay.downloadReplay('replay-'+res.mapId+'.json', payload);
    });
    $('#submit-btn').addEventListener('click', async ()=>{
      const msg=$('#submit-msg');
      if (!Api.user){ msg.textContent='Login to submit scores.'; openAuth(); return; }
      msg.textContent='Submitting…';
      const d=await Api.submitScore({ mapId:res.mapId, mapTitle:res.mapTitle, mode:res.mode, score:res.score, maxCombo:res.maxCombo, counts:res.counts, accuracy:res.accuracy, rank:res.rank, pp:res.pp, mods:res.mods, passed:res.passed, replay:res.replayEvents });
      msg.textContent=d.offline?('Saved locally (offline): '+d.error):'Score submitted! +'+fmtInt(res.pp)+' pp';
      status(msg.textContent);
    });
    Api.mapLB(res.mapId).then(d=>{
      const el=$('#res-lb'); if(!el) return;
      if (!d.scores||!d.scores.length){ el.innerHTML='<p class="muted">No scores yet.</p>'; return; }
      el.innerHTML=`<table><tr><th>#</th><th>Player</th><th>Score</th><th>Acc</th><th>Rank</th></tr>${d.scores.slice(0,10).map((s,i)=>`<tr><td>${i+1}</td><td>${esc(s.username)}</td><td>${fmtInt(s.score)}</td><td>${fmtAcc(s.accuracy)}</td><td>${s.rank}</td></tr>`).join('')}</table>`;
    });
  }

  // ---------- MULTIPLAYER ----------
  function renderMultiplayer(){
    screenEl.innerHTML=`
      <h1>Multiplayer</h1>
      <p class="muted">Create or join a lobby. When the host starts, everyone plays the same map — scores sync live. Use chat (bottom-right) to coordinate.</p>
      <div class="grid2">
        <div>
          <div class="card">
            <h2>Create lobby</h2>
            <label>Lobby name</label><input id="lobby-name" value="My Lobby">
            <label>Map</label><select id="lobby-map">${allMaps().map(m=>`<option value="${esc(m.id)}">${esc(m.bm.artist)} - ${esc(m.bm.title)} [${esc(m.bm.version)}] (${MODES[m.bm.mode].name})</option>`).join('')}</select>
            <div class="row" style="margin-top:10px"><button class="btn" id="create-lobby">Create lobby</button><button class="btn ghost" id="leave-lobby">Leave</button></div>
          </div>
          <div class="card" style="margin-top:12px" id="lobby-box"><h2>Lobby</h2><p class="muted">No lobby joined. Create one or join below.</p></div>
        </div>
        <div>
          <div class="card"><h2>Open lobbies</h2><div id="lobby-list"><p class="muted">Waiting for lobbies…</p></div></div>
          <div class="card" style="margin-top:12px"><h2>Live scores</h2><div id="live-box"><p class="muted">No live match.</p></div></div>
          <div class="card" style="margin-top:12px"><h2>Spectate</h2><p class="muted">Join a started lobby to spectate live scores. Spectator streams scores in real time.</p><button class="btn secondary" id="spectate-btn">Spectate</button></div>
        </div>
      </div>`;
    $('#create-lobby').addEventListener('click',()=>{
      const name=$('#lobby-name').value, mapId=$('#lobby-map').value;
      const m=findMap(mapId);
      Api.sendWS({type:'lobby_create', name, mapId, mode: m?m.bm.mode:0});
      status('Creating lobby…');
    });
    $('#leave-lobby').addEventListener('click',()=>{ Api.sendWS({type:'lobby_leave'}); lobbyState=null; renderLobbyBox(); });
    $('#spectate-btn').addEventListener('click',()=>{ Api.sendWS({type:'spectate'}); status('Spectating — live scores will appear here.'); });
    renderLobbyBox();
  }
  function renderLobbyBox(){
    const box=$('#lobby-box'); if(!box) return;
    if (!lobbyState){ box.innerHTML='<h2>Lobby</h2><p class="muted">No lobby joined.</p>'; return; }
    const m=findMap(lobbyState.mapId);
    box.innerHTML=`<h2>${esc(lobbyState.name)}</h2>
      <p class="muted">Map: ${m?esc(m.bm.artist+' - '+m.bm.title):esc(lobbyState.mapId)} · Players: ${lobbyState.playerCount} · Ready: ${lobbyState.readyCount}</p>
      <div>${lobbyState.players.map(p=>`<div class="live-score"><span>${esc(p.username)}</span><span>${lobbyState.ready.includes(p.username)?'✓ Ready':'…'}</span></div>`).join('')}</div>
      <div class="row" style="margin-top:10px">
        <button class="btn secondary" id="ready-btn">${lobbyState.ready.includes(Api.user?Api.user.username:'')?'Unready':'Ready'}</button>
        <button class="btn" id="start-lobby">Start match</button>
        <button class="btn ghost" id="play-lobby">Play map</button>
      </div>`;
    const rb=$('#ready-btn'); if(rb) rb.addEventListener('click',()=>Api.sendWS({type:'lobby_ready', lobbyId:lobbyState.id, ready:!lobbyState.ready.includes(Api.user?Api.user.username:'')}));
    const sb=$('#start-lobby'); if(sb) sb.addEventListener('click',()=>Api.sendWS({type:'lobby_start', lobbyId:lobbyState.id}));
    const pb=$('#play-lobby'); if(pb) pb.addEventListener('click',()=>{ selectedMapId=lobbyState.mapId; navigate('game'); });
  }
  Api.onWS((msg)=>{
    if (msg.type==='lobby_list'){
      const el=$('#lobby-list'); if(!el) return;
      if (!msg.lobbies.length){ el.innerHTML='<p class="muted">No open lobbies.</p>'; return; }
      el.innerHTML=msg.lobbies.map(l=>`<div class="lobby-row"><div style="flex:1"><b>${esc(l.name)}</b><br><span class="muted">${esc(l.mapId)} · ${l.playerCount} players ${l.started?'· <span class="pill">LIVE</span>':''}</span></div><button class="btn secondary" data-join="${l.id}">Join</button></div>`).join('');
      $$('#lobby-list [data-join]').forEach(b=>b.addEventListener('click',()=>Api.sendWS({type:'lobby_join', lobbyId:Number(b.dataset.join)})));
    } else if (msg.type==='lobby_joined' || msg.type==='lobby_update'){
      lobbyState=msg.lobby; renderLobbyBox();
    } else if (msg.type==='multi_start'){
      status('Match starting! Joining map…');
      selectedMapId=msg.mapId;
      lobbyState={...lobbyState, started:true, id:msg.lobbyId};
      navigate('game');
    } else if (msg.type==='multi_score_update'){
      liveScores=msg.scores;
      const el=$('#live-box'); if(el) el.innerHTML=msg.scores.map(s=>`<div class="live-score"><span>${esc(s.username)}</span><span>${fmtInt(s.score)} · ${s.combo}x · ${fmtAcc(s.acc)}</span></div>`).join('');
    }
  });

  // ---------- LEADERBOARDS ----------
  function renderLeaderboards(){
    screenEl.innerHTML=`
      <h1>Leaderboards</h1>
      <div class="tabs">
        <div class="tab active" data-tab="global">Global</div>
        <div class="tab" data-tab="country">Country</div>
        <div class="tab" data-tab="map">Per-beatmap</div>
      </div>
      <div id="lb-content"><p class="muted">Loading…</p></div>`;
    $$('.tab').forEach(t=>t.addEventListener('click',()=>{
      $$('.tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
      loadLB(t.dataset.tab);
    }));
    loadLB('global');
  }
  async function loadLB(tab){
    const el=$('#lb-content');
    if (tab==='global'){
      const d=await Api.globalLB();
      el.innerHTML=`<div class="card"><table><tr><th>#</th><th>Player</th><th>Country</th><th>PP</th><th>Playcount</th><th>Acc</th></tr>${d.leaderboard.map(r=>`<tr><td>${r.rank}</td><td><a href="#" data-user="${r.id}" style="color:var(--accent)">${esc(r.username)}</a></td><td>${esc(r.country)}</td><td>${fmtInt(r.pp)}</td><td>${fmtInt(r.playcount)}</td><td>${fmtAcc(r.accuracy)}</td></tr>`).join('')}</table></div>`;
      $$('[data-user]',el).forEach(a=>a.addEventListener('click',e=>{e.preventDefault(); viewProfile(Number(a.dataset.user));}));
    } else if (tab==='country'){
      const d=await Api.countryLB();
      el.innerHTML=`<div class="card"><table><tr><th>#</th><th>Country</th><th>Total PP</th><th>Players</th></tr>${d.countries.map((c,i)=>`<tr><td>${i+1}</td><td>${esc(c.country)}</td><td>${fmtInt(c.pp)}</td><td>${c.players}</td></tr>`).join('')}</table></div>`;
    } else {
      el.innerHTML=`<div class="card"><label>Beatmap</label><select id="lb-map">${allMaps().map(m=>`<option value="${esc(m.id)}">${esc(m.bm.artist)} - ${esc(m.bm.title)} [${esc(m.bm.version)}]</option>`).join('')}</select><div id="lb-map-table" style="margin-top:10px"></div></div>`;
      const sel=$('#lb-map');
      const load=async()=>{ const d=await Api.mapLB(sel.value); $('#lb-map-table').innerHTML=d.scores.length?`<table><tr><th>#</th><th>Player</th><th>Score</th><th>Acc</th><th>Rank</th><th>PP</th></tr>${d.scores.map((s,i)=>`<tr><td>${i+1}</td><td>${esc(s.username)}</td><td>${fmtInt(s.score)}</td><td>${fmtAcc(s.accuracy)}</td><td>${s.rank}</td><td>${fmtInt(s.pp)}</td></tr>`).join('')}</table>`:'<p class="muted">No scores yet.</p>'; };
      sel.addEventListener('change',load); load();
    }
  }

  // ---------- PROFILE ----------
  function renderProfile(){
    const user=Api.user;
    if (!user){
      screenEl.innerHTML=`<h1>Profile</h1><div class="card"><p class="muted">You're playing as Guest. Login to view your profile, stats and friends.</p><button class="btn" id="prof-login">Login / Register</button></div>`;
      $('#prof-login').addEventListener('click',openAuth);
      return;
    }
    screenEl.innerHTML=`
      <h1>Profile</h1>
      <div class="grid2">
        <div class="card">
          <div class="row"><div class="avatar" style="background:${esc(user.avatarColor||'#ed2e7e')}">${esc(user.username[0].toUpperCase())}</div>
          <div><h2 style="margin:0">${esc(user.username)}</h2><span class="pill">${esc(user.country)}</span> <span class="pill">Lv ${user.level}</span><p class="muted" style="margin:6px 0 0">${esc(user.bio||'No bio yet.')}</p></div></div>
          <div class="stat-grid" style="margin-top:14px">
            <div class="stat"><div class="v">${fmtInt(user.pp)}</div><div class="k">Total PP</div></div>
            <div class="stat"><div class="v">${fmtInt(user.playcount)}</div><div class="k">Playcount</div></div>
            <div class="stat"><div class="v">${fmtAcc(user.accuracy)}</div><div class="k">Accuracy</div></div>
          </div>
          <label>Bio</label><textarea id="bio" rows="2">${esc(user.bio||'')}</textarea>
          <label>Country (2-letter)</label><input id="country" value="${esc(user.country)}" maxlength="2">
          <div class="row" style="margin-top:10px"><button class="btn" id="save-prof">Save</button></div>
        </div>
        <div>
          <div class="card"><h2>Top scores</h2><div id="top-scores"><p class="muted">Loading…</p></div></div>
          <div class="card" style="margin-top:12px"><h2>Friends</h2><div id="friends-box"><p class="muted">Loading…</p></div>
            <div class="row" style="margin-top:8px"><input id="friend-search" placeholder="Search players…" style="flex:1"><button class="btn secondary" id="friend-search-btn">Search</button></div>
            <div id="friend-results"></div>
          </div>
          <div class="card" style="margin-top:12px"><h2>Replays</h2><div id="replay-list"></div>
            <div class="row" style="margin-top:8px"><input type="file" id="replay-file" accept=".json" class="hidden"><button class="btn ghost" id="import-replay-btn">Import replay</button></div>
          </div>
        </div>
      </div>`;
    $('#save-prof').addEventListener('click',async()=>{ await Api.updateMe({bio:$('#bio').value, country:$('#country').value}); status('Profile saved'); renderProfile(); });
    Api.userScores(user.id).then(d=>{
      const el=$('#top-scores');
      if (!d.scores.length){ el.innerHTML='<p class="muted">No scores yet. Play something!</p>'; return; }
      el.innerHTML=`<table><tr><th>Map</th><th>Score</th><th>Acc</th><th>Rank</th><th>PP</th></tr>${d.scores.slice(0,10).map(s=>`<tr><td>${esc(s.mapTitle)} <span class="muted">${MODES[s.mode]?.name||''}</span></td><td>${fmtInt(s.score)}</td><td>${fmtAcc(s.accuracy)}</td><td>${s.rank}</td><td>${fmtInt(s.pp)}</td></tr>`).join('')}</table>`;
    });
    Api.friends().then(d=>{
      const el=$('#friends-box');
      if (!d.friends.length){ el.innerHTML='<p class="muted">No friends yet.</p>'; return; }
      el.innerHTML=d.friends.map(f=>`<div class="live-score"><span>${esc(f.username)} <span class="muted">${esc(f.country)}</span></span><button class="btn ghost" data-unfriend="${f.id}">Remove</button></div>`).join('');
      $$('[data-unfriend]',el).forEach(b=>b.addEventListener('click',async()=>{ await Api.removeFriend(Number(b.dataset.unfriend)); renderProfile(); }));
    });
    $('#friend-search-btn').addEventListener('click',async()=>{
      const q=$('#friend-search').value;
      const d=await Api.searchUsers(q);
      $('#friend-results').innerHTML=d.users.filter(u=>u.id!==user.id).map(u=>`<div class="live-score"><span>${esc(u.username)} <span class="muted">${esc(u.country)} · ${fmtInt(u.pp)}pp</span></span><span><button class="btn secondary" data-add="${u.id}">Add</button> <button class="btn ghost" data-view="${u.id}">View</button></span></div>`).join('')||'<p class="muted">No results.</p>';
      $$('#friend-results [data-add]').forEach(b=>b.addEventListener('click',async()=>{ await Api.addFriend(Number(b.dataset.add)); status('Friend added'); renderProfile(); }));
      $$('#friend-results [data-view]').forEach(b=>b.addEventListener('click',()=>viewProfile(Number(b.dataset.view))));
    });
    renderReplayList();
    $('#import-replay-btn').addEventListener('click',()=>$('#replay-file').click());
    $('#replay-file').addEventListener('change',async e=>{
      const f=e.target.files[0]; if(!f) return;
      const text=await f.text();
      try{ const d=Replay.createRecorder().importJSON(text); Replay.saveToLocalStorage(f.name.replace('.json',''), d); status('Replay imported'); renderReplayList(); }
      catch(err){ status('Import failed: '+err.message); }
    });
  }
  function renderReplayList(){
    const el=$('#replay-list'); if(!el) return;
    const names=Replay.listLocal();
    if (!names.length){ el.innerHTML='<p class="muted">No saved replays. Finish a play and save from results.</p>'; return; }
    el.innerHTML=names.map(n=>`<div class="live-score"><span>${esc(n)}</span><span><button class="btn secondary" data-watch="${esc(n)}">Watch</button> <button class="btn ghost" data-del="${esc(n)}">Delete</button></span></div>`).join('');
    $$('[data-watch]',el).forEach(b=>b.addEventListener('click',()=>{
      const d=Replay.loadFromLocalStorage(b.dataset.watch);
      if (!d) return;
      window.__watchReplay=d;
      const mapId=d.meta?.mapId;
      const m=findMap(mapId);
      if (!m){ status('Beatmap not found for replay'); return; }
      selectedMapId=m.id; selectedMods=['AP'];
      navigate('game');
      setTimeout(async ()=>{
        $('#game-overlay').style.display='none';
        cleanupGame();
        const canvas=$('#game-canvas');
        if (m.audioBlob){ try{ await AudioEngine.loadAudioFile(m.audioBlob);}catch{} }
        gameInstance=new GameEngine.Game(canvas, m.bm, { mods:['AP'], settings, replayPlayback:d, onFinish:()=>navigate('results') });
        await gameInstance.start();
      },100);
    }));
    $$('[data-del]',el).forEach(b=>b.addEventListener('click',()=>{ localStorage.removeItem('osuweb_replay_'+b.dataset.del); renderReplayList(); }));
  }
  async function viewProfile(id){
    try{
      const d=await Api.getUser(id);
      const u=d.user;
      screenEl.innerHTML=`<h1>${esc(u.username)}</h1><div class="card"><div class="row"><div class="avatar" style="background:${esc(u.avatarColor||'#ed2e7e')}">${esc(u.username[0].toUpperCase())}</div><div><span class="pill">${esc(u.country)}</span> <span class="pill">Lv ${u.level}</span><p class="muted">${esc(u.bio||'')}</p></div></div>
      <div class="stat-grid" style="margin-top:12px"><div class="stat"><div class="v">${fmtInt(u.pp)}</div><div class="k">PP</div></div><div class="stat"><div class="v">${fmtInt(u.playcount)}</div><div class="k">Plays</div></div><div class="stat"><div class="v">${fmtAcc(u.accuracy)}</div><div class="k">Acc</div></div></div>
      <h2 style="margin-top:16px">Top scores</h2>${d.scores.length?`<table><tr><th>Map</th><th>Score</th><th>Acc</th><th>Rank</th></tr>${d.scores.map(s=>`<tr><td>${esc(s.mapTitle)}</td><td>${fmtInt(s.score)}</td><td>${fmtAcc(s.accuracy)}</td><td>${s.rank}</td></tr>`).join('')}</table>`:'<p class="muted">No scores.</p>'}
      <div class="row" style="margin-top:12px"><button class="btn" id="vp-add">Add friend</button><button class="btn ghost" onclick="window.__nav('leaderboards')">Back</button></div></div>`;
      $('#vp-add').addEventListener('click',async()=>{ try{ await Api.addFriend(id); status('Friend added'); }catch(e){ status(e.message); } });
    }catch(e){ status(e.message); }
  }

  // ---------- SETTINGS ----------
  function renderSettings(){
    screenEl.innerHTML=`
      <h1>Settings</h1>
      <div class="grid2">
        <div class="card">
          <h2>Audio</h2>
          <label>Master volume <span id="vol-val">${settings.volume}</span></label>
          <input type="range" id="vol" min="0" max="1" step="0.05" value="${settings.volume}">
          <label>Audio offset (ms) — shift hit timing</label>
          <input type="number" id="offset" value="${settings.offset}">
          <label>Music volume</label><input type="range" id="music-vol" min="0" max="1" step="0.05" value="0.9">
        </div>
        <div class="card">
          <h2>Gameplay</h2>
          <label>Skin</label><select id="skin"><option value="default">Default (pink)</option><option value="triangles">Triangles</option><option value="argonian">Argonian</option></select>
          <label>Background dim</label><input type="range" id="dim" min="0" max="0.8" step="0.05" value="${settings.bgDim}">
          <p class="muted">Keys: osu! <span class="kbd">Z</span>/<span class="kbd">X</span> · Taiko <span class="kbd">D</span><span class="kbd">F</span><span class="kbd">J</span><span class="kbd">K</span> · Catch <span class="kbd">←</span><span class="kbd">→</span> · Mania 4K <span class="kbd">D</span><span class="kbd">F</span><span class="kbd">J</span><span class="kbd">K</span></p>
        </div>
        <div class="card">
          <h2>Account</h2>
          ${Api.user?`<p>Logged in as <b>${esc(Api.user.username)}</b></p><button class="btn danger" id="logout-btn">Logout</button>`:`<p class="muted">Not logged in.</p><button class="btn" id="login2">Login / Register</button>`}
        </div>
        <div class="card">
          <h2>Data</h2>
          <p class="muted">Imported beatmaps and replays are stored locally in your browser (IndexedDB + localStorage). Scores sync to the server when logged in.</p>
          <button class="btn ghost" id="clear-data">Clear local data</button>
        </div>
      </div>`;
    $('#vol').addEventListener('input',e=>{ settings.volume=Number(e.target.value); $('#vol-val').textContent=settings.volume; saveSettings(); });
    $('#offset').addEventListener('change',e=>{ settings.offset=Number(e.target.value); saveSettings(); });
    $('#skin').addEventListener('change',e=>{ settings.skin=e.target.value; saveSettings(); });
    $('#dim').addEventListener('input',e=>{ settings.bgDim=Number(e.target.value); saveSettings(); });
    const lo=$('#login2'); if(lo) lo.addEventListener('click',openAuth);
    const out=$('#logout-btn'); if(out) out.addEventListener('click',async()=>{ await Api.logout(); renderSettings(); });
    $('#clear-data').addEventListener('click',()=>{ if(confirm('Clear imported maps & replays?')){ localStorage.removeItem('osuweb_scores'); IDB.all().then(rows=>rows.forEach(r=>IDB.del(r.id))).then(()=>{ loadImported(); status('Cleared'); }); } });
  }

  // ---------- AUTH MODAL ----------
  function openAuth(){
    const bd=$('#modal-backdrop'), c=$('#modal-content');
    bd.classList.remove('hidden');
    c.innerHTML=`
      <h2>Login / Register</h2>
      <div class="tabs"><div class="tab active" data-at="login">Login</div><div class="tab" data-at="register">Register</div></div>
      <div id="auth-form">
        <label>Username</label><input id="auth-user" placeholder="username">
        <label>Password</label><input id="auth-pass" type="password" placeholder="••••••••">
        <div id="auth-country" class="hidden"><label>Country (2-letter)</label><input id="auth-cc" value="US" maxlength="2"></div>
        <p class="muted" id="auth-err" style="color:var(--bad)"></p>
        <button class="btn" id="auth-submit" style="width:100%;margin-top:8px">Login</button>
      </div>`;
    let mode='login';
    $$('.tab',c).forEach(t=>t.addEventListener('click',()=>{
      $$('.tab',c).forEach(x=>x.classList.remove('active')); t.classList.add('active');
      mode=t.dataset.at;
      $('#auth-country').classList.toggle('hidden', mode==='login');
      $('#auth-submit').textContent=mode==='login'?'Login':'Register';
    }));
    $('#auth-submit').addEventListener('click',async()=>{
      const u=$('#auth-user').value.trim(), p=$('#auth-pass').value, cc=$('#auth-cc')?.value||'US';
      try{
        if (mode==='login') await Api.login(u,p); else await Api.register(u,p,cc);
        closeModal(); status('Welcome, '+Api.user.username); navigate('menu');
      }catch(e){ $('#auth-err').textContent=e.message; }
    });
  }
  function closeModal(){ $('#modal-backdrop').classList.add('hidden'); }
  $('#modal-close').addEventListener('click',closeModal);
  $('#modal-backdrop').addEventListener('click',e=>{ if(e.target.id==='modal-backdrop') closeModal(); });
  $('#login-btn').addEventListener('click',async()=>{ if(Api.user){ await Api.logout(); status('Logged out'); } else openAuth(); });

  // ---------- CHAT ----------
  $('#chat-header').addEventListener('click',()=>{
    const m=$('#chat-messages'), r=$('#chat-input-row');
    const hidden=m.style.display==='none';
    m.style.display=hidden?'':'none'; r.style.display=hidden?'':'none';
    $('#chat-toggle').textContent=hidden?'–':'+';
  });
  function sendChat(){
    const inp=$('#chat-input'); const text=inp.value.trim(); if(!text) return;
    Api.sendWS({type:'chat', text}); inp.value='';
  }
  $('#chat-send').addEventListener('click',sendChat);
  $('#chat-input').addEventListener('keydown',e=>{ if(e.key==='Enter') sendChat(); });

  // ---------- BOOT ----------
  (async ()=>{
    await loadImported();
    AudioEngine.setVolume(settings.volume);
    Api.updateUserBox();
    Api.connectWS();
    // try restore session
    if (Api.token){ try{ await Api.me(); }catch{} }
    navigate('menu');
    status('Ready — rhythm is just a click away');
  })();
})();
