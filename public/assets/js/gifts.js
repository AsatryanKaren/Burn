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
