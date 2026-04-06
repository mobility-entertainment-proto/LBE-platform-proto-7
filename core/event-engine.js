// core/event-engine.js  順序付きイベントステートマシン

import { LocationManager } from './location.js';

/**
 * EventEngine — 5イベントを順番に1回だけ発火するステートマシン
 *
 * events: Array of {
 *   id, name, lat, lng, radius,
 *   contentType, contentData
 * }
 *
 * コールバック:
 *   onEventFire(event)     — イベント発火時
 *   onEventExit(event)     — イベント終了（自発的 or debugExit）
 *   onStatusUpdate(data)   — GPS更新ごと
 */
export class EventEngine {
  constructor(events) {
    this.events = events;
    this.locationManager = new LocationManager();

    this.currentIndex    = 0;   // 次に発火待ちのイベントindex
    this.activeIndex     = -1;  // 現在発火中のイベントindex（-1=なし）
    this._debugMode      = false;
    this._currentLat     = null;
    this._currentLng     = null;
    this._firedLog       = [];  // 発火ログ [{id,name,time}]

    this.onEventFire     = null;
    this.onEventExit     = null;
    this.onStatusUpdate  = null;
  }

  // ── 公開API ─────────────────────────────────────────────────────

  start(onStatusUpdate) {
    this.onStatusUpdate = onStatusUpdate;
    this.currentIndex = 0;
    this.activeIndex = -1;
    this._debugMode = false;
    this._currentLat = null;
    this._currentLng = null;
    this._notifyStatus();
    this.locationManager.start(
      pos => this._onGpsUpdate(pos),
      err => this._notify({ msg: `GPS エラー: ${err}` })
    );
  }

  stop() {
    this.locationManager.stop();
  }

  /** コンテンツ側から「完了」を通知 → 次イベントへ進む */
  markComplete() {
    const prev = this.activeIndex;
    this.activeIndex = -1;
    this.currentIndex = prev + 1;
    if (prev >= 0 && this.onEventExit) this.onEventExit(this.events[prev]);
    this._notifyStatus();
  }

  /** デバッグ: 任意のイベントを強制発火 */
  debugForce(eventId) {
    const idx = this.events.findIndex(e => e.id === eventId);
    if (idx < 0) return;
    this._debugMode = true;

    // 既存アクティブがあれば終了
    if (this.activeIndex >= 0) {
      const prev = this.activeIndex;
      this.activeIndex = -1;
      if (this.onEventExit) this.onEventExit(this.events[prev]);
    }

    this.currentIndex = idx;
    this._fireEvent(idx);
  }

  /** デバッグ: 現在のイベントを強制終了（状態は維持） */
  debugExit() {
    this._debugMode = false;
    if (this.activeIndex < 0) return;
    const prev = this.activeIndex;
    this.activeIndex = -1;
    if (this.onEventExit) this.onEventExit(this.events[prev]);
    this._notifyStatus();
  }

  /** 発火ログ取得 */
  getFiredLog() { return [...this._firedLog]; }

  /** 各イベントの状態 (fired/active/waiting) */
  getEventStates() {
    return this.events.map((e, i) => ({
      ...e,
      status: i < this.currentIndex
        ? (i === this.activeIndex ? 'active' : 'fired')
        : i === this.currentIndex
          ? (i === this.activeIndex ? 'active' : 'waiting')
          : 'pending',
    }));
  }

  // ── 内部 ────────────────────────────────────────────────────────

  _onGpsUpdate(pos) {
    this._currentLat = pos.coords.latitude;
    this._currentLng = pos.coords.longitude;

    if (!this._debugMode && this.activeIndex < 0) {
      const next = this.events[this.currentIndex];
      if (next) {
        const dist = LocationManager.haversine(
          this._currentLat, this._currentLng, next.lat, next.lng
        );
        const edge = Math.max(0, dist - next.radius);
        if (dist <= next.radius) {
          this._fireEvent(this.currentIndex);
        }
      }
    }

    this._notifyStatus();
  }

  _fireEvent(index) {
    this.activeIndex = index;
    const ev = this.events[index];
    this._firedLog.push({ id: ev.id, name: ev.name, time: new Date().toLocaleTimeString('ja-JP') });
    if (this.onEventFire) this.onEventFire(ev);
  }

  _notifyStatus() {
    if (!this.onStatusUpdate) return;

    const lat = this._currentLat;
    const lng = this._currentLng;

    let msg = '';
    let distToNext = Infinity;
    let nextEvent = null;

    if (this.activeIndex >= 0) {
      const ev = this.events[this.activeIndex];
      msg = `[発動中] ${ev.name}`;
    } else if (this.currentIndex < this.events.length) {
      nextEvent = this.events[this.currentIndex];
      if (lat !== null && lng !== null) {
        const dist = LocationManager.haversine(lat, lng, nextEvent.lat, nextEvent.lng);
        distToNext = Math.max(0, dist - nextEvent.radius);
        msg = distToNext < 1
          ? `${nextEvent.name} エリア内`
          : `次: ${nextEvent.name} まで ${distToNext.toFixed(0)}m`;
      } else {
        msg = `次: ${nextEvent.name} / GPS取得中...`;
      }
    } else {
      msg = '全イベント完了';
    }

    const prefix = this._debugMode ? '[DEBUG] ' : '';
    this.onStatusUpdate({
      msg: prefix + msg,
      lat, lng,
      distToNext,
      nextEvent,
      activeIndex: this.activeIndex,
      currentIndex: this.currentIndex,
      totalEvents: this.events.length,
    });
  }

  _notify(data) {
    if (this.onStatusUpdate) this.onStatusUpdate(data);
  }
}
