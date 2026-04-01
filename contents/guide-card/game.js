// contents/guide-card/game.js  ガイドカード表示コンテンツ

/**
 * GuideCard — 導入・ガイド・予告カードを表示するコンテンツ
 *
 * event.contentData:
 *   title      string   カードタイトル
 *   body       string   本文テキスト
 *   footer?    string   補足テキスト（小さめ表示）
 *   countdown? boolean  閉じるボタン後にカウントダウン演出を出す
 *   icon?      string   絵文字アイコン（省略時はデフォルト）
 */
export class GuideCard {
  constructor(audioManager) {
    this.audio          = audioManager;
    this.container      = null;
    this._overlay       = null;
    this._data          = {};
    this._speaking      = false;
    this._exited        = false;
    this._countdownTimer = null;
    this.onComplete     = null;   // EventEngine / index.html がセット
  }

  // ── ContentBase interface ────────────────────────────────────────

  getUI() {
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position:fixed;inset:0;z-index:10;
      display:flex;align-items:center;justify-content:center;
      background:rgba(4,8,24,0.88);
      font-family:'Consolas','Courier New',monospace;
      touch-action:none;
    `;

    this._overlay = document.createElement('div');
    this._overlay.style.cssText = `
      width:min(90vw,480px);
      background:linear-gradient(160deg,#0d1a2e,#0a0e1a);
      border:1px solid #1e3a5a;
      border-radius:20px;
      padding:32px 28px 28px;
      box-shadow:0 0 40px rgba(50,120,255,0.15);
      position:relative;
      touch-action:auto;
    `;

    // Decorative top line
    const topLine = document.createElement('div');
    topLine.style.cssText = `
      position:absolute;top:0;left:20%;right:20%;height:2px;
      background:linear-gradient(90deg,transparent,#55aaff,transparent);
      border-radius:2px;
    `;
    this._overlay.appendChild(topLine);

    // Icon
    this._iconEl = document.createElement('div');
    this._iconEl.style.cssText = `
      font-size:40px;text-align:center;margin-bottom:16px;
      filter:drop-shadow(0 0 8px rgba(100,180,255,0.4));
    `;
    this._overlay.appendChild(this._iconEl);

    // Title
    this._titleEl = document.createElement('div');
    this._titleEl.style.cssText = `
      font-size:clamp(16px,4vw,22px);color:#88ccff;
      text-align:center;margin-bottom:18px;
      line-height:1.5;letter-spacing:1px;
      text-shadow:0 0 12px rgba(100,180,255,0.5);
    `;
    this._overlay.appendChild(this._titleEl);

    // Body
    this._bodyEl = document.createElement('div');
    this._bodyEl.style.cssText = `
      font-size:clamp(14px,3.5vw,17px);color:#cce;
      line-height:1.8;margin-bottom:16px;
      font-family:sans-serif;letter-spacing:0.5px;
    `;
    this._overlay.appendChild(this._bodyEl);

    // Footer
    this._footerEl = document.createElement('div');
    this._footerEl.style.cssText = `
      font-size:clamp(12px,3vw,14px);color:#6699aa;
      line-height:1.6;margin-bottom:20px;
      font-family:sans-serif;
      border-left:2px solid #334466;
      padding-left:10px;
    `;
    this._overlay.appendChild(this._footerEl);

    // Countdown area (for prelude)
    this._countdownEl = document.createElement('div');
    this._countdownEl.style.cssText = `
      text-align:center;font-size:48px;font-weight:bold;
      color:#ffcc44;text-shadow:0 0 24px rgba(255,200,50,0.8);
      margin-bottom:16px;display:none;
    `;
    this._overlay.appendChild(this._countdownEl);

    // Close button
    this._closeBtn = document.createElement('button');
    this._closeBtn.style.cssText = `
      width:100%;padding:16px;border-radius:10px;
      background:#0e2040;border:1px solid #3366aa;
      color:#88aaff;font-family:monospace;
      font-size:clamp(14px,3.5vw,17px);
      font-weight:bold;cursor:pointer;letter-spacing:2px;
      touch-action:manipulation;transition:background .15s;
    `;
    this._closeBtn.textContent = '✓  わかった';
    this._closeBtn.addEventListener('touchstart', () => this._closeBtn.style.background = '#1a3060', {passive:true});
    this._closeBtn.addEventListener('touchend',   () => this._closeBtn.style.background = '#0e2040', {passive:true});
    this._closeBtn.addEventListener('click', () => this._onClose());
    this._overlay.appendChild(this._closeBtn);

    this.container.appendChild(this._overlay);
    return this.container;
  }

  async onEnter(event) {
    const d = event.contentData || {};
    this._data   = d;
    this._exited = false;

    this._iconEl.textContent  = d.icon || (d.countdown ? '🌉' : '🗺️');
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

    // TTS読み上げ（body）
    const readText = [d.title, d.body, d.footer].filter(Boolean).join('。');
    this._speaking = true;
    try {
      await this.audio.speak(readText, { rate: 0.85 });
    } catch (_) {}
    this._speaking = false;
  }

  onExit() {
    this._exited = true;
    this._speaking = false;
    this.audio.stopSpeech();
    if (this._countdownTimer) { clearTimeout(this._countdownTimer); this._countdownTimer = null; }
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  _onClose() {
    this.audio.stopSpeech();
    if (this._data.countdown) {
      this._startCountdown();
    } else {
      this._complete();
    }
  }

  _startCountdown() {
    this._closeBtn.style.display = 'none';
    this._countdownEl.style.display = 'block';
    let count = 3;
    this._countdownEl.textContent = count;

    const tick = () => {
      if (this._exited) return;
      count--;
      if (count <= 0) {
        this._countdownEl.textContent = '🎵';
        this._countdownTimer = setTimeout(() => this._complete(), 400);
      } else {
        this._countdownEl.textContent = count;
        try { this.audio.playSFX(count === 2 ? 'count2' : 'count1'); } catch (_) {}
        this._countdownTimer = setTimeout(tick, 1000);
      }
    };

    try { this.audio.playSFX('count3'); } catch (_) {}
    this._countdownTimer = setTimeout(tick, 1000);
  }

  _complete() {
    if (this._exited) return;
    if (this.onComplete) this.onComplete();
  }
}
