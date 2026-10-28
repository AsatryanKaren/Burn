/* Live page / YouTube stream: the map of lights next to the fire, with new lights flying in
   and a slow tour through people's rooms. Runs without any input from the viewer. */
(function () {
  "use strict";
  var A = window.APP, t = A.t, MC = window.MapCore;
  var side = document.getElementById("liveSide");
  if (!side || !MC) return;
  var stream = document.documentElement.classList.contains("stream-mode");
  if (!stream && window.innerWidth < 1100) { side.hidden = true; return; }
  var lang = A.D.lang, $ = function (id) { return document.getElementById(id); };
  var m = null, view = null, lit = [], queue = [], tickOn = false, touring = false, flyT = null;
  var TOUR_EVERY = stream ? 45000 : 60000, TOUR_FOR = 20000;

  function placeTitle(id) { var tn = MC.townName(m, id, lang); return tn ? MC.provName(m, id, lang) + " · " + tn : MC.provName(m, id, lang); }
  function caption(kicker, title, msg) {
    $("lsCapK").textContent = kicker; $("lsCapT").textContent = title; $("lsCapM").textContent = msg || "";
    $("lsCapM").hidden = !msg; $("lsCap").hidden = false;
  }
  function tick() {
    if (tickOn || !queue.length) return;
    tickOn = true;
    var el = $("lsTicker"); el.textContent = "✦ " + t("lights.ticker", { place: queue.shift() }); el.classList.add("on");
    setTimeout(function () { el.classList.remove("on"); setTimeout(function () { tickOn = false; tick(); }, 600); }, 4200);
  }
  function showNew(id) {
    if (touring) return;
    clearTimeout(flyT);
    view.flyToCell(id, 26); view.flare(id);
    caption(t("live.new_light"), placeTitle(id), "");
    flyT = setTimeout(function () { if (!touring) { $("lsCap").hidden = true; view.fit(false); } }, 6500);
  }
  function refresh() {
    return A.api.rpc("get_map").then(function (r) {
      var u = MC.unpack(r); lit = u.lit;
      var fresh = view.setLights(lit, u.held);
      $("lsLit").textContent = A.fmt(lit.length);
      fresh.slice(0, 6).forEach(function (id) { queue.push(MC.placeName(m, id, lang)); });
      tick();
      if (fresh.length) showNew(fresh[fresh.length - 1]);
    }).catch(function () {});
  }

  /* ---------- room tour ---------- */
  var roomLoad = null, room = null;
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  function ensureRoom() {
    if (window.Room) return Promise.resolve();
    if (!roomLoad) roomLoad = (window.THREE ? Promise.resolve() : loadScript(side.getAttribute("data-three"))).then(function () { return loadScript(side.getAttribute("data-room")); });
    return roomLoad;
  }
  function tour() {
    if (!lit.length || touring) return;
    var id = lit[Math.floor(Math.random() * lit.length)][0];
    touring = true; clearTimeout(flyT);
    view.flyToCell(id, 30);
    Promise.all([A.api.rpc("get_cell", { p_cell_id: id }).catch(function () { return null; }), ensureRoom()]).then(function (res) {
      var c = res[0] || {};
      setTimeout(function () {
        $("lsRoom").hidden = false; $("lsRoom").classList.add("on");
        var cv = $("liveRoom"), fresh = cv.cloneNode(false); cv.parentNode.replaceChild(fresh, cv);
        room = window.Room.create(fresh, { editable: false, layout: c.room || null, seed: id });
        if (room) room.mute(true);
        caption(t("live.room_tour"), placeTitle(id), c.message ? "«" + c.message + "»" + (c.signature ? " · " + c.signature : "") : "");
        setTimeout(endTour, TOUR_FOR);
      }, 1400);
    }).catch(function () { touring = false; });
  }
  function endTour() {
    $("lsRoom").classList.remove("on");
    setTimeout(function () { if (room) { room.dispose(); room = null; } $("lsRoom").hidden = true; $("lsCap").hidden = true; touring = false; view.fit(false); }, 700);
  }

  MC.loadMap(side.getAttribute("data-map")).then(function (map) {
    m = map;
    view = new MC.MapView($("liveMap"), m, { lang: lang, pad: 16 });
    refresh().then(function () { setTimeout(tour, 12000); });
    setInterval(refresh, 10000);
    setInterval(tour, TOUR_EVERY);
  });
})();
