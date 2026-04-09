// contents/guide-card/game.js
// ガイドカード（proto-3の高速道路3D背景 + テキストオーバーレイ）

export class GuideCard {
  constructor(audioManager) {
    this.audio          = audioManager;
    this.container      = null;
    this.threeCanvas    = null;
    // Three.js
    this.renderer  = null; this.scene = null; this.camera = null;
    this.ambLight  = null; this.dirLight = null; this.buildings = [];
    this.threeLastT = 0;
    // Consts
    this.ROAD_W = 8; this.ROAD_LEN = 200; this.BLDG_N = 14;
    this.W = 0; this.H = 0;
    // State
    this._data         = {};
    this._exited       = false;
    this._completed    = false;
    this._countdownTimer = null;
    this._autoCloseTimer = null;
    this._rafId        = null;
    this._boundLoop    = this._loop.bind(this);
    this._boundResize  = this._onResize.bind(this);
    this.onComplete    = null;
  }

  // ── ContentBase interface ─────────────────────────────────────

  getUI() {
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:fixed;inset:0;z-index:10;overflow:hidden;touch-action:none;';

    // Three.js canvas（背景）
    this.threeCanvas = document.createElement('canvas');
    this.threeCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;';
    this.container.appendChild(this.threeCanvas);

    // Dark overlay for readability
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;z-index:1;background:rgba(4,8,24,0.52);';
    this.container.appendChild(overlay);

    // Card content (HTML overlay on top of 3D)
    this._card = document.createElement('div');
    this._card.style.cssText = `
      position:absolute;z-index:2;
      top:50%;left:50%;transform:translate(-50%,-50%);
      width:min(88vw,500px);
      background:rgba(6,12,32,0.85);
      border:1px solid rgba(85,170,255,0.4);
      border-radius:16px;padding:28px 24px 24px;
      box-shadow:0 0 32px rgba(50,120,255,0.18);
      touch-action:auto;
    `;

    // Decorative top accent
    const accent = document.createElement('div');
    accent.style.cssText = `
      position:absolute;top:0;left:15%;right:15%;height:2px;
      background:linear-gradient(90deg,transparent,#55aaff,transparent);
      border-radius:2px;
    `;
    this._card.appendChild(accent);

    this._iconEl = document.createElement('div');
    this._iconEl.style.cssText = 'font-size:36px;text-align:center;margin-bottom:12px;';
    this._card.appendChild(this._iconEl);

    this._titleEl = document.createElement('div');
    this._titleEl.style.cssText = `
      font-size:clamp(15px,3.8vw,20px);color:#88ccff;text-align:center;
      margin-bottom:14px;line-height:1.5;letter-spacing:1px;
      text-shadow:0 0 12px rgba(100,180,255,0.5);
      font-family:'Consolas','Courier New',monospace;
    `;
    this._card.appendChild(this._titleEl);

    this._bodyEl = document.createElement('div');
    this._bodyEl.style.cssText = `
      font-size:clamp(14px,3.2vw,17px);color:#cce;line-height:1.8;
      margin-bottom:14px;font-family:sans-serif;letter-spacing:0.5px;
    `;
    this._card.appendChild(this._bodyEl);

    this._footerEl = document.createElement('div');
    this._footerEl.style.cssText = `
      font-size:clamp(12px,2.8vw,14px);color:#6699aa;line-height:1.6;
      margin-bottom:18px;font-family:sans-serif;
      border-left:2px solid #334466;padding-left:10px;display:none;
    `;
    this._card.appendChild(this._footerEl);

    this._countdownEl = document.createElement('div');
    this._countdownEl.style.cssText = `
      text-align:center;font-size:52px;font-weight:bold;
      color:#ffcc44;text-shadow:0 0 24px rgba(255,200,50,0.8);
      margin-bottom:14px;display:none;
      font-family:'Consolas','Courier New',monospace;
    `;
    this._card.appendChild(this._countdownEl);

    this._closeBtn = document.createElement('button');
    this._closeBtn.style.cssText = `
      width:100%;padding:14px;border-radius:10px;
      background:#0e2040;border:1px solid #3366aa;color:#88aaff;
      font-family:monospace;font-size:clamp(14px,3.2vw,17px);
      font-weight:bold;cursor:pointer;letter-spacing:2px;
      touch-action:manipulation;
    `;
    this._closeBtn.textContent = 'わかった';
    this._closeBtn.addEventListener('click', () => this._onClose());
    this._card.appendChild(this._closeBtn);

    this.container.appendChild(this._card);

    this._layout();
    this._initThree();
    window.addEventListener('resize', this._boundResize);
    return this.container;
  }

