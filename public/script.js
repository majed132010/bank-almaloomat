/* ============================================
   بنك المعلومات — النسخة المتطورة (v2)
   script.js — منطق التطبيق الكامل (المُقدِّم)
   ============================================ */
'use strict';

// ══════════════════════════════════════════
//  FIREBASE — REST SYNC (Host writes state)
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  ROOM CODE SYSTEM
// ══════════════════════════════════════════
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
let ROOM = sessionStorage.getItem('hostRoomCode');
if (!ROOM) { ROOM = generateRoomCode(); sessionStorage.setItem('hostRoomCode', ROOM); }
const RP = 'rooms/' + ROOM + '/';
const FIREBASE_HOST = 'bank-almaloomat-game-default-rtdb.firebaseio.com';
const FB_URL_STATE  = `https://${FIREBASE_HOST}/rooms/${ROOM}/gameState.json`;
const FB_URL_BUZZ   = `https://${FIREBASE_HOST}/rooms/${ROOM}/gameState/buzzer.json`;
const FB_URL_TEXT_ANS = `https://${FIREBASE_HOST}/rooms/${ROOM}/gameState/textAnswers.json`;
const FB_URL_SIG    = `https://${FIREBASE_HOST}/rooms/${ROOM}/signaling`;

async function syncToFirebase(data) {
  try {
    await fetch(FB_URL_STATE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch(e) { console.warn('Firebase sync error:', e); }
}

async function fbGet(pathUrl) {
  try {
    const r = await fetch(pathUrl); return await r.json();
  } catch(e){ return null; }
}
async function fbPut(pathUrl, data) {
  try {
    await fetch(pathUrl, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
  } catch(e){ console.warn('fbPut', e); }
}
async function fbDelete(pathUrl) {
  try { await fetch(pathUrl, { method:'DELETE' }); } catch(e){}
}

function buildGameStateForSync() {
  if (!players || players.length === 0) return null;
  return {
    stage,
    players: players.map(p => ({ id: p.id, name: p.name, score: p.score, isBanked: p.isBanked, bankedValue: p.bankedValue })),
    board: (stage === 'silver' || stage === 'gold') ? gameDB[stage] : null,
    diamondState: stage === 'diamond' ? diamondState : null,
    diamondPlayers: stage === 'diamond' ? diamondPlayers.map(p => ({ id: p.id, name: p.name })) : null,
    question: { active: false },
    buzzer: { winnerId: null, winnerName: null, ts: 0 },
    surprise: { active: false },
    updatedAt: Date.now()
  };
}

async function syncQuestion(qItem, cat, value, timerSecs, timerMode) {
  if (!players || players.length === 0) return;
  const state = buildGameStateForSync();
  state.question = {
    active: true,
    id: `${stage}-${cat}-${Date.now()}`,
    text: qItem.q || '',
    answer: qItem.a || '',
    answerRevealed: false,
    cat: cat || '',
    value: value || 0,
    timerSecs,
    timerMode
  };
  // Include media/puzzle metadata when present so players can render UI
  if (qItem.type) state.question.type = qItem.type;
  if (qItem.imageUrl) state.question.imageUrl = qItem.imageUrl;
  if (qItem.audioUrl) state.question.audioUrl = qItem.audioUrl;
  if (qItem.parts) state.question.parts = qItem.parts;
  if (qItem.partIndex !== undefined) state.question.partIndex = qItem.partIndex;
  if (qItem.puzzle) state.question.puzzle = qItem.puzzle;
  // Reset buzzer when a new question opens (unless bank/speed rounds skip buzzer)
  state.buzzer = { winnerId: null, winnerName: null, ts: 0 };
  currentTextAnswers = {};
  await fbPut(FB_URL_TEXT_ANS, {});
  await syncToFirebase(state);
}

async function syncSurprise(icon, text, color) {
  if (!players || players.length === 0) return;
  const state = buildGameStateForSync();
  state.surprise = { active: true, icon, text, color };
  state.question = { active: false };
  await syncToFirebase(state);
}

async function syncCloseQuestion() {
  if (!players || players.length === 0) return;
  await syncToFirebase(buildGameStateForSync());
}

// Reset buzzer node (host action)
async function resetBuzzer() {
  await fbPut(FB_URL_BUZZ, { winnerId: null, winnerName: null, ts: 0 });
  updateBuzzerUI(null);
}

// Reveal Answer to the audience (host action)
async function revealAnswer() {
  const btn = document.getElementById('btn-reveal-answer');
  const stateRes = await fbGet(FB_URL_STATE);
  if (!stateRes || !stateRes.question || !stateRes.question.active) return;
  stateRes.question.answerRevealed = true;
  stateRes.question.revealedAt = Date.now();
  // Auto-close voting if active — the reveal moment is when voting ends
  if (stateRes.voting && stateRes.voting.active) {
    stateRes.voting.active = false;
    stateRes.voting.locked = true;
  }
  await syncToFirebase(stateRes);
  if (btn) { btn.textContent = '✨ تم الكشف'; btn.disabled = true; btn.classList.add('revealed'); }
  // Also update voting button UI
  const vBtn = document.getElementById('btn-toggle-voting');
  if (vBtn) { vBtn.textContent = '🔒 التصويت مقفل'; vBtn.disabled = true; vBtn.classList.remove('active'); }
  // Also play a subtle chime
  if (typeof toneClean === 'function') {
    toneClean(880, .3, .12, 0, 'sine');
    toneClean(1320, .4, .1, .15, 'sine');
  }
}

// Toggle Live Audience Voting (host action)
async function toggleVoting() {
  const btn = document.getElementById('btn-toggle-voting');
  if (!btn) return;
  const stateRes = await fbGet(FB_URL_STATE);
  if (!stateRes || !stateRes.question || !stateRes.question.active) return;
  const currentlyActive = stateRes.voting && stateRes.voting.active;
  if (currentlyActive) {
    // Close voting
    stateRes.voting.active = false;
    stateRes.voting.locked = true;
    btn.textContent = '🗳️ فتح تصويت'; btn.classList.remove('active');
  } else {
    // Open voting (reset counts if new question)
    const qid = stateRes.question.id || `q-${Date.now()}`;
    stateRes.voting = {
      active: true,
      locked: false,
      qid,
      counts: { A: 0, B: 0, C: 0, D: 0 },
      total: 0,
      startedAt: Date.now()
    };
    btn.textContent = '🛑 إيقاف التصويت'; btn.classList.add('active');
  }
  await syncToFirebase(stateRes);
  if (typeof toneClean === 'function') toneClean(660, .18, .1, 0, 'sine');
}

// ══════════════════════════════════════════
//  QR CODE
// ══════════════════════════════════════════
function generateQR(url, elementId, size = 150) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const apis = [
    `https://quickchart.io/qr?text=${encodeURIComponent(url)}&size=${size}`,
    `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`,
    `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encodeURIComponent(url)}&choe=UTF-8`
  ];
  let apiIndex = 0;
  el.onerror = function() {
    apiIndex += 1;
    if (apiIndex < apis.length) {
      console.warn(`[QR] API ${apiIndex} failed. Switching to next fallback.`);
      el.src = apis[apiIndex];
    } else {
      console.error('[QR] All QR APIs failed for', url);
      el.onerror = null;
    }
  };
  el.src = apis[0];
}

function generateSetupQR() {
  const url = window.location.origin + '/players.html?room=' + ROOM;
  const urlEl = document.getElementById('setup-qr-url');
  if (urlEl) {
    urlEl.innerHTML = '<div style="font-family:Cairo,sans-serif;font-size:22pt;font-weight:900;color:#f0a500;letter-spacing:10px;direction:ltr">' + ROOM + '</div><div style="font-size:8pt;color:#94a3b8;margin-top:4px">رمز الغرفة — اكتبه في شاشة المتسابق</div><div style="font-size:7pt;opacity:.6;direction:ltr;margin-top:2px">' + url.replace(/^https?:\/\//,'') + '</div>';
  }
  generateQR(url, 'setup-qr-img', 150);
}

function showQRCode() {}
function hideQRCode() {}

// ══════════════════════════════════════════
//  NAV
// ══════════════════════════════════════════
function goTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + pageId).classList.add('active');
  document.body.classList.remove('in-landing','in-setup','in-game','in-winner');
  document.body.classList.add('in-' + pageId);
  window.scrollTo(0,0);
}
function goToSetup() { goTo('setup'); }

// ══════════════════════════════════════════
//  ADD PLAYER
// ══════════════════════════════════════════
function addPlayer() {
  const zone = document.getElementById('players-zone');
  const n = zone.children.length + 1;
  const arabic = ['١','٢','٣','٤','٥','٦','٧','٨'][n-1] || n;
  const row = document.createElement('div');
  row.className = 'p-row';
  row.innerHTML = `<span class="p-num">${arabic}</span><input class="p-input" type="text" placeholder="اسم الفارس ${n}">`;
  zone.appendChild(row);
  row.querySelector('input').focus();
}

// ══════════════════════════════════════════
//  AUDIO ENGINE (Web Audio Synthesizer)
// ══════════════════════════════════════════
let actx = null, speedLoop = null, bankLoop = null, cdTimer = null;
let speedLoopTempoMs = 190; // dynamic tempo for speed loop

function initAudio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
}

function tone(f, t, d, v=.1, delay=0) {
  try {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = t; o.frequency.setValueAtTime(f, actx.currentTime + delay);
    g.gain.setValueAtTime(v, actx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(.00001, actx.currentTime + delay + d);
    o.connect(g); g.connect(actx.destination);
    o.start(actx.currentTime + delay); o.stop(actx.currentTime + delay + d);
  } catch(e){}
}

function toneClean(freq, dur, vol=0.08, delay=0, type='sine') {
  try {
    if(!actx) return;
    const o=actx.createOscillator(), g=actx.createGain(), c=actx.createBiquadFilter();
    c.type='lowpass'; c.frequency.value=2000;
    o.type=type; o.frequency.setValueAtTime(freq, actx.currentTime+delay);
    g.gain.setValueAtTime(0, actx.currentTime+delay);
    g.gain.linearRampToValueAtTime(vol, actx.currentTime+delay+0.02);
    g.gain.exponentialRampToValueAtTime(0.00001, actx.currentTime+delay+dur);
    o.connect(c); c.connect(g); g.connect(actx.destination);
    o.start(actx.currentTime+delay); o.stop(actx.currentTime+delay+dur);
  } catch(e){}
}

const sfx = {
  main() {
    [[261,.6,.07,0],[329,.6,.07,.15],[392,.6,.08,.3],[523,.8,.09,.5],[659,.8,.09,.7],[783,1,.1,.9]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine'); toneClean(f*2,d,v*.4,t,'triangle');
    });
    [0,.4,.8,1.2].forEach(t=>{ toneClean(80,.35,.12,t,'triangle'); toneClean(100,.2,.08,t+.1,'sine'); });
  },
  question() {
    [[261,.4,.07,0],[329,.4,.08,.12],[392,.5,.09,.24],[523,.5,.1,.36],[659,.6,.1,.48]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine');
    });
    toneClean(130,.5,.1,0,'triangle');
  },
  correct() {
    [[523,.3,.1,0],[659,.3,.1,.12],[783,.3,.1,.24],[1046,.5,.12,.38],[1318,.6,.12,.55],[1568,.8,.1,.72]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine'); toneClean(f*.5,d,v*.5,t+.01,'triangle');
    });
    [0,.3,.6].forEach(t=>toneClean(90,.35,.1,t,'triangle'));
  },
  wrong() {
    [[280,.4,.1,0],[230,.4,.1,.18],[185,.4,.1,.36],[140,.5,.1,.54]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'triangle');
    });
    toneClean(100,.6,.12,.1,'sine');
  },
  buzzHit() {
    // Short bright chime when someone hits the buzzer
    toneClean(880,.15,.15,0,'sine'); toneClean(1320,.2,.12,.05,'sine'); toneClean(1760,.25,.1,.12,'triangle');
  },
  bankSurprise() {
    [[261,.4,.1,0],[329,.4,.1,.1],[392,.4,.1,.2],[523,.5,.12,.35],[659,.5,.12,.5],[783,.6,.12,.65],[1046,.8,.12,.85]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine');
    });
    toneClean(100,.8,.15,0,'triangle');
    toneClean(120,.8,.12,.4,'triangle');
  },
  startBank() {
    this.stopAll(); let b=0;
    const notes=[98,110,98,123,98,116,98,110];
    bankLoop=setInterval(()=>{
      const f=notes[b%notes.length];
      toneClean(f,.28,.12,0,'triangle');
      toneClean(f*1.5,.2,.06,0,'sine');
      if(b%4===0) toneClean(65,.4,.1,0,'triangle');
      b++;
    },320);
  },
  // ⚡ Speed loop with dynamic tempo (recreated each phase)
  startSpeed(tempoMs = 220) {
    this.stopAll(); let b=0;
    speedLoopTempoMs = tempoMs;
    const bassLine=[110,110,130,98,110,110,147,98];
    const run = () => {
      toneClean(bassLine[b%bassLine.length],.18,.14,0,'triangle');
      if(b%2===0) toneClean(440,.06,.04,0,'sine');
      if(b%4===0) toneClean(65,.3,.12,0,'triangle');
      b++;
    };
    speedLoop = setInterval(run, speedLoopTempoMs);
  },
  setSpeedTempo(tempoMs, danger=false) {
    if(!speedLoop) return;
    clearInterval(speedLoop);
    speedLoopTempoMs = tempoMs;
    let b=0;
    const bassLine = danger ? [147,147,147,110,164,164,164,110] : [110,110,130,98,110,110,147,98];
    speedLoop = setInterval(()=>{
      toneClean(bassLine[b%bassLine.length], danger?.14:.18, danger?.16:.14, 0, 'triangle');
      if(b%2===0) toneClean(danger?660:440,.06,danger?.06:.04,0,'sine');
      if(b%4===0) toneClean(danger?55:65,.3,.14,0,'triangle');
      if(danger && b%2===0) toneClean(880,.04,.05,0,'square'); // urgency chirp
      b++;
    }, tempoMs);
  },
  transition() {
    this.stopAll();
    [[261,.8,.08,0],[329,.8,.09,.12],[392,.8,.1,.24],[523,1,.11,.38],[659,1,.11,.55],[783,1.2,.12,.72],[1046,1.5,.12,.92],[1318,1.8,.1,1.15]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine'); toneClean(f*1.5,d,v*.4,t,'triangle');
    });
    [0,.35,.7,1.05].forEach(t=>{ toneClean(80,.5,.15,t,'triangle'); toneClean(55,.4,.1,t+.05,'sine'); });
  },
  victory() {
    this.stopAll();
    [[523,.4,.1,0],[587,.4,.1,.2],[659,.4,.1,.4],[698,.4,.1,.6],[783,.5,.12,.8],[880,.5,.12,1.05],[987,.5,.12,1.3],[1046,.6,.12,1.55],[1318,.8,.12,1.85],[1568,1,.1,2.15]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine'); toneClean(f*.5,d,v*.5,t,'triangle');
    });
    [0,.35,.7,1.05,1.4,1.75,2.1].forEach(t=>{ toneClean(80,.4,.15,t,'triangle'); toneClean(110,.3,.1,t+.1,'sine'); });
  },
  stopAll() {
    if(speedLoop){ clearInterval(speedLoop); speedLoop=null; }
    if(bankLoop){ clearInterval(bankLoop); bankLoop=null; }
  }
};

// ══════════════════════════════════════════
//  TYPEWRITER
// ══════════════════════════════════════════
function typewrite(el, text, speed=42) {
  return new Promise(res=>{
    el.innerHTML='';
    const cur=document.createElement('span'); cur.className='tw-cursor'; el.appendChild(cur);
    let i=0;
    const iv=setInterval(()=>{
      if(i<text.length){
        el.insertBefore(document.createTextNode(text[i]),cur);
        if(actx && i%3===0) tone(1700+Math.random()*500,'square',.025,.015);
        i++;
      } else { clearInterval(iv); cur.remove(); res(); }
    },speed);
  });
}

// ══════════════════════════════════════════
//  PARTICLES / FIREWORKS
// ══════════════════════════════════════════
function spawnParticles(containerId) {
  const c=document.getElementById(containerId); c.innerHTML='';
  const colors=['#6d28d9','#8b5cf6','#f0a500','#fcd34d','#06b6d4','#ffffff'];
  for(let i=0;i<55;i++){
    const p=document.createElement('div'); p.className='surprise-particle';
    p.style.cssText=`left:${Math.random()*100}%;top:${Math.random()*100}%;width:${2+Math.random()*4}px;height:${2+Math.random()*4}px;background:${colors[~~(Math.random()*colors.length)]};--tx:${(Math.random()-.5)*30}px;--ty:${(Math.random()-.5)*30}px;animation-delay:${Math.random()*.6}s;animation-duration:${1+Math.random()}s;`;
    c.appendChild(p);
  }
}
function spawnFireworks() {
  const c=document.getElementById('fireworks-container');
  const fw=()=>{
    const cx=Math.random()*window.innerWidth, cy=Math.random()*window.innerHeight*.6;
    const colors=['#f0a500','#fcd34d','#8b5cf6','#06b6d4','#ef4444','#10b981','#fff'];
    for(let i=0;i<30;i++){
      const p=document.createElement('div'); p.className='firework-particle';
      const angle=Math.random()*Math.PI*2, dist=50+Math.random()*150;
      p.style.cssText=`left:${cx}px;top:${cy}px;width:${3+Math.random()*4}px;height:${3+Math.random()*4}px;background:${colors[~~(Math.random()*colors.length)]};border-radius:50%;position:absolute;--fx:${Math.cos(angle)*dist}px;--fy:${Math.sin(angle)*dist}px;animation-delay:${Math.random()*.3}s;animation-duration:${.8+Math.random()*.5}s;`;
      c.appendChild(p);
      setTimeout(()=>p.remove(), 1500);
    }
  };
  let n=0; const iv=setInterval(()=>{ fw(); if(++n>12) clearInterval(iv); },400);
}

// ══════════════════════════════════════════
//  STAGE TRANSITION FX
// ══════════════════════════════════════════
function showTransition(icon, title, sub, color) {
  return new Promise(res=>{
    const ov=document.getElementById('transition-overlay');
    document.getElementById('transition-icon').textContent=icon;
    document.getElementById('transition-icon').style.color=color;
    document.getElementById('transition-title').textContent=title;
    document.getElementById('transition-title').style.color=color;
    document.getElementById('transition-sub').textContent=sub;
    ov.style.cssText='display:flex;opacity:0;transition:opacity .5s;';
    setTimeout(()=>ov.style.opacity='1',50);
    sfx.transition();
    setTimeout(()=>{ ov.style.opacity='0'; setTimeout(()=>{ ov.style.display='none'; res(); },500); },3200);
  });
}

