/* Shared behaviour for every page: data, API client, header, menu, sound, reveals, counters. */
(function () {
  "use strict";

  var el = document.getElementById("site-data");
  var D = el ? JSON.parse(el.textContent) : { t: {}, urls: {}, lang: "hy" };
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ---------- formatting & strings ---------- */
  function fmt(n) {
    var sep = D.lang === "en" ? "," : " ";
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }
  function price(n) { return fmt(n) + " ֏"; }
  function giftShare(n) { return Math.floor(n * D.giftPct / 100); }
  function get(path) {
    var node = D.t;
    path.split(".").forEach(function (k) { node = node == null ? null : node[k]; });
    return node;
  }
  function t(path, vars) {
    var s = get(path);
    if (typeof s !== "string") return s == null ? path : s;
    var v = Object.assign({ year: D.year, next: D.next }, vars || {});
    return s.replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- API ---------- */
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var tm = setTimeout(function () { reject({ code: "NETWORK" }); }, ms || 15000);
      promise.then(function (v) { clearTimeout(tm); resolve(v); }, function (e) { clearTimeout(tm); reject(e); });
    });
  }
  function headers() {
    return { "apikey": D.supabase.anon_key, "Authorization": "Bearer " + D.supabase.anon_key, "Content-Type": "application/json" };
  }
  function parse(res) {
    return res.text().then(function (txt) {
      var body = null;
      try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = null; }
      if (!res.ok) {
        var code = (body && body.error && body.error.code) || (res.status === 429 ? "RATE_LIMITED" : res.status === 404 ? "NOT_FOUND" : "UNKNOWN");
        throw { code: code, status: res.status, body: body };
      }
      return body;
    }, function () { throw { code: "NETWORK" }; });
  }
  var api = {
    rpc: function (name, args) {
      return withTimeout(fetch(D.supabase.url + "/rest/v1/rpc/" + name, { method: "POST", headers: headers(), body: JSON.stringify(args || {}) })
        .catch(function () { throw { code: "NETWORK" }; }).then(parse));
    },
    fn: function (name, body, query) {
      var url = D.supabase.url + "/functions/v1/" + name + (query ? "?" + new URLSearchParams(query).toString() : "");
      var init = body ? { method: "POST", headers: headers(), body: JSON.stringify(body) } : { method: "GET", headers: headers() };
      return withTimeout(fetch(url, init).catch(function () { throw { code: "NETWORK" }; }).then(parse));
    }
  };

  /* ---------- stats ---------- */
  var statsPromise = null;
  function loadStats(force) {
    if (!statsPromise || force) {
      statsPromise = api.rpc("get_public_stats").then(function (r) {
        return Array.isArray(r) ? r[0] : r;
      }).catch(function () { return null; });
    }
    return statsPromise;
  }
  function countUp(node, to, format) {
    var show = function (v) { node.textContent = format === "price" ? price(v) : fmt(v); };
    if (reduceMotion || !window.gsap) { show(to); return; }
    var from = Number(node.getAttribute("data-current") || 0), o = { v: from };
    node.setAttribute("data-current", to);
    window.gsap.to(o, { v: to, duration: 1.4, ease: "power2.out", onUpdate: function () { show(o.v); } });
  }
  function paintStats(s) {
    if (!s) return;
    document.querySelectorAll("[data-stat]").forEach(function (n) {
      var v = s[n.getAttribute("data-stat")];
      if (v == null) return;
      if (n.getAttribute("data-format") === "price" && Number(v) === 0) { n.textContent = t("gifts.fund_soon"); n.classList.add("muted"); return; }
      countUp(n, Number(v), n.getAttribute("data-format"));
    });
    var c = document.querySelector("[data-counter]");
    if (c && s.papers_burned >= D.showCounterFrom) c.innerHTML = t("hero.counter", { n: fmt(s.papers_burned) });
  }

  /* ---------- header, menu ---------- */
  function initChrome() {
    var bar = document.getElementById("topbar");
    if (bar) {
      var onScroll = function () { bar.classList.toggle("scrolled", window.scrollY > 12); };
      onScroll(); window.addEventListener("scroll", onScroll, { passive: true });
    }
    var btn = document.getElementById("menuBtn"), menu = document.getElementById("menu");
    if (btn && menu) {
      var setOpen = function (open) {
        menu.hidden = !open; btn.setAttribute("aria-expanded", String(open));
        document.body.style.overflow = open ? "hidden" : "";
      };
      btn.addEventListener("click", function () { setOpen(menu.hidden); });
      menu.addEventListener("click", function (e) { if (e.target.closest("a")) setOpen(false); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) setOpen(false); });
    }
    // Remember language choice for the next visit (convenience only).
    document.querySelectorAll("[data-lang-link]").forEach(function (a) {
      a.addEventListener("click", function () { try { localStorage.setItem("lang", a.getAttribute("hreflang")); } catch (e) {} });
    });
    var sb = document.getElementById("soundBtn");
    if (sb && window.FireScene) {
      sb.addEventListener("click", function () {
        var on = window.FireScene.Sound.toggle();
        sb.setAttribute("aria-pressed", String(on));
        sb.setAttribute("aria-label", on ? sb.getAttribute("data-label-on") : sb.getAttribute("data-label-off"));
        var w = sb.querySelector(".waves"); if (w) w.setAttribute("opacity", on ? "1" : ".35");
      });
    }
  }

  /* ---------- reveals ---------- */
  function initReveals() {
    var items = document.querySelectorAll("[data-reveal]");
    if (!items.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) { items.forEach(function (n) { n.classList.add("revealed"); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var n = e.target, siblings = Array.prototype.indexOf.call(n.parentNode.children, n);
        n.style.transitionDelay = Math.min(siblings, 4) * 90 + "ms";
        n.classList.add("revealed"); io.unobserve(n);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach(function (n) { io.observe(n); });
  }

  /* ---------- scene helper ---------- */
  function mountScene(opts) {
    var canvas = document.getElementById("gl");
    if (!canvas || !window.FireScene) return null;
    var scene = window.FireScene.create(canvas, Object.assign({ year: D.year }, opts || {}));
    var host = canvas.parentElement;
    scene.onFirstFrameSet(function () { if (host) host.classList.add("scene-ready"); });
    scene.onFlicker = function (v) { document.documentElement.style.setProperty("--flick", v.toFixed(3)); };
    return scene;
  }

  /* ---------- toast ---------- */
  var toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("on"); }, 2200);
  }
  function copy(text) {
    var done = function () { toast(t("paper.copied")); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    }
    fallbackCopy(text); done(); return Promise.resolve();
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta);
  }

  /* ---------- story card ---------- */
  function storyImage(scene, number) {
    var css = getComputedStyle(document.documentElement);
    var serif = css.getPropertyValue("--serif"), sans = css.getPropertyValue("--sans");
    var canvas = scene.storyCanvas(function (ctx, W, H) {
      var g = ctx.createLinearGradient(0, 0, 0, H * 0.55);
      g.addColorStop(0, "rgba(3,5,12,.6)"); g.addColorStop(1, "rgba(3,5,12,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.55);
      ctx.textAlign = "left"; ctx.fillStyle = "#f3ece0";
      ctx.font = "600 92px " + serif; ctx.fillText(t("story.bye"), 90, 290);
      ctx.font = "600 300px " + serif; ctx.fillText(String(D.year), 74, 550);
      ctx.fillStyle = "#a9b0c3"; ctx.font = "500 42px " + sans; ctx.fillText(t("story.num"), 92, 680);
      ctx.fillStyle = "#ffc46b"; ctx.font = "700 120px " + serif; ctx.fillText("№ " + fmt(number), 86, 810);
      ctx.fillStyle = "rgba(243,236,224,.88)"; ctx.font = "600 40px " + serif; ctx.textAlign = "center";
      ctx.fillText(D.brand, W / 2, H - 70);
    });
    return canvas;
  }
  function shareStory(scene, number, pageUrl) {
    var canvas = storyImage(scene, number);
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        var file = blob ? new File([blob], "story-" + number + ".png", { type: "image/png" }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], url: pageUrl }).then(function () { resolve("shared"); }, function () { resolve(openModal(canvas)); });
        } else {
          resolve(openModal(canvas));
        }
      }, "image/png");
    });
  }
  function openModal(canvas) {
    var m = document.createElement("div");
    m.className = "modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true");
    var url = canvas.toDataURL("image/jpeg", 0.92);
    m.innerHTML = '<img alt="">' + '<p>' + esc(t("paper.story_hint")) + '</p><div class="row"><button type="button" class="btn btn-ghost" data-close>' + esc(t("common.close")) + "</button></div>";
    m.querySelector("img").src = url;
    var close = function () { m.remove(); document.removeEventListener("keydown", onKey); };
    var onKey = function (e) { if (e.key === "Escape") close(); };
    m.addEventListener("click", function (e) { if (e.target === m || e.target.hasAttribute("data-close")) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(m);
    m.querySelector("[data-close]").focus();
    return "modal";
  }

  // Instagram / TikTok / Facebook in-app browsers: some payment pages and file sharing misbehave there.
  var ua = navigator.userAgent || "";
  var inApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Bytedance|Line\/|Telegram/i.test(ua);
  if (inApp) document.documentElement.classList.add("in-app");

  window.APP = {
    D: D, t: t, fmt: fmt, price: price, giftShare: giftShare, esc: esc, api: api,
    loadStats: loadStats, paintStats: paintStats, mountScene: mountScene, toast: toast, copy: copy,
    shareStory: shareStory, reduceMotion: reduceMotion, inApp: inApp
  };

  function boot() {
    initChrome();
    initReveals();
    if (document.querySelector("[data-stat], [data-counter]")) loadStats().then(paintStats);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
