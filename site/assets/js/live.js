/* Live page: the shared fire burns everyone's papers one by one. ?stream=1 hides the page chrome for the YouTube capture. */
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

  // Start a few papers back so the fire isn't empty on arrival.
  A.loadStats().then(function (s) {
    lastNumber = s ? Math.max(0, (s.papers_burned || 0) - 4) : 0;
    poll();
  });
})();