// ══════════════════════════════════════════
//  QUESTION BANKS — 4 originals + 7 TV categories
// ══════════════════════════════════════════
const questionBanks = [
  // ============ 1. ثقافة عامة ============
  { name:'ثقافة عامة',
    imageQuestions:[
      {cat:'شخصيات', value:75, type:'image', title:'من هذا الشخص؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/440px-Albert_Einstein_Head.jpg', q:'من هذا العالم؟', a:'ألبرت أينشتاين', hint:'عالم فيزياء شهير'},
      {cat:'أماكن', value:75, type:'image', title:'ما هذه المعلمة؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Eiffel_Tower_%28tour_Eiffel%29%2C_Paris.jpg/440px-Eiffel_Tower_%28tour_Eiffel%29%2C_Paris.jpg', q:'ما اسم هذه المعلمة؟', a:'برج إيفل', hint:''},
      {cat:'حيوانات', value:75, type:'image', title:'ما هذا الحيوان؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Giraffe_standing.jpg/440px-Giraffe_standing.jpg', q:'ما هذا الحيوان؟', a:'زرافة', hint:''}
    ],
    musicQuestions:[
      {cat:'موسيقى', value:75, type:'music', title:'ما هذه الأغنية؟', audioUrl:'https://www.youtube.com/embed/ScMzIvxBSi4', parts:[{q:'ما اسم هذه الأغنية؟',a:'مقطوعة تجريبية'},{q:'من الأداء؟',a:'فنان'} ,{q:'في أي سنة؟',a:'معلومة'}]},
      {cat:'موسيقى', value:75, type:'music', title:'ما هذه الأغنية؟', audioUrl:'https://www.youtube.com/embed/YE7VzlLtp-4', parts:[{q:'ما اسم هذه الأغنية؟',a:'مقطوعة ثانية'},{q:'من الأداء؟',a:'فنان آخر'},{q:'في أي سنة؟',a:'معلومة'}]},
      {cat:'موسيقى', value:75, type:'music', title:'ما هذه الأغنية؟', audioUrl:'https://www.youtube.com/embed/2Vv-BfVoq4g', parts:[{q:'ما اسم هذه الأغنية؟',a:'مقطوعة ثالثة'},{q:'من الأداء؟',a:'مطرب'},{q:'في أي سنة؟',a:'معلومة'}]}
    ],
    puzzleQuestions:[
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'odd_one_out', title:'اكتشف المختلف', items:['تفاحة','موز','برتقال','حجر'], answer:'حجر', explanation:'الباقون فواكه'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'equation', title:'أكمل المعادلة', items:[], answer:'? = 4', explanation:'2 × 2 = 4'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'order', title:'رتّب الأحداث', items:['بداية','منتصف','نهاية','خاتمة'], answer:'بداية,منتصف,خاتمة,نهاية', explanation:'الترتيب الزمني'}
    ],
    silver:[
      {cat:'قادة ورؤساء', questions:[
        {v:100,q:'من هو القائد المسلم الذي فتح بلاد الأندلس؟',a:'طارق بن زياد'},
        {v:200,q:'من هو الملك السعودي الملقب بـ رائد التضامن الإسلامي؟',a:'الملك فيصل بن عبدالعزيز'},
        {v:300,q:'من هو القائد العباسي الذي فتح مدينة عمورية؟',a:'الخليفة المعتصم بالله'},
        {v:100,q:'من هو أول رئيس للولايات المتحدة الأمريكية؟',a:'جورج واشنطن'},
        {v:200,q:'من هو الملك المؤسس للمملكة العربية السعودية؟',a:'الملك عبدالعزيز آل سعود'},
        {v:300,q:'من هو رئيس الوزراء البريطاني في الحرب العالمية الثانية؟',a:'ونستون تشرشل'}]},
      {cat:'في يوم في شهر في سنة', questions:[
        {v:100,q:'في أي سنة هجرية حدثت الهجرة النبوية الشريفة؟',a:'1 هـ'},
        {v:200,q:'في أي عام ميلادي أُطلقت شبكة الإنترنت للعامة؟',a:'عام 1991 م'},
        {v:300,q:'في أي عام تأسست جامعة الدول العربية؟',a:'عام 1945 م'},
        {v:100,q:'في أي شهر ميلادي يبدأ فصل الربيع في نصف الكرة الشمالي؟',a:'مارس / آذار'},
        {v:200,q:'في أي عام سقطت الدولة العثمانية رسمياً؟',a:'عام 1924 م'},
        {v:300,q:'في أي عام هبط أول إنسان على سطح القمر؟',a:'عام 1969 م'}]},
      {cat:'كشكول', questions:[
        {v:100,q:'ما هو العنصر الكيميائي السائل في درجة الحرارة العادية؟',a:'الزئبق'},
        {v:200,q:'ما هي عاصمة جمهورية تونس؟',a:'تونس العاصمة'},
        {v:300,q:'ما اللقب الشهير لمدينة شيكاغو الأمريكية؟',a:'مدينة الرياح'},
        {v:100,q:'ما اسم أكبر صحراء في العالم؟',a:'الصحراء الكبرى'},
        {v:200,q:'ما هو أطول جسر معلق في العالم؟',a:'جسر أكاشي كايكيو في اليابان'},
        {v:300,q:'ما اسم المضيق الفاصل بين آسيا وأوروبا في تركيا؟',a:'مضيق البوسفور'}]}
    ],
    gold:[
      {cat:'كيف ولماذا؟', questions:[
        {v:500,q:'كيف يتنفس الجنين داخل رحم أمه؟',a:'عن طريق الحبل السري الذي ينقل الأكسجين من دم الأم'},
        {v:1000,q:'لماذا تظهر النجوم نهاراً ولكننا لا نراها؟',a:'بسبب شدة سطوع ضوء الشمس وتشتته في الغلاف الجوي'},
        {v:1500,q:'كيف تتكون الكهوف الجيرية تحت الأرض؟',a:'بسبب ذوبان الصخور بواسطة المياه الجوفية المحملة بثاني أكسيد الكربون'},
        {v:500,q:'كيف يحدث قوس قزح؟',a:'بانكسار وتشتت ضوء الشمس عبر قطرات المطر'},
        {v:1000,q:'لماذا يميل برج بيزا؟',a:'بسبب هبوط الأرض الطينية غير المتساوية تحت أساسه'},
        {v:1500,q:'كيف تحافظ الطيور المهاجرة على اتجاهها؟',a:'باستخدام المجال المغناطيسي للأرض والنجوم والشمس'}]},
      {cat:'الصفة المشتركة', questions:[
        {v:500,q:'ما الصفة المشتركة بين الأفوكادو والموز والطماطم نباتياً؟',a:'كلها تُصنف علمياً كـ ثمار (فواكه)'},
        {v:1000,q:'ما الصفة المشتركة بين عمان والكويت والمنامة وصنعاء؟',a:'كلها عواصم دول في شبه الجزيرة العربية'},
        {v:1500,q:'ما الصفة المشتركة بين غاز النيون والأرجون والكريبتون؟',a:'كلها غازات نبيلة (خاملة) في الجدول الدوري'},
        {v:500,q:'ما الصفة المشتركة بين الفهد والصقر والدلفين؟',a:'كلها من أسرع الحيوانات في بيئتها'},
        {v:1000,q:'ما الصفة المشتركة بين شكسبير وموليير وسوفوكليس؟',a:'كلهم من كبار كتّاب المسرح في التاريخ'},
        {v:1500,q:'ما الصفة المشتركة بين إينشتاين ونيوتن وهوكينغ؟',a:'كلهم فيزيائيون نظريون غيّروا فهمنا للكون'}]},
      {cat:'أكبر .. أصغر ..', questions:[
        {v:500,q:'ما هو أكبر المحيطات مساحةً في العالم؟',a:'المحيط الهادئ'},
        {v:1000,q:'ما هي أصغر دولة مستقلة في العالم؟',a:'دولة الفاتيكان'},
        {v:1500,q:'ما هي أكبر غدة في جسم الإنسان؟',a:'الكبد'},
        {v:500,q:'ما هي أكبر جزيرة في العالم؟',a:'جزيرة غرينلاند'},
        {v:1000,q:'ما هو أصغر عظم في جسم الإنسان؟',a:'عظم الركاب في الأذن الوسطى'},
        {v:1500,q:'ما هي أكبر شركة في العالم من حيث القيمة السوقية؟',a:'أرامكو السعودية / آبل (يتناوبان)'}]}
    ],
    speedBank:[
      {q:'ما عاصمة المملكة العربية السعودية؟',a:'الرياض'},
      {q:'كم عدد أيام الأسبوع؟',a:'سبعة أيام'},
      {q:'ما أطول نهر في العالم؟',a:'نهر النيل'},
      {q:'من رسم لوحة الموناليزا؟',a:'ليوناردو دافنشي'},
      {q:'كم عدد لاعبي كرة القدم في الفريق الواحد؟',a:'11 لاعباً'},
      {q:'ما عاصمة فرنسا؟',a:'باريس'},
      {q:'ما أكبر كوكب في المجموعة الشمسية؟',a:'المشتري'},
      {q:'كم عدد أشهر السنة؟',a:'12 شهراً'},
      {q:'ما عاصمة اليابان؟',a:'طوكيو'},
      {q:'ما لون دم الأخطبوط؟',a:'أزرق'},
      {q:'كم عين للنحلة؟',a:'خمس عيون'},
      {q:'من مؤلف رواية البؤساء؟',a:'فيكتور هوغو'}
    ]},

  // ============ 2. تاريخ إسلامي ============
  { name:'تاريخ إسلامي',
    imageQuestions:[
      {cat:'شخصيات', value:75, type:'image', title:'من هذا الصحابي؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Al-Bukhari.jpg/440px-Al-Bukhari.jpg', q:'من هذا الشخص؟', a:'أبو بكر الصديق (تمثيل تاريخي)', hint:''},
      {cat:'أماكن', value:75, type:'image', title:'ما هذا المكان؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Al-Masjid_al-Haram%2C_Makkah.jpg/440px-Al-Masjid_al-Haram%2C_Makkah.jpg', q:'ما اسم هذا المكان؟', a:'المسجد الحرام (مكة)', hint:''},
      {cat:'رموز', value:75, type:'image', title:'ما هذا الرمز؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Islamic_Crescent.svg/440px-Islamic_Crescent.svg.png', q:'ما هذا الرمز؟', a:'الهلال الإسلامي', hint:''}
    ],
    musicQuestions:[
      {cat:'موسيقى', value:75, type:'music', title:'أغنية تراثية', audioUrl:'https://www.youtube.com/embed/ScMzIvxBSi4', parts:[{q:'ما اسم المقطع؟',a:'مقطع تراثي'},{q:'من الأداء؟',a:'فنان'},{q:'من أين؟',a:'منطقة معينة'}]},
      {cat:'موسيقى', value:75, type:'music', title:'نشيد تاريخي', audioUrl:'https://www.youtube.com/embed/YE7VzlLtp-4', parts:[{q:'ما اسم النشيد؟',a:'نشيد'},{q:'من الأداء؟',a:'جوقة'},{q:'في أي مناسبة؟',a:'حدث تاريخي'}]},
      {cat:'موسيقى', value:75, type:'music', title:'مقطوعة', audioUrl:'https://www.youtube.com/embed/2Vv-BfVoq4g', parts:[{q:'ما اسم المقطوعة؟',a:'مقطوعة'},{q:'من الأداء؟',a:'مؤلف'},{q:'في أي عصر؟',a:'عصر'}]}
    ],
    puzzleQuestions:[
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'odd_one_out', title:'اختَر المختلف', items:['مسجد','كنيسة','معبد','قبر'], answer:'قبر', explanation:'الباقون أماكن عبادة'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'equation', title:'أكمل الجملة', items:[], answer:'مدينة النبي = مكة', explanation:'ميلاد النبي'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'order', title:'رتّب الشخصيات', items:['أبو بكر','عمر','عثمان','علي'], answer:'أبو بكر,عمر,عثمان,علي', explanation:''}
    ],
    silver:[
      {cat:'الخلفاء الراشدون', questions:[
        {v:100,q:'من هو أول الخلفاء الراشدين؟',a:'أبو بكر الصديق رضي الله عنه'},
        {v:200,q:'من هو الخليفة الراشد الذي جمع القرآن الكريم في مصحف واحد؟',a:'عثمان بن عفان رضي الله عنه'},
        {v:300,q:'كم امتدت فترة خلافة عمر بن الخطاب رضي الله عنه؟',a:'10 سنوات'},
        {v:100,q:'من هو الخليفة الراشد الرابع؟',a:'علي بن أبي طالب رضي الله عنه'},
        {v:200,q:'كم استمرت خلافة أبي بكر الصديق رضي الله عنه؟',a:'سنتان وثلاثة أشهر'},
        {v:300,q:'من هو الخليفة الذي دُوّن التاريخ الهجري في عهده؟',a:'عمر بن الخطاب رضي الله عنه'}]},
      {cat:'الفتوحات الإسلامية', questions:[
        {v:100,q:'من قاد فتح مصر في عهد عمر بن الخطاب؟',a:'عمرو بن العاص'},
        {v:200,q:'في أي عام فُتحت مكة المكرمة؟',a:'عام 8 هجري (630 م)'},
        {v:300,q:'من هو القائد الذي فتح بلاد فارس؟',a:'سعد بن أبي وقاص'},
        {v:100,q:'من هو فاتح القسطنطينية؟',a:'السلطان محمد الفاتح العثماني'},
        {v:200,q:'في أي معركة انتصر المسلمون على الفرس فتحاً حاسماً؟',a:'معركة القادسية'},
        {v:300,q:'من هو القائد الذي فتح بلاد الشام؟',a:'أبو عبيدة بن الجراح وخالد بن الوليد'}]},
      {cat:'العلماء والحضارة', questions:[
        {v:100,q:'من هو العالم المسلم الذي يُلقب بأبي الطب؟',a:'ابن سينا'},
        {v:200,q:'ما اسم العالم المسلم الذي اخترع الجبر؟',a:'الخوارزمي'},
        {v:300,q:'في أي مدينة يقع الجامع الأزهر الشريف؟',a:'القاهرة'},
        {v:100,q:'من هو مؤسس علم الاجتماع؟',a:'ابن خلدون'},
        {v:200,q:'من هو الطبيب المسلم مؤلف كتاب "القانون في الطب"؟',a:'ابن سينا'},
        {v:300,q:'من هو العالم المسلم الذي وضع أسس علم البصريات؟',a:'ابن الهيثم'}]}
    ],
    gold:[
      {cat:'غزوات النبي ﷺ', questions:[
        {v:500,q:'ما هي أول غزوة في الإسلام؟',a:'غزوة بدر الكبرى'},
        {v:1000,q:'كم عدد المشركين الذين قُتلوا في غزوة بدر؟',a:'70 مشركاً'},
        {v:1500,q:'في أي سنة هجرية وقعت غزوة الأحزاب (الخندق)؟',a:'السنة الخامسة الهجرية'},
        {v:500,q:'ما اسم الغزوة التي شارك فيها النبي ﷺ ولم يقع فيها قتال؟',a:'غزوة تبوك'},
        {v:1000,q:'في أي غزوة استُشهد سيدنا حمزة رضي الله عنه؟',a:'غزوة أحد'},
        {v:1500,q:'كم بلغ عدد المسلمين في غزوة حنين؟',a:'12 ألف مقاتل'}]},
      {cat:'الدول الإسلامية', questions:[
        {v:500,q:'ما عاصمة الدولة الأموية؟',a:'دمشق'},
        {v:1000,q:'من هو مؤسس الدولة العباسية؟',a:'أبو العباس السفاح'},
        {v:1500,q:'كم امتدت الخلافة العثمانية؟',a:'نحو 600 سنة (1299-1924م)'},
        {v:500,q:'ما اسم عاصمة الدولة الفاطمية؟',a:'القاهرة'},
        {v:1000,q:'من هو مؤسس الدولة الأيوبية؟',a:'صلاح الدين الأيوبي'},
        {v:1500,q:'ما اسم عاصمة الدولة العباسية؟',a:'بغداد'}]},
      {cat:'السيرة النبوية', questions:[
        {v:500,q:'في أي مدينة وُلد النبي محمد ﷺ؟',a:'مكة المكرمة'},
        {v:1000,q:'كم عمر النبي ﷺ عند نزول الوحي؟',a:'40 سنة'},
        {v:1500,q:'ما اسم زوجة النبي ﷺ الأولى؟',a:'السيدة خديجة بنت خويلد'},
        {v:500,q:'كم عاش النبي ﷺ سنة؟',a:'63 سنة'},
        {v:1000,q:'ما اسم مرضعة النبي ﷺ؟',a:'حليمة السعدية'},
        {v:1500,q:'كم كان عمر النبي ﷺ عند وفاة والدته آمنة؟',a:'6 سنوات'}]}
    ],
    speedBank:[
      {q:'كم عدد أركان الإسلام؟',a:'خمسة أركان'},
      {q:'ما اسم جبل نزول الوحي؟',a:'جبل النور (غار حراء)'},
      {q:'من هو صاحب النبي ﷺ في الهجرة؟',a:'أبو بكر الصديق'},
      {q:'ما أول سورة نزلت في القرآن الكريم؟',a:'سورة العلق'},
      {q:'كم عدد سور القرآن الكريم؟',a:'114 سورة'},
      {q:'في أي شهر يصوم المسلمون؟',a:'شهر رمضان'},
      {q:'كم مرة يصلي المسلم في اليوم؟',a:'خمس صلوات'},
      {q:'ما هي أطول سورة في القرآن الكريم؟',a:'سورة البقرة'},
      {q:'من هو خاتم الأنبياء والمرسلين؟',a:'محمد ﷺ'},
      {q:'كم عدد المسلمين في غزوة بدر؟',a:'313 مسلماً'}
    ]},

  // ============ 3. علوم وجغرافيا ============
  { name:'علوم وجغرافيا',
    imageQuestions:[
      {cat:'أماكن', value:75, type:'image', title:'ما هذه البحيرة؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Crater_Lake_Oregon.jpg/440px-Crater_Lake_Oregon.jpg', q:'ما اسم هذه البحيرة؟', a:'بحيرة كريتر', hint:''},
      {cat:'حيوانات', value:75, type:'image', title:'ما هذا الحيوان؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Blue_whale_3.jpg/440px-Blue_whale_3.jpg', q:'ما هذا الحيوان؟', a:'الحوت الأزرق', hint:''},
      {cat:'نجوم', value:75, type:'image', title:'ما هذا التلسكوب؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/James_Webb_Space_Telescope.jpg/440px-James_Webb_Space_Telescope.jpg', q:'ما اسم هذا التلسكوب؟', a:'تلسكوب جيمس ويب', hint:''}
    ],
    musicQuestions:[
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى طبيعية', audioUrl:'https://www.youtube.com/embed/ScMzIvxBSi4', parts:[{q:'ما اسم المقطع؟',a:'مقطع طبيعي'},{q:'أين التقط؟',a:'مكان'},{q:'أي ظاهرة؟',a:'معلومة'}]},
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى فضاء', audioUrl:'https://www.youtube.com/embed/YE7VzlLtp-4', parts:[{q:'ما اسم المقطع؟',a:'فضاء'},{q:'من الأداء؟',a:'مؤلف'},{q:'في أي سنة؟',a:'معلومة'}]},
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى تعليمية', audioUrl:'https://www.youtube.com/embed/2Vv-BfVoq4g', parts:[{q:'ما هدفها؟',a:'تبسيط'},{q:'لمن؟',a:'طلاب'},{q:'أي موضوع؟',a:'علوم'}]}
    ],
    puzzleQuestions:[
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'odd_one_out', title:'اكتشف المختلف', items:['نهر','بحر','محيط','جبل'], answer:'جبل', explanation:'الباقون مسطحات مائية'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'equation', title:'ما ناتج 2×?=8', items:[], answer:'?=4', explanation:''},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'order', title:'رتّب الكواكب حسب القرب', items:['المريخ','الأرض','عطارد','الزهرة'], answer:'عطارد,الزهرة,الأرض,المريخ', explanation:''}
    ],
    silver:[
      {cat:'الجغرافيا العربية', questions:[
        {v:100,q:'ما أكبر دولة عربية مساحةً؟',a:'الجزائر'},
        {v:200,q:'ما اسم البحر الذي يفصل المغرب العربي عن أوروبا؟',a:'البحر الأبيض المتوسط'},
        {v:300,q:'كم عدد الدول الأعضاء في جامعة الدول العربية؟',a:'22 دولة'},
        {v:100,q:'ما هي أصغر دولة عربية مساحةً؟',a:'البحرين'},
        {v:200,q:'ما اسم النهر الذي يمر بمصر والسودان؟',a:'نهر النيل'},
        {v:300,q:'ما اسم أعلى جبل في الوطن العربي؟',a:'جبل توبقال في المغرب'}]},
      {cat:'عالم الحيوان', questions:[
        {v:100,q:'ما الحيوان الذي يُعرف بسفينة الصحراء؟',a:'الجمل'},
        {v:200,q:'ما أسرع حيوان بري في العالم؟',a:'الفهد'},
        {v:300,q:'ما الحيوان الذي له أطول عنق في العالم؟',a:'الزرافة'},
        {v:100,q:'ما هو الحيوان الذي يُعد ملك الغابة؟',a:'الأسد'},
        {v:200,q:'ما اسم الحيوان الأضخم على وجه الأرض؟',a:'الحوت الأزرق'},
        {v:300,q:'ما الطائر الوحيد القادر على الطيران للخلف؟',a:'الطائر الطنّان (الرفراف)'}]},
      {cat:'الكون والفضاء', questions:[
        {v:100,q:'ما أقرب كوكب للشمس؟',a:'عطارد'},
        {v:200,q:'كم يبلغ عدد كواكب المجموعة الشمسية؟',a:'8 كواكب'},
        {v:300,q:'ما اسم أكبر تلسكوب فضائي في التاريخ؟',a:'تلسكوب جيمس ويب'},
        {v:100,q:'ما اسم مجرتنا؟',a:'مجرة درب التبانة'},
        {v:200,q:'كم قمراً لكوكب المريخ؟',a:'قمران (فوبوس وديموس)'},
        {v:300,q:'ما اسم أول قمر صناعي أُطلق إلى الفضاء؟',a:'سبوتنيك 1 عام 1957'}]}
    ],
    gold:[
      {cat:'الاختراعات والاكتشافات', questions:[
        {v:500,q:'من اخترع الهاتف؟',a:'ألكسندر غراهام بيل'},
        {v:1000,q:'من اكتشف قانون الجاذبية؟',a:'إسحاق نيوتن'},
        {v:1500,q:'في أي عام اخترع الأخوان رايت الطائرة؟',a:'عام 1903 م'},
        {v:500,q:'من اخترع المصباح الكهربائي؟',a:'توماس إديسون'},
        {v:1000,q:'من اكتشف البنسلين؟',a:'ألكسندر فليمنغ'},
        {v:1500,q:'من اخترع الطباعة الحديثة؟',a:'يوهانس غوتنبرغ'}]},
      {cat:'العلوم والكيمياء', questions:[
        {v:500,q:'ما الرمز الكيميائي للذهب؟',a:'Au'},
        {v:1000,q:'ما عدد العناصر في الجدول الدوري الحديث؟',a:'118 عنصراً'},
        {v:1500,q:'ما أخف العناصر في الجدول الدوري؟',a:'الهيدروجين'},
        {v:500,q:'ما الرمز الكيميائي للماء؟',a:'H₂O'},
        {v:1000,q:'من واضع الجدول الدوري للعناصر؟',a:'ديمتري مندلييف'},
        {v:1500,q:'ما اسم العملية التي تحوّل السائل إلى غاز عند الحرارة؟',a:'التبخر'}]},
      {cat:'عجائب العالم', questions:[
        {v:500,q:'في أي دولة توجد أهرامات الجيزة؟',a:'جمهورية مصر العربية'},
        {v:1000,q:'ما أطول سور في التاريخ البشري؟',a:'سور الصين العظيم'},
        {v:1500,q:'في أي مدينة يقع برج إيفل؟',a:'باريس، فرنسا'},
        {v:500,q:'أين يقع تاج محل؟',a:'مدينة أغرا الهندية'},
        {v:1000,q:'ما اسم المدينة الوردية القديمة في الأردن؟',a:'مدينة البتراء'},
        {v:1500,q:'ما هو أطول جبل جليدي في العالم؟',a:'جبل إيفرست (فوق البحر) — أطول قمة'}]}
    ],
    speedBank:[
      {q:'ما أكبر قارة في العالم؟',a:'قارة آسيا'},
      {q:'كم عدد قارات العالم؟',a:'7 قارات'},
      {q:'ما أعمق بحيرة في العالم؟',a:'بحيرة بايكال'},
      {q:'ما أعلى جبل في العالم؟',a:'إيفرست'},
      {q:'ما عاصمة اليابان؟',a:'طوكيو'},
      {q:'ما عاصمة البرازيل؟',a:'برازيليا'},
      {q:'كم كيلومتراً يبلغ محيط الأرض تقريباً؟',a:'40,000 كيلومتر'},
      {q:'ما أكبر محيطات العالم؟',a:'المحيط الهادئ'},
      {q:'كم عدد عظام الإنسان البالغ؟',a:'206 عظمة'},
      {q:'ما سرعة الضوء تقريباً؟',a:'300,000 كم/ثانية'}
    ]},

  // ============ 4. رياضة وفنون ============
  { name:'رياضة وفنون',
    imageQuestions:[
      {cat:'رياضة', value:75, type:'image', title:'من هذا اللاعب؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Lionel_Messi_20180626.jpg/440px-Lionel_Messi_20180626.jpg', q:'من هذا اللاعب؟', a:'ليونيل ميسي', hint:''},
      {cat:'فنون', value:75, type:'image', title:'ما هذه اللوحة؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Starry_Night_Over_the_Rhone.jpg/440px-Starry_Night_Over_the_Rhone.jpg', q:'ما اسم هذه اللوحة؟', a:'ليلة مرصعة بالنجوم (ستورِّي)', hint:''},
      {cat:'سينما', value:75, type:'image', title:'من هذا المخرج؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Steven_Spielberg_by_Gage_Skidmore.jpg/440px-Steven_Spielberg_by_Gage_Skidmore.jpg', q:'من هذا المخرج؟', a:'ستيفن سبيلبرغ', hint:''}
    ],
    musicQuestions:[
      {cat:'موسيقى', value:75, type:'music', title:'أغنية مشهورة', audioUrl:'https://www.youtube.com/embed/ScMzIvxBSi4', parts:[{q:'ما اسمها؟',a:'أغنية'},{q:'من غنّاها؟',a:'مطرب'},{q:'سنة الإصدار؟',a:'معلومة'}]},
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى فيلم', audioUrl:'https://www.youtube.com/embed/YE7VzlLtp-4', parts:[{q:'اسم الفيلم؟',a:'فيلم'},{q:'الملحن؟',a:'ملحن'},{q:'ما هي المشهد؟',a:'وصف'}]},
      {cat:'موسيقى', value:75, type:'music', title:'مقطوعة كلاسيكية', audioUrl:'https://www.youtube.com/embed/2Vv-BfVoq4g', parts:[{q:'المؤلف؟',a:'مؤلف'},{q:'الحقبة؟',a:'حقبة'},{q:'الآلات؟',a:'آلات'}]}
    ],
    puzzleQuestions:[
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'odd_one_out', title:'من المختلف؟', items:['كرة','لاعبة','ملعب','مسرح'], answer:'مسرح', explanation:'باقي مرتبطة بالرياضة'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'equation', title:'أكمل', items:[], answer:'2+2=4', explanation:''},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'order', title:'رتّب الأدوات', items:['كيبورد','قيثارة','طبلة','ساكسفون'], answer:'قيثارة,كيبورد,ساكسفون,طبلة', explanation:''}
    ],
    silver:[
      {cat:'كرة القدم', questions:[
        {v:100,q:'كم مرة فازت البرازيل بكأس العالم؟',a:'5 مرات'},
        {v:200,q:'في أي دولة أُقيمت كأس العالم 2022؟',a:'قطر'},
        {v:300,q:'من هو هداف كأس العالم على مر التاريخ؟',a:'ميروسلاف كلوزه (16 هدفاً)'},
        {v:100,q:'ما اسم الملعب الوطني لريال مدريد؟',a:'ملعب سانتياغو برنابيو'},
        {v:200,q:'من هو أفضل لاعب في العالم لعام 2022؟',a:'ليونيل ميسي'},
        {v:300,q:'ما هي أعرق بطولة أوروبية للأندية؟',a:'دوري أبطال أوروبا (UEFA Champions League)'}]},
      {cat:'الرياضات الأولمبية', questions:[
        {v:100,q:'كم حلقة في شعار الألعاب الأولمبية؟',a:'5 حلقات'},
        {v:200,q:'في أي مدينة أُقيمت أول ألعاب أولمبية حديثة؟',a:'أثينا 1896 م'},
        {v:300,q:'من هو أكثر رياضي فوزاً بالميداليات الأولمبية؟',a:'مايكل فيلبس (23 ذهبية)'},
        {v:100,q:'كم سنة تُقام بين نسخ الأولمبياد الصيفية؟',a:'كل 4 سنوات'},
        {v:200,q:'في أي دولة أُقيمت أولمبياد طوكيو 2020؟',a:'اليابان'},
        {v:300,q:'ما اسم أقدم رياضة أولمبية؟',a:'السباق (الجري) 776 ق.م'}]},
      {cat:'الفنون والموسيقى', questions:[
        {v:100,q:'من ألّف سيمفونية القدر الخامسة الشهيرة؟',a:'بيتهوفن'},
        {v:200,q:'ما اسم أشهر لوحات فان غوخ؟',a:'ليلة النجوم'},
        {v:300,q:'في أي دولة وُلد الفنان بيكاسو؟',a:'إسبانيا'},
        {v:100,q:'من هو ملقب بموسيقار الأجيال؟',a:'محمد عبد الوهاب'},
        {v:200,q:'ما اسم أشهر ألحان موتسارت للأطفال؟',a:'كوكب النجوم الصغيرة (Twinkle Twinkle)'},
        {v:300,q:'من هو مؤلف "الأزمنة الأربعة" في الموسيقى الكلاسيكية؟',a:'أنطونيو فيفالدي'}]}
    ],
    gold:[
      {cat:'أبطال رياضيون', questions:[
        {v:500,q:'من هو أسرع عداء في تاريخ البشرية؟',a:'أوساين بولت'},
        {v:1000,q:'كم مرة فاز محمد علي كلاي ببطولة العالم للملاكمة؟',a:'3 مرات'},
        {v:1500,q:'من هو الملاكم الذي لُقب بـ الأعظم؟',a:'محمد علي كلاي'},
        {v:500,q:'من هو اللاعب الملقب بـ"صاروخ نجران" في كرة القدم السعودية؟',a:'ماجد عبدالله'},
        {v:1000,q:'من هو اللاعب الذي حصل على الكرة الذهبية أكثر من غيره؟',a:'ليونيل ميسي (8 مرات)'},
        {v:1500,q:'من هو أشهر لاعب تنس رجالي في القرن الحادي والعشرين؟',a:'روجر فيدرر / رافائيل نادال / نوفاك ديوكوفيتش'}]},
      {cat:'السينما والتلفزيون', questions:[
        {v:500,q:'ما أعلى فيلم إيراداً في تاريخ السينما؟',a:'فيلم أفاتار'},
        {v:1000,q:'كم عدد أفلام سلسلة حرب النجوم الرئيسية؟',a:'9 أفلام'},
        {v:1500,q:'من هو مؤسس شركة والت ديزني؟',a:'والت ديزني'},
        {v:500,q:'ما اسم أول فيلم كرتوني ناطق طويل؟',a:'بياض الثلج والأقزام السبعة (1937)'},
        {v:1000,q:'من هو أول ممثل عربي يفوز بجائزة الأوسكار؟',a:'أحمد الحداد (مصمم الديكور 1963)'},
        {v:1500,q:'ما اسم أول فيلم تم تصويره بتقنية IMAX؟',a:'"North of Superior" 1971'}]},
      {cat:'الأدب العالمي', questions:[
        {v:500,q:'من كتب رواية مئة عام من العزلة؟',a:'غابريال غارسيا ماركيز'},
        {v:1000,q:'من هو مؤلف قصص شيرلوك هولمز؟',a:'آرثر كونان دويل'},
        {v:1500,q:'من هو أول عربي يحصل على جائزة نوبل للأدب؟',a:'نجيب محفوظ'},
        {v:500,q:'من كتب مسرحية "روميو وجولييت"؟',a:'ويليام شكسبير'},
        {v:1000,q:'من مؤلف "الجريمة والعقاب"؟',a:'فيودور دوستويفسكي'},
        {v:1500,q:'من كتب رواية "الشيخ والبحر"؟',a:'إرنست همنغواي'}]}
    ],
    speedBank:[
      {q:'كم لاعباً في فريق كرة السلة؟',a:'5 لاعبين'},
      {q:'ما عدد أشواط مباراة كرة القدم؟',a:'شوطان'},
      {q:'ما رياضة تُلعب بمضرب وريشة؟',a:'الريشة الطائرة (البادمنتون)'},
      {q:'كم دقيقة يستمر كل شوط في كرة القدم؟',a:'45 دقيقة'},
      {q:'في أي رياضة يُستخدم مصطلح "هوم ران"؟',a:'البيسبول'},
      {q:'ما اسم بطولة كرة القدم الأوروبية للأندية؟',a:'دوري أبطال أوروبا'},
      {q:'كم طول ملعب كرة القدم القياسي؟',a:'105 متر'},
      {q:'ما الرياضة التي يلعبها روجر فيدرر؟',a:'التنس'}
    ]},

  // ============ 5. الدين والعلوم الإسلامية ============
  { name:'الدين والعلوم الإسلامية',
    imageQuestions:[
      {cat:'شخصيات', value:75, type:'image', title:'من هذا العالم؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Ibn_Sina_portrait.jpg/440px-Ibn_Sina_portrait.jpg', q:'من هذا؟', a:'ابن سينا (تمثيل)', hint:''},
      {cat:'مواقع', value:75, type:'image', title:'ما هذا المسجد؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Al-Azhar_Mosque_Cairo.jpg/440px-Al-Azhar_Mosque_Cairo.jpg', q:'ما اسم هذا المسجد؟', a:'الجامع الأزهر', hint:''},
      {cat:'رموز', value:75, type:'image', title:'ما هذا؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Calligraphy_Muhammad.jpg/440px-Calligraphy_Muhammad.jpg', q:'ما هذا؟', a:'خط عربي لكلمة محمد', hint:''}
    ],
    musicQuestions:[
      {cat:'موسيقى', value:75, type:'music', title:'نشيد ديني', audioUrl:'https://www.youtube.com/embed/ScMzIvxBSi4', parts:[{q:'ما اسمه؟',a:'نشيد'},{q:'من الأداء؟',a:'جوقة'},{q:'أين يؤدى؟',a:'مناسبة'}]},
      {cat:'موسيقى', value:75, type:'music', title:'مقام عربي', audioUrl:'https://www.youtube.com/embed/YE7VzlLtp-4', parts:[{q:'ما اسمه؟',a:'مقام'},{q:'أداه؟',a:'عازف'},{q:'أي آلة؟',a:'عود'}]},
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى تراثية', audioUrl:'https://www.youtube.com/embed/2Vv-BfVoq4g', parts:[{q:'اسمها؟',a:'مقطوعة'},{q:'من أين؟',a:'منطقة'},{q:'المضمون؟',a:'موضوع'}]}
    ],
    puzzleQuestions:[
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'odd_one_out', title:'من المختلف؟', items:['مسجد','كنيسة','معبد','مقبرة'], answer:'مقبرة', explanation:'الباقون أماكن عبادة'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'equation', title:'اكمل', items:[], answer:'المدينة = مكة', explanation:''},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'order', title:'رتب الخلفاء', items:['أبو بكر','عمر','عثمان'], answer:'أبو بكر,عمر,عثمان', explanation:''}
    ],
    silver:[
      {cat:'الدين والعلوم الإسلامية', questions:[
        {v:100,q:'ما هي أركان الإيمان؟',a:'ستة: الإيمان بالله وملائكته وكتبه ورسله واليوم الآخر والقدر خيره وشره'},
        {v:200,q:'كم عدد أجزاء القرآن الكريم؟',a:'30 جزءاً'},
        {v:300,q:'ما هي السورة التي تُسمى قلب القرآن؟',a:'سورة يس'}]},
      {cat:'الفقه والعبادات', questions:[
        {v:100,q:'كم عدد الفروض في الصلاة؟',a:'14 فرضاً'},
        {v:200,q:'ما هو نصاب الزكاة في الذهب؟',a:'85 جراماً (20 مثقالاً)'},
        {v:300,q:'ما هي المواقيت المكانية للحج؟',a:'خمسة: ذو الحليفة، الجحفة، قرن المنازل، يلملم، ذات عرق'}]},
      {cat:'التفسير والحديث', questions:[
        {v:100,q:'من هو أشهر مفسر للقرآن الكريم من الصحابة؟',a:'عبد الله بن عباس رضي الله عنه'},
        {v:200,q:'ما اسم أشهر كتب الحديث الصحيحة؟',a:'صحيح البخاري وصحيح مسلم'},
        {v:300,q:'كم عدد أحاديث صحيح البخاري تقريباً؟',a:'حوالي 7,275 حديثاً'}]}
    ],
    gold:[
      {cat:'الدين والعلوم الإسلامية', questions:[
        {v:500,q:'كم مرة ذُكر اسم النبي محمد ﷺ في القرآن الكريم؟',a:'4 مرات باسم محمد ومرة باسم أحمد'},
        {v:1000,q:'ما هي السورة التي لا تبدأ بالبسملة؟',a:'سورة التوبة (براءة)'},
        {v:1500,q:'ما اسم أول شهيد في الإسلام؟',a:'سُميّة أم عمار بن ياسر رضي الله عنها'}]},
      {cat:'أصول الفقه', questions:[
        {v:500,q:'من هو مؤسس المذهب الحنفي؟',a:'الإمام أبو حنيفة النعمان'},
        {v:1000,q:'كم عدد المذاهب الفقهية السنية الكبرى؟',a:'أربعة (الحنفي والمالكي والشافعي والحنبلي)'},
        {v:1500,q:'من هو مؤلف كتاب الرسالة في أصول الفقه؟',a:'الإمام محمد بن إدريس الشافعي'}]},
      {cat:'الأنبياء والرسل', questions:[
        {v:500,q:'من هو أبو الأنبياء؟',a:'إبراهيم عليه السلام'},
        {v:1000,q:'كم عدد الأنبياء أولو العزم من الرسل؟',a:'خمسة (نوح، إبراهيم، موسى، عيسى، محمد ﷺ)'},
        {v:1500,q:'من هو النبي الذي تُنسب إليه المزامير؟',a:'داود عليه السلام'}]}
    ],
    speedBank:[
      {q:'كم عدد ركعات صلاة الفجر؟',a:'ركعتان'},
      {q:'كم عدد ركعات صلاة الظهر؟',a:'أربع ركعات'},
      {q:'أين وُلد النبي ﷺ؟',a:'مكة المكرمة'},
      {q:'ما اسم غار اختبأ فيه النبي ﷺ في الهجرة؟',a:'غار ثور'},
      {q:'من هي أم المؤمنين عائشة رضي الله عنها ابنة من؟',a:'أبو بكر الصديق'},
      {q:'ما هو ركن الحج الأعظم؟',a:'الوقوف بعرفة'},
      {q:'من هو النبي الذي ابتلعه الحوت؟',a:'يونس عليه السلام'},
      {q:'ما اسم سيف النبي محمد ﷺ الشهير؟',a:'ذو الفقار'},
      {q:'كم عدد التكبيرات في صلاة العيد؟',a:'12 تكبيرة (7 في الأولى و5 في الثانية)'},
      {q:'ما هي ليلة القدر؟',a:'ليلة خير من ألف شهر في العشر الأواخر من رمضان'},
      {q:'كم عدد ركعات صلاة العشاء؟',a:'أربع ركعات'},
      {q:'ما اسم أطول سورة في القرآن؟',a:'سورة البقرة'},
      {q:'ما اسم أقصر سورة في القرآن؟',a:'سورة الكوثر'},
      {q:'من هو النبي الذي كلّم الله موسى بجانبه؟',a:'موسى عليه السلام (كليم الله)'},
      {q:'كم عدد أبواب الجنة؟',a:'ثمانية أبواب'},
      {q:'ما اسم الملَك الموكل بالوحي؟',a:'جبريل عليه السلام'},
      {q:'كم يوماً صام النبي ﷺ في السنة الأولى للهجرة؟',a:'يوم عاشوراء'},
      {q:'من هي أول من أسلم من النساء؟',a:'خديجة بنت خويلد رضي الله عنها'},
      {q:'كم عدد مرات الطواف حول الكعبة؟',a:'سبعة أشواط'},
      {q:'ما اسم الملَك الموكل بقبض الأرواح؟',a:'ملك الموت (عزرائيل)'}
    ]},

  // ============ 6. اللغات والآداب ============
  { name:'اللغات والآداب',
    imageQuestions:[
      {cat:'أدب', value:75, type:'image', title:'من هذا الكاتب؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/James_Joyce_by_Paul_Henri.jpg/440px-James_Joyce_by_Paul_Henri.jpg', q:'من هذا الكاتب؟', a:'جيمس جويس', hint:''},
      {cat:'لغات', value:75, type:'image', title:'ما هذه المخطوطة؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Old_arabic_manuscript.jpg/440px-Old_arabic_manuscript.jpg', q:'ما هذه؟', a:'مخطوطة قديمة', hint:''},
      {cat:'شعر', value:75, type:'image', title:'من هذا الشاعر؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Naguib_Mahfouz.jpg/440px-Naguib_Mahfouz.jpg', q:'من هذا الكاتب؟', a:'نجيب محفوظ', hint:''}
    ],
    musicQuestions:[
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى شعرية', audioUrl:'https://www.youtube.com/embed/ScMzIvxBSi4', parts:[{q:'موضوع القصيدة؟',a:'حب'},{q:'الكاتب؟',a:'شاعر'},{q:'الحقبة؟',a:'عصر'}]},
      {cat:'موسيقى', value:75, type:'music', title:'مقطوعة أدبية', audioUrl:'https://www.youtube.com/embed/YE7VzlLtp-4', parts:[{q:'ما اسمها؟',a:'مقطوعة'},{q:'من الأداء؟',a:'منشد'},{q:'المصدر؟',a:'قصيدة'}]},
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى متصلة بالأدب', audioUrl:'https://www.youtube.com/embed/2Vv-BfVoq4g', parts:[{q:'ما هي؟',a:'مقطوعة'},{q:'الملحن؟',a:'ملحن'},{q:'النوع؟',a:'نوع'}]}
    ],
    puzzleQuestions:[
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'odd_one_out', title:'اختَر المختلف', items:['قافية','وزن','بيت','قلم'], answer:'قلم', explanation:'الباقي عناصر شعرية'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'equation', title:'املأ الفراغ', items:[], answer:'باريس عاصمة فرنسا', explanation:''},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'order', title:'رتب قسمات القصة', items:['المقدمة','العقدة','الحل'], answer:'المقدمة,العقدة,الحل', explanation:''}
    ],
    silver:[
      {cat:'اللغات والآداب', questions:[
        {v:100,q:'ما هي اللغة الأكثر انتشاراً في العالم من حيث الناطقين الأصليين؟',a:'الصينية (الماندرين)'},
        {v:200,q:'كم عدد حروف اللغة العربية؟',a:'28 حرفاً'},
        {v:300,q:'ما اسم أقدم لغة سامية مكتوبة؟',a:'الأكادية'}]},
      {cat:'الأدب العربي', questions:[
        {v:100,q:'من هو الشاعر الملقب بأمير الشعراء؟',a:'أحمد شوقي'},
        {v:200,q:'من كتب رواية "زقاق المدق"؟',a:'نجيب محفوظ'},
        {v:300,q:'ما اسم أشهر معلقة للشاعر امرؤ القيس؟',a:'قفا نبك من ذكرى حبيب ومنزل'}]},
      {cat:'الأدب العالمي', questions:[
        {v:100,q:'من هو مؤلف مسرحية "روميو وجولييت"؟',a:'ويليام شكسبير'},
        {v:200,q:'من كتب رواية "الحرب والسلام"؟',a:'ليو تولستوي'},
        {v:300,q:'ما اسم رواية باولو كويلو الأشهر؟',a:'الخيميائي'}]}
    ],
    gold:[
      {cat:'اللغات والآداب', questions:[
        {v:500,q:'من هو مؤلف قصيدة "الإلياذة"؟',a:'الشاعر الإغريقي هوميروس'},
        {v:1000,q:'ما اسم أقدم قصة مكتوبة في التاريخ؟',a:'ملحمة جلجامش'},
        {v:1500,q:'من هو صاحب كتاب "لسان العرب"؟',a:'ابن منظور'}]},
      {cat:'شعراء وأدباء', questions:[
        {v:500,q:'من هو الشاعر الجاهلي الذي علّق قصائده على الكعبة؟',a:'أصحاب المعلقات (امرؤ القيس وغيره)'},
        {v:1000,q:'من كتب رواية "البؤساء"؟',a:'فيكتور هوغو'},
        {v:1500,q:'من هو الشاعر الذي لُقب بالمتنبي؟',a:'أبو الطيب أحمد بن الحسين'}]},
      {cat:'جوائز أدبية', questions:[
        {v:500,q:'ما اسم أرفع جائزة أدبية عالمية؟',a:'جائزة نوبل للأدب'},
        {v:1000,q:'في أي عام حصل نجيب محفوظ على نوبل؟',a:'عام 1988'},
        {v:1500,q:'من هي أول امرأة عربية تحصل على جائزة البوكر العالمية؟',a:'الجزائرية أحلام مستغانمي (اسم مرشح شهير) — أو الفلسطينية عدنية شبلي'}]}
    ],
    speedBank:[
      {q:'ما هي أطول كلمة في اللغة العربية؟',a:'فأسقيناكموه'},
      {q:'من هو صاحب "كليلة ودمنة"؟',a:'ابن المقفع'},
      {q:'من كتب "دون كيشوت"؟',a:'ميغيل دي ثيربانتس'},
      {q:'ما اسم رواية دستويفسكي الأشهر؟',a:'الجريمة والعقاب'},
      {q:'ما هي لغة "الفيدا" المقدسة؟',a:'السنسكريتية'},
      {q:'من مؤلف "ألف ليلة وليلة"؟',a:'مجهول (تراث شعبي)'},
      {q:'من هو شاعر النيل؟',a:'حافظ إبراهيم'},
      {q:'ما اسم أول رواية في الأدب العربي الحديث؟',a:'زينب لمحمد حسين هيكل'},
      {q:'من هو مؤلف "هاملت"؟',a:'ويليام شكسبير'},
      {q:'ما اللغة الرسمية للأمم المتحدة الأكثر انتشاراً؟',a:'الإنجليزية'},
      {q:'من هو مؤلف "الأمير الصغير"؟',a:'أنطوان دو سانت إكزوبيري'},
      {q:'كم عدد اللغات الرسمية في الأمم المتحدة؟',a:'ستة لغات'},
      {q:'من هو أبو الشعر العربي الحديث؟',a:'خليل مطران'},
      {q:'من كتب "أوليس"؟',a:'جيمس جويس'},
      {q:'ما اسم قصيدة نزار قباني الشهيرة؟',a:'قارئة الفنجان'},
      {q:'من هو مؤلف "الملك لير"؟',a:'ويليام شكسبير'},
      {q:'ما اسم اللغة السامية الأم؟',a:'الآرامية / الأكادية'},
      {q:'من هو مؤسس المسرح العربي الحديث؟',a:'مارون النقاش'},
      {q:'ما اسم أول قاموس في اللغة العربية؟',a:'كتاب العين للخليل بن أحمد الفراهيدي'},
      {q:'من كتب "مدام بوفاري"؟',a:'غوستاف فلوبير'}
    ]},
    // --- New banks loader: registers EXTRA_BANKS for runtime use ---
    (function(){
      try{
        window.EXTRA_BANKS = window.EXTRA_BANKS || [];
        if (typeof healthBank !== 'undefined') window.EXTRA_BANKS.push(healthBank);
        if (typeof sportsBank !== 'undefined') window.EXTRA_BANKS.push(sportsBank);
        if (typeof spaceBank !== 'undefined') window.EXTRA_BANKS.push(spaceBank);
        if (typeof foodBank !== 'undefined') window.EXTRA_BANKS.push(foodBank);
        if (typeof animalsBank !== 'undefined') window.EXTRA_BANKS.push(animalsBank);
        if (typeof worldHistoryBank !== 'undefined') window.EXTRA_BANKS.push(worldHistoryBank);
        // Optional: if the app exposes a topic-refresh hook, call it
        if (typeof refreshTopics === 'function') {
          try{ refreshTopics(); }catch(e){}
        }
        console.log('new_banks.js loaded — EXTRA_BANKS length:', window.EXTRA_BANKS.length);
      }catch(e){ console.warn('Failed to register new banks', e); }
    })(),


  // ============ 7. اللقطات السينمائية والخدع البصرية ============
  { name:'اللقطات السينمائية والخدع البصرية',
    imageQuestions:[
      {cat:'سينما', value:75, type:'image', title:'ما هذا المشهد؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Citadel_of_Constantine.jpg/440px-Citadel_of_Constantine.jpg', q:'ما هذا المشهد السينمائي؟', a:'مشهد خارجي', hint:''},
      {cat:'مخرجون', value:75, type:'image', title:'من هذا المخرج؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Steven_Spielberg_by_Gage_Skidmore.jpg/440px-Steven_Spielberg_by_Gage_Skidmore.jpg', q:'من هذا المخرج؟', a:'ستيفن سبيلبرغ', hint:''},
      {cat:'مؤثرات', value:75, type:'image', title:'ما هذه التقنية؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Green_screen.jpg/440px-Green_screen.jpg', q:'ما اسم هذه التقنية؟', a:'الشاشة الخضراء', hint:''}
    ],
    musicQuestions:[
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى تصويرية', audioUrl:'https://www.youtube.com/embed/ScMzIvxBSi4', parts:[{q:'اسم المقطع؟',a:'موسيقى تصويرية'},{q:'الملحن؟',a:'ملحن'},{q:'الفيلم؟',a:'فيلم'}]},
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى خلفية', audioUrl:'https://www.youtube.com/embed/YE7VzlLtp-4', parts:[{q:'نوعها؟',a:'خلفية'},{q:'الهدف؟',a:'تعزيز المشهد'},{q:'الأدوات؟',a:'اوركسترا'}]},
      {cat:'موسيقى', value:75, type:'music', title:'مقطوعة مؤثرة', audioUrl:'https://www.youtube.com/embed/2Vv-BfVoq4g', parts:[{q:'ما اسمها؟',a:'مقطوعة'},{q:'من الملحن؟',a:'ملحن'},{q:'السنة؟',a:'معلومة'}]}
    ],
    puzzleQuestions:[
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'odd_one_out', title:'اكتشف المختلف', items:['كاميرا','ميكروفون','مؤثر','مسمار'], answer:'مسمار', explanation:'الباقي معدات تصوير'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'equation', title:'أكمل', items:[], answer:'1+1=2', explanation:''},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'order', title:'رتّب خطوات التصوير', items:['كتابة السيناريو','التصوير','المونتاج'], answer:'كتابة السيناريو,التصوير,المونتاج', explanation:''}
    ],
    silver:[
      {cat:'اللقطات السينمائية والخدع البصرية', questions:[
        {v:100,q:'ما اسم أول فيلم صامت طويل في التاريخ؟',a:'"ولادة أمة" 1915 لـ D.W. Griffith'},
        {v:200,q:'ما اسم التقنية التي تُستخدم لدمج الممثلين مع خلفيات مصنوعة؟',a:'الشاشة الخضراء (Green Screen / Chroma Key)'},
        {v:300,q:'من هو الأب الروحي للخدع البصرية في السينما؟',a:'جورج ميلييه (Georges Méliès)'}]},
      {cat:'المخرجون العظام', questions:[
        {v:100,q:'من أخرج فيلم "تايتانيك"؟',a:'جيمس كاميرون'},
        {v:200,q:'من أخرج ثلاثية "سيد الخواتم"؟',a:'بيتر جاكسون'},
        {v:300,q:'من هو المخرج الياباني الشهير بأفلام السامواي؟',a:'أكيرا كوروساوا'}]},
      {cat:'كواليس الأفلام', questions:[
        {v:100,q:'ما هي أكبر شركة إنتاج سينمائي في هوليوود؟',a:'شركة ديزني (تاريخياً وبارامونت ووارنر)'},
        {v:200,q:'ما اسم ملف السيناريو الذي يُكتب قبل التصوير؟',a:'ال Screenplay أو السيناريو'},
        {v:300,q:'ما اسم اللقطة التي يتحرك فيها الكاميرا مع الممثل بسلاسة؟',a:'لقطة التتبع (Tracking Shot)'}]}
    ],
    gold:[
      {cat:'اللقطات السينمائية والخدع البصرية', questions:[
        {v:500,q:'ما اسم تقنية التصوير البطيء الشهيرة في فيلم "المصفوفة"؟',a:'Bullet Time'},
        {v:1000,q:'من هو المؤسس الحقيقي لتقنية CGI الحديثة في السينما؟',a:'جورج لوكاس وشركة ILM (Industrial Light & Magic)'},
        {v:1500,q:'ما اسم أول فيلم استخدم CGI بالكامل لشخصية رئيسية؟',a:'"Jurassic Park" 1993'}]},
      {cat:'مؤثرات صوتية وبصرية', questions:[
        {v:500,q:'ما اسم صوت "الطنين" الشهير في أفلام حرب النجوم؟',a:'صوت سيف الليزر (Lightsaber Hum)'},
        {v:1000,q:'ما اسم التقنية التي تسمح لممثل بأداء عدة شخصيات في نفس المشهد؟',a:'Split Screen أو Motion Control'},
        {v:1500,q:'ما اسم شركة المؤثرات البصرية التي عملت على فيلم أفاتار؟',a:'Weta Digital'}]},
      {cat:'جوائز وتكريمات', questions:[
        {v:500,q:'ما اسم أرفع جائزة سينمائية عالمية؟',a:'جائزة الأوسكار (Academy Awards)'},
        {v:1000,q:'من هو المخرج الذي فاز بأكبر عدد من الأوسكارات؟',a:'وولت ديزني (26 جائزة)'},
        {v:1500,q:'ما هو الفيلم الوحيد الذي فاز بجميع الأوسكارات الخمس الكبرى؟',a:'"It Happened One Night" 1934 و"One Flew Over the Cuckoo\'s Nest" 1975'}]}
    ],
    speedBank:[
      {q:'من هو الممثل الذي جسد شخصية "جيمس بوند" أكثر من غيره؟',a:'روجر مور (7 أفلام)'},
      {q:'ما اسم بطل ثلاثية "العراب"؟',a:'مارلون براندو وآل باتشينو'},
      {q:'من هو مخرج فيلم "بارك السي دي"؟',a:'ستيفن سبيلبرغ'},
      {q:'ما هو الفيلم الأعلى إيراداً في التاريخ؟',a:'أفاتار'},
      {q:'ما اسم مؤسس السينما العربية؟',a:'محمد بيومي (رائد السينما المصرية)'},
      {q:'ما اسم أول فيلم ملون في التاريخ؟',a:'"A Visit to the Seaside" 1908 (Kinemacolor)'},
      {q:'من مخرج "بلاد قش" و"إنسبشن"؟',a:'كريستوفر نولان'},
      {q:'ما اسم الجائزة السينمائية الفرنسية الكبرى؟',a:'السعفة الذهبية في مهرجان كان'},
      {q:'من مخرج فيلم "تايتانيك"؟',a:'جيمس كاميرون'},
      {q:'ما اسم أول فيلم صامت أنتجته ديزني؟',a:'"Steamboat Willie" 1928'},
      {q:'من هو نجم أفلام "روكي"؟',a:'سيلفستر ستالون'},
      {q:'ما اسم الفيلم الذي حصد أكبر عدد جوائز أوسكار؟',a:'"بن هور" و"تيتانيك" و"سيد الخواتم: عودة الملك" — كل واحد 11 جائزة'},
      {q:'من مخرجة ثلاثية "المصفوفة"؟',a:'الأخوتان (الأختان) واتشوسكي'},
      {q:'من هو نجم أفلام "المنتقمون" الذي يجسد "توني ستارك"؟',a:'روبرت داوني جونيور'},
      {q:'ما اسم أول شركة سينمائية في التاريخ؟',a:'شركة الأخوين لوميير 1895'},
      {q:'من هو مخرج ثلاثية "سيد الخواتم"؟',a:'بيتر جاكسون'},
      {q:'من هو أشهر ممثل صيني في هوليوود؟',a:'جاكي شان أو بروس لي'},
      {q:'ما اسم بطلة فيلم "تيتانيك"؟',a:'كيت وينسليت'},
      {q:'ما اسم بطل فيلم "الجوكر" 2019؟',a:'واكين فينيكس'},
      {q:'من مخرج فيلم "أفاتار"؟',a:'جيمس كاميرون'}
    ]},

  // ============ 8. الألغاز والذكاء الرياضي ============
  { name:'الألغاز والذكاء الرياضي',
    imageQuestions:[
      {cat:'ألغاز', value:75, type:'image', title:'ما هذا الشكل؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Mathematical_symbols.svg/440px-Mathematical_symbols.svg.png', q:'ما اسم هذا الشكل؟', a:'رموز رياضية', hint:''},
      {cat:'ألغاز', value:75, type:'image', title:'ما هذه الألغاز؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/Riddle_illustration.jpg/440px-Riddle_illustration.jpg', q:'ما نوع هذه الألغاز؟', a:'ألغاز منطقية', hint:''},
      {cat:'ألغاز', value:75, type:'image', title:'من هذا الرياضي؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Alan_Turing_Aged_16.jpg/440px-Alan_Turing_Aged_16.jpg', q:'من هذا؟', a:'آلان تورينج (عالم حاسوب)', hint:''}
    ],
    musicQuestions:[
      {cat:'موسيقى', value:75, type:'music', title:'نغمة حسابية', audioUrl:'https://www.youtube.com/embed/ScMzIvxBSi4', parts:[{q:'ما الهدف؟',a:'تعليم'},{q:'من الأداء؟',a:'مؤلف'},{q:'للمن؟',a:'طلاب'}]},
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى ذهنية', audioUrl:'https://www.youtube.com/embed/YE7VzlLtp-4', parts:[{q:'ما اسلوبها؟',a:'تأمل'},{q:'الأداة؟',a:'بيانو'},{q:'الفائدة؟',a:'تركيز'}]},
      {cat:'موسيقى', value:75, type:'music', title:'مقطوعة للألغاز', audioUrl:'https://www.youtube.com/embed/2Vv-BfVoq4g', parts:[{q:'الاسم؟',a:'مقطوعة'},{q:'الملحن؟',a:'ملحن'},{q:'النوع؟',a:'علمي'}]}
    ],
    puzzleQuestions:[
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'odd_one_out', title:'من المختلف؟', items:['2','4','6','7'], answer:'7', explanation:'الباقي أعداد زوجية'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'equation', title:'حلّ المعادلة', items:[], answer:'x=4', explanation:'2×x=8'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'order', title:'رتّب الأرقام', items:['3','1','2'], answer:'1,2,3', explanation:''}
    ],
    silver:[
      {cat:'الألغاز والذكاء الرياضي', questions:[
        {v:100,q:'ما هو الرقم التالي في السلسلة: 2، 4، 8، 16، ...؟',a:'32 (كل رقم ضعف الذي قبله)'},
        {v:200,q:'كم عدد المثلثات في نجمة داوود سداسية الأضلاع؟',a:'12 مثلثاً'},
        {v:300,q:'ما هو ناتج جمع أرقام من 1 إلى 100؟',a:'5050'}]},
      {cat:'الحساب الذهني', questions:[
        {v:100,q:'كم يساوي 15 × 15؟',a:'225'},
        {v:200,q:'ما هو الجذر التربيعي لـ 144؟',a:'12'},
        {v:300,q:'كم عدد الأيام في 5 سنوات ميلادية عادية؟',a:'1825 يوماً'}]},
      {cat:'ألغاز شهيرة', questions:[
        {v:100,q:'شيء يزداد كلما أخذت منه، فما هو؟',a:'الحفرة'},
        {v:200,q:'أخوان لا يلتقيان أبداً، فمن هما؟',a:'الليل والنهار (أو عيناك)'},
        {v:300,q:'ما الشيء الذي يمشي بلا رجلين ويبكي بلا عينين؟',a:'السحاب / المطر'}]}
    ],
    gold:[
      {cat:'الألغاز والذكاء الرياضي', questions:[
        {v:500,q:'إذا كان لدى مزارع 17 خروفاً وماتت جميعها إلا 9، فكم بقي؟',a:'9 خراف'},
        {v:1000,q:'أب وابن عمرهما معاً 40 سنة، عمر الأب 3 أضعاف عمر الابن. كم عمر كل منهما؟',a:'الأب 30 والابن 10'},
        {v:1500,q:'ما هي أصغر عدد أولي زوجي؟',a:'الرقم 2'}]},
      {cat:'المنطق والذكاء', questions:[
        {v:500,q:'إذا كان تفاحتان تكلفان 3 ريالات، كم تكلف 8 تفاحات؟',a:'12 ريالاً'},
        {v:1000,q:'كم عدد مربعات لوحة الشطرنج؟',a:'64 مربعاً'},
        {v:1500,q:'كم زاوية داخلية للمضلع السداسي المنتظم؟',a:'مجموعها 720° وكل زاوية 120°'}]},
      {cat:'أرقام تاريخية', questions:[
        {v:500,q:'كم يساوي "بي" (π) بتقريب رقمين عشريين؟',a:'3.14'},
        {v:1000,q:'من هو مكتشف الرقم صفر في الحساب؟',a:'العلماء الهنود والعرب (الخوارزمي طوّره)'},
        {v:1500,q:'ما اسم النظرية التي تقول (مجموع مربعي الضلعين = مربع الوتر)؟',a:'نظرية فيثاغورس'}]}
    ],
    speedBank:[
      {q:'كم يساوي 7 × 8؟',a:'56'},
      {q:'كم يساوي 100 ÷ 4؟',a:'25'},
      {q:'كم ضلعاً للمكعب؟',a:'12 ضلعاً'},
      {q:'كم رأس للمكعب؟',a:'8 رؤوس'},
      {q:'ما هو نصف نصف 100؟',a:'25'},
      {q:'كم يساوي 9 تربيع؟',a:'81'},
      {q:'ما هو أصغر رقم أولي؟',a:'الرقم 2'},
      {q:'كم يساوي 12 × 12؟',a:'144'},
      {q:'ما مجموع زوايا المثلث؟',a:'180 درجة'},
      {q:'كم أضلاع الخماسي؟',a:'5 أضلاع'},
      {q:'كم يساوي 25% من 200؟',a:'50'},
      {q:'ما هو الجذر التربيعي لـ 169؟',a:'13'},
      {q:'كم عدد الأعداد الأولية بين 1 و10؟',a:'أربعة (2، 3، 5، 7)'},
      {q:'كم رأساً للهرم الرباعي؟',a:'5 رؤوس'},
      {q:'ما مجموع الأرقام من 1 إلى 20؟',a:'210'},
      {q:'كم يساوي 15 × 15؟',a:'225'},
      {q:'ما هو ضعف 47؟',a:'94'},
      {q:'كم يساوي 3 مرفوع للأس 4؟',a:'81'},
      {q:'ما هو ثلث 90؟',a:'30'},
      {q:'كم يساوي 8 + 7 × 2؟',a:'22'}
    ]},

  // ============ 9. التكنولوجيا والاختراعات الحديثة ============
  { name:'التكنولوجيا والاختراعات الحديثة',
    imageQuestions:[
      {cat:'تكنولوجيا', value:75, type:'image', title:'ما هذا الجهاز؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Apple_Computer_logo.png/440px-Apple_Computer_logo.png', q:'ما اسم هذه الشركة؟', a:'آبل', hint:''},
      {cat:'اختراعات', value:75, type:'image', title:'من هذا المخترع؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Thomas_Edison2.jpg/440px-Thomas_Edison2.jpg', q:'من هذا المخترع؟', a:'توماس إديسون', hint:''},
      {cat:'إنترنت', value:75, type:'image', title:'ما هذا الشعار؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Google_2015_logo.svg/440px-Google_2015_logo.svg.png', q:'ما هذا الشعار؟', a:'جوجل', hint:''}
    ],
    musicQuestions:[
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى تقنية', audioUrl:'https://www.youtube.com/embed/ScMzIvxBSi4', parts:[{q:'ما الطابع؟',a:'إلكتروني'},{q:'الآلة؟',a:'سينث'},{q:'الهدف؟',a:'خلفية'}]},
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى روبوتية', audioUrl:'https://www.youtube.com/embed/YE7VzlLtp-4', parts:[{q:'ما الأسلوب؟',a:'الكتروني'},{q:'الملحن؟',a:'منتج'},{q:'النوع؟',a:'تكنو'}]},
      {cat:'موسيقى', value:75, type:'music', title:'مقطوعة مختبرية', audioUrl:'https://www.youtube.com/embed/2Vv-BfVoq4g', parts:[{q:'المؤلف؟',a:'مؤلف'},{q:'الغاية؟',a:'توضيح'},{q:'النوع؟',a:'تعليمي'}]}
    ],
    puzzleQuestions:[
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'odd_one_out', title:'من المختلف؟', items:['كود','خادم','شبكة','مطبخ'], answer:'مطبخ', explanation:'الباقي مصطلحات تقنية'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'equation', title:'أكمل', items:[], answer:'1+1=2', explanation:''},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'order', title:'رتّب خطوات التطوير', items:['تصميم','برمجة','اختبار'], answer:'تصميم,برمجة,اختبار', explanation:''}
    ],
    silver:[
      {cat:'التكنولوجيا والاختراعات الحديثة', questions:[
        {v:100,q:'من هو مؤسس شركة مايكروسوفت؟',a:'بيل غيتس وبول ألن'},
        {v:200,q:'في أي عام تأسست شركة آبل؟',a:'عام 1976'},
        {v:300,q:'ما اسم أول هاتف آيفون أُطلق للعامة؟',a:'iPhone الأول عام 2007'}]},
      {cat:'الإنترنت وشبكات', questions:[
        {v:100,q:'ماذا يعني اختصار WWW؟',a:'World Wide Web (الشبكة العنكبوتية العالمية)'},
        {v:200,q:'من هو مخترع البريد الإلكتروني؟',a:'راي توملينسون'},
        {v:300,q:'ما اسم مؤسس فيسبوك (ميتا)؟',a:'مارك زوكربيرغ'}]},
      {cat:'أجهزة وتقنيات', questions:[
        {v:100,q:'من اخترع أول حاسوب شخصي؟',a:'أبل الأولى (Apple I) بواسطة ستيف وزنياك 1976'},
        {v:200,q:'ما هي أول شركة أنتجت الهاتف الذكي بلمسة إصبع كاملة؟',a:'آبل — iPhone عام 2007'},
        {v:300,q:'ما اسم نظام التشغيل مفتوح المصدر الأكثر انتشاراً؟',a:'لينكس (Linux)'}]}
    ],
    gold:[
      {cat:'التكنولوجيا والاختراعات الحديثة', questions:[
        {v:500,q:'ما اسم تقنية التسجيل الرقمي الموزعة التي تعتمد عليها العملات الرقمية؟',a:'البلوك تشين (Blockchain)'},
        {v:1000,q:'من هو مبتكر البيتكوين؟',a:'الشخص/المجموعة تحت اسم مستعار: ساتوشي ناكاموتو'},
        {v:1500,q:'ما اسم أول روبوت حصل على جنسية دولة؟',a:'صوفيا — من المملكة العربية السعودية 2017'}]},
      {cat:'الذكاء الاصطناعي', questions:[
        {v:500,q:'ما اسم أول نظام ذكاء اصطناعي هزم بطل العالم في الشطرنج؟',a:'ديب بلو من IBM (هزم كاسباروف 1997)'},
        {v:1000,q:'ما اسم اللغة البرمجية الأشهر لتطوير الذكاء الاصطناعي؟',a:'Python'},
        {v:1500,q:'ما اسم التقنية التي تولّد النصوص والصور بالذكاء الاصطناعي؟',a:'النماذج التوليدية (Generative AI)'}]},
      {cat:'رواد التكنولوجيا', questions:[
        {v:500,q:'من هو مؤسس أمازون؟',a:'جيف بيزوس'},
        {v:1000,q:'من هو مؤسس تسلا وسبيس إكس؟',a:'إيلون ماسك'},
        {v:1500,q:'من هو مؤسس شركة إنفيديا؟',a:'جينسن هوانغ'}]}
    ],
    speedBank:[
      {q:'ماذا يعني RAM؟',a:'ذاكرة الوصول العشوائي (Random Access Memory)'},
      {q:'ماذا يعني CPU؟',a:'وحدة المعالجة المركزية (Central Processing Unit)'},
      {q:'ما اسم أشهر محرك بحث في العالم؟',a:'جوجل'},
      {q:'ما اسم أشهر منصة فيديو في العالم؟',a:'يوتيوب'},
      {q:'ما اسم مؤسس تويتر (X)؟',a:'جاك دورسي'},
      {q:'كم بت في البايت الواحد؟',a:'8 بت'},
      {q:'ما اسم بروتوكول تصفح المواقع الآمن؟',a:'HTTPS'},
      {q:'من مؤسس ChatGPT/OpenAI؟',a:'سام ألتمان وشركاؤه'},
      {q:'ماذا يعني GPS؟',a:'نظام تحديد المواقع العالمي'},
      {q:'ماذا يعني URL؟',a:'محدد موقع الموارد الموحد'},
      {q:'ما اسم مخترع الويب؟',a:'تيم بيرنرز لي'},
      {q:'ما اسم أول متصفح شهير للإنترنت؟',a:'نيتسكيب نافيغيتور'},
      {q:'ماذا يعني AI؟',a:'الذكاء الاصطناعي (Artificial Intelligence)'},
      {q:'ما اسم شركة صانعة المعالجات M1 و M2؟',a:'آبل'},
      {q:'من مؤسس شركة إنستغرام؟',a:'كيفن سيستروم ومايك كريغر'},
      {q:'ما اسم أشهر لغة برمجة للويب؟',a:'جافا سكريبت'},
      {q:'ماذا يعني SSD؟',a:'قرص الحالة الصلبة (Solid State Drive)'},
      {q:'ما اسم مؤسس واتساب؟',a:'يان كوم وبراين أكتون'},
      {q:'من هو مؤسس نتفليكس؟',a:'ريد هاستينغز ومارك راندولف'},
      {q:'ما اسم شبكة الاتصالات الجديدة الأسرع بعد 4G؟',a:'5G'}
    ]},

  // ============ 10. الطقس والمناخ والكون ============
  { name:'الطقس والمناخ والكون',
    imageQuestions:[
      {cat:'ظواهر', value:75, type:'image', title:'ما هذه الظاهرة؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Weather_fronts.svg/440px-Weather_fronts.svg.png', q:'ما اسم هذه الظاهرة؟', a:'جبهة جوية', hint:''},
      {cat:'فضاء', value:75, type:'image', title:'ما هذا؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Andromeda_galaxy_(with_h-alpha).jpg/440px-Andromeda_galaxy_(with_h-alpha).jpg', q:'ما اسم هذه المجرة؟', a:'أندروميدا', hint:''},
      {cat:'مناخ', value:75, type:'image', title:'ما هذه الظاهرة؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Tornado_at_Sharps_Canyon.jpg/440px-Tornado_at_Sharps_Canyon.jpg', q:'ما اسم الظاهرة؟', a:'الإعصار/الغضب الهوائي', hint:''}
    ],
    musicQuestions:[
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى للطبيعة', audioUrl:'https://www.youtube.com/embed/ScMzIvxBSi4', parts:[{q:'ما نوع الصوت؟',a:'ماء'},{q:'أين؟',a:'نهر'},{q:'لماذا؟',a:'توضيح'}]},
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى فضاء', audioUrl:'https://www.youtube.com/embed/YE7VzlLtp-4', parts:[{q:'ما الطابع؟',a:'غامض'},{q:'الأداة؟',a:'سينث'},{q:'الهدف؟',a:'تأثير'}]},
      {cat:'موسيقى', value:75, type:'music', title:'مقطوعة مناخية', audioUrl:'https://www.youtube.com/embed/2Vv-BfVoq4g', parts:[{q:'الغرض؟',a:'تعليم'},{q:'المصدر؟',a:'مؤسسة'},{q:'النوع؟',a:'تثقيفي'}]}
    ],
    puzzleQuestions:[
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'odd_one_out', title:'من المختلف؟', items:['سحب','مطر','ثلج','صحراء'], answer:'صحراء', explanation:'الباقي مرتبط بالماء'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'equation', title:'اكمل', items:[], answer:'F=ma', explanation:'قانون نيوتن الثاني (تمثيل)'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'order', title:'رتّب الطوارئ', items:['توقع','تحذير','استجابة'], answer:'توقع,تحذير,استجابة', explanation:''}
    ],
    silver:[
      {cat:'الطقس والمناخ والكون', questions:[
        {v:100,q:'ما اسم الظاهرة التي تحدث عندما ترتفع درجة حرارة الأرض بسبب الغازات؟',a:'ظاهرة الاحتباس الحراري'},
        {v:200,q:'ما هو الغاز الرئيسي المسؤول عن الاحتباس الحراري؟',a:'ثاني أكسيد الكربون (CO₂)'},
        {v:300,q:'ما اسم الطبقة التي تحمي الأرض من الأشعة فوق البنفسجية؟',a:'طبقة الأوزون'}]},
      {cat:'ظواهر جوية', questions:[
        {v:100,q:'ما هي الظاهرة التي تحدث بسبب انعكاس ضوء الشمس على قطرات المطر؟',a:'قوس قزح'},
        {v:200,q:'ما اسم الرياح الموسمية التي تهب على شبه القارة الهندية؟',a:'رياح المونسون'},
        {v:300,q:'ما الفرق بين الإعصار والزوبعة؟',a:'الإعصار (Hurricane) أكبر ويتشكل فوق المحيطات، الزوبعة (Tornado) أصغر وأقوى وتظهر برياً'}]},
      {cat:'الكون والنجوم', questions:[
        {v:100,q:'ما هي المجرة التي تحتوي على الأرض؟',a:'مجرة درب التبانة'},
        {v:200,q:'ما اسم النجم الأقرب إلى الشمس؟',a:'قنطور الرامي القريب (Proxima Centauri)'},
        {v:300,q:'ما هو الكوكب الأحمر في المجموعة الشمسية؟',a:'المريخ'}]}
    ],
    gold:[
      {cat:'الطقس والمناخ والكون', questions:[
        {v:500,q:'ما هو مقياس ريختر؟',a:'مقياس لقياس شدة الزلازل'},
        {v:1000,q:'ما اسم الظاهرة التي تحدث عند دخان النار في السماء؟',a:'التفاعل الحراري في التروبوسفير أو "الحرارة المضطربة"'},
        {v:1500,q:'ما اسم العملية التي تنقل الطاقة الشمسية عبر الغلاف الجوي؟',a:'الحمل الحراري (Convection)'}]},
      {cat:'الفلك المتقدم', questions:[
        {v:500,q:'كم عدد أقمار كوكب المشتري المكتشفة؟',a:'أكثر من 95 قمراً'},
        {v:1000,q:'ما اسم أكبر كوكب في المجموعة الشمسية؟',a:'المشتري'},
        {v:1500,q:'ما اسم الظاهرة التي تُبتلع فيها الأجرام في مركز المجرة؟',a:'الثقب الأسود (Black Hole)'}]},
      {cat:'مناخ الأرض', questions:[
        {v:500,q:'ما هي أعلى درجة حرارة سُجّلت على الأرض؟',a:'حوالي 56.7°م في وادي الموت بأمريكا (1913)'},
        {v:1000,q:'ما هي أدنى درجة حرارة سُجّلت طبيعياً؟',a:'−89.2°م في محطة فوستوك بأنتاركتيكا'},
        {v:1500,q:'ما اسم الاتفاق الدولي لمكافحة التغير المناخي 2015؟',a:'اتفاقية باريس للمناخ'}]}
    ],
    speedBank:[
      {q:'ما هو أبرد كوكب في المجموعة الشمسية؟',a:'نبتون'},
      {q:'ما هو أقرب كوكب للشمس؟',a:'عطارد'},
      {q:'ما هي أسرع رياح على الأرض؟',a:'الأعاصير المدارية'},
      {q:'كم درجة حرارة تجمد الماء؟',a:'صفر مئوية'},
      {q:'كم درجة غليان الماء عند سطح البحر؟',a:'100 درجة مئوية'},
      {q:'ما اسم علم دراسة الطقس؟',a:'علم الأرصاد الجوية'},
      {q:'ما اسم أكبر صحراء باردة في العالم؟',a:'صحراء أنتاركتيكا'},
      {q:'كم قمر للأرض؟',a:'قمر واحد'},
      {q:'ما اسم المجرة الأقرب إلى مجرتنا؟',a:'مجرة أندروميدا'},
      {q:'ما اسم الطبقة الأقرب لسطح الأرض من الغلاف الجوي؟',a:'التروبوسفير'},
      {q:'من هو أول رائد فضاء في التاريخ؟',a:'يوري غاغارين'},
      {q:'من أول من وطأ سطح القمر؟',a:'نيل أرمسترونغ'},
      {q:'ما هي مدة دوران الأرض حول الشمس؟',a:'365.25 يوم'},
      {q:'ما هي المسافة تقريباً بين الأرض والشمس؟',a:'150 مليون كم'},
      {q:'ما اسم أكبر مجرة معروفة؟',a:'IC 1101'},
      {q:'ما اسم أعلى قمة جبلية في الأرض؟',a:'إيفرست'},
      {q:'ما اسم أطول بحر داخلي في العالم؟',a:'البحر المتوسط'},
      {q:'كم عدد نجوم مجرة درب التبانة تقريباً؟',a:'حوالي 200 مليار نجم'},
      {q:'ما اسم الظاهرة التي تحدث في الأقطاب بسبب الرياح الشمسية؟',a:'الشفق القطبي (الأورورا)'},
      {q:'ما اسم المذنب الشهير الذي يمر كل 76 سنة؟',a:'مذنب هالي'}
    ]},

  // ============ 11. الثقافة والفنون التشكيلية والسينمائية ============
  { name:'الثقافة والفنون التشكيلية والسينمائية',
    imageQuestions:[
      {cat:'فن', value:75, type:'image', title:'من رسم هذه اللوحة؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Mona_Lisa.jpg/440px-Mona_Lisa.jpg', q:'من رسم هذه اللوحة؟', a:'ليوناردو دافنشي', hint:''},
      {cat:'مسرح', value:75, type:'image', title:'مسرح شهير', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Sydney_Opera_House_Sails.jpg/440px-Sydney_Opera_House_Sails.jpg', q:'ما اسم هذا المبنى؟', a:'دار أوبرا سيدني', hint:''},
      {cat:'سينما', value:75, type:'image', title:'من هذا المخرج؟', imageUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Alfred_Hitchcock_1955.jpg/440px-Alfred_Hitchcock_1955.jpg', q:'من هذا المخرج؟', a:'ألفريد هيتشكوك', hint:''}
    ],
    musicQuestions:[
      {cat:'موسيقى', value:75, type:'music', title:'موسيقى كلاسيكية', audioUrl:'https://www.youtube.com/embed/ScMzIvxBSi4', parts:[{q:'المؤلف؟',a:'فيالدي'},{q:'اسم القطعة؟',a:'الأربعة فصول'},{q:'الآلة؟',a:'كمان'}]},
      {cat:'موسيقى', value:75, type:'music', title:'أغنية فيلم', audioUrl:'https://www.youtube.com/embed/YE7VzlLtp-4', parts:[{q:'اسم الفيلم؟',a:'فيلم'},{q:'المغني؟',a:'مطرب'},{q:'العام؟',a:'سنة'}]},
      {cat:'موسيقى', value:75, type:'music', title:'مقطوعة فنية', audioUrl:'https://www.youtube.com/embed/2Vv-BfVoq4g', parts:[{q:'النوع؟',a:'مقطوعة'},{q:'الملحن؟',a:'ملحن'},{q:'الحقبة؟',a:'عصر'}]}
    ],
    puzzleQuestions:[
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'odd_one_out', title:'اختَر المختلف', items:['لوحة','نحت','فيلم','طبق'], answer:'طبق', explanation:'الباقي فنون تشكيلية/سينمائية'},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'equation', title:'اختر الكلمة الناقصة', items:[], answer:'الفن يعبّر', explanation:''},
      {cat:'ألغاز', value:75, type:'puzzle', subtype:'order', title:'رتّب مراحل إنتاج فيلم', items:['كتابة','تصوير','مونتاج'], answer:'كتابة,تصوير,مونتاج', explanation:''}
    ],
    silver:[
      {cat:'الثقافة والفنون التشكيلية والسينمائية', questions:[
        {v:100,q:'من رسم لوحة "الموناليزا"؟',a:'ليوناردو دافنشي'},
        {v:200,q:'من هو الفنان الهولندي الذي قطع أذنه؟',a:'فنسنت فان غوخ'},
        {v:300,q:'في أي متحف تُعرض لوحة الموناليزا؟',a:'متحف اللوفر في باريس'}]},
      {cat:'مدارس فنية', questions:[
        {v:100,q:'ما اسم المدرسة الفنية التي أسسها بيكاسو؟',a:'التكعيبية (Cubism)'},
        {v:200,q:'ما اسم المدرسة الفنية التي ترسم الضوء واللحظات العابرة؟',a:'الانطباعية (Impressionism)'},
        {v:300,q:'من هو مؤسس المدرسة السريالية؟',a:'أندريه بريتون'}]},
      {cat:'فن السينما', questions:[
        {v:100,q:'ما اسم أول فيلم كرتوني ناطق طويل من ديزني؟',a:'"بياض الثلج والأقزام السبعة" 1937'},
        {v:200,q:'من هو مخرج ثلاثية "العراب"؟',a:'فرانسيس فورد كوبولا'},
        {v:300,q:'ما اسم مهرجان السينما الأشهر في العالم؟',a:'مهرجان كان السينمائي'}]}
    ],
    gold:[
      {cat:'الثقافة والفنون التشكيلية والسينمائية', questions:[
        {v:500,q:'ما اسم النحات الإيطالي الذي نحت تمثال "داوود"؟',a:'مايكل أنجلو'},
        {v:1000,q:'من رسم لوحة "الصرخة"؟',a:'إدفارد مونش'},
        {v:1500,q:'ما اسم الحركة الفنية التي أسسها فان غوخ ومونيه وسيزان؟',a:'ما بعد الانطباعية (Post-Impressionism)'}]},
      {cat:'موسيقى وأوبرا', questions:[
        {v:500,q:'من ألّف "الحلم على شاطئ البحر"؟',a:'كلود ديبوسي (بحر)'},
        {v:1000,q:'من هو مؤلف "الحفلات الأربعة"؟',a:'أنطونيو فيفالدي'},
        {v:1500,q:'ما اسم أشهر دار أوبرا في العالم؟',a:'ميلانو لا سكالا (La Scala)'}]},
      {cat:'كنوز ثقافية', questions:[
        {v:500,q:'ما اسم أطول لوحة جدارية في التاريخ؟',a:'لوحة "The Book from the Sky" (نسبياً) — الأشهر: سقف كنيسة سيستين لمايكل أنجلو'},
        {v:1000,q:'أين يقع تمثال الحرية؟',a:'مدينة نيويورك، الولايات المتحدة'},
        {v:1500,q:'من هو مصمم كنيسة سيستين؟',a:'دوناتو برامانتي (بناها) وزخرفها مايكل أنجلو'}]}
    ],
    speedBank:[
      {q:'من رسم لوحة "العشاء الأخير"؟',a:'ليوناردو دافنشي'},
      {q:'ما اسم أشهر متحف في لندن؟',a:'المتحف البريطاني'},
      {q:'من هو الفنان الإسباني مؤسس التكعيبية مع بيكاسو؟',a:'جورج براك'},
      {q:'ما جنسية الرسام سلفادور دالي؟',a:'إسباني'},
      {q:'من هو مؤلف "الليالي البيضاء"؟',a:'دستويفسكي'},
      {q:'أين يقع متحف اللوفر؟',a:'باريس، فرنسا'},
      {q:'من هو الرسام الأمريكي الشهير بفن البوب؟',a:'آندي وارهول'},
      {q:'من هو الملقب بأمير الرسامين العرب؟',a:'محمود سعيد أو محمد ناجي (خلاف مشهور)'},
      {q:'ما اسم لوحة بيكاسو التي تصور الحرب الأهلية الإسبانية؟',a:'غيرنيكا'},
      {q:'من هو الرسام الياباني الشهير برسم "الموجة العظمى"؟',a:'كاتسوشيكا هوكوساي'},
      {q:'أين يقع متحف "الميتروبوليتان"؟',a:'مدينة نيويورك'},
      {q:'من هو الفنان الإيطالي الذي رسم "خلق آدم"؟',a:'مايكل أنجلو'},
      {q:'من هي أشهر مصممة أزياء فرنسية؟',a:'كوكو شانيل'},
      {q:'ما اسم أشهر مهرجان للفن التشكيلي في العالم؟',a:'بينالي البندقية'},
      {q:'من هو رسام لوحة "قبلة كليمت"؟',a:'غوستاف كليمت'},
      {q:'من هو الفنان العربي الفلسطيني الأكثر شهرة عالمياً؟',a:'ناجي العلي'},
      {q:'ما اسم أشهر أوبرا في العالم العربي؟',a:'دار الأوبرا المصرية'},
      {q:'من هو مخرج فيلم "المومياء" العربي (الحقيقي)؟',a:'شادي عبد السلام'}
    ]}
];

