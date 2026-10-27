/* "Light up Armenia": map data, light icons, the canvas map view and the story card.
   Used by the map page, the home teaser and the personal page of a light order.
   World units are kilometres; x grows east, y grows south. Plot id = row * cols + col. */
(function () {
  "use strict";

  var ICONS = ["tree", "home", "candle", "star", "gift", "pomegranate"];
  var COLORS = ["amber", "red", "green", "white", "blue", "violet"];
  var HEX = { amber: "#ffc46b", red: "#ff6b57", green: "#74e6a0", white: "#fff4e2", blue: "#7cc2ff", violet: "#c7a0ff" };
  var SANS = null;
  function sans() { if (!SANS) SANS = getComputedStyle(document.documentElement).getPropertyValue("--sans") || "sans-serif"; return SANS; }
  var DPR = function () { return Math.min(window.devicePixelRatio || 1, 2); };

  /* ---------- data ---------- */
  var mapPromise = null;
  // The plot data ships as a small script (window.MAP_DATA) rather than JSON: a script tag loads in every
  // host, including sandboxed previews where fetch() of a same-site file is blocked.
  function loadMap(url) {
    if (!mapPromise) {
      mapPromise = new Promise(function (resolve, reject) {
        if (window.MAP_DATA) return resolve(window.MAP_DATA);
        var s = document.createElement("script");
        s.src = url; s.async = true;
        s.onload = function () { window.MAP_DATA ? resolve(window.MAP_DATA) : reject(new Error("map data missing")); };
        s.onerror = function () { mapPromise = null; reject(new Error("map data failed to load")); };
        document.head.appendChild(s);
      }).then(index);
    }
    return mapPromise;
  }
  function index(m) {
    var n = m.cols * m.rows;
    m.prov = new Int8Array(n).fill(-1);
    m.town = new Int8Array(n).fill(-1);
    m.ids = [];
    m.provCount = new Array(m.provinces.length).fill(0);
    var sx = new Array(m.provinces.length).fill(0), sy = new Array(m.provinces.length).fill(0);
    for (var i = 0; i < m.cells.length; i += 3) {
      var id = m.cells[i], p = m.cells[i + 1];
      m.prov[id] = p; m.town[id] = m.cells[i + 2]; m.ids.push(id); m.provCount[p]++;
      sx[p] += (id % m.cols + 0.5) * m.cell_km; sy[p] += (Math.floor(id / m.cols) + 0.5) * m.cell_km;
    }
    m.provCenter = m.provinces.map(function (_, p) { return [sx[p] / Math.max(1, m.provCount[p]), sy[p] / Math.max(1, m.provCount[p])]; });
    m.total = m.ids.length;
    m.outlinePath = pathOf([m.outline]);
    m.sevanPath = pathOf([m.sevan]);
    m.provPaths = m.provinces.map(function (p) { return pathOf(p.rings); });
    return m;
  }
  function pathOf(rings) {
    var p = new Path2D();
    rings.forEach(function (r) { r.forEach(function (pt, i) { if (i) p.lineTo(pt[0], pt[1]); else p.moveTo(pt[0], pt[1]); }); p.closePath(); });
    return p;
  }
  function isCell(m, id) { return id >= 0 && id < m.prov.length && m.prov[id] >= 0; }
  function cellCenter(m, id) { return [(id % m.cols + 0.5) * m.cell_km, (Math.floor(id / m.cols) + 0.5) * m.cell_km]; }
  function townName(m, id, lang) { var ti = m.town[id]; return ti >= 0 ? m.towns[ti][lang] : null; }
  function provName(m, id, lang) { var p = m.prov[id]; return p >= 0 ? m.provinces[p][lang] : ""; }
  function placeName(m, id, lang) { return townName(m, id, lang) || provName(m, id, lang); }
  function hash(id) { var x = Math.sin(id * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ---------- icons: neon silhouettes in the light colour ---------- */
  function iconPath(ctx, icon) {
    ctx.beginPath();
    if (icon === "tree") {
      ctx.moveTo(0, -0.98); ctx.lineTo(0.42, -0.38); ctx.lineTo(0.24, -0.38); ctx.lineTo(0.6, 0.16); ctx.lineTo(0.36, 0.16);
      ctx.lineTo(0.76, 0.68); ctx.lineTo(-0.76, 0.68); ctx.lineTo(-0.36, 0.16); ctx.lineTo(-0.6, 0.16); ctx.lineTo(-0.24, -0.38);
      ctx.lineTo(-0.42, -0.38); ctx.closePath(); ctx.rect(-0.11, 0.68, 0.22, 0.26);
    } else if (icon === "home") {
      ctx.moveTo(-0.74, 0.88); ctx.lineTo(-0.74, -0.08); ctx.lineTo(0, -0.82); ctx.lineTo(0.74, -0.08); ctx.lineTo(0.74, 0.88); ctx.closePath();
    } else if (icon === "candle") {
      ctx.rect(-0.24, -0.08, 0.48, 1.0);
      ctx.moveTo(0, -0.98); ctx.quadraticCurveTo(0.34, -0.5, 0, -0.2); ctx.quadraticCurveTo(-0.34, -0.5, 0, -0.98);
    } else if (icon === "star") {
      for (var i = 0; i < 10; i++) {
        var r = i % 2 ? 0.42 : 1, a = -Math.PI / 2 + i * Math.PI / 5;
        if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r + 0.06); else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r + 0.06);
      }
      ctx.closePath();
    } else if (icon === "gift") {
      ctx.rect(-0.66, -0.16, 1.32, 1.04); ctx.rect(-0.8, -0.44, 1.6, 0.3);
      ctx.moveTo(0, -0.44); ctx.bezierCurveTo(-0.2, -0.95, -0.62, -0.78, -0.36, -0.44); ctx.closePath();
      ctx.moveTo(0, -0.44); ctx.bezierCurveTo(0.2, -0.95, 0.62, -0.78, 0.36, -0.44); ctx.closePath();
    } else { // pomegranate
      ctx.arc(0, 0.16, 0.72, 0, Math.PI * 2);
      ctx.moveTo(-0.26, -0.5); ctx.lineTo(-0.2, -0.86); ctx.lineTo(-0.06, -0.64); ctx.lineTo(0, -0.92); ctx.lineTo(0.06, -0.64);
      ctx.lineTo(0.2, -0.86); ctx.lineTo(0.26, -0.5); ctx.closePath();
    }
  }
  function iconDetail(ctx, icon) {
    // Warm inner details drawn over the silhouette (window, ribbon, seeds, baubles).
    ctx.fillStyle = "rgba(30,14,4,.55)";
    if (icon === "home") { ctx.fillRect(-0.2, 0.08, 0.4, 0.4); ctx.fillStyle = "rgba(255,248,225,.95)"; ctx.fillRect(-0.15, 0.13, 0.3, 0.3); }
    else if (icon === "gift") { ctx.fillRect(-0.08, -0.44, 0.16, 1.32); }
    else if (icon === "pomegranate") { [[-0.22, 0.1], [0.18, 0.02], [0.02, 0.36], [-0.3, 0.42], [0.32, 0.38]].forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 0.07, 0, 7); ctx.fill(); }); }
    else if (icon === "tree") { ctx.fillStyle = "rgba(255,250,235,.95)"; [[-0.2, 0.0], [0.22, -0.18], [0.3, 0.48], [-0.34, 0.5], [0.0, 0.28]].forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 0.06, 0, 7); ctx.fill(); }); }
    else if (icon === "candle") { ctx.fillStyle = "rgba(255,250,235,.95)"; ctx.beginPath(); ctx.ellipse(0, -0.44, 0.07, 0.16, 0, 0, 7); ctx.fill(); }
  }
  var spriteCache = {};
  // Pre-rendered icon with its glow; size = icon height in CSS px.
  function iconSprite(icon, color, size) {
    // Sizes snap to a few buckets so zooming never creates new sprites each frame.
    var need = size * DPR(), px = 12;
    while (px < need && px < 192) px = Math.round(px * 1.3);
    var key = icon + "|" + color + "|" + px;
    if (spriteCache[key]) return spriteCache[key];
    var pad = px * 0.7, W = Math.ceil(px + pad * 2);
    var c = document.createElement("canvas"); c.width = c.height = W;
    var ctx = c.getContext("2d"), hex = HEX[color] || HEX.amber;
    ctx.translate(W / 2, W / 2); ctx.scale(px / 2, px / 2);
    ctx.shadowColor = hex; ctx.shadowBlur = px * 0.55;
    iconPath(ctx, icon); ctx.fillStyle = hex; ctx.fill("nonzero");
    ctx.shadowBlur = px * 0.18; ctx.fill("nonzero");
    ctx.shadowBlur = 0;
    var g = ctx.createLinearGradient(0, -1, 0, 1);
    g.addColorStop(0, "rgba(255,255,255,.55)"); g.addColorStop(0.55, "rgba(255,255,255,0)");
    iconPath(ctx, icon); ctx.fillStyle = g; ctx.fill("nonzero");
    iconDetail(ctx, icon);
    c.cssSize = W / DPR();
    spriteCache[key] = c;
    return c;
  }
  var glowCache = {};
  function glowSprite(color) {
    if (glowCache[color]) return glowCache[color];
    var c = document.createElement("canvas"); c.width = c.height = 64;
    var ctx = c.getContext("2d"), hex = HEX[color] || HEX.amber;
    var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.12, hex); g.addColorStop(0.4, hexA(hex, 0.32)); g.addColorStop(1, hexA(hex, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    glowCache[color] = c; return c;
  }
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
  }
  // A small canvas with one icon, for buttons and cards.
  function iconCanvas(icon, color, size) {
    var s = iconSprite(icon, color, size * 0.62);
    var c = document.createElement("canvas"), d = DPR(), w = size * 0.62 * d * 2.4;
    c.width = c.height = Math.round(size * d); c.style.width = c.style.height = size + "px";
    var ctx = c.getContext("2d");
    ctx.drawImage(s, (c.width - w) / 2, (c.height - w) / 2, w, w);
    c.setAttribute("aria-hidden", "true");
    return c;
  }

  /* ---------- sky ---------- */
  function stars(w, h, n, seed) {
    var out = [];
    for (var i = 0; i < n; i++) out.push([hash(i + seed) * w, hash(i * 3.1 + seed) * h, 0.3 + hash(i * 7.3 + seed) * 1.1, hash(i * 11.7 + seed)]);
    return out;
  }

  /* ---------- the map view ---------- */
  function MapView(canvas, m, opts) {
    opts = opts || {};
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.m = m; this.o = opts;
    this.lang = opts.lang || "hy";
    this.lights = new Map();   // id -> {i:iconIndex, c:colorIndex, b:big, born:ms}
    this.held = new Set();
    this.flares = [];
    this.sel = -1; this.hover = -1; this.ghost = null;
    this.view = { s: 1, x: 0, y: 0 };
    this.anim = null; this.dirty = true; this.visible = true; this.running = false;
    this.static = document.createElement("canvas");
    this.t0 = performance.now();
    var self = this;
    this.resize();
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(canvas);
    else window.addEventListener("resize", function () { self.resize(); });
    if (window.IntersectionObserver) new IntersectionObserver(function (e) { self.visible = e[0].isIntersecting; if (self.visible) self.start(); }).observe(canvas);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) self.start(); });
    if (opts.interactive) this.bind();
    this.start();
  }
  var P = MapView.prototype;

  P.resize = function () {
    var r = this.c.getBoundingClientRect(), d = DPR();
    if (!r.width || !r.height) return;
    var first = !this.W;
    var oldCx = this.W ? this.toWorld(this.W / 2, this.H / 2) : null;
    this.W = r.width; this.H = r.height;
    this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
    this.static.width = this.c.width; this.static.height = this.c.height;
    this.sky = stars(this.W, this.H, Math.round(this.W * this.H / 2600), 3);
    this.fitS = Math.min((this.W - (this.o.pad || 24) * 2) / this.m.width_km, (this.H - (this.o.pad || 24) * 2) / this.m.height_km);
    if (first || !oldCx) this.fit(true);
    else { this.view.x = this.W / 2 - oldCx[0] * this.view.s; this.view.y = this.H / 2 - oldCx[1] * this.view.s; this.clamp(); }
    this.dirty = true; this.start();
  };
  P.toWorld = function (sx, sy) { return [(sx - this.view.x) / this.view.s, (sy - this.view.y) / this.view.s]; };
  P.cellAt = function (sx, sy) {
    var w = this.toWorld(sx, sy), m = this.m;
    var col = Math.floor(w[0] / m.cell_km), row = Math.floor(w[1] / m.cell_km);
    if (col < 0 || row < 0 || col >= m.cols || row >= m.rows) return -1;
    var id = row * m.cols + col;
    return isCell(m, id) ? id : -1;
  };
  P.maxS = function () { return 70; };
  P.minS = function () { return this.fitS * 0.85; };
  P.target = function (wx, wy, s) {
    s = Math.max(this.minS(), Math.min(this.maxS(), s));
    var x = this.W / 2 - wx * s, y = this.H / 2 - wy * s;
    if (this.o.offsetX) x -= this.o.offsetX() / 2;
    if (this.o.offsetY) y -= this.o.offsetY(this.H);
    return { s: s, x: x, y: y };
  };
  P.fit = function (instant) {
    var v = this.target(this.m.width_km / 2, this.m.height_km / 2, this.fitS);
    if (instant) { this.view = v; this.dirty = true; } else this.flyTo(v);
  };
  P.clamp = function () {
    // Keep at least a quarter of the view covered by the map.
    var v = this.view, mw = this.m.width_km * v.s, mh = this.m.height_km * v.s;
    v.x = Math.min(this.W * 0.75, Math.max(this.W * 0.25 - mw, v.x));
    v.y = Math.min(this.H * 0.75, Math.max(this.H * 0.25 - mh, v.y));
  };
  P.flyTo = function (to, dur) {
    var from = { s: this.view.s, x: this.view.x, y: this.view.y }, self = this;
    if (window.APP && window.APP.reduceMotion) { this.view = to; this.dirty = true; this.start(); return; }
    // Interpolate in world space around the screen centre for a natural zoom.
    var cf = this.toWorld(this.W / 2, this.H / 2), ct = [(this.W / 2 - to.x) / to.s, (this.H / 2 - to.y) / to.s];
    this.anim = { t0: performance.now(), dur: dur || 900, step: function (k) {
      var e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      var s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e);
      var wx = cf[0] + (ct[0] - cf[0]) * e, wy = cf[1] + (ct[1] - cf[1]) * e;
      self.view = { s: s, x: self.W / 2 - wx * s, y: self.H / 2 - wy * s };
      if (k >= 1) self.view = to;
    } };
    this.start();
  };
  P.flyToCell = function (id, cellPx) {
    var c = cellCenter(this.m, id);
    this.flyTo(this.target(c[0], c[1], (cellPx || 34) / this.m.cell_km));
  };
  P.zoomAt = function (f, sx, sy) {
    var v = this.view, s = Math.max(this.minS(), Math.min(this.maxS(), v.s * f));
    var w = this.toWorld(sx, sy);
    v.s = s; v.x = sx - w[0] * s; v.y = sy - w[1] * s;
    this.anim = null; this.clamp(); this.dirty = true; this.start();
  };
  P.setLights = function (lit, held, animateNew) {
    var now = performance.now(), next = new Map(), fresh = [], self = this, initial = this.lights.size === 0 && !this.loadedOnce;
    (lit || []).forEach(function (r) {
      var id = r[0]; if (!isCell(self.m, id)) return;
      var old = self.lights.get(id);
      var born = old ? old.born : (initial ? now + hash(id) * 1400 : now);
      next.set(id, { i: r[1] | 0, c: r[2] | 0, b: r[3] ? 1 : 0, born: born });
      if (!old && !initial) fresh.push(id);
    });
    this.lights = next;
    this.held = new Set((held || []).filter(function (id) { return isCell(self.m, id); }));
    if (animateNew !== false) fresh.forEach(function (id) { self.flares.push({ id: id, t: now }); });
    var ids = Array.from(next.keys()), sp = [];
    for (var k = 0; k < Math.min(160, ids.length); k++) sp.push(ids[Math.floor(hash(k * 13.7 + ids.length) * ids.length)]);
    this.sparks = sp;
    this.lightsDirty = true; this.loadedOnce = true; this.start();
    return fresh;
  };
  P.select = function (id) { this.sel = id; this.start(); };
  P.setGhost = function (g) { this.ghost = g; this.start(); };
  P.flare = function (id) { this.flares.push({ id: id, t: performance.now() }); this.start(); };

  P.start = function () {
    if (this.running || !this.visible || document.hidden) return;
    this.running = true;
    var self = this;
    requestAnimationFrame(function loop(now) {
      if (!self.visible || document.hidden) { self.running = false; return; }
      if (self.anim) {
        var k = Math.min(1, (now - self.anim.t0) / self.anim.dur);
        self.anim.step(k); self.dirty = true;
        if (k >= 1) self.anim = null;
      }
      // Twinkling alone runs at ~30 fps to save battery; movement runs at full rate.
      if (self.dirty || self.lightsDirty || self.flares.length || now - (self.last || 0) > 32) { self.last = now; self.frame(now); }
      requestAnimationFrame(loop);
    });
  };

  P.drawStatic = function () {
    var ctx = this.static.getContext("2d"), m = this.m, v = this.view, d = DPR(), cpx = m.cell_km * v.s;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    // sky
    var g = ctx.createRadialGradient(this.W * 0.5, this.H * 0.35, 0, this.W * 0.5, this.H * 0.4, Math.max(this.W, this.H) * 0.8);
    g.addColorStop(0, "#0b1430"); g.addColorStop(1, "#03050c");
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = "#fff";
    this.sky.forEach(function (s) { ctx.globalAlpha = 0.15 + s[3] * 0.45; ctx.fillRect(s[0], s[1], s[2], s[2]); });
    ctx.globalAlpha = 1;
    // land
    ctx.setTransform(d * v.s, 0, 0, d * v.s, d * v.x, d * v.y);
    ctx.save();
    ctx.shadowColor = "rgba(255,160,70,.22)"; ctx.shadowBlur = 40 * d;
    var lg = ctx.createLinearGradient(0, 0, 0, m.height_km);
    lg.addColorStop(0, "#111b36"); lg.addColorStop(1, "#0b1226");
    ctx.fillStyle = lg; ctx.fill(m.outlinePath, "evenodd");
    ctx.restore();
    // relief: soft vignette inside the border
    ctx.save(); ctx.clip(m.outlinePath);
    var rg = ctx.createRadialGradient(m.width_km * 0.45, m.height_km * 0.45, 10, m.width_km * 0.5, m.height_km * 0.5, m.width_km * 0.75);
    rg.addColorStop(0, "rgba(120,140,200,.06)"); rg.addColorStop(1, "rgba(0,0,0,.35)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, m.width_km, m.height_km);
    // free plots
    if (cpx >= 6) {
      var x0 = Math.max(0, Math.floor(-v.x / v.s / m.cell_km)), x1 = Math.min(m.cols - 1, Math.ceil((this.W - v.x) / v.s / m.cell_km));
      var y0 = Math.max(0, Math.floor(-v.y / v.s / m.cell_km)), y1 = Math.min(m.rows - 1, Math.ceil((this.H - v.y) / v.s / m.cell_km));
      // Free plots read as a faint dotted grid; dots grow a little as you zoom in.
      var inset = m.cell_km * (cpx > 24 ? 0.36 : 0.3), a = Math.min(0.11, 0.04 + (cpx - 6) * 0.003);
      ctx.fillStyle = "rgba(243,236,224," + a + ")";
      for (var r = y0; r <= y1; r++) for (var c = x0; c <= x1; c++) {
        if (m.prov[r * m.cols + c] >= 0) ctx.fillRect(c * m.cell_km + inset, r * m.cell_km + inset, m.cell_km - inset * 2, m.cell_km - inset * 2);
      }
    }
    ctx.restore();
    // province borders
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(243,236,224,.13)"; ctx.lineWidth = 1 / v.s;
    m.provPaths.forEach(function (p) { ctx.stroke(p); });
    // lake Sevan
    ctx.fillStyle = "#06132a"; ctx.fill(m.sevanPath);
    ctx.strokeStyle = "rgba(124,194,255,.32)"; ctx.lineWidth = 1 / v.s; ctx.stroke(m.sevanPath);
    // border
    ctx.strokeStyle = "rgba(233,199,123,.6)"; ctx.lineWidth = 1.3 / v.s; ctx.stroke(m.outlinePath);
    this.dirty = false;
  };

  // The lit map (static layer + every light + towns + labels) is composed into one cached canvas and
  // rebuilt only when the view or the lights change; each frame then adds only a few sparkles on top.
  P.compose = function (now) {
    if (this.dirty) this.drawStatic();
    if (!this.layer) this.layer = document.createElement("canvas");
    var L0 = this.layer;
    if (L0.width !== this.c.width || L0.height !== this.c.height) { L0.width = this.c.width; L0.height = this.c.height; }
    var ctx = L0.getContext("2d"), m = this.m, v = this.view, d = DPR(), self = this;
    var cpx = m.cell_km * v.s, popping = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, L0.width, L0.height);
    ctx.drawImage(this.static, 0, 0);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.textBaseline = "middle";
    var labelAll = cpx >= 9, fontPx = Math.max(11, Math.min(14, cpx * 0.7));
    ctx.globalCompositeOperation = "lighter";
    var x0 = -40, y0 = -40, x1 = this.W + 40, y1 = this.H + 40, showIcons = cpx >= 15;
    this.lights.forEach(function (L, id) {
      var cx = (id % m.cols + 0.5) * m.cell_km * v.s + v.x, cy = (Math.floor(id / m.cols) + 0.5) * m.cell_km * v.s + v.y;
      if (cx < x0 || cy < y0 || cx > x1 || cy > y1) return;
      var age = (now - L.born) / 600;
      if (age < 1) popping = true;
      if (age < 0) return;
      var pop = age < 1 ? 1 + Math.sin(age * Math.PI) * 0.8 : 1, al = Math.min(1, age);
      var col = COLORS[L.c] || "amber";
      var R = Math.max(L.b ? 7 : 3.2, cpx * (L.b ? 1.6 : 0.85)) * pop;
      ctx.globalAlpha = al * 0.88;
      ctx.drawImage(glowSprite(col), cx - R, cy - R, R * 2, R * 2);
      if (showIcons || (L.b && cpx >= 7)) {
        ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = al;
        var sz = Math.max(10, cpx * (L.b ? 0.95 : 0.6) * pop), w = sz * 2.4;
        ctx.drawImage(iconSprite(ICONS[L.i] || "star", col, sz), cx - w / 2, cy - w / 2, w, w);
        ctx.globalCompositeOperation = "lighter";
      }
    });
    ctx.globalAlpha = 0.55;
    m.towns.forEach(function (tw, i) {
      var sx = tw.x * v.s + v.x, sy = tw.y * v.s + v.y, R = i === 0 ? 5 : 2.6;
      if (sx < x0 || sy < y0 || sx > x1 || sy > y1) return;
      ctx.drawImage(glowSprite("amber"), sx - R * 2, sy - R * 2, R * 4, R * 4);
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // labels
    if (this.o.labels !== false) {
      if (cpx < 9) {
        ctx.textAlign = "center"; ctx.fillStyle = "rgba(243,236,224,.34)";
        ctx.font = "600 " + Math.max(10, Math.min(13, v.s * 4.2)) + "px " + sans();
        m.provinces.forEach(function (p, i) {
          if (p.code === "yer") return;
          var c = m.provCenter[i]; ctx.fillText(p[self.lang].toUpperCase(), c[0] * v.s + v.x, c[1] * v.s + v.y);
        });
      }
      ctx.font = "500 " + fontPx + "px " + sans();
      ctx.textAlign = "left";
      m.towns.forEach(function (tw, i) {
        if (!labelAll && i > 0) return;
        var sx = tw.x * v.s + v.x, sy = tw.y * v.s + v.y;
        if (sx < -80 || sy < -20 || sx > self.W + 20 || sy > self.H + 20) return;
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(3,5,12,.85)"; ctx.strokeText(tw[self.lang], sx + 7, sy);
        ctx.fillStyle = i === 0 ? "rgba(255,226,170,.95)" : "rgba(243,236,224,.8)"; ctx.fillText(tw[self.lang], sx + 7, sy);
      });
    }
    this.lightsDirty = popping;
    this.composedAt = now;
  };

  P.frame = function (now) {
    if (this.dirty || this.lightsDirty || !this.layer) this.compose(now);
    var ctx = this.ctx, m = this.m, v = this.view, d = DPR(), t = (now - this.t0) / 1000;
    var cpx = m.cell_km * v.s, self = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.c.width, this.c.height);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(d, 0, 0, d, 0, 0);

    // sparkles: a rotating handful of lights brightens and fades
    if (this.sparks && this.sparks.length) {
      ctx.globalCompositeOperation = "lighter";
      this.sparks.forEach(function (id) {
        var L = self.lights.get(id); if (!L) return;
        var k = Math.sin(t * (0.8 + hash(id + 9) * 1.2) + hash(id) * 6.283); if (k <= 0.2) return;
        var cx = (id % m.cols + 0.5) * m.cell_km * v.s + v.x, cy = (Math.floor(id / m.cols) + 0.5) * m.cell_km * v.s + v.y;
        if (cx < -30 || cy < -30 || cx > self.W + 30 || cy > self.H + 30) return;
        var R = Math.max(L.b ? 9 : 4.5, cpx * (L.b ? 1.9 : 1.1));
        ctx.globalAlpha = (k - 0.2) * 0.7;
        ctx.drawImage(glowSprite(COLORS[L.c] || "amber"), cx - R, cy - R, R * 2, R * 2);
      });
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    }

    // flares for new lights
    this.flares = this.flares.filter(function (f) {
      var k = (now - f.t) / 1800; if (k > 1) return false;
      var c = cellCenter(m, f.id), sx = c[0] * v.s + v.x, sy = c[1] * v.s + v.y;
      ctx.strokeStyle = "rgba(255,210,140," + (1 - k) * 0.9 + ")"; ctx.lineWidth = 2 * (1 - k) + 0.5;
      ctx.beginPath(); ctx.arc(sx, sy, 6 + k * 46, 0, 7); ctx.stroke();
      return true;
    });

    // plots taken right now
    if (this.held.size) {
      ctx.strokeStyle = "rgba(255,255,255," + (0.35 + 0.25 * Math.sin(t * 4)) + ")"; ctx.lineWidth = 1;
      this.held.forEach(function (id) {
        if (self.lights.has(id)) return;
        var c = cellCenter(m, id), sx = c[0] * v.s + v.x, sy = c[1] * v.s + v.y;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, cpx * 0.3), 0, 7); ctx.stroke();
      });
    }

    // ghost: the light being designed
    if (this.ghost && isCell(m, this.ghost.id)) {
      var gc = cellCenter(m, this.ghost.id), gx = gc[0] * v.s + v.x, gy = gc[1] * v.s + v.y;
      var gcol = this.ghost.color, gb = this.ghost.big, gtw = 0.75 + 0.25 * Math.sin(t * 3);
      var gR = Math.max(gb ? 9 : 5, cpx * (gb ? 1.6 : 0.85));
      ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = gtw;
      ctx.drawImage(glowSprite(gcol), gx - gR, gy - gR, gR * 2, gR * 2);
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      if (cpx >= 7) {
        var gsz = cpx * (gb ? 0.95 : 0.6), gsp = iconSprite(this.ghost.icon, gcol, Math.max(10, gsz)), gw = Math.max(10, gsz) * 2.4;
        ctx.drawImage(gsp, gx - gw / 2, gy - gw / 2, gw, gw);
      }
    }

    // hover and selection squares
    [[this.hover, "rgba(243,236,224,.5)", 1], [this.sel, "rgba(255,196,107,.95)", 2]].forEach(function (h) {
      if (h[0] < 0) return;
      var c = cellCenter(m, h[0]), half = Math.max(5, cpx / 2), sx = c[0] * v.s + v.x, sy = c[1] * v.s + v.y;
      ctx.strokeStyle = h[1]; ctx.lineWidth = h[2];
      if (h[2] === 2) { ctx.setLineDash([4, 3]); ctx.lineDashOffset = -t * 10; ctx.shadowColor = "rgba(255,196,107,.8)"; ctx.shadowBlur = 8; }
      ctx.strokeRect(sx - half, sy - half, half * 2, half * 2);
      ctx.setLineDash([]); ctx.shadowBlur = 0;
    });

    if (this.o.onFrame) this.o.onFrame(now);
  };

  /* ---------- interaction ---------- */
  P.bind = function () {
    var self = this, c = this.c, pts = new Map(), down = null, pinch = null;
    c.style.touchAction = "none";
    function pos(e) { var r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    c.addEventListener("pointerdown", function (e) {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, pos(e));
      self.anim = null;
      if (pts.size === 1) down = { p: pos(e), t: performance.now(), moved: 0, last: pos(e) };
      if (pts.size === 2) {
        var a = Array.from(pts.values());
        pinch = { d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), m: [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2] };
        if (down) down.moved = 99;
      }
    });
    c.addEventListener("pointermove", function (e) {
      var p = pos(e);
      if (!pts.has(e.pointerId)) {
        if (e.pointerType === "mouse") {
          var h = self.cellAt(p[0], p[1]);
          if (h !== self.hover) { self.hover = h; c.style.cursor = h >= 0 ? "pointer" : "grab"; self.start(); }
        }
        return;
      }
      pts.set(e.pointerId, p);
      if (pts.size === 2 && pinch) {
        var a = Array.from(pts.values());
        var dd = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), mm = [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2];
        self.view.x += mm[0] - pinch.m[0]; self.view.y += mm[1] - pinch.m[1];
        self.zoomAt(dd / pinch.d, mm[0], mm[1]);
        pinch = { d: dd, m: mm };
      } else if (down) {
        var dx = p[0] - down.last[0], dy = p[1] - down.last[1];
        down.moved += Math.abs(dx) + Math.abs(dy); down.last = p;
        if (down.moved > 6) { self.view.x += dx; self.view.y += dy; self.clamp(); self.dirty = true; c.style.cursor = "grabbing"; self.start(); }
      }
    });
    function up(e) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0 && down) {
        if (down.moved <= 6 && performance.now() - down.t < 600 && self.o.onTap) {
          var id = self.cellAt(down.p[0], down.p[1]);
          self.o.onTap(id);
        }
        down = null; c.style.cursor = self.hover >= 0 ? "pointer" : "grab";
      }
    }
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("pointerleave", function () { if (self.hover >= 0) { self.hover = -1; self.start(); } });
    c.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = pos(e), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      self.zoomAt(Math.exp(-dy * 0.0016), p[0], p[1]);
    }, { passive: false });
    c.addEventListener("dblclick", function (e) { var p = pos(e); self.zoomAt(2, p[0], p[1]); });
    c.addEventListener("keydown", function (e) {
      var k = e.key, step = 60;
      if (k === "+" || k === "=") self.zoomAt(1.4, self.W / 2, self.H / 2);
      else if (k === "-") self.zoomAt(1 / 1.4, self.W / 2, self.H / 2);
      else if (k === "ArrowLeft") self.view.x += step; else if (k === "ArrowRight") self.view.x -= step;
      else if (k === "ArrowUp") self.view.y += step; else if (k === "ArrowDown") self.view.y -= step;
      else return;
      e.preventDefault(); self.clamp(); self.dirty = true; self.start();
    });
  };

  /* ---------- story card (1080 × 1920) ---------- */
  function storyCard(m, lightsList, mine, texts) {
    var W = 1080, H = 1920, c = document.createElement("canvas"); c.width = W; c.height = H;
    var ctx = c.getContext("2d");
    var css = getComputedStyle(document.documentElement), serif = css.getPropertyValue("--serif") || "serif", sans = css.getPropertyValue("--sans") || "sans-serif";
    var g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0b1430"); g.addColorStop(1, "#03050c");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    stars(W, H, 420, 11).forEach(function (s) { ctx.globalAlpha = 0.12 + s[3] * 0.5; ctx.fillRect(s[0], s[1], s[2] * 2, s[2] * 2); });
    ctx.globalAlpha = 1;
    var s = 960 / m.width_km, ox = 60, oy = 640;
    ctx.save(); ctx.translate(ox, oy); ctx.scale(s, s);
    ctx.shadowColor = "rgba(255,160,70,.3)"; ctx.shadowBlur = 60;
    ctx.fillStyle = "#101a34"; ctx.fill(m.outlinePath, "evenodd"); ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(243,236,224,.12)"; ctx.lineWidth = 1.5 / s; m.provPaths.forEach(function (p) { ctx.stroke(p); });
    ctx.fillStyle = "#06132a"; ctx.fill(m.sevanPath);
    ctx.strokeStyle = "rgba(233,199,123,.7)"; ctx.lineWidth = 2.5 / s; ctx.stroke(m.outlinePath);
    ctx.restore();
    ctx.globalCompositeOperation = "lighter";
    lightsList.forEach(function (L) {
      var p = cellCenter(m, L[0]), R = L[3] ? 16 : 9;
      ctx.drawImage(glowSprite(COLORS[L[2]] || "amber"), ox + p[0] * s - R, oy + p[1] * s - R, R * 2, R * 2);
    });
    ctx.globalCompositeOperation = "source-over";
    if (mine) {
      var mp = cellCenter(m, mine.id), mx = ox + mp[0] * s, my = oy + mp[1] * s, col = mine.color;
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(glowSprite(col), mx - 120, my - 120, 240, 240);
      ctx.globalCompositeOperation = "source-over";
      var sp = iconSprite(mine.icon, col, 120), w = 108 * 2.4;
      ctx.drawImage(sp, mx - w / 2, my - w / 2, w, w);
      ctx.strokeStyle = "rgba(255,226,170,.9)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(mx, my, 70, 0, 7); ctx.stroke();
    }
    ctx.textAlign = "left"; ctx.fillStyle = "#f3ece0";
    ctx.font = "600 78px " + serif; ctx.fillText(texts.title, 80, 250);
    ctx.fillStyle = "#ffc46b"; ctx.font = "700 " + (texts.place.length > 12 ? 104 : 140) + "px " + serif; ctx.fillText(texts.place, 76, 420);
    if (texts.sub) { ctx.fillStyle = "#a9b0c3"; ctx.font = "500 40px " + sans; ctx.fillText(texts.sub, 82, 500); }
    ctx.textAlign = "center"; ctx.fillStyle = "rgba(243,236,224,.92)"; ctx.font = "600 52px " + serif;
    ctx.fillText(texts.cta, W / 2, H - 170);
    ctx.fillStyle = "#a9b0c3"; ctx.font = "500 36px " + sans; ctx.fillText(texts.brand, W / 2, H - 100);
    return c;
  }

  window.MapCore = {
    ICONS: ICONS, COLORS: COLORS, HEX: HEX, loadMap: loadMap, isCell: isCell, cellCenter: cellCenter,
    townName: townName, provName: provName, placeName: placeName, iconCanvas: iconCanvas,
    MapView: MapView, storyCard: storyCard, hash: hash
  };
})();
