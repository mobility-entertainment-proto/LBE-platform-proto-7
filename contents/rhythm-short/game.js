// contents/rhythm-short/game.js
// ShortRhythmGame — proto-3 RhythmGame 構造そのまま、
//                   ノーツを20秒分に絞り、終了後に endMessage を表示する版

import { loadSongConfig } from '../../core/song-config.js';

const LIMIT_MS = 20000; // 20秒で強制終了

export class ShortRhythmGame {
  constructor(audioManager) {
    this.audio = audioManager;
    this.container = null;
    this.threeCanvas = null;
    this.gameCanvas = null;
    this.ctx = null;
    // Three.js
    this.renderer = null; this.scene = null; this.camera = null;
    this.ambLight = null; this.dirLight = null; this.buildings = [];
    this.threeLastT = 0;
    // Audio
    this.audioEl = null; this.actx = null; this.aOff = 0; this.nPtr = 0;
    // Game state
    this.GS = { TITLE:1, PLAYING:2, RESULT:4 };
    this.gs = 1;
    this.chart = null; this.flags = null;
    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.cnt = { p:0, g:0, ok:0, m:0 };
    this.flash = [0,0,0,0]; this.jfx = []; this.ptcl = []; this.cScale = 1;
    this.btnList = [];
    // Layout
    this.W = 0; this.H = 0; this.cx = 0;
    this.VY = 0; this.JY = 0; this.TL = 0; this.TR = 0; this.LW = 0;
    // Settings
    this.diffKey = localStorage.getItem('rg_diff') || 'EASY';
    this.offsetAdj = +(localStorage.getItem('rg_offset') || 0);
    this.APPROACH_MS = 3000; this.WIN_P = 200; this.WIN_G = 400; this.WIN_OK = 600;
    // Entry anim
    this.entryAnim = false; this.entryAnimT = 0;
    this.entryTimerId = null; this.earlyAudioTimerId = null; this.earlyAudioStarted = false;
    this.entryFxTimers = [];
    // End message
    this._endMessage = '';
    this._exited = false;
    // RAF
    this._rafId = null;
    this._boundLoop = this._loop.bind(this);
    this._boundResize = this._onResize.bind(this);
    // Consts
    this.ROAD_W = 8; this.ROAD_LEN = 200; this.BLDG_N = 14;
    this.NOTE_THICK = 200;
    this.COLORS = ['#ff7043','#26c6da','#66bb6a','#ab47bc'];
    this.COLORS_DK = ['#5a1a08','#0a4a55','#2a5530','#3a1050'];
    this.GLOWS = ['rgba(255,112,67,.7)','rgba(38,198,218,.7)','rgba(102,187,106,.7)','rgba(171,71,188,.7)'];
    this.NAMES = ['KICK','SNARE','MELODY','HI-HAT'];
    this.DIFFICULTIES = {
      EASY:   { approachMs:3000, winP:200, winG:400, winOk:600, col:'#66bb6a' },
      NORMAL: { approachMs:2200, winP:150, winG:300, winOk:450, col:'#26c6da' },
      HARD:   { approachMs:1600, winP:80,  winG:160, winOk:250, col:'#ff7043' },
    };
    this.onComplete = null;
  }

  // ── ContentBase interface ──────────────────────────────────────

  async onEnter(event) {
    this._exited = false;
    const d = event.contentData || {};
    this._endMessage = d.endMessage || '';

    if (!this.chart) {
      const conf = await loadSongConfig();
      const chartUrl = conf.track?.chart_url || './contents/rhythm/chart.json';
      const r = await fetch(chartUrl);
      const raw = await r.json();
      if (conf.track?.offset_ms !== undefined) raw.offset_ms = conf.track.offset_ms;
      if (conf.track?.audio_url) raw.audio_url = conf.track.audio_url;
      // 20秒以内のノーツのみ使用
      raw.notes = (raw.notes || []).filter(n => n.time_ms <= LIMIT_MS);
      this.chart = raw;
    }

    this.audioEl = new Audio(this.chart.audio_url);
    this.audioEl.crossOrigin = 'anonymous';
    this.audioEl.load();

    const d2 = this.DIFFICULTIES[this.diffKey];
    this.APPROACH_MS = d2.approachMs; this.WIN_P = d2.winP; this.WIN_G = d2.winG; this.WIN_OK = d2.winOk;

    this.gs = this.GS.TITLE;
    this._startLoop();
    // 自動的にエントリーアニメーション開始
    setTimeout(() => { if (!this._exited) this._triggerEntry(); }, 300);
  }