function getRandomBank(){ return questionBanks[Math.floor(Math.random()*questionBanks.length)]; }
const defaultDB = questionBanks[0];

// ══════════════════════════════════════════
//  CATEGORY ICONS
// ══════════════════════════════════════════
const catIcons = {
  'قادة ورؤساء':'👑','في يوم في شهر في سنة':'📅','كشكول':'📚',
  'كيف ولماذا؟':'🔬','الصفة المشتركة':'🔗','أكبر .. أصغر ..':'⚖️',
  'فكر بسرعة!':'⚡','علوم وآداب':'🎭','رياضة وعالم':'⚽',
  'الخلفاء الراشدون':'☪️','الفتوحات الإسلامية':'🏹','العلماء والحضارة':'📖',
  'غزوات النبي ﷺ':'⚔️','الدول الإسلامية':'🕌','السيرة النبوية':'🌙',
  'الجغرافيا العربية':'🗺️','عالم الحيوان':'🦁','الكون والفضاء':'🌌',
  'الاختراعات والاكتشافات':'💡','العلوم والكيمياء':'🧪','عجائب العالم':'🏛️',
  'كرة القدم':'⚽','الرياضات الأولمبية':'🥇','الفنون والموسيقى':'🎨',
  'أبطال رياضيون':'🏆','السينما والتلفزيون':'🎬','الأدب العالمي':'📚',
  // NEW TV CATEGORIES
  'الدين والعلوم الإسلامية':'🕌','الفقه والعبادات':'🧎','التفسير والحديث':'📜',
  'اللغات والآداب':'📖','الأدب العربي':'✒️','شعراء وأدباء':'🖋️','جوائز أدبية':'🏅',
  'اللقطات السينمائية والخدع البصرية':'🎞️','المخرجون العظام':'🎬','كواليس الأفلام':'🎥',
  'مؤثرات صوتية وبصرية':'🎧','جوائز وتكريمات':'🏆',
  'الألغاز والذكاء الرياضي':'🧩','الحساب الذهني':'🔢','ألغاز شهيرة':'❔','المنطق والذكاء':'💭','أرقام تاريخية':'📐',
  'التكنولوجيا والاختراعات الحديثة':'🤖','الإنترنت وشبكات':'🌐','أجهزة وتقنيات':'💻','الذكاء الاصطناعي':'🧠','رواد التكنولوجيا':'🚀',
  'الطقس والمناخ والكون':'🌦️','ظواهر جوية':'🌪️','الفلك المتقدم':'🔭','مناخ الأرض':'🌍',
  'الثقافة والفنون التشكيلية والسينمائية':'🎭','مدارس فنية':'🖼️','فن السينما':'🎬','موسيقى وأوبرا':'🎼','كنوز ثقافية':'🏛️',
  // legacy diamond keys
  'ثقافة عامة':'🌍','تاريخ إسلامي':'☪️','جغرافيا':'🗺️','علوم':'🔬','رياضة':'⚽','أدب وشعر':'📚','اختراعات':'💡'
};

