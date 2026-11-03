/* Live page: on 31 December the shared fire burns everyone's wishes one by one; before that it only waits.
   ?stream=1 hides the page chrome for the YouTube capture. */
(function () {
  "use strict";
  var A = window.APP, t = A.t, esc = A.esc;
  var params = new URLSearchParams(location.search);
  var streamMode = params.get("stream") === "1";
  if (streamMode) document.documentElement.classList.add("stream-mode");

  var scene = A.mountScene({ layout: "center" });
  var nowLabel = document.getElementById("nowLabel"), nowNum = document.getElementById("nowNum"), nowTxt = document.getElementById("nowTxt");
  var lastNumber = 0, queue = [], playing = false;

  function showNow(row) {
    nowLabel.textContent = t("live.now");
    nowNum.textContent = t("live.number", { n: A.fmt(row.burn_number) });
    nowTxt.textContent = row.text_public || t("live.hidden_text");
    nowTxt.style.opacity = row.text_public ? "1" : ".55";
    if (window.gsap && !A.reduceMotion) window.gsap.fromTo([nowNum, nowTxt], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08 });
  }
  function idle() {
    nowLabel.textContent = t("live.waiting"); nowNum.textContent = ""; nowTxt.textContent = "";
  }

  function next() {
    if (!queue.length) { playing = false; setTimeout(function () { if (!playing) idle(); }, 2500); return; }
    playing = true;
    var row = queue.shift();
    showNow(row);
    // Full paper burn when the queue is short; quick flares when many papers arrive at once.
    if (scene && queue.length < 3 && row.text_public) {
      scene.burnPaper({ text: row.text_public, onCatch: function () { if (window.FireScene) window.FireScene.Sound.whoosh(); } }).then(next);
    } else {
      if (scene) scene.flare(0.8);
      setTimeout(next, queue.length > 20 ? 600 : 1600);
    }
  }

  function poll() {
    A.api.rpc("get_fire_feed", { after_number: lastNumber, max_rows: 50 }).then(function (rows) {
      (rows || []).forEach(function (r) {
        if (r.burn_number > lastNumber) { lastNumber = r.burn_number; queue.push(r); }
      });
      if (!playing && queue.length) next();
    }).catch(function () {}).then(function () { setTimeout(poll, 6000); });
    A.loadStats(true).then(A.paintStats);
  }

  // All wishes burn together on the fire day (Yerevan date, cfg.stream.start). Before it the
  // fire only waits: no wish burns early. ?fire=1 rehearses the fire day (stream tests).
  var fireDate = document.getElementById("now").getAttribute("data-fire") || "";
  var yerevanToday = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
  if (yerevanToday < fireDate && params.get("fire") !== "1") {
    nowLabel.textContent = t("live.before");
    var lbl = document.getElementById("burnedLabel");
    if (lbl) lbl.textContent = lbl.getAttribute("data-before");
    (function stats() { A.loadStats(true).then(A.paintStats); setTimeout(stats, 30000); })();
    return;
  }

  // Start a few papers back so the fire isn't empty on arrival.
  // Never replay the whole history: wait until the current total is known.
  (function start(attempt) {
    A.loadStats(attempt > 0).then(function (s) {
      if (!s) { setTimeout(function () { start(attempt + 1); }, Math.min(30000, 3000 * (attempt + 1))); return; }
      // The YouTube capture (?stream=1) burns every wish from the first; visitors join near the newest.
      lastNumber = streamMode ? 0 : Math.max(0, (s.papers_burned || 0) - 4);
      poll();
    });
  })(0);
})();
