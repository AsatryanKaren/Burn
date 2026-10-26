/* Admin page. All data comes from the `admin` Edge Function, protected by a secret token. */
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("site-data").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var token = null;
  try { token = sessionStorage.getItem("adminToken"); } catch (e) {}

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function when(s) { if (!s) return ""; var d = new Date(s); return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }

  function call(action, body) {
    return fetch(D.supabase.url + "/functions/v1/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": D.supabase.anon_key, "Authorization": "Bearer " + D.supabase.anon_key, "x-admin-token": token || "" },
      body: JSON.stringify(Object.assign({ action: action }, body || {}))
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) throw { status: r.status, code: j && j.error && j.error.code, message: (j && j.error && j.error.message) || ("HTTP " + r.status) };
        return j;
      });
    });
  }

  /* ---------- auth ---------- */
  function signedIn(ok) {
    $("login").hidden = ok; $("tabs").hidden = !ok; $("logout").hidden = !ok;
    if (ok) show("overview");
  }
  $("login").addEventListener("submit", function (e) {
    e.preventDefault();
    token = $("token").value.trim();
    $("loginErr").textContent = "";
    call("stats").then(function (s) {
      try { sessionStorage.setItem("adminToken", token); } catch (err) {}
      signedIn(true); renderStats(s);
    }).catch(function (err) {
      token = null;
      $("loginErr").textContent = err.status === 401 ? "Wrong token." : err.status === 429 ? "Too many attempts. Wait 10 minutes." : "Can't reach the server: " + err.message;
    });
  });
  $("logout").addEventListener("click", function () {
    token = null; try { sessionStorage.removeItem("adminToken"); } catch (e) {}
    ["overview", "moderation", "orders", "export"].forEach(function (s) { $(s).hidden = true; });
    signedIn(false);
  });

  /* ---------- tabs ---------- */
  function show(tab) {
    ["overview", "moderation", "orders", "export"].forEach(function (s) { $(s).hidden = s !== tab; });
    document.querySelectorAll("[data-tab]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-tab") === tab)); });
    if (tab === "overview") call("stats").then(renderStats).catch(onErr);
    if (tab === "moderation") loadModeration();
    if (tab === "orders") loadOrders(true);
  }
  document.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { show(b.getAttribute("data-tab")); }); });
  function onErr(err) {
    if (err && err.status === 401) { alertBox("Session expired. Sign in again."); $("logout").click(); }
    else alertBox("Error: " + (err && err.message || "unknown"));
  }
  function alertBox(msg) {
    var n = document.createElement("div"); n.className = "toast on"; n.textContent = msg; document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 3200);
  }

  /* ---------- overview ---------- */
  function renderStats(s) {
    var by = s.orders_by_status || {};
    var cards = [
      ["Papers burned", fmt(s.papers_burned)],
      ["Revenue", fmt(s.revenue_amd) + " ֏"],
      ["Gift fund (20%)", fmt(s.gift_fund_amd) + " ֏"],
      ["Waiting for review", fmt(s.pending_moderation)],
      ["Saved before launch", fmt(by.awaiting_launch)],
      ["Pending payment", fmt(by.pending)],
      ["Failed", fmt(by.failed)],
      ["Refunded", fmt(by.refunded)],
      ["Waitlist", fmt(s.waitlist_count)],
      ["Need a bank refund", fmt(s.needs_refund)]
    ];
    $("statsGrid").innerHTML = cards.map(function (c) { return '<div class="adm-card adm-stat"><span class="v">' + esc(c[1]) + '</span><span class="k">' + esc(c[0]) + "</span></div>"; }).join("");
  }

  /* ---------- moderation ---------- */
  function loadModeration() {
    var m = $("modFilter").value;
    $("modList").innerHTML = '<p class="empty">Loading…</p>';
    call("list_orders", { moderation: m, limit: 100 }).then(function (r) {
      var rows = (r && (r.orders || r.rows)) || (Array.isArray(r) ? r : []);
      if (!rows.length) { $("modList").innerHTML = '<p class="empty">Nothing here.</p>'; return; }
      $("modList").innerHTML = rows.map(function (o) {
        return '<div class="adm-item" data-code="' + esc(o.code) + '"><div><div class="txt">' + esc(o.text) + '</div><div class="meta">' +
          '<span class="pill ' + esc(o.status) + '">' + esc(o.status) + "</span> " + (o.burn_number ? "№ " + fmt(o.burn_number) + " · " : "") +
          esc(o.product) + (o.light_signature ? " · signature: " + esc(o.light_signature) : "") + " · " + esc(o.lang) + " · " + (o.show_on_stream ? "public allowed" : "private") + " · " + esc(when(o.created_at)) +
          (o.moderation_reason ? " · reason: " + esc(o.moderation_reason) : "") + '</div></div><div class="acts">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-mod="approved">Approve</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-mod="hidden">Hide text</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-mod="rejected">Reject</button></div></div>';
      }).join("");
    }).catch(onErr);
  }
  $("modFilter").addEventListener("change", loadModeration);
  $("modReload").addEventListener("click", loadModeration);
  $("modList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-mod]"); if (!b) return;
    var item = b.closest("[data-code]"), code = item.getAttribute("data-code");
    b.disabled = true;
    call("moderate", { code: code, moderation: b.getAttribute("data-mod") }).then(function () { item.remove(); }).catch(function (err) { b.disabled = false; onErr(err); });
  });

  /* ---------- orders ---------- */
  var lastId = null;
  function loadOrders(reset) {
    if (reset) { lastId = null; $("ordRows").innerHTML = ""; }
    var body = { limit: 100 };
    if ($("ordStatus").value) body.status = $("ordStatus").value;
    if ($("ordQ").value.trim()) body.q = $("ordQ").value.trim();
    if (lastId) body.before_id = lastId;
    call("list_orders", body).then(function (r) {
      var rows = (r && (r.orders || r.rows)) || (Array.isArray(r) ? r : []);
      if (!rows.length && reset) { $("ordRows").innerHTML = '<tr><td colspan="9" class="empty">No orders.</td></tr>'; }
      $("ordRows").insertAdjacentHTML("beforeend", rows.map(function (o) {
        var link = D.urls.paper + "?c=" + encodeURIComponent(o.code);
        return "<tr data-code=\"" + esc(o.code) + "\"><td>" + (o.burn_number ? fmt(o.burn_number) : "") + '</td><td><a href="' + esc(link) + '" target="_blank" rel="noopener">' + esc(o.code) + "</a></td>" +
          '<td><span class="pill ' + esc(o.status) + '">' + esc(o.status) + "</span></td><td>" + esc(o.product) + "</td><td>" + fmt(o.amount_amd) + " ֏</td>" +
          '<td class="t">' + esc(o.text) + (o.wish_text ? '<div class="hint">wish: ' + esc(o.wish_text) + "</div>" : "") + (o.recipient_name ? '<div class="hint">for: ' + esc(o.recipient_name) + "</div>" : "") +
          (o.cell_id != null ? '<div class="hint">plot ' + esc(o.cell_id) + " · " + esc(o.light_icon) + " · " + esc(o.light_color) + (o.light_signature ? " · signed: " + esc(o.light_signature) : "") + "</div>" : "") + "</td>" +
          "<td>" + esc(o.email || "") + "</td><td>" + esc(when(o.created_at)) + "</td>" +
          "<td>" + (o.status === "paid" ? '<button type="button" class="btn btn-ghost btn-sm" data-refund>Mark refunded</button>' : "") + "</td></tr>";
      }).join(""));
      lastId = rows.length ? rows[rows.length - 1].id : lastId;
      $("ordMore").hidden = rows.length < 100;
    }).catch(onErr);
  }
  $("ordReload").addEventListener("click", function () { loadOrders(true); });
  $("ordMore").addEventListener("click", function () { loadOrders(false); });
  $("ordStatus").addEventListener("change", function () { loadOrders(true); });
  $("ordRows").addEventListener("click", function (e) {
    var b = e.target.closest("[data-refund]"); if (!b) return;
    var tr = b.closest("tr"), code = tr.getAttribute("data-code");
    // Two-step confirm inside the page (no browser dialogs).
    if (b.getAttribute("data-armed") !== "1") { b.setAttribute("data-armed", "1"); b.textContent = "Confirm refund"; return; }
    b.disabled = true;
    call("mark_refunded", { code: code }).then(function () { loadOrders(true); }).catch(function (err) { b.disabled = false; onErr(err); });
  });

  /* ---------- export ---------- */
  document.querySelectorAll("[data-export]").forEach(function (b) {
    b.addEventListener("click", function () {
      var action = b.getAttribute("data-export");
      call(action).then(function (r) {
        var blob = new Blob(["﻿" + (r.csv || "")], { type: "text/csv;charset=utf-8" });
        var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = action.replace("_csv", "") + ".csv";
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      }).catch(onErr);
    });
  });

  if (token) call("stats").then(function (s) { signedIn(true); renderStats(s); }).catch(function () { token = null; signedIn(false); });
  else signedIn(false);
})();