// ══════════════════════════════════════════
//  GAME STATE
// ══════════════════════════════════════════
let players=[], stage='silver', responder=null, cellRef=null;
let speedLoc={stage:'silver',cat:0,q:0}, bankLoc={stage:'gold',cat:1,q:2};
let bankMode=false, bankBet=0, speedIdx=0, diamondState=[], diamondPlayers=[];
let currentTextAnswers = {};
let gameDB = null;
let selectedBankIndex = 0;
let speedTimerInterval = null;

// ══════════════════════════════════════════
//  SETUP INIT — topic grid + preview
// ══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  buildTopicGrid();
  generateSetupQR();
  showBankPreview(0);
  // Prime the RTC hub in the background (so signaling is watched immediately)
  setTimeout(() => initHostWebRTC().catch(()=>{}), 400);
  // Watch buzzer state (host listens for winner)
  watchBuzzerState();
  watchTextAnswers();
});

function buildTopicGrid() {
  const grid = document.getElementById('topic-grid');
  if (!grid) return;
  // If extra banks were loaded (from new_banks.js), convert and append them
  try {
    if (window.ALL_BANKS && typeof window.ALL_BANKS === 'object') {
      const nameMap = { health:'الطب والصحة', sports:'الرياضة', space:'الفضاء والفلك', food:'الطبخ والمأكولات', animals:'الحيوانات والطبيعة', worldHistory:'التاريخ العالمي' };
      Object.keys(window.ALL_BANKS).forEach(k => {
        const displayName = nameMap[k] || k;
        if (!questionBanks.find(b => b.name === displayName)) {
          const raw = window.ALL_BANKS[k] || [];
          const conv = raw.map(it => ({ v: it.value || 100, q: it.text || it.q || '', a: it.answer || it.a || '' }));
          const bankObj = { name: displayName, silver: [ { cat: displayName, questions: conv.slice(0,9) } ], gold: [ { cat: displayName, questions: conv.slice(0,6) } ], speedBank: conv.slice(0,12).map(x=>({q:x.q,a:x.a})) };
          questionBanks.push(bankObj);
        }
      });
    }
  } catch(e){ console.warn('append extra banks failed', e); }
  const icons = ['🌍','☪️','🔬','⚽','🕌','📖','🎞️','🧩','🤖','🌦️','🎭'];
  grid.innerHTML = '';
  questionBanks.forEach((b, i) => {
    const btn = document.createElement('button');
    const name = b && b.name ? b.name : 'غير معروف';
    btn.className = 'topic-btn' + (i===0 ? ' active' : '');
    btn.dataset.topic = name;
    btn.dataset.testid = `topic-${i}`;
    btn.textContent = `${icons[i] || '📚'} ${name}`;
    btn.onclick = () => selectTopic(btn, i);
    grid.appendChild(btn);
  });
  // Random option
  const rand = document.createElement('button');
  rand.className = 'topic-btn';
  rand.dataset.testid = 'topic-random';
  rand.textContent = '🎲 عشوائي';
  rand.onclick = () => selectTopic(rand, -1);
  grid.appendChild(rand);
}

