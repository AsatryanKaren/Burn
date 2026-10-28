/* The room overlay: decorate your plot's room, or step into someone else's.
   RoomUI.open({ mode: "edit"|"view", layout, title, kicker, message, signature, onDone(layout, imageUrl) })
   three.js and room.js are loaded only when a room is first opened. */
(function () {
  "use strict";
  var A = window.APP, t = A.t, esc = A.esc;
  var $ = function (id) { return document.getElementById(id); };
  var ov = $("roomOverlay");
  if (!ov) return;
  var room = null, cur = null, loading = null, lastFocus = null;

  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function ensure() {
    if (window.Room) return Promise.resolve();
    if (!loading) {
      loading = (window.THREE ? Promise.resolve() : loadScript(ov.getAttribute("data-three")))
        .then(function () { return loadScript(ov.getAttribute("data-room")); })
        .catch(function (e) { loading = null; throw e; });
    }
    return loading;
  }

  var built = false;
  function buildDock() {
    if (built) return; built = true;
    var thumbs = window.Room.thumbnails(84);
    $("rmItems").innerHTML = window.Room.ORDER.map(function (k) {
      return '<button type="button" class="rm-item" data-add="' + k + '">' +
        (thumbs[k] ? '<img src="' + thumbs[k] + '" alt="">' : "") + "<span>" + esc(t("room.items." + k)) + "</span></button>";
    }).join("");
    $("rmItems").addEventListener("click", function (e) {
      var b = e.target.closest("[data-add]"); if (!b || !room) return;
      if (!room.add(b.getAttribute("data-add"))) A.toast(t("room.full"));
    });
    ov.querySelectorAll("[data-wall]").forEach(function (b) { b.addEventListener("click", function () { room && room.setStyle("wall", b.getAttribute("data-wall")); syncStyles(); }); });
    ov.querySelectorAll("[data-floor]").forEach(function (b) { b.addEventListener("click", function () { room && room.setStyle("floor", b.getAttribute("data-floor")); syncStyles(); }); });
    $("rmGlow").addEventListener("change", function () { room && room.setStyle("glow", $("rmGlow").checked); });
    $("rmRotate").addEventListener("click", function () { room && room.rotate(); });
    $("rmRemove").addEventListener("click", function () { room && room.remove(); });
  }
  function syncStyles() {
    if (!room) return;
    var l = room.getLayout();
    ov.querySelectorAll("[data-wall]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-wall") === l.wall)); });
    ov.querySelectorAll("[data-floor]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-floor") === l.floor)); });
    $("rmGlow").checked = !!l.glow;
  }
  function onSelect(type) {
    $("rmSel").hidden = !type;
    if (type) $("rmSelName").textContent = t("room.items." + type);
  }

  function open(o) {
    cur = o; lastFocus = document.activeElement;
    var edit = o.mode === "edit";
    ov.hidden = false; ov.classList.toggle("is-edit", edit); ov.classList.toggle("is-view", !edit);
    document.body.style.overflow = "hidden";
    $("rmKicker").textContent = o.kicker || t(edit ? "room.kicker_edit" : "room.kicker_visit");
    $("rmTitle").textContent = o.title || "";
    $("rmDone").hidden = !edit; $("rmDock").hidden = !edit; $("rmSel").hidden = true;
    var hasMsg = !edit && (o.message || o.signature);
    $("rmMsg").hidden = !hasMsg;
    if (hasMsg) { $("rmMsgText").textContent = o.message || ""; $("rmMsgSig").textContent = o.signature ? t("lights.lit_by", { name: o.signature }) : ""; }
    $("rmLoading").hidden = false;
    if (edit && window.Room) buildDock();
    ov.style.setProperty("--dock-h", (edit ? $("rmDock").offsetHeight : 0) + "px");
    ensure().then(function () {
      if (cur !== o) return;
      $("rmLoading").hidden = true;
      if (room) { room.dispose(); room = null; }
      var c = $("roomCanvas"), fresh = c.cloneNode(false); c.parentNode.replaceChild(fresh, c);
      room = window.Room.create(fresh, { editable: edit, layout: o.layout, onSelect: onSelect, onChange: syncStyles });
      if (!room) { close(); A.toast(t("lights.map_err")); return; }
      if (edit) { buildDock(); syncStyles(); }
      ov.style.setProperty("--dock-h", (edit ? $("rmDock").offsetHeight : 0) + "px");
      (edit ? $("rmDone") : $("rmClose")).focus();
    }).catch(function () { close(); A.toast(t("burn.errors.NETWORK")); });
  }
  function close(save) {
    var o = cur; cur = null;
    if (save && o && o.onDone && room) {
      var img = null; try { img = room.snapshot(); } catch (e) {}
      o.onDone(room.getLayout(), img);
    }
    if (room) { room.dispose(); room = null; }
    ov.hidden = true; document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $("rmDone").addEventListener("click", function () { close(true); });
  $("rmClose").addEventListener("click", function () { close(cur && cur.mode === "edit"); });
  ov.querySelectorAll("[data-zoom]").forEach(function (b) { b.addEventListener("click", function () { room && room.zoom(Number(b.getAttribute("data-zoom"))); }); });
  document.addEventListener("keydown", function (e) {
    if (ov.hidden) return;
    if (e.key === "Escape") { e.stopImmediatePropagation(); close(cur && cur.mode === "edit"); }
    if (cur && cur.mode === "edit" && room && (e.key === "Delete" || e.key === "Backspace") && document.activeElement === document.body) room.remove();
    if (cur && cur.mode === "edit" && room && (e.key === "r" || e.key === "R")) room.rotate();
  }, true);

  window.RoomUI = { open: open, close: close, isOpen: function () { return !ov.hidden; } };
})();
