// builtin.js — built-in beatmaps for all 4 modes (procedurally generated, fully playable)
const BuiltinMaps = (() => {
  function makeTiming(bpm, lengthMs){
    const beat = 60000/bpm;
    const pts=[{time:0, beatLength:beat, meter:4, sampleSet:0, sampleIndex:0, volume:80, uninherited:true, effects:0}];
    return pts;
  }
  function baseBm(mode, title, artist, creator, version, bpm, hp, cs, od, ar, sm){
    return {
      version:14, general:{AudioFilename:'procedural.mp3', Mode:String(mode)}, metadata:{Title:title, Artist:artist, Creator:creator, Version:version},
      difficulty:{HPDrainRate:String(hp), CircleSize:String(cs), OverallDifficulty:String(od), ApproachRate:String(ar), SliderMultiplier:String(sm), SliderTickRate:'1'},
      timingPoints: makeTiming(bpm, 60000), hitObjects:[], colours:[], events:[],
      mode, title, artist, creator, version, audioFilename:'procedural.mp3', previewTime:0,
      hp, cs, od, ar, sliderMultiplier:sm, sliderTickRate:1, stackLeniency:0.7, bpm, length:0, starDifficulty:0, raw:''
    };
  }
  function circle(x,y,time,extra={}){ return {x,y,time,type:1,hitSound:0,isCircle:true,isSlider:false,isSpinner:false,isHold:false,newCombo:false,comboOffset:0,endTime:time, ...extra}; }
  function slider(x,y,time,points,repeat,length,extra={}){ return {x,y,time,type:2,hitSound:0,isCircle:false,isSlider:true,isSpinner:false,isHold:false,newCombo:false,comboOffset:0,endTime:time,curveType:'L',points:[{x,y},...points],repeat,length, ...extra}; }
  function spinner(time,endTime){ return {x:256,y:192,time,type:4,hitSound:0,isCircle:false,isSlider:false,isSpinner:true,isHold:false,newCombo:false,comboOffset:0,endTime}; }

  function genOsu(){
    const bm = baseBm(0,'Neon Skyline','Synthwave Collective','osu-web','Normal',128,5,4,5,6,1.4);
    const beat = 60000/128;
    let t = 1000;
    // intro: simple circles
    for(let i=0;i<8;i++){ bm.hitObjects.push(circle(100+ (i%4)*100, 100+Math.floor(i/4)*180, t)); t+=beat; }
    // sliders
    bm.hitObjects.push(slider(100,192,t,[{x:300,y:192}],1,200)); t+=beat*2;
    bm.hitObjects.push(slider(400,100,t,[{x:400,y:280}],1,180)); t+=beat*2;
    for(let i=0;i<6;i++){ bm.hitObjects.push(circle(80+ (i%3)*170, 80+ (i%2)*220, t)); t+=beat; }
    bm.hitObjects.push(spinner(t, t+beat*4)); t+=beat*4;
    for(let i=0;i<10;i++){ bm.hitObjects.push(circle(256+Math.sin(i)*150, 192+Math.cos(i*1.3)*100, t)); t+=beat*0.75; }
    bm.hitObjects.push(slider(80,192,t,[{x:430,y:192}],2,350)); t+=beat*4;
    for(let i=0;i<8;i++){ bm.hitObjects.push(circle(120+(i%4)*85, 120+((i*7)%3)*70, t)); t+=beat; }
    bm.hitObjects.push(spinner(t, t+beat*3)); t+=beat*3;
    bm.length = t; bm.starDifficulty = 2.4;
    bm.id = 'builtin-osu-1';
    return bm;
  }
  function genOsuHard(){
    const bm = baseBm(0,'Midnight Circuit','Vector Seven','osu-web','Hard',160,6.5,4.5,8,9,1.8);
    const beat = 60000/160;
    let t=1000;
    for(let i=0;i<40;i++){
      const x=80+((i*137)%350), y=60+((i*89)%260);
      if(i%5===4) bm.hitObjects.push(slider(x,y,t,[{x:clamp(x+80,0,512),y:clamp(y+40,0,384)}],1,120));
      else bm.hitObjects.push(circle(x,y,t));
      t+=beat*(i%3===2?0.5:1);
    }
    bm.hitObjects.push(spinner(t,t+beat*2)); t+=beat*2;
    for(let i=0;i<20;i++){ bm.hitObjects.push(circle(256+Math.cos(i*0.9)*180, 192+Math.sin(i*0.9)*120, t)); t+=beat*0.5; }
    bm.length=t; bm.starDifficulty=4.8; bm.id='builtin-osu-2';
    return bm;
  }
  function genTaiko(){
    const bm = baseBm(1,'Taiko Festival','Drum Ensemble','osu-web','Normal',120,5,4,5,6,1.4);
    const beat=60000/120;
    let t=1000;
    for(let i=0;i<48;i++){
      const isDon = (i%3!==2);
      bm.hitObjects.push({x:256,y:isDon?100:280,time:t,type:1,hitSound:0,isCircle:true,isSlider:false,isSpinner:false,isHold:false,newCombo:i%8===0,comboOffset:0,endTime:t,kind:'taiko',isDon,big:i%16===0});
      t+=beat*(i%4===3?0.5:1);
    }
    // don spinner-ish: long note as slider
    bm.hitObjects.push({x:256,y:100,time:t,type:2,hitSound:0,isCircle:false,isSlider:true,isSpinner:false,isHold:false,newCombo:false,comboOffset:0,endTime:t+beat*4,curveType:'L',points:[{x:256,y:100},{x:400,y:100}],repeat:1,length:200,kind:'taiko',isDon:true,big:false});
    t+=beat*4;
    for(let i=0;i<24;i++){ bm.hitObjects.push({x:256,y:i%2?100:280,time:t,type:1,hitSound:0,isCircle:true,isSlider:false,isSpinner:false,isHold:false,newCombo:false,comboOffset:0,endTime:t,kind:'taiko',isDon:i%2===0,big:false}); t+=beat*0.5; }
    bm.length=t; bm.starDifficulty=2.1; bm.id='builtin-taiko-1';
    return bm;
  }
  function genCatch(){
    const bm = baseBm(2,'Fruit Rain','Pop Arcade','osu-web','Normal',140,5,4,5,6,1.4);
    const beat=60000/140;
    let t=1000;
    for(let i=0;i<60;i++){
      const x=40+((i*97)%430);
      bm.hitObjects.push({x,y:0,time:t,type:1,hitSound:0,isCircle:true,isSlider:false,isSpinner:false,isHold:false,newCombo:false,comboOffset:0,endTime:t,kind:'fruit'});
      t+=beat*(i%5===4?0.5:1);
    }
    bm.length=t; bm.starDifficulty=1.9; bm.id='builtin-catch-1';
    return bm;
  }
  function genMania(){
    const bm = baseBm(3,'Neon Keys','Chipwave','osu-web','4K Normal',150,5,4,5,6,1.4);
    const beat=60000/150;
    let t=1000;
    const keys=4;
    for(let i=0;i<64;i++){
      const lane=i%keys;
      const x=Math.floor(lane*(512/keys)+ (512/keys)/2);
      const isHold = i%8===4;
      bm.hitObjects.push({x,y:0,time:t,type:isHold?128:1,hitSound:0,isCircle:!isHold,isSlider:false,isSpinner:false,isHold,newCombo:false,comboOffset:0,endTime:isHold?t+beat*1.5:t,kind:isHold?'hold':'note',lane,keys});
      t+=beat*(i%4===3?0.5:1);
    }
    bm.length=t; bm.starDifficulty=2.6; bm.id='builtin-mania-1';
    return bm;
  }
  function genMania7K(){
    const bm = baseBm(3,'Starlight 7K','Piano Core','osu-web','7K Hard',180,6,7,7,8,1.4);
    const beat=60000/180;
    let t=1000;
    const keys=7;
    for(let i=0;i<80;i++){
      const lane=(i*3)%keys;
      const x=Math.floor(lane*(512/keys)+(512/keys)/2);
      bm.hitObjects.push({x,y:0,time:t,type:1,hitSound:0,isCircle:true,isSlider:false,isSpinner:false,isHold:false,newCombo:false,comboOffset:0,endTime:t,kind:'note',lane,keys});
      t+=beat*0.5;
    }
    bm.length=t; bm.starDifficulty=4.2; bm.id='builtin-mania-2';
    return bm;
  }

  function all(){
    return [genOsu(), genOsuHard(), genTaiko(), genCatch(), genMania(), genMania7K()];
  }
  return { all };
})();
