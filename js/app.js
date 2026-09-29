/* Taiko Beats — screen manager: menu / game / results / editor. */
"use strict";

const App = (() => {
  let current = "menu";
  let lastPlay = null;   // { chart, audioBuffer, startMs } for retry
  let testingBackToEditor = false;

  const $ = id => document.getElementById(id);

  function show(name) {
    current = name;
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $("screen-" + name).classList.add("active");
  }

  function refreshMenu() {
    const sl = $("song-list");
    sl.innerHTML = "";
    for (const c of BUILTIN_CHARTS) {
      sl.appendChild(songItem(c.name, c.desc || `${c.bpm} BPM`, () => playChart(c, null)));
    }
    const cl = $("custom-list");
    cl.innerHTML = "";
    const customs = Editor.getCustomMaps();
    $("no-custom").style.display = customs.length ? "none" : "block";
    for (const c of customs) {
      const li = songItem(c.name, `${c.bpm} BPM · ${c.notes.length} notes${c.audio === "file" ? " · needs audio file" : ""}`, () => {
        if (c.audio === "file") {
          alert("This map uses an audio file. Open it in the editor and re-load the audio to play, or switch it to the synth track.");
          return;
        }
        playChart(c, null);
      });
      cl.appendChild(li);
    }
  }

  function songItem(name, sub, onClick) {
    const li = document.createElement("li");
    li.className = "song-item";
    const meta = document.createElement("div");
    meta.className = "meta";
    const b = document.createElement("b"); b.textContent = name;
    const sm = document.createElement("small"); sm.textContent = sub;
    meta.appendChild(b); meta.appendChild(sm);
    const badge = document.createElement("span");
    badge.className = "badge"; badge.textContent = "PLAY ▸";
    li.appendChild(meta); li.appendChild(badge);
    li.onclick = onClick;
    return li;
  }

  function playChart(chart, audioBuffer, startMs = 0, returnToEditor = false) {
    lastPlay = { chart, audioBuffer, startMs, returnToEditor };
    testingBackToEditor = returnToEditor;
    show("game");
    Game.start({
      chart, audioBuffer, startMs,
      onExit: res => {
        if (returnToEditor) { show("editor"); Editor.resume(); return; }
        if (res) showResults(res);
        else { show("menu"); refreshMenu(); }
      },
    });
  }

  function showResults(res) {
    $("res-song").textContent = res.chart.name;
    const g = $("res-grade");
    g.textContent = res.grade;
    g.className = "grade " + res.grade.toLowerCase();
    $("res-score").textContent = res.score.toLocaleString();
    $("res-combo").textContent = res.maxCombo;
    $("res-acc").textContent = (res.acc * 100).toFixed(1) + "%";
    $("res-perfect").textContent = res.perfect;
    $("res-good").textContent = res.good;
    $("res-miss").textContent = res.miss;
    show("results");
  }

  function init() {
    Editor.init({
      onMenu: () => { Editor.close(); show("menu"); refreshMenu(); },
      onTestPlay: (chart, audioBuf, startMs) => {
        Editor.suspend();
        playChart(sanitizeChart(chart), audioBuf, startMs, true);
      },
    });

    $("btn-editor").onclick = () => { AudioEngine.ensure(); show("editor"); Editor.open(); };
    $("btn-retry").onclick = () => {
      if (lastPlay) playChart(lastPlay.chart, lastPlay.audioBuffer, lastPlay.startMs, lastPlay.returnToEditor);
    };
    $("btn-back").onclick = () => { show("menu"); refreshMenu(); };

    refreshMenu();
    show("menu");
  }

  document.addEventListener("DOMContentLoaded", init);
  return {};
})();
