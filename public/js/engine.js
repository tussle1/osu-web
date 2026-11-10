// engine.js — core game engine for all 4 rulesets (osu!, Taiko, Catch, Mania)
const GameEngine = (() => {
  const PF_W = 512, PF_H = 384;

  function applyModsToDifficulty(bm, mods){
    let ar = bm.ar, cs = bm.cs, od = bm.od, hp = bm.hp;
    if (mods.includes('HR')) { ar = Math.min(10, ar*1.4); cs = Math.min(10, cs*1.3); od = Math.min(10, od*1.4); hp = Math.min(10, hp*1.4); }
    if (mods.includes('EZ')) { ar = Math.max(0, ar*0.5); cs = Math.max(0, cs*0.5); od = Math.max(0, od*0.5); hp = Math.max(0, hp*0.5); }
    return { ar, cs, od, hp };
  }

  class Game {
    constructor(canvas, beatmap, options={}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.bm = beatmap;
      this.mods = options.mods || [];
      this.settings = options.settings || {};
      this.onFinish = options.onFinish || (()=>{});
      this.onScoreUpdate = options.onScoreUpdate || (()=>{});
      this.replayPlayback = options.replayPlayback || null; // {events, meta}
      this.isReplay = !!this.replayPlayback;
      this.multiplayer = options.multiplayer || null; // {lobbyId, sendScore}
      this.diff = applyModsToDifficulty(beatmap, this.mods);
      this.preempt = BeatmapParser.arToPreempt(this.diff.ar);
      this.windows = BeatmapParser.odToWindows(this.diff.od);
      this.radius = BeatmapParser.csToRadius(this.diff.cs);
      this.speed = modSpeed(this.mods);
      this.playable = BeatmapParser.toPlayable(beatmap);
      // state
      this.state = 'idle'; // idle, playing, paused, finished, failed
      this.score = 0; this.combo = 0; this.maxCombo = 0;
      this.counts = { '300':0, '100':0, '50':0, miss:0 };
      this.hp = 100; this.judgements = []; // {t, text, color, x,y, life}
      this.explosions = [];
      this.cursor = { x: 256, y: 192, down:false, visible:true };
      this.catcherX = 256; this.catcherVel = 0;
      this.keysDown = new Set();
      this.sliderState = new Map(); // index -> {progress, ticksHit, headHit}
      this.spinnerState = new Map();
      this.hitDone = new Set(); // indices judged
      this.missDone = new Set();
      this.startTime = 0; this.mapTime = -2000; this.lastFrame = 0;
      this.raf = 0; this.lastScoreBroadcast = 0;
      this.recorder = Replay.createRecorder();
      this.replayIndex = 0;
      this.replayEvents = this.replayPlayback ? [...this.replayPlayback.events].sort((a,b)=>a.t-b.t) : [];
      this.replayCursor = { x:256, y:192, down:false };
      this.replayKeys = new Set();
      this.spectate = !!options.spectate;
      this.failOnMiss = this.mods.includes('SD') || this.mods.includes('PF');
      this.noFail = this.mods.includes('NF') || this.mods.includes('RX') || this.mods.includes('AP');
      this.autoplay = this.mods.includes('AP') || this.isReplay;
      this.hidden = this.mods.includes('HD');
      this.flashlight = this.mods.includes('FL');
      this.relax = this.mods.includes('RX');
      this.bindInput();
      this.resize();
    }

    bindInput(){
      this._onMouseMove = (e)=>{
        const r = this.canvas.getBoundingClientRect();
        const sx = (e.clientX - r.left) / r.width, sy = (e.clientY - r.top) / r.height;
        this.cursor.x = sx * PF_W; this.cursor.y = sy * PF_H;
        if (!this.autoplay && this.state==='playing') this.recorder.record({t:this.mapTime, type:'move', x:this.cursor.x, y:this.cursor.y});
        if (this.bm.mode===2 && !this.autoplay) this.catcherX = this.cursor.x;
      };
      this._onMouseDown = (e)=>{
        if (this.state!=='playing') return;
        this.cursor.down = true;
        if (!this.autoplay) this.recorder.record({t:this.mapTime, type:'click', x:this.cursor.x, y:this.cursor.y, down:true});
        this.handlePress(this.cursor.x, this.cursor.y);
      };
      this._onMouseUp = ()=>{
        this.cursor.down=false;
        if (this.state==='playing' && !this.autoplay) this.recorder.record({t:this.mapTime, type:'click', x:this.cursor.x, y:this.cursor.y, down:false});
        this.handleRelease();
      };
      this._onKeyDown = (e)=>{
        if (this.state!=='playing') return;
        const k = e.key.toLowerCase();
        if (e.repeat) return;
        this.keysDown.add(k);
        if (!this.autoplay) this.recorder.record({t:this.mapTime, type:'key', key:k, down:true});
        this.handleKey(k, true);
        if (['arrowleft','arrowright','arrowup','arrowdown',' '].includes(k)) e.preventDefault();
      };
      this._onKeyUp = (e)=>{
        const k = e.key.toLowerCase();
        this.keysDown.delete(k);
        if (this.state==='playing' && !this.autoplay) this.recorder.record({t:this.mapTime, type:'key', key:k, down:false});
        this.handleKey(k, false);
      };
      this.canvas.addEventListener('mousemove', this._onMouseMove);
      this.canvas.addEventListener('mousedown', this._onMouseDown);
      window.addEventListener('mouseup', this._onMouseUp);
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
      this._onResize = ()=>this.resize();
      window.addEventListener('resize', this._onResize);
    }
    destroy(){
      cancelAnimationFrame(this.raf);
      this.canvas.removeEventListener('mousemove', this._onMouseMove);
      this.canvas.removeEventListener('mousedown', this._onMouseDown);
      window.removeEventListener('mouseup', this._onMouseUp);
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
      window.removeEventListener('resize', this._onResize);
      AudioEngine.stopMusic();
    }
    resize(){
      const dpr = Math.min(2, window.devicePixelRatio||1);
      const w = this.canvas.clientWidth || 960, h = this.canvas.clientHeight || 540;
      this.canvas.width = w*dpr; this.canvas.height = h*dpr;
      this.ctx.setTransform(dpr,0,0,dpr,0,0);
      this.viewW = w; this.viewH = h;
    }

    async start(){
      this.recorder.start();
      this.state='playing';
      this.mapTime = -2000; // countdown
      this.startTime = performance.now();
      // audio: start from -2000 (lead-in). AudioEngine plays from 0; we offset.
      // For simplicity, start audio at 0 and use mapTime = audioTime - 2000? Instead start audio immediately and mapTime tracks audio.
      // We'll start audio at 0 and set mapTime = audioTime.
      AudioEngine.ensureCtx();
      // If beatmap has audio buffer loaded externally, it will play; else procedural.
      AudioEngine.playMusic(0, this.bm.bpm, this.speed);
      this.lastFrame = performance.now();
      const loop = (now)=>{
        if (this.state!=='playing' && this.state!=='paused') return;
        if (this.state==='paused'){ this.raf=requestAnimationFrame(loop); return; }
        const dt = Math.min(50, now - this.lastFrame); this.lastFrame = now;
        this.update(dt);
        this.render();
        // multiplayer broadcast
        if (this.multiplayer && now - this.lastScoreBroadcast > 500){
          this.lastScoreBroadcast = now;
          this.multiplayer.sendScore(this.score, this.combo, this.accuracy());
        }
        if (this.onScoreUpdate) this.onScoreUpdate(this);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
      this.render();
    }
    pause(){
      if (this.state!=='playing') return;
      this.state='paused';
      AudioEngine.pauseMusic();
    }
    resume(){
      if (this.state!=='paused') return;
      this.state='playing';
      AudioEngine.playMusic(AudioEngine.currentMapTime(), this.bm.bpm, this.speed);
      this.lastFrame = performance.now();
    }
    stop(){
      this.state='finished';
      cancelAnimationFrame(this.raf);
      AudioEngine.stopMusic();
    }

    accuracy(){
      const c=this.counts, total=c['300']+c['100']+c['50']+c.miss;
      if(!total) return 100;
      return ((c['300']*300 + c['100']*100 + c['50']*50) / (total*300))*100;
    }
    totalObjects(){ return this.playable.length; }
    judgedCount(){ return this.counts['300']+this.counts['100']+this.counts['50']+this.counts.miss; }
    progress(){ return this.totalObjects()? this.judgedCount()/this.totalObjects() : 0; }

    addJudgement(text, color, x=256, y=192){
      this.judgements.push({text, color, x, y, life:1, t:this.mapTime});
      if (this.judgements.length>12) this.judgements.shift();
    }
    explode(x,y,color){ this.explosions.push({x,y,color,life:1}); if(this.explosions.length>30) this.explosions.shift(); }

    applyHit(kind, obj){
      // kind: '300'|'100'|'50'|'miss'
      if (kind==='miss'){
        this.counts.miss++; this.combo=0;
        this.hp = clamp(this.hp - (2 + this.diff.hp*0.4), 0, 100);
        AudioEngine.hitSound('miss');
        this.addJudgement('MISS', '#f87171', obj?obj.x:256, obj?obj.y:192);
        if (this.failOnMiss && !this.noFail) this.fail();
        if (this.hp<=0 && !this.noFail) this.fail();
        return;
      }
      this.counts[kind]++;
      this.combo++; this.maxCombo=Math.max(this.maxCombo,this.combo);
      const base = kind==='300'?300:kind==='100'?100:50;
      const mult = 1 + this.combo*0.02;
      this.score += Math.round(base * mult * modMult(this.mods));
      const hpGain = kind==='300'?2.2:kind==='100'?1.2:0.5;
      this.hp = clamp(this.hp + hpGain - 0.15, 0, 100);
      const color = kind==='300'?'#6ee7ff':kind==='100'?'#4ade80':'#fbbf24';
      const label = kind==='300'?'300':kind==='100'?'100':'50';
      this.addJudgement(label, color, obj?obj.x:256, obj?obj.y:192);
      if (obj) this.explode(obj.x, obj.y, color);
      AudioEngine.hitSound('hit');
    }
    fail(){
      if (this.state!=='playing') return;
      this.state='failed';
      AudioEngine.stopMusic();
      this.onFinish(this.results(false));
    }
    results(passed){
      const acc=this.accuracy();
      const rank = passed ? rankFor(acc, this.counts.miss, this.mods) : 'F';
      const pp = this.estimatePP(passed);
      return {
        score:this.score, maxCombo:this.maxCombo, counts:{...this.counts}, accuracy:acc, rank, pp,
        passed, mods:this.mods.join(''), mode:this.bm.mode, mapId:this.bm.id||'unknown',
        mapTitle:this.bm.title, mapArtist:this.bm.artist, mapVersion:this.bm.version,
        replayEvents: this.autoplay? [] : this.recorder.stop(),
        totalObjects:this.totalObjects()
      };
    }
    estimatePP(passed){
      if (!passed) return 0;
      const acc=this.accuracy()/100;
      const stars=this.bm.starDifficulty||2;
      const base = 20 * Math.pow(stars, 1.6) * Math.pow(acc, 8) * (1 + this.maxCombo/500);
      return Math.round(base * modMult(this.mods));
    }

    update(dt){
      // map time from audio clock (ms), minus user audio offset
      this.mapTime = AudioEngine.currentMapTime() - (this.settings.offset || 0);
      // replay playback: apply events
      if (this.autoplay && this.replayEvents.length){
        while (this.replayIndex < this.replayEvents.length && this.replayEvents[this.replayIndex].t <= this.mapTime){
          const ev = this.replayEvents[this.replayIndex++];
          if (ev.type==='move'){ this.cursor.x=ev.x; this.cursor.y=ev.y; if(this.bm.mode===2) this.catcherX=ev.x; }
          else if (ev.type==='click'){ this.cursor.x=ev.x; this.cursor.y=ev.y; if(ev.down){ this.cursor.down=true; this.handlePress(ev.x,ev.y,true);} else { this.cursor.down=false; this.handleRelease(true);} }
          else if (ev.type==='key'){ if(ev.down){ this.replayKeys.add(ev.key); this.handleKey(ev.key,true,true);} else { this.replayKeys.delete(ev.key); this.handleKey(ev.key,false,true);} }
        }
      }
      // HP drain over time
      const drainPerSec = 0.8 + this.diff.hp*0.25;
      this.hp = clamp(this.hp - drainPerSec*dt/1000, 0, 100);
      if (this.hp<=0 && !this.noFail && this.mapTime>0) { this.fail(); return; }
      // per-mode updates
      if (this.bm.mode===0) this.updateOsu(dt);
      else if (this.bm.mode===1) this.updateTaiko(dt);
      else if (this.bm.mode===2) this.updateCatch(dt);
      else if (this.bm.mode===3) this.updateMania(dt);
      // judgements decay
      this.judgements.forEach(j=>j.life-=dt/600);
      this.judgements=this.judgements.filter(j=>j.life>0);
      this.explosions.forEach(e=>e.life-=dt/400);
      this.explosions=this.explosions.filter(e=>e.life>0);
      // finish check
      const end = this.bm.length + 2000;
      if (this.mapTime > end){
        this.state='finished';
        AudioEngine.stopMusic();
        this.onFinish(this.results(true));
      }
    }

    // ---------- input dispatch ----------
    handlePress(x,y, isReplay=false){
      if (this.bm.mode===0) this.osuPress(x,y);
      else if (this.bm.mode===1) { /* taiko uses keys; mouse = don */ this.taikoPress(true); }
      else if (this.bm.mode===2) { /* catch uses move */ }
      else if (this.bm.mode===3) { /* mania uses keys */ }
    }
    handleRelease(){ if (this.bm.mode===1) this.taikoPress(false); }
    handleKey(k, down, isReplay=false){
      if (this.bm.mode===1) this.taikoKey(k, down);
      else if (this.bm.mode===2) this.catchKey(k, down);
      else if (this.bm.mode===3) this.maniaKey(k, down);
      else if (this.bm.mode===0) {
        // Z/X as click
        if (down && (k==='z'||k==='x')) this.osuPress(this.cursor.x, this.cursor.y);
      }
    }

    // ---------- OSU! ----------
    osuPress(x,y){
      if (this.state!=='playing') return;
      // find nearest hittable circle/slider head within window
      let best=null, bestIdx=-1, bestDt=1e9;
      for (let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (this.hitDone.has(i)) continue;
        if (o.kind==='spinner') continue;
        const dt = this.mapTime - o.time;
        if (dt < -this.windows.w50) continue;
        if (dt > this.windows.w50) continue;
        const d = Math.hypot(x-o.x, y-o.y);
        if (d > this.radius*1.4) continue;
        if (Math.abs(dt) < Math.abs(bestDt)){ best=o; bestIdx=i; bestDt=dt; }
      }
      if (best){
        const adt=Math.abs(bestDt);
        const kind = adt<=this.windows.w300?'300':adt<=this.windows.w100?'100':'50';
        this.hitDone.add(bestIdx);
        this.applyHit(kind, best);
        if (best.kind==='slider'){
          this.sliderState.set(bestIdx, { headHit:true, progress:0, ticks:0 });
        }
      }
    }
    updateOsu(dt){
      // auto-miss overdue
      for (let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (this.hitDone.has(i) || this.missDone.has(i)) continue;
        if (o.kind==='spinner'){
          if (this.mapTime > o.endTime && !this.spinnerState.has(i)){ this.missDone.add(i); this.applyHit('miss', o); }
          continue;
        }
        if (o.kind==='slider'){
          const st=this.sliderState.get(i);
          if (st && st.headHit){
            // follow: check cursor near ball
            const ball=this.sliderBall(o, this.mapTime);
            const d=Math.hypot(this.cursor.x-ball.x, this.cursor.y-ball.y);
            const following = d < this.radius*1.2 || this.autoplay;
            if (following){
              st.progress = clamp((this.mapTime - o.time)/(o.endTime - o.time), 0, 1);
              if (Math.random()<0.1) AudioEngine.hitSound('slider');
            } else {
              // break combo slightly? count as miss if far for long? simplified: miss slider
              if (this.mapTime > o.time + (o.endTime-o.time)*0.5 && !st.broken){
                st.broken=true; this.applyHit('miss', o); this.missDone.add(i);
              }
            }
            if (this.mapTime >= o.endTime && !this.missDone.has(i)){
              this.hitDone.add(i);
              // slider complete: give 100 if followed most of way
              if (!st.broken) this.applyHit(st.progress>0.7?'300':'100', o);
            }
          } else if (this.mapTime > o.time + this.windows.w50){
            this.missDone.add(i); this.applyHit('miss', o);
          }
        } else { // circle
          if (this.mapTime > o.time + this.windows.w50){
            this.missDone.add(i); this.applyHit('miss', o);
          }
        }
      }
      // spinners: track rotation
      for (let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (o.kind!=='spinner') continue;
        if (this.mapTime < o.time || this.mapTime > o.endTime) continue;
        let st=this.spinnerState.get(i);
        if (!st){ st={angle:Math.atan2(this.cursor.y-192,this.cursor.x-256), rot:0, lastAngle:0}; this.spinnerState.set(i,st); st.lastAngle=st.angle; }
        const ang=Math.atan2(this.cursor.y-192,this.cursor.x-256);
        let delta=ang-st.lastAngle;
        if (delta>Math.PI) delta-=2*Math.PI; if (delta<-Math.PI) delta+=2*Math.PI;
        st.rot+=Math.abs(delta); st.lastAngle=ang;
        const needed = (o.endTime-o.time)/1000 * 1.2; // rotations needed (radians ~ 2pi per rot)
        if (st.rot >= needed*2*Math.PI*0.5 && !this.hitDone.has(i)){
          this.hitDone.add(i); this.applyHit('300', o);
        }
      }
    }
    sliderBall(o, time){
      const path=BeatmapParser.sliderPath(o);
      const dur=o.endTime-o.time;
      let p=dur>0? clamp((time-o.time)/dur,0,1):0;
      // ping-pong for repeats
      const rep=o.repeat||1;
      const cycle=p*rep;
      const frac=cycle%1;
      const dir=Math.floor(cycle)%2===0? frac : 1-frac;
      const idx=clamp(Math.floor(dir*(path.length-1)),0,path.length-1);
      return path[idx];
    }

    // ---------- TAIKO ----------
    taikoKey(k, down){
      if (!down) return;
      const donKeys=['d','j','arrowleft','arrowdown','z','x'];
      const kaKeys=['f','k','arrowright','arrowup','c','v'];
      if (donKeys.includes(k)) this.taikoPress(true);
      else if (kaKeys.includes(k)) this.taikoPress(false);
    }
    taikoPress(isDon){
      if (this.state!=='playing') return;
      let best=null,bestIdx=-1,bestDt=1e9;
      for(let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (this.hitDone.has(i)||this.missDone.has(i)) continue;
        const dt=this.mapTime-o.time;
        if (dt<-this.windows.w50||dt>this.windows.w50) continue;
        if (Math.abs(dt)<Math.abs(bestDt)){ best=o; bestIdx=i; bestDt=dt; }
      }
      if (best){
        if (best.isDon===isDon){
          const adt=Math.abs(bestDt);
          const kind=adt<=this.windows.w300?'300':adt<=this.windows.w100?'100':'50';
          this.hitDone.add(bestIdx); this.applyHit(kind,best);
          AudioEngine.hitSound(isDon?'don':'ka');
        } else {
          // wrong colour: count as miss? small penalty
          this.addJudgement('WRONG', '#fbbf24', 100, 192);
        }
      }
    }
    updateTaiko(dt){
      for(let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (this.hitDone.has(i)||this.missDone.has(i)) continue;
        if (o.isSlider){
          if (this.mapTime>o.endTime){ this.hitDone.add(i); this.applyHit('300',o); }
          continue;
        }
        if (this.mapTime>o.time+this.windows.w50){ this.missDone.add(i); this.applyHit('miss',o); }
      }
    }

    // ---------- CATCH ----------
    catchKey(k, down){
      if (!down) return;
      if (k==='arrowleft'||k==='a') this.catcherVel=-600;
      if (k==='arrowright'||k==='d') this.catcherVel=600;
    }
    updateCatch(dt){
      // keyboard movement
      if (this.keysDown.has('arrowleft')||this.keysDown.has('a')) this.catcherX-=600*dt/1000;
      if (this.keysDown.has('arrowright')||this.keysDown.has('d')) this.catcherX+=600*dt/1000;
      this.catcherX=clamp(this.catcherX, 30, 482);
      const catchY=330;
      for(let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (this.hitDone.has(i)||this.missDone.has(i)) continue;
        // fruit falls from y=0 to catchY over preempt time before hit time? Use time-based: fruit visible preempt before, reaches catch at o.time
        const fallDur=this.preempt;
        const y = catchY - (o.time - this.mapTime)/fallDur * catchY;
        if (this.mapTime>=o.time){
          const d=Math.abs(this.catcherX - o.x);
          if (d<45){ this.hitDone.add(i); this.applyHit('300',o); }
          else { this.missDone.add(i); this.applyHit('miss',o); }
        }
      }
    }

    // ---------- MANIA ----------
    maniaKey(k, down){
      if (this.bm.mode!==3) return;
      const keys=this.playable[0]?.keys||4;
      const map4=['d','f','j','k'];
      const map5=['d','f',' ','j','k'];
      const map6=['s','d','f','j','k','l'];
      const map7=['s','d','f',' ','j','k','l'];
      const map8=['s','d','f','g','h','j','k','l'];
      const map10=['a','s','d','f','g','h','j','k','l',';'];
      let map=map4;
      if(keys===5)map=map5; else if(keys===6)map=map6; else if(keys===7)map=map7; else if(keys===8)map=map8; else if(keys>=9)map=map10;
      const lane=map.indexOf(k);
      if (lane<0) return;
      if (down) this.maniaPress(lane);
      else this.maniaRelease(lane);
    }
    maniaPress(lane){
      if (this.state!=='playing') return;
      let best=null,bestIdx=-1,bestDt=1e9;
      for(let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (o.lane!==lane) continue;
        if (this.hitDone.has(i)||this.missDone.has(i)) continue;
        const dt=this.mapTime-o.time;
        if (dt<-this.windows.w50||dt>this.windows.w50) continue;
        if (Math.abs(dt)<Math.abs(bestDt)){ best=o; bestIdx=i; bestDt=dt; }
      }
      if (best){
        const adt=Math.abs(bestDt);
        const kind=adt<=this.windows.w300?'300':adt<=this.windows.w100?'100':'50';
        if (best.kind==='hold'){
          this.sliderState.set(bestIdx,{headHit:true, lane, holding:true});
          // head judged on release/end; store pending
          this.hitDone.add(bestIdx);
          this.applyHit(kind,best);
        } else {
          this.hitDone.add(bestIdx); this.applyHit(kind,best);
        }
      }
    }
    maniaRelease(lane){
      // holds: if released early, break (simplified: no extra penalty)
    }
    updateMania(dt){
      for(let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (this.hitDone.has(i)||this.missDone.has(i)) continue;
        if (this.mapTime>o.time+this.windows.w50){ this.missDone.add(i); this.applyHit('miss',o); }
      }
    }

    // ---------- RENDER ----------
    render(){
      const ctx=this.ctx, W=this.viewW, H=this.viewH;
      ctx.clearRect(0,0,W,H);
      // background
      const grad=ctx.createLinearGradient(0,0,0,H);
      grad.addColorStop(0,'#0a0a14'); grad.addColorStop(1,'#141428');
      ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);
      // playfield transform: scale PF to fit
      const scale=Math.min(W/PF_W, H/PF_H)*0.92;
      const ox=(W-PF_W*scale)/2, oy=(H-PF_H*scale)/2;
      ctx.save(); ctx.translate(ox,oy); ctx.scale(scale,scale);
      // playfield bg
      ctx.fillStyle='rgba(255,255,255,0.04)'; ctx.fillRect(0,0,PF_W,PF_H);
      ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.strokeRect(0,0,PF_W,PF_H);
      if (this.bm.mode===0) this.renderOsu(ctx);
      else if (this.bm.mode===1) this.renderTaiko(ctx);
      else if (this.bm.mode===2) this.renderCatch(ctx);
      else if (this.bm.mode===3) this.renderMania(ctx);
      ctx.restore();
      // flashlight mask
      if (this.flashlight){
        ctx.save();
        ctx.fillStyle='rgba(0,0,0,0.92)';
        ctx.beginPath();
        ctx.rect(0,0,W,H);
        ctx.arc(W/2,H/2,180,0,Math.PI*2,true);
        ctx.fill('evenodd');
        ctx.restore();
      }
      // hidden fade: objects fade out near hit time (handled per-object alpha)
      this.renderHUD(ctx,W,H);
    }
    renderOsu(ctx){
      const now=this.mapTime;
      // sliders first (under circles)
      for(let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (o.kind!=='slider') continue;
        if (this.hitDone.has(i)&&this.missDone.has(i)) continue;
        if (now < o.time - this.preempt || now > o.endTime+300) continue;
        if (this.missDone.has(i)) continue;
        const alpha=this.approachAlpha(o.time);
        if (alpha<=0) continue;
        const path=BeatmapParser.sliderPath(o);
        ctx.save(); ctx.globalAlpha=alpha*0.9;
        ctx.strokeStyle='#ed2e7e'; ctx.lineWidth=this.radius*0.5; ctx.lineCap='round'; ctx.lineJoin='round';
        ctx.beginPath();
        path.forEach((p,idx)=>{ if(idx===0)ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); });
        ctx.stroke();
        // reverse arrows
        ctx.fillStyle='#fff';
        ctx.beginPath(); ctx.arc(o.x,o.y,this.radius*0.45,0,Math.PI*2); ctx.fill();
        ctx.restore();
        // ball
        if (now>=o.time && now<=o.endTime){
          const ball=this.sliderBall(o,now);
          ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(ball.x,ball.y,this.radius*0.55,0,Math.PI*2); ctx.fill();
          ctx.strokeStyle='#ed2e7e'; ctx.lineWidth=3; ctx.stroke();
        }
      }
      // circles + spinners
      for(let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (o.kind==='slider') continue;
        if (o.kind==='spinner'){
          if (now<o.time||now>o.endTime) continue;
          const p=(now-o.time)/(o.endTime-o.time);
          ctx.save(); ctx.globalAlpha=0.9;
          ctx.strokeStyle='#6ee7ff'; ctx.lineWidth=8;
          ctx.beginPath(); ctx.arc(256,192,90,0,Math.PI*2); ctx.stroke();
          ctx.fillStyle='#fff'; ctx.font='bold 28px sans-serif'; ctx.textAlign='center';
          ctx.fillText(Math.round((1-p)*100)+'%',256,192);
          // progress arc
          ctx.strokeStyle='#ed2e7e'; ctx.beginPath(); ctx.arc(256,192,90,-Math.PI/2,-Math.PI/2+p*Math.PI*2); ctx.stroke();
          ctx.restore();
          continue;
        }
        if (this.hitDone.has(i)||this.missDone.has(i)) continue;
        if (now < o.time - this.preempt || now > o.time + this.windows.w50) continue;
        const alpha=this.approachAlpha(o.time);
        if (alpha<=0) continue;
        ctx.save(); ctx.globalAlpha=alpha;
        // approach circle
        const tLeft=o.time-now;
        if (tLeft>0){
          const r=this.radius + (tLeft/this.preempt)*this.radius*2;
          ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=2;
          ctx.beginPath(); ctx.arc(o.x,o.y,r,0,Math.PI*2); ctx.stroke();
        }
        ctx.fillStyle='#ed2e7e'; ctx.beginPath(); ctx.arc(o.x,o.y,this.radius,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(o.x,o.y,this.radius*0.55,0,Math.PI*2); ctx.fill();
        ctx.restore();
      }
      // cursor
      if (!this.autoplay || this.isReplay){
        ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(this.cursor.x,this.cursor.y,6,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='#ed2e7e'; ctx.lineWidth=2; ctx.stroke();
      }
    }
    approachAlpha(hitTime){
      const now=this.mapTime;
      const fadeIn=this.preempt*0.4;
      if (this.hidden){
        // hidden: fade out in last 30% before hit
        const tLeft=hitTime-now;
        if (tLeft>this.preempt) return 0;
        if (tLeft<0) return 1;
        const p=1-tLeft/this.preempt;
        if (p>0.7) return clamp(1-(p-0.7)/0.3,0,1);
        return clamp(p/0.3,0,1);
      }
      if (now < hitTime - this.preempt) return 0;
      if (now < hitTime - this.preempt + fadeIn) return (now-(hitTime-this.preempt))/fadeIn;
      return 1;
    }
    renderTaiko(ctx){
      const now=this.mapTime;
      const judgeX=100, laneY=192;
      // track
      ctx.fillStyle='rgba(255,255,255,0.06)'; ctx.fillRect(0,laneY-40,PF_W,80);
      ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.strokeRect(0,laneY-40,PF_W,80);
      // judgement circle
      ctx.strokeStyle='#fff'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(judgeX,laneY,34,0,Math.PI*2); ctx.stroke();
      // notes: scroll speed: 1 beat = 150px
      const beatLen=60000/(this.bm.bpm||120);
      const pxPerMs=150/beatLen;
      for(let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (this.hitDone.has(i)||this.missDone.has(i)) continue;
        const dt=o.time-now;
        if (dt>2000||dt<-300) continue;
        const x=judgeX + dt*pxPerMs;
        if (x<0||x>PF_W) continue;
        const isDon=o.isDon!==false;
        const r=o.big?30:22;
        ctx.fillStyle=isDon?'#ef4444':'#3b82f6';
        ctx.beginPath(); ctx.arc(x,laneY,r,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(x,laneY,r*0.55,0,Math.PI*2); ctx.fill();
        if (o.big){ ctx.strokeStyle='#fde047'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(x,laneY,r+4,0,Math.PI*2); ctx.stroke(); }
      }
      // drum hint
      ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.font='12px sans-serif'; ctx.textAlign='center';
      ctx.fillText('D / J = Don (red)   F / K = Ka (blue)', 256, 300);
    }
    renderCatch(ctx){
      const now=this.mapTime;
      const catchY=330;
      // fruits
      for(let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (this.hitDone.has(i)||this.missDone.has(i)) continue;
        const fallDur=this.preempt;
        const dt=o.time-now;
        if (dt>fallDur||dt<-200) continue;
        const y=catchY - dt/fallDur*catchY;
        const colors=['#f87171','#fbbf24','#4ade80','#60a5fa','#c084fc'];
        ctx.fillStyle=colors[i%colors.length];
        ctx.beginPath(); ctx.arc(o.x,y,14,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(o.x-4,y-4,4,0,Math.PI*2); ctx.fill();
      }
      // catcher
      ctx.fillStyle='#22c55e';
      ctx.beginPath();
      ctx.moveTo(this.catcherX-45,catchY); ctx.lineTo(this.catcherX+45,catchY); ctx.lineTo(this.catcherX+30,catchY+22); ctx.lineTo(this.catcherX-30,catchY+22); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#fff'; ctx.font='12px sans-serif'; ctx.textAlign='center';
      ctx.fillText('← → or mouse to move',256,370);
    }
    renderMania(ctx){
      const now=this.mapTime;
      const keys=this.playable[0]?.keys||4;
      const laneW=PF_W/keys;
      const judgeY=320;
      // lanes
      for(let k=0;k<keys;k++){
        ctx.fillStyle=k%2?'rgba(255,255,255,0.03)':'rgba(255,255,255,0.06)';
        ctx.fillRect(k*laneW,0,laneW,PF_H);
        ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.strokeRect(k*laneW,0,laneW,PF_H);
      }
      // judgement line
      ctx.fillStyle='#fff'; ctx.fillRect(0,judgeY,PF_W,3);
      const fallDur=this.preempt;
      for(let i=0;i<this.playable.length;i++){
        const o=this.playable[i];
        if (this.hitDone.has(i)||this.missDone.has(i)) continue;
        const dt=o.time-now;
        if (dt>fallDur||dt<-200) continue;
        const y=judgeY - dt/fallDur*(judgeY-20);
        const x=o.lane*laneW+laneW/2;
        if (o.kind==='hold'){
          const y2=judgeY - (o.endTime-now)/fallDur*(judgeY-20);
          ctx.fillStyle='#8b5cf6'; ctx.fillRect(x-14,Math.min(y,y2),28,Math.abs(y2-y));
        }
        ctx.fillStyle='#fff'; ctx.fillRect(x-16,y-8,32,16);
        ctx.fillStyle='#8b5cf6'; ctx.fillRect(x-16,y-8,32,4);
      }
      // key labels
      const labels={4:['D','F','J','K'],5:['D','F','SPACE','J','K'],6:['S','D','F','J','K','L'],7:['S','D','F','SPACE','J','K','L'],8:['S','D','F','G','H','J','K','L']}[keys]||[];
      ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.font='bold 12px sans-serif'; ctx.textAlign='center';
      labels.forEach((l,k)=>ctx.fillText(l,k*laneW+laneW/2,360));
    }
    renderHUD(ctx,W,H){
      ctx.save();
      ctx.fillStyle='#fff'; ctx.textAlign='left'; ctx.font='800 22px sans-serif';
      ctx.fillText(fmtInt(this.score), 16, 34);
      ctx.font='700 16px sans-serif'; ctx.fillStyle='#6ee7ff';
      ctx.fillText(this.combo+'x', 16, 58);
      ctx.fillStyle='#fff'; ctx.font='700 14px sans-serif';
      ctx.fillText(fmtAcc(this.accuracy()), 16, 80);
      // HP bar
      ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillRect(16,90,220,12);
      const hpCol=this.hp>50?'#4ade80':this.hp>25?'#fbbf24':'#f87171';
      ctx.fillStyle=hpCol; ctx.fillRect(16,90,220*this.hp/100,12);
      ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.strokeRect(16,90,220,12);
      // progress
      ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillRect(W-236,90,220,8);
      ctx.fillStyle='#ed2e7e'; ctx.fillRect(W-236,90,220*this.progress(),8);
      // judgements
      ctx.textAlign='center';
      this.judgements.forEach((j,idx)=>{
        ctx.globalAlpha=clamp(j.life,0,1);
        ctx.fillStyle=j.color; ctx.font='900 20px sans-serif';
        // map playfield coords to screen: approximate center
        ctx.fillText(j.text, W/2, 120+idx*22);
      });
      ctx.globalAlpha=1;
      // countdown
      if (this.mapTime<0){
        ctx.fillStyle='#fff'; ctx.font='900 48px sans-serif'; ctx.textAlign='center';
        ctx.fillText(Math.ceil(-this.mapTime/1000), W/2, H/2);
      }
      ctx.restore();
    }
  }

  return { Game, PF_W, PF_H };
})();
