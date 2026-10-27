/* Gifts page: translate the fund total into an approximate number of gifts. */
(function () {
  "use strict";
  var A = window.APP, n = document.getElementById("giftCount");
  if (!A || !n) return;
  var per = Number(n.getAttribute("data-per")) || 10000;
  A.loadStats().then(function (s) {
    if (!s || !s.gift_fund_amd) return;
    n.textContent = A.t("gifts_page.fund_gifts", { n: A.fmt(Math.floor(s.gift_fund_amd / per)) }) + " · " + A.t("gifts_page.fund_gifts_note", { price: A.price(per) });
  });
})();

/* Blogger applications for the 31 December gift delivery. */
(function () {
  "use strict";
  var A = window.APP, f = document.getElementById("blForm");
  if (!A || !f) return;
  var $ = function (id) { return document.getElementById(id); };
  var t = A.t, busy = false;
  function clean(s) { return (s || "").replace(/\s+/g, " ").trim(); }
  function errText(code) {
    var k = "gifts_page.bl_errors." + code, v = t(k);
    if (v !== k) return v;
    k = "burn.errors." + code; v = t(k);
    return v === k ? t("burn.errors.UNKNOWN") : v;
  }
  function fail(code, el) { $("blErr").textContent = errText(code); if (el) el.focus(); }
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    var body = {
      name: clean($("blName").value), link: clean($("blLink").value), platform: $("blPlatform").value,
      audience: clean($("blAudience").value) || null, email: clean($("blEmail").value),
      phone: clean($("blPhone").value) || null, message: clean($("blMsg").value) || null,
      lang: A.D.lang, consent: $("blConsent").checked
    };
    if (body.link && !/^https?:\/\//i.test(body.link)) body.link = "https://" + body.link;
    if (!body.name) return fail("NAME_REQUIRED", $("blName"));
    if (!body.link) return fail("LINK_REQUIRED", $("blLink"));
    if (!/^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(body.link)) return fail("LINK_INVALID", $("blLink"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) return fail("EMAIL_INVALID", $("blEmail"));
    if (!body.consent) return fail("CONSENT_REQUIRED", $("blConsent"));
    $("blErr").textContent = "";
    busy = true; $("blSubmit").disabled = true; $("blSubmit").setAttribute("aria-busy", "true");
    A.api.fn("join-bloggers", body).then(function () {
      f.hidden = true; $("blDone").hidden = false;
    }).catch(function (err) {
      busy = false; $("blSubmit").disabled = false; $("blSubmit").removeAttribute("aria-busy");
      fail((err && err.code) || "UNKNOWN");
    });
  });
})();
