/* ============================================
   بنك المعلومات — النسخة المتطورة
   script.js — كل منطق التطبيق
   ============================================ */

'use strict';

// ══════════════════════════════════════════
//  FIREBASE REALTIME SYNC
// ══════════════════════════════════════════
const FB_URL = 'https://bank-almaloomat-game-default-rtdb.firebaseio.com/gameState.json';

async function syncToFirebase(data) {
  try {
    await fetch(FB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch(e) { console.warn('Firebase sync error:', e); }
}

function buildGameStateForSync() {
  if (!players || players.length === 0) return null;
  return {
    stage,
    players: players.map(p => ({ id: p.id, name: p.name, score: p.score, isBanked: p.isBanked, bankedValue: p.bankedValue })),
    board: (stage === 'silver' || stage === 'gold') ? db[stage] : null,
    diamondState: stage === 'diamond' ? diamondState : null,
    diamondPlayers: stage === 'diamond' ? diamondPlayers.map(p => ({ id: p.id, name: p.name })) : null,
    question: { active: false },
    surprise: { active: false },
    updatedAt: Date.now()
  };
}

async function syncQuestion(qItem, cat, value, timerSecs, timerMode) {
  if (!players || players.length === 0) return;
  const state = buildGameStateForSync();
  state.question = {
    active: true,
    text: qItem.q || '',
    cat: cat || '',
    value: value || 0,
    timerSecs,
    timerMode
  };
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

// ══════════════════════════════════════════
//  QR CODE — صفحة الإعداد
// ══════════════════════════════════════════
function generateSetupQR() {
    if (!document.getElementById('setup-qr-url')) {
        return;
    }
    const url = window.location.origin + '/audience.html';
  const container = document.getElementById('setup-qr-container');

  // استخدام Google Charts API بشكل بسيط
  const size = 140;
  const img = document.createElement('img');
  img.width = size;
  img.height = size;
  img.style.display = 'block';
  img.style.borderRadius = '8px';
  img.alt = 'QR Code';

  // محاولة أولى: Google Charts
  img.src = `https://chart.googleapis.com/chart?chs=${size}x${size}&cht=qr&chl=${encodeURIComponent(url)}&choe=UTF-8`;

  img.onerror = () => {
    // محاولة ثانية: QR Server
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;
    img.onerror = () => {
      // Fallback: نص الرابط
      container.innerHTML = `
        <div style="padding:16px;text-align:center;">
          <div style="font-size:32pt;margin-bottom:8px;">📱</div>
          <div style="font-size:8pt;color:#06b6d4;word-break:break-all;">${url}</div>
        </div>`;
    };
  };

  container.innerHTML = '';
  container.appendChild(img);
}

// توليد QR عند فتح صفحة الإعداد
window.addEventListener('DOMContentLoaded', () => {
  generateSetupQR();
  // عرض أسئلة افتراضية
  const list = document.getElementById('ai-preview-list');
  if (list) {
    list.innerHTML = '';
    questionBanks[0].silver.forEach(col => {
      col.questions.slice(0,1).forEach(q => {
        const d = document.createElement('div');
        d.className = 'ai-preview-item';
        d.textContent = q.q;
        list.appendChild(d);
      });
    });
  }
});

// دالة قديمة للـ QR Modal — لم تعد مطلوبة
function showQRCode() {}
function hideQRCode() {}


function goTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + pageId).classList.add('active');
  window.scrollTo(0,0);
}
function goToSetup() { goTo('setup'); }

// ══════════════════════════════════════════
//  TOPIC SELECTION
// ══════════════════════════════════════════
let selectedBankIndex = 0;

function selectTopic(btn, idx) {
  document.querySelectorAll('.topic-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedBankIndex = idx;

  // Show preview questions
  const bank = idx === -1 ? questionBanks[0] : questionBanks[idx];
  const list = document.getElementById('ai-preview-list');
  list.innerHTML = '';
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
  document.getElementById('ai-status-text').textContent =
    `✅ موضوع: ${btn.dataset.topic} — ${idx === -1 ? 'سيتم الاختيار عشوائياً' : 'جاهز للانطلاق'}`;
}

// Show default preview on load
window.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('ai-preview-list');
  if (list) {
    list.innerHTML = '';
    questionBanks[0].silver.forEach(col => {
      col.questions.slice(0,1).forEach(q => {
        const d = document.createElement('div');
        d.className = 'ai-preview-item';
        d.textContent = q.q;
        list.appendChild(d);
      });
    });
  }
});

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
//  AUDIO ENGINE
// ══════════════════════════════════════════
let actx = null, speedLoop = null, bankLoop = null, cdTimer = null;

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

