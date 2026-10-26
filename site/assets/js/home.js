/* Home page: hero fire + inline paper, typing demo, live feed, embers. */
(function () {
  "use strict";
  var A = window.APP, D = A.D, t = A.t;

  var scene = A.mountScene({ layout: "hero" });

  /* hero paper: write here, continue on the burn page */
  var form = document.getElementById("heroForm"), note = document.getElementById("heroNote");
  var ph = t("burn.placeholders"), phI = 0;
  if (Array.isArray(ph) && note) {
    setInterval(function () { if (!note.value && document.activeElement !== note) { phI = (phI + 1) % ph.length; note.placeholder = ph[phI]; } }, 2600);
  }
  try {
    var saved = JSON.parse(sessionStorage.getItem("draft") || "null");
    if (saved && saved.text && note) note.value = saved.text;
  } catch (e) {}
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = (note.value || "").replace(/\s+/g, " ").trim().slice(0, 120);
      try {
        var d = JSON.parse(sessionStorage.getItem("draft") || "{}") || {};
        d.text = text; sessionStorage.setItem("draft", JSON.stringify(d));
      } catch (err) {}
      location.href = D.urls.burn + (text ? "?from=hero" : "");
    });
    note.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.submit(); }
    });
  }

  /* arriving from someone's shared story: "No. 12 847 said goodbye to 2026. Your turn." */
  var refN = new URLSearchParams(location.search).get("n");
  if (refN && /^\d{1,7}$/.test(refN)) {
    var c = document.querySelector("[data-counter]");
    if (c) { c.innerHTML = t("hero.ref", { n: "<b>" + A.fmt(Number(refN)) + "</b>" }); c.setAttribute("data-ref", "1"); }
  }

  /* step 1 typing demo */
  var demo = document.getElementById("typeDemo");
  if (demo && !A.reduceMotion) {
    var phrases = (t("feed.items") || []).slice(0, 6), pi = 0, started = false;
    var type = function () {
      var target = phrases[pi % phrases.length], i = 0;
      demo.textContent = "";
      var step = function () {
        demo.textContent = target.slice(0, ++i);
        if (i < target.length) setTimeout(step, 55 + Math.random() * 70);
        else setTimeout(function () { pi++; erase(); }, 1800);
      };
      var erase = function () {
        if (demo.textContent.length) { demo.textContent = demo.textContent.slice(0, -1); setTimeout(erase, 28); }
        else setTimeout(type, 300);
      };
      step();
    };
    new IntersectionObserver(function (entries, io) {
      if (entries[0].isIntersecting && !started) { started = true; io.disconnect(); type(); }
    }).observe(demo);
  }

  /* step 3 number roll */
  var mini = document.getElementById("miniNum");
  if (mini && !A.reduceMotion && window.gsap) {
    var o = { v: 11200 };
    new IntersectionObserver(function (entries, io) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      window.gsap.to(o, { v: 12847, duration: 2.2, ease: "power3.out", onUpdate: function () { mini.textContent = "№ " + A.fmt(o.v); } });
    }).observe(mini);
  }

  /* feed: show real papers once there are enough public ones */
  A.loadStats().then(function (s) {
    if (!s || s.papers_burned < 12) return;
    return A.api.rpc("get_fire_feed", { after_number: Math.max(0, s.papers_burned - 80), max_rows: 80 }).then(function (rows) {
      var pub = (rows || []).filter(function (r) { return r.text_public; }).reverse();
      if (pub.length < 12) return;
      var rowsEl = document.querySelectorAll("#marquee .marquee-row");
      var half = Math.ceil(pub.length / 2);
      [pub.slice(0, half), pub.slice(half)].forEach(function (list, idx) {
        var html = list.map(function (r) { return '<span class="chip-paper"><span class="n">№ ' + A.fmt(r.burn_number) + "</span>" + A.esc(r.text_public) + "</span>"; }).join("");
        rowsEl[idx].innerHTML = html + html;
      });
      var label = document.getElementById("feedLabel");
      if (label) label.innerHTML = '<span class="dot" aria-hidden="true"></span>' + A.esc(t("feed.live"));
    });
  }).catch(function () {});

  /* rising embers in the final section */
  var em = document.getElementById("embersCss");
  if (em && !A.reduceMotion) {
    var html = "";
    for (var i = 0; i < 22; i++) {
      html += '<i style="left:' + (5 + Math.random() * 90).toFixed(1) + "%;animation-duration:" + (5 + Math.random() * 6).toFixed(1) + "s;animation-delay:" + (Math.random() * 6).toFixed(1) + "s;--dx:" + ((Math.random() - 0.5) * 120).toFixed(0) + 'px"></i>';
    }
    em.innerHTML = html;
  }

  /* hero copy drifts up a little faster than the page as you scroll away */
  if (window.gsap && window.ScrollTrigger && !A.reduceMotion) {
    window.gsap.registerPlugin(window.ScrollTrigger);
    window.gsap.to(".hero-inner", { yPercent: -12, opacity: 0.15, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
  }

  // Keep the fire responsive to the paper: a small flare when someone starts typing.
  if (note && scene) {
    var flared = false;
    note.addEventListener("input", function () { if (!flared && note.value.length > 2) { flared = true; scene.flare(0.6); } });
  }

  /* "Light up Armenia" teaser: a live, non-interactive map, loaded when it comes near the screen */
  var lt = document.getElementById("ltTeaser");
  if (lt && window.MapCore && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      window.MapCore.loadMap(lt.getAttribute("data-map")).then(function (m) {
        var v = new window.MapCore.MapView(lt.querySelector("canvas"), m, { lang: D.lang, labels: false, pad: 14 });
        A.api.rpc("get_map").then(function (r) { v.setLights((r && r.lit) || [], (r && r.held) || []); }).catch(function () {});
      }).catch(function () {});
    }, { rootMargin: "300px" });
    io.observe(lt);
  }
})();
