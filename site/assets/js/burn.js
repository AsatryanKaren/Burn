/* Burn page: write → choose → pay (or save until payments open). */
(function () {
  "use strict";
  var A = window.APP, D = A.D, t = A.t;
  var $ = function (id) { return document.getElementById(id); };

  var scene = A.mountScene({ layout: "hero", dim: innerWidth < 900 ? 0.18 : 0 });
  var form = $("flow"), note = $("note"), wish = $("wish"), recipient = $("recipient"), email = $("email");
  var steps = form.querySelectorAll("[data-step]");
  var products = {};
  D.products.forEach(function (p) { products[p.code] = p; });
  var state = { step: 1, product: "burn", busy: false };

  /* ---------- draft (session only) ---------- */
  function loadDraft() { try { return JSON.parse(sessionStorage.getItem("draft") || "{}") || {}; } catch (e) { return {}; } }
  function saveDraft() {
    try {
      sessionStorage.setItem("draft", JSON.stringify({
        text: note.value, wish: wish.value, recipient: recipient.value, product: state.product,
        show: $("showOnStream").checked, email: email.value
      }));
    } catch (e) {}
  }
  var params = new URLSearchParams(location.search);
  var draft = loadDraft();
  if (draft.text) note.value = draft.text;
  if (draft.wish) wish.value = draft.wish;
  if (draft.recipient) recipient.value = draft.recipient;
  if (draft.email) email.value = draft.email;
  if (draft.show === false) $("showOnStream").checked = false;
  var want = params.get("product") || draft.product;
  if (want && products[want]) state.product = want;
  var radio = form.querySelector('input[name="product"][value="' + state.product + '"]');
  if (radio) radio.checked = true;

  /* ---------- helpers ---------- */
  function clean(s) { return (s || "").replace(/\s+/g, " ").trim(); }
  function setErr(id, code) { $(id).textContent = code ? (t("burn.errors." + code) || t("burn.errors.UNKNOWN")) : ""; }
  function counts() {
    $("count").textContent = note.value.length + "/120";
    $("wishCount").textContent = wish.value.length + "/200";
  }
  function show(step) {
    state.step = step;
    steps.forEach(function (s) { s.hidden = s.getAttribute("data-step") !== String(step); });
    var n = typeof step === "number" ? step : 3;
    $("stepLabel").textContent = t("burn.step", { n: n, total: 3 });
    form.querySelectorAll(".progress i").forEach(function (i, idx) { i.classList.toggle("on", idx < n); });
    var active = form.querySelector('[data-step="' + step + '"]');
    var focusable = active && active.querySelector("h1, h2");
    if (focusable) { focusable.setAttribute("tabindex", "-1"); focusable.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: A.reduceMotion ? "auto" : "smooth" });
  }
  function syncProduct() {
    var p = products[state.product];
    $("wishField").hidden = !p.needs_wish;
    $("recipientField").hidden = !p.needs_recipient;
    $("sumText").textContent = clean(note.value);
    $("sumProduct").textContent = t("options." + p.code + "_t");
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
  function validate2() {
    var p = products[state.product];
    if (p.needs_wish && !clean(wish.value)) return "WISH_REQUIRED";
    if (p.needs_recipient && !clean(recipient.value)) return "RECIPIENT_REQUIRED";
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
  [note, wish, recipient, email].forEach(function (n) { n.addEventListener("input", function () { counts(); saveDraft(); syncProduct(); }); });
  $("showOnStream").addEventListener("change", saveDraft);
  form.querySelectorAll('input[name="product"]').forEach(function (r) {
    r.addEventListener("change", function () { state.product = r.value; setErr("err2"); syncProduct(); saveDraft(); });
  });
  form.querySelectorAll("[data-next]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (state.step === 1) {
        var e1 = validate1(); setErr("err1", e1);
        if (e1) { shake($("paper")); note.focus(); return; }
        if (scene) scene.flare(0.5);
        show(2);
      } else if (state.step === 2) {
        var e2 = validate2(); setErr("err2", e2);
        if (e2) { (products[state.product].needs_wish ? wish : recipient).focus(); return; }
        syncProduct(); show(3);
      }
    });
  });
  form.querySelectorAll("[data-back]").forEach(function (b) {
    b.addEventListener("click", function () { show(state.step === 3 ? 2 : 1); });
  });
  note.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.querySelector('[data-step="1"] [data-next]').click(); }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.busy) return;
    var e1 = validate1(); if (e1) { setErr("err1", e1); show(1); return; }
    var e2 = validate2(); if (e2) { setErr("err2", e2); show(2); return; }
    var e3 = validate3(); setErr("err3", e3);
    if (e3) { if (e3 === "CONSENT_REQUIRED") $("consent").focus(); else email.focus(); return; }
    submitOrder();
  });

  function setBusy(b) {
    state.busy = b;
    var btn = $("payBtn");
    btn.disabled = b;
    btn.innerHTML = b ? '<span class="spinner" aria-hidden="true"></span>' : "";
    if (!b) syncProduct();
  }

  function rememberOrder(code) {
    try {
      var list = JSON.parse(localStorage.getItem("papers") || "[]");
      if (list.indexOf(code) < 0) list.unshift(code);
      localStorage.setItem("papers", JSON.stringify(list.slice(0, 20)));
    } catch (e) {}
  }

  function submitOrder() {
    var p = products[state.product];
    var body = {
      product: p.code,
      text: clean(note.value),
      wish_text: p.needs_wish ? clean(wish.value) : null,
      recipient_name: p.needs_recipient ? clean(recipient.value) : null,
      email: clean(email.value) || null,
      lang: D.lang,
      show_on_stream: $("showOnStream").checked,
      consent: true
    };
    setBusy(true);
    A.api.fn("create-order", body).then(function (res) {
      rememberOrder(res.code);
      var pay = res.payment || { mode: "disabled" };
      if (pay.mode === "redirect" || pay.mode === "mock") {
        show("redirect");
        try { sessionStorage.setItem("justPaid", res.code); } catch (e) {}
        location.href = pay.url;
      } else if (pay.mode === "form") {
        show("redirect");
        try { sessionStorage.setItem("justPaid", res.code); } catch (e) {}
        var f = document.createElement("form");
        f.method = "POST"; f.action = pay.action;
        Object.keys(pay.fields || {}).forEach(function (k) {
          var i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = pay.fields[k]; f.appendChild(i);
        });
        document.body.appendChild(f); f.submit();
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
      if (code === "TEXT_REJECTED" || code === "TEXT_TOO_LONG" || code === "EMPTY") { show(1); setErr("err1", code); return; }
      if (code === "WISH_REQUIRED" || code === "RECIPIENT_REQUIRED") { show(2); setErr("err2", code); return; }
      var known = ["EMAIL_INVALID", "EMAIL_REQUIRED", "CONSENT_REQUIRED", "RATE_LIMITED", "NETWORK"];
      setErr("err3", known.indexOf(code) >= 0 ? code : "UNKNOWN");
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

  /* ---------- start ---------- */
  counts(); syncProduct();
  if (params.get("from") === "hero" && clean(note.value)) show(2); else show(1);
  if (state.step === 1) setTimeout(function () { note.focus({ preventScroll: true }); }, 250);
})();