// نظام صوت نظيف — sine و triangle فقط بدون تشويش
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
    // موضوع رئيسي — وتريات نظيفة
    [[261,.6,.07,0],[329,.6,.07,.15],[392,.6,.08,.3],[523,.8,.09,.5],[659,.8,.09,.7],[783,1,.1,.9]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine'); toneClean(f*2,d,v*.4,t,'triangle');
    });
    // طبول خفيفة
    [0,.4,.8,1.2].forEach(t=>{ toneClean(80,.35,.12,t,'triangle'); toneClean(100,.2,.08,t+.1,'sine'); });
  },

  question() {
    // صوت كشف السؤال — تصاعدي ناعم
    [[261,.4,.07,0],[329,.4,.08,.12],[392,.5,.09,.24],[523,.5,.1,.36],[659,.6,.1,.48]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine');
    });
    toneClean(130,.5,.1,0,'triangle');
  },

  correct() {
    // احتفال — تصاعدي فرح
    [[523,.3,.1,0],[659,.3,.1,.12],[783,.3,.1,.24],[1046,.5,.12,.38],[1318,.6,.12,.55],[1568,.8,.1,.72]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine'); toneClean(f*.5,d,v*.5,t+.01,'triangle');
    });
    [0,.3,.6].forEach(t=>toneClean(90,.35,.1,t,'triangle'));
  },

  wrong() {
    // هابط حزين — نظيف
    [[280,.4,.1,0],[230,.4,.1,.18],[185,.4,.1,.36],[140,.5,.1,.54]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'triangle');
    });
    toneClean(100,.6,.12,.1,'sine');
  },

  bankSurprise() {
    // مفاجأة البنك — صاعد قوي
    [[261,.4,.1,0],[329,.4,.1,.1],[392,.4,.1,.2],[523,.5,.12,.35],[659,.5,.12,.5],[783,.6,.12,.65],[1046,.8,.12,.85]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine');
    });
    toneClean(100,.8,.15,0,'triangle');
    toneClean(120,.8,.12,.4,'triangle');
  },

  startBank() {
    this.stopAll(); let b=0;
    // موسيقى بنك — نبضات منتظمة هادئة
    const notes=[98,110,98,123,98,116,98,110];
    bankLoop=setInterval(()=>{
      const f=notes[b%notes.length];
      toneClean(f,.28,.12,'triangle');
      toneClean(f*1.5,.2,.06,'sine');
      if(b%4===0) toneClean(65,.4,.1,0,'triangle');
      b++;
    },320);
  },

  startSpeed() {
    this.stopAll(); let b=0;
    // موسيقى سرعة — إيقاعية حيوية
    const bassLine=[110,110,130,98,110,110,147,98];
    speedLoop=setInterval(()=>{
      toneClean(bassLine[b%bassLine.length],.18,.14,0,'triangle');
      if(b%2===0) toneClean(440,.06,.04,0,'sine');
      if(b%4===0) toneClean(65,.3,.12,0,'triangle');
      b++;
    },190);
  },

  transition() {
    this.stopAll();
    // انتقال مراحل — أوركسترا نظيفة صاعدة
    [[261,.8,.08,0],[329,.8,.09,.12],[392,.8,.1,.24],[523,1,.11,.38],[659,1,.11,.55],[783,1.2,.12,.72],[1046,1.5,.12,.92],[1318,1.8,.1,1.15]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine'); toneClean(f*1.5,d,v*.4,t,'triangle');
    });
    [0,.35,.7,1.05].forEach(t=>{ toneClean(80,.5,.15,t,'triangle'); toneClean(55,.4,.1,t+.05,'sine'); });
  },

  victory() {
    this.stopAll();
    // نشيد النصر
    [[523,.4,.1,0],[587,.4,.1,.2],[659,.4,.1,.4],[698,.4,.1,.6],[783,.5,.12,.8],[880,.5,.12,1.05],[987,.5,.12,1.3],[1046,.6,.12,1.55],[1318,.8,.12,1.85],[1568,1,.1,2.15]].forEach(([f,d,v,t])=>{
      toneClean(f,d,v,t,'sine'); toneClean(f*.5,d,v*.5,t,'triangle');
    });
    [0,.35,.7,1.05,1.4,1.75,2.1].forEach(t=>{ toneClean(80,.4,.15,t,'triangle'); toneClean(110,.3,.1,t+.1,'sine'); });
  },

  stopAll() {
    if(speedLoop){clearInterval(speedLoop);speedLoop=null;}
    if(bankLoop){clearInterval(bankLoop);bankLoop=null;}
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
//  PARTICLES
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

// AI generation disabled - using built-in question banks
let aiQuestionsGenerated = false;
let aiGeneratedDB = null;
async function generateAIQuestions() {}

// ══════════════════════════════════════════
//  QUESTION BANKS — بنك أسئلة ضخم
// ══════════════════════════════════════════

// بنوك أسئلة متعددة — يختار منها عشوائياً كل جلسة
const questionBanks = [
  // البنك الأول — ثقافة عامة
  {
    name: 'ثقافة عامة',
    silver: [
      {cat:'قادة ورؤساء', questions:[
        {v:100,q:'من هو القائد المسلم الذي فتح بلاد الأندلس؟',a:'طارق بن زياد'},
        {v:200,q:'من هو الملك السعودي الملقب بـ رائد التضامن الإسلامي؟',a:'الملك فيصل بن عبدالعزيز'},
        {v:300,q:'من هو القائد العباسي الذي فتح مدينة عمورية؟',a:'الخليفة المعتصم بالله'}
      ]},
      {cat:'في يوم في شهر في سنة', questions:[
        {v:100,q:'في أي سنة هجرية حدثت الهجرة النبوية الشريفة؟',a:'1 هـ'},
        {v:200,q:'في أي عام ميلادي أُطلقت شبكة الإنترنت للعامة؟',a:'عام 1991 م'},
        {v:300,q:'في أي عام تأسست جامعة الدول العربية؟',a:'عام 1945 م'}
      ]},
      {cat:'كشكول', questions:[
        {v:100,q:'ما هو العنصر الكيميائي السائل في درجة الحرارة العادية؟',a:'الزئبق'},
        {v:200,q:'ما هي عاصمة جمهورية تونس؟',a:'تونس العاصمة'},
        {v:300,q:'ما اللقب الشهير لمدينة شيكاغو الأمريكية؟',a:'مدينة الرياح'}
      ]}
    ],
    gold: [
      {cat:'كيف ولماذا؟', questions:[
        {v:500,q:'كيف يتنفس الجنين داخل رحم أمه؟',a:'عن طريق الحبل السري الذي ينقل الأكسجين من دم الأم'},
        {v:1000,q:'لماذا تظهر النجوم نهاراً ولكننا لا نراها؟',a:'بسبب شدة سطوع ضوء الشمس وتشتته في الغلاف الجوي'},
        {v:1500,q:'كيف تتكون الكهوف الجيرية تحت الأرض؟',a:'بسبب ذوبان الصخور بواسطة المياه الجوفية المحملة بثاني أكسيد الكربون'}
      ]},
      {cat:'الصفة المشتركة', questions:[
        {v:500,q:'ما الصفة المشتركة بين الأفوكادو والموز والطماطم نباتياً؟',a:'كلها تُصنف علمياً كـ ثمار (فواكه)'},
        {v:1000,q:'ما الصفة المشتركة بين عمان والكويت والمنامة وصنعاء؟',a:'كلها عواصم دول في شبه الجزيرة العربية'},
        {v:1500,q:'ما الصفة المشتركة بين غاز النيون والأرجون والكريبتون؟',a:'كلها غازات نبيلة (خاملة) في الجدول الدوري'}
      ]},
      {cat:'أكبر .. أصغر ..', questions:[
        {v:500,q:'ما هو أكبر المحيطات مساحةً في العالم؟',a:'المحيط الهادئ'},
        {v:1000,q:'ما هي أصغر دولة مستقلة في العالم؟',a:'دولة الفاتيكان'},
        {v:1500,q:'ما هي أكبر غدة في جسم الإنسان؟',a:'الكبد'}
      ]}
    ],
    speedBank:[
      {q:'ما عاصمة المملكة العربية السعودية؟',a:'الرياض'},
      {q:'كم عدد أيام الأسبوع؟',a:'سبعة أيام'},
      {q:'ما أطول نهر في العالم؟',a:'نهر النيل'},
      {q:'من رسم لوحة الموناليزا؟',a:'ليوناردو دافنشي'},
      {q:'كم عدد لاعبي كرة القدم في الفريق الواحد؟',a:'11 لاعباً'},
      {q:'ما عاصمة فرنسا؟',a:'باريس'},
      {q:'ما أكبر كوكب في المجموعة الشمسية؟',a:'المشتري'},
      {q:'كم عدد أشهر السنة؟',a:'12 شهراً'}
    ]
  },
  // البنك الثاني — تاريخ إسلامي
  {
    name: 'تاريخ إسلامي',
    silver: [
      {cat:'الخلفاء الراشدون', questions:[
        {v:100,q:'من هو أول الخلفاء الراشدين؟',a:'أبو بكر الصديق رضي الله عنه'},
        {v:200,q:'من هو الخليفة الراشد الذي جمع القرآن الكريم في مصحف واحد؟',a:'عثمان بن عفان رضي الله عنه'},
        {v:300,q:'كم امتدت فترة خلافة عمر بن الخطاب رضي الله عنه؟',a:'10 سنوات'}
      ]},
      {cat:'الفتوحات الإسلامية', questions:[
        {v:100,q:'من قاد فتح مصر في عهد عمر بن الخطاب؟',a:'عمرو بن العاص'},
        {v:200,q:'في أي عام فُتحت مكة المكرمة؟',a:'عام 8 هجري (630 م)'},
        {v:300,q:'من هو القائد الذي فتح بلاد فارس؟',a:'سعد بن أبي وقاص'}
      ]},
      {cat:'العلماء والحضارة', questions:[
        {v:100,q:'من هو العالم المسلم الذي يُلقب بأبي الطب؟',a:'ابن سينا'},
        {v:200,q:'ما اسم العالم المسلم الذي اخترع الجبر؟',a:'الخوارزمي'},
        {v:300,q:'في أي مدينة تقع الجامعة الأزهر الشريف؟',a:'القاهرة'}
      ]}
    ],
    gold: [
      {cat:'غزوات النبي ﷺ', questions:[
        {v:500,q:'ما هي أول غزوة في الإسلام؟',a:'غزوة بدر الكبرى'},
        {v:1000,q:'كم عدد المشركين الذين قُتلوا في غزوة بدر؟',a:'70 مشركاً'},
        {v:1500,q:'في أي سنة هجرية وقعت غزوة الأحزاب (الخندق)؟',a:'السنة الخامسة الهجرية'}
      ]},
      {cat:'الدول الإسلامية', questions:[
        {v:500,q:'ما عاصمة الدولة الأموية؟',a:'دمشق'},
        {v:1000,q:'من هو مؤسس الدولة العباسية؟',a:'أبو العباس السفاح'},
        {v:1500,q:'كم امتدت الخلافة العثمانية؟',a:'نحو 600 سنة (1299-1924م)'}
      ]},
      {cat:'السيرة النبوية', questions:[
        {v:500,q:'في أي مدينة وُلد النبي محمد ﷺ؟',a:'مكة المكرمة'},
        {v:1000,q:'كم عمر النبي ﷺ عند نزول الوحي؟',a:'40 سنة'},
        {v:1500,q:'ما اسم زوجة النبي ﷺ الأولى؟',a:'السيدة خديجة بنت خويلد'}
      ]}
    ],
    speedBank:[
      {q:'كم عدد أركان الإسلام؟',a:'خمسة أركان'},
      {q:'ما اسم جبل نزول الوحي؟',a:'جبل النور (غار حراء)'},
      {q:'من هو صاحب النبي ﷺ في الهجرة؟',a:'أبو بكر الصديق'},
      {q:'ما أول سورة نزلت في القرآن الكريم؟',a:'سورة العلق'},
      {q:'كم عدد سور القرآن الكريم؟',a:'114 سورة'},
      {q:'ما عاصمة المملكة العربية السعودية؟',a:'الرياض'},
      {q:'في أي شهر يصوم المسلمون؟',a:'شهر رمضان'},
      {q:'كم مرة يصلي المسلم في اليوم؟',a:'خمس صلوات'}
    ]
  },
  // البنك الثالث — علوم وجغرافيا
  {
    name: 'علوم وجغرافيا',
    silver: [
      {cat:'الجغرافيا العربية', questions:[
        {v:100,q:'ما أكبر دولة عربية مساحةً؟',a:'الجزائر'},
        {v:200,q:'ما اسم البحر الذي يفصل المغرب العربي عن أوروبا؟',a:'البحر الأبيض المتوسط'},
        {v:300,q:'كم عدد الدول الأعضاء في جامعة الدول العربية؟',a:'22 دولة'}
      ]},
      {cat:'عالم الحيوان', questions:[
        {v:100,q:'ما الحيوان الذي يُعرف بسفينة الصحراء؟',a:'الجمل'},
        {v:200,q:'ما أسرع حيوان بري في العالم؟',a:'الفهد'},
        {v:300,q:'ما الحيوان الذي له أطول عنق في العالم؟',a:'الزرافة'}
      ]},
      {cat:'الكون والفضاء', questions:[
        {v:100,q:'ما أقرب كوكب للشمس؟',a:'عطارد'},
        {v:200,q:'كم يبلغ عدد كواكب المجموعة الشمسية؟',a:'8 كواكب'},
        {v:300,q:'ما اسم أكبر تلسكوب فضائي في التاريخ؟',a:'تلسكوب جيمس ويب'}
      ]}
    ],
    gold: [
      {cat:'الاختراعات والاكتشافات', questions:[
        {v:500,q:'من اخترع الهاتف؟',a:'ألكسندر غراهام بيل'},
        {v:1000,q:'من اكتشف قانون الجاذبية؟',a:'إسحاق نيوتن'},
        {v:1500,q:'في أي عام اخترع رايت الأخوان الطائرة؟',a:'عام 1903 م'}
      ]},
      {cat:'العلوم والكيمياء', questions:[
        {v:500,q:'ما الرمز الكيميائي للذهب؟',a:'Au'},
        {v:1000,q:'ما عدد العناصر في الجدول الدوري الحديث؟',a:'118 عنصراً'},
        {v:1500,q:'ما أخف العناصر في الجدول الدوري؟',a:'الهيدروجين'}
      ]},
      {cat:'عجائب العالم', questions:[
        {v:500,q:'في أي دولة توجد أهرامات الجيزة؟',a:'جمهورية مصر العربية'},
        {v:1000,q:'ما أطول سور في التاريخ البشري؟',a:'سور الصين العظيم'},
        {v:1500,q:'في أي مدينة يقع برج إيفل؟',a:'باريس، فرنسا'}
      ]}
    ],
    speedBank:[
      {q:'ما أكبر قارة في العالم؟',a:'قارة آسيا'},
      {q:'كم عدد قارات العالم؟',a:'7 قارات'},
      {q:'ما أعمق بحيرة في العالم؟',a:'بحيرة بايكال'},
      {q:'ما أعلى جبل في العالم؟',a:'إيفرست'},
      {q:'ما عاصمة اليابان؟',a:'طوكيو'},
      {q:'ما عاصمة البرازيل؟',a:'برازيليا'},
      {q:'كم كيلومتراً يبلغ محيط الأرض تقريباً؟',a:'40,000 كيلومتر'},
      {q:'ما أكبر محيطات العالم؟',a:'المحيط الهادئ'}
    ]
  },
  // البنك الرابع — رياضة وفنون
  {
    name: 'رياضة وفنون',
    silver: [
      {cat:'كرة القدم', questions:[
        {v:100,q:'كم مرة فازت البرازيل بكأس العالم؟',a:'5 مرات'},
        {v:200,q:'في أي دولة أُقيمت كأس العالم 2022؟',a:'قطر'},
        {v:300,q:'من هو هداف كأس العالم على مر التاريخ؟',a:'ميروسلاف كلوزه (16 هدفاً)'}
      ]},
      {cat:'الرياضات الأولمبية', questions:[
        {v:100,q:'كم حلقة في شعار الألعاب الأولمبية؟',a:'5 حلقات'},
        {v:200,q:'في أي مدينة أُقيمت أول ألعاب أولمبية حديثة؟',a:'أثينا 1896 م'},
        {v:300,q:'من هو أكثر رياضي فوزاً بالميداليات الأولمبية؟',a:'مايكل فيلبس (23 ذهبية)'}
      ]},
      {cat:'الفنون والموسيقى', questions:[
        {v:100,q:'من ألّف سيمفونية القدر الخامسة الشهيرة؟',a:'بيتهوفن'},
        {v:200,q:'ما اسم أشهر لوحات فان غوخ؟',a:'ليلة النجوم'},
        {v:300,q:'في أي دولة وُلد الفنان بيكاسو؟',a:'إسبانيا'}
      ]}
    ],
    gold: [
      {cat:'أبطال رياضيون', questions:[
        {v:500,q:'من هو أسرع عداء في تاريخ البشرية؟',a:'أوساين بولت'},
        {v:1000,q:'كم مرة فاز محمد علي كلاي ببطولة العالم للملاكمة؟',a:'3 مرات'},
        {v:1500,q:'من هو الملاكم الذي لُقب بـ الأعظم؟',a:'محمد علي كلاي'}
      ]},
      {cat:'السينما والتلفزيون', questions:[
        {v:500,q:'ما أعلى فيلم إيراداً في تاريخ السينما؟',a:'فيلم أفاتار'},
        {v:1000,q:'كم عدد أفلام سلسلة حرب النجوم الرئيسية؟',a:'9 أفلام'},
        {v:1500,q:'من هو مؤسس شركة والت ديزني؟',a:'والت ديزني'}
      ]},
      {cat:'الأدب العالمي', questions:[
        {v:500,q:'من كتب رواية مئة عام من العزلة؟',a:'غابريال غارسيا ماركيز'},
        {v:1000,q:'من هو مؤلف قصص شيرلوك هولمز؟',a:'آرثر كونان دويل'},
        {v:1500,q:'من هو أول عربي يحصل على جائزة نوبل للأدب؟',a:'نجيب محفوظ'}
      ]}
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
    ]
  }
];

// اختر بنك أسئلة عشوائي
function getRandomBank() {
  return questionBanks[Math.floor(Math.random() * questionBanks.length)];
}

const defaultDB = questionBanks[0];

const catIcons = {
  'قادة ورؤساء':'👑','في يوم في شهر في سنة':'📅','كشكول':'📚',
  'كيف ولماذا؟':'🔬','الصفة المشتركة':'🔗','أكبر .. أصغر ..':'⚖️',
  'فكر بسرعة!':'⚡','علوم وآداب':'🎭','رياضة وعالم':'⚽',
  'الخلفاء الراشدون':'☪️','الفتوحات الإسلامية':'🏹','العلماء والحضارة':'📖',
  'غزوات النبي ﷺ':'⚔️','الدول الإسلامية':'🕌','السيرة النبوية':'🌙',
  'الجغرافيا العربية':'🗺️','عالم الحيوان':'🦁','الكون والفضاء':'🌌',
  'الاختراعات والاكتشافات':'💡','العلوم والكيمياء':'🧪','عجائب العالم':'🏛️',
  'كرة القدم':'⚽','الرياضات الأولمبية':'🥇','الفنون والموسيقى':'🎨',
  'أبطال رياضيون':'🏆','السينما والتلفزيون':'🎬','الأدب العالمي':'📚'
};

// ══════════════════════════════════════════
//  GAME STATE
// ══════════════════════════════════════════
let players=[], stage='silver', responder=null, cellRef=null;
let speedLoc={stage:'silver',cat:0,q:0}, bankLoc={stage:'gold',cat:1,q:2};
let bankMode=false, bankBet=0, speedIdx=0, diamondState=[], diamondPlayers=[];
let db = null;
let stageTransitioning = false;

// ══════════════════════════════════════════
//  START GAME
// ══════════════════════════════════════════
function startGame() {
  initAudio();

  // Collect players
  players = [];
  const inputs = document.querySelectorAll('.p-input');
  inputs.forEach((inp,i) => {
    const name = inp.value.trim() || `الفارس ${i+1}`;
    players.push({id:i, name, score:0, isBanked:false, bankedValue:0});
  });

  if (players.length < 2) { alert('يجب إضافة متسابقَين على الأقل!'); return; }

  // Use selected question bank
  const bankIdx = selectedBankIndex === -1
    ? Math.floor(Math.random() * questionBanks.length)
    : selectedBankIndex;
  const selectedBank = questionBanks[bankIdx];
  db = buildDB(selectedBank);

  // Random positions for speed/bank
  speedLoc = {stage:'silver', cat:Math.floor(Math.random()*3), q:Math.floor(Math.random()*3)};
  bankLoc  = {stage:'gold', cat:1, q:2};

  goTo('game');
  sfx.main();
  changeStage('silver');
  buildSidebar();
  // مزامنة مع شاشة الجمهور
  setTimeout(() => syncToFirebase(buildGameStateForSync()), 500);
}

function buildDB(src) {
  const d = JSON.parse(JSON.stringify(src));
  ['silver','gold'].forEach(s => d[s]?.forEach(col => col.questions.forEach(q => q.spent=false)));
  // Diamond questions — مشتركة من جميع البنوك
  d.diamond = [
    {cat:'قادة ورؤساء',      q:'من قاد مصر في حرب أكتوبر 1973؟',                   a:'الرئيس أنور السادات'},
    {cat:'ثقافة عامة',       q:'ما أطول نهر في العالم؟',                            a:'نهر النيل'},
    {cat:'تاريخ إسلامي',     q:'في أي سنة ميلادية سقطت الأندلس؟',                  a:'عام 1492 م'},
    {cat:'جغرافيا',          q:"ما البحر الذي يُسمى 'بحر القلزم' قديماً؟",         a:'البحر الأحمر'},
    {cat:'علوم',             q:'ما أكبر صحراء رملية متصلة في العالم؟',              a:'صحراء الربع الخالي'},
    {cat:'فكر بسرعة!',       q:'🚨 جولة دقيقة السرعة!',                             a:'اضغط أسماء الفرسان لمنح نقاط السرعة.',isSpeedRound:true},
    {cat:'رياضة',            q:'كم مرة فازت البرازيل بكأس العالم لكرة القدم؟',     a:'5 مرات'},
    {cat:'أدب وشعر',         q:"من هو الشاعر العربي الملقب بـ 'أمير الشعراء'؟",   a:'أحمد شوقي'},
    {cat:'اختراعات',         q:'من اخترع الهاتف؟',                                  a:'ألكسندر غراهام بيل'}
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
    d.innerHTML=`<div class="p-card-role">${stage==='diamond'?'الفارس العالي':'متسابق'}</div>
      <div class="p-card-name">${p.name}</div>
      <div class="p-card-score" id="ps-${p.id}">${p.score}</div>
      <div class="p-banked" id="pb-${p.id}" style="${p.isBanked?'display:block;':'display:none;'}">🔒 محصن: ${p.bankedValue}</div>`;
    c.appendChild(d);
  });
}

