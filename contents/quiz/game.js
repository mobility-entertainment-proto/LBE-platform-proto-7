// contents/quiz/game.js  家族向け4択クイズ（1問のみ）

/**
 * FamilyQuiz — 4択クイズを1問だけ表示するコンテンツ
 *
 * event.contentData:
 *   question     string    問題文
 *   choices      string[]  選択肢 [0..3]
 *   correctIndex number    正解の選択肢index
 *   correctMsg   string    正解時のメッセージ
 *   wrongMsg     string    不正解時のメッセージ
 */
export class FamilyQuiz {
  constructor(audioManager) {
    this.audio      = audioManager;
    this.container  = null;
    this._data      = {};
    this._answered  = false;
    this._exited    = false;
    this._resultTimer = null;
    this.onComplete = null;
  }

  // ── ContentBase interface ────────────────────────────────────────

  getUI() {
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position:fixed;inset:0;z-index:10;
      background:linear-gradient(180deg,#060e20 0%,#04080e 100%);
      display:flex;flex-direction:column;align-items:center;
      padding:24px 20px 32px;
      font-family:sans-serif;
      touch-action:auto;overflow-y:auto;
    `;

    // Header
    const hdr = document.createElement('div');
    hdr.style.cssText = `
      width:100%;max-width:540px;
      text-align:center;margin-bottom:24px;
    `;
    hdr.innerHTML = `
      <div style="font-size:11px;color:#445;letter-spacing:3px;
        font-family:monospace;margin-bottom:8px;">QUIZ</div>
      <div style="font-size:22px;color:#fff;font-weight:bold;
        text-shadow:0 0 16px rgba(100,200,255,0.4);">🧠 クイズ</div>
    `;
    this.container.appendChild(hdr);

    // Question box
    this._questionEl = document.createElement('div');
    this._questionEl.style.cssText = `
      width:100%;max-width:540px;
      background:#0d1a2e;border:1px solid #1e3a5a;border-radius:14px;
      padding:22px 20px;margin-bottom:28px;
      font-size:clamp(16px,4vw,20px);color:#ddeeff;
      line-height:1.7;text-align:center;
      box-shadow:0 0 24px rgba(50,120,255,0.1);
    `;
    this.container.appendChild(this._questionEl);

    // Choice buttons
    this._choicesBtnEl = document.createElement('div');
    this._choicesBtnEl.style.cssText = `
      width:100%;max-width:540px;
      display:grid;grid-template-columns:1fr 1fr;gap:12px;
      margin-bottom:24px;
    `;
    this.container.appendChild(this._choicesBtnEl);

    // Result area
    this._resultEl = document.createElement('div');
    this._resultEl.style.cssText = `
      width:100%;max-width:540px;
      background:#0d1a2e;border-radius:14px;padding:20px;
      display:none;margin-bottom:20px;
      font-size:clamp(14px,3.5vw,17px);line-height:1.7;
      text-align:left;
    `;
    this.container.appendChild(this._resultEl);

    // Next button
    this._nextBtn = document.createElement('button');
    this._nextBtn.style.cssText = `
      width:100%;max-width:540px;padding:16px;border-radius:10px;
      background:#0e2040;border:1px solid #3366aa;
      color:#88aaff;font-family:monospace;
      font-size:clamp(14px,3.5vw,17px);font-weight:bold;
      cursor:pointer;letter-spacing:2px;display:none;
      touch-action:manipulation;
    `;
    this._nextBtn.textContent = '✓  つぎへ';
    this._nextBtn.addEventListener('click', () => this._complete());
    this.container.appendChild(this._nextBtn);

    return this.container;
  }

  async onEnter(event) {
    const d = event.contentData || {};
    this._data     = d;
    this._answered = false;
    this._exited   = false;

    this._resultEl.style.display = 'none';
    this._nextBtn.style.display  = 'none';
    this._choicesBtnEl.style.display = 'grid';

    // Render question
    this._questionEl.textContent = d.question || '';

    // Render choice buttons
    this._choicesBtnEl.innerHTML = '';
    const COLORS = ['#ff7043','#26c6da','#66bb6a','#ab47bc'];
    const DARK   = ['#3a0a00','#003040','#0a3010','#200030'];

    (d.choices || []).forEach((choice, i) => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        padding:clamp(18px,5vw,28px) 12px;
        border-radius:12px;
        border:2px solid ${COLORS[i]};
        background:${DARK[i]};
        color:${COLORS[i]};
        font-size:clamp(16px,4.5vw,22px);
        font-weight:bold;cursor:pointer;
        line-height:1.3;text-align:center;
        touch-action:manipulation;
        transition:opacity .2s,transform .1s;
        width:100%;
      `;
      btn.textContent = choice;
      btn.addEventListener('click', () => this._onAnswer(i));
      btn.addEventListener('touchstart', () => btn.style.opacity = '0.7', {passive:true});
      btn.addEventListener('touchend',   () => btn.style.opacity = '1',   {passive:true});
      this._choicesBtnEl.appendChild(btn);
    });

    // TTS: read question
    try {
      await this.audio.speak(d.question || '', { rate: 0.85 });
    } catch (_) {}
  }

  onExit() {
    this._exited = true;
    this.audio.stopSpeech();
    this._answered = false;
    if (this._resultTimer) { clearTimeout(this._resultTimer); this._resultTimer = null; }
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  _onAnswer(selectedIndex) {
    if (this._answered) return;
    this._answered = true;

    const d = this._data;
    const correct = selectedIndex === d.correctIndex;

    // Play SE
    try { this.audio.playSFX(correct ? 'pinpon' : 'bubuu'); } catch (_) {}

    // Dim non-selected buttons
    const btns = this._choicesBtnEl.querySelectorAll('button');
    btns.forEach((btn, i) => {
      if (i !== selectedIndex) btn.style.opacity = '0.25';
    });
    if (btns[selectedIndex]) {
      btns[selectedIndex].style.transform = 'scale(1.05)';
      btns[selectedIndex].style.boxShadow = correct
        ? '0 0 16px rgba(100,255,100,0.6)'
        : '0 0 16px rgba(255,80,80,0.6)';
    }

    // Show result
    const resultMsg = correct ? d.correctMsg : d.wrongMsg;
    this._resultEl.style.display = 'block';
    this._resultEl.innerHTML = `
      <div style="font-size:24px;margin-bottom:12px;text-align:center;">
        ${correct ? '⭕️ 正解！' : '❌ 不正解'}
      </div>
      <div style="font-size:clamp(14px,3.5vw,16px);color:#cce;line-height:1.8;">
        ${resultMsg || ''}
      </div>
    `;

    // TTS: read result after brief pause
    this._resultTimer = setTimeout(async () => {
      if (this._exited) return;
      try { await this.audio.speak(resultMsg || '', { rate: 0.88 }); } catch (_) {}
      if (!this._exited) this._nextBtn.style.display = 'block';
    }, 500);
  }

  _complete() {
    if (this._exited) return;
    if (this.onComplete) this.onComplete();
  }
}