// ══════════════════════════════════════════
//  NEW TOPICS — 6 Additional Banks
// ══════════════════════════════════════════
function addNewTopics() {
  const newTopics = [
    {id:'health', name:'الطب والصحة', icon:'🏥', desc:'أسئلة في الطب والصحة'},
    {id:'sports', name:'الرياضة', icon:'⚽', desc:'أسئلة في الرياضة والألعاب'},
    {id:'space', name:'الفضاء والفلك', icon:'🚀', desc:'أسئلة في الفضاء والنجوم'},
    {id:'food', name:'الطبخ والمأكولات', icon:'🍳', desc:'أسئلة في الطبخ والأطعمة'},
    {id:'animals', name:'الحيوانات والطبيعة', icon:'🦁', desc:'أسئلة في الحيوانات'},
    {id:'worldHistory', name:'التاريخ العالمي', icon:'🌍', desc:'أسئلة في التاريخ العالمي'}
  ];

  if (typeof questionBanks !== 'undefined' && window.ALL_BANKS && typeof window.ALL_BANKS === 'object') {
    newTopics.forEach(t => {
      if (window.ALL_BANKS[t.id] && !questionBanks.find(b => b.name === t.name)) {
        const raw = window.ALL_BANKS[t.id] || [];
        const conv = raw.map(it => ({ v: it.value || it.v || 100, q: it.text || it.q || '', a: it.answer || it.a || '' }));
        const bankObj = { name: t.name, silver: [ { cat: t.name, questions: conv.slice(0,9) } ], gold: [ { cat: t.name, questions: conv.slice(0,6) } ], speedBank: conv.slice(0,12).map(x=>({q:x.q,a:x.a})) };
        questionBanks.push(bankObj);
      }
    });
  }

  const grid = document.getElementById('topic-grid');
  if (grid) {
    newTopics.forEach(t => {
      // avoid duplicates in the DOM
      if (Array.from(grid.querySelectorAll('button')).some(b => b.textContent && b.textContent.includes(t.name))) return;
      const btn = document.createElement('button');
      btn.className = 'topic-btn';
      btn.dataset.topic = t.name;
      btn.innerHTML = '<span class="topic-icon">' + t.icon + '</span><span class="topic-name">' + t.name + '</span>';
      btn.onclick = function() {
        const idx = questionBanks.findIndex(b => b.name === t.name);
        selectTopic(btn, idx === -1 ? 0 : idx);
      };
      grid.appendChild(btn);
    });
  }

  console.log('[Topics] Added ' + newTopics.length + ' new topics');
}

