const CHOICE_COLORS = ['#ff8a65', '#4dd0e1', '#81c784', '#ba68c8'];
const CHOICE_BG = ['rgba(90,26,8,0.82)', 'rgba(10,74,85,0.82)', 'rgba(42,85,48,0.82)', 'rgba(58,16,80,0.82)'];
const TIMER_MS = 20000;
const POST_READ_DELAY_MS = 1200;
const QUIZ_INTRO_TEXT = 'じゃじゃん、ここでクイズです！';
const TEN_SECONDS_TEXT = 'あと10秒';
const FIVE_SECONDS_TEXT = 'あと5秒';

export class FamilyQuiz {
  constructor(audioManager) {
    this.audio = audioManager;
    this.container = null;
    this.threeCanvas = null;
    this.gameCanvas = null;
    this.ctx = null;

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.buildings = [];
    this.threeLastT = 0;
    this.ROAD_W = 8;
    this.ROAD_LEN = 200;
    this.BLDG_N = 14;

    this.W = 0;
    this.H = 0;
    this.cx = 0;

    this._question = null;
    this._state = 'IDLE'; // IDLE|INTRO|READING|CHOOSING|RESULT
    this._selectedIndex = 0;
    this._result = null;
    this._spokenResult = false;
    this._choiceRects = [];
    this._btnList = [];
    this._introUntil = 0;
    this._countdownStart = 0;
    this._countdownTimer = null;
    this._resultTimer = null;
    this._announced10 = false;
    this._announced5 = false;
    this._lastCountdownSecond = null;
    this._exited = false;
    this._rafId = null;
    this._boundLoop = this._loop.bind(this);
    this._boundResize = this._onResize.bind(this);
    this.onComplete = null;
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

  async onEnter(event) {
    const d = event.contentData || {};
    this._exited = false;
    this._spokenResult = false;

    this._question = {
      question: d.question || '',
      choices: d.choices || [],
      correctIndex: d.correctIndex ?? 0,
      correctMsg: d.correctMsg || '',
      wrongMsg: d.wrongMsg || '',
    };

    this._state = 'INTRO';
    this._selectedIndex = 0;
    this._result = null;
    this._choiceRects = [];
    this._btnList = [];
    this._introUntil = performance.now() + 1100;
    this._announced10 = false;
    this._announced5 = false;
    this._lastCountdownSecond = null;
    if (this._countdownTimer) clearTimeout(this._countdownTimer);
    if (this._resultTimer) clearTimeout(this._resultTimer);

    this._startLoop();
    this.audio?.unlock();
    this.audio?.stopSpeech();
    try { this.audio?.playSFX('quizStart'); } catch (_) {}
  }

  onExit() {
    this._exited = true;
    this._state = 'IDLE';
    if (this._countdownTimer) { clearTimeout(this._countdownTimer); this._countdownTimer = null; }
    if (this._resultTimer) { clearTimeout(this._resultTimer); this._resultTimer = null; }
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    window.removeEventListener('resize', this._boundResize);
    this.audio?.stopSpeech();
  }

  _layout() {
    const dpr = window.devicePixelRatio || 1;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.cx = this.W / 2;
    if (this.gameCanvas) {
      this.gameCanvas.width = this.W * dpr;
      this.gameCanvas.height = this.H * dpr;
      this.ctx = this.gameCanvas.getContext('2d');
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (this.renderer) this.renderer.setSize(this.W, this.H);
    if (this.camera) {
      this.camera.aspect = this.W / this.H;
      this.camera.updateProjectionMatrix();
    }
  }

  _onResize() {
    this._layout();
  }

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

    const amb = new THREE.AmbientLight(0xffffff, 1.2);
    const dir = new THREE.DirectionalLight(0xffffff, 1.8);
    dir.position.set(5, 20, 4);
    const fill = new THREE.DirectionalLight(0xaaddff, 0.5);
    fill.position.set(-4, 8, -6);
    this.scene.add(amb, dir, fill);

    const roadMat = new THREE.MeshLambertMaterial({ color: 0x484848 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(this.ROAD_W, this.ROAD_LEN), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -this.ROAD_LEN / 2);
    this.scene.add(road);

    for (const side of [-1, 1]) {
      const m = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
      const g = new THREE.Mesh(new THREE.PlaneGeometry(5, this.ROAD_LEN), m);
      g.rotation.x = -Math.PI / 2;
      g.position.set(side * (this.ROAD_W / 2 + 2.5), -0.01, -this.ROAD_LEN / 2);
      this.scene.add(g);
    }

    [[-4, 'solid'], [-2, 'dash'], [0, 'dash'], [2, 'dash'], [4, 'solid']].forEach(([x, type]) => {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: type === 'solid' ? 0.95 : 0.7, transparent: true });
      const g = new THREE.Mesh(new THREE.PlaneGeometry(type === 'solid' ? 0.12 : 0.08, this.ROAD_LEN), m);
      g.rotation.x = -Math.PI / 2;
      g.position.set(x, 0.01, -this.ROAD_LEN / 2);
      this.scene.add(g);
    });

    const bPalette = [0xcc3333, 0xdd9922, 0x3366cc, 0x33aa55, 0xcc44aa, 0x22aacc, 0x9944cc, 0xddcc22, 0xee6633, 0x44bbcc, 0xcc8833, 0x5588dd, 0x55bb44, 0xdd4466, 0x22bbaa];
    for (const side of [-1, 1]) {
      for (let i = 0; i < this.BLDG_N; i++) {
        const w = 3 + Math.random() * 5;
        const h = 6 + Math.random() * 22;
        const d = 4 + Math.random() * 5;
        const mat = new THREE.MeshLambertMaterial({ color: bPalette[Math.floor(Math.random() * bPalette.length)] });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(side * (this.ROAD_W / 2 + 1.5 + Math.random() * 7), h / 2, -(i / this.BLDG_N) * this.ROAD_LEN);
        this.scene.add(mesh);
        this.buildings.push(mesh);
      }
    }
  }