  onExit() {
    this._exited = true;
    this._stopGame();
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    window.removeEventListener('resize', this._boundResize);
    if (this.audioEl) { this.audioEl.pause(); this.audioEl = null; }
    this.entryAnim = false;
    if (this.entryTimerId) { clearTimeout(this.entryTimerId); this.entryTimerId = null; }
    if (this.earlyAudioTimerId) { clearTimeout(this.earlyAudioTimerId); this.earlyAudioTimerId = null; }
    this.entryFxTimers.forEach(id => clearTimeout(id));
    this.entryFxTimers = [];
  }

  getUI() {
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:fixed;inset:0;z-index:10;overflow:hidden;touch-action:none;';

    this.threeCanvas = document.createElement('canvas');
    this.threeCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;';
    this.gameCanvas = document.createElement('canvas');
    this.gameCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;background:transparent;';
    this.container.appendChild(this.threeCanvas);
    this.container.appendChild(this.gameCanvas);

    this._layout();
    this._initThree();

    this.gameCanvas.addEventListener('touchstart', e => {
      e.preventDefault();
      for (const t of e.changedTouches) this._onInput(t.clientX, t.clientY);
    }, { passive: false });
    this.gameCanvas.addEventListener('mousedown', e => this._onInput(e.clientX, e.clientY));
    window.addEventListener('resize', this._boundResize);
    return this.container;
  }

  // ── Three.js scene ────────────────────────────────────────────

  _initThree() {
    const THREE = window.THREE;
    if (!THREE) return;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.threeCanvas, antialias: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x87ceeb);
    this.renderer.setSize(this.W || window.innerWidth, this.H || window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87ceeb, 80, 280);
    this.camera = new THREE.PerspectiveCamera(62, (this.W || window.innerWidth) / (this.H || window.innerHeight), 0.1, 400);
    this.camera.position.set(0, 2.8, 0);
    this.camera.lookAt(0, -38, -91);

