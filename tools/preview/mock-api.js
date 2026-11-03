/* PREVIEW ONLY: a pretend server so every button works in the preview. Not part of the real site. */
(function () {
  "use strict";
  var real = window.fetch.bind(window);
  var root = new URL("../../", document.currentScript.src);  // the preview's top folder
  function bankUrl(code, lang) { return new URL("preview-bank/index.html?code=" + encodeURIComponent(code) + "&lang=" + (lang || "hy"), root).href; }
  var store = (function () { try { return JSON.parse(localStorage.getItem("previewOrders") || "{}"); } catch (e) { return {}; } })();
  // One room per email in the demo too: keep the first order for each email.
  (function () {
    var seen = {};
    Object.keys(store).sort(function (a, b) { return String(store[a].created_at).localeCompare(String(store[b].created_at)); }).forEach(function (k) {
      var e = store[k].email; if (store[k].cell_id == null || !e) return;
      if (seen[e]) delete store[k]; else seen[e] = true;
    });
    try { localStorage.setItem("previewOrders", JSON.stringify(store)); } catch (e) {}
  })();
  function save() { try { localStorage.setItem("previewOrders", JSON.stringify(store)); } catch (e) {} }
  function json(body, status) { return Promise.resolve(new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } })); }
  function hash(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  var demoLit = null, warm = {};
  function lit() {
    if (demoLit || !window.MAP_DATA) return demoLit || [];
    var m = window.MAP_DATA, out = [], ids = [], pos = 0;
    m.grid.split(",").forEach(function (run) { if (!run) return; var v = parseInt(run[0], 36), n = parseInt(run.slice(1), 36); if (v > 0) for (var k = 0; k < n; k++) ids.push(pos + k); pos += n; });
    for (var i = 0; i < ids.length; i += 2) {
      var id = ids[i], c = id % m.cols, r = Math.floor(id / m.cols), x = (c + .5) * m.cell_km, y = (r + .5) * m.cell_km, d = 99;
      for (var k = 0; k < 14; k++) { var t = m.towns[k]; d = Math.min(d, Math.hypot(x - t.x, y - t.y)); }
      if (hash(id) < (d < 3 ? 0.35 : d < 10 ? 0.08 : 0.012)) out.push([id, Math.floor(hash(id + 1) * 6), Math.floor(hash(id + 2) * 6), 0]);
    }
    return (demoLit = out);
  }
  var ICONS = ["tree", "home", "candle", "star", "gift", "pomegranate"], COLORS = ["amber", "red", "green", "white", "blue", "violet"];
  function mine() { return Object.keys(store).map(function (k) { return store[k]; }).filter(function (o) { return o.cell_id != null; }); }
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input.url;
    if (url.indexOf(".supabase.co") < 0) return real(input, init);
    var body = {}; try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
    var path = url.split(".supabase.co")[1].split("?")[0];
    return new Promise(function (res) { setTimeout(res, 250); }).then(function () {
      if (path === "/rest/v1/rpc/get_public_stats") return json({ papers_burned: 1284, gift_fund_amd: 312400, lights_lit: lit().length + mine().length, waitlist_count: 40 });
      if (path === "/rest/v1/rpc/get_fire_feed") return json([]);
      if (path === "/rest/v1/rpc/get_map") {
        var l = lit().concat(mine().map(function (o) { return [o.cell_id, ICONS.indexOf(o.light_icon), COLORS.indexOf(o.light_color), 0]; }));
        var warmList = l.slice(0, 400).filter(function (x, i) { return hash(x[0] + 3) < 0.12; }).map(function (x) { return [x[0], (warm[x[0]] || 0) + Math.floor(hash(x[0] + 9) * 140)]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 30);
        return json({ lit: l, held: [], total: (window.MAP_DATA && window.MAP_DATA.count) || 111111, lit_count: l.length, warm: warmList });
      }
      if (path === "/rest/v1/rpc/get_cell") {
        var o = mine().filter(function (x) { return x.cell_id === body.p_cell_id; })[0];
        if (o) return json({ cell_id: o.cell_id, status: "lit", message: o.text, signature: o.light_signature, lit_at: o.created_at, room: o.room });
        var msgs = [["Թող այս տունը միշտ տաք լինի", "Պետրոսյանների ընտանիք"], ["Տատիկիս գյուղի համար ❤", "Անի"], ["Շնորհավոր Նոր տարի, Գյումրի", "Արմեն"], ["Մինչև նոր հանդիպում, 2026", "Լիլիթ ու Դավիթ"], ["Թող 2027-ը խաղաղ լինի", ""], ["Happy New Year from Los Angeles", "The Hakobyans"]];
        var mm = msgs[Math.floor(hash(body.p_cell_id + 5) * msgs.length)];
        return json({ cell_id: body.p_cell_id, status: "lit", message: mm[0], signature: mm[1], lit_at: "2026-12-21T10:00:00Z", room: null,
          warmth: (warm[body.p_cell_id] || 0) + Math.floor(hash(body.p_cell_id + 9) * 140), visits: Math.floor(hash(body.p_cell_id + 11) * 900) + 20 });
      }
      if (path === "/functions/v1/create-order") {
        if (Object.keys(store).some(function (k) { return store[k].email === body.email && (store[k].status === "paid" || store[k].status === "awaiting_launch"); })) return json({ error: { code: "ALREADY_HAS_ROOM" } }, 409);
        var code = "demo" + Math.random().toString(36).slice(2, 12);
        store[code] = Object.assign({ code: code, status: "pending", amount_amd: 600, created_at: new Date().toISOString() }, body);
        save();
        return json({ code: code, amount_amd: 600, status: "pending", payment: { mode: "mock", url: bankUrl(code, body.lang) } });
      }
      if (path === "/functions/v1/start-payment") {
        if (!store[body.code]) return json({ error: { code: "NOT_FOUND" } }, 404);
        store[body.code].status = "pending"; save();
        return json({ payment: { mode: "mock", url: bankUrl(body.code, body.lang) } });
      }
      if (path === "/functions/v1/order-status") {
        var c = (url.match(/code=([^&]+)/) || [])[1], ord = store[c];
        if (!ord) return json({ error: { code: "NOT_FOUND" } }, 404);
        return json(Object.assign({}, ord, { burn_number: ord.cell_id == null ? 1285 : null, gift_share_amd: ord.status === "paid" ? 120 : null }));
      }
      if (path === "/functions/v1/room-warmth") {
        if (body.action === "warm") warm[body.cell_id] = (warm[body.cell_id] || 0) + 1;
        return json({ ok: true, warmth: (warm[body.cell_id] || 0) + Math.floor(hash(body.cell_id + 9) * 140), visits: Math.floor(hash(body.cell_id + 11) * 900) + 21 });
      }
      if (path === "/functions/v1/burn-wish") {
        var ow = store[body.code];
        if (!ow) return json({ error: { code: "ORDER_NOT_FOUND" } }, 404);
        if (ow.fire) return json({ ok: true, already: true, burn_number: ow.fire.burn_number });
        ow.fire = { burn_number: 1285 + Object.keys(store).length, text: body.text, show_on_stream: body.show_on_stream, created_at: new Date().toISOString() }; save();
        return json({ ok: true, already: false, burn_number: ow.fire.burn_number });
      }
      if (path === "/functions/v1/update-room") { if (store[body.code]) { store[body.code].room = body.room; save(); } return json({ ok: true }); }
      return json({ ok: true });
    });
  };
  document.addEventListener("DOMContentLoaded", function () {
    // The demo bank page is local, so let the site send buyers there.
    var A = window.APP; if (A) { var safe = A.safePaymentUrl; A.safePaymentUrl = function (u) { try { if (new URL(u, location.href).href.indexOf(root.href + "preview-bank/") === 0) return true; } catch (e) {} return safe(u); }; }
    var b = document.createElement("div");
    b.textContent = "Preview · demo data";
    b.style.cssText = "position:fixed;right:10px;bottom:10px;z-index:200;font:500 12px system-ui;color:#1c0e05;background:#ffc46b;padding:4px 10px;border-radius:99px;opacity:.85;pointer-events:none";
    document.body.appendChild(b);
  });
})();