const originalBuildTopicGrid = window.buildTopicGrid;
window.buildTopicGrid = function() { if (originalBuildTopicGrid) originalBuildTopicGrid(); addNewTopics(); };

function selectTopic(btn, idx) {
  document.querySelectorAll('.topic-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedBankIndex = idx;
  const bank = idx === -1 ? questionBanks[0] : questionBanks[idx];
  showBankPreview(idx === -1 ? 0 : idx);
  document.getElementById('ai-status-text').textContent =
    `✅ بنك: ${bank.name} — ${idx === -1 ? 'سيتم الاختيار عشوائياً' : 'جاهز'}`;
}

function showBankPreview(idx) {
  const list = document.getElementById('ai-preview-list');
  if (!list) return;
  list.innerHTML = '';
  const bank = questionBanks[idx];
  if (bank && bank.silver) {
    bank.silver.forEach(col => {
      col.questions.slice(0,1).forEach(q => {
        const d = document.createElement('div');
        d.className = 'ai-preview-item';
        d.textContent = q.q;
        list.appendChild(d);
      });
    });
  }
}

// ══════════════════════════════════════════
//  START GAME
// ══════════════════════════════════════════
function startGame() {
  initAudio();
  players = [];
  const inputs = document.querySelectorAll('.p-input');
  inputs.forEach((inp,i) => {
    const name = inp.value.trim() || `الفارس ${i+1}`;
    players.push({id:i, name, score:0, isBanked:false, bankedValue:0});
  });
  if (players.length < 2) { alert('يجب إضافة متسابقَين على الأقل!'); return; }

  const bankIdx = selectedBankIndex === -1
    ? Math.floor(Math.random() * questionBanks.length)
    : selectedBankIndex;
  const selectedBank = questionBanks[bankIdx];
  gameDB = buildDB(selectedBank);

  speedLoc = {stage:'silver', cat:Math.floor(Math.random()*gameDB.silver.length), q:Math.floor(Math.random()*3)};
  bankLoc  = {stage:'gold', cat:1, q:2};

  goTo('game');
  sfx.main();
  changeStage('silver');
  buildSidebar();
  setTimeout(() => syncToFirebase(buildGameStateForSync()), 500);
  // Reset buzzer on game start
  resetBuzzer();
}

// ══════════════════════════════════════════
//  BUILD DB — includes the 7 TV categories as available injections
// ══════════════════════════════════════════
function buildDB(src) {
  // Deep clone
  const d = JSON.parse(JSON.stringify(src));
  // Shuffle helper
  const shuffle = arr => { for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; };
const allSilver=[],allGold=[],allSpeed=[];
  questionBanks.forEach(b=>{
    if (!b) return;
    (b.silver||[]).forEach(c=>{ if(c) allSilver.push(JSON.parse(JSON.stringify(c))); });
    (b.gold||[]).forEach(c=>{ if(c) allGold.push(JSON.parse(JSON.stringify(c))); });
    (b.speedBank||[]).forEach(q=>{ if(q) allSpeed.push({...q}); });
  });
  d.silver=shuffle(allSilver).slice(0,3);
  d.gold=shuffle(allGold).slice(0,3);
  d.speedBank=shuffle(allSpeed).slice(0,20); 

  // For each stage (silver/gold), pick 3 random questions per column from the pool
  // (if the column has more than 3). This keeps the 3-slot board UI while
  // providing session variety when pools are expanded to 5-8 questions.
  ['silver','gold'].forEach(s => {
    if (!d[s]) return;
    d[s].forEach(col => {
      if (col.questions.length > 3) {
        col.questions = shuffle([...col.questions]).slice(0, 3);
      }
      // Preserve original value ordering (100/200/300 or 500/1000/1500) after random pick
      const canonicalValues = s === 'silver' ? [25,50,75] : [100,125,150];
      col.questions.sort((a,b)=>a.v-b.v);
      col.questions.forEach((q,i) => { q.v = canonicalValues[i]; q.spent = false; });
    });
  });
  // دمج الأسئلة المتعددة الأجزاء في الشاشة الذهبية
  const mpAll = window.MULTIPART_QUESTIONS || [];
  if (mpAll.length > 0 && d.gold) {
    const mpPool = [...mpAll].sort(() => Math.random() - 0.5);
    let mpIdx = 0;
    d.gold.forEach(col => {
      if (Math.random() < 0.4 && mpIdx < mpPool.length) {
        const mp = mpPool[mpIdx++];
        const idx = col.questions.findIndex(q => q.v === 1000);
        if (idx !== -1) {
          col.questions[idx] = { v: 1000, isMultiPart: true, multiPartData: { type: mp.type, title: mp.title, parts: mp.parts }, spent: false };
        }
      }
    });
  }

  // Shuffle speedBank too
  if (d.speedBank) d.speedBank = shuffle([...d.speedBank]);

  // Collect image/music/puzzle pools from all banks (if provided)
  const imagePool = [], musicPool = [], puzzlePool = [];
  questionBanks.forEach(b => {
    if (!b) return;
    (b.imageQuestions||[]).forEach(i => { if(i) imagePool.push(JSON.parse(JSON.stringify(i))); });
    (b.musicQuestions||[]).forEach(m => { if(m) musicPool.push(JSON.parse(JSON.stringify(m))); });
    (b.puzzleQuestions||[]).forEach(p => { if(p) puzzlePool.push(JSON.parse(JSON.stringify(p))); });
  });

  // Occasionally inject a media/puzzle question into the top-value slot (30% chance)
  ['silver','gold'].forEach(s => {
    if (!d[s]) return;
    const topValue = s === 'silver' ? 75 : 150;
    d[s].forEach(col => {
      if (Math.random() < 0.3) {
        const idx = col.questions.findIndex(q => q.v === topValue);
        if (idx !== -1) {
          const types = [];
          if (imagePool.length) types.push('image');
          if (musicPool.length) types.push('music');
          if (puzzlePool.length) types.push('puzzle');
          if (types.length) {
            const t = types[Math.floor(Math.random()*types.length)];
            if (t === 'image') {
              const item = imagePool.splice(Math.floor(Math.random()*imagePool.length),1)[0];
              item.type = 'image'; item.v = topValue; item.spent = false;
              col.questions[idx] = item;
            } else if (t === 'music') {
              const item = musicPool.splice(Math.floor(Math.random()*musicPool.length),1)[0];
              item.type = 'music'; item.v = topValue; item.spent = false; item.partIndex = 0;
              col.questions[idx] = item;
            } else if (t === 'puzzle') {
              const item = puzzlePool.splice(Math.floor(Math.random()*puzzlePool.length),1)[0];
              item.type = 'puzzle'; item.v = topValue; item.spent = false;
              col.questions[idx] = item;
            }
          }
        }
      }
    });
  });

  // 9-cell diamond grid with balanced category variety across all 11 categories
  d.diamond = [
    {cat:'قادة ورؤساء',      q:'من قاد مصر في حرب أكتوبر 1973؟',                   a:'الرئيس أنور السادات'},
    {cat:'ثقافة عامة',       q:'ما أطول نهر في العالم؟',                            a:'نهر النيل'},
    {cat:'الدين والعلوم الإسلامية', q:'كم عدد سور القرآن الكريم؟',                  a:'114 سورة'},
    {cat:'اللغات والآداب',    q:'من هو الشاعر الملقب بالمتنبي؟',                    a:'أبو الطيب أحمد بن الحسين'},
    {cat:'الطقس والمناخ والكون', q:'ما هي طبقة الغلاف الجوي التي تحمي الأرض من الأشعة فوق البنفسجية؟', a:'طبقة الأوزون'},
    {cat:'فكر بسرعة!',       q:'🚨 جولة دقيقة السرعة!',                             a:'اضغط أسماء الفرسان لمنح نقاط السرعة.',isSpeedRound:true},
    {cat:'التكنولوجيا والاختراعات الحديثة', q:'من هو مؤسس شركة أمازون؟',            a:'جيف بيزوس'},
    {cat:'الألغاز والذكاء الرياضي', q:'ما هو ناتج جمع الأرقام من 1 إلى 10؟',        a:'55'},
    {cat:'الثقافة والفنون التشكيلية والسينمائية', q:'من رسم لوحة الموناليزا؟',     a:'ليوناردو دافنشي'}
  ];
  return d;
}

// ══════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════
function buildSidebar() {
  const c = document.getElementById('sidebar-players'); c.innerHTML='';
  const list = stage==='diamond' ? diamondPlayers : players;
  list.forEach(p => {
    const d=document.createElement('div');
    d.className='player-card'; d.id=`pc-${p.id}`;
    if(stage==='diamond') d.classList.add(p.id===diamondPlayers[0].id?'dp1':'dp2');
    const role = stage==='diamond' ? 'الفارس العالي' : 'متسابق';
    d.innerHTML=`<div class="p-card-role">${role}</div>
      <div class="p-card-name" title="${p.name}">${p.name}</div>
      <div class="p-card-score" id="ps-${p.id}">${p.score}</div>
      <div class="p-banked" id="pb-${p.id}" data-val="${p.bankedValue||0}" style="${p.isBanked?'display:block;':'display:none;'}">🔒 محصن: ${p.bankedValue||0}</div>`;
    c.appendChild(d);
  });
}

function refreshScores() {
  players.forEach(p=>{
    const el=document.getElementById(`ps-${p.id}`);
    if(el){ el.textContent=p.score; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    const b=document.getElementById(`pb-${p.id}`);
    if(b&&p.isBanked){ b.textContent=`🔒 محصن: ${p.bankedValue}`; b.setAttribute('data-val', p.bankedValue); b.style.display='block'; }
  });
}

// ══════════════════════════════════════════
//  STAGE MANAGEMENT
// ══════════════════════════════════════════
function changeStage(s) {
  stage=s;
  document.getElementById('board-silver').style.display='none';
  document.getElementById('board-gold').style.display='none';
  document.getElementById('board-diamond').style.display='none';
  document.getElementById('page-game').className = 'page active stage-' + s;

  const stageNames={'silver':'⚪ الشاشة الفضية','gold':'🥇 الشاشة الذهبية','diamond':'💎 الشاشة الماسية'};
  document.getElementById('topbar-stage-name').textContent=stageNames[s];

  const advBtn=document.getElementById('btn-advance');
  if(s==='silver'){ advBtn.textContent='الشاشة الذهبية ←'; advBtn.style.display=''; }
  else if(s==='gold'){ advBtn.textContent='الشاشة الماسية ←'; advBtn.style.display=''; }
  else { advBtn.style.display='none'; }

  if(s==='silver'||s==='gold'){
    document.getElementById(`board-${s}`).style.display='flex';
    buildBoard(s);
  } else {
    document.getElementById('board-diamond').style.display='grid';
    const sorted=[...players].sort((a,b)=>b.score-a.score);
    diamondPlayers=[sorted[0],sorted[1]];
    initDiamond();
  }
  buildSidebar();
  setTimeout(() => syncToFirebase(buildGameStateForSync()), 300);
}

async function advanceStage() {
  if(stage==='silver'){
    await showTransition('🥇','الشاشة الذهبية','مضاعفة النقاط','var(--gold)');
    changeStage('gold');
  } else if(stage==='gold'){
    await showTransition('💎','الشاشة الماسية','الحسم النهائي','var(--cyan)');
    changeStage('diamond');
  }
}

// ══════════════════════════════════════════
//  BOARD BUILDER
// ══════════════════════════════════════════
function buildBoard(s) {
  const c=document.getElementById(`board-${s}`); c.innerHTML='';
  gameDB[s].forEach((col,ci)=>{
    const d=document.createElement('div'); d.className='cat-col';
    const icon=catIcons[col.cat]||'❓';
    d.innerHTML=`<div class="cat-icon">${icon}</div><div class="cat-name">${col.cat}</div>`;
    col.questions.forEach((q,qi)=>{
      const b=document.createElement('button');
      b.className='q-btn'+(q.spent?' spent':'');
      b.textContent = q.v;
      if(!q.spent) b.onclick=()=>openModal(ci,qi);
      d.appendChild(b);
    });
    c.appendChild(d);
  });
}

// ══════════════════════════════════════════
//  MODAL
// ══════════════════════════════════════════
async function openModal(ci, qi) {
  const qItem = stage==='diamond' ? diamondState[ci] : gameDB[stage][ci].questions[qi];
  // Media / puzzle special types
  if (qItem && qItem.type === 'image') { launchImageModal(qItem, ci, qi); return; }
  if (qItem && qItem.type === 'music') { launchMusicModal(qItem, ci, qi); return; }
  if (qItem && qItem.type === 'puzzle') { launchPuzzleModal(qItem, ci, qi); return; }
  if (qItem && qItem.isMultiPart) { launchMultiPartModal(qItem, ci, qi); return; }
  initAudio();
  cellRef={stage,ci,qi};
  responder=null; bankMode=false; bankBet=0;

  // Reset buzzer for new question
  await resetBuzzer();

  // Reset Reveal Answer button
  const revBtn = document.getElementById('btn-reveal-answer');
  if (revBtn) { revBtn.textContent = '👁️ كشف الإجابة للجمهور'; revBtn.disabled = false; revBtn.classList.remove('revealed'); }

  // Reset Voting button
  const votBtn = document.getElementById('btn-toggle-voting');
  if (votBtn) { votBtn.textContent = '🗳️ فتح تصويت'; votBtn.disabled = false; votBtn.classList.remove('active'); }

  document.getElementById('modal-overlay').style.display='flex';
  document.getElementById('modal-cat').textContent = stage==='diamond'
    ? qItem.category
    : `${gameDB[stage][ci].cat} — ${qItem.v} نقطة`;
  document.getElementById('bank-bet-zone').style.display='none';
  document.getElementById('modal-a').className='modal-a';
  document.getElementById('modal-a').textContent='';

  const isSpeed=(stage===speedLoc.stage&&ci===speedLoc.cat&&qi===speedLoc.q)||(stage==='diamond'&&qItem.isSpeedRound);
  const isBank =(stage===bankLoc.stage&&ci===bankLoc.cat&&qi===bankLoc.q);

  if(isSpeed||isBank){
    const sc=document.getElementById('modal-surprise'); sc.style.display='flex';
    spawnParticles('surprise-particles');
    if(isSpeed){
      document.getElementById('surprise-icon').textContent='⚡';
      document.getElementById('surprise-text').textContent='دقيقة السرعة!';
      document.getElementById('surprise-text').style.color='var(--danger)';
      sfx.startSpeed(220);
      syncSurprise('⚡','دقيقة السرعة!','var(--danger)');
    } else {
      document.getElementById('surprise-icon').textContent='🏛️';
      document.getElementById('surprise-text').textContent='البنك!';
      document.getElementById('surprise-text').style.color='var(--gold-lt)';
      sfx.bankSurprise();
      setTimeout(()=>sfx.startBank(),1200);
      syncSurprise('🏛️','البنك!','var(--gold-lt)');
    }
    setTimeout(()=>{ sc.style.display='none'; launchModal(isSpeed,isBank,qItem); },5000);
  } else {
    document.getElementById('modal-surprise').style.display='none';
    sfx.question();
    launchModal(false,false,qItem);
    const cat = stage==='diamond' ? qItem.category : gameDB[stage][cellRef.ci].cat;
    const val = stage==='diamond' ? 0 : gameDB[stage][cellRef.ci].questions[cellRef.qi].v;
    syncQuestion(qItem, cat, val, 30, 'normal');
  }
}

// ------- Media / Puzzle modal launchers -------
async function launchImageModal(qItem, ci, qi) {
  initAudio();
  cellRef={stage,ci,qi}; responder=null; bankMode=false; bankBet=0;
  await resetBuzzer();
  document.getElementById('modal-overlay').style.display='flex';
  document.getElementById('modal-cat').textContent = `${gameDB[stage][ci].cat} — ${qItem.v} نقطة`;
  document.getElementById('bank-bet-zone').style.display='none';
  document.getElementById('modal-a').className='modal-a';
  document.getElementById('modal-a').innerHTML = `<img src="${qItem.imageUrl}" class="modal-media-img">`;
  document.getElementById('modal-q').textContent = qItem.q || '';
  document.getElementById('modal-a').classList.add('show');
  const cat = gameDB[stage][ci].cat; const val = gameDB[stage][ci].questions[qi].v;
  syncQuestion(qItem, cat, val, 30, 'normal');
  startTimer(30,'normal');
}

async function launchMusicModal(qItem, ci, qi) {
  initAudio(); cellRef={stage,ci,qi}; responder=null; bankMode=false; bankBet=0; await resetBuzzer();
  document.getElementById('modal-overlay').style.display='flex';
  document.getElementById('modal-cat').textContent = `${gameDB[stage][ci].cat} — ${qItem.v} نقطة`;
  document.getElementById('bank-bet-zone').style.display='none';
  const iframe = `<iframe class="modal-media-iframe" src="${qItem.audioUrl}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  document.getElementById('modal-a').innerHTML = iframe;
  document.getElementById('modal-q').textContent = qItem.q || '';
  document.getElementById('modal-a').classList.add('show');
  const cat = gameDB[stage][ci].cat; const val = gameDB[stage][ci].questions[qi].v;
  qItem.partIndex = qItem.partIndex || 0;
  syncQuestion(qItem, cat, val, 30, 'normal');
  startTimer(30,'normal');
}

async function launchPuzzleModal(qItem, ci, qi) {
  initAudio(); cellRef={stage,ci,qi}; responder=null; bankMode=false; bankBet=0; await resetBuzzer();
  document.getElementById('modal-overlay').style.display='flex';
  document.getElementById('modal-cat').textContent = `${gameDB[stage][ci].cat} — ${qItem.v} نقطة`;
  document.getElementById('bank-bet-zone').style.display='none';
  // Build simple puzzle UI for host (players get only question and choice buttons via sync)
  const container = document.createElement('div');
  container.className = 'puzzle-host';
  if (qItem.puzzle && qItem.puzzle.subtype === 'odd_one_out') {
    const choices = qItem.puzzle.choices || [];
    const html = choices.map((c,i)=>`<button class="puzzle-btn">${c}</button>`).join('');
    document.getElementById('modal-q').textContent = qItem.q || '';
    document.getElementById('modal-a').innerHTML = html; document.getElementById('modal-a').classList.add('show');
  } else {
    document.getElementById('modal-q').textContent = qItem.q || '';
    document.getElementById('modal-a').textContent = qItem.puzzle && qItem.puzzle.hint ? qItem.puzzle.hint : '';
    document.getElementById('modal-a').classList.add('show');
  }
  const cat = gameDB[stage][ci].cat; const val = gameDB[stage][ci].questions[qi].v;
  syncQuestion(qItem, cat, val, 30, 'normal');
  startTimer(30,'normal');
}

async function launchModal(isSpeed,isBank,qItem) {
  const resp=document.getElementById('modal-responder');
  const bank=document.getElementById('modal-bank');
  const judge=document.getElementById('modal-judge');
  const speed=document.getElementById('modal-speed');

  if(isSpeed){
    resp.style.display='none'; bank.style.display='none';
    judge.style.display='none'; speed.style.display='block';
    document.getElementById('speed-diamond-zone').style.display=stage==='diamond'?'block':'none';
    speedIdx=0; loadSpeedQ(); buildSpeedBtns();
    startTimer(120, 'speed');
    // Sync speed question to audience
    const spq = gameDB.speedBank[0] || { q: '⚡ جولة السرعة' };
    syncQuestion({ q: spq.q || '⚡ جولة السرعة' }, '⚡ دقيقة السرعة', 100, 120, 'speed');
    startSpeedTempoEscalator();
  } else if(isBank){
    resp.style.display='block'; bank.style.display='block';
    judge.style.display='none'; speed.style.display='none';
    buildResponderBtns();
    await typewrite(document.getElementById('modal-q'),'🏛️ فقرة البنك الاستثمارية\nاسأل الفارس عن رغبته الاستراتيجية الآن:',35);
    const a=document.getElementById('modal-a');
    a.textContent='سؤال الرهان: ما اسم عاصمة سلطنة عمان؟  [ مسقط ]';
    a.classList.add('show');
    startTimer(45,'bank');
  } else {
    resp.style.display='block'; bank.style.display='none';
    judge.style.display='flex'; speed.style.display='none';
    // Only correct/wrong disabled until responder selected. Skip & Reveal always enabled.
    judge.querySelectorAll('.judge-btn').forEach(b=>{
      if(b.classList.contains('judge-correct') || b.classList.contains('judge-wrong')) b.disabled=true;
    });
    buildResponderBtns();
    await typewrite(document.getElementById('modal-q'), qItem.q, 40);
    const a=document.getElementById('modal-a');
    a.textContent=`الإجابة:  ${qItem.a}`;
    a.classList.add('show');
    startTimer(30,'normal');
  }
}

// ══════════════════════════════════════════
//  BANK
// ══════════════════════════════════════════
function showBankBet() {
  if(responder===null){ alert('الرجاء اختيار الفارس أولاً!'); return; }
  const p=players.find(x=>x.id===responder);
  const cv=gameDB[cellRef.stage][cellRef.ci].questions[cellRef.qi].v;
  const inp=document.getElementById('bank-bet-input');
  const lim=document.getElementById('bank-bet-limits');
  if(p.score<cv){
    inp.min=inp.max=inp.value=p.score; inp.disabled=true;
    lim.style.color='var(--danger)';
    lim.textContent=`🚨 الرصيد أقل! المشاركة إجبارية بكامل الرصيد (${p.score} ن)`;
  } else {
    inp.min=cv; inp.max=p.score; inp.value=cv; inp.disabled=false;
    lim.style.color='var(--muted)';
    lim.textContent=`الحد الأدنى: ${cv} | الحد الأقصى: ${p.score}`;
  }
  document.getElementById('bank-bet-zone').style.display='block';
}

function confirmBankBet() {
  const p=players.find(x=>x.id===responder);
  const bv=parseInt(document.getElementById('bank-bet-input').value);
  const cv=gameDB[cellRef.stage][cellRef.ci].questions[cellRef.qi].v;
  if(!(p.score<cv&&bv===p.score)){
    if(isNaN(bv)||bv<cv){ alert(`الحد الأدنى ${cv} ن!`); return; }
    if(bv>p.score){ alert('يتجاوز الرصيد!'); return; }
  }
  bankBet=bv; bankMode=true;
  typewrite(document.getElementById('modal-q'),`💰 سؤال رهان البنك\nما اسم عاصمة سلطنة عمان الحالية؟\n[ الرهان المثبت: ${bv} نقطة ]`,35);
  document.getElementById('modal-bank').style.display='none';
  document.getElementById('modal-judge').style.display='flex';
  document.getElementById('modal-judge').querySelectorAll('.judge-btn').forEach(b=>b.disabled=false);
}

function freezeBank() {
  if(responder===null){ alert('الرجاء اختيار الفارس أولاً!'); return; }
  const p=players.find(x=>x.id===responder);
  p.isBanked=true; p.bankedValue=p.score; sfx.correct();
  alert(`🔒 تم تحصين مبلغ (${p.score} ن) لـ ${p.name}`);
  closeModal();
}

// ══════════════════════════════════════════
//  JUDGING
// ══════════════════════════════════════════
function judge(ok) {
  if(responder===null) return;
  clearInterval(cdTimer);
  const p=players.find(x=>x.id===responder);

  if(bankMode){
    if(ok){ sfx.correct(); p.score+=bankBet; alert(`✨ رهان صحيح! +${bankBet} لـ ${p.name}`); }
    else  { sfx.wrong(); const fl=p.isBanked?p.bankedValue:0; p.score=Math.max(fl,p.score-bankBet); alert(`❌ رهان خاطئ! −${bankBet} ن من ${p.name}`); }
  } else if(stage==='diamond'){
    if(ok){ sfx.correct(); diamondState[cellRef.ci].owner=p.id; } else sfx.wrong();
    diamondState[cellRef.ci].spent=true;
  } else {
    const q=gameDB[stage][cellRef.ci].questions[cellRef.qi];
    if(ok){ sfx.correct(); p.score+=q.v; }
    else  { sfx.wrong(); const fl=p.isBanked?p.bankedValue:0; p.score=Math.max(fl,p.score-Math.floor(q.v/2)); }
    q.spent=true;
  }
  closeModal();
}

function closeModal() {
  clearInterval(cdTimer);
  clearInterval(speedTimerInterval);
  sfx.stopAll();
  document.getElementById('modal-surprise').style.display='none';
  document.getElementById('modal-overlay').style.display='none';
  // Hide buzzer winner cue on host
  updateBuzzerUI(null);
  // Reset buzzer node
  resetBuzzer();
  // Clear voting node on Firebase
  fbPut(`https://${FIREBASE_HOST}/rooms/${ROOM}/gameState/voting.json`, { active: false, locked: false, counts: { A:0, B:0, C:0, D:0 }, total: 0 });

  if(stage==='diamond'){
    diamondState[cellRef.ci].spent=true; renderDiamond(); checkWinner();
  } else {
    gameDB[stage][cellRef.ci].questions[cellRef.qi].spent=true;
    buildBoard(stage); refreshScores();
  }
  cellRef=null; responder=null; bankMode=false; bankBet=0;
  syncCloseQuestion();
}

// ══════════════════════════════════════════
//  TIMER (Normal + Bank + 120s Speed)
// ══════════════════════════════════════════
function startTimer(secs, mode) {
  clearInterval(cdTimer);
  const bar=document.getElementById('modal-timer-bar');
  const num=document.getElementById('modal-timer-num');
  bar.className='modal-timer-bar'+(mode==='speed'?' danger':mode==='bank'?' bank':'');
  bar.style.width='100%'; num.textContent=secs;
  let rem=secs;
  cdTimer=setInterval(()=>{
    rem--; bar.style.width=`${(rem/secs)*100}%`; num.textContent=rem;
    if(mode==='normal' && rem<=5 && rem>0) tone(880,'sine',.04,.05);
    if(rem<=0){
      clearInterval(cdTimer);
      if(mode==='speed'){ sfx.stopAll(); sfx.wrong(); alert('⏱️ انتهت دقيقة السرعة!'); closeModal(); }
      if(mode==='bank') sfx.stopAll();
    }
  },1000);
}

// Speed tempo escalator for 120s round
function startSpeedTempoEscalator() {
  clearInterval(speedTimerInterval);
  let elapsed = 0;
  // 4 tempo phases across 120s: 0-45s=chill, 45-90s=fast, 90-105s=urgent, 105-120s=danger
  speedTimerInterval = setInterval(() => {
    elapsed++;
    if (elapsed === 45) sfx.setSpeedTempo(170, false);
    else if (elapsed === 90) sfx.setSpeedTempo(130, false);
    else if (elapsed === 105) sfx.setSpeedTempo(95, true); // danger phase (last 15s)
    if (elapsed >= 120) { clearInterval(speedTimerInterval); speedTimerInterval = null; }
  }, 1000);
}

// ══════════════════════════════════════════
//  RESPONDER BUTTONS
// ══════════════════════════════════════════
function buildResponderBtns() {
  const c=document.getElementById('modal-responder-btns'); c.innerHTML='';
  const list=stage==='diamond'?diamondPlayers:players;
  list.forEach(p=>{
    const b=document.createElement('button');
    b.className='resp-btn'; b.textContent=p.name; b.id=`rb-${p.id}`;
    b.onclick=()=>selectResponder(p.id); c.appendChild(b);
  });
}

function selectResponder(id) {
  tone(500,'sine',.06,.07); responder=id;
  document.querySelectorAll('.resp-btn').forEach(b=>b.classList.remove('sel'));
  document.getElementById(`rb-${id}`)?.classList.add('sel');
  if(document.getElementById('modal-bank').style.display==='block') showBankBet();
  else document.getElementById('modal-judge').querySelectorAll('.judge-btn').forEach(b=>{
    if(b.classList.contains('judge-correct') || b.classList.contains('judge-wrong')) b.disabled=false;
  });
}

// ══════════════════════════════════════════
//  BUZZER WATCH (host receives buzzer winner)
// ══════════════════════════════════════════
function watchBuzzerState() {
  // Poll buzzer node every 400ms (simple & robust without SDK)
  setInterval(async () => {
    const data = await fbGet(FB_URL_BUZZ);
    if (data && data.winnerId !== null && data.winnerId !== undefined) {
      updateBuzzerUI(data);
    }
  }, 400);
}

function renderTextAnswers(answers) {
  const panel = document.getElementById('modal-text-answers');
  if (!panel) return;
  let list = panel.querySelector('.text-answers-list');
  if (!list) {
    list = document.createElement('div');
    list.className = 'text-answers-list';
    panel.appendChild(list);
  }
  if (!answers || Object.keys(answers).length === 0) {
    panel.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  panel.style.display = 'block';
  const lines = Object.keys(answers).map(key => {
    const item = answers[key] || {};
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    const name = item.playerName || item.playerId || 'متسابق';
    return `<div class="answer-item"><span class="answer-name">${escapeHtml(name)}</span>: <span class="answer-text">${escapeHtml(text)}</span></div>`;
  });
  list.innerHTML = lines.join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, tag => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[tag]));
}

function watchTextAnswers() {
  setInterval(async () => {
    const data = await fbGet(FB_URL_TEXT_ANS);
    currentTextAnswers = data || {};
    renderTextAnswers(currentTextAnswers);
  }, 800);
}


function updateBuzzerUI(data) {
  const modalBuzz = document.getElementById('modal-buzz-winner');
  const modalName = document.getElementById('modal-buzz-name');
  const flash = document.getElementById('buzz-flash');
  const flashName = document.getElementById('buzz-flash-name');
  if (data && data.winnerName) {
    modalName.textContent = data.winnerName;
    modalBuzz.style.display = 'block';
    flashName.textContent = data.winnerName;
    flash.classList.add('on');
    showBuzzerWinnerFlash(data.winnerName, data.winnerId);
    // Auto-select responder for judging
    if (data.winnerId !== null && data.winnerId !== undefined && document.getElementById('modal-overlay').style.display === 'flex') {
      selectResponder(Number(data.winnerId));
    }
    // sfx.buzzHit && sfx.buzzHit();
  } else {
    modalBuzz.style.display = 'none';
    flash.classList.remove('on');
  }
}

// ══════════════════════════════════════════
//  SPEED ROUND
// ══════════════════════════════════════════
function loadSpeedQ() {
  if(speedIdx>=gameDB.speedBank.length) speedIdx=0;
  const q=gameDB.speedBank[speedIdx];
  document.getElementById('modal-cat').textContent=`⚡ جولة السرعة — سؤال (${speedIdx+1}) — 120 ثانية`;
  typewrite(document.getElementById('modal-q'),q.q,32);
  const a=document.getElementById('modal-a'); a.textContent=`الإجابة: ${q.a}`; a.classList.add('show');
  // Sync speed sub-question
  syncQuestion({ q: q.q }, '⚡ دقيقة السرعة', 100, null, 'speed-item');
}

function buildSpeedBtns() {
  const c1=document.getElementById('speed-btns');
  const c2=document.getElementById('speed-diamond-btns');
  c1.innerHTML=''; c2.innerHTML='';
  const list=stage==='diamond'?diamondPlayers:players;
  list.forEach((p,i)=>{
    const b=document.createElement('button'); b.className='speed-btn';
    b.textContent=`✓ ${p.name} +100`;
    b.onclick=()=>{ sfx.correct(); p.score+=100; refreshScores(); speedIdx++; loadSpeedQ(); };
    c1.appendChild(b);
    if(stage==='diamond'){
      const bw=document.createElement('button'); bw.className='speed-btn';
      bw.style.background=i===0?'rgba(127,29,29,.6)':'rgba(0,60,80,.6)';
      bw.textContent=`♦ جوهرة لـ ${p.name}`;
      bw.onclick=()=>{ sfx.correct(); diamondState[cellRef.ci].owner=p.id; diamondState[cellRef.ci].spent=true; };
      c2.appendChild(bw);
    }
  });
  const sk=document.createElement('button'); sk.className='speed-btn speed-skip'; sk.textContent='⟶ تخطي';
  sk.onclick=()=>{ tone(350,'sine',.07,.05); speedIdx++; loadSpeedQ(); };
  c1.appendChild(sk);
}

// ══════════════════════════════════════════
//  DIAMOND GRID
// ══════════════════════════════════════════
function initDiamond() {
  diamondState=gameDB.diamond.slice(0,9).map(x=>({category:x.cat,q:x.q,a:x.a,spent:false,owner:null,isSpeedRound:!!x.isSpeedRound}));
  renderDiamond();
}

function renderDiamond() {
  const c=document.getElementById('board-diamond'); c.innerHTML='';
  diamondState.forEach((cell,i)=>{
    const d=document.createElement('div'); d.className='diamond-cell';
    if(cell.spent&&cell.owner!==null){
      const p1=cell.owner===diamondPlayers[0].id;
      d.innerHTML=`<span class="jewel ${p1?'jewel-r':'jewel-b'}">♦</span>`;
    } else if(cell.spent){
      d.classList.add('spent'); d.textContent=cell.category;
    } else {
      d.textContent=cell.category; d.onclick=()=>openModal(i,null);
    }
    c.appendChild(d);
  });
}

function checkWinner() {
  const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for(const[a,b,c] of lines){
    const o=diamondState[a].owner;
    if(o!==null&&o===diamondState[b].owner&&o===diamondState[c].owner){
      const w=players.find(p=>p.id===o);
      sfx.victory();
      setTimeout(()=>showWinnerPage(w),800);
      return;
    }
  }
}

// ══════════════════════════════════════════
//  WINNER PAGE
// ══════════════════════════════════════════
function showWinnerPage(winner) {
  const sorted=[...players].sort((a,b)=>b.score-a.score);
  document.getElementById('winner-name').textContent=winner.name;
  document.getElementById('winner-score').textContent=`${winner.score} نقطة`;
  const rankEl=document.getElementById('winner-ranking');
  rankEl.innerHTML='';
  sorted.forEach((p,i)=>{
    const medals=['🥇','🥈','🥉'];
    const d=document.createElement('div');
    d.className=`rank-item rank-${i+1}`;
    d.innerHTML=`${medals[i]||'④'} ${p.name} — <strong>${p.score}</strong>`;
    rankEl.appendChild(d);
  });
  goTo('winner');
  spawnFireworks();
}

// ═══════════════════════════════════════════════════════════════════
//  WEBRTC — HOST-SIDE AUDIO HUB (vendor-agnostic, Firebase signaling)
// ═══════════════════════════════════════════════════════════════════
// Architecture: Star topology. Each player peer connects to Host.
// Host holds one RTCPeerConnection per player. Signaling via Firebase RTDB.
//
// Data plane paths (Firebase RTDB):
//   /signaling/players/{pid}/offer                     ← from Player
//   /signaling/players/{pid}/answer                    ← from Host
//   /signaling/players/{pid}/candidatesFromPlayer/*    ← from Player
//   /signaling/players/{pid}/candidatesFromHost/*      ← from Host
//
// This module is fully replaceable — replace fbGet/fbPut with any transport.
// ═══════════════════════════════════════════════════════════════════

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const hostPeers = {};        // { pid: { pc, remoteAudio, seenCandidates:Set, offerTs } }
let hostLocalStream = null;
let hostMicEnabled = false;
let hostRtcPollTimer = null;

async function initHostWebRTC() {
  // Prime signaling listener without acquiring mic yet.
  updateRtcUI('idle', 0);
  hostRtcPollTimer = setInterval(pollSignaling, 900);
  // Watch presence node for active participants counter
  setInterval(async () => {
    const p = await fbGet(`https://${FIREBASE_HOST}/rooms/${ROOM}/presence/players.json?shallow=true`);
    const count = p ? Object.keys(p).length : 0;
    const el = document.getElementById('rtc-participants');
    if (el) el.textContent = count;
  }, 1500);
}

function updateRtcUI(state, peers) {
  const panel = document.getElementById('rtc-panel');
  const status = document.getElementById('rtc-status');
  const peersEl = document.getElementById('rtc-peers');
  if (!panel) return;
  if (state === 'live') {
    panel.classList.add('live');
    status.textContent = hostMicEnabled ? '🎙️ الميكروفون يعمل' : 'البث الصوتي يعمل';
  } else if (state === 'idle') {
    panel.classList.remove('live');
    status.textContent = 'جاهز — بانتظار المتسابقين';
  }
  if (peersEl) peersEl.textContent = `${peers || 0} اتصال WebRTC`;
}

async function pollSignaling() {
  // Fetch all offers from players
  const url = `${FB_URL_SIG}/players.json?shallow=true`;
  const list = await fbGet(url);
  if (!list) { updateRtcUI(Object.keys(hostPeers).length ? 'live' : 'idle', Object.keys(hostPeers).length); return; }
  const pids = Object.keys(list);
  updateRtcUI(pids.length ? 'live' : 'idle', pids.length);
  for (const pid of pids) {
    if (hostPeers[pid]) {
      // Check for new ICE candidates from player
      const cands = await fbGet(`${FB_URL_SIG}/players/${pid}/candidatesFromPlayer.json`);
      if (cands) {
        for (const key of Object.keys(cands)) {
          if (!hostPeers[pid].seenCandidates.has(key)) {
            hostPeers[pid].seenCandidates.add(key);
            try { await hostPeers[pid].pc.addIceCandidate(new RTCIceCandidate(cands[key])); } catch(e){}
          }
        }
      }
      continue;
    }
    // New player — process offer
    const offer = await fbGet(`${FB_URL_SIG}/players/${pid}/offer.json`);
    if (offer && offer.sdp) {
      try { await createHostPeerForPlayer(pid, offer); } catch(e){ console.warn('Peer create failed', pid, e); }
    }
  }
  // Cleanup peers whose signaling was removed
  for (const pid of Object.keys(hostPeers)) {
    if (!list[pid]) {
      try { hostPeers[pid].pc.close(); } catch(e){}
      delete hostPeers[pid];
    }
  }
}

async function createHostPeerForPlayer(pid, offer) {
  const pc = new RTCPeerConnection(rtcConfig);
  const entry = { pc, remoteAudio: null, seenCandidates: new Set(), offerTs: offer.ts || Date.now() };
  hostPeers[pid] = entry;

  // Remote audio (player's voice)
  pc.ontrack = (evt) => {
    if (evt.streams && evt.streams[0]) {
      const audio = new Audio();
      audio.srcObject = evt.streams[0];
      audio.autoplay = true;
      audio.play().catch(()=>{});
      entry.remoteAudio = audio;
    }
  };

  pc.onicecandidate = async (evt) => {
    if (evt.candidate) {
      const key = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
      await fbPut(`${FB_URL_SIG}/players/${pid}/candidatesFromHost/${key}.json`, evt.candidate.toJSON());
    }
  };

  // Add host mic tracks if available
  if (hostLocalStream) {
    hostLocalStream.getAudioTracks().forEach(t => pc.addTrack(t, hostLocalStream));
  } else {
    // Ensure we can still receive
    pc.addTransceiver('audio', { direction: 'recvonly' });
  }

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await fbPut(`${FB_URL_SIG}/players/${pid}/answer.json`, { type: answer.type, sdp: answer.sdp, ts: Date.now() });
}

// Host mic toggle
async function toggleHostMic() {
  const btn = document.getElementById('btn-mic-toggle');
  if (!hostLocalStream) {
    try {
      hostLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      hostLocalStream.getAudioTracks().forEach(t => t.enabled = true);
      hostMicEnabled = true;
      // Add tracks to existing peers
      for (const pid of Object.keys(hostPeers)) {
        try {
          hostLocalStream.getAudioTracks().forEach(t => hostPeers[pid].pc.addTrack(t, hostLocalStream));
          // Renegotiate
          const pc = hostPeers[pid].pc;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          // Push updated offer as re-offer (players will pick up on their answer listener)
          await fbPut(`${FB_URL_SIG}/players/${pid}/hostReoffer.json`, { type: offer.type, sdp: offer.sdp, ts: Date.now() });
        } catch(e){ console.warn('Re-negotiate failed', pid, e); }
      }
      btn.textContent = '🔇 كتم الميكروفون';
      btn.classList.remove('muted');
      updateRtcUI('live', Object.keys(hostPeers).length);
    } catch(e) {
      alert('لم يتم الحصول على إذن الميكروفون: ' + e.message);
    }
    return;
  }
  // Toggle enabled state
  hostMicEnabled = !hostMicEnabled;
  hostLocalStream.getAudioTracks().forEach(t => t.enabled = hostMicEnabled);
  if (hostMicEnabled) {
    btn.textContent = '🔇 كتم الميكروفون'; btn.classList.remove('muted');
    document.getElementById('rtc-status').textContent = '🎙️ الميكروفون يعمل';
  } else {
    btn.textContent = '🎙️ تفعيل الميكروفون'; btn.classList.add('muted');
    document.getElementById('rtc-status').textContent = 'الميكروفون مكتوم';
  }
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  clearInterval(hostRtcPollTimer);
  for (const pid of Object.keys(hostPeers)) {
    try { hostPeers[pid].pc.close(); } catch(e){}
  }
  if (hostLocalStream) hostLocalStream.getTracks().forEach(t => t.stop());
});

