// contents/rhythm-short/game.js  短いリズムゲーム（レインボーブリッジ）

/**
 * ShortRhythmGame — 15秒の短いリズムゲーム
 * 音楽はWeb Audio APIで合成（外部音源不要）
 * ブリッジテーマの2Dビジュアル
 *
 * event.contentData:
 *   endMessage  string  ゲーム後に表示するメッセージ
 */
export class ShortRhythmGame {
  constructor(audioManager) {
    this.audio     = audioManager;
    this.container = null;
    this.canvas    = null;
    this.ctx2d     = null;

    // Game state
    this.GS = { WAITING:0, PLAYING:1, RESULT:2 };
    this.gs = 0;
    this._startTime  = 0;   // performance.now() at game start
    this._notes      = [];  // {time_ms, lane, hit, missed}
    this._nPtr       = 0;   // next note to activate pointer
    this._active     = [];  // falling notes [{time_ms,lane,y,hit,missed}]
    this._flash      = [0,0,0,0];  // lane flash timers
    this._score      = 0;
    this._combo      = 0;
    this._maxCombo   = 0;
    this._perfect    = 0; this._good = 0; this._miss = 0;
    this._jfx        = [];  // [{x,y,text,color,alpha,vy}]

    // Layout
    this.W = 0; this.H = 0;
    this.LANE_N    = 4;
    this.JY        = 0;   // judgment line Y
    this.laneX     = [];  // lane center X
    this.laneW     = 0;
    this.NOTE_H    = 22;
    this.WIN_P     = 150; // PERFECT window ms
    this.WIN_G     = 300; // GOOD window ms
    this.APPROACH  = 2000; // ms for note to fall from top to judgment line

    // Music scheduling
    this._actx     = null;
    this._musicEnd = 0;  // ms when music ends

    // RAF
    this._rafId     = null;
    this._boundLoop = this._loop.bind(this);
    this._boundResize = this._onResize.bind(this);

    this.onComplete = null;
    this._data      = {};

    // Constants
    this.COLORS    = ['#ff7043','#26c6da','#66bb6a','#ab47bc'];
    this.GLOWS     = ['rgba(255,112,67,.7)','rgba(38,198,218,.7)','rgba(102,187,106,.7)','rgba(171,71,188,.7)'];
    this.COLORS_DK = ['rgba(90,26,8,.55)','rgba(10,74,85,.55)','rgba(42,85,48,.55)','rgba(58,16,80,.55)'];
    this.NAMES     = ['KICK','SNARE','MELODY','HI-HAT'];

    // Hardcoded chart: 12 notes over ~13 seconds
    // offset_ms = 2000 (music plays 2s before first note)
    this.CHART_NOTES = [
      {time_ms:2000,  lane:0},
      {time_ms:3000,  lane:3},
      {time_ms:4000,  lane:1},
      {time_ms:5000,  lane:2},
      {time_ms:6000,  lane:0},
      {time_ms:6500,  lane:3},
      {time_ms:7000,  lane:1},
      {time_ms:8000,  lane:2},
      {time_ms:8500,  lane:0},
      {time_ms:9000,  lane:3},
      {time_ms:10000, lane:1},
      {time_ms:11000, lane:2},
    ];
    this.GAME_END_MS = 13500; // total game duration in ms
  }

  // ── ContentBase interface ────────────────────────────────────────

