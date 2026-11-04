/* Demo while payments are closed: walk the whole flow (place, payment step, room, wish) without paying.
   A demo order never reaches the server. It lives only in this browser for 24 hours, is visible only here,
   and is never counted anywhere. Loaded only while payments are closed; site.js forgets leftovers after. */
(function () {
  "use strict";
  var KEY = "demoOrders", TTL = 24 * 3600 * 1000, PREFIX = "demo";
  var real = window.fetch.bind(window);

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function isDemo(code) { return typeof code === "string" && code.indexOf(PREFIX) === 0; }

  // Forget demo places from "my rooms" and the other per-device lists.
  function forget(codes) {
    try {
      var mine = JSON.parse(localStorage.getItem("myLights") || "{}") || {};
      Object.keys(mine).forEach(function (id) { if (codes.indexOf(mine[id]) >= 0 || (!codes.length && isDemo(mine[id]))) { delete mine[id]; localStorage.removeItem("room:" + id); } });
      localStorage.setItem("myLights", JSON.stringify(mine));
      var papers = (JSON.parse(localStorage.getItem("papers") || "[]") || []).filter(function (c) { return !isDemo(c); });
      localStorage.setItem("papers", JSON.stringify(papers));
      codes.forEach(function (c) { localStorage.removeItem("fire:" + c); });
    } catch (e) {}
  }
  var store = load(), old = Object.keys(store).filter(function (c) { return Date.now() - store[c].t > TTL; });
  if (old.length) { old.forEach(function (c) { delete store[c]; }); save(store); forget(old); }

  function newCode() {
    var a = "abcdefghijkmnpqrstuvwxyz0123456789", s = PREFIX, r = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(r);
    for (var i = 0; i < 12; i++) s += a[r[i] % a.length];
    return s;
  }
  function byCell(id) { var s = load(); return Object.keys(s).map(function (c) { return s[c]; }).filter(function (o) { return o.cell_id === id; })[0] || null; }
  function json(body, status) { return Promise.resolve(new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } })); }
  function order(o) {
    return { code: o.code, product: "light", status: "paid", amount_amd: o.amount_amd, lang: o.lang, email: o.email, text: o.text,
      cell_id: o.cell_id, light_icon: o.light_icon, light_color: o.light_color, light_signature: o.light_signature,
      room: o.room, created_at: new Date(o.t).toISOString(), paid_at: new Date(o.t).toISOString(), gift_share_amd: null, demo: true };
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input.url;
    if (url.indexOf(".supabase.co") < 0) return real(input, init);
    var body = {}; try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
    var path = url.split(".supabase.co")[1].split("?")[0], q = new URLSearchParams(url.split("?")[1] || "");
    var s = load(), code = body.code || q.get("code");

    if (path === "/functions/v1/create-order" && body.demo === true) {
      var c = newCode();
      s[c] = { code: c, t: Date.now(), amount_amd: 600, lang: body.lang, email: body.email, text: body.text, cell_id: body.cell_id,
        light_icon: body.light_icon, light_color: body.light_color, light_signature: body.light_signature, room: body.room || null };
      save(s);
      return json({ code: c, amount_amd: 600, status: "paid", payment: { mode: "demo" } });
    }
    if (isDemo(code)) {
      var o = s[code];
      if (!o) return json({ error: { code: "NOT_FOUND", message: "Not found." } }, 404);
      if (path === "/functions/v1/order-status") return json(order(o));
      if (path === "/functions/v1/start-payment") return json({ error: { code: "ALREADY_PAID" } }, 409);
      if (path === "/functions/v1/update-room") { o.room = body.room; save(s); return json({ ok: true }); }
      if (path === "/functions/v1/burn-wish") {
        if (o.fire) return json({ ok: true, already: true, burn_number: null });
        o.fire = { text: body.text, show_on_stream: !!body.show_on_stream }; save(s);
        return json({ ok: true, already: false, burn_number: null });
      }
    }
    if (path === "/rest/v1/rpc/get_cell" && byCell(body.p_cell_id)) {
      var d = byCell(body.p_cell_id);
      return json({ cell_id: d.cell_id, status: "lit", message: d.text, signature: d.light_signature, lit_at: new Date(d.t).toISOString(), room: d.room, warmth: 0, visits: 0 });
    }
    if (path === "/functions/v1/room-warmth" && byCell(body.cell_id)) return json({ ok: true, warmth: 0, visits: 0 });
    if (path === "/rest/v1/rpc/get_map") {
      var mineDemo = Object.keys(s).map(function (k) { return s[k]; });
      if (!mineDemo.length) return real(input, init);
      return real(input, init).then(function (res) {
        if (!res.ok || !window.MapCore) return res;
        return res.json().then(function (r) {
          var u = window.MapCore.unpack(r), ICONS = window.MapCore.ICONS, COLORS = window.MapCore.COLORS;
          var ids = {}; mineDemo.forEach(function (d) { ids[d.cell_id] = 1; });
          var lit = u.lit.filter(function (x) { return !ids[x[0]]; }).concat(mineDemo.map(function (d) {
            return [d.cell_id, Math.max(0, ICONS.indexOf(d.light_icon)), Math.max(0, COLORS.indexOf(d.light_color)), 0];
          }));
          var out = Object.assign({}, r, { lit: lit, held: u.held }); delete out.lit_packed; delete out.held_packed;
          return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
        });
      });
    }
    return real(input, init);
  };

  // A bar on every page while a demo room exists on this device, so nobody mistakes it for a real one.
  window.DemoMode = {
    active: function () { return Object.keys(load()).length > 0; },
    end: function () { var codes = Object.keys(load()); save({}); forget(codes); }
  };
  document.addEventListener("DOMContentLoaded", function () {
    var A = window.APP;
    if (!A || !window.DemoMode.active()) return;
    var bar = document.createElement("div");
    bar.className = "demo-bar"; bar.setAttribute("role", "status");
    bar.innerHTML = "<span>" + A.esc(A.t("lights.demo_bar")) + '</span><button type="button">' + A.esc(A.t("lights.demo_end")) + "</button>";
    bar.querySelector("button").addEventListener("click", function () { window.DemoMode.end(); location.href = A.D.urls.lights; });
    document.body.appendChild(bar);
  });
})();