    this.ambLight = new THREE.AmbientLight(0xffffff, 1.2); this.scene.add(this.ambLight);
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.8); this.dirLight.position.set(5, 20, 4); this.scene.add(this.dirLight);
    const fill = new THREE.DirectionalLight(0xaaddff, 0.5); fill.position.set(-4, 8, -6); this.scene.add(fill);

    const roadMat = new THREE.MeshLambertMaterial({ color: 0x484848 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(this.ROAD_W, this.ROAD_LEN), roadMat);
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -this.ROAD_LEN / 2); this.scene.add(road);
    for (const side of [-1, 1]) {
      const m = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
      const g = new THREE.Mesh(new THREE.PlaneGeometry(5, this.ROAD_LEN), m);
      g.rotation.x = -Math.PI / 2; g.position.set(side * (this.ROAD_W / 2 + 2.5), -0.01, -this.ROAD_LEN / 2); this.scene.add(g);
    }
    [[-4,'solid'],[-2,'dash'],[0,'dash'],[2,'dash'],[4,'solid']].forEach(([x, type]) => {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: type==='solid'?0.95:0.7, transparent:true });
      const g = new THREE.Mesh(new THREE.PlaneGeometry(type==='solid'?0.12:0.08, this.ROAD_LEN), m);
      g.rotation.x = -Math.PI / 2; g.position.set(x, 0.01, -this.ROAD_LEN / 2); this.scene.add(g);
    });
    const bPalette = [0xcc3333,0xdd9922,0x3366cc,0x33aa55,0xcc44aa,0x22aacc,0x9944cc,0xddcc22,0xee6633,0x44bbcc,0xcc8833,0x5588dd,0x55bb44,0xdd4466,0x22bbaa];
    for (const side of [-1, 1]) {
      for (let i = 0; i < this.BLDG_N; i++) {
        const w = 3 + Math.random()*5, h = 6 + Math.random()*22, d = 4 + Math.random()*5;
        const mat = new THREE.MeshLambertMaterial({ color: bPalette[Math.floor(Math.random()*bPalette.length)] });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(side * (this.ROAD_W/2 + 1.5 + Math.random()*7), h/2, -(i/this.BLDG_N)*this.ROAD_LEN);
        this.scene.add(mesh); this.buildings.push(mesh);
      }
    }
  }

  _updateThree(ts) {
    if (!this.renderer || !window.THREE) return;
    const dt = Math.min((ts - this.threeLastT) / 1000, 0.05);
    this.threeLastT = ts;
    const Z_NEAR = 3.18;
    const scrollSpeed = this.gs === this.GS.PLAYING ? (this.ROAD_LEN - Z_NEAR) / (this.APPROACH_MS / 1000) : 0;
    const move = scrollSpeed * dt;
    for (const mesh of this.buildings) {
      mesh.position.z += move;
      if (mesh.position.z > 5) mesh.position.z -= (this.ROAD_LEN - Z_NEAR);
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ── Layout ─────────────────────────────────────────────────────

  _layout() {
    const dpr = window.devicePixelRatio || 1;
    this.W = window.innerWidth; this.H = window.innerHeight;
    const cv = this.gameCanvas;
    if (!cv) return;
    cv.width = this.W * dpr; cv.height = this.H * dpr;
    this.ctx = cv.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cx = this.W / 2;
    this.VY = this.H * 0.13; this.JY = this.H * 0.76;
    this.TL = this.W * 0.04; this.TR = this.W * 0.96;
    this.LW = (this.TR - this.TL) / 4;
    if (this.renderer) this.renderer.setSize(this.W, this.H);
    if (this.camera) { this.camera.aspect = this.W / this.H; this.camera.updateProjectionMatrix(); }
  }

  _onResize() { this._layout(); }

  // ── Audio ─────────────────────────────────────────────────────

  _initActx() {
    if (this.actx) return;
    if (this.audio?.ctx) { this.actx = this.audio.ctx; }
    else { this.actx = new (window.AudioContext || window.webkitAudioContext)(); }
    if (this.actx.state === 'suspended') this.actx.resume();
    if (this.audioEl && !this.audioEl._connected) {
      try {
        const src = this.actx.createMediaElementSource(this.audioEl);
        src.connect(this.actx.destination);
        this.audioEl._connected = true;
      } catch(e) {}
    }
  }

  _syncOff() { if (this.actx && this.audioEl) this.aOff = this.actx.currentTime - this.audioEl.currentTime; }
  _noteACT(ms) { return this.aOff + ms / 1000; }

  _resetNPtr() {
    const ms = (this.audioEl?.currentTime || 0) * 1000;
    this.nPtr = 0;
    while (this.nPtr < this.chart.notes.length && this.chart.notes[this.nPtr].time_ms < ms - 100) this.nPtr++;
  }

  _schedUpcoming(curMs) {
    if (!this.actx) return;
    while (this.nPtr < this.chart.notes.length) {
      const n = this.chart.notes[this.nPtr];
      if (n.time_ms > curMs + 300) break;
      const w = this._noteACT(n.time_ms);
      if (w > this.actx.currentTime + 0.003) this._schedSound(n.lane, w);
      this.nPtr++;
    }
  }

  _schedSound(lane, when) {
    if (!this.actx) return;
    const v = 0.28, d = this.actx.destination;
    const g = this.actx.createGain(); g.connect(d);
    if (lane === 0) {
      const o = this.actx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(130, when); o.frequency.exponentialRampToValueAtTime(42, when+0.09);
      g.gain.setValueAtTime(v*1.4, when); g.gain.exponentialRampToValueAtTime(0.001, when+0.1);
      o.connect(g); o.start(when); o.stop(when+0.11);
    } else if (lane === 1) {
      const o = this.actx.createOscillator(); o.frequency.value = 220;
      g.gain.setValueAtTime(v, when); g.gain.exponentialRampToValueAtTime(0.001, when+0.05);
      o.connect(g); o.start(when); o.stop(when+0.05);
      const bl = this.actx.sampleRate*0.05|0, buf = this.actx.createBuffer(1,bl,this.actx.sampleRate);
      const dd = buf.getChannelData(0); for(let i=0;i<bl;i++) dd[i]=Math.random()*2-1;
      const ns = this.actx.createBufferSource(); ns.buffer = buf;
      const ng = this.actx.createGain();
      ng.gain.setValueAtTime(v*0.55,when); ng.gain.exponentialRampToValueAtTime(0.001,when+0.05);
      ns.connect(ng); ng.connect(d); ns.start(when);
    } else if (lane === 2) {
      const o = this.actx.createOscillator(); o.type = 'triangle'; o.frequency.value = 660;
      g.gain.setValueAtTime(v*0.85, when); g.gain.exponentialRampToValueAtTime(0.001, when+0.07);
      o.connect(g); o.start(when); o.stop(when+0.07);
    } else {
      const bl = this.actx.sampleRate*0.028|0, buf = this.actx.createBuffer(1,bl,this.actx.sampleRate);
      const dd = buf.getChannelData(0); for(let i=0;i<bl;i++) dd[i]=Math.random()*2-1;
      const ns = this.actx.createBufferSource(); ns.buffer = buf;
      const hpf = this.actx.createBiquadFilter(); hpf.type='highpass'; hpf.frequency.value=9000;
      g.gain.setValueAtTime(v*1.2,when); g.gain.exponentialRampToValueAtTime(0.001,when+0.028);
      ns.connect(hpf); hpf.connect(g); ns.start(when);
    }
  }

  // ── Entry animation ───────────────────────────────────────────

  _triggerEntry() {
    this._initActx();
    this.entryAnim = true; this.entryAnimT = performance.now();
    if (this.entryTimerId) clearTimeout(this.entryTimerId);
    if (this.earlyAudioTimerId) clearTimeout(this.earlyAudioTimerId);
    this.entryFxTimers.forEach(id => clearTimeout(id));
    this.entryFxTimers = [];
    this.earlyAudioStarted = false;
    try { this.audio?.playSFX('count3'); } catch (_) {}
    this.entryFxTimers.push(setTimeout(() => { try { this.audio?.playSFX('count2'); } catch(_){} }, 700));
    this.entryFxTimers.push(setTimeout(() => { try { this.audio?.playSFX('count1'); } catch(_){} }, 1400));
    this.entryFxTimers.push(setTimeout(() => { try { this.audio?.playSFX('start');  } catch(_){} }, 1850));
    const audioDelay = Math.max(0, 2300 - (this.chart?.offset_ms || 1324));
    this.earlyAudioTimerId = setTimeout(() => {
      this.earlyAudioTimerId = null;
      if (!this.audioEl || this._exited) return;
      this.audioEl.currentTime = 0; this.audioEl.volume = 1.0;
      this.audioEl.play().then(() => { this._syncOff(); this._resetNPtr(); this.earlyAudioStarted = true; }).catch(() => {});
    }, audioDelay);
    this.entryTimerId = setTimeout(() => {
      this.entryTimerId = null; this.entryAnim = false;
      if (!this._exited) this._startGame();
    }, 2300);
  }

  _startGame() {
    if (!this.chart || this._exited) return;
    this.flags = new Uint8Array(this.chart.notes.length);
    this.score = 0; this.combo = 0; this.maxCombo = 0; this.cnt = { p:0, g:0, ok:0, m:0 };
    this.flash = [0,0,0,0]; this.jfx = []; this.ptcl = []; this.cScale = 1;
    this.gs = this.GS.PLAYING;
    if (this.earlyAudioStarted) {
      this.earlyAudioStarted = false;
      this._syncOff(); this._resetNPtr();
    } else {
      this._initActx();
      if (this.audioEl) {
        this.audioEl.currentTime = 0; this.audioEl.volume = 1.0;
        this.audioEl.play().then(() => { this._syncOff(); this._resetNPtr(); }).catch(() => {});
      }
    }
  }

  _stopGame() {
    if (this.audioEl) this.audioEl.pause();
    this.gs = this.GS.TITLE;
    this.entryAnim = false;
    if (this.entryTimerId) { clearTimeout(this.entryTimerId); this.entryTimerId = null; }
    if (this.earlyAudioTimerId) { clearTimeout(this.earlyAudioTimerId); this.earlyAudioTimerId = null; }
    this.entryFxTimers.forEach(id => clearTimeout(id));
    this.entryFxTimers = [];
  }

  // ── Judgment ──────────────────────────────────────────────────

  _tap(laneIdx) {
    this.flash[laneIdx] = 1;
    const tapMs = (this.audioEl?.currentTime || 0) * 1000;
    const adj = tapMs + this.offsetAdj;
    let bi = -1, bd = Infinity, bSgn = 0;
    for (let i = 0; i < this.chart.notes.length; i++) {
      if (this.flags[i] !== 0) continue;
      const n = this.chart.notes[i]; if (n.lane !== laneIdx) continue;
      const diff = adj - n.time_ms, df = Math.abs(diff);
      if (df <= this.WIN_OK && df < bd) { bd = df; bi = i; bSgn = diff; }
    }
    if (bi < 0) { try { this.audio?.playSFX('tapMiss'); } catch(_){} return; }
    this.flags[bi] = 1;
    const n = this.chart.notes[bi];
    let txt, col;
    if (bd <= this.WIN_P) { txt='PERFECT!'; col='#ffe566'; this.cnt.p++; this.score+=300; this.combo++; try { this.audio?.playSFX('tapPerfect'); } catch(_){} }
    else if (bd <= this.WIN_G) { txt='GREAT!'; col='#66ddff'; this.cnt.g++; this.score+=200; this.combo++; try { this.audio?.playSFX('tapGood'); } catch(_){} }
    else { txt='GOOD'; col='#88ff88'; this.cnt.ok++; this.score+=100; this.combo++; try { this.audio?.playSFX('tapGood'); } catch(_){} }
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.cScale = 1.5;
    this._spawnJfx(txt, col, n.lane);
    if (bd > this.WIN_P) this._spawnTimingFx(bSgn < 0 ? 'EARLY' : 'LATE', n.lane);
    this._spawnPtcl(n.lane);
  }

  _miss(idx) {
    if (this.flags[idx] !== 0) return;
    this.flags[idx] = 2; this.combo = 0; this.cnt.m++;
    try { this.audio?.playSFX('tapMiss'); } catch(_){}
    this._spawnJfx('MISS', '#ff5555', this.chart.notes[idx].lane);
  }

  _spawnJfx(txt, col, lane) { this.jfx.push({ txt, col, x:this.TL+(lane+.5)*this.LW, y:this.JY-50, a:1.2, s:1.7 }); }
  _spawnTimingFx(txt, lane) {
    const col = txt==='EARLY' ? '#ffaa44' : '#4488ff';
    this.jfx.push({ txt, col, x:this.TL+(lane+.5)*this.LW, y:this.JY-90, a:0.85, s:1.0 });
  }
  _spawnPtcl(lane) {
    const x = this.TL+(lane+.5)*this.LW, y = this.JY;
    for (let i = 0; i < 12; i++) {
      const ang = Math.random()*Math.PI*2, spd = Math.random()*9+3;
      this.ptcl.push({ x, y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd-5, a:1, r:Math.random()*4+2, col:this.COLORS[lane] });
    }
  }

  // ── Update ────────────────────────────────────────────────────

  _update() {
    if (this.gs !== this.GS.PLAYING || !this.chart) return;
    const ms = (this.audioEl?.currentTime || 0) * 1000;

    // 20秒経過で強制終了
    if (ms >= LIMIT_MS) {
      if (this.audioEl) this.audioEl.pause();
      for (let i = 0; i < this.chart.notes.length; i++) {
        if (this.flags[i] === 0) this._miss(i);
      }
      this.gs = this.GS.RESULT;
      return;
    }

    for (let i = 0; i < this.chart.notes.length; i++) {
      if (this.flags[i] !== 0) continue;
      if (ms - this.chart.notes[i].time_ms > this.WIN_OK + 80) this._miss(i);
    }
    this._schedUpcoming(ms);
    for (let i = 0; i < 4; i++) this.flash[i] *= 0.78;
    this.cScale = 1 + (this.cScale - 1) * 0.82;
    for (let i = this.ptcl.length-1; i >= 0; i--) {
      const p = this.ptcl[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.45; p.a-=0.04; p.r*=0.95;
      if (p.a <= 0) this.ptcl.splice(i, 1);
    }
    for (let i = this.jfx.length-1; i >= 0; i--) {
      const j = this.jfx[i]; j.y-=1.6; j.a-=0.026; j.s=Math.max(1, j.s-0.05);
      if (j.a <= 0) this.jfx.splice(i, 1);
    }
  }

  // ── Render helpers ────────────────────────────────────────────

  _getY(d) { return this.JY + d * (this.VY - this.JY); }
  _getS(d) { return Math.max(0, (this._getY(d) - this.VY) / (this.JY - this.VY)); }
  _laneX(i, d) { const s=this._getS(d), bx=this.TL+(i+.5)*this.LW; return this.cx+s*(bx-this.cx); }
  _laneHW(d) { return this._getS(d)*this.LW/2; }
  _hexRGB(hex) { return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`; }

  _rr(x,y,w,h,r) {
    this.ctx.beginPath();
    this.ctx.moveTo(x+r,y); this.ctx.lineTo(x+w-r,y); this.ctx.arcTo(x+w,y,x+w,y+r,r);
    this.ctx.lineTo(x+w,y+h-r); this.ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
    this.ctx.lineTo(x+r,y+h); this.ctx.arcTo(x,y+h,x,y+h-r,r);
    this.ctx.lineTo(x,y+r); this.ctx.arcTo(x,y,x+r,y,r); this.ctx.closePath();
  }

  _drawBtn(label,x,y,w,h,bg,fg,cb) {
    const c = this.ctx;
    c.fillStyle=bg; this._rr(x-w/2,y-h/2,w,h,h*.18); c.fill();
    c.strokeStyle=fg; c.lineWidth=2; this._rr(x-w/2,y-h/2,w,h,h*.18); c.stroke();
    c.fillStyle=fg; c.font=`bold ${h*.55|0}px monospace`; c.textAlign='center';
    c.fillText(label,x,y+h*.2);
    this.btnList.push({x:x-w/2,y:y-h/2,w,h,cb});
  }

  // ── Draw ──────────────────────────────────────────────────────

  _drawBg() { this.ctx.clearRect(0, 0, this.W, this.H); }

  _drawTrack() {
    const c = this.ctx;
    const jDepth = Math.min(0.2, this.NOTE_THICK / this.APPROACH_MS);
    c.save();
    c.shadowColor = '#ffe840'; c.shadowBlur = 28;
    for (let i = 0; i < 4; i++) {
      const pad = this.LW * 0.01;
      const x1L = this._laneX(i, 0.0) - this._laneHW(0.0) + pad;
      const x1R = this._laneX(i, 0.0) + this._laneHW(0.0) - pad;
      const x2L = this._laneX(i, jDepth) - this._laneHW(jDepth) + pad;
      const x2R = this._laneX(i, jDepth) + this._laneHW(jDepth) - pad;
      const y1 = this._getY(0.0), y2 = this._getY(jDepth);
      const gr = c.createLinearGradient(0, y2, 0, y1);
      gr.addColorStop(0, 'rgba(255,248,120,0.45)');
      gr.addColorStop(1, 'rgba(255,248,100,0.96)');
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(x1L, y1); c.lineTo(x1R, y1);
      c.lineTo(x2R, y2); c.lineTo(x2L, y2); c.closePath(); c.fill();
    }
    c.restore();
    for (let i=0;i<4;i++) {
      c.save(); c.shadowColor=this.COLORS[i]; c.shadowBlur=this.flash[i]*28+8;
      c.strokeStyle=this.COLORS[i]; c.lineWidth=3; c.globalAlpha=.5+this.flash[i]*.5;
      c.beginPath(); c.arc(this.TL+(i+.5)*this.LW,this.JY,this.LW*.32,0,Math.PI*2); c.stroke();
      c.restore();
    }
  }

  _drawNotes() {
    if (!this.chart) return;
    const c = this.ctx; const ms = (this.audioEl?.currentTime||0)*1000;
    for (let i=this.chart.notes.length-1;i>=0;i--) {
      const n=this.chart.notes[i], ahead=n.time_ms-ms;
      if (ahead>this.APPROACH_MS+80||ahead<-this.NOTE_THICK-120||this.flags[i]===1) continue;
      const d1=Math.min(1,Math.max(-0.06,ahead/this.APPROACH_MS));
      const d2=Math.min(1,Math.max(-0.06,(ahead+this.NOTE_THICK)/this.APPROACH_MS));
      const y1=this._getY(d1),y2=this._getY(d2); if(y2>=y1) continue;
      const pad=this.LW*0.01;
      const x1L=this._laneX(n.lane,d1)-this._laneHW(d1)+pad, x1R=this._laneX(n.lane,d1)+this._laneHW(d1)-pad;
      const x2L=this._laneX(n.lane,d2)-this._laneHW(d2)+pad, x2R=this._laneX(n.lane,d2)+this._laneHW(d2)-pad;
      c.save(); if(this.flags[i]===2) c.globalAlpha=0.25;
      const gr=c.createLinearGradient(0,y1,0,y2);
      gr.addColorStop(0,this.COLORS[n.lane]); gr.addColorStop(1,this.COLORS_DK[n.lane]);
      c.shadowColor=this.GLOWS[n.lane]; c.shadowBlur=Math.max(0,16*(1-d1*1.8));
      c.fillStyle=gr; c.beginPath(); c.moveTo(x1L,y1); c.lineTo(x1R,y1); c.lineTo(x2R,y2); c.lineTo(x2L,y2); c.closePath(); c.fill();
      c.shadowBlur=0; c.strokeStyle='rgba(255,255,255,.85)'; c.lineWidth=Math.max(1.5,3.5*this._getS(d1));
      c.globalAlpha=(this.flags[i]===2)?0.1:0.9;
      c.beginPath(); c.moveTo(x1L,y1); c.lineTo(x1R,y1); c.stroke(); c.restore();
    }
  }

  _drawFlash() {
    const c = this.ctx;
    for (let i=0;i<4;i++) {
      if(this.flash[i]<0.02) continue;
      const xL=this.TL+i*this.LW, xR=xL+this.LW;
      const gr=c.createLinearGradient(0,this.JY,0,this.VY);
      gr.addColorStop(0,`rgba(${this._hexRGB(this.COLORS[i])},${this.flash[i]*.55})`);
      gr.addColorStop(1,`rgba(${this._hexRGB(this.COLORS[i])},0)`);
      c.fillStyle=gr;
      c.beginPath(); c.moveTo(xL,this.JY); c.lineTo(xR,this.JY);
      c.lineTo(this._laneX(i,.5)+this._laneHW(.5),this._getY(.5));
      c.lineTo(this._laneX(i,.5)-this._laneHW(.5),this._getY(.5));
      c.closePath(); c.fill();
    }
  }

  _drawButtons() {
    const c=this.ctx, btnY=this.JY, btnH=this.H-this.JY;
    for(let i=0;i<4;i++){
      const x=this.TL+i*this.LW;
      c.globalAlpha=0.12+this.flash[i]*.30; c.fillStyle=this.COLORS[i]; c.fillRect(x,btnY,this.LW,btnH);
      c.globalAlpha=0.65+this.flash[i]*.35; c.fillStyle=this.COLORS[i];
      c.font=`bold ${this.LW*.13|0}px monospace`; c.textAlign='center';
      c.fillText(this.NAMES[i],x+this.LW/2,btnY+btnH*.58); c.globalAlpha=1;
      if(i>0){c.strokeStyle='rgba(255,255,255,.08)';c.lineWidth=1;c.beginPath();c.moveTo(x,btnY);c.lineTo(x,this.H);c.stroke();}
    }
  }

  _drawFX() {
    const c=this.ctx;
    for(const p of this.ptcl){
      c.save(); c.globalAlpha=Math.min(1,p.a); c.fillStyle=p.col; c.shadowColor=p.col; c.shadowBlur=5;
      c.beginPath(); c.arc(p.x,p.y,p.r,0,Math.PI*2); c.fill(); c.restore();
    }
    for(const j of this.jfx){
      c.save(); c.globalAlpha=Math.min(1,j.a); c.fillStyle=j.col; c.shadowColor=j.col; c.shadowBlur=10;
      c.font=`bold ${this.H*.044*j.s|0}px monospace`; c.textAlign='center'; c.fillText(j.txt,j.x,j.y); c.restore();
    }
  }

  _drawHUD() {
    const c=this.ctx;
    const ms = (this.audioEl?.currentTime||0)*1000;
    const prog = Math.min(1, ms / LIMIT_MS);
    c.fillStyle='rgba(255,255,255,.07)'; c.fillRect(0,0,this.W,5);
    c.fillStyle='#55aaff'; c.fillRect(0,0,this.W*prog,5);
    c.fillStyle='#fff'; c.shadowColor='#55aaff'; c.shadowBlur=8;
    c.font=`bold ${this.H*.042|0}px monospace`; c.textAlign='right';
    c.fillText(String(this.score).padStart(7,'0'),this.W-16,this.H*.065); c.shadowBlur=0;
    if(this.combo>=2){
      c.font=`bold ${this.H*.058*this.cScale|0}px monospace`; c.textAlign='center'; c.fillStyle='#ffd700';
      c.shadowColor='#ff9900'; c.shadowBlur=12; c.fillText(this.combo+' COMBO',this.cx,this.H*.068); c.shadowBlur=0;
    }
    c.font=`bold ${this.H*.022|0}px monospace`; c.textAlign='left';
    c.fillStyle=this.DIFFICULTIES[this.diffKey].col; c.fillText(this.diffKey,14,this.H*.105);
  }

  _drawEntryAnim(ts) {
    const c = this.ctx;
    const elapsed=(ts-this.entryAnimT)/1000;
    const flashA=Math.max(0,0.85-elapsed*1.4);
    c.fillStyle=`rgba(255,210,80,${flashA})`; c.fillRect(0,0,this.W,this.H);
    const scaleIn=Math.min(1,elapsed*4), scale=0.15+scaleIn*0.85;
    const fadeIn=Math.min(1,elapsed*5), fadeOut=elapsed>1.6?Math.max(0,1-(elapsed-1.6)*3):1;
    c.save(); c.globalAlpha=fadeIn*fadeOut;
    c.translate(this.cx,this.H*.46); c.scale(scale,scale);
    c.textAlign='center'; c.font=`bold ${this.H*.13|0}px monospace`;
    c.fillStyle='#fff'; c.shadowColor='#ffaa00'; c.shadowBlur=55;
    c.fillText('GAME START!',0,0); c.restore(); c.shadowBlur=0;
    const step = Math.floor(elapsed / 0.7);
    const countMap = ['3', '2', '1'];
    if (step >= 0 && step <= 2) {
      c.fillStyle = '#ffe566'; c.shadowColor = '#ffcc33'; c.shadowBlur = 20;
      c.font = `bold ${this.H*.12|0}px monospace`; c.textAlign = 'center';
      c.fillText(countMap[step], this.cx, this.H * 0.72); c.shadowBlur = 0;
    } else if (elapsed < 2.3) {
      c.fillStyle = 'rgba(140,220,255,0.95)';
      c.font = `bold ${this.H*.07|0}px monospace`; c.textAlign = 'center';
      c.fillText('READY', this.cx, this.H * 0.72);
    }
  }

  _drawResult() {
    this.btnList = [];
    const c = this.ctx;
    c.fillStyle='rgba(4,4,20,0.92)'; c.fillRect(0,0,this.W,this.H);

    c.fillStyle='#ffd700'; c.shadowColor='#ff8800'; c.shadowBlur=20;
    c.font=`bold ${this.H*.065|0}px monospace`; c.textAlign='center';
    c.fillText('RESULT',this.cx,this.H*.11); c.shadowBlur=0;
    c.fillStyle='#fff'; c.font=`bold ${this.H*.09|0}px monospace`;
    c.fillText(String(this.score).padStart(7,'0'),this.cx,this.H*.23);
    const tot=this.cnt.p+this.cnt.g+this.cnt.ok+this.cnt.m;
    const acc=tot?((this.cnt.p*100+this.cnt.g*70+this.cnt.ok*40)/(tot*100)*100).toFixed(1):0;
    c.fillStyle='#adf'; c.font=`${this.H*.03|0}px monospace`;
    c.fillText(`Accuracy ${acc}%   Max Combo ${this.maxCombo}`,this.cx,this.H*.31);
    [['PERFECT',this.cnt.p,'#ffe566'],['GREAT',this.cnt.g,'#66ddff'],['GOOD',this.cnt.ok,'#88ff88'],['MISS',this.cnt.m,'#ff6666']].forEach(([t,cnt,col],i) => {
      const ry=this.H*.38+i*this.H*.058;
      c.textAlign='right'; c.fillStyle=col; c.font=`${this.H*.03|0}px monospace`;
      c.fillText(t,this.cx-10,ry); c.textAlign='left'; c.fillText(String(cnt).padStart(4),this.cx+20,ry);
    });

    // エンドメッセージ
    if (this._endMessage) {
      const mx = this.W*0.05, mw = this.W*0.9;
      const my = this.H*0.63, mh = this.H*0.18;
      c.fillStyle='rgba(0,30,60,0.75)';
      this._rr(mx, my, mw, mh, 12); c.fill();
      c.strokeStyle='rgba(85,170,255,0.5)'; c.lineWidth=1.5;
      this._rr(mx, my, mw, mh, 12); c.stroke();
      c.fillStyle='#88ccff'; c.font=`${this.H*.028|0}px sans-serif`; c.textAlign='center';
      const lh = this.H * 0.04;
      let line = '', y = my + mh * 0.38;
      for (const ch of this._endMessage.split('')) {
        const test = line + ch;
        if (c.measureText(test).width > mw * 0.88 && line !== '') {
          c.fillText(line, this.cx, y); y += lh; line = ch;
        } else { line = test; }
      }
      if (line) c.fillText(line, this.cx, y);
    }

    const bh=Math.min(this.H*.09,52), bw=Math.min(this.W*.42,220);
    this._drawBtn('つぎへ ▶', this.cx, this.H*.88, bw, bh, '#0e1a30', '#66ccff', () => {
      if (this.onComplete) this.onComplete();
    });
  }

  // ── Input ─────────────────────────────────────────────────────

  _onInput(cx, cy) {
    this._initActx();
    if (this.gs === this.GS.RESULT) {
      for (const b of this.btnList) if(cx>=b.x&&cx<=b.x+b.w&&cy>=b.y&&cy<=b.y+b.h){ b.cb(); return; }
      return;
    }
    if (this.gs === this.GS.TITLE) return;
    const li = Math.floor((cx / this.W) * 4);
    if (li >= 0 && li < 4) this._tap(li);
  }

  // ── Main loop ─────────────────────────────────────────────────

  _startLoop() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  _loop(ts) {
    this._rafId = requestAnimationFrame(this._boundLoop);
    this._updateThree(ts);
    this._update();
    this._drawBg();
    if (this.entryAnim) {
      this._drawEntryAnim(ts);
    } else {
      switch (this.gs) {
        case this.GS.PLAYING:
          this._drawTrack(); this._drawFlash(); this._drawNotes();
          this._drawFX(); this._drawButtons(); this._drawHUD();
          break;
        case this.GS.RESULT:
          this._drawResult();
          break;
      }
    }
  }
}
