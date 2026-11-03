/* The room key: a private link (with a QR code) that opens a buyer's room on any device. */
(function () {
  "use strict";
  var A = window.APP, t = A.t;
  function keyUrl(code) { return new URL(A.D.urls.paper + "?c=" + encodeURIComponent(code), location.href).href; }
  function render(el, code) {
    var url = keyUrl(code), canShare = !!navigator.share, qr = window.qrcode(0, "M");
    qr.addData(url); qr.make();
    el.innerHTML = '<div class="rk"><b class="rk-t">🔑 ' + A.esc(t("room.key_t")) + "</b>" +
      '<p class="rk-d">' + A.esc(t("room.key_d")) + "</p>" +
      '<div class="rk-qr" role="img" aria-label="' + A.esc(t("room.key_scan")) + '">' + qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true }) + "</div>" +
      '<p class="rk-scan">' + A.esc(t("room.key_scan")) + "</p>" +
      '<button type="button" class="btn btn-fire btn-block" data-key="copy">' + A.esc(t("room.key_copy")) + "</button>" +
      (canShare ? '<button type="button" class="btn btn-ghost btn-block" data-key="share">' + A.esc(t("room.key_share")) + "</button>" : "") +
      '<p class="rk-warn">' + A.esc(t("room.key_warn")) + "</p></div>";
    el.querySelector('[data-key="copy"]').addEventListener("click", function () { A.copy(url); });
    var share = el.querySelector('[data-key="share"]');
    if (share) share.addEventListener("click", function () { navigator.share({ url: url }).catch(function () {}); });
  }
  window.RoomKey = { render: render };
})();