// ═══════════════════════════════════════════════════════════════════
//  SESSION RECORDING — MediaRecorder API (getDisplayMedia)
// ═══════════════════════════════════════════════════════════════════
let sessionRecorder = null;
let sessionRecordedChunks = [];
let sessionDisplayStream = null;

async function toggleRecording() {
  const btn = document.getElementById('btn-record-toggle');
  if (!btn) return;
  if (!sessionRecorder) {
    // Start recording — request display + mic capture
    try {
      // Screen capture (video + optional system audio)
      sessionDisplayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true
      });
      // Also include mic audio if available
      const combined = new MediaStream();
      sessionDisplayStream.getVideoTracks().forEach(t => combined.addTrack(t));
      // Prefer display audio; if none, use host mic
      if (sessionDisplayStream.getAudioTracks().length > 0) {
        sessionDisplayStream.getAudioTracks().forEach(t => combined.addTrack(t));
      } else if (hostLocalStream) {
        hostLocalStream.getAudioTracks().forEach(t => combined.addTrack(t));
      } else {
        // Try to grab mic just for recording
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          mic.getAudioTracks().forEach(t => combined.addTrack(t));
        } catch(e){}
      }

      // Pick supported mime
      const options = { mimeType: 'video/webm;codecs=vp9,opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm;codecs=vp8,opus';
        if (!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = 'video/webm';
      }
      sessionRecordedChunks = [];
      sessionRecorder = new MediaRecorder(combined, options);
      sessionRecorder.ondataavailable = (evt) => {
        if (evt.data && evt.data.size > 0) sessionRecordedChunks.push(evt.data);
      };
      sessionRecorder.onstop = () => {
        const blob = new Blob(sessionRecordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
        a.href = url;
        a.download = `بنك-المعلومات-${ts}.webm`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        sessionRecordedChunks = [];
      };
      // Auto-stop if user ends screen share via browser UI
      sessionDisplayStream.getVideoTracks()[0].onended = () => {
        if (sessionRecorder && sessionRecorder.state !== 'inactive') {
          try { sessionRecorder.stop(); } catch(e){}
          cleanupRecording();
          btn.textContent = '🔴 تسجيل الجلسة'; btn.classList.remove('recording');
        }
      };
      sessionRecorder.start(1000); // 1s chunks
      btn.textContent = '⏹️ إيقاف وحفظ'; btn.classList.add('recording');
    } catch(e) {
      alert('تعذّر بدء التسجيل: ' + e.message);
      cleanupRecording();
    }
    return;
  }
  // Stop recording
  try { sessionRecorder.stop(); } catch(e){}
  cleanupRecording();
  btn.textContent = '🔴 تسجيل الجلسة'; btn.classList.remove('recording');
}