  getUI() {
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:fixed;inset:0;z-index:10;overflow:hidden;touch-action:none;';

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    this.container.appendChild(this.canvas);

    // Result overlay
    this._resultOverlay = document.createElement('div');
    this._resultOverlay.style.cssText = `
      position:absolute;inset:0;z-index:20;
      display:none;flex-direction:column;align-items:center;justify-content:center;
      background:rgba(4,8,24,0.92);font-family:sans-serif;
      touch-action:auto;padding:32px;
    `;
    this.container.appendChild(this._resultOverlay);

    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      for (const t of e.changedTouches) this._onTap(t.clientX, t.clientY);
    }, {passive:false});
    this.canvas.addEventListener('mousedown', e => this._onTap(e.clientX, e.clientY));

    window.addEventListener('resize', this._boundResize);
    this._onResize();
    return this.container;
  }

  async onEnter(event) {
    this._data = event.contentData || {};
    this.gs = this.GS.WAITING;
    this._reset();
    this._scheduleSynth();
    // Small delay then auto-start
    setTimeout(() => this._startGame(), 300);
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  onExit() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._endTimer) { clearTimeout(this._endTimer); this._endTimer = null; }
    window.removeEventListener('resize', this._boundResize);
    this._stopSynth();
    this._resultOverlay.style.display = 'none';
    this.gs = this.GS.WAITING;
  }

  // ── 内部: game lifecycle ──────────────────────────────────────────

  _reset() {
    this._notes   = this.CHART_NOTES.map(n => ({...n, hit:false, missed:false}));
    this._active  = [];
    this._nPtr    = 0;
    this._score   = 0; this._combo = 0; this._maxCombo = 0;
    this._perfect = 0; this._good = 0; this._miss = 0;
    this._flash   = [0,0,0,0];
    this._jfx     = [];
  }

  _startGame() {
    this.gs = this.GS.PLAYING;
    this._startTime = performance.now();
    // Start synth music
    this._startSynth();
    // Schedule game end
    this._endTimer = setTimeout(() => this._endGame(), this.GAME_END_MS);
  }

  _endGame() {
    this.gs = this.GS.RESULT;
    this._stopSynth();
    this._showResult();
  }

  // ── 内部: synthesized music ───────────────────────────────────────

  _scheduleSynth() {
    // Pre-create AudioContext (use the shared one from AudioManager)
    this._actx = this.audio.getContext();
  }

  _startSynth() {
    const actx = this._actx;
    if (!actx) return;

    const t0 = actx.currentTime;
    const BPM = 120;
    const beat = 60 / BPM; // 0.5s per beat

    const tone = (freq, startT, dur, vol, wave='sine') => {
      const g = actx.createGain();
      g.gain.setValueAtTime(vol, startT);
      g.gain.exponentialRampToValueAtTime(0.001, startT + dur);
      g.connect(actx.destination);
      const o = actx.createOscillator();
      o.type = wave;
      o.frequency.value = freq;
      o.connect(g);
      o.start(startT);
      o.stop(startT + dur + 0.01);
    };

    const noise = (startT, dur, hp, vol) => {
      const bl = actx.sampleRate * dur | 0;
      const buf = actx.createBuffer(1, bl, actx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < bl; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / bl);
      const s = actx.createBufferSource();
      s.buffer = buf;
      const hpf = actx.createBiquadFilter();
      hpf.type = 'highpass'; hpf.frequency.value = hp;
      const g = actx.createGain();
      g.gain.setValueAtTime(vol, startT);
      g.gain.exponentialRampToValueAtTime(0.001, startT + dur);
      s.connect(hpf); hpf.connect(g); g.connect(actx.destination);
      s.start(startT);
    };

    // 4-beat pattern repeated for GAME_END_MS
    const totalBeats = Math.ceil((this.GAME_END_MS / 1000) / beat) + 4;
    const MELODY = [523, 587, 659, 698, 784, 880, 988]; // C5..B5

    for (let b = 0; b < totalBeats; b++) {
      const bt = t0 + b * beat;
      const beat4 = b % 4;

      // Kick (beat 0, 2)
      if (beat4 === 0 || beat4 === 2) {
        tone(60, bt, 0.25, 0.5, 'sine');
        noise(bt, 0.04, 200, 0.3);
      }
      // Snare (beat 1, 3)
      if (beat4 === 1 || beat4 === 3) {
        noise(bt, 0.12, 1000, 0.35);
        tone(200, bt, 0.08, 0.2, 'triangle');
      }
      // Hi-hat every beat
      noise(bt, 0.04, 5000, 0.12);

      // Melody: on beats 0, 2 every 2 measures (every 8 beats)
      const measure8 = Math.floor(b / 8);
      const beat8    = b % 8;
      if (beat8 === 0 || beat8 === 4) {
        const freq = MELODY[measure8 % MELODY.length];
        tone(freq, bt, beat * 1.5, 0.18, 'triangle');
      }
    }

    this._synthStarted = true;
  }

  _stopSynth() {
    // AudioContext scheduled sounds will fade out naturally;
    // we can't easily stop them without disconnecting the destination,
    // so we just flag as stopped.
    this._synthStarted = false;
  }

  // ── 内部: input ────────────────────────────────────────────────────

  _onTap(cx, cy) {
    if (this.gs !== this.GS.PLAYING) return;

    // Find which lane was tapped
    let lane = -1;
    for (let l = 0; l < this.LANE_N; l++) {
      const lx = this.laneX[l];
      if (cx >= lx - this.laneW / 2 && cx < lx + this.laneW / 2) { lane = l; break; }
    }
    if (lane < 0) return;

    const now_ms = performance.now() - this._startTime;
    this._flash[lane] = 8;

    // Find closest note in this lane
    let best = null, bestDt = Infinity;
    for (const n of this._active) {
      if (n.lane !== lane || n.hit || n.missed) continue;
      const dt = Math.abs(n.time_ms - now_ms);
      if (dt < bestDt) { bestDt = dt; best = n; }
    }

    if (!best) {
      try { this.audio.playSFX('tapMiss'); } catch(_) {}
      return;
    }

    let judge = '';
    if (bestDt <= this.WIN_P)      { judge = 'PERFECT'; this._perfect++; this._score += 100; }
    else if (bestDt <= this.WIN_G) { judge = 'GOOD';    this._good++;    this._score += 50;  }
    else                           { judge = 'LATE';     this._good++;    this._score += 30;  }

    best.hit = true;
    this._combo++;
    if (this._combo > this._maxCombo) this._maxCombo = this._combo;
    this._flash[lane] = 12;

    const col = judge === 'PERFECT' ? '#ffdd44' : '#88ccff';
    this._jfx.push({ x: this.laneX[lane], y: this.JY - 30, text: judge, color: col, alpha: 1, vy: -1.2 });

    try { this.audio.playSFX(judge === 'PERFECT' ? 'tapPerfect' : 'tapGood'); } catch(_) {}
  }

  // ── 内部: result screen ────────────────────────────────────────────

  _showResult() {
    const msg = this._data.endMessage || 'お台場エリアに入りました。';
    const total = this._perfect + this._good + this._miss;
    const acc = total > 0 ? Math.round(((this._perfect + this._good * 0.5) / total) * 100) : 0;

    this._resultOverlay.innerHTML = `
      <div style="font-size:36px;margin-bottom:8px;">🎉</div>
      <div style="font-size:clamp(18px,5vw,26px);color:#88ccff;font-weight:bold;
        margin-bottom:20px;text-align:center;letter-spacing:1px;
        text-shadow:0 0 16px rgba(100,200,255,0.5);">
        ${msg}
      </div>
      <div style="width:100%;max-width:360px;background:#0d1a2e;
        border:1px solid #1e3a5a;border-radius:14px;
        padding:18px 20px;margin-bottom:24px;text-align:center;">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px;">
          <div>
            <div style="font-size:11px;color:#445;letter-spacing:1px;margin-bottom:4px;">PERFECT</div>
            <div style="font-size:22px;color:#ffdd44;font-weight:bold;">${this._perfect}</div>
          </div>
          <div>
            <div style="font-size:11px;color:#445;letter-spacing:1px;margin-bottom:4px;">GOOD</div>
            <div style="font-size:22px;color:#88ccff;font-weight:bold;">${this._good}</div>
          </div>
          <div>
            <div style="font-size:11px;color:#445;letter-spacing:1px;margin-bottom:4px;">MISS</div>
            <div style="font-size:22px;color:#ff7755;font-weight:bold;">${this._miss}</div>
          </div>
        </div>
        <div style="font-size:12px;color:#556;">MAX COMBO ${this._maxCombo} / SCORE ${this._score}</div>
      </div>
      <button id="_srg_ok_btn" style="padding:16px 48px;border-radius:10px;
        background:#0e2040;border:1px solid #3366aa;
        color:#88aaff;font-family:monospace;font-size:16px;font-weight:bold;
        cursor:pointer;letter-spacing:2px;touch-action:manipulation;">
        ✓  つぎへ
      </button>
    `;
    this._resultOverlay.style.display = 'flex';
    this._resultOverlay.querySelector('#_srg_ok_btn').addEventListener('click', () => {
      this._resultOverlay.style.display = 'none';
      if (this.onComplete) this.onComplete();
    });

    // TTS
    setTimeout(async () => {
      try { await this.audio.speak(msg, { rate: 0.88 }); } catch(_) {}
    }, 400);
  }

  // ── 内部: render loop ──────────────────────────────────────────────

  _loop(ts) {
    this._rafId = requestAnimationFrame(this._boundLoop);
    if (this.gs === this.GS.WAITING) {
      this._drawWaiting();
      return;
    }
    if (this.gs === this.GS.RESULT) return;

    const now_ms = performance.now() - this._startTime;

    // Activate notes that should appear
    while (this._nPtr < this._notes.length) {
      const n = this._notes[this._nPtr];
      if (n.time_ms - this.APPROACH <= now_ms) {
        this._active.push({...n});
        this._nPtr++;
      } else break;
    }

    // Update active notes position
    for (const n of this._active) {
      const progress = (now_ms - (n.time_ms - this.APPROACH)) / this.APPROACH;
      n.y = progress * this.JY;

      // Miss detection
      if (!n.hit && !n.missed && now_ms > n.time_ms + this.WIN_G) {
        n.missed = true;
        this._miss++;
        this._combo = 0;
        this._jfx.push({ x: this.laneX[n.lane], y: this.JY - 30, text: 'MISS', color: '#ff5533', alpha: 1, vy: -1 });
        try { this.audio.playSFX('tapMiss'); } catch(_) {}
      }
    }

    // Remove old notes
    this._active = this._active.filter(n => !n.hit && !n.missed || n.y < this.H + 60);

    // Update flash
    for (let l = 0; l < this.LANE_N; l++) if (this._flash[l] > 0) this._flash[l]--;

    // Update jfx
    this._jfx = this._jfx.filter(f => f.alpha > 0);
    for (const f of this._jfx) { f.y += f.vy; f.alpha -= 0.025; }

    this._draw(now_ms);
  }

  _draw(now_ms) {
    const c = this.ctx2d;
    const W = this.W, H = this.H;
    c.clearRect(0, 0, W, H);

    // ── Background: bridge scene ────────────────────────────────────

    // Sky gradient (dark blue → purple)
    const sky = c.createLinearGradient(0, 0, 0, H * 0.65);
    sky.addColorStop(0, '#020818');
    sky.addColorStop(0.5, '#06102a');
    sky.addColorStop(1, '#0a1428');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H * 0.65);

    // Stars
    if (!this._stars) this._genStars(W, H);
    c.fillStyle = 'rgba(255,255,255,0.7)';
    for (const [sx, sy, sr] of this._stars) {
      c.beginPath(); c.arc(sx, sy, sr, 0, Math.PI*2); c.fill();
    }

    // Water
    const water = c.createLinearGradient(0, H * 0.6, 0, H * 0.7);
    water.addColorStop(0, '#03071a');
    water.addColorStop(1, '#050c24');
    c.fillStyle = water;
    c.fillRect(0, H * 0.6, W, H * 0.1);

    // Water reflection shimmer
    c.globalAlpha = 0.15 + 0.05 * Math.sin(now_ms / 600);
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) {
      const rx = W * (0.1 + i * 0.15);
      c.fillRect(rx, H * 0.61, 2, 4);
    }
    c.globalAlpha = 1;

    // Bridge cables (sweeping arcs)
    const bridgeY = H * 0.3;
    const towerH  = H * 0.22;
    const TOWERS  = [W * 0.3, W * 0.7];

    // Tower structures
    for (const tx of TOWERS) {
      c.fillStyle = '#223355';
      c.fillRect(tx - 5, bridgeY - towerH, 10, towerH);
      // Tower top ornament
      c.fillStyle = '#334466';
      c.fillRect(tx - 8, bridgeY - towerH - 4, 16, 8);
      // Tower lights
      c.fillStyle = `rgba(255,200,50,${0.6 + 0.4*Math.sin(now_ms/500)})`;
      c.beginPath(); c.arc(tx, bridgeY - towerH - 6, 3, 0, Math.PI*2); c.fill();
    }

    // Main cables (parabolic)
    c.strokeStyle = '#3355aa';
    c.lineWidth = 2;
    for (let k = 0; k < 2; k++) {
      const x1 = TOWERS[k] - W * 0.15;
      const x2 = TOWERS[k] + W * 0.15;
      const topY = bridgeY - towerH;
      c.beginPath();
      c.moveTo(x1, bridgeY - towerH * 0.3);
      c.quadraticCurveTo(TOWERS[k], topY, x2, bridgeY - towerH * 0.3);
      c.stroke();
    }

    // Vertical hanger cables
    c.strokeStyle = 'rgba(80,120,200,0.35)';
    c.lineWidth = 1;
    for (const tx of TOWERS) {
      for (let h = -3; h <= 3; h++) {
        const hx = tx + h * W * 0.04;
        c.beginPath(); c.moveTo(hx, bridgeY - towerH * 0.15); c.lineTo(hx, bridgeY + 4); c.stroke();
      }
    }

    // Bridge deck
    c.fillStyle = '#1a2a44';
    c.fillRect(0, H * 0.6 - 4, W, 8);

    // ── Lane area ───────────────────────────────────────────────────

    // Lane background
    for (let l = 0; l < this.LANE_N; l++) {
      const lx = this.laneX[l];
      const lw = this.laneW;

      c.fillStyle = this.COLORS_DK[l];
      c.fillRect(lx - lw/2, H * 0.65, lw, H * 0.35);

      // Lane separator lines
      c.strokeStyle = 'rgba(255,255,255,0.06)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(lx - lw/2, H * 0.65); c.lineTo(lx - lw/2, H); c.stroke();
    }

    // Judgment line
    c.strokeStyle = 'rgba(255,255,255,0.4)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, this.JY); c.lineTo(W, this.JY); c.stroke();

    // Lane flash
    for (let l = 0; l < this.LANE_N; l++) {
      if (this._flash[l] > 0) {
        const lx = this.laneX[l];
        c.fillStyle = this.GLOWS[l].replace('.7', (this._flash[l]/12*0.5).toFixed(2));
        c.fillRect(lx - this.laneW/2, H * 0.65, this.laneW, H * 0.35);
      }
    }

    // Lane labels
    c.font = 'bold 11px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let l = 0; l < this.LANE_N; l++) {
      c.fillStyle = this.COLORS[l];
      c.globalAlpha = 0.5;
      c.fillText(this.NAMES[l], this.laneX[l], H - 14);
    }
    c.globalAlpha = 1;

    // ── Notes ────────────────────────────────────────────────────────

    for (const n of this._active) {
      if (n.hit) continue;
      const lx = this.laneX[n.lane];
      const ny = n.y;
      if (ny < 0) continue;

      const nw = this.laneW * 0.82;
      const nh = this.NOTE_H;

      // Shadow glow
      c.shadowColor = this.GLOWS[n.lane];
      c.shadowBlur  = 12;

      // Note body
      c.fillStyle = this.COLORS[n.lane];
      const rx = lx - nw/2, ry = ny - nh/2;
      const r = 8;
      c.beginPath();
      c.moveTo(rx + r, ry);
      c.lineTo(rx + nw - r, ry);
      c.quadraticCurveTo(rx+nw, ry, rx+nw, ry+r);
      c.lineTo(rx+nw, ry+nh-r);
      c.quadraticCurveTo(rx+nw, ry+nh, rx+nw-r, ry+nh);
      c.lineTo(rx+r, ry+nh);
      c.quadraticCurveTo(rx, ry+nh, rx, ry+nh-r);
      c.lineTo(rx, ry+r);
      c.quadraticCurveTo(rx, ry, rx+r, ry);
      c.closePath();
      c.fill();

      // Highlight
      c.shadowBlur = 0;
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fillRect(rx + 4, ry + 3, nw - 8, nh * 0.4);
    }
    c.shadowBlur = 0;

    // ── JFX (judgment text) ──────────────────────────────────────────
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const f of this._jfx) {
      c.globalAlpha = f.alpha;
      c.fillStyle   = f.color;
      c.font = 'bold 16px monospace';
      c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;

    // ── HUD ─────────────────────────────────────────────────────────
    const elapsed = now_ms / 1000;
    const remain  = Math.max(0, this.GAME_END_MS / 1000 - elapsed);

    c.fillStyle = 'rgba(4,8,24,0.6)';
    c.fillRect(0, 0, W, 48);

    c.font = 'bold 15px monospace';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = '#aaa';
    c.fillText(`SCORE  ${this._score}`, 12, 24);

    c.textAlign = 'center';
    c.fillStyle = '#fff';
    c.font = 'bold 14px monospace';
    c.fillText(`⏱ ${remain.toFixed(1)}`, W / 2, 24);

    c.textAlign = 'right';
    c.fillStyle = this._combo > 0 ? '#ffcc44' : '#444';
    c.fillText(`${this._combo} COMBO`, W - 12, 24);
  }

  _drawWaiting() {
    const c = this.ctx2d;
    c.clearRect(0, 0, this.W, this.H);
    c.fillStyle = '#04040e';
    c.fillRect(0, 0, this.W, this.H);
    c.fillStyle = '#445';
    c.font = '14px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('準備中...', this.W/2, this.H/2);
  }

  _genStars(W, H) {
    this._stars = [];
    for (let i = 0; i < 60; i++) {
      this._stars.push([
        Math.random() * W,
        Math.random() * H * 0.55,
        Math.random() * 1.2 + 0.3,
      ]);
    }
  }

  _onResize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.W = W; this.H = H;
    if (this.canvas) { this.canvas.width = W; this.canvas.height = H; }
    this.ctx2d = this.canvas?.getContext('2d') || this.ctx2d;

    this.JY     = H * 0.80;
    this.laneW  = W / this.LANE_N;
    this.laneX  = [0,1,2,3].map(l => this.laneW * l + this.laneW / 2);
    this._stars = null; // regenerate
  }
}