function refreshScores() {
  players.forEach(p=>{
    const el=document.getElementById(`ps-${p.id}`);
    if(el){ el.textContent=p.score; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    const b=document.getElementById(`pb-${p.id}`);
    if(b&&p.isBanked){ b.textContent=`🔒 محصن: ${p.bankedValue}`; b.style.display='block'; }
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

  const sidebar=document.getElementById('game-sidebar');
  if(sidebar){ sidebar.style.display = s==='diamond' ? 'none' : ''; }

  const gameMain=document.getElementById('game-main');
  if(gameMain){ gameMain.classList.toggle('diamond-mode', s==='diamond'); }

  // تطبيق لون المرحلة على الصفحة كاملة
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
  // مزامنة المرحلة مع شاشة الجمهور
  setTimeout(() => syncToFirebase(buildGameStateForSync()), 300);
}

async function advanceStage() {
  if(stageTransitioning) return;
  stageTransitioning=true;
  try {
    if(stage==='silver'){
      await showTransition('🥇','الشاشة الذهبية','مضاعفة النقاط','var(--gold)');
      changeStage('gold');
    } else if(stage==='gold'){
      await showTransition('💎','الشاشة الماسية','الحسم النهائي','var(--cyan)');
      changeStage('diamond');
    }
  } finally {
    stageTransitioning=false;
  }
}

// ══════════════════════════════════════════
//  BOARD BUILDER
// ══════════════════════════════════════════
function buildBoard(s) {
  const c=document.getElementById(`board-${s}`); c.innerHTML='';
  db[s].forEach((col,ci)=>{
    const d=document.createElement('div'); d.className='cat-col';
    const icon=catIcons[col.cat]||'❓';
    d.innerHTML=`<div class="cat-icon">${icon}</div><div class="cat-name">${col.cat}</div>`;
    col.questions.forEach((q,qi)=>{
      const b=document.createElement('button');
      b.className='q-btn'+(q.spent?' spent':'');
      b.textContent=`${q.v} ن`;
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
  initAudio();
  cellRef={stage,ci,qi};
  const qItem = stage==='diamond' ? diamondState[ci] : db[stage][ci].questions[qi];
  responder=null; bankMode=false; bankBet=0;

  document.getElementById('modal-overlay').style.display='flex';
  document.getElementById('modal-cat').textContent = stage==='diamond'
    ? qItem.category
    : `${db[stage][ci].cat} — ${qItem.v} نقطة`;
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
      sfx.startSpeed();
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
    sfx.question(); launchModal(false,false,qItem);
    // مزامنة السؤال مع شاشة الجمهور
    const cat = stage==='diamond' ? qItem.category : db[stage][cellRef.ci].cat;
    const val = stage==='diamond' ? 0 : db[stage][cellRef.ci].questions[cellRef.qi].v;
    syncQuestion(qItem, cat, val, 30, 'normal');
  }
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
    speedIdx=0; loadSpeedQ(); buildSpeedBtns(); startTimer(60,'speed');

  } else if(isBank){
    resp.style.display='block'; bank.style.display='block';
    judge.style.display='none'; speed.style.display='none';
    buildResponderBtns();
    await typewrite(document.getElementById('modal-q'),'🏛️ فقرة البنك الاستثمارية\nاسأل الفارس عن رغبته الاستراتيجية الآن:',35);
    const a=document.getElementById('modal-a');
    a.textContent='سؤال الرهان: ما اسم عاصمة سلطنة عمان؟  [ مسقط ]'; a.classList.add('show');
    startTimer(45,'bank');

  } else {
    resp.style.display='block'; bank.style.display='none';
    judge.style.display='flex'; speed.style.display='none';
    judge.querySelectorAll('.judge-btn').forEach(b=>{ if(!b.textContent.includes('تخطي')) b.disabled=true; });
    buildResponderBtns();
    await typewrite(document.getElementById('modal-q'), qItem.q, 40);
    const a=document.getElementById('modal-a');
    a.textContent=`الإجابة:  ${qItem.a}`; a.classList.add('show');
    startTimer(30,'normal');
  }
}

// ══════════════════════════════════════════
//  BANK
// ══════════════════════════════════════════
function showBankBet() {
  if(responder===null){ alert('الرجاء اختيار الفارس أولاً!'); return; }
  const p=players.find(x=>x.id===responder);
  const cv=db[cellRef.stage][cellRef.ci].questions[cellRef.qi].v;
  const inp=document.getElementById('bank-bet-input');
  const lim=document.getElementById('bank-bet-limits');
  if(p.score<cv){
    inp.min=inp.max=inp.value=p.score; inp.disabled=true;
    lim.style.color='var(--danger)';
    lim.textContent=`🚨 الرصيد أقل! المشاركة إجبارية بكامل الرصيد (${p.score} ن)`;
  } else {
    inp.min=cv; inp.max=p.score; inp.value=cv; inp.disabled=false;
    lim.style.color='var(--muted)';
    lim.textContent=`الحد الأدنى: ${cv} ن  |  الحد الأقصى: ${p.score} ن`;
  }
  document.getElementById('bank-bet-zone').style.display='block';
}

function confirmBankBet() {
  const p=players.find(x=>x.id===responder);
  const bv=parseInt(document.getElementById('bank-bet-input').value);
  const cv=db[cellRef.stage][cellRef.ci].questions[cellRef.qi].v;
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
    if(ok){ sfx.correct(); p.score+=bankBet; alert(`✨ رهان صحيح! +${bankBet} ن لـ ${p.name}`); }
    else  { sfx.wrong(); const fl=p.isBanked?p.bankedValue:0; p.score=Math.max(fl,p.score-bankBet); alert(`❌ رهان خاطئ! −${bankBet} ن من ${p.name}`); }
  } else if(stage==='diamond'){
    if(ok){ sfx.correct(); diamondState[cellRef.ci].owner=p.id; } else sfx.wrong();
    diamondState[cellRef.ci].spent=true;
  } else {
    const q=db[stage][cellRef.ci].questions[cellRef.qi];
    if(ok){ sfx.correct(); p.score+=q.v; }
    else  { sfx.wrong(); const fl=p.isBanked?p.bankedValue:0; p.score=Math.max(fl,p.score-Math.floor(q.v/2)); }
    q.spent=true;
  }
  closeModal();
}

function closeModal() {
  clearInterval(cdTimer); sfx.stopAll();
  document.getElementById('modal-surprise').style.display='none';
  document.getElementById('modal-overlay').style.display='none';

  if(stage==='diamond'){
    diamondState[cellRef.ci].spent=true; renderDiamond(); checkWinner();
  } else {
    db[stage][cellRef.ci].questions[cellRef.qi].spent=true;
    buildBoard(stage); refreshScores();
  }
  cellRef=null; responder=null; bankMode=false; bankBet=0;
  syncCloseQuestion();
}

// ══════════════════════════════════════════
//  TIMER
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
    if(rem<=5&&rem>0&&mode==='normal') tone(880,'sine',.04,.05);
    if(rem<=0){ clearInterval(cdTimer); if(mode==='speed'){ sfx.stopAll(); sfx.wrong(); alert('⏱️ انتهت دقيقة السرعة!'); closeModal(); } if(mode==='bank') sfx.stopAll(); }
  },1000);
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
  else document.getElementById('modal-judge').querySelectorAll('.judge-btn').forEach(b=>b.disabled=false);
}

// ══════════════════════════════════════════
//  SPEED ROUND
// ══════════════════════════════════════════
function loadSpeedQ() {
  if(speedIdx>=db.speedBank.length) speedIdx=0;
  const q=db.speedBank[speedIdx];
  document.getElementById('modal-cat').textContent=`⚡ جولة السرعة — سؤال (${speedIdx+1})`;
  typewrite(document.getElementById('modal-q'),q.q,32);
  const a=document.getElementById('modal-a'); a.textContent=`الإجابة: ${q.a}`; a.classList.add('show');
}

function buildSpeedBtns() {
  const c1=document.getElementById('speed-btns');
  const c2=document.getElementById('speed-diamond-btns');
  c1.innerHTML=''; c2.innerHTML='';
  const list=stage==='diamond'?diamondPlayers:players;
  list.forEach((p,i)=>{
    const b=document.createElement('button'); b.className='speed-btn';
    b.textContent=`✓ ${p.name} +100 ن`;
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
  diamondState=db.diamond.slice(0,9).map(x=>({category:x.cat,q:x.q,a:x.a,spent:false,owner:null,isSpeedRound:!!x.isSpeedRound}));
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
    d.innerHTML=`${medals[i]||'④'} ${p.name} — <strong>${p.score} ن</strong>`;
    rankEl.appendChild(d);
  });

  goTo('winner');
  spawnFireworks();
}

window.goToSetup = goToSetup;
