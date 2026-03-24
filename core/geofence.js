// core/geofence.js  ジオフェンスエンジン

import { LocationManager } from './location.js';

export class GeofenceEngine {
  constructor(locations, contentRegistry) {
    this.locations = locations;
    this.contentRegistry = contentRegistry;
    this.locationManager = new LocationManager();
    this.activeLocationId = null;
    this.debugMode = false;
    this.onStatusUpdate = null;
  }

  start(onStatusUpdate) {
    this.onStatusUpdate = onStatusUpdate;
    this.locationManager.start(
      pos => this._onGpsUpdate(pos),
      err => this._notify({ msg: `GPS エラー: ${err}`, dist: Infinity, nearestLoc: null, nextLoc: null, nextDist: Infinity })
    );
  }

  stop() {
    this.locationManager.stop();
  }

  // デバッグ: 任意のlocation_idを強制起動
  debugForce(locationId) {
    this.debugMode = true;
    const loc = this.locations.find(l => l.id === locationId);
    if (!loc) return;
    if (this.activeLocationId && this.activeLocationId !== locationId) {
      this._exit(this.locations.find(l => l.id === this.activeLocationId));
    }
    this._enter(loc);
  }

  debugExit() {
    this.debugMode = false;
    if (!this.activeLocationId) return;
    const loc = this.locations.find(l => l.id === this.activeLocationId);
    if (loc) this._exit(loc);
  }

  _onGpsUpdate(pos) {
    const { latitude: lat, longitude: lng } = pos.coords;

    // 全ロケーションの距離を計算
    const withDists = this.locations.map(loc => {
      const rawDist = LocationManager.haversine(lat, lng, loc.lat, loc.lng);
      const edgeDist = Math.max(0, rawDist - loc.radius);
      const inside = rawDist <= loc.radius;
      return { loc, rawDist, edgeDist, inside };
    });

    if (!this.debugMode) {
      // 現在地点で内側にあるロケーションを半径昇順でソートし、最小半径を優先
      const insideLocs = withDists
        .filter(d => d.inside)
        .sort((a, b) => a.loc.radius - b.loc.radius);

      const targetId = insideLocs.length > 0 ? insideLocs[0].loc.id : null;

      if (targetId !== this.activeLocationId) {
        if (this.activeLocationId) {
          this._exit(this.locations.find(l => l.id === this.activeLocationId));
        }
        if (targetId) {
          this._enter(this.locations.find(l => l.id === targetId));
        }
      }
    }

    // ── ステータス表示の計算 ──────────────────────────────────────
    const activeLoc = this.activeLocationId
      ? this.locations.find(l => l.id === this.activeLocationId)
      : null;

    let nearestLoc = null, nearestDist = Infinity;
    let nextLoc = null, nextDist = Infinity;

    if (activeLoc) {
      // コンテンツ発動中：自分より小さい半径の次ロケーションを案内
      const nextTarget = withDists
        .filter(d => d.loc.radius < activeLoc.radius && !d.inside)
        .sort((a, b) => a.loc.radius - b.loc.radius)[0];
      if (nextTarget) {
        nextLoc  = nextTarget.loc;
        nextDist = nextTarget.edgeDist;
      }
      nearestLoc  = activeLoc;
      nearestDist = 0;
    } else {
      // 待機中：最も近いロケーションを案内
      for (const d of withDists) {
        if (d.edgeDist < nearestDist) {
          nearestDist = d.edgeDist;
          nearestLoc  = d.loc;
        }
      }
    }

    const prefix = this.debugMode ? '[DEBUG] ' : '';
    let msg;
    if (activeLoc) {
      msg = nextLoc
        ? `${activeLoc.name} 発動中 / 次: ${nextLoc.name} まで ${nextDist.toFixed(0)}m`
        : `${activeLoc.name} 発動中`;
    } else {
      msg = nearestLoc
        ? (nearestDist < 1 ? `${nearestLoc.name} 内` : `${nearestLoc.name} まで ${nearestDist.toFixed(0)}m`)
        : '位置情報を取得中...';
    }

    this._notify({ msg: prefix + msg, dist: nearestDist, nearestLoc, nextLoc, nextDist });
  }

  _enter(loc) {
    this.activeLocationId = loc.id;
    const content = this.contentRegistry[loc.content];
    if (content) content.onEnter(loc);
  }

  _exit(loc) {
    if (!loc) return;
    const content = this.contentRegistry[loc.content];
    if (content) content.onExit(loc);
    if (this.activeLocationId === loc.id) this.activeLocationId = null;
  }

  _notify(data) {
    if (this.onStatusUpdate) this.onStatusUpdate(data);
  }
}
