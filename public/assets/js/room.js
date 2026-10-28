/* A plot's room: a small cut-away 3D diorama that the owner decorates and anyone can visit.
   window.Room.create(canvas, { editable, layout, onChange, onSelect }) -> api
   Layout: { v:1, wall, floor, glow, items: [[type, x, z, r], ...] } on an 8×8 grid (see docs/ARCHITECTURE.md). */
(function () {
  "use strict";
  var THREE = window.THREE;
  var N = 8, WALL_H = 4.6;

  /* ---------- catalogue: footprint at r=0 (w along x, d along z) ---------- */
  var CATALOG = {
    tree: { w: 1, d: 1 }, tree_small: { w: 1, d: 1 }, sofa: { w: 2, d: 1 }, armchair: { w: 1, d: 1 },
    table: { w: 2, d: 1 }, tv: { w: 2, d: 1 }, fireplace: { w: 2, d: 1 }, gifts: { w: 1, d: 1 },
    rug: { w: 3, d: 2, flat: true }, lamp: { w: 1, d: 1 }, shelf: { w: 2, d: 1 }, plant: { w: 1, d: 1 },
    piano: { w: 2, d: 1 }, snowman: { w: 1, d: 1 }, cat: { w: 1, d: 1 }, dog: { w: 1, d: 1 },
    candles: { w: 1, d: 1 }, pomegranates: { w: 1, d: 1 }, radio: { w: 1, d: 1 }, clock: { w: 1, d: 1 }
  };
  var ORDER = ["tree", "fireplace", "sofa", "armchair", "table", "tv", "gifts", "rug", "lamp", "shelf", "piano", "plant",
    "tree_small", "candles", "pomegranates", "radio", "clock", "snowman", "cat", "dog"];
  var WALLS = { cream: ["#d9c7a6", "#cdb894"], sage: ["#8aa38c", "#7d957f"], night: ["#2b375a", "#232d48"], berry: ["#7e3340", "#6f2c36"] };
  var FLOORS = ["oak", "walnut", "tile"];
  var DEFAULT = { v: 1, wall: "cream", floor: "oak", glow: true, items: [
    ["rug", 2, 3, 0], ["tree", 0, 0, 0], ["fireplace", 3, 0, 0], ["sofa", 3, 5, 2], ["armchair", 6, 3, 3],
    ["gifts", 1, 0, 0], ["table", 3, 3, 0], ["lamp", 0, 6, 0], ["cat", 5, 1, 0]
  ] };

  /* ---------- templates (starting points) and seeded random rooms ---------- */
  var TEMPLATES = {
    empty: { v: 1, wall: "cream", floor: "oak", glow: true, items: [] },
    cozy: DEFAULT,
    party: { v: 1, wall: "berry", floor: "tile", glow: true, items: [
      ["rug", 2, 3, 0], ["tv", 3, 0, 0], ["sofa", 3, 5, 2], ["armchair", 1, 3, 1], ["armchair", 6, 3, 3], ["table", 3, 3, 0],
      ["gifts", 0, 0, 0], ["gifts", 6, 0, 0], ["tree_small", 7, 0, 0], ["tree_small", 0, 7, 0], ["candles", 7, 7, 0],
      ["radio", 5, 0, 0], ["dog", 5, 6, 0], ["pomegranates", 1, 1, 0]] },
    classic: { v: 1, wall: "sage", floor: "walnut", glow: true, items: [
      ["rug", 2, 2, 0], ["fireplace", 3, 0, 0], ["tree", 0, 0, 0], ["lamp", 1, 0, 0], ["piano", 0, 4, 1], ["clock", 7, 0, 0],
      ["shelf", 7, 3, 3], ["armchair", 2, 3, 1], ["armchair", 5, 3, 3], ["table", 3, 4, 0], ["plant", 6, 0, 0],
      ["candles", 5, 0, 0], ["cat", 3, 2, 0], ["snowman", 7, 7, 0]] }
  };
  function cellsOf(it) { var f = fp(it[0], it[3]), out = []; for (var x = 0; x < f.w; x++) for (var z = 0; z < f.d; z++) out.push((it[1] + x) + "," + (it[2] + z)); return out; }
  function fitsIn(items, it, ignore) {
    var f = fp(it[0], it[3]);
    if (it[1] < 0 || it[2] < 0 || it[1] + f.w > N || it[2] + f.d > N) return false;
    if (CATALOG[it[0]].flat) return true;
    var mine = cellsOf(it);
    return items.every(function (o, i) {
      if (i === ignore || CATALOG[o[0]].flat) return true;
      var theirs = cellsOf(o); return !mine.some(function (c) { return theirs.indexOf(c) >= 0; });
    });
  }
  // A different room for every plot whose owner hasn't decorated it yet.
  function randomRoom(seed) {
    var r = rnd((seed | 0) * 7919 + 13), names = ["cozy", "party", "classic", "cozy", "classic"];
    var base = TEMPLATES[names[(r() * names.length) | 0]], walls = Object.keys(WALLS);
    var l = { v: 1, wall: r() < 0.6 ? walls[(r() * walls.length) | 0] : base.wall, floor: r() < 0.5 ? FLOORS[(r() * FLOORS.length) | 0] : base.floor, glow: r() < 0.85, items: base.items.map(function (x) { return x.slice(); }) };
    var drop = (r() * 5) | 0;
    for (var d = 0; d < drop && l.items.length > 3; d++) { var k = 1 + ((r() * (l.items.length - 1)) | 0); if (l.items[k][0] !== "rug") l.items.splice(k, 1); }
    var extras = ["cat", "dog", "snowman", "plant", "candles", "gifts", "radio", "pomegranates", "tree_small", "lamp", "clock", "armchair"], add = 1 + ((r() * 5) | 0);
    for (var a = 0; a < add; a++) {
      var type = extras[(r() * extras.length) | 0];
      for (var tries = 0; tries < 30; tries++) { var it = [type, (r() * N) | 0, (r() * N) | 0, (r() * 4) | 0]; if (fitsIn(l.items, it, -1)) { l.items.push(it); break; } }
    }
    return l;
  }

  /* ---------- tiny synth for the things in the room ---------- */
  var Snd = (function () {
    var ac = null, muted = false;
    function ctx() {
      if (muted) return null;
      if (!ac) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; try { ac = new C(); } catch (e) { return null; } }
      if (ac.state === "suspended") ac.resume();
      return ac;
    }
    function tone(f, d, type, vol, delay, to) {
      var c = ctx(); if (!c) return;
      var t = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
      o.type = type || "sine"; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + 0.05);
    }
    function noise(d, vol, freq, delay) {
      var c = ctx(); if (!c) return;
      var t = c.currentTime + (delay || 0), n = Math.max(1, Math.floor(c.sampleRate * d)), b = c.createBuffer(1, n, c.sampleRate), a = b.getChannelData(0);
      for (var i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = b; f.type = "bandpass"; f.frequency.value = freq || 1200; g.gain.value = vol || 0.2;
      src.connect(f); f.connect(g); g.connect(c.destination); src.start(t);
    }
    return { tone: tone, noise: noise, mute: function (v) { muted = !!v; }, muted: function () { return muted; } };
  })();
  var PIANO = [523, 587, 659, 523, 659, 784, 698, 659, 587, 523, 392, 523];
  var RADIO = [392, 523, 587, 659, 587, 523, 659, 784];

  function fp(type, r) { var c = CATALOG[type]; return r % 2 ? { w: c.d, d: c.w } : { w: c.w, d: c.d }; }
  function valid(layout) {
    if (!layout || typeof layout !== "object" || !Array.isArray(layout.items)) return false;
    return layout.items.every(function (it) { return Array.isArray(it) && CATALOG[it[0]]; });
  }

  /* ---------- small helpers ---------- */
  function mat(color, o) { return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.8, metalness: 0 }, o || {})); }
  function glowMat(color) { return new THREE.MeshBasicMaterial({ color: color, toneMapped: false }); }
  function box(w, h, d, m, x, y, z) { var g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.position.set(x || 0, (y || 0) + h / 2, z || 0); g.castShadow = g.receiveShadow = true; return g; }
  function cyl(rt, rb, h, m, x, y, z, seg) { var g = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 18), m); g.position.set(x || 0, (y || 0) + h / 2, z || 0); g.castShadow = g.receiveShadow = true; return g; }
  function sph(r, m, x, y, z, seg) { var g = new THREE.Mesh(new THREE.SphereGeometry(r, seg || 16, seg ? Math.max(6, seg - 4) : 12), m); g.position.set(x || 0, y || 0, z || 0); g.castShadow = true; return g; }
  function cone(r, h, m, x, y, z, seg) { var g = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 9), m); g.position.set(x || 0, (y || 0) + h / 2, z || 0); g.castShadow = true; return g; }
  function canvasTex(w, h, draw) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; t.canvas = c;
    return t;
  }
  function rnd(seed) { var s = seed; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

  /* ---------- textures ---------- */
  function floorTex(kind) {
    return canvasTex(512, 512, function (g, W, H) {
      var r = rnd(kind.length * 99 + 7);
      if (kind === "tile") {
        for (var i = 0; i < 8; i++) for (var j = 0; j < 8; j++) {
          g.fillStyle = (i + j) % 2 ? "#d9d2c3" : "#3b4152"; g.fillRect(i * 64, j * 64, 64, 64);
          g.fillStyle = "rgba(0,0,0,.08)"; g.fillRect(i * 64, j * 64 + 62, 64, 2); g.fillRect(i * 64 + 62, j * 64, 2, 64);
        }
        return;
      }
      var base = kind === "walnut" ? [92, 58, 38] : [176, 128, 82];
      for (var y = 0; y < H; y += 32) {
        var off = r() * 200;
        for (var x = -off; x < W; x += 256) {
          var v = 0.85 + r() * 0.3;
          g.fillStyle = "rgb(" + (base[0] * v | 0) + "," + (base[1] * v | 0) + "," + (base[2] * v | 0) + ")";
          g.fillRect(x, y, 256, 32);
          g.strokeStyle = "rgba(0,0,0,.05)";
          for (var k = 0; k < 5; k++) { g.beginPath(); g.moveTo(x, y + 4 + r() * 24); g.bezierCurveTo(x + 80, y + r() * 32, x + 170, y + r() * 32, x + 256, y + 4 + r() * 24); g.stroke(); }
          g.fillStyle = "rgba(0,0,0,.28)"; g.fillRect(x, y, 2, 32);
        }
        g.fillStyle = "rgba(0,0,0,.3)"; g.fillRect(0, y + 31, W, 1);
      }
    });
  }
  function wallTex(kind) {
    var c = WALLS[kind] || WALLS.cream;
    return canvasTex(256, 256, function (g, W, H) {
      g.fillStyle = c[0]; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(255,255,255,.07)";
      for (var x = 0; x < W; x += 32) g.fillRect(x, 0, 12, H);
      g.fillStyle = "rgba(0,0,0,.05)";
      for (var y = 16; y < H; y += 32) for (var x2 = 16; x2 < W; x2 += 32) { g.beginPath(); g.arc(x2 + (y % 64 ? 16 : 0) - 16, y, 2.2, 0, 7); g.fill(); }
    });
  }
  // Armenian carpet: red field, blue border, gold diamonds (an original pattern, not a copy of a specific rug).
  function rugTex() {
    return canvasTex(512, 344, function (g, W, H) {
      g.fillStyle = "#1f2f5c"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#9c2230"; g.fillRect(26, 26, W - 52, H - 52);
      g.strokeStyle = "#e3b45a"; g.lineWidth = 4; g.strokeRect(18, 18, W - 36, H - 36); g.strokeRect(34, 34, W - 68, H - 68);
      for (var i = 0; i < 26; i++) { g.fillStyle = i % 2 ? "#e3b45a" : "#f0e2c4"; var x = 14 + i * 19; g.save(); g.translate(x, 10); g.rotate(Math.PI / 4); g.fillRect(-3, -3, 6, 6); g.restore(); g.save(); g.translate(x, H - 10); g.rotate(Math.PI / 4); g.fillRect(-3, -3, 6, 6); g.restore(); }
      function diamond(cx, cy, s, col) { g.fillStyle = col; g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s * 0.75, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s * 0.75, cy); g.closePath(); g.fill(); }
      [[W * 0.3, H / 2], [W * 0.5, H / 2], [W * 0.7, H / 2]].forEach(function (p, i) {
        diamond(p[0], p[1], 92, "#1f2f5c"); diamond(p[0], p[1], 72, i === 1 ? "#e3b45a" : "#c96a2b"); diamond(p[0], p[1], 46, "#9c2230");
        diamond(p[0], p[1], 22, "#f0e2c4");
        g.fillStyle = "#1f2f5c"; [[-40, 0], [40, 0], [0, -64], [0, 64]].forEach(function (d) { g.save(); g.translate(p[0] + d[0], p[1] + d[1]); g.rotate(Math.PI / 4); g.fillRect(-6, -6, 12, 12); g.restore(); });
      });
    });
  }
  // The window view: night, snow, and the two peaks of Ararat.
  function viewTex() {
    var flakes = []; var r = rnd(42);
    for (var i = 0; i < 70; i++) flakes.push([r() * 256, r() * 320, 0.6 + r() * 1.6, 0.3 + r() * 0.8]);
    var t = canvasTex(256, 320, function () {});
    t.draw = function (time) {
      var g = t.canvas.getContext("2d"), W = 256, H = 320;
      var sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#0a1636"); sky.addColorStop(0.7, "#22325e"); sky.addColorStop(1, "#3a3f63");
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      g.fillStyle = "#fff"; for (var s = 0; s < 40; s++) { g.globalAlpha = 0.3 + 0.7 * ((s * 37) % 10) / 10; g.fillRect((s * 71) % W, (s * 43) % 150, 1.4, 1.4); }
      g.globalAlpha = 1;
      g.fillStyle = "#f6efd8"; g.beginPath(); g.arc(196, 52, 15, 0, 7); g.fill();
      g.fillStyle = "#4b5679"; g.beginPath(); g.moveTo(-10, 300); g.lineTo(96, 150); g.lineTo(140, 200); g.lineTo(170, 182); g.lineTo(270, 290); g.lineTo(270, 330); g.lineTo(-10, 330); g.fill();
      g.fillStyle = "#e9eefc"; g.beginPath(); g.moveTo(66, 192); g.lineTo(96, 150); g.lineTo(126, 186); g.lineTo(112, 180); g.lineTo(100, 192); g.lineTo(86, 182); g.fill();
      g.beginPath(); g.moveTo(156, 196); g.lineTo(170, 182); g.lineTo(186, 198); g.lineTo(176, 196); g.fill();
      g.fillStyle = "#1a2140"; g.fillRect(0, 285, W, 40);
      g.fillStyle = "#ffd27a"; [[30, 292], [62, 296], [120, 290], [180, 295], [220, 291]].forEach(function (p) { g.fillRect(p[0], p[1], 3, 3); });
      g.fillStyle = "#fff";
      flakes.forEach(function (f) { var y = (f[1] + time * 24 * f[3]) % H, x = f[0] + Math.sin(time * f[3] + f[1]) * 6; g.globalAlpha = 0.85; g.beginPath(); g.arc(x, y, f[2], 0, 7); g.fill(); });
      g.globalAlpha = 1; t.needsUpdate = true;
    };
    t.draw(0);
    return t;
  }
  function screenTex() {
    var t = canvasTex(256, 144, function () {});
    t.mode = 0;
    t.draw = function (time) {
      var g = t.canvas.getContext("2d"), W = 256, H = 144;
      g.fillStyle = "#07060c"; g.fillRect(0, 0, W, H);
      if (t.mode === 1) { // fireworks
        for (var b = 0; b < 4; b++) { var ph = (time * 0.6 + b * 0.25) % 1, cx = 40 + b * 58, cy = 40 + (b % 2) * 30, cols = ["#ffd27a", "#ff6b57", "#7cc2ff", "#74e6a0"];
          g.strokeStyle = cols[b]; g.globalAlpha = 1 - ph; for (var k = 0; k < 12; k++) { var a = k / 12 * 6.28; g.beginPath(); g.moveTo(cx + Math.cos(a) * ph * 10, cy + Math.sin(a) * ph * 10); g.lineTo(cx + Math.cos(a) * ph * 34, cy + Math.sin(a) * ph * 34); g.stroke(); } }
        g.globalAlpha = 1; t.needsUpdate = true; return;
      }
      if (t.mode === 2) { // snowy Ararat
        var sk = g.createLinearGradient(0, 0, 0, H); sk.addColorStop(0, "#0d1a40"); sk.addColorStop(1, "#33406b"); g.fillStyle = sk; g.fillRect(0, 0, W, H);
        g.fillStyle = "#e9eefc"; g.beginPath(); g.moveTo(20, 130); g.lineTo(110, 50); g.lineTo(150, 90); g.lineTo(175, 75); g.lineTo(250, 130); g.fill();
        g.fillStyle = "#fff"; for (var q = 0; q < 40; q++) { g.fillRect((q * 53 + time * 20) % W, (q * 29 + time * 30) % H, 2, 2); }
        t.needsUpdate = true; return;
      }
      if (t.mode === 3) { // a countdown
        g.fillStyle = "#e9c77b"; g.font = "bold 64px Georgia, serif"; g.textAlign = "center"; g.fillText(String(10 - (Math.floor(time) % 10)), W / 2, 96);
        g.fillStyle = "rgba(255,255,255,.7)"; g.font = "bold 12px sans-serif"; g.fillText("2027", W / 2, 124); t.needsUpdate = true; return;
      }
      for (var i = 0; i < 9; i++) {
        var x = 128 + Math.sin(time * 2 + i) * 18 + (i - 4) * 9, h = 60 + Math.sin(time * 5 + i * 1.7) * 18 + (4 - Math.abs(i - 4)) * 9;
        var gr = g.createLinearGradient(0, H - h - 10, 0, H - 10); gr.addColorStop(0, "rgba(255,210,120,0)"); gr.addColorStop(0.4, "rgba(255,150,60,.85)"); gr.addColorStop(1, "rgba(255,240,190,1)");
        g.fillStyle = gr; g.beginPath(); g.ellipse(x, H - 10 - h / 2, 14, h / 2, 0, 0, 7); g.fill();
      }
      g.fillStyle = "rgba(255,255,255,.85)"; g.font = "bold 13px sans-serif"; g.textAlign = "center"; g.fillText("2027", W / 2, 20);
      t.needsUpdate = true;
    };
    t.draw(0);
    return t;
  }
  function glowSpriteTex() {
    return canvasTex(64, 64, function (g) {
      var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    });
  }

  /* ---------- item models: centred on their footprint, front facing +z ---------- */
  var M = {};
  function mats() {
    if (M.ready) return M;
    M.ready = true;
    M.wood = mat("#7a4a2b"); M.woodDark = mat("#4a2c1c"); M.woodLight = mat("#b98454");
    M.green = mat("#123d27", { flatShading: true, roughness: 0.9 }); M.green2 = mat("#1a5233", { flatShading: true, roughness: 0.9 });
    M.gold = mat("#e9c77b", { metalness: 0.6, roughness: 0.35 }); M.star = glowMat("#ffd86b");
    M.red = mat("#a3283a"); M.red2 = mat("#c8473b"); M.cream = mat("#efe4cf"); M.white = mat("#f4f1ea", { roughness: 0.9 });
    M.black = mat("#16161c", { roughness: 0.3, metalness: 0.2 }); M.stone = mat("#8b8579", { flatShading: true }); M.metal = mat("#9aa0ab", { metalness: 0.7, roughness: 0.35 });
    M.fabric = mat("#7b2433", { roughness: 0.95 }); M.fabric2 = mat("#c99a3b", { roughness: 0.95 }); M.blue = mat("#2d4f8f");
    M.fire = glowMat("#ff7a2a"); M.fire2 = glowMat("#ffc45a"); M.flame = glowMat("#ffd27a");
    M.orange = mat("#e58a3a"); M.brown = mat("#7a5233"); M.pot = mat("#b2643f"); M.leaf = mat("#3f8a4f", { flatShading: true });
    M.shade = new THREE.MeshBasicMaterial({ color: "#ffd59a", side: THREE.DoubleSide, toneMapped: false });
    return M;
  }
  function tree(scale) {
    var g = new THREE.Group(), s = scale || 1;
    g.add(cyl(0.12, 0.16, 0.35, M.woodDark));
    var layers = [[0.82, 1.0, 0.25], [0.66, 0.9, 0.85], [0.48, 0.8, 1.4], [0.3, 0.62, 1.9]];
    layers.forEach(function (l, i) { g.add(cone(l[0], l[1], i % 2 ? M.green2 : M.green, 0, l[2], 0, 10)); });
    var st = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), M.star); st.position.y = 2.62; st.userData.spin = true; g.add(st);
    var cols = ["#d8344a", "#e9c77b", "#3d7bd8", "#f2f2f2", "#c74b9a"], r = rnd(7);
    for (var i = 0; i < 18; i++) {
      var h = 0.4 + r() * 1.6, rad = (1 - (h - 0.25) / 2.0) * 0.75 + 0.05, a = r() * 6.28;
      var b = sph(0.07, mat(cols[i % cols.length], { metalness: 0.5, roughness: 0.25 }), Math.cos(a) * rad, h, Math.sin(a) * rad, 10);
      g.add(b);
    }
    g.userData.lights = [];
    for (var j = 0; j < 26; j++) { var hh = 0.35 + j / 26 * 1.9, rr = (1 - (hh - 0.25) / 2.0) * 0.78 + 0.06, aa = j * 2.4; g.userData.lights.push([Math.cos(aa) * rr, hh, Math.sin(aa) * rr]); }
    g.scale.setScalar(s);
    return g;
  }
  var BUILD = {
    tree: function () { return tree(1); },
    tree_small: function () { var g = new THREE.Group(); g.add(cyl(0.22, 0.17, 0.32, M.pot)); var t = tree(0.5); t.position.y = 0.3; g.add(t); g.userData.lights = t.userData.lights.map(function (p) { return [p[0] * 0.5, p[1] * 0.5 + 0.3, p[2] * 0.5]; }); return g; },
    sofa: function () {
      var g = new THREE.Group();
      g.add(box(1.9, 0.38, 0.85, M.fabric, 0, 0.1, 0.02)); g.add(box(1.9, 0.6, 0.22, M.fabric, 0, 0.3, -0.33));
      g.add(box(0.2, 0.55, 0.85, M.fabric, -0.9, 0.1, 0.02)); g.add(box(0.2, 0.55, 0.85, M.fabric, 0.9, 0.1, 0.02));
      g.add(box(0.82, 0.12, 0.6, M.fabric2, -0.42, 0.48, 0.08)); g.add(box(0.82, 0.12, 0.6, M.fabric2, 0.42, 0.48, 0.08));
      var p = box(0.36, 0.3, 0.1, M.cream, 0.55, 0.62, -0.18); p.rotation.z = 0.2; g.add(p);
      [[-0.85, 0.35], [0.85, 0.35], [-0.85, -0.35], [0.85, -0.35]].forEach(function (q) { g.add(cyl(0.04, 0.03, 0.1, M.woodDark, q[0], 0, q[1])); });
      return g;
    },
    armchair: function () {
      var g = new THREE.Group();
      g.add(box(0.85, 0.4, 0.8, M.fabric2, 0, 0.1, 0.02)); g.add(box(0.85, 0.65, 0.2, M.fabric2, 0, 0.3, -0.32));
      g.add(box(0.16, 0.55, 0.8, M.fabric2, -0.38, 0.1, 0.02)); g.add(box(0.16, 0.55, 0.8, M.fabric2, 0.38, 0.1, 0.02));
      g.add(box(0.55, 0.1, 0.55, M.red, 0, 0.5, 0.06));
      return g;
    },
    table: function () {
      var g = new THREE.Group();
      g.add(box(1.6, 0.07, 0.75, M.woodLight, 0, 0.42));
      [[-0.72, 0.3], [0.72, 0.3], [-0.72, -0.3], [0.72, -0.3]].forEach(function (q) { g.add(box(0.07, 0.42, 0.07, M.woodDark, q[0], 0, q[1])); });
      g.add(cyl(0.2, 0.2, 0.14, M.cream, -0.3, 0.49, 0)); g.add(cyl(0.12, 0.12, 0.1, M.red2, -0.3, 0.63, 0));
      g.add(cyl(0.06, 0.05, 0.11, M.white, 0.25, 0.49, 0.1)); g.add(cyl(0.06, 0.05, 0.11, M.blue, 0.45, 0.49, -0.12));
      var c = cyl(0.025, 0.025, 0.14, M.cream, 0.05, 0.49, -0.2); g.add(c); var f = sph(0.03, M.flame, 0.05, 0.67, -0.2, 8); g.add(f); f.userData.flicker = true;
      return g;
    },
    tv: function () {
      var g = new THREE.Group();
      g.add(box(1.8, 0.45, 0.5, M.woodDark, 0, 0, -0.1));
      g.add(box(0.06, 0.12, 0.06, M.black, 0, 0.45, -0.15));
      g.add(box(1.5, 0.88, 0.06, M.black, 0, 0.57, -0.15));
      var scr = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.79), new THREE.MeshBasicMaterial({ map: M.screen, toneMapped: false }));
      scr.position.set(0, 1.01, -0.115); g.add(scr);
      return g;
    },
    fireplace: function () {
      var g = new THREE.Group();
      g.add(box(1.9, 1.25, 0.6, M.stone, 0, 0, -0.18));
      g.add(box(2.1, 0.1, 0.72, M.woodDark, 0, 1.25, -0.14));
      g.add(box(1.0, 0.75, 0.3, M.black, 0, 0.12, 0.0));
      g.add(box(0.7, 0.08, 0.14, M.woodDark, 0, 0.13, 0.05));
      [[-0.18, 0], [0.05, 0.04], [0.22, -0.02]].forEach(function (p, i) { var fl = cone(0.13 - i * 0.02, 0.42 - i * 0.06, i % 2 ? M.fire2 : M.fire, p[0], 0.2, 0.1 + p[1], 7); fl.userData.flicker = true; g.add(fl); });
      [-0.6, 0, 0.6].forEach(function (x, i) { var s = box(0.18, 0.32, 0.06, i === 1 ? M.cream : M.red, x, 0.9, 0.17); g.add(s); g.add(box(0.2, 0.06, 0.07, M.white, x, 1.18, 0.17)); });
      g.add(cyl(0.05, 0.05, 0.22, M.cream, -0.75, 1.35, -0.2)); var f = sph(0.04, M.flame, -0.75, 1.62, -0.2, 8); f.userData.flicker = true; g.add(f);
      g.userData.fire = [0, 0.55, 0.15];
      return g;
    },
    gifts: function () {
      var g = new THREE.Group(), cols = [[M.red, M.gold], [M.blue, M.white], [mat("#2a7349"), M.red2]];
      [[-0.18, 0.12, 0.38, 0.12], [0.2, -0.14, 0.3, 0.3], [0.05, 0.25, 0.22, 0.24]].forEach(function (b, i) {
        var s = b[2], c = cols[i]; g.add(box(s, s * 0.9, s, c[0], b[0], 0, b[1]));
        g.add(box(s + 0.01, s * 0.9 + 0.01, 0.05, c[1], b[0], 0, b[1])); g.add(box(0.05, s * 0.9 + 0.01, s + 0.01, c[1], b[0], 0, b[1]));
      });
      return g;
    },
    rug: function () { var m = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.9), new THREE.MeshStandardMaterial({ map: M.rugTex, roughness: 1 })); m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.receiveShadow = true; var g = new THREE.Group(); g.add(m); return g; },
    lamp: function () {
      var g = new THREE.Group();
      g.add(cyl(0.22, 0.25, 0.05, M.metal)); g.add(cyl(0.025, 0.025, 1.7, M.metal, 0, 0.05));
      var sh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.38, 20, 1, true), M.shade.clone()); sh.position.y = 1.85; sh.userData.shade = true; g.add(sh);
      g.userData.lamp = [0, 1.75, 0];
      return g;
    },
    shelf: function () {
      var g = new THREE.Group(), r = rnd(5);
      g.add(box(1.8, 2.0, 0.08, M.woodDark, 0, 0, -0.3));
      [-0.88, 0.88].forEach(function (x) { g.add(box(0.06, 2.0, 0.42, M.wood, x, 0, -0.12)); });
      [0, 0.66, 1.32, 1.96].forEach(function (y) { g.add(box(1.8, 0.05, 0.42, M.wood, 0, y, -0.12)); });
      var cols = ["#a3283a", "#2d4f8f", "#c99a3b", "#2a7349", "#efe4cf", "#5a3d7a"];
      [0.05, 0.71, 1.37].forEach(function (y) {
        var x = -0.82; while (x < 0.78) { var w = 0.06 + r() * 0.06, h = 0.38 + r() * 0.18; if (r() < 0.12) { x += 0.12; continue; } g.add(box(w, h, 0.3, mat(cols[(r() * cols.length) | 0]), x + w / 2, y, -0.12)); x += w + 0.01; }
      });
      return g;
    },
    plant: function () {
      var g = new THREE.Group(); g.add(cyl(0.24, 0.18, 0.4, M.pot));
      var r = rnd(3); for (var i = 0; i < 9; i++) { var a = r() * 6.28, d = r() * 0.18; g.add(sph(0.16 + r() * 0.08, M.leaf, Math.cos(a) * d, 0.55 + r() * 0.55, Math.sin(a) * d, 7)); }
      return g;
    },
    piano: function () {
      var g = new THREE.Group();
      g.add(box(1.7, 1.25, 0.45, M.black, 0, 0, -0.22)); g.add(box(1.7, 0.08, 0.6, M.black, 0, 0.72, -0.08));
      g.add(box(1.5, 0.03, 0.18, M.white, 0, 0.8, 0.12)); for (var i = 0; i < 18; i++) g.add(box(0.035, 0.03, 0.1, M.black, -0.7 + i * 0.083, 0.83, 0.08));
      g.add(box(0.9, 0.06, 0.35, M.black, 0, 0.42, 0.6)); [-0.4, 0.4].forEach(function (x) { g.add(box(0.05, 0.42, 0.3, M.black, x, 0, 0.6)); });
      var c = cyl(0.04, 0.04, 0.18, M.cream, 0.6, 1.25, -0.25); g.add(c); var f = sph(0.035, M.flame, 0.6, 1.47, -0.25, 8); f.userData.flicker = true; g.add(f);
      return g;
    },
    snowman: function () {
      var g = new THREE.Group();
      g.add(sph(0.36, M.white, 0, 0.34)); g.add(sph(0.27, M.white, 0, 0.85)); g.add(sph(0.2, M.white, 0, 1.25));
      var hat = new THREE.Group(); hat.add(cyl(0.16, 0.16, 0.04, M.black, 0, 0)); hat.add(cyl(0.11, 0.11, 0.22, M.black, 0, 0.02)); hat.position.y = 1.4; hat.userData.hat = true; g.add(hat);
      var n = cone(0.04, 0.2, M.orange, 0, 0, 0); n.rotation.x = Math.PI / 2; n.position.set(0, 1.25, 0.28); g.add(n);
      var sc = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.05, 8, 20), M.red); sc.rotation.x = Math.PI / 2; sc.position.y = 1.07; g.add(sc);
      [-0.07, 0.07].forEach(function (x) { g.add(sph(0.025, M.black, x, 1.3, 0.17, 6)); });
      return g;
    },
    cat: function () {
      var g = new THREE.Group(), fur = M.orange;
      var b = sph(0.22, fur, 0, 0.2, 0); b.scale.set(1, 0.8, 1.4); g.add(b);
      g.add(sph(0.15, fur, 0, 0.38, 0.27));
      [-0.08, 0.08].forEach(function (x) { var e = cone(0.05, 0.1, fur, x, 0.47, 0.27, 4); g.add(e); g.add(sph(0.022, M.black, x * 0.6, 0.4, 0.4, 6)); });
      var tail = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 14, Math.PI), fur); tail.position.set(0.15, 0.1, -0.2); tail.rotation.y = Math.PI / 2; g.add(tail);
      return g;
    },
    dog: function () {
      var g = new THREE.Group(), fur = M.brown;
      var b = sph(0.24, fur, 0, 0.3, -0.05); b.scale.set(0.9, 1.1, 1.2); g.add(b);
      g.add(sph(0.17, fur, 0, 0.62, 0.12)); var sn = box(0.12, 0.1, 0.16, fur, 0, 0.53, 0.28); g.add(sn); g.add(sph(0.03, M.black, 0, 0.6, 0.36, 6));
      [-0.14, 0.14].forEach(function (x) { var e = box(0.06, 0.18, 0.1, M.woodDark, x, 0.5, 0.1); e.rotation.z = x > 0 ? -0.3 : 0.3; g.add(e); g.add(sph(0.022, M.black, x * 0.45, 0.67, 0.27, 6)); });
      [-0.1, 0.1].forEach(function (x) { g.add(cyl(0.05, 0.05, 0.2, fur, x, 0, 0.18)); });
      var col = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 16), M.red); col.rotation.x = Math.PI / 2; col.position.set(0, 0.48, 0.1); g.add(col);
      return g;
    },
    candles: function () {
      var g = new THREE.Group(); g.add(cyl(0.34, 0.34, 0.05, M.gold));
      [[-0.14, 0.05, 0.36], [0.14, -0.06, 0.26], [0.02, 0.15, 0.2]].forEach(function (c) {
        g.add(cyl(0.06, 0.06, c[2], M.cream, c[0], 0.05, c[1])); var f = sph(0.035, M.flame, c[0], 0.11 + c[2], c[1], 8); f.scale.y = 1.6; f.userData.flicker = true; g.add(f);
      });
      g.userData.lamp = [0, 0.5, 0]; g.userData.lampColor = "#ffb45c"; g.userData.lampPower = 0.9;
      return g;
    },
    pomegranates: function () {
      var g = new THREE.Group();
      g.add(cyl(0.18, 0.22, 0.5, M.woodDark)); g.add(cyl(0.34, 0.2, 0.14, M.cream, 0, 0.5));
      var pm = mat("#b21f2e", { roughness: 0.45 });
      [[0, 0.72, 0], [-0.15, 0.68, 0.08], [0.15, 0.68, -0.05], [0.04, 0.68, 0.17], [-0.06, 0.68, -0.16]].forEach(function (p) {
        g.add(sph(0.11, pm, p[0], p[1], p[2], 12)); g.add(cone(0.035, 0.06, pm, p[0], p[1] + 0.09, p[2], 5));
      });
      return g;
    },
    radio: function () {
      var g = new THREE.Group();
      g.add(box(0.55, 0.5, 0.45, M.woodLight, 0, 0)); g.add(box(0.55, 0.36, 0.3, M.woodDark, 0, 0.5, -0.02));
      var face = box(0.4, 0.2, 0.02, glowMat("#ffd9a0", 0.6), 0, 0.58, 0.13); g.add(face);
      g.add(box(0.4, 0.06, 0.02, M.cream, 0, 0.52, 0.14));
      return g;
    },
    clock: function () {
      var g = new THREE.Group();
      g.add(box(0.6, 2.1, 0.38, M.woodDark, 0, 0, -0.1));
      var face = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), M.cream); face.position.set(0, 1.75, 0.095); g.add(face);
      var hand1 = box(0.02, 0.15, 0.01, M.black, 0, 1.75, 0.1); hand1.geometry.translate(0, 0, 0); g.add(hand1);
      var hand2 = box(0.015, 0.18, 0.01, M.black, 0, 1.75, 0.1); hand2.rotation.z = -0.2; g.add(hand2);
      var pend = box(0.25, 0.6, 0.02, glowMat("#e9c77b", 0.25), 0, 0.6, 0.095); pend.userData.swing = true; g.add(pend);
      return g;
    }
  };


  /* ---------- catalogue thumbnails: each model rendered once into a small image ---------- */
  var thumbCache = null;
  function thumbnails(size) {
    if (thumbCache) return thumbCache;
    mats();
    M.screen = M.screen || screenTex(); M.view = M.view || viewTex(); M.rugTex = M.rugTex || rugTex();
    var c = document.createElement("canvas"), px = (size || 88) * Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.height = px;
    var r;
    try { r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { return (thumbCache = {}); }
    r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    var sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight("#cfd8ff", "#3a2618", 0.55));
    var d = new THREE.DirectionalLight("#ffe2bd", 1.0); d.position.set(3, 5, 4); sc.add(d);
    var cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    thumbCache = {};
    ORDER.forEach(function (type) {
      var o = BUILD[type](); sc.add(o);
      var bb = new THREE.Box3().setFromObject(o), ctr = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      var rad = Math.max(sz.x, sz.y, sz.z) * 0.62 + 0.05;
      cam.position.set(ctr.x + rad * 2.3, ctr.y + rad * 1.5, ctr.z + rad * 2.6); cam.lookAt(ctr);
      r.render(sc, cam);
      thumbCache[type] = c.toDataURL("image/png");
      sc.remove(o);
    });
    r.dispose();
    return thumbCache;
  }

  /* ---------- the scene ---------- */
  function create(canvas, opts) {
    opts = opts || {};
    mats();
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: "high-performance" }); }
    catch (e) { return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.physicallyCorrectLights = false;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    var target = new THREE.Vector3(4, 1.5, 4);
    var orbit = { az: Math.PI / 4, pol: 0.98, dist: 16, autoT: 0 };

    M.screen = M.screen || screenTex();
    M.view = M.view || viewTex();
    M.rugTex = M.rugTex || rugTex();
    var glowTex = glowSpriteTex();

    // light: cool moonlight from the window side, warm fill, hemisphere
    scene.add(new THREE.HemisphereLight("#6f82c8", "#2a1a10", 0.2));
    var key = new THREE.DirectionalLight("#ffd6a0", 0.26);
    key.position.set(12, 14, 9); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.0008; key.shadow.radius = 4; key.target.position.set(4, 0, 4);
    scene.add(key); scene.add(key.target);
    var moon = new THREE.DirectionalLight("#8fb0ff", 0.22); moon.position.set(3, 6, -6); moon.target.position.set(4, 0, 4); scene.add(moon); scene.add(moon.target);
    var warmPool = [0, 1, 2].map(function () { var l = new THREE.PointLight("#ffb066", 0, 11, 1.25); scene.add(l); return l; });

    // shell: floor slab and two walls
    var shell = new THREE.Group(); scene.add(shell);
    var floorMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
    var floor = new THREE.Mesh(new THREE.BoxGeometry(N, 0.4, N), [mat("#2a1b12"), mat("#2a1b12"), floorMat, mat("#2a1b12"), mat("#2a1b12"), mat("#2a1b12")]);
    floor.position.set(N / 2, -0.2, N / 2); floor.receiveShadow = true; shell.add(floor);
    var wallMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    var trimMat = mat("#f3ece0");
    var back = new THREE.Mesh(new THREE.BoxGeometry(N + 0.25, WALL_H, 0.25), wallMat); back.position.set(N / 2 - 0.125, WALL_H / 2, -0.125); back.receiveShadow = true; shell.add(back);
    var left = new THREE.Mesh(new THREE.BoxGeometry(0.25, WALL_H, N), wallMat); left.position.set(-0.125, WALL_H / 2, N / 2); left.receiveShadow = true; shell.add(left);
    // wainscot and skirting
    shell.add(box(N, 1.1, 0.04, trimMat, N / 2, 0, 0.02)); shell.add(box(0.04, 1.1, N, trimMat, 0.02, 0, N / 2));
    shell.add(box(N, 0.06, 0.08, trimMat, N / 2, 1.1, 0.04)); shell.add(box(0.08, 0.06, N, trimMat, 0.04, 1.1, N / 2));
    shell.add(box(N + 0.25, 0.1, 0.3, trimMat, N / 2 - 0.125, WALL_H, -0.125)); shell.add(box(0.3, 0.1, N, trimMat, -0.125, WALL_H, N / 2));
    // window with the view (back wall)
    var win = new THREE.Group(); win.position.set(5.6, 1.6, 0.02); shell.add(win);
    var view = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.0), new THREE.MeshBasicMaterial({ map: M.view, toneMapped: false })); view.position.set(0, 1.0, 0.01); win.add(view);
    [[0, 2.02, 1.78, 0.1], [0, -0.02, 1.78, 0.1], [-0.84, 1.0, 0.1, 2.1], [0.84, 1.0, 0.1, 2.1], [0, 1.0, 0.05, 2.0], [0, 1.0, 1.6, 0.05]].forEach(function (f) {
      var b = new THREE.Mesh(new THREE.BoxGeometry(f[2], f[3], 0.08), trimMat); b.position.set(f[0], f[1], 0.04); win.add(b);
    });
    win.add(box(2.0, 0.08, 0.25, trimMat, 0, -0.1, 0.1));
    // wreath on the left wall
    var wreath = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.11, 10, 28), M.green); wreath.position.set(0.06, 2.85, 2.2); wreath.rotation.y = Math.PI / 2; shell.add(wreath);
    var bow = box(0.06, 0.16, 0.3, M.red, 0.12, 2.38, 2.2); shell.add(bow);
    for (var wb = 0; wb < 8; wb++) { var a = wb / 8 * 6.28; shell.add(sph(0.045, M.red2, 0.12, 2.85 + Math.sin(a) * 0.38, 2.2 + Math.cos(a) * 0.38, 8)); }
    // a framed picture: the year
    var pic = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), new THREE.MeshStandardMaterial({ map: canvasTex(256, 180, function (g, W, H) {
      var gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#14204a"); gr.addColorStop(1, "#4a2a3a"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = "#e9c77b"; g.font = "bold 64px Georgia, serif"; g.textAlign = "center"; g.fillText("2027", W / 2, H / 2 + 22);
    }) }));
    pic.position.set(0.075, 2.7, 5.4); pic.rotation.y = Math.PI / 2; shell.add(pic);
    shell.add((function () { var f = box(0.05, 0.82, 1.12, M.gold, 0.02, 2.29, 5.4); return f; })());

    // fairy lights along the top of both walls
    var bulbs = [], bulbCols = ["#ffcf6b", "#ff6b57", "#7cc2ff", "#74e6a0", "#c7a0ff"];
    for (var i = 0; i <= 28; i++) { var t = i / 28; bulbs.push([0.3 + t * (N - 0.5), WALL_H - 0.35 - Math.sin(t * Math.PI * 4) * 0.22 * (Math.sin(t * Math.PI * 4) > 0 ? 1 : -1), 0.12]); }
    for (var j = 0; j <= 28; j++) { var u = j / 28; bulbs.push([0.12, WALL_H - 0.35 - Math.abs(Math.sin(u * Math.PI * 4)) * 0.22, 0.3 + u * (N - 0.5)]); }
    var bulbGeo = new THREE.BufferGeometry(), bp = new Float32Array(bulbs.length * 3), bc = new Float32Array(bulbs.length * 3);
    bulbs.forEach(function (b, k) { bp[k * 3] = b[0]; bp[k * 3 + 1] = b[1]; bp[k * 3 + 2] = b[2]; });
    bulbGeo.setAttribute("position", new THREE.BufferAttribute(bp, 3)); bulbGeo.setAttribute("color", new THREE.BufferAttribute(bc, 3));
    var bulbPts = new THREE.Points(bulbGeo, new THREE.PointsMaterial({ size: 0.7, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    scene.add(bulbPts);
    var wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bulbs.map(function (b) { return new THREE.Vector3(b[0], b[1] + 0.03, b[2]); })), new THREE.LineBasicMaterial({ color: "#1d3b26" }));
    scene.add(wire);
    var bulbColor = new THREE.Color();

    // tree lights (one Points cloud for all trees)
    var treeGeo = new THREE.BufferGeometry(), treePts = new THREE.Points(treeGeo, new THREE.PointsMaterial({ size: 0.5, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    scene.add(treePts);

    // grid + selection marker (edit mode)
    var grid = new THREE.GridHelper(N, N, 0xffffff, 0xffffff); grid.position.set(N / 2, 0.015, N / 2); grid.material.transparent = true; grid.material.opacity = 0.0; scene.add(grid);
    var marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: "#ffc46b", transparent: true, opacity: 0.28, depthWrite: false }));
    marker.rotation.x = -Math.PI / 2; marker.position.y = 0.02; marker.visible = false; scene.add(marker);
    var markerEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: "#ffc46b" }));
    markerEdge.rotation.x = -Math.PI / 2; markerEdge.position.y = 0.025; markerEdge.visible = false; scene.add(markerEdge);

    var itemsRoot = new THREE.Group(); scene.add(itemsRoot);
    var layout = { v: 1, wall: "cream", floor: "oak", glow: true, items: [] };
    var objs = []; // parallel to layout.items
    var selected = -1;

    function applySurfaces() {
      floorMat.map = floorTex(layout.floor); floorMat.map.wrapS = floorMat.map.wrapT = THREE.RepeatWrapping; floorMat.map.repeat.set(layout.floor === "tile" ? 1 : 2, layout.floor === "tile" ? 1 : 2); floorMat.needsUpdate = true;
      var wt = wallTex(layout.wall); wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.repeat.set(3, 2); wallMat.map = wt; wallMat.color.set("#ffffff"); wallMat.needsUpdate = true;
      bulbPts.visible = wire.visible = !!layout.glow;
    }
    function place(o, it) {
      var f = fp(it[0], it[3]);
      o.position.set(it[1] + f.w / 2, 0, it[2] + f.d / 2);
      o.rotation.y = it[3] * Math.PI / 2; o.userData.baseRot = o.rotation.y;
    }
    function rebuild() {
      while (itemsRoot.children.length) itemsRoot.remove(itemsRoot.children[0]);
      objs = layout.items.map(function (it) {
        var o = BUILD[it[0]](); o.userData.type = it[0];
        o.traverse(function (m) { if (m.isMesh) { m.castShadow = it[0] !== "rug"; } });
        place(o, it); itemsRoot.add(o); return o;
      });
      updateLights(); updateMarker();
    }
    function updateLights() {
      // tree lights
      var pts = [], cols = [], c = new THREE.Color();
      objs.forEach(function (o) {
        (o.userData.lights || []).forEach(function (p, k) {
          var v = new THREE.Vector3(p[0], p[1], p[2]); o.localToWorld(v); pts.push(v.x, v.y, v.z);
          c.set(bulbCols[k % bulbCols.length]); cols.push(c.r, c.g, c.b);
        });
      });
      treeGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      treeGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      treeGeo.computeBoundingSphere();
      treePts.userData.base = cols.slice();
      // up to three warm point lights: fireplace first, then trees, lamps, candles
      var srcs = [];
      objs.forEach(function (o) { if (o.userData.fire) srcs.push([o, o.userData.fire, "#ff8a3a", 2.6, true]); });
      objs.forEach(function (o) { if (o.userData.lights) srcs.push([o, [0, 1.3, 0.6], "#ffc27a", 1.6]); });
      objs.forEach(function (o) { if (o.userData.lamp && !o.userData.off) srcs.push([o, o.userData.lamp, o.userData.lampColor || "#ffbe6a", o.userData.lampPower || 1.8]); });
      warmPool.forEach(function (l, i) {
        var s = srcs[i];
        if (!s) { l.intensity = 0; l.userData.flicker = false; return; }
        var v = new THREE.Vector3(s[1][0], s[1][1], s[1][2]); s[0].localToWorld(v);
        l.position.copy(v); l.color.set(s[2]); l.userData.base = s[3]; l.intensity = s[3]; l.userData.flicker = !!s[4];
      });
    }

    /* ---------- occupancy ---------- */
    function fits(it, ignore) { return fitsIn(layout.items, it, ignore); }
    function freeSpot(type) {
      var best = null;
      for (var r = 0; r < 4 && !best; r++) for (var d = 0; d < N * 2 && !best; d++) {
        for (var x = 0; x < N && !best; x++) for (var z = 0; z < N && !best; z++) {
          if (Math.abs(x - 3) + Math.abs(z - 3) !== d) continue;
          var it = [type, x, z, r]; if (fits(it, -1)) best = it;
        }
      }
      return best;
    }

    /* ---------- selection marker ---------- */
    function updateMarker(bad) {
      var it = layout.items[selected];
      var on = !!(opts.editable && it);
      marker.visible = markerEdge.visible = on;
      grid.material.opacity = opts.editable ? (dragging ? 0.22 : 0.08) : 0;
      if (!on) return;
      var f = fp(it[0], it[3]);
      marker.scale.set(f.w, f.d, 1); markerEdge.scale.set(f.w, f.d, 1);
      marker.position.x = markerEdge.position.x = it[1] + f.w / 2; marker.position.z = markerEdge.position.z = it[2] + f.d / 2;
      marker.material.color.set(bad ? "#ff6b57" : "#ffc46b"); markerEdge.material.color.set(bad ? "#ff6b57" : "#ffc46b");
    }

    /* ---------- camera ---------- */
    function aim() {
      var p = orbit.pol, a = orbit.az, d = orbit.dist;
      camera.position.set(target.x + d * Math.sin(p) * Math.sin(a), target.y + d * Math.cos(p), target.z + d * Math.sin(p) * Math.cos(a));
      camera.lookAt(target);
    }
    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      // fit the room: narrower screens move the camera back
      // fit the whole room: about 6 units each side of centre horizontally, 4.8 vertically
      var asp = w / h; camera.fov = asp < 0.8 ? 40 : 30;
      var tv = Math.tan(camera.fov * Math.PI / 360);
      orbit.base = Math.max(4.9 / tv, 6.1 / (tv * asp));
      if (!orbit.userZoom) orbit.dist = orbit.base;
      camera.updateProjectionMatrix(); aim();
    }

    /* ---------- pointer: orbit, select, drag ---------- */
    var ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    var down = null, dragging = false, dragFrom = null, pinch = null, ptrs = new Map();
    function setNdc(e) { var r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
    function pickItem() {
      var hits = ray.intersectObjects(itemsRoot.children, true);
      for (var i = 0; i < hits.length; i++) { var o = hits[i].object; while (o.parent && o.parent !== itemsRoot) o = o.parent; var idx = objs.indexOf(o); if (idx >= 0) return idx; }
      return -1;
    }
    function floorCell() { if (!ray.ray.intersectPlane(plane, hit)) return null; return [hit.x, hit.z]; }
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", function (e) {
      canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) { var a = Array.from(ptrs.values()); pinch = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); down = null; dragging = false; return; }
      setNdc(e);
      down = { x: e.clientX, y: e.clientY, az: orbit.az, pol: orbit.pol, moved: 0, item: pickItem() };
      if (down.item >= 0 && opts.editable) { select(down.item); var fc = floorCell(), it = layout.items[down.item]; dragFrom = { it: it.slice(), off: fc ? [fc[0] - it[1], fc[1] - it[2]] : [0.5, 0.5] }; }
      orbit.autoT = performance.now() + 6000;
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && ptrs.size === 2) { var a = Array.from(ptrs.values()), d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); orbit.dist = Math.max(8, Math.min(40, orbit.dist * pinch / d)); orbit.userZoom = true; pinch = d; aim(); return; }
      if (!down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y; down.moved = Math.max(down.moved, Math.abs(dx) + Math.abs(dy));
      if (down.item >= 0 && opts.editable && down.moved > 4) {
        dragging = true; setNdc(e); var fc = floorCell(); if (!fc) return;
        var it = layout.items[down.item], nx = Math.round(fc[0] - dragFrom.off[0]), nz = Math.round(fc[1] - dragFrom.off[1]);
        var cand = [it[0], nx, nz, it[3]];
        var f = fp(it[0], it[3]); cand[1] = Math.max(0, Math.min(N - f.w, cand[1])); cand[2] = Math.max(0, Math.min(N - f.d, cand[2]));
        it[1] = cand[1]; it[2] = cand[2]; place(objs[down.item], it);
        updateMarker(!fits(it, down.item));
        return;
      }
      if ((down.item < 0 || !opts.editable) && down.moved > 3) {
        orbit.az = Math.max(0.2, Math.min(Math.PI / 2 - 0.2, down.az - dx * 0.006));
        orbit.pol = Math.max(0.55, Math.min(1.25, down.pol - dy * 0.004)); aim();
      }
    });
    function up(e) {
      ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
      if (!down) return;
      if (dragging && down.item >= 0) {
        var it = layout.items[down.item];
        if (!fits(it, down.item)) { it[1] = dragFrom.it[1]; it[2] = dragFrom.it[2]; place(objs[down.item], it); }
        updateLights(); changed();
      } else if (down.moved <= 4 && down.item >= 0) interact(down.item);
      else if (down.moved <= 4 && opts.editable && down.item < 0) select(-1);
      dragging = false; down = null; updateMarker();
    }
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", function (e) { e.preventDefault(); orbit.dist = Math.max(8, Math.min(40, orbit.dist * Math.exp(e.deltaY * 0.001))); orbit.userZoom = true; aim(); }, { passive: false });

    /* ---------- things react when you tap them ---------- */
    var bursts = [], boost = { tree: 0, fire: 0 };
    function confetti(o, cols, n) {
      var top = new THREE.Box3().setFromObject(o), c = top.getCenter(new THREE.Vector3()); c.y = top.max.y;
      var g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = [], cc = new THREE.Color();
      for (var i = 0; i < n; i++) {
        pos[i * 3] = c.x; pos[i * 3 + 1] = c.y; pos[i * 3 + 2] = c.z;
        var a = Math.random() * 6.28, sp = 1.2 + Math.random() * 2.2; vel.push([Math.cos(a) * sp, 3 + Math.random() * 3, Math.sin(a) * sp]);
        cc.set(cols[i % cols.length]); col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
      }
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      var pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.13, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
      scene.add(pts); bursts.push({ pts: pts, vel: vel, t0: performance.now() });
    }
    var pianoI = 0;
    function interact(i) {
      var o = objs[i]; if (!o) return;
      var type = o.userData.type, now = performance.now();
      o.userData.act = { t0: now, kind: "bounce" };
      if (opts.onInteract) opts.onInteract(type);
      switch (type) {
        case "tree": case "tree_small":
          boost.tree = now + 2200; [784, 988, 1175, 1568, 1976].forEach(function (f, k) { Snd.tone(f, 0.6, "sine", 0.08, k * 0.09); }); break;
        case "fireplace":
          boost.fire = now + 1800; for (var k = 0; k < 9; k++) Snd.noise(0.05, 0.25, 2200 + Math.random() * 1500, Math.random() * 0.9); break;
        case "tv": M.screen.mode = (M.screen.mode + 1) % 4; Snd.tone(880, 0.06, "square", 0.04); Snd.tone(1320, 0.08, "square", 0.04, 0.07); break;
        case "piano": Snd.tone(PIANO[pianoI % PIANO.length], 0.9, "triangle", 0.16); Snd.tone(PIANO[pianoI % PIANO.length] * 2, 0.5, "sine", 0.04); pianoI++; break;
        case "radio": RADIO.forEach(function (f, k) { Snd.tone(f, 0.22, "square", 0.035, k * 0.2); }); break;
        case "clock": [659, 523, 587, 392].forEach(function (f, k) { Snd.tone(f, 1.3, "sine", 0.1, k * 0.45); }); o.userData.fastUntil = now + 2200; break;
        case "cat": o.userData.act.kind = "jump"; Snd.tone(780, 0.38, "sawtooth", 0.035, 0, 430); Snd.tone(1560, 0.3, "sine", 0.02, 0, 860); break;
        case "dog": o.userData.act.kind = "hop2"; Snd.noise(0.09, 0.5, 700); Snd.tone(220, 0.08, "square", 0.04); Snd.noise(0.09, 0.5, 650, 0.22); Snd.tone(200, 0.08, "square", 0.04, 0.22); break;
        case "snowman": o.userData.act.kind = "jump"; Snd.tone(523, 0.15, "sine", 0.08); Snd.tone(784, 0.2, "sine", 0.08, 0.12); break;
        case "gifts": confetti(o, ["#ffd27a", "#ff6b57", "#7cc2ff", "#74e6a0", "#c7a0ff", "#fff4e2"], 90); Snd.tone(300, 0.14, "sine", 0.12, 0, 900); Snd.noise(0.08, 0.3, 3200); break;
        case "pomegranates": confetti(o, ["#b21f2e", "#e0384a", "#ff6b78"], 60); Snd.tone(420, 0.12, "sine", 0.1, 0, 820); break;
        case "lamp": case "candles":
          o.userData.off = !o.userData.off;
          o.traverse(function (m) { if (m.userData.flicker) m.visible = !o.userData.off; if (m.userData.shade) m.material.color.set(o.userData.off ? "#6b5a48" : "#ffd59a"); });
          updateLights(); Snd.noise(0.03, 0.4, 4200); break;
        default: Snd.tone(440, 0.1, "sine", 0.07, 0, 660);
      }
    }

    /* ---------- editing API ---------- */
    function changed() { if (opts.onChange) opts.onChange(getLayout()); }
    function select(i) { selected = i; updateMarker(); if (opts.onSelect) opts.onSelect(i >= 0 ? layout.items[i][0] : null); }
    function add(type) {
      if (!CATALOG[type] || layout.items.length >= 40) return false;
      var it = freeSpot(type); if (!it) return false;
      layout.items.push(it); rebuild(); select(layout.items.length - 1); changed();
      var o = objs[objs.length - 1]; o.scale.setScalar(0.01); o.userData.pop = performance.now();
      return true;
    }
    function rotate() {
      if (selected < 0) return;
      var it = layout.items[selected];
      for (var k = 1; k <= 4; k++) {
        var c = [it[0], it[1], it[2], (it[3] + k) % 4];
        var f = fp(c[0], c[3]); c[1] = Math.min(c[1], N - f.w); c[2] = Math.min(c[2], N - f.d);
        if (fits(c, selected)) { layout.items[selected] = c; place(objs[selected], c); updateLights(); updateMarker(); changed(); return; }
      }
    }
    function remove() {
      if (selected < 0) return;
      layout.items.splice(selected, 1); selected = -1; rebuild(); select(-1); changed();
    }
    function setStyle(k, v) {
      if (k === "wall" && WALLS[v]) layout.wall = v;
      if (k === "floor" && FLOORS.indexOf(v) >= 0) layout.floor = v;
      if (k === "glow") layout.glow = !!v;
      applySurfaces(); changed();
    }
    function setLayout(l) {
      var src = valid(l) ? l : (opts.seed != null ? randomRoom(opts.seed) : DEFAULT);
      layout = { v: 1, wall: WALLS[src.wall] ? src.wall : "cream", floor: FLOORS.indexOf(src.floor) >= 0 ? src.floor : "oak", glow: src.glow !== false,
        items: src.items.filter(function (it) { return CATALOG[it[0]]; }).slice(0, 40).map(function (it) { return [it[0], it[1] | 0, it[2] | 0, (it[3] | 0) % 4]; }) };
      selected = -1; applySurfaces(); rebuild();
    }
    function getLayout() { return JSON.parse(JSON.stringify(layout)); }

    /* ---------- loop ---------- */
    var running = false, visible = true, t0 = performance.now(), lastTex = 0;
    function frame(now) {
      if (!running) return;
      var t = (now - t0) / 1000;
      if (!opts.editable && !down && now > orbit.autoT) { orbit.az = Math.PI / 4 + Math.sin(t * 0.18) * 0.32; aim(); }
      // twinkle
      var cAttr = bulbGeo.getAttribute("color");
      for (var k = 0; k < bulbs.length; k++) {
        bulbColor.set(bulbCols[k % bulbCols.length]);
        var tw = 0.55 + 0.45 * Math.sin(t * 2.2 + k * 1.7);
        cAttr.setXYZ(k, bulbColor.r * tw, bulbColor.g * tw, bulbColor.b * tw);
      }
      cAttr.needsUpdate = true;
      var tc = treeGeo.getAttribute("color"), base = treePts.userData.base, tb = now < boost.tree, fb = now < boost.fire;
      if (tc && base) { for (var q = 0; q < tc.count; q++) { var w = tb ? (Math.sin(t * 22 + q * 2.1) > 0 ? 1 : 0.25) : 0.5 + 0.5 * Math.sin(t * 3 + q * 2.1); tc.setXYZ(q, base[q * 3] * w, base[q * 3 + 1] * w, base[q * 3 + 2] * w); } tc.needsUpdate = true; }
      treePts.material.size = tb ? 0.7 : 0.5;
      warmPool.forEach(function (l) { if (l.userData.flicker) l.intensity = l.userData.base * (fb ? 1.9 : 1) * (0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3)); });
      bursts = bursts.filter(function (b) {
        var k = (now - b.t0) / 1000; if (k > 1.8) { scene.remove(b.pts); b.pts.geometry.dispose(); return false; }
        var pa = b.pts.geometry.getAttribute("position");
        for (var i = 0; i < b.vel.length; i++) { b.vel[i][1] -= 9.8 * 0.016; pa.setXYZ(i, pa.getX(i) + b.vel[i][0] * 0.016, Math.max(0.03, pa.getY(i) + b.vel[i][1] * 0.016), pa.getZ(i) + b.vel[i][2] * 0.016); }
        pa.needsUpdate = true; b.pts.material.opacity = Math.min(1, (1.8 - k) * 2); return true;
      });
      objs.forEach(function (o) {
        if (o.userData.pop) { var k2 = Math.min(1, (now - o.userData.pop) / 380); o.scale.setScalar(k2 < 1 ? 1 + Math.sin(k2 * Math.PI) * 0.15 - (1 - k2) * 0.9 : 1); if (k2 >= 1) o.userData.pop = 0; }
        else if (o.userData.act) {
          var A2 = o.userData.act, k3 = (now - A2.t0) / (A2.kind === "hop2" ? 700 : A2.kind === "jump" ? 600 : 420);
          if (k3 >= 1) { o.scale.set(1, 1, 1); o.position.y = 0; o.userData.act = null; }
          else if (A2.kind === "bounce") { var sq = Math.sin(k3 * Math.PI); o.scale.set(1 + sq * 0.08, 1 - sq * 0.14 + Math.sin(k3 * Math.PI * 2) * 0.06, 1 + sq * 0.08); }
          else { var arc = A2.kind === "hop2" ? Math.abs(Math.sin(k3 * Math.PI * 2)) * 0.45 : Math.sin(k3 * Math.PI) * 0.75; o.position.y = arc; o.rotation.y = o.userData.baseRot + (A2.kind === "jump" ? k3 * Math.PI * 2 : 0); if (k3 > 0.98) o.rotation.y = o.userData.baseRot; }
        }
        var fast = o.userData.fastUntil && now < o.userData.fastUntil;
        o.traverse(function (m) {
          if (m.userData.flicker) { m.scale.y = (fb && o.userData.fire ? 1.7 : 1) * (1 + 0.18 * Math.sin(t * 12 + m.id)); if (fb && o.userData.fire) { m.scale.x = m.scale.z = 1.35; } else { m.scale.x = m.scale.z = 1; } }
          if (m.userData.spin) m.rotation.y = tb ? t * 9 : t;
          if (m.userData.swing) m.rotation.z = fast ? Math.sin(t * 9) * 0.4 : Math.sin(t * 2) * 0.15;
          if (m.userData.hat && o.userData.act) m.rotation.y = t * 12;
        });
      });
      if (now - lastTex > 50) { lastTex = now; M.view.draw(t); M.screen.draw(t); }
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    function start() { if (running || !visible) return; running = true; requestAnimationFrame(frame); }
    function stop() { running = false; }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener("resize", resize);
    if (window.IntersectionObserver) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) start(); else stop(); }).observe(canvas);
    document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });

    setLayout(opts.layout);
    resize(); aim(); start();

    return {
      useTemplate: function (name) { if (TEMPLATES[name]) { setLayout(JSON.parse(JSON.stringify(TEMPLATES[name]))); changed(); select(-1); } },
      mute: Snd.mute, muted: Snd.muted,
      poke: function (type) { for (var i = 0; i < objs.length; i++) if (objs[i].userData.type === type) { interact(i); return true; } return false; },
      add: add, rotate: rotate, remove: remove, select: select, setStyle: setStyle, setLayout: setLayout, getLayout: getLayout,
      zoom: function (f) { orbit.dist = Math.max(8, Math.min(40, orbit.dist * f)); orbit.userZoom = true; aim(); },
      count: function () { return layout.items.length; },
      snapshot: function () { renderer.render(scene, camera); return canvas.toDataURL("image/jpeg", 0.9); },
      dispose: function () { stop(); renderer.dispose(); },
      start: start, stop: stop
    };
  }

  window.Room = { create: create, thumbnails: thumbnails, randomRoom: randomRoom, TEMPLATES: Object.keys(TEMPLATES), CATALOG: CATALOG, ORDER: ORDER, WALLS: Object.keys(WALLS), FLOORS: FLOORS, DEFAULT: DEFAULT };
})();
