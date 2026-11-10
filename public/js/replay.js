// replay.js — record & playback (.osr-like JSON + export/import)
const Replay = (() => {
  // events: {t: mapTimeMs, type:'click'|'key'|'move'|'slider', x,y, key, down}
  function createRecorder(){
    const events=[];
    let startWall=0;
    return {
      events,
      start(){ startWall=performance.now(); events.length=0; },
      record(ev){ events.push({ t: Math.round(ev.t), type: ev.type, x: ev.x, y: ev.y, key: ev.key, down: ev.down }); },
      stop(){ return events; },
      exportJSON(meta){ return JSON.stringify({ format:'osu-web-replay-v1', meta, events }, null, 2); },
      importJSON(text){ const d=JSON.parse(text); if(d.format!=='osu-web-replay-v1') throw new Error('Not an osu-web replay'); return d; }
    };
  }
  function downloadReplay(filename, text){
    const blob=new Blob([text],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  }
  function saveToLocalStorage(name, data){
    const key='osuweb_replay_'+name;
    localStorage.setItem(key, JSON.stringify(data));
  }
  function listLocal(){
    const out=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k && k.startsWith('osuweb_replay_')) out.push(k.slice('osuweb_replay_'.length));
    }
    return out;
  }
  function loadFromLocalStorage(name){
    const v=localStorage.getItem('osuweb_replay_'+name);
    return v?JSON.parse(v):null;
  }
  return { createRecorder, downloadReplay, saveToLocalStorage, listLocal, loadFromLocalStorage };
})();
