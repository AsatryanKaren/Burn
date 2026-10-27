/* Burn page: write → pay (or save until payments open). One product, one price. */
(function () {
  "use strict";
  var A = window.APP, D = A.D, t = A.t;
  var $ = function (id) { return document.getElementById(id); };

  var scene = A.mountScene({ layout: "hero", dim: innerWidth < 900 ? 0.18 : 0 });
  var form = $("flow"), note = $("note"), email = $("email");
  var steps = form.querySelectorAll("[data-step]");
  var product = D.products[0];
  var state = { step: 1, busy: false };

  /* ---------- draft (session only) ---------- */
  function loadDraft() { try { return JSON.parse(sessionStorage.getItem("draft") || "{}") || {}; } catch (e) { return {}; } }
  function saveDraft() {
    try {
      sessionStorage.setItem("draft", JSON.stringify({
        text: note.value, show: $("showOnStream").checked, email: email.value
      }));
    } catch (e) {}
  }
  var params = new URLSearchParams(location.search);
  var draft = loadDraft();
  if (draft.text) note.value = draft.text;
  if (draft.email) email.value = draft.email;
  if (draft.show === false) $("showOnStream").checked = false;

  /* ---------- helpers ---------- */
  function clean(s) { return (s || "").replace(/\s+/g, " ").trim(); }
  function errText(code) { var k = "burn.errors." + code, v = t(k); return v === k ? t("burn.errors.UNKNOWN") : v; }
  function setErr(id, code) { $(id).textContent = code ? errText(code) : ""; }
  function counts() {
    $("count").textContent = note.value.length + "/120";
  }
  function show(step) {
    state.step = step;
    steps.forEach(function (s) { s.hidden = s.getAttribute("data-step") !== String(step); });
    var n = typeof step === "number" ? step : 2;
    $("stepLabel").textContent = t("burn.step", { n: n, total: 2 });
    form.querySelectorAll(".progress i").forEach(function (i, idx) { i.classList.toggle("on", idx < n); });
    var active = form.querySelector('[data-step="' + step + '"]');
    var focusable = active && active.querySelector("h1, h2");
    if (focusable) { focusable.setAttribute("tabindex", "-1"); focusable.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: A.reduceMotion ? "auto" : "smooth" });
  }
  function syncProduct() {
    var p = product;
    $("sumText").textContent = clean(note.value);
    $("sumTotal").textContent = A.price(p.price);
    $("sumGift").textContent = t("burn.of_which", { amount: A.price(A.giftShare(p.price)) });
    $("payBtn").textContent = D.paymentsOpen ? t("burn.pay", { price: A.price(p.price) }) : t("burn.save_soon");
  }

  /* ---------- validation ---------- */
  function validate1() {
    var v = clean(note.value);
    if (!v) return "EMPTY";
    if (v.length > 120) return "TEXT_TOO_LONG";
    return null;
  }
  function validate3() {
    var e = clean(email.value);
    if (!e && !D.paymentsOpen) return "EMAIL_REQUIRED";
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return "EMAIL_INVALID";
    if (!$("consent").checked) return "CONSENT_REQUIRED";
    return null;
  }
  function shake(node) { node.classList.remove("shake"); void node.offsetWidth; node.classList.add("shake"); }

  /* ---------- placeholders ---------- */
  var ph = t("burn.placeholders"), phI = 0;
  setInterval(function () { if (!note.value && document.activeElement !== note && Array.isArray(ph)) { phI = (phI + 1) % ph.length; note.placeholder = ph[phI]; } }, 2600);

  /* ---------- events ---------- */
  [note, email].forEach(function (n) { n.addEventListener("input", function () { counts(); saveDraft(); syncProduct(); }); });
  $("showOnStream").addEventListener("change", saveDraft);
  form.querySelectorAll("[data-next]").forEach(function (b) {
    b.addEventListener("click", function () {
      var e1 = validate1(); setErr("err1", e1);
      if (e1) { shake($("paper")); note.focus(); return; }
      if (scene) scene.flare(0.5);
      syncProduct(); show(2);
    });
  });
  form.querySelectorAll("[data-back]").forEach(function (b) {
    b.addEventListener("click", function () { show(1); });
  });
  note.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.querySelector('[data-step="1"] [data-next]').click(); }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.busy) return;
    var e1 = validate1(); if (e1) { setErr("err1", e1); show(1); return; }
    var e3 = validate3(); setErr("err3", e3);
    if (e3) { if (e3 === "CONSENT_REQUIRED") $("consent").focus(); else email.focus(); return; }
    submitOrder();
  });

  function setBusy(b) {
    state.busy = b;
    var btn = $("payBtn");
    btn.disabled = b;
    if (b) { btn.setAttribute("aria-busy", "true"); btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span class="sr-only">' + A.esc(t("common.loading")) + "</span>"; }
    else { btn.removeAttribute("aria-busy"); btn.innerHTML = ""; syncProduct(); }
  }

  function rememberOrder(code) {
    try {
      var list = JSON.parse(localStorage.getItem("papers") || "[]");
      if (list.indexOf(code) < 0) list.unshift(code);
      localStorage.setItem("papers", JSON.stringify(list.slice(0, 20)));
    } catch (e) {}
  }

  function submitOrder() {
    var body = {
      product: product.code,
      text: clean(note.value),
      email: clean(email.value) || null,
      lang: D.lang,
      show_on_stream: $("showOnStream").checked,
      consent: true
    };
    setBusy(true);
    A.api.fn("create-order", body).then(function (res) {
      rememberOrder(res.code);
      var pay = res.payment || { mode: "disabled" };
      if ((pay.mode === "redirect" || pay.mode === "mock") && A.safePaymentUrl(pay.url)) {
        show("redirect");
        try { sessionStorage.setItem("justPaid", res.code); } catch (e) {}
        location.href = pay.url;
      } else if (pay.mode === "form" && A.safePaymentUrl(pay.action)) {
        show("redirect");
        try { sessionStorage.setItem("justPaid", res.code); } catch (e) {}
        A.postForm(pay.action, pay.fields);
      } else if (pay.mode === "redirect" || pay.mode === "mock" || pay.mode === "form") {
        setBusy(false); setErr("err3", "UNKNOWN");
      } else {
        setBusy(false);
        $("savedText").innerHTML = t("burn.saved_d", { email: A.esc(body.email || "") });
        $("savedLink").href = D.urls.paper + "?c=" + encodeURIComponent(res.code);
        try { sessionStorage.removeItem("draft"); } catch (e) {}
        state.savedText = body.text;
        show("saved");
      }
    }).catch(function (err) {
      setBusy(false);
      var code = err && err.code;
      if (code === "TEXT_REQUIRED") code = "EMPTY";
      if (code === "INVALID_PRODUCT") code = "PRODUCT_UNAVAILABLE";
      if (code === "PAYMENT_MISCONFIGURED") code = "PAYMENT_UNAVAILABLE";
      if (["TEXT_REJECTED", "TEXT_TOO_LONG", "EMPTY"].indexOf(code) >= 0) { show(1); setErr("err1", code); return; }
      setErr("err3", code || "UNKNOWN");
    });
  }

  /* ---------- preview burn (not counted) ---------- */
  $("previewBtn").addEventListener("click", function () {
    if (!scene) return;
    var text = state.savedText || clean(note.value);
    form.classList.add("gone");
    scene.setDim(0);
    scene.burnPaper({
      text: text,
      onCatch: function () { if (window.FireScene) window.FireScene.Sound.whoosh(); }
    }).then(function () {
      form.classList.remove("gone");
      scene.setDim(innerWidth < 900 ? 0.18 : 0);
    });
  });

  // Coming back from the bank page with the browser's Back button restores this page from cache: unlock it.
  window.addEventListener("pageshow", function (e) { if (e.persisted && state.busy) { setBusy(false); show(2); } });

  /* ---------- start ---------- */
  counts(); syncProduct();
  show(1);
  if (state.step === 1) setTimeout(function () { note.focus({ preventScroll: true }); }, 250);
})();
