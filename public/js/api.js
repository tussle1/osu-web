// api.js — REST + WebSocket client with offline fallback (localStorage)
const Api = (() => {
  let token = localStorage.getItem('osuweb_token') || '';
  let user = JSON.parse(localStorage.getItem('osuweb_user') || 'null');
  let ws = null, wsHandlers = [], wsConnected = false;

  async function req(method, path, body) {
    const opts = { method, headers: { 'Content-Type':'application/json' } };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(data.error || ('HTTP '+res.status));
    return data;
  }
  function setAuth(t, u){ token=t||''; user=u||null; localStorage.setItem('osuweb_token', token); localStorage.setItem('osuweb_user', JSON.stringify(user)); updateUserBox(); }
  function updateUserBox(){
    const el = $('#user-label'); if(!el) return;
    el.textContent = user ? user.username : 'Guest';
    const btn = $('#login-btn'); if(btn) btn.textContent = user ? 'Logout' : 'Login';
    const dot = $('#conn-dot'); if(dot) dot.className = wsConnected ? 'on' : '';
  }
  function connectWS(){
    try{
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${location.host}/ws${token?('?token='+encodeURIComponent(token)):''}`;
      ws = new WebSocket(url);
      ws.onopen = ()=>{ wsConnected=true; updateUserBox(); status('Connected'); };
      ws.onclose = ()=>{ wsConnected=false; updateUserBox(); setTimeout(connectWS, 3000); };
      ws.onmessage = (ev)=>{
        let msg; try{ msg=JSON.parse(ev.data); }catch{ return; }
        wsHandlers.forEach(h=>{ try{h(msg);}catch(e){console.error(e);} });
        if (msg.type==='chat') addChat(msg.username, msg.text);
        if (msg.type==='welcome') status('Welcome, '+msg.username);
      };
    }catch(e){ console.warn('WS connect failed', e); }
  }
  function onWS(fn){ wsHandlers.push(fn); }
  function sendWS(obj){ if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

  // offline local scores fallback
  function localScores(){ return JSON.parse(localStorage.getItem('osuweb_scores')||'[]'); }
  function saveLocalScore(s){ const a=localScores(); a.push(s); localStorage.setItem('osuweb_scores', JSON.stringify(a.slice(-500))); }

  return {
    get token(){ return token; }, get user(){ return user; },
    setAuth, updateUserBox, connectWS, onWS, sendWS,
    async register(username,password,country){ const d=await req('POST','/api/auth/register',{username,password,country}); setAuth(d.token,d.user); connectWS(); return d; },
    async login(username,password){ const d=await req('POST','/api/auth/login',{username,password}); setAuth(d.token,d.user); connectWS(); return d; },
    async logout(){ try{ await req('POST','/api/auth/logout'); }catch{} setAuth('',''); connectWS(); },
    async me(){ const d=await req('GET','/api/auth/me'); setAuth(token, d.user); return d; },
    async updateMe(patch){ const d=await req('PUT','/api/users/me',patch); setAuth(token,d.user); return d; },
    async searchUsers(q){ try{ return await req('GET','/api/users/search?q='+encodeURIComponent(q)); }catch{ return { users: [] }; } },
    async getUser(id){ return req('GET','/api/users/'+id); },
    async globalLB(mode){ try{ return await req('GET','/api/leaderboard/global'+(mode!==undefined?('?mode='+mode):'')); }catch{ return { leaderboard: [] }; } },
    async countryLB(){ try{ return await req('GET','/api/leaderboard/country'); }catch{ return { countries: [] }; } },
    async mapLB(mapId){ try{ return await req('GET','/api/leaderboard/map/'+encodeURIComponent(mapId)); }catch{ return { scores: [] }; } },
    async submitScore(payload){
      saveLocalScore({...payload, createdAt: Date.now(), username: user?user.username:'Guest'});
      try{ const d=await req('POST','/api/scores',payload); if(d.user) setAuth(token,d.user); return d; }
      catch(e){ return { offline:true, error:e.message }; }
    },
    async userScores(id){ try{ return await req('GET','/api/scores/user/'+id); }catch{ return { scores: localScores().filter(s=>s.username===(user?user.username:'')) }; } },
    async friends(){ try{ return await req('GET','/api/friends'); }catch{ return { friends: [] }; } },
    async addFriend(friendId){ return req('POST','/api/friends',{friendId}); },
    async removeFriend(id){ return req('DELETE','/api/friends/'+id); },
    async beatmaps(){ try{ return await req('GET','/api/beatmaps'); }catch{ return { beatmaps: [] }; } },
    async registerBeatmap(b){ try{ return await req('POST','/api/beatmaps',b); }catch{ return null; } },
    localScores,
  };
})();

function addChat(who, text){
  const box = $('#chat-messages'); if(!box) return;
  const div = document.createElement('div');
  div.innerHTML = `<span class="who">${esc(who)}:</span> ${esc(text)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  while(box.children.length>100) box.removeChild(box.firstChild);
}
