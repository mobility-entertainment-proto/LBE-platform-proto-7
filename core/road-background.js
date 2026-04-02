export class RoadBackground {
  constructor({ speed = 8 } = {}) {
    this.speed = speed;
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.buildings = [];
    this.rafId = null;
    this.lastTs = 0;
    this.boundLoop = this.loop.bind(this);
    this.boundResize = this.resize.bind(this);
    this.ROAD_W = 8;
    this.ROAD_LEN = 200;
    this.BLDG_N = 14;
  }

  attach(canvas) {
    this.canvas = canvas;
    this.initThree();
    window.addEventListener('resize', this.boundResize);
    this.resize();
  }

  start() {
    if (!this.renderer || this.rafId) return;
    this.rafId = requestAnimationFrame(this.boundLoop);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('resize', this.boundResize);
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  initThree() {
    const THREE = window.THREE;
    if (!THREE || !this.canvas) return;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'low-power',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x87ceeb);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87ceeb, 80, 280);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
    this.camera.position.set(0, 2.8, 0);
    this.camera.lookAt(0, -38, -91);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(5, 20, 4);
    this.scene.add(dirLight);
    const fill = new THREE.DirectionalLight(0xaaddff, 0.5);
    fill.position.set(-4, 8, -6);
    this.scene.add(fill);

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

    for (const [x, type] of [[-4, 'solid'], [-2, 'dash'], [0, 'dash'], [2, 'dash'], [4, 'solid']]) {
      const m = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        opacity: type === 'solid' ? 0.95 : 0.7,
        transparent: true,
      });
      const g = new THREE.Mesh(
        new THREE.PlaneGeometry(type === 'solid' ? 0.12 : 0.08, this.ROAD_LEN),
        m
      );
      g.rotation.x = -Math.PI / 2;
      g.position.set(x, 0.01, -this.ROAD_LEN / 2);
      this.scene.add(g);
    }

    const palette = [
      0xcc3333, 0xdd9922, 0x3366cc, 0x33aa55, 0xcc44aa,
      0x22aacc, 0x9944cc, 0xddcc22, 0xee6633, 0x44bbcc,
      0xcc8833, 0x5588dd, 0x55bb44, 0xdd4466, 0x22bbaa,
    ];

    this.buildings = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < this.BLDG_N; i++) {
        const w = 3 + Math.random() * 5;
        const h = 6 + Math.random() * 22;
        const d = 4 + Math.random() * 5;
        const mat = new THREE.MeshLambertMaterial({
          color: palette[Math.floor(Math.random() * palette.length)],
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(
          side * (this.ROAD_W / 2 + 1.5 + Math.random() * 7),
          h / 2,
          -(i / this.BLDG_N) * this.ROAD_LEN
        );
        this.scene.add(mesh);
        this.buildings.push(mesh);
      }
    }
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  loop(ts) {
    this.rafId = requestAnimationFrame(this.boundLoop);
    if (!this.renderer) return;

    const dt = Math.min((ts - this.lastTs) / 1000, 0.05);
    this.lastTs = ts;
    const move = this.speed * dt;

    for (const mesh of this.buildings) {
      mesh.position.z += move;
      if (mesh.position.z > 5) {
        mesh.position.z -= this.ROAD_LEN - 3.18;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
