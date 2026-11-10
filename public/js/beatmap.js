// beatmap.js — .osu parser + timing + difficulty helpers (compatible with ppy/osu format v14)
const BeatmapParser = (() => {
  function parseOsu(text) {
    const lines = text.split(/\r?\n/);
    let section = '';
    const bm = {
      version: 14, general: {}, metadata: {}, difficulty: {}, timingPoints: [], hitObjects: [], colours: [], events: [],
      mode: 0, raw: text
    };
    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//')) continue;
      if (line.startsWith('osu file format')) { const m = line.match(/v(\d+)/); if(m) bm.version = Number(m[1]); continue; }
      if (line.startsWith('[') && line.endsWith(']')) { section = line.slice(1,-1); continue; }
      if (section === 'General' || section === 'Metadata' || section === 'Difficulty' || section === 'Editor') {
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const k = line.slice(0, idx).trim(), v = line.slice(idx+1).trim();
        if (section==='General') bm.general[k]=v;
        else if (section==='Metadata') bm.metadata[k]=v;
        else if (section==='Difficulty') bm.difficulty[k]=v;
        else bm.general['Editor_'+k]=v;
      } else if (section === 'TimingPoints') {
        const p = line.split(',').map(s=>s.trim());
        if (p.length < 7) continue;
        bm.timingPoints.push({
          time: Number(p[0]), beatLength: Number(p[1]), meter: Number(p[2]||4),
          sampleSet: Number(p[3]||0), sampleIndex: Number(p[4]||0), volume: Number(p[5]||100),
          uninherited: Number(p[6]||0)===1, effects: Number(p[7]||0)
        });
      } else if (section === 'HitObjects') {
        bm.hitObjects.push(parseHitObject(line));
      } else if (section === 'Colours') {
        const idx = line.indexOf(':');
        if (idx>0) bm.colours.push(line.slice(idx+1).trim());
      } else if (section === 'Events') {
        bm.events.push(line);
      }
    }
    bm.mode = Number(bm.general.Mode || 0);
    bm.title = bm.metadata.Title || bm.metadata.TitleUnicode || 'Untitled';
    bm.artist = bm.metadata.Artist || bm.metadata.ArtistUnicode || 'Unknown';
    bm.creator = bm.metadata.Creator || 'Unknown';
    bm.version = bm.metadata.Version || 'Normal';
    bm.audioFilename = bm.general.AudioFilename || 'audio.mp3';
    bm.previewTime = Number(bm.general.PreviewTime || 0);
    bm.hp = Number(bm.difficulty.HPDrainRate || 5);
    bm.cs = Number(bm.difficulty.CircleSize || 4);
    bm.od = Number(bm.difficulty.OverallDifficulty || 5);
    bm.ar = Number(bm.difficulty.ApproachRate ?? bm.od);
    bm.sliderMultiplier = Number(bm.difficulty.SliderMultiplier || 1.4);
    bm.sliderTickRate = Number(bm.difficulty.SliderTickRate || 1);
    bm.stackLeniency = Number(bm.general.StackLeniency || 0.7);
    // background image from Events: 0,0,"file.jpg",0,0
    bm.background = null;
    for (const ev of bm.events) {
      const m = ev.match(/^0,0,"([^"]+)"/);
      if (m) { bm.background = m[1]; break; }
    }
    // combo colours -> rgb arrays
    bm.comboColours = bm.colours.map(c => {
      const p = c.split(',').map(Number);
      return p.length >= 3 ? { r: p[0], g: p[1], b: p[2] } : null;
    }).filter(Boolean);
    if (!bm.comboColours.length) bm.comboColours = [{r:237,g:46,b:126},{r:110,g:231,b:255},{r:74,g:222,b:128},{r:251,g:191,b:36}];
    // sort timing points
    bm.timingPoints.sort((a,b)=>a.time-b.time);
    bm.hitObjects.sort((a,b)=>a.time-b.time);
    // compute derived timing helpers
    bm.bpm = bpmAt(bm, bm.timingPoints[0]?.time ?? 0);
    // compute slider end times: duration = length / (sliderMultiplier*100*SV) * beatLength * repeat
    for (const o of bm.hitObjects) {
      if (o.isSlider) {
        const t = timingAt(bm, o.time);
        const vel = bm.sliderMultiplier * 100 * t.sv; // px per beat
        const dur = vel > 0 ? (o.length / vel) * t.beatLength * (o.repeat || 1) : 500;
        o.endTime = o.time + Math.max(100, dur);
      }
    }
    bm.length = bm.hitObjects.length ? Math.max(...bm.hitObjects.map(o=>o.endTime||o.time)) : 0;
    bm.starDifficulty = estimateStars(bm);
    return bm;
  }

  function parseHitObject(line) {
    // x,y,time,type,hitSound[,curve...]
    // Type bits (ppy/osu): 1=circle, 2=slider, 4=spinner, 8=hold, 128=mania hold.
    // Bit 4 doubles as "new combo" when combined with circle/slider (e.g. 5=circle+combo, 6=slider+combo).
    // Spinner is bit 4 WITHOUT circle/slider bits (type 4 alone).
    const parts = line.split(',');
    const x = Number(parts[0]), y = Number(parts[1]), time = Number(parts[2]), type = Number(parts[3]);
    const hitSound = Number(parts[4]||0);
    const isCircle = (type & 1) !== 0;
    const isSlider = (type & 2) !== 0;
    const isSpinner = ((type & 4) !== 0) && !isCircle && !isSlider;
    const isHold = (type & 128) !== 0;
    const newCombo = !isSpinner && ((type & 4) !== 0);
    const comboOffset = (type >> 4) & 7;
    const obj = { x, y, time, type, hitSound, isCircle, isSlider, isSpinner, isHold, newCombo, comboOffset, endTime: time, raw: line };
    if (isSlider) {
      // parts[5] = curve spec e.g. "P|184:128|200:80" or "L|144:340"
      const curveSpec = (parts[5]||'L').trim();
      const repeat = Number(parts[6]||1);
      const length = Number(parts[7]||0);
      obj.curveSpec = curveSpec; obj.repeat = Math.max(1, repeat); obj.length = length;
      obj.curveType = curveSpec[0] || 'L';
      obj.points = [{x,y}];
      const rest = curveSpec.slice(2); // after "X|"
      if (rest) rest.split('|').forEach(pt=>{
        const [px,py] = pt.split(':').map(Number);
        if (!isNaN(px) && !isNaN(py)) obj.points.push({x:px,y:py});
      });
      // edge sounds etc ignored for gameplay except hitSound
    }
    if (isSpinner || isHold) {
      // parts[5] = endTime (mania holds append ":hitSound:..." after endTime)
      const rawEnd = String(parts[5]||'').split(':')[0];
      const parsed = Number(rawEnd);
      if (!isNaN(parsed) && parsed > 0) obj.endTime = parsed;
    }
    return obj;
  }

  function timingAt(bm, time) {
    let cur = bm.timingPoints[0] || { beatLength: 500, uninherited: true };
    let sv = 1;
    for (const tp of bm.timingPoints) {
      if (tp.time > time) break;
      if (tp.uninherited) cur = tp;
      else sv = -100 / tp.beatLength;
    }
    return { beatLength: Math.abs(cur.beatLength), bpm: 60000 / Math.abs(cur.beatLength), sv };
  }
  function bpmAt(bm, time){ return timingAt(bm,time).bpm; }
  function svAt(bm, time){ return timingAt(bm,time).sv; }

  function arToPreempt(ar){
    if (ar < 5) return 1200 + 600*(5-ar)/5;
    return 1200 - 450*(ar-5)/5;
  }
  function odToWindows(od){
    return { w300: 80 - 6*od, w100: 140 - 8*od, w50: 200 - 10*od };
  }
  function csToRadius(cs){ return 64 - 4.48*cs; }

  function estimateStars(bm){
    // lightweight star estimate (not exact ppy algorithm, but monotonic with density)
    const n = bm.hitObjects.length;
    const lenSec = Math.max(1, (bm.length)/1000);
    const density = n / lenSec;
    const sliderRatio = bm.hitObjects.filter(o=>o.isSlider).length / Math.max(1,n);
    let stars = 1 + density*0.55 + sliderRatio*1.2 + (bm.od*0.08) + (bm.ar*0.05);
    // mode adjustments
    if (bm.mode===1) stars *= 0.9;
    if (bm.mode===2) stars *= 0.85;
    if (bm.mode===3) stars *= 1.05;
    return Math.round(stars*100)/100;
  }

  // Slider path sampling: returns array of {x,y} points along path (scaled to playfield 512x384)
  function sliderPath(obj){
    const pts = obj.points && obj.points.length>1 ? obj.points : [{x:obj.x,y:obj.y},{x:obj.x+50,y:obj.y}];
    const type = obj.curveType || 'L';
    if (type==='L') return samplePolyline(pts, 60);
    if (type==='P') {
      // perfect circle through 3 points (or arc)
      if (pts.length>=3) {
        const c = circleThrough(pts[0], pts[1], pts[2]);
        if (c) return sampleArc(pts[0], pts[1], pts[2], c, 60);
      }
      return samplePolyline(pts, 60);
    }
    if (type==='B') return sampleBezier(pts, 60);
    if (type==='C') return sampleCatmull(pts, 60);
    return samplePolyline(pts, 60);
  }
  function samplePolyline(pts, n){
    // resample by arc length
    const segs=[]; let total=0;
    for(let i=0;i<pts.length-1;i++){ const d=Math.hypot(pts[i+1].x-pts[i].x, pts[i+1].y-pts[i].y); segs.push(d); total+=d; }
    if(total===0) return pts.slice();
    const out=[];
    for(let i=0;i<=n;i++){
      let target = total*i/n;
      for(let j=0;j<segs.length;j++){
        if(target<=segs[j] || j===segs.length-1){
          const t = segs[j]===0?0:target/segs[j];
          out.push({ x: lerp(pts[j].x, pts[j+1].x, t), y: lerp(pts[j].y, pts[j+1].y, t) });
          break;
        }
        target-=segs[j];
      }
    }
    return out;
  }
  function sampleBezier(pts, n){
    // cubic bezier with control points (simplified: use first 4 points or duplicate)
    const p0=pts[0], p1=pts[1]||pts[0], p2=pts[2]||pts[1]||pts[0], p3=pts[3]||pts[2]||pts[0];
    const out=[];
    for(let i=0;i<=n;i++){
      const t=i/n, u=1-t;
      out.push({
        x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
        y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
      });
    }
    return out;
  }
  function sampleCatmull(pts, n){
    // Catmull-Rom spline
    const out=[];
    const get = i => pts[clamp(i,0,pts.length-1)];
    const segs = Math.max(1, pts.length-1);
    const per = Math.floor(n/segs);
    for(let s=0;s<segs;s++){
      const p0=get(s-1), p1=get(s), p2=get(s+1), p3=get(s+2);
      for(let i=0;i<per;i++){
        const t=i/per, t2=t*t, t3=t2*t;
        out.push({
          x: 0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
          y: 0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
        });
      }
    }
    out.push(pts[pts.length-1]);
    return out;
  }
  function circleThrough(a,b,c){
    const d = 2*(a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y));
    if (Math.abs(d)<1e-6) return null;
    const ux = ((a.x*a.x+a.y*a.y)*(b.y-c.y)+(b.x*b.x+b.y*b.y)*(c.y-a.y)+(c.x*c.x+c.y*c.y)*(a.y-b.y))/d;
    const uy = ((a.x*a.x+a.y*a.y)*(c.x-b.x)+(b.x*b.x+b.y*b.y)*(a.x-c.x)+(c.x*c.x+c.y*c.y)*(b.x-a.x))/d;
    return {x:ux,y:uy,r:Math.hypot(a.x-ux,a.y-uy)};
  }
  function sampleArc(a,b,c,center,n){
    let a0=Math.atan2(a.y-center.y,a.x-center.x), a1=Math.atan2(b.y-center.y,b.x-center.x), a2=Math.atan2(c.y-center.y,c.x-center.x);
    // choose direction that passes through b
    // normalize to shortest arc a->c via b: try both directions
    function norm(x){ while(x>Math.PI)x-=2*Math.PI; while(x<-Math.PI)x+=2*Math.PI; return x; }
    let d1 = norm(a1-a0), d2 = norm(a2-a1);
    // if signs differ, go the other way around
    let total = d1+d2;
    if (Math.sign(d1)!==Math.sign(d2)) {
      // go opposite direction
      total = norm(a2-a0) - Math.sign(d1)*2*Math.PI;
    }
    const out=[];
    for(let i=0;i<=n;i++){ const ang=a0+total*i/n; out.push({x:center.x+Math.cos(ang)*center.r, y:center.y+Math.sin(ang)*center.r}); }
    return out;
  }

  // Convert .osu hitobjects to per-mode playable objects
  function toPlayable(bm){
    if (bm.mode===0) return bm.hitObjects.map(o=>({...o, kind: o.isSpinner?'spinner':(o.isSlider?'slider':'circle')}));
    if (bm.mode===1) {
      // Taiko: x encodes don/ka? In taiko maps, hitobjects: y < 192? Use hitSound + x to decide.
      // ppy taiko: circles with x<256? Simplified: use hitSound bit + y position.
      return bm.hitObjects.map(o=>{
        const isDon = (o.y < 192) || ((o.hitSound & 8)===0 && o.x < 256);
        // big notes: type has bit? Use combo? Mark big if newCombo or hitSound whistle?
        const big = o.newCombo || (o.hitSound & 2)!==0;
        return { ...o, kind:'taiko', isDon, big };
      });
    }
    if (bm.mode===2) {
      return bm.hitObjects.map(o=>({...o, kind:'fruit', x: clamp(o.x,0,512)}));
    }
    if (bm.mode===3) {
      // Mania: CS = keys (4-10). Lane from x.
      const keys = clamp(Math.round(bm.cs), 4, 10);
      return bm.hitObjects.map(o=>{
        const lane = clamp(Math.floor(o.x / (512/keys)), 0, keys-1);
        return { ...o, kind: o.isHold?'hold':'note', lane, keys };
      });
    }
    return bm.hitObjects;
  }

  // Serialize a beatmap object back to .osu text (used by the editor)
  function serializeOsu(bm) {
    const L = [];
    L.push('osu file format v14');
    L.push('');
    L.push('[General]');
    L.push('AudioFilename: ' + (bm.audioFilename || 'audio.mp3'));
    L.push('AudioLeadIn: 0');
    L.push('PreviewTime: ' + (bm.previewTime || 0));
    L.push('Countdown: 0');
    L.push('SampleSet: Soft');
    L.push('StackLeniency: 0.7');
    L.push('Mode: ' + bm.mode);
    L.push('LetterboxInBreaks: 0');
    L.push('WidescreenStoryboard: 0');
    L.push('');
    L.push('[Metadata]');
    L.push('Title:' + bm.title);
    L.push('TitleUnicode:' + bm.title);
    L.push('Artist:' + bm.artist);
    L.push('ArtistUnicode:' + bm.artist);
    L.push('Creator:' + bm.creator);
    L.push('Version:' + bm.version);
    L.push('Source:');
    L.push('Tags:');
    L.push('BeatmapID:0');
    L.push('BeatmapSetID:-1');
    L.push('');
    L.push('[Difficulty]');
    L.push('HPDrainRate:' + bm.hp);
    L.push('CircleSize:' + bm.cs);
    L.push('OverallDifficulty:' + bm.od);
    L.push('ApproachRate:' + bm.ar);
    L.push('SliderMultiplier:' + bm.sliderMultiplier);
    L.push('SliderTickRate:' + bm.sliderTickRate);
    L.push('');
    L.push('[Events]');
    if (bm.background) L.push('0,0,"' + bm.background + '",0,0');
    L.push('');
    L.push('[TimingPoints]');
    (bm.timingPoints.length ? bm.timingPoints : [{time:0,beatLength:60000/(bm.bpm||120),meter:4,sampleSet:0,sampleIndex:0,volume:80,uninherited:true,effects:0}]).forEach(tp => {
      L.push([tp.time, tp.beatLength, tp.meter||4, tp.sampleSet||0, tp.sampleIndex||0, tp.volume||80, tp.uninherited?1:0, tp.effects||0].join(','));
    });
    L.push('');
    L.push('[HitObjects]');
    [...bm.hitObjects].sort((a,b)=>a.time-b.time).forEach(o => {
      if (o.isSlider) {
        const pts = (o.points || [{x:o.x,y:o.y},{x:o.x+50,y:o.y}]);
        const curve = (o.curveType || 'L') + '|' + pts.slice(1).map(p => p.x + ':' + p.y).join('|');
        L.push([o.x, o.y, o.time, 2 + (o.newCombo?4:0), o.hitSound||0, curve, o.repeat||1, o.length||100, '0|0', '0:0', '0:0:0:0:'].join(','));
      } else if (o.isSpinner) {
        L.push([256, 192, o.time, 4, o.hitSound||0, o.endTime||o.time+1000, '0:0', '0:0:0:0:'].join(','));
      } else if (o.isHold) {
        L.push([o.x, 192, o.time, 128, o.hitSound||0, (o.endTime||o.time+500) + ':0:0:0:0:'].join(','));
      } else {
        L.push([o.x, o.y, o.time, 1 + (o.newCombo?4:0), o.hitSound||0, '0:0:0:0:'].join(','));
      }
    });
    return L.join('\r\n') + '\r\n';
  }

  return { parseOsu, timingAt, bpmAt, svAt, arToPreempt, odToWindows, csToRadius, estimateStars, sliderPath, toPlayable, serializeOsu };
})();