  async onEnter(event) {
    const d = event.contentData || {};
    this._data   = d;
    this._exited = false;
    this._completed = false;
    if (this._autoCloseTimer) { clearTimeout(this._autoCloseTimer); this._autoCloseTimer = null; }

    this._iconEl.textContent  = d.icon  || (d.countdown ? '🌉' : '🗺️');
    this._titleEl.textContent = d.title || '';
    this._bodyEl.textContent  = d.body  || '';

    if (d.footer) {
      this._footerEl.textContent = d.footer;
      this._footerEl.style.display = '';
    } else {
      this._footerEl.style.display = 'none';
    }

    this._countdownEl.style.display = 'none';
    this._closeBtn.style.display    = 'block';
    this._closeBtn.disabled         = false;

    // Start 3D loop
    if (!this._rafId) this._rafId = requestAnimationFrame(this._boundLoop);

    // TTS読み上げ
    const readText = [d.title, d.body, d.footer].filter(Boolean).join('。');
    try { await this.audio.speak(readText, { rate: 0.85, audioSrc: d.audioSrc }); } catch (_) {}
    if (this._exited) return;
    this._autoCloseTimer = setTimeout(() => this._complete(), 5000);
  }

  onExit() {
    this._exited = true;
    this.audio.stopSpeech();
    if (this._countdownTimer) { clearTimeout(this._countdownTimer); this._countdownTimer = null; }
    if (this._autoCloseTimer) { clearTimeout(this._autoCloseTimer); this._autoCloseTimer = null; }
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    window.removeEventListener('resize', this._boundResize);
  }

  // ── Three.js ─────────────────────────────────────────────────

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

    this.ambLight = new THREE.AmbientLight(0xffffff, 1.2);   this.scene.add(this.ambLight);
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.8); this.dirLight.position.set(5, 20, 4); this.scene.add(this.dirLight);
    const fill = new THREE.DirectionalLight(0xaaddff, 0.5);  fill.position.set(-4, 8, -6);   this.scene.add(fill);

    // 道路
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x484848 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(this.ROAD_W, this.ROAD_LEN), roadMat);
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -this.ROAD_LEN / 2); this.scene.add(road);
    // 歩道
    for (const side of [-1, 1]) {
      const m = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
      const g = new THREE.Mesh(new THREE.PlaneGeometry(5, this.ROAD_LEN), m);
      g.rotation.x = -Math.PI / 2; g.position.set(side * (this.ROAD_W / 2 + 2.5), -0.01, -this.ROAD_LEN / 2); this.scene.add(g);
    }
    // 白線
    [[-4,'solid'],[-2,'dash'],[0,'dash'],[2,'dash'],[4,'solid']].forEach(([x, type]) => {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: type==='solid'?0.95:0.7, transparent:true });
      const g = new THREE.Mesh(new THREE.PlaneGeometry(type==='solid'?0.12:0.08, this.ROAD_LEN), m);
      g.rotation.x = -Math.PI / 2; g.position.set(x, 0.01, -this.ROAD_LEN / 2); this.scene.add(g);
    });
    // ビル
    const bPalette = [0xcc3333,0xdd9922,0x3366cc,0x33aa55,0xcc44aa,0x22aacc,0x9944cc,0xddcc22,0xee6633,0x44bbcc,0xcc8833,0x5588dd,0x55bb44,0xdd4466,0x22bbaa];
    this.buildings = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < this.BLDG_N; i++) {
        const w = 3+Math.random()*5, h = 6+Math.random()*22, d = 4+Math.random()*5;
        const mat = new THREE.MeshLambertMaterial({ color: bPalette[Math.floor(Math.random()*bPalette.length)] });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(side*(this.ROAD_W/2+1.5+Math.random()*7), h/2, -(i/this.BLDG_N)*this.ROAD_LEN);
        this.scene.add(mesh); this.buildings.push(mesh);
      }
    }
  }

  _layout() {
    this.W = window.innerWidth; this.H = window.innerHeight;
    if (this.renderer) this.renderer.setSize(this.W, this.H);
    if (this.camera) { this.camera.aspect = this.W / this.H; this.camera.updateProjectionMatrix(); }
  }

  _onResize() { this._layout(); }

  _loop(ts) {
    this._rafId = requestAnimationFrame(this._boundLoop);
    if (!this.renderer || !window.THREE) return;
    const dt = Math.min((ts - this.threeLastT) / 1000, 0.05);
    this.threeLastT = ts;
    // ゆっくりスクロール（ガイド表示中は低速）
    const speed = 12;
    const move = speed * dt;
    const Z_NEAR = 3.18;
    for (const mesh of this.buildings) {
      mesh.position.z += move;
      if (mesh.position.z > 5) mesh.position.z -= (this.ROAD_LEN - Z_NEAR);
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ── Card actions ──────────────────────────────────────────────

  _onClose() {
    if (this._completed) return;
    this._closeBtn.disabled = true;
    if (this._autoCloseTimer) { clearTimeout(this._autoCloseTimer); this._autoCloseTimer = null; }
    this.audio.stopSpeech();
    this._complete();
  }

  _complete() {
    if (this._exited || this._completed) return;
    this._completed = true;
    if (this.onComplete) this.onComplete();
  }
}
