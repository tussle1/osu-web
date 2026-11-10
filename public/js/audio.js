// audio.js — WebAudio engine: procedural music for built-in maps + imported audio + hitsounds
const AudioEngine = (() => {
  let ctx = null, master = null, musicGain = null, sfxGain = null;
  let musicSource = null, musicStartCtxTime = 0, musicStartMapTime = 0, musicDuration = 0;
  let musicBuffer = null, musicPlaying = false, musicPausedAt = 0;
  let currentMapTimeOffset = 0; // map time = (ctx.currentTime - start)*1000 + offset
  let volume = 0.8, sfxVolume = 1.0, muted = false;
  let proceduralTimer = null, proceduralStep = 0, proceduralBpm = 120, proceduralStart = 0, proceduralNextNoteTime = 0;
  let musicSpeed = 1;

  function ensureCtx(){
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = muted?0:volume; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.9; musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.gain.value = sfxVolume; sfxGain.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function setVolume(v){ volume = clamp(v,0,1); if(master) master.gain.value = muted?0:volume; }
  function setMuted(m){ muted=m; if(master) master.gain.value = m?0:volume; }

  async function loadAudioFile(fileOrUrl){
    ensureCtx();
    let buf;
    if (typeof fileOrUrl === 'string') {
      const res = await fetch(fileOrUrl);
      const ab = await res.arrayBuffer();
      buf = await ctx.decodeAudioData(ab);
    } else if (fileOrUrl instanceof Blob) {
      const ab = await fileOrUrl.arrayBuffer();
      buf = await ctx.decodeAudioData(ab);
    } else if (fileOrUrl instanceof ArrayBuffer) {
      buf = await ctx.decodeAudioData(fileOrUrl);
    }
    musicBuffer = buf; musicDuration = buf.duration*1000;
    return buf;
  }
  function playMusic(mapTimeMs, bpm, speed){
    ensureCtx();
    stopMusic();
    musicSpeed = speed || 1;
    if (!musicBuffer) { startProcedural((bpm||120) * musicSpeed, mapTimeMs); return; }
    musicSource = ctx.createBufferSource();
    musicSource.buffer = musicBuffer;
    musicSource.playbackRate.value = musicSpeed;
    musicSource.connect(musicGain);
    const offsetSec = clamp(mapTimeMs/1000, 0, musicBuffer.duration-0.05);
    musicStartCtxTime = ctx.currentTime;
    musicStartMapTime = mapTimeMs;
    musicSource.start(0, offsetSec);
    musicPlaying = true; musicPausedAt = mapTimeMs;
    musicSource.onended = ()=>{ if(musicPlaying){ musicPlaying=false; } };
  }
  function pauseMusic(){
    if (!musicPlaying) return;
    musicPausedAt = currentMapTime();
    try{ musicSource.stop(); }catch{}
    musicPlaying=false;
    if (proceduralTimer){ clearInterval(proceduralTimer); proceduralTimer=null; }
  }
  function stopMusic(){
    if (musicSource){ try{musicSource.stop();}catch{} musicSource=null; }
    if (proceduralTimer){ clearInterval(proceduralTimer); proceduralTimer=null; }
    musicPlaying=false;
  }
  function currentMapTime(){
    if (proceduralTimer) return (ctx.currentTime - proceduralStart)*1000 * musicSpeed + musicStartMapTime;
    if (!musicPlaying || !ctx) return musicPausedAt;
    return (ctx.currentTime - musicStartCtxTime)*1000 * musicSpeed + musicStartMapTime;
  }
  function seek(mapTimeMs){
    const wasPlaying = musicPlaying;
    stopMusic();
    if (wasPlaying) playMusic(mapTimeMs, proceduralBpm);
    else musicPausedAt = mapTimeMs;
  }

  // Procedural music: kick/hat/bass/melody scheduled ahead
  function startProcedural(bpm, startMapTime){
    ensureCtx();
    stopMusic();
    proceduralBpm = bpm; proceduralStart = ctx.currentTime; musicStartMapTime = startMapTime||0;
    proceduralStep = Math.floor((startMapTime||0)/1000 * (bpm/60) * 4); // 16th steps
    proceduralNextNoteTime = ctx.currentTime + 0.05;
    musicPlaying = true; musicPausedAt = startMapTime||0;
    proceduralTimer = setInterval(scheduleProcedural, 40);
  }
  function scheduleProcedural(){
    if (!musicPlaying) return;
    const spb = 60/proceduralBpm; // sec per beat
    const stepDur = spb/4;
    while (proceduralNextNoteTime < ctx.currentTime + 0.15) {
      const step = proceduralStep;
      const bar = Math.floor(step/16), s16 = step%16;
      // kick on beats
      if (s16%4===0) kick(proceduralNextNoteTime, 0.5);
      // hat offbeat
      if (s16%4===2) hat(proceduralNextNoteTime, 0.18);
      if (s16%2===1) hat(proceduralNextNoteTime, 0.07);
      // snare on 2 & 4
      if (s16===4 || s16===12) snare(proceduralNextNoteTime, 0.3);
      // bass line (A minor pentatonic-ish)
      const bassNotes = [110,110,130.81,98,110,110,164.81,146.83];
      if (s16%2===0) bass(proceduralNextNoteTime, bassNotes[bar% bassNotes.length], 0.22);
      // melody pluck
      const mel = [440,523.25,659.25,523.25,587.33,440,392,440];
      if (s16===0 || s16===6 || s16===10) pluck(proceduralNextNoteTime, mel[(bar*2 + (s16===6?1:s16===10?2:0))%mel.length], 0.12);
      proceduralNextNoteTime += stepDur;
      proceduralStep++;
    }
  }
  function kick(t, vol){
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='sine'; o.frequency.setValueAtTime(150,t); o.frequency.exponentialRampToValueAtTime(40,t+0.12);
    g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.18);
    o.connect(g); g.connect(musicGain); o.start(t); o.stop(t+0.2);
  }
  function hat(t, vol){
    const len=ctx.sampleRate*0.05, buf=ctx.createBuffer(1,len,ctx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
    const src=ctx.createBufferSource(); src.buffer=buf;
    const f=ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=7000;
    const g=ctx.createGain(); g.gain.value=vol;
    src.connect(f); f.connect(g); g.connect(musicGain); src.start(t);
  }
  function snare(t, vol){
    const len=ctx.sampleRate*0.12, buf=ctx.createBuffer(1,len,ctx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
    const src=ctx.createBufferSource(); src.buffer=buf;
    const f=ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1800;
    const g=ctx.createGain(); g.gain.value=vol;
    src.connect(f); f.connect(g); g.connect(musicGain); src.start(t);
  }
  function bass(t, freq, vol){
    const o=ctx.createOscillator(), g=ctx.createGain(), f=ctx.createBiquadFilter();
    o.type='sawtooth'; o.frequency.value=freq; f.type='lowpass'; f.frequency.value=600;
    g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.25);
    o.connect(f); f.connect(g); g.connect(musicGain); o.start(t); o.stop(t+0.3);
  }
  function pluck(t, freq, vol){
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='triangle'; o.frequency.value=freq;
    g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.3);
    o.connect(g); g.connect(musicGain); o.start(t); o.stop(t+0.35);
  }

  // Hitsounds
  function hitSound(kind){
    ensureCtx();
    const t = ctx.currentTime;
    if (kind==='hit' || kind==='don') {
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sine'; o.frequency.setValueAtTime(220,t); o.frequency.exponentialRampToValueAtTime(90,t+0.08);
      g.gain.setValueAtTime(0.5,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.12);
      o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t+0.15);
    } else if (kind==='ka' || kind==='clap') {
      const len=ctx.sampleRate*0.06, buf=ctx.createBuffer(1,len,ctx.sampleRate), d=buf.getChannelData(0);
      for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
      const src=ctx.createBufferSource(); src.buffer=buf;
      const f=ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1200;
      const g=ctx.createGain(); g.gain.value=0.4;
      src.connect(f); f.connect(g); g.connect(sfxGain); src.start(t);
    } else if (kind==='miss') {
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='square'; o.frequency.setValueAtTime(140,t); o.frequency.exponentialRampToValueAtTime(70,t+0.15);
      g.gain.setValueAtTime(0.25,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.2);
      o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t+0.22);
    } else if (kind==='finish' || kind==='whistle') {
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sine'; o.frequency.value=880;
      g.gain.setValueAtTime(0.3,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.25);
      o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t+0.3);
    } else if (kind==='slider') {
      // soft tick
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sine'; o.frequency.value=1200;
      g.gain.setValueAtTime(0.08,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.05);
      o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t+0.06);
    }
  }

  return { ensureCtx, setVolume, setMuted, loadAudioFile, playMusic, pauseMusic, stopMusic, currentMapTime, seek, hitSound, get musicDuration(){ return musicDuration; }, get isPlaying(){ return musicPlaying; } };
})();
