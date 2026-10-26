/* Personal paper page: status, the burn on return from the bank, number, story card, share. */
(function () {
  "use strict";
  var A = window.APP, D = A.D, t = A.t, esc = A.esc;
  var view = document.getElementById("view");
  var scene = A.mountScene({ layout: "hero" });

  function codeFromUrl() {
    var q = new URLSearchParams(location.search).get("c");
    if (q) return q;
    var m = location.pathname.match(/\/p\/([a-z0-9]{8,40})\/?$/i);
    return m ? m[1] : null;
  }
  var code = codeFromUrl();
  var pageUrl = location.origin + D.urls.paper + "?c=" + encodeURIComponent(code || "");
  var pollTimer = null, polls = 0;

  function render(html) {
    view.innerHTML = html;
    if (window.gsap && !A.reduceMotion) window.gsap.fromTo(view.children, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.1, ease: "power2.out" });
  }
  function simple(titleKey, bodyKey, actions) {
    render('<h1 class="result-title" style="font-size:clamp(2.2rem,9vw,4rem)">' + esc(t(titleKey)) + "</h1>" +
      '<p class="lead">' + esc(t(bodyKey)) + "</p>" + (actions || ""));
  }

  function payButton(o) {
    if (!D.paymentsOpen) return "";
    return '<div class="row"><button type="button" class="btn btn-fire" id="payNow">' + esc(t("burn.pay", { price: A.price(o.amount_amd) })) + "</button></div>";
  }
  function bindPay() {
    var b = document.getElementById("payNow");
    if (!b) return;
    b.addEventListener("click", function () {
      b.disabled = true;
      A.api.fn("start-payment", { code: code, lang: D.lang }).then(function (res) {
        var pay = res.payment || {};
        try { sessionStorage.setItem("justPaid", code); } catch (e) {}
        if (pay.mode === "redirect" || pay.mode === "mock") location.href = pay.url;
        else if (pay.mode === "form") {
          var f = document.createElement("form"); f.method = "POST"; f.action = pay.action;
          Object.keys(pay.fields || {}).forEach(function (k) { var i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = pay.fields[k]; f.appendChild(i); });
          document.body.appendChild(f); f.submit();
        } else { b.disabled = false; A.toast(t("burn.soon_t")); }
      }).catch(function (err) { b.disabled = false; A.toast(t("burn.errors." + ((err && err.code) || "UNKNOWN")) || t("burn.errors.UNKNOWN")); });
    });
  }

  function showBurned(o) {
    var lines = [];
    if (o.recipient_name) lines.push(esc(t("paper.gift_for", { name: o.recipient_name })));
    if (o.wish_text) lines.push(esc(t("paper.wish_kept")));
    if (o.gift_share_amd) lines.push(esc(t("paper.gift_share", { amount: A.price(o.gift_share_amd) })));
    render(
      '<h1 class="result-title">' + esc(t("paper.burned_t")) + "</h1>" +
      '<p class="result-line">' + t("paper.burned_line", { n: "<span class=\"nw\">" + A.fmt(o.burn_number) + "</span>" }) + "</p>" +
      (o.text ? '<div class="paper" style="max-width:420px;transform:rotate(-1deg)"><span class="paper-year">' + D.year + '</span><div class="paper-text" style="font-size:20px">' + esc(o.text) + "</div></div>" : "") +
      (lines.length ? '<div class="meta">' + lines.map(function (l) { return "<p>" + l + "</p>"; }).join("") + "</div>" : "") +
      '<div class="row">' +
      '<button type="button" class="btn btn-paper" id="shareBtn">' + esc(t("paper.share")) + "</button>" +
      '<button type="button" class="btn btn-ghost" id="copyBtn">' + esc(t("paper.copy_link")) + "</button>" +
      '<button type="button" class="btn btn-ghost" id="replayBtn">' + esc(t("paper.replay")) + "</button>" +
      "</div>" +
      '<p><a class="link-arrow" href="' + D.urls.burn + '">' + esc(t("paper.again")) + " →</a></p>"
    );
    document.getElementById("shareBtn").addEventListener("click", function () { A.shareStory(scene, o.burn_number, pageUrl); });
    document.getElementById("copyBtn").addEventListener("click", function () { A.copy(pageUrl); });
    document.getElementById("replayBtn").addEventListener("click", function () { playBurn(o); });
  }

  function playBurn(o) {
    if (!scene) { showBurned(o); return; }
    view.style.visibility = "hidden";
    scene.burnPaper({
      text: o.text || "",
      onCatch: function () { if (window.FireScene) window.FireScene.Sound.whoosh(); }
    }).then(function () { view.style.visibility = ""; showBurned(o); });
  }

  function handle(o) {
    clearTimeout(pollTimer);
    if (o.status === "paid") {
      var just = null;
      try { just = sessionStorage.getItem("justPaid"); if (just === code) sessionStorage.removeItem("justPaid"); } catch (e) {}
      if (just === code) playBurn(o); else showBurned(o);
      A.loadStats(true);
    } else if (o.status === "pending") {
      simple("paper.pending_t", "paper.pending_d", '<div class="row"><span class="spinner" style="border-color:rgba(255,255,255,.2);border-top-color:#ffc46b"></span></div>');
      if (polls++ < 40) pollTimer = setTimeout(load, polls < 10 ? 2000 : 5000);
    } else if (o.status === "failed" || o.status === "cancelled") {
      simple("paper.failed_t", "paper.failed_d", payButton(o)); bindPay();
    } else if (o.status === "awaiting_launch") {
      simple("paper.awaiting_t", "paper.awaiting_d",
        (o.text ? '<div class="paper" style="max-width:420px"><span class="paper-year">' + D.year + '</span><div class="paper-text" style="font-size:20px">' + esc(o.text) + "</div></div>" : "") + payButton(o));
      bindPay();
    } else if (o.status === "refunded") {
      simple("paper.notfound_t", "paper.notfound_d");
    } else {
      simple("paper.notfound_t", "paper.notfound_d");
    }
  }

  function load() {
    if (!code) { simple("paper.notfound_t", "paper.notfound_d"); return; }
    A.api.fn("order-status", null, { code: code }).then(handle).catch(function (err) {
      if (err && (err.status === 404 || err.code === "NOT_FOUND")) simple("paper.notfound_t", "paper.notfound_d");
      else simple("paper.failed_t", "burn.errors.NETWORK", '<div class="row"><button type="button" class="btn btn-ghost" id="retry">' + esc(t("paper.retry")) + "</button></div>"),
        document.getElementById("retry").addEventListener("click", load);
    });
  }
  load();
})();
