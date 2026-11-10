// utils.js — shared helpers
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp = (a,b,t)=>a+(b-a)*t;
const fmtInt = n => Math.round(n).toLocaleString('en-US');
const fmtAcc = n => (Math.round(n*100)/100).toFixed(2)+'%';
const fmtTime = ms => { const s=Math.floor(ms/1000); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
const esc = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
function status(msg){ const el=$('#status-msg'); if(el) el.textContent=msg; }
function statusRight(msg){ const el=$('#status-right'); if(el) el.textContent=msg; }
const MODES = [
  { id:0, name:'osu!', short:'std', color:'#ed2e7e', icon:'◎' },
  { id:1, name:'Taiko', short:'taiko', color:'#f59e0b', icon:'◉' },
  { id:2, name:'Catch', short:'catch', color:'#22c55e', icon:'◍' },
  { id:3, name:'Mania', short:'mania', color:'#8b5cf6', icon:'▦' },
];
const MOD_LIST = [
  { id:'DT', name:'Double Time', desc:'1.5x speed', mult:1.12 },
  { id:'HT', name:'Half Time', desc:'0.75x speed', mult:0.92 },
  { id:'NC', name:'Nightcore', desc:'DT + pitch up', mult:1.12 },
  { id:'HD', name:'Hidden', desc:'Fade out objects', mult:1.06 },
  { id:'HR', name:'Hard Rock', desc:'+AR/CS/OD', mult:1.10 },
  { id:'EZ', name:'Easy', desc:'-AR/CS/OD', mult:0.50 },
  { id:'NF', name:'No Fail', desc:'Cannot fail', mult:0.90 },
  { id:'SD', name:'Sudden Death', desc:'Restart on miss', mult:1.00 },
  { id:'PF', name:'Perfect', desc:'SD + NF', mult:1.00 },
  { id:'FL', name:'Flashlight', desc:'Limited vision', mult:1.12 },
  { id:'RX', name:'Relax', desc:'Auto-play (no fail)', mult:0.10 },
  { id:'AP', name:'Autoplay', desc:'Watch replay', mult:0.00 },
];
function modMult(mods){ let m=1; mods.forEach(id=>{ const d=MOD_LIST.find(x=>x.id===id); if(d) m*=d.mult; }); return m; }
function modSpeed(mods){ if(mods.includes('DT')||mods.includes('NC')) return 1.5; if(mods.includes('HT')) return 0.75; return 1; }
function rankFor(acc, miss, mods){
  const silver = mods.includes('HD')||mods.includes('FL');
  if (miss===0 && acc>=90) return silver?'XH':'X';
  if (acc>=90) return silver?'SH':'S';
  if (acc>=80) return 'A';
  if (acc>=70) return 'B';
  if (acc>=60) return 'C';
  if (acc>=50) return 'D';
  return 'F';
}
function gradeColor(r){ return {XH:'#7dd3fc',X:'#f0abfc',SH:'#fde047',S:'#fde047',A:'#4ade80',B:'#60a5fa',C:'#c084fc',D:'#fca5a5',F:'#6b7280'}[r]||'#fff'; }
