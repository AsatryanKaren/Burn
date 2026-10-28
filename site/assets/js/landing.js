/* Home page: a live, slowly drifting map behind the introduction, and the lit counter. */
(function () {
  "use strict";
  var A = window.APP, D = A.D, MC = window.MapCore;
  var host = document.getElementById("ltTeaser");
  if (!host || !MC) return;
  MC.loadMap(host.getAttribute("data-map")).then(function (m) {
    var wide = function () { return window.innerWidth >= 900; };
    var v = new MC.MapView(host.querySelector("canvas"), m, { lang: D.lang, labels: false, pad: 30,
      offsetX: function () { return wide() ? -window.innerWidth * 0.42 : 0; } });
    v.fit(true);
    var paint = function (n) {
      var el = document.getElementById("ldCount");
      if (el) el.innerHTML = A.t("lights.progress", { n: A.fmt(n), total: A.fmt(m.total) });
    };
    A.api.rpc("get_map").then(function (r) { var lit = (r && r.lit) || []; v.setLights(lit, (r && r.held) || []); paint(lit.length); })
      .catch(function () { paint(0); });
    window.addEventListener("resize", function () { v.fit(true); });
  });
})();