  _updateThree(ts) {
    if (!this.renderer || !window.THREE) return;
    const dt = Math.min((ts - this.threeLastT) / 1000, 0.05);
    this.threeLastT = ts;
    const speed = this._state === 'CHOOSING' ? 12 : 6;
    const move = speed * dt;
    for (const mesh of this.buildings) {
      mesh.position.z += move;
      if (mesh.position.z > 5) mesh.position.z -= this.ROAD_LEN;
    }
    this.renderer.render(this.scene, this.camera);
  }

  async _startQuestion() {
    this._state = 'READING';
    try { await this.audio?.speak(QUIZ_INTRO_TEXT, { rate: 0.95 }); } catch (_) {}
    if (this._exited) return;
    const prompt = `${this._question.question}`;
    try { await this.audio?.speak(prompt, { rate: 0.92 }); } catch (_) {}
    if (this._exited) return;
    await new Promise(resolve => setTimeout(resolve, POST_READ_DELAY_MS));
    if (this._exited) return;
    this._startChoicePhase();
  }

  _startChoicePhase() {
    this._state = 'CHOOSING';
    this._countdownStart = performance.now();
    if (this._countdownTimer) clearTimeout(this._countdownTimer);
    this._countdownTimer = setTimeout(() => {
      this._countdownTimer = null;
      this._judgeSelection();
    }, TIMER_MS);
  }

  _judgeSelection() {
    if (this._state !== 'CHOOSING') return;
    this._result = this._selectedIndex === this._question.correctIndex ? 'correct' : 'wrong';
    this._state = 'RESULT';
    this._spokenResult = false;
    try { this.audio?.playSFX(this._result === 'correct' ? 'pinpon' : 'bubuu'); } catch (_) {}
  }

