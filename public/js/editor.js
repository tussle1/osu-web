// editor.js — beatmap editor (create/edit/export .osu, playtest)
const BeatmapEditor = (() => {
  const PF_W = 512, PF_H = 384;
  let state = null;

  function newMap(mode=0) {
    const bpm = 120;
    return {
      version: 14, general: { AudioFilename: 'audio.mp3', Mode: String(mode) }, metadata: {}, difficulty: {},
      timingPoints: [{ time: 0, beatLength: 60000/bpm, meter: 4, sampleSet: 0, sampleIndex: 0, volume: 80, uninherited: true, effects: 0 }],
      hitObjects: [], colours: [], events: [], background: null, comboColours: [],
      mode, title: 'Untitled', artist: 'Unknown', creator: 'You', version: 'Normal',
      audioFilename: 'audio.mp3', previewTime: 0, hp: 5, cs: 4, od: 5, ar: 5,
      sliderMultiplier: 1.4, sliderTickRate: 1, stackLeniency: 0.7, bpm, length: 0, starDifficulty: 0, raw: ''
    };
  }

  function recompute(bm) {
    bm.bpm = BeatmapParser.bpmAt(bm, 0);
    for (const o of bm.hitObjects) {
      if (o.isSlider) {
        const t = BeatmapParser.timingAt(bm, o.time);
        const vel = bm.sliderMultiplier * 100 * t.sv;
        const dur = vel > 0 ? (o.length / vel) * t.beatLength * (o.repeat || 1) : 500;
        o.endTime = o.time + Math.max(100, dur);
      }
    }
    bm.length = bm.hitObjects.length ? Math.max(...bm.hitObjects.map(o=>o.endTime||o.time)) : 0;
    bm.starDifficulty = BeatmapParser.estimateStars(bm);
    bm.hitObjects.sort((a,b)=>a.time-b.time);
    return bm;
  }

  function addObject(bm, obj) {
    bm.hitObjects.push(obj);
    return recompute(bm);
  }
  function removeObject(bm, idx) {
    bm.hitObjects.splice(idx, 1);
    return recompute(bm);
  }
  function clearObjects(bm) { bm.hitObjects = []; return recompute(bm); }

  // Generate a simple pattern map (for quick start)
  function generatePattern(bm, count=32) {
    const beat = 60000/(bm.bpm||120);
    let t = 1000;
    for (let i=0;i<count;i++) {
      if (bm.mode===0) {
        if (i%6===5) {
          const x=100+(i%4)*100, y=100+((i*3)%2)*180;
          bm.hitObjects.push({ x, y, time: t, type: 2, hitSound: 0, isCircle: false, isSlider: true, isSpinner: false, isHold: false, newCombo: false, comboOffset: 0, endTime: t, curveType: 'L', points: [{x,y},{x:clamp(x+100,0,512),y}], repeat: 1, length: 120 });
        } else if (i%12===11) {
          bm.hitObjects.push({ x: 256, y: 192, time: t, type: 4, hitSound: 0, isCircle: false, isSlider: false, isSpinner: true, isHold: false, newCombo: false, comboOffset: 0, endTime: t+beat*2 });
        } else {
          bm.hitObjects.push({ x: 80+((i*137)%350), y: 60+((i*89)%260), time: t, type: 1, hitSound: 0, isCircle: true, isSlider: false, isSpinner: false, isHold: false, newCombo: false, comboOffset: 0, endTime: t });
        }
      } else if (bm.mode===1) {
        bm.hitObjects.push({ x: 256, y: i%2?100:280, time: t, type: 1, hitSound: 0, isCircle: true, isSlider: false, isSpinner: false, isHold: false, newCombo: false, comboOffset: 0, endTime: t });
      } else if (bm.mode===2) {
        bm.hitObjects.push({ x: 40+((i*97)%430), y: 0, time: t, type: 1, hitSound: 0, isCircle: true, isSlider: false, isSpinner: false, isHold: false, newCombo: false, comboOffset: 0, endTime: t });
      } else {
        const keys = clamp(Math.round(bm.cs), 4, 10);
        const lane = i%keys;
        const x = Math.floor(lane*(512/keys)+(512/keys)/2);
        const isHold = i%8===4;
        bm.hitObjects.push({ x, y: 0, time: t, type: isHold?128:1, hitSound: 0, isCircle: !isHold, isSlider: false, isSpinner: false, isHold, newCombo: false, comboOffset: 0, endTime: isHold?t+beat*1.5:t });
      }
      t += beat;
    }
    return recompute(bm);
  }

  return { newMap, recompute, addObject, removeObject, clearObjects, generatePattern };
})();