function cleanupRecording() {
  if (sessionDisplayStream) {
    sessionDisplayStream.getTracks().forEach(t => { try { t.stop(); } catch(e){} });
    sessionDisplayStream = null;
  }
  sessionRecorder = null;
}

// Expose to global scope for onclick handlers
// ══════════════════════════════════════════
// Extra banks integration: merge `new_banks.js` into runtime ALL_BANKS
function loadExtraBanks() {
  try {
    window.ALL_BANKS = window.ALL_BANKS || {};
    // prefer explicit globals if available
    if (typeof healthBank !== 'undefined') window.ALL_BANKS.health = healthBank;
    if (typeof sportsBank !== 'undefined') window.ALL_BANKS.sports = sportsBank;
    if (typeof spaceBank !== 'undefined') window.ALL_BANKS.space = spaceBank;
    if (typeof foodBank !== 'undefined') window.ALL_BANKS.food = foodBank;
    if (typeof animalsBank !== 'undefined') window.ALL_BANKS.animals = animalsBank;
    if (typeof worldHistoryBank !== 'undefined') window.ALL_BANKS.worldHistory = worldHistoryBank;
    // also accept window.EXTRA_BANKS as an object map
    if (window.EXTRA_BANKS && typeof window.EXTRA_BANKS === 'object' && !Array.isArray(window.EXTRA_BANKS)) {
      Object.keys(window.EXTRA_BANKS).forEach(k => { window.ALL_BANKS[k] = window.EXTRA_BANKS[k]; });
    }
    console.log('[Banks] Loaded extra banks →', Object.keys(window.ALL_BANKS || {}).length);
  } catch(e) { console.warn('loadExtraBanks error', e); }
}
setTimeout(loadExtraBanks, 150);

// ══════════════════════════════════════════
//  MULTI-PART MODAL
// ══════════════════════════════════════════
async function launchMultiPartModal(qItem, ci, qi) {
  const data = qItem.multiPartData;
  const parts = data.parts || [];
  let currentPart = 0;
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('modal-surprise').style.display = 'none';
  document.getElementById('modal-bank').style.display = 'none';
  document.getElementById('modal-speed').style.display = 'none';
  const judgeEl = document.getElementById('modal-judge');
  judgeEl.style.display = 'flex';
  judgeEl.querySelectorAll('.judge-btn').forEach(b => { if(b.classList.contains('judge-correct')||b.classList.contains('judge-wrong')) b.disabled=false; });
  let mpZone = document.getElementById('multipart-zone');
  if (!mpZone) { mpZone=document.createElement('div'); mpZone.id='multipart-zone'; mpZone.style.cssText='margin:10px 0;display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;direction:rtl'; document.getElementById('modal-q').parentNode.insertBefore(mpZone, document.getElementById('modal-q')); }
  const typeLabels = { fill:'📝 أكمل الجملة', independent:'❓ أسئلة متسلسلة', truefalse:'✅ صح أم خطأ', whoami:'🎭 من أنا؟', link:'🔗 ربط', sequence:'🔢 سلسلة', order:'📋 رتّب' };
  function renderParts() {
    mpZone.innerHTML='';
    document.getElementById('modal-cat').textContent=(typeLabels[data.type]||'📚')+' — '+data.title+' — '+qItem.v+' نقطة';
    document.getElementById('modal-q').textContent='الجزء '+(currentPart+1)+' من '+parts.length;
    document.getElementById('modal-a').textContent=''; document.getElementById('modal-a').classList.remove('show');
    parts.forEach((part,idx)=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:'+(idx<currentPart?'rgba(16,185,129,.15)':idx===currentPart?'rgba(240,165,0,.15)':'rgba(255,255,255,.04)')+';border:1px solid '+(idx<currentPart?'#10b981':idx===currentPart?'#f0a500':'rgba(255,255,255,.1)');
      const num=document.createElement('span'); num.textContent=(idx+1)+'.'; num.style.cssText='font-weight:900;color:#94a3b8;min-width:20px';
      const qText=document.createElement('span'); qText.textContent=part.q; qText.style.cssText='flex:1;font-size:11pt;color:#f0f0ff';
      const aText=document.createElement('span');
      if(idx<currentPart){aText.textContent='← '+part.a;aText.style.cssText='color:#10b981;font-weight:800;font-size:10pt';}
      else if(idx===currentPart){aText.textContent='← '+part.a;aText.style.cssText='color:#f0a500;font-weight:800;font-size:10pt;opacity:0';aText.id='mp-current-answer';}
      row.appendChild(num);row.appendChild(qText);row.appendChild(aText);mpZone.appendChild(row);
    });
  }
  let nextBtn=document.getElementById('mp-next-btn');
  if(!nextBtn){nextBtn=document.createElement('button');nextBtn.id='mp-next-btn';nextBtn.style.cssText='margin-top:10px;width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#6d28d9,#8b5cf6);color:#fff;font-family:Cairo,sans-serif;font-weight:900;font-size:12pt;cursor:pointer';document.getElementById('modal-a').after(nextBtn);}
  nextBtn.style.display='block';
  renderParts();
  nextBtn.onclick=async()=>{
    const curAns=document.getElementById('mp-current-answer');
    if(curAns){curAns.style.opacity='1';curAns.style.transition='opacity .3s';}
    await new Promise(r=>setTimeout(r,900));
    currentPart++;
    if(currentPart<parts.length){renderParts();nextBtn.textContent=currentPart===parts.length-1?'✓ الجزء الأخير':'الجزء التالي ←';}
    else{nextBtn.style.display='none';document.getElementById('modal-q').textContent='✅ اكتملت الأجزاء — قرار المقدم:';buildResponderBtns();}
  };
  nextBtn.textContent=parts.length>1?'الجزء التالي ←':'✓ عرض الإجابة';
  buildResponderBtns();
  startTimer(parts.length*25,'normal');
  const origJudge=window.judge;
  window.judge=function(ok){
    window.judge=origJudge;
    nextBtn.style.display='none';
    mpZone.innerHTML='';
    setTimeout(()=>origJudge.call(window,ok),500);
  };
}
// ══════════════════════════════════════════
//  IMAGE / MUSIC / PUZZLE MODALS
// ══════════════════════════════════════════
async function launchImageModal(qItem, ci, qi) {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('modal-surprise').style.display = 'none';
  document.getElementById('modal-bank').style.display = 'none';
  document.getElementById('modal-speed').style.display = 'none';
  const judgeEl = document.getElementById('modal-judge');
  judgeEl.style.display = 'flex';
  judgeEl.querySelectorAll('.judge-btn').forEach(b => { if(b.classList.contains('judge-correct')||b.classList.contains('judge-wrong')) b.disabled=false; });
  // Host view: show image and full answer for host
  document.getElementById('modal-cat').textContent = (qItem.cat || 'سؤال') + ' — 🖼️ سؤال بصوري — ' + (qItem.v || 0) + ' نقطة';
  const mq = document.getElementById('modal-q'); mq.textContent = qItem.q || '';
  const ma = document.getElementById('modal-a'); ma.textContent = qItem.a || ''; ma.classList.add('show');
  // Insert image above question text
  let imgEl = document.querySelector('#modal-q-box .modal-media-img');
  if (!imgEl) {
    imgEl = document.createElement('img'); imgEl.className = 'modal-media-img'; imgEl.style.display='block';
    document.getElementById('modal-q').parentNode.insertBefore(imgEl, document.getElementById('modal-q'));
  }
  imgEl.src = qItem.imageUrl || '';
  // Send to players (without answer)
  const sendItem = Object.assign({}, qItem);
  delete sendItem.a;
  sendItem.type = 'image';
  await resetBuzzer();
  cellRef = {stage,ci,qi}; responder=null; bankMode=false; bankBet=0;
  startTimer(30,'normal');
  await syncQuestion(sendItem, qItem.cat || '', qItem.v || 0, 30, 'normal');
}

async function launchMusicModal(qItem, ci, qi) {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('modal-surprise').style.display = 'none';
  document.getElementById('modal-bank').style.display = 'none';
  document.getElementById('modal-speed').style.display = 'none';
  const judgeEl = document.getElementById('modal-judge');
  judgeEl.style.display = 'flex';
  judgeEl.querySelectorAll('.judge-btn').forEach(b => { if(b.classList.contains('judge-correct')||b.classList.contains('judge-wrong')) b.disabled=false; });
  let partIndex = qItem.partIndex || 0;
  document.getElementById('modal-cat').textContent = (qItem.cat || 'موسيقى') + ' — 🎵 سؤال موسيقي — ' + (qItem.v || 0) + ' نقطة';
  const mq = document.getElementById('modal-q'); const ma = document.getElementById('modal-a'); ma.classList.remove('show');
  function renderHost() {
    mq.textContent = (qItem.parts && qItem.parts[partIndex] && qItem.parts[partIndex].q) ? qItem.parts[partIndex].q : (qItem.title||'');
    ma.textContent = (qItem.parts && qItem.parts[partIndex] && qItem.parts[partIndex].a) ? qItem.parts[partIndex].a : '';
  }
  // Add host-only iframe preview
  let ifr = document.querySelector('#modal-q-box .modal-media-iframe');
  if (!ifr) { ifr = document.createElement('iframe'); ifr.className = 'modal-media-iframe'; document.getElementById('modal-q').parentNode.insertBefore(ifr, document.getElementById('modal-q')); }
  ifr.src = qItem.audioUrl || '';
  renderHost();

  // Controls: Play to audience, Next part
  let ctrl = document.getElementById('music-controls');
  if (!ctrl) { ctrl = document.createElement('div'); ctrl.id='music-controls'; ctrl.style.cssText='display:flex;gap:8px;margin-top:8px'; document.getElementById('modal-a').after(ctrl); }
  ctrl.innerHTML = '';
  const playBtn = document.createElement('button'); playBtn.textContent='▶️ تشغيل للجمهور'; playBtn.style.cssText='padding:8px 12px;border-radius:10px;background:#6d28d9;color:#fff;border:none;cursor:pointer';
  const nextBtn = document.createElement('button'); nextBtn.textContent='الجزء التالي'; nextBtn.style.cssText='padding:8px 12px;border-radius:10px;background:#f59e0b;color:#111;border:none;cursor:pointer';
  ctrl.appendChild(playBtn); ctrl.appendChild(nextBtn);

  playBtn.onclick = async () => {
    // send current part to players (without answer)
    const send = { type:'music', audioUrl: qItem.audioUrl, parts: qItem.parts ? qItem.parts.map(p=>p.q) : [], partIndex: partIndex, v: qItem.v, cat: qItem.cat };
    await resetBuzzer(); startTimer(25,'normal');
    await syncQuestion(send, qItem.cat||'', qItem.v||0, 25, 'normal');
  };
  nextBtn.onclick = () => {
    partIndex = Math.min((qItem.parts||[]).length-1, partIndex+1);
    renderHost();
  };
}

async function launchPuzzleModal(qItem, ci, qi) {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('modal-surprise').style.display = 'none';
  document.getElementById('modal-bank').style.display = 'none';
  document.getElementById('modal-speed').style.display = 'none';
  const judgeEl = document.getElementById('modal-judge');
  judgeEl.style.display = 'flex';
  judgeEl.querySelectorAll('.judge-btn').forEach(b => { if(b.classList.contains('judge-correct')||b.classList.contains('judge-wrong')) b.disabled=false; });
  document.getElementById('modal-cat').textContent = (qItem.cat || 'ألغاز') + ' — 🧩 ' + (qItem.title || '') + ' — ' + (qItem.v || 0) + ' نقطة';
  const mq = document.getElementById('modal-q'); const ma = document.getElementById('modal-a'); ma.classList.remove('show');
  // Host view shows full puzzle and explanation
  mq.textContent = qItem.title || qItem.q || '';
  ma.textContent = qItem.answer ? ('الإجابة: ' + qItem.answer + (qItem.explanation ? ' — ' + qItem.explanation : '')) : '';

  // Prepare puzzle payload for players
  const puzzlePayload = { subtype: qItem.subtype, items: qItem.items || qItem.choices || [], answer: qItem.answer, explanation: qItem.explanation };
  const send = { type:'puzzle', puzzle: puzzlePayload, v: qItem.v, cat: qItem.cat };
  await resetBuzzer(); startTimer(35,'normal');
  await syncQuestion(send, qItem.cat||'', qItem.v||0, 35, 'normal');
}
window.goTo = goTo;
window.goToSetup = goToSetup;
window.addPlayer = addPlayer;
window.selectTopic = selectTopic;
window.startGame = startGame;
window.advanceStage = advanceStage;
window.openModal = openModal;
window.showBankBet = showBankBet;
window.freezeBank = freezeBank;
window.confirmBankBet = confirmBankBet;
window.judge = judge;
window.closeModal = closeModal;
window.showQRCode = showQRCode;
window.hideQRCode = hideQRCode;
window.resetBuzzer = resetBuzzer;
window.revealAnswer = revealAnswer;
window.toggleVoting = toggleVoting;
window.toggleHostMic = toggleHostMic;
window.toggleRecording = toggleRecording;