  _onInput(x, y) {
    this.audio?.unlock();

    if (this._state === 'RESULT') {
      for (const b of this._btnList) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          b.cb();
          return;
        }
      }
      return;
    }

    if (this._state !== 'CHOOSING') return;

    for (let i = 0; i < this._choiceRects.length; i++) {
      const r = this._choiceRects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        this._selectedIndex = i;
        try { this.audio?.playSFX('tap'); } catch (_) {}
        return;
      }
    }
  }

  _update() {
    if (this._state === 'INTRO' && performance.now() >= this._introUntil) {
      this._startQuestion();
      return;
    }

    if (this._state === 'CHOOSING') {
      const remainMs = Math.max(0, TIMER_MS - (performance.now() - this._countdownStart));
      const remainSec = Math.ceil(remainMs / 1000);

      if (!this._announced10 && remainMs <= 10000) {
        this._announced10 = true;
        this.audio?.speak(TEN_SECONDS_TEXT, { rate: 1.0 });
      }

      if (!this._announced5 && remainMs <= 5000) {
        this._announced5 = true;
        this.audio?.speak(FIVE_SECONDS_TEXT, { rate: 1.0 });
      }

      if (remainSec < 5 && remainSec > 0 && remainSec !== this._lastCountdownSecond) {
        this._lastCountdownSecond = remainSec;
        try {
          if (remainSec >= 4) this.audio?.playSFX('count3');
          else if (remainSec >= 2) this.audio?.playSFX('count2');
          else this.audio?.playSFX('count1');
        } catch (_) {}
      }
    }
  }

  _draw() {
    const c = this.ctx;
    if (!c) return;
    c.clearRect(0, 0, this.W, this.H);

    if (this._state === 'INTRO') {
      this._drawIntro();
      return;
    }
    if (this._state === 'READING') {
      this._drawReading();
      return;
    }
    if (this._state === 'CHOOSING') {
      this._drawChoosing();
      return;
    }
    if (this._state === 'RESULT') {
      this._drawResult();
    }
  }

  _drawIntro() {
    const c = this.ctx;
    c.fillStyle = 'rgba(6,10,30,0.72)';
    c.fillRect(0, 0, this.W, this.H);
    c.fillStyle = '#66ccff';
    c.shadowColor = '#55aaff';
    c.shadowBlur = 18;
    c.font = `bold ${this.H * 0.06 | 0}px monospace`;
    c.textAlign = 'center';
    c.fillText('QUIZ START', this.cx, this.H * 0.45);
    c.shadowBlur = 0;
    c.fillStyle = '#cde';
    c.font = `${this.H * 0.028 | 0}px monospace`;
    c.fillText('家族で答えを選んでください', this.cx, this.H * 0.55);
  }

  _drawReading() {
    const c = this.ctx;
    this._drawQuestionPanel('QUESTION', this._question?.question || '', '問題を読み上げ中...');
  }

  _drawChoosing() {
    const c = this.ctx;
    this._drawQuestionPanel('FAMILY QUIZ', this._question?.question || '', '20秒後に今の選択で判定します');

    const remain = Math.max(0, TIMER_MS - (performance.now() - this._countdownStart));
    c.fillStyle = '#ffdd66';
    c.font = `bold ${Math.max(28, this.H * 0.05) | 0}px monospace`;
    c.textAlign = 'center';
    c.fillText(`${Math.ceil(remain / 1000)}`, this.cx, this.H * 0.28);

    this._choiceRects = [];
    const cardW = Math.min(this.W * 0.88, 620);
    const cardH = Math.min(this.H * 0.11, 96);
    const gap = Math.min(16, this.H * 0.018);
    const startY = this.H * 0.36;

    for (let i = 0; i < this._question.choices.length; i++) {
      const x = (this.W - cardW) / 2;
      const y = startY + i * (cardH + gap);
      const isSelected = i === this._selectedIndex;
      this._choiceRects.push({ x, y, w: cardW, h: cardH });

      c.fillStyle = isSelected ? CHOICE_COLORS[i] : CHOICE_BG[i];
      this._rrFill(x, y, cardW, cardH, 18);
      c.strokeStyle = isSelected ? '#fff6c7' : CHOICE_COLORS[i];
      c.lineWidth = isSelected ? 3 : 2;
      this._rrFill(x, y, cardW, cardH, 18, true);

      c.fillStyle = isSelected ? '#04101f' : '#eef6ff';
      c.font = `bold ${Math.max(18, this.H * 0.024) | 0}px sans-serif`;
      c.textAlign = 'left';
      c.fillText(`${i + 1}.`, x + 18, y + cardH * 0.58);

      c.font = `bold ${Math.max(20, this.H * 0.03) | 0}px sans-serif`;
      this._wrapText(this._question.choices[i], x + 64, y + cardH * 0.56, cardW - 84, Math.max(24, this.H * 0.034));
    }
  }

  _drawQuestionPanel(label, question, subLabel) {
    const c = this.ctx;
    const bx = this.W * 0.05;
    const bw = this.W * 0.9;
    const by = this.H * 0.05;
    const bh = this.H * 0.2;
    c.fillStyle = 'rgba(4,8,30,0.78)';
    this._rrFill(bx, by, bw, bh, 18);
    c.strokeStyle = 'rgba(85,170,255,0.55)';
    c.lineWidth = 1.5;
    this._rrFill(bx, by, bw, bh, 18, true);

    c.fillStyle = '#66ccff';
    c.font = `${this.H * 0.02 | 0}px monospace`;
    c.textAlign = 'center';
    c.fillText(label, this.cx, by + this.H * 0.045);

    c.fillStyle = '#fff';
    c.font = `bold ${this.H * 0.033 | 0}px sans-serif`;
    this._wrapText(question, this.cx, by + this.H * 0.1, bw * 0.86, this.H * 0.045);

    c.fillStyle = '#b6d8f8';
    c.font = `${this.H * 0.02 | 0}px sans-serif`;
    c.fillText(subLabel, this.cx, by + bh - this.H * 0.03);
  }

  _drawResult() {
    this._btnList = [];
    const c = this.ctx;
    const isCorrect = this._result === 'correct';
    const explanation = isCorrect ? this._question?.correctMsg : this._question?.wrongMsg;

    if (!this._spokenResult) {
      this._spokenResult = true;
      this.audio?.speak(explanation || '', { rate: 0.9 });
    }

    c.fillStyle = 'rgba(4,4,20,0.84)';
    c.fillRect(0, 0, this.W, this.H);

    const col = isCorrect ? '#ffe566' : '#ff5566';
    const label = isCorrect ? 'せいかい' : 'ざんねん';
    const chosen = this._question?.choices?.[this._selectedIndex] || '未選択';
    const answer = this._question?.choices?.[this._question?.correctIndex] || '';

    c.fillStyle = col;
    c.shadowColor = col;
    c.shadowBlur = 30;
    c.font = `bold ${this.H * 0.08 | 0}px sans-serif`;
    c.textAlign = 'center';
    c.fillText(label, this.cx, this.H * 0.18);
    c.shadowBlur = 0;

    c.fillStyle = '#cfe8ff';
    c.font = `bold ${this.H * 0.028 | 0}px sans-serif`;
    c.fillText(`えらんだ答え: ${chosen}`, this.cx, this.H * 0.28);

    c.fillStyle = '#66ddff';
    c.font = `bold ${this.H * 0.034 | 0}px sans-serif`;
    c.fillText(`正解: ${answer}`, this.cx, this.H * 0.36);

    if (explanation) {
      c.fillStyle = 'rgba(255,255,255,0.08)';
      this._rrFill(this.W * 0.05, this.H * 0.42, this.W * 0.9, this.H * 0.22, 16);
      c.fillStyle = '#d9e4f0';
      c.font = `${this.H * 0.026 | 0}px sans-serif`;
      this._wrapText(explanation, this.cx, this.H * 0.49, this.W * 0.82, this.H * 0.04);
    }

    const bw = this.W * 0.38;
    const bh = this.H * 0.08;
    this._drawBtn('とじる', this.cx, this.H * 0.82, bw, bh, '#1a0a0a', '#ff6666', () => {
      if (this.onComplete) this.onComplete();
    });
  }

  _drawBtn(label, x, y, w, h, bg, fg, cb) {
    const c = this.ctx;
    c.fillStyle = bg;
    this._rrFill(x - w / 2, y - h / 2, w, h, h * 0.18);
    c.strokeStyle = fg;
    c.lineWidth = 2;
    this._rrFill(x - w / 2, y - h / 2, w, h, h * 0.18, true);
    c.fillStyle = fg;
    c.font = `bold ${h * 0.42 | 0}px sans-serif`;
    c.textAlign = 'center';
    c.fillText(label, x, y + h * 0.14);
    this._btnList.push({ x: x - w / 2, y: y - h / 2, w, h, cb });
  }

  _rrFill(x, y, w, h, r, stroke = false) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r);
    c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h);
    c.arcTo(x, y + h, x, y + h - r, r);
    c.lineTo(x, y + r);
    c.arcTo(x, y, x + r, y, r);
    c.closePath();
    if (stroke) c.stroke(); else c.fill();
  }

  _wrapText(text, x, y, maxW, lineH) {
    const c = this.ctx;
    const lines = [];
    let line = '';
    for (const ch of (text || '').split('')) {
      const test = line + ch;
      if (c.measureText(test).width > maxW && line !== '') {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    const startY = y - ((lines.length - 1) * lineH) / 2;
    lines.forEach((ln, index) => c.fillText(ln, x, startY + index * lineH));
  }

  _startLoop() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  _loop(ts) {
    this._rafId = requestAnimationFrame(this._boundLoop);
    this._updateThree(ts);
    this._update();
    this._draw();
  }
}
