/* Map page: explore Armenia, see lights, pick a free plot, design a light, pay (or save until payments open). */
(function () {
  "use strict";
  var A = window.APP, D = A.D, t = A.t, esc = A.esc, MC = window.MapCore;
  var $ = function (id) { return document.getElementById(id); };
  var stage = $("stage"), panel = $("panel"), form = $("designForm");
  var lang = D.lang, wide = function () { return window.innerWidth >= 980; };
  var prices = {}; (D.lightProducts || []).forEach(function (p) { prices[p.code] = p.price; });
  var m = null, view = null, state = { id: -1, mode: "hint", busy: false, cellReq: 0 }, litRows = [], heldRows = [];

  /* ---------- panel views ---------- */
  function showView(name) {
    state.mode = name;
    panel.querySelectorAll("[data-view]").forEach(function (v) { v.hidden = v.getAttribute("data-view") !== name; });
    panel.classList.toggle("open", name !== "hint");
    stage.classList.toggle("panel-open", name !== "hint");
    $("hintPill").hidden = name !== "hint";
    if (name !== "design") view && view.setGhost(null);
    if (name !== "hint" && !wide()) panel.scrollTop = 0;
  }
  $("panelClose").addEventListener("click", function () { deselect(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state.mode !== "hint" && !state.busy) deselect(); });
  function deselect() {
    state.id = -1; if (view) { view.select(-1); view.setGhost(null); }
    showView("hint"); setUrl(-1);
  }
  function setUrl(id) {
    try {
      var u = new URL(location.href);
      if (id >= 0) u.searchParams.set("cell", id); else u.searchParams.delete("cell");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch (e) {}
  }
  function cellUrl(id) { return location.origin + D.urls.lights + "?cell=" + id; }

  /* ---------- selecting a plot ---------- */
  function placeHtml(id) {
    return esc(MC.provName(m, id, lang));
  }
  function nearText(id) { var tn = MC.townName(m, id, lang); return tn ? t("lights.near", { town: tn }) : ""; }
  function select(id, fly) {
    if (!MC.isCell(m, id)) return;
    state.id = id; view.select(id); setUrl(id);
    if (!wide()) {
      var r = stage.getBoundingClientRect();
      if (r.top < 40 || r.top > innerHeight * 0.3) window.scrollTo({ top: scrollY + r.top - 64, behavior: A.reduceMotion ? "auto" : "smooth" });
    }
    if (fly || !wide()) view.flyToCell(id, wide() ? 30 : 26);
    var lit = view.lights.get(id);
    if (lit) return showLit(id, lit);
    if (view.held.has(id)) { $("heldPlace").innerHTML = placeHtml(id); return showView("held"); }
    showDesign(id);
  }
  function showLit(id, L) {
    var req = ++state.cellReq;
    $("litIcon").innerHTML = ""; $("litIcon").appendChild(MC.iconCanvas(MC.ICONS[L.i] || "star", MC.COLORS[L.c] || "amber", L.b ? 96 : 72));
    $("litPlace").innerHTML = placeHtml(id); $("litNear").textContent = nearText(id);
    $("litMsg").textContent = ""; $("litSig").textContent = ""; $("litDate").textContent = "";
    $("litMsg").hidden = true;
    showView("lit");
    A.api.rpc("get_cell", { p_cell_id: id }).then(function (c) {
      if (req !== state.cellReq || !c) return;
      if (c.message) { $("litMsg").textContent = (lang === "en" ? "“" : "«") + c.message + (lang === "en" ? "”" : "»"); $("litMsg").hidden = false; }
      else { $("litMsg").textContent = t("lights.nolight"); $("litMsg").hidden = false; $("litMsg").classList.add("muted"); }
      if (c.signature) $("litSig").textContent = t("lights.lit_by", { name: c.signature });
      if (c.lit_at) $("litDate").textContent = t("lights.lit_on", { date: new Date(c.lit_at).toLocaleDateString(D.locale || lang, { day: "numeric", month: "long" }) });
    }).catch(function () {});
  }
  $("litShare").addEventListener("click", function () { shareLight(state.id); });
  $("litCopy").addEventListener("click", function () { A.copy(cellUrl(state.id)); });
  function shareLight(id) {
    var L = view.lights.get(id) || { i: 0, c: 0, b: 0 };
    var card = MC.storyCard(m, litRows, { id: id, icon: MC.ICONS[L.i] || "star", color: MC.COLORS[L.c] || "amber" }, {
      title: t("lights.story_t"), place: MC.placeName(m, id, lang), sub: MC.townName(m, id, lang) ? MC.provName(m, id, lang) : "",
      cta: t("lights.story_sub"), brand: D.brand
    });
    A.shareCanvas(card, "light-" + id + ".png", cellUrl(id));
  }

  /* ---------- designer ---------- */
  form.querySelectorAll(".lt-ic").forEach(function (s) { s.appendChild(MC.iconCanvas(s.getAttribute("data-icon"), "amber", 40)); });
  function val(name) { var r = form.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : null; }
  function recolorIcons() {
    var c = val("color");
    form.querySelectorAll(".lt-ic").forEach(function (s) { s.innerHTML = ""; s.appendChild(MC.iconCanvas(s.getAttribute("data-icon"), c, 40)); });
  }
  function clean(s) { return (s || "").replace(/\s+/g, " ").trim(); }
  function sync() {
    var product = val("size"), p = prices[product] || 0;
    $("lMsgCount").textContent = $("lMsg").value.length + "/60";
    $("lGift").textContent = t("burn.of_which", { amount: A.price(A.giftShare(p)) });
    $("lSubmit").textContent = D.paymentsOpen ? t("lights.pay", { price: A.price(p) }) : t("lights.save");
    if (state.mode === "design" && view) view.setGhost({ id: state.id, icon: val("icon"), color: val("color"), big: product === "light_big" });
  }
  function showDesign(id) {
    $("dPlace").innerHTML = placeHtml(id); $("dNear").textContent = nearText(id);
    $("lErr").textContent = "";
    showView("design"); sync();
    if (wide()) setTimeout(function () { try { form.querySelector('input[name="icon"]:checked').focus({ preventScroll: true }); } catch (e) {} }, 50);
  }
  form.addEventListener("change", function (e) { if (e.target.name === "color") recolorIcons(); sync(); });
  form.addEventListener("input", sync);

  function errText(code) {
    var k = "lights.errors." + code, v = t(k);
    if (v !== k) return v;
    k = "burn.errors." + code; v = t(k);
    return v === k ? t("burn.errors.UNKNOWN") : v;
  }
  function validate() {
    var msg = clean($("lMsg").value), em = clean($("lEmail").value);
    if (!msg) return ["EMPTY", $("lMsg")];
    if (msg.length > 60) return ["TEXT_TOO_LONG", $("lMsg")];
    if (clean($("lSig").value).length > 30) return ["SIGNATURE_TOO_LONG", $("lSig")];
    if (!em && !D.paymentsOpen) return ["EMAIL_REQUIRED", $("lEmail")];
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return ["EMAIL_INVALID", $("lEmail")];
    if (!$("lConsent").checked) return ["CONSENT_REQUIRED", $("lConsent")];
    return null;
  }
  function setBusy(b) {
    state.busy = b; var btn = $("lSubmit"); btn.disabled = b;
    if (b) { btn.setAttribute("aria-busy", "true"); btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span class="sr-only">' + esc(t("common.loading")) + "</span>"; }
    else { btn.removeAttribute("aria-busy"); sync(); }
  }
  function remember(code) {
    try {
      var list = JSON.parse(localStorage.getItem("papers") || "[]");
      if (list.indexOf(code) < 0) list.unshift(code);
      localStorage.setItem("papers", JSON.stringify(list.slice(0, 20)));
    } catch (e) {}
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.busy || !MC.isCell(m, state.id)) return;
    var bad = validate();
    if (bad) { $("lErr").textContent = errText(bad[0]); bad[1].focus(); return; }
    $("lErr").textContent = "";
    var body = {
      product: val("size"), cell_id: state.id, text: clean($("lMsg").value),
      light_icon: val("icon"), light_color: val("color"), light_signature: clean($("lSig").value) || null,
      email: clean($("lEmail").value) || null, lang: lang, consent: true
    };
    var id = state.id;
    setBusy(true);
    A.api.fn("create-order", body).then(function (res) {
      remember(res.code);
      var pay = res.payment || { mode: "disabled" };
      if ((pay.mode === "redirect" || pay.mode === "mock") && A.safePaymentUrl(pay.url)) {
        try { sessionStorage.setItem("justPaid", res.code); } catch (e) {}
        location.href = pay.url;
      } else if (pay.mode === "form" && A.safePaymentUrl(pay.action)) {
        try { sessionStorage.setItem("justPaid", res.code); } catch (e) {}
        A.postForm(pay.action, pay.fields);
      } else if (pay.mode === "redirect" || pay.mode === "mock" || pay.mode === "form") {
        setBusy(false); $("lErr").textContent = errText("UNKNOWN");
      } else {
        setBusy(false);
        $("savedText").innerHTML = t("lights.saved_d", { email: esc(body.email || "") });
        $("savedLink").href = D.urls.paper + "?c=" + encodeURIComponent(res.code);
        view.flare(id);
        showView("saved");
      }
    }).catch(function (err) {
      setBusy(false);
      var code = (err && err.code) || "UNKNOWN";
      if (code === "TEXT_REQUIRED") code = "EMPTY";
      if (code === "INVALID_PRODUCT") code = "PRODUCT_UNAVAILABLE";
      if (code === "PAYMENT_MISCONFIGURED") code = "PAYMENT_UNAVAILABLE";
      $("lErr").textContent = errText(code);
      if (code === "CELL_TAKEN") refresh();
    });
  });
  window.addEventListener("pageshow", function (e) { if (e.persisted && state.busy) setBusy(false); });

  /* ---------- random free plot near the centre of the view ---------- */
  function randomFree() {
    if (!m || !view) return;
    var c = view.toWorld(view.W / 2 - (wide() && state.mode !== "hint" ? 200 : 0), view.H / 2), free = [];
    m.ids.forEach(function (id) {
      if (view.lights.has(id) || view.held.has(id)) return;
      var p = MC.cellCenter(m, id); free.push([id, Math.hypot(p[0] - c[0], p[1] - c[1])]);
    });
    if (!free.length) return;
    free.sort(function (a, b) { return a[1] - b[1]; });
    var pick = free[Math.floor(Math.random() * Math.min(40, free.length))][0];
    select(pick, true);
  }
  $("randomBtn").addEventListener("click", randomFree);
  panel.querySelector("[data-random]").addEventListener("click", randomFree);

  /* ---------- live data ---------- */
  var tickQ = [], tickOn = false;
  function tick() {
    if (tickOn || !tickQ.length) return;
    tickOn = true;
    var el = $("ticker"); el.textContent = "✦ " + t("lights.ticker", { place: tickQ.shift() }); el.classList.add("on");
    setTimeout(function () { el.classList.remove("on"); setTimeout(function () { tickOn = false; tick(); }, 500); }, 3800);
  }
  function paintProgress() {
    var n = view.lights.size, total = m.total;
    $("ltCount").innerHTML = t("lights.progress", { n: A.fmt(n), total: A.fmt(total) });
    $("ltBar").style.width = Math.max(n ? 0.6 : 0, n / total * 100) + "%";
    var counts = m.provinces.map(function () { return 0; });
    view.lights.forEach(function (_, id) { counts[m.prov[id]]++; });
    var rows = m.provinces.map(function (p, i) { return { name: p[lang], lit: counts[i], total: m.provCount[i], code: p.code }; });
    rows.sort(function (a, b) { return (b.lit / b.total) - (a.lit / a.total) || b.lit - a.lit || a.total - b.total; });
    $("board").innerHTML = rows.map(function (r, i) {
      var pct = r.lit / r.total * 100;
      return '<li class="' + (r.code === "yer" ? "yer" : "") + '"><span class="r">' + (i + 1) + '</span><span class="n">' + esc(r.name) + "</span>" +
        '<span class="b" aria-hidden="true"><i style="width:' + Math.max(r.lit ? 1.5 : 0, pct).toFixed(2) + '%"></i></span>' +
        '<span class="v">' + A.fmt(r.lit) + " / " + A.fmt(r.total) + '<small>' + esc(t("lights.left", { n: A.fmt(r.total - r.lit) })) + "</small></span></li>";
    }).join("");
  }
  function refresh() {
    return A.api.rpc("get_map").then(function (r) {
      litRows = (r && r.lit) || []; heldRows = (r && r.held) || [];
      var fresh = view.setLights(litRows, heldRows);
      fresh.slice(0, 5).forEach(function (id) { tickQ.push(MC.placeName(m, id, lang)); }); tick();
      paintProgress();
      // An open card may have changed state (the plot just got taken).
      if (state.id >= 0 && state.mode === "design" && (view.lights.has(state.id) || view.held.has(state.id)) && !state.busy) select(state.id, false);
    }).catch(function (err) {
      if (err && err.code === "NETWORK" && !view.loadedOnce) A.toast(t("lights.map_err"));
      if (!view.loadedOnce) { view.setLights([], []); paintProgress(); }
    });
  }
  var pollT = null;
  function poll() { clearTimeout(pollT); pollT = setTimeout(function () { if (!document.hidden) refresh().then(poll, poll); else poll(); }, 15000); }

  /* ---------- boot ---------- */
  MC.loadMap(stage.getAttribute("data-map")).then(function (map) {
    m = map;
    view = new MC.MapView($("map"), m, {
      interactive: true, lang: lang, pad: 18,
      offsetX: function () { return wide() ? 400 : 0; },
      // On phones the bottom sheet covers the lower part: keep the chosen plot in the upper quarter.
      offsetY: function (H) { return wide() ? 0 : H * 0.27; },
      onTap: function (id) { if (id < 0) { if (state.mode !== "design") deselect(); return; } select(id, false); }
    });
    var sel = $("townPick");
    m.towns.map(function (tw, i) { return [tw[lang], i]; }).sort(function (a, b) { return a[0].localeCompare(b[0], lang); })
      .forEach(function (x) { var o = document.createElement("option"); o.value = x[1]; o.textContent = x[0]; sel.appendChild(o); });
    sel.addEventListener("change", function () {
      if (sel.value === "") return;
      var tw = m.towns[+sel.value];
      view.flyTo(view.target(tw.x, tw.y, 16 / m.cell_km), 1100);
    });
    $("zIn").addEventListener("click", function () { view.zoomAt(1.6, view.W / 2, view.H / 2); });
    $("zOut").addEventListener("click", function () { view.zoomAt(1 / 1.6, view.W / 2, view.H / 2); });
    $("zFit").addEventListener("click", function () { view.fit(false); });
    showView("hint");
    refresh().then(function () {
      var want = parseInt(new URLSearchParams(location.search).get("cell"), 10);
      if (MC.isCell(m, want)) setTimeout(function () { select(want, true); }, 500);
      poll();
    });
  }).catch(function () { A.toast(t("lights.map_err")); });
})();
