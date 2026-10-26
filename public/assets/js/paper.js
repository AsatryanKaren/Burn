/* Personal paper page: status, the burn on return from the bank, number, story card, share.
   The order code in the URL is private (it opens this page). Shared links never contain it,
   except for "For a friend" papers, whose page is meant for the friend. */
(function () {
  "use strict";
  var A = window.APP, D = A.D, t = A.t, esc = A.esc;
  var view = document.getElementById("view");
  var scene = A.mountScene({ layout: "hero" });

  function codeFromUrl() {
    var q = new URLSearchParams(location.search).get("c");
    if (q && /^[a-z0-9]{8,40}$/i.test(q)) return q;
    var m = location.pathname.match(/\/p\/([a-z0-9]{8,40})\/?$/i);
    return m ? m[1] : null;
  }
  var code = codeFromUrl();
  var privateUrl = location.origin + D.urls.paper + "?c=" + encodeURIComponent(code || "");
  function publicUrl(n) { return location.origin + D.urls.home + (n ? "?n=" + n : ""); }
  var pollTimer = null, polls = 0, errors = 0, lastStatus = null;

  function msg(key, fallbackKey) {
    var v = A.t(key);
    return v === key ? A.t(fallbackKey) : v;
  }
  function render(html) {
    view.innerHTML = html;
    if (window.gsap && !A.reduceMotion) window.gsap.fromTo(view.children, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.1, ease: "power2.out" });
  }
  function simple(titleKey, bodyKey, actions) {
    render('<h1 class="result-title" style="font-size:clamp(2.2rem,9vw,4rem)">' + esc(t(titleKey)) + "</h1>" +
      '<p class="lead">' + esc(t(bodyKey)) + "</p>" + (actions || ""));
  }
  function paperCard(text) {
    return text ? '<div class="paper" style="max-width:420px;transform:rotate(-1deg)"><span class="paper-year">' + D.year + '</span><div class="paper-text" style="font-size:20px">' + esc(text) + "</div></div>" : "";
  }
  function spinnerRow() { return '<div class="row"><span class="spinner" style="border-color:rgba(255,255,255,.2);border-top-color:#ffc46b"></span></div>'; }

  function payButton(o) {
    if (!D.paymentsOpen) return "";
    return '<div class="row"><button type="button" class="btn btn-fire" id="payNow">' + esc(t("burn.pay", { price: A.price(o.amount_amd) })) + "</button></div>";
  }
  function bindPay() {
    var b = document.getElementById("payNow");
    if (!b) return;
    b.addEventListener("click", function () {
      b.disabled = true; b.setAttribute("aria-busy", "true");
      A.api.fn("start-payment", { code: code, lang: D.lang }).then(function (res) {
        var pay = res.payment || {};
        try { sessionStorage.setItem("justPaid", code); } catch (e) {}
        if ((pay.mode === "redirect" || pay.mode === "mock") && A.safePaymentUrl(pay.url)) location.href = pay.url;
        else if (pay.mode === "form" && A.safePaymentUrl(pay.action)) A.postForm(pay.action, pay.fields);
        else { b.disabled = false; b.removeAttribute("aria-busy"); A.toast(t("burn.soon_t")); }
      }).catch(function (err) {
        b.disabled = false; b.removeAttribute("aria-busy");
        if (err && err.code === "ALREADY_PAID") { load(); return; }
        A.toast(msg("burn.errors." + ((err && err.code) || "UNKNOWN"), "burn.errors.UNKNOWN"));
      });
    });
  }

  function showBurned(o) {
    var lines = [];
    if (o.recipient_name) lines.push(esc(t("paper.gift_for", { name: o.recipient_name })));
    if (o.has_wish || o.wish_text) lines.push(esc(t("paper.wish_kept")));
    if (o.gift_share_amd) lines.push(esc(t("paper.gift_share", { amount: A.price(o.gift_share_amd) })));
    var isGift = !!o.recipient_name;
    render(
      '<h1 class="result-title">' + esc(t("paper.burned_t")) + "</h1>" +
      '<p class="result-line">' + t("paper.burned_line", { n: "<span class=\"nw\">" + A.fmt(o.burn_number) + "</span>" }) + "</p>" +
      paperCard(o.text) +
      (lines.length ? '<div class="meta">' + lines.map(function (l) { return "<p>" + l + "</p>"; }).join("") + "</div>" : "") +
      '<div class="row">' +
      '<button type="button" class="btn btn-paper" id="shareBtn">' + esc(t("paper.share")) + "</button>" +
      '<button type="button" class="btn btn-ghost" id="copyBtn">' + esc(t("paper.copy_link")) + "</button>" +
      '<button type="button" class="btn btn-ghost" id="replayBtn">' + esc(t("paper.replay")) + "</button>" +
      "</div>" +
      '<p><a class="link-arrow" href="' + D.urls.burn + '">' + esc(t("paper.again")) + " →</a></p>"
    );
    // Story and copied links point to the public home page with the number, never to this private page
    // (except "For a friend", where the link is meant for the friend).
    var shareUrl = isGift ? privateUrl : publicUrl(o.burn_number);
    document.getElementById("shareBtn").addEventListener("click", function () { A.shareStory(scene, o.burn_number, shareUrl); });
    document.getElementById("copyBtn").addEventListener("click", function () { A.copy(shareUrl); });
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

  function schedule() {
    clearTimeout(pollTimer);
    if (polls >= 40) {
      var row = document.getElementById("pendingRow");
      if (row) row.innerHTML = '<button type="button" class="btn btn-ghost" id="checkAgain">' + esc(t("paper.retry")) + "</button>";
      var b = document.getElementById("checkAgain");
      if (b) b.addEventListener("click", function () { polls = 0; errors = 0; load(); });
      return;
    }
    polls++;
    pollTimer = setTimeout(load, Math.min(15000, (polls < 10 ? 2000 : 5000) * Math.pow(1.5, errors)));
  }

  function handle(o) {
    errors = 0;
    if (o.status === "paid") {
      clearTimeout(pollTimer);
      var just = null;
      try { just = sessionStorage.getItem("justPaid"); if (just === code) sessionStorage.removeItem("justPaid"); } catch (e) {}
      if (just === code) playBurn(o); else showBurned(o);
      A.loadStats(true);
    } else if (o.status === "pending") {
      // Render once; later polls only keep the spinner going (no re-render, no repeated announcements).
      if (lastStatus !== "pending") simple("paper.pending_t", "paper.pending_d", '<div id="pendingRow">' + spinnerRow() + "</div>");
      schedule();
    } else if (o.status === "failed" || o.status === "cancelled") {
      simple("paper.failed_t", "paper.failed_d", payButton(o)); bindPay();
    } else if (o.status === "awaiting_launch") {
      simple("paper.awaiting_t", "paper.awaiting_d", paperCard(o.text) + payButton(o));
      bindPay();
    } else {
      simple("paper.notfound_t", "paper.notfound_d");
    }
    lastStatus = o.status;
  }

  function load() {
    if (!code) { simple("paper.notfound_t", "paper.notfound_d"); return; }
    A.api.fn("order-status", null, { code: code }).then(handle).catch(function (err) {
      if (err && (err.status === 404 || err.code === "NOT_FOUND")) { simple("paper.notfound_t", "paper.notfound_d"); return; }
      // A network blip or rate limit is not a failed payment: keep checking quietly while waiting for the bank.
      errors++;
      if (lastStatus === "pending" || lastStatus === null && errors < 4) {
        if (lastStatus === null) simple("paper.pending_t", "paper.pending_d", '<div id="pendingRow">' + spinnerRow() + "</div>");
        lastStatus = lastStatus || "pending";
        schedule();
        return;
      }
      simple("paper.check_t", "burn.errors.NETWORK", '<div class="row"><button type="button" class="btn btn-ghost" id="retry">' + esc(t("paper.retry")) + "</button></div>");
      document.getElementById("retry").addEventListener("click", function () { errors = 0; load(); });
    });
  }
  load();
})();
