/* Taiko Beats — in-browser beatmap editor.
   Horizontal scrolling timeline, 3 lanes, waveform, snap grid,
   playback + scrubbing, test-play, undo/redo, save/load/export/import. */
"use strict";

const Editor = (() => {
  const RULER_H = 34, WAVE_H = 56, LANE_H = 86, LANE_PAD = 6;
  const NOTE_R = 15, HIT_PX = 18; // pick radius for deleting notes
  const SNAP_DIVS = { 1: 0, 4: 4, 8: 8, 12: 12, 16: 16, 24: 24, 32: 32 };
  const STORE_KEY = "taikoBeats.maps.v1";

  let cvs, ctx;
  let cb = {};                       // { onMenu, onTestPlay }
  let active = false;

  // document state
  let chart = null;
  let audioBuf = null, audioName = null, audioFileUsed = null;
  let dirty = false;

  // view state
  let cursorMs = 0, scrollMs = 0, pxPerMs = 0.14, snapDiv = 8;
  let playing = false, playT0 = 0, sched = null, src = null, raf = null;
  let wavePeaks = null;              // [{min,max}] per px bucket, lazy
  let dragScrub = false;

  let undoStack = [], redoStack = [];

  /* ---------------- lifecycle ---------------- */
  function init(callbacks) {
    cb = callbacks;
    cvs = document.getElementById("editor-canvas");
    ctx = cvs.getContext("2d");
    bindUi();
    bindCanvas();
    window.addEventListener("resize", () => { if (active) sizeCanvas(); });
    window.addEventListener("keydown", onKey);
  }

  function open(existing) {
    active = true;
    stopPlayback();
    undoStack = []; redoStack = [];
    audioBuf = null; audioName = null; wavePeaks = null;
    if (existing && existing.chart) {
      chart = sanitizeChart(existing.chart);
      if (existing.audioBuffer) { audioBuf = existing.audioBuffer; audioName = existing.audioName || "audio"; }
    } else {
      chart = sanitizeChart({ name: "Untitled", bpm: 120, lengthMs: 60000 });
    }
    cursorMs = 0; scrollMs = 0; dirty = false;
    syncUi();
    sizeCanvas();
    status(existing ? `Loaded <b>${esc(chart.name)}</b>` : "New map — set BPM, then click lanes to add notes.");
    requestDraw();
  }

  function close() {
    active = false;
    stopPlayback();
  }

  /* Suspend input/drawing while test-playing in the game screen. */
  function suspend() { active = false; stopPlayback(); }
  function resume() { active = true; syncUi(); sizeCanvas(); }

  function isActive() { return active; }

  /* ---------------- undo / redo ---------------- */
  function snapshot() {
    return JSON.stringify({
      name: chart.name, bpm: chart.bpm, offsetMs: chart.offsetMs,
      lengthMs: chart.lengthMs, audio: chart.audio, notes: chart.notes,
    });
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    dirty = true;
    refreshUndoButtons();
  }
  function applySnapshot(s) {
    const d = JSON.parse(s);
    Object.assign(chart, d);
    wavePeaks = null;
    syncUi();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    applySnapshot(undoStack.pop());
    refreshUndoButtons(); requestDraw();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    applySnapshot(redoStack.pop());
    refreshUndoButtons(); requestDraw();
  }
  function refreshUndoButtons() {
    document.getElementById("ed-undo").disabled = !undoStack.length;
    document.getElementById("ed-redo").disabled = !redoStack.length;
  }

  /* ---------------- UI wiring ---------------- */
  function el(id) { return document.getElementById(id); }

  function bindUi() {
    el("ed-menu").onclick = () => {
      if (dirty && !confirm("Unsaved changes — leave editor?")) return;
      cb.onMenu();
    };
    el("ed-name").onchange = e => { pushUndo(); chart.name = e.target.value || "Untitled"; };
    el("ed-bpm").onchange = e => { pushUndo(); chart.bpm = clamp(+e.target.value || 120, 40, 300); e.target.value = chart.bpm; wavePeaks = null; requestDraw(); };
    el("ed-offset").onchange = e => { pushUndo(); chart.offsetMs = Math.round(+e.target.value || 0); e.target.value = chart.offsetMs; };
    el("ed-snap").onchange = e => { snapDiv = +e.target.value; requestDraw(); };
    el("ed-zoom").oninput = e => { pxPerMs = +e.target.value; requestDraw(); };
    el("ed-play").onclick = togglePlay;
    el("ed-test").onclick = () => cb.onTestPlay(chart, audioBuf, cursorMs);
    el("ed-undo").onclick = undo;
    el("ed-redo").onclick = redo;
    el("ed-audio").onclick = () => el("ed-audio-file").click();
    el("ed-audio-file").onchange = onAudioFile;
    el("ed-save").onclick = saveMap;
    el("ed-export").onclick = exportMap;
    el("ed-import").onclick = () => el("ed-import-file").click();
    el("ed-import-file").onchange = onImportFile;
    el("ed-load").onchange = e => {
      const id = e.target.value;
      if (!id) return;
      const maps = loadStore();
      if (maps[id]) {
        if (dirty && !confirm("Discard unsaved changes?")) { e.target.value = ""; return; }
        open({ chart: maps[id].chart });
      }
      e.target.value = "";
    };
  }

  function syncUi() {
    el("ed-name").value = chart.name;
    el("ed-bpm").value = chart.bpm;
    el("ed-offset").value = chart.offsetMs;
    el("ed-audio-name").textContent = audioName ? `file: ${audioName}` : "synth track";
    refreshSavedList();
    refreshUndoButtons();
  }

  /* ---------------- audio loading ---------------- */
  async function onAudioFile(e) {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      AudioEngine.ensure();
      const buf = await f.arrayBuffer();
      audioBuf = await AudioEngine.ctx.decodeAudioData(buf);
      audioName = f.name;
      pushUndo();
      chart.audio = "file";
      chart.lengthMs = Math.ceil(audioBuf.duration * 1000);
      wavePeaks = null;
      el("ed-audio-name").textContent = `file: ${audioName}`;
      status(`Audio loaded: <b>${esc(audioName)}</b> (${audioBuf.duration.toFixed(1)}s). Length set to audio.`);
      requestDraw();
    } catch (err) {
      status("Could not decode that audio file.");
    }
  }

  /* ---------------- persistence ---------------- */
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveStore(m) { localStorage.setItem(STORE_KEY, JSON.stringify(m)); }

  function saveMap() {
    pushlessSyncName();
    const maps = loadStore();
    const id = "map-" + (chart.name || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
    maps[id] = { chart: sanitizeChart(chart), savedAt: Date.now() };
    saveStore(maps);
    dirty = false;
    refreshSavedList();
    status(`Saved <b>${esc(chart.name)}</b> to this browser's map library (appears under Custom Maps on the menu).`);
  }

  function pushlessSyncName() { chart.name = el("ed-name").value || "Untitled"; }

  function refreshSavedList() {
    const sel = el("ed-load");
    const maps = loadStore();
    sel.innerHTML = '<option value="">Load saved…</option>';
    for (const [id, m] of Object.entries(maps).sort((a, b) => b[1].savedAt - a[1].savedAt)) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = `${m.chart.name} (${m.chart.notes.length} notes)`;
      sel.appendChild(o);
    }
  }

  function exportMap() {
    pushlessSyncName();
    const c = sanitizeChart(chart);
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (c.name || "map").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".taiko.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    status("Exported map JSON.");
  }

  function onImportFile(e) {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const raw = JSON.parse(r.result);
        if (!raw || !Array.isArray(raw.notes)) throw new Error("bad file");
        if (dirty && !confirm("Discard unsaved changes?")) return;
        open({ chart: raw });
        status(`Imported <b>${esc(chart.name)}</b>.${chart.audio === "file" ? " Load its audio file to hear it." : ""}`);
      } catch (err) {
        status("That file is not a valid Taiko Beats map JSON.");
      }
    };
    r.readAsText(f);
  }

  /* ---------------- playback ---------------- */
  function togglePlay() { playing ? stopPlayback() : startPlayback(); }

  function startPlayback(fromMs) {
    AudioEngine.ensure();
    if (fromMs !== undefined) { cursorMs = clamp(fromMs, 0, chart.lengthMs); scrollTo(cursorMs); }
    const start = cursorMs;
    playT0 = AudioEngine.now() + 0.08;
    if (audioBuf) {
      src = AudioEngine.ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(AudioEngine.master);
      src.start(playT0, Math.max(0, (start - chart.offsetMs) / 1000));
    } else {
      sched = createScheduler(
        synthBacking(chart.bpm, chart.lengthMs)
          .filter(e => e.t >= start)
          .map(e => ({ ...e, t: e.t - start })),
        playT0, 0
      );
    }
    // note sounds on playback
    const noteEv = chart.notes
      .filter(n => n.t >= start)
      .map(n => ({ t: n.t - start, inst: LANE_INFO[n.lane].inst, vol: 0.8 }));
    const noteSched = createScheduler(noteEv, playT0, 0);
    const baseStop = sched ? sched.stop.bind(sched) : null;
    sched = { stop() { if (baseStop) baseStop(); noteSched.stop(); } };
    playing = true;
    el("ed-play").innerHTML = "&#10074;&#10074; Pause";
    raf = requestAnimationFrame(playFrame);
  }

  function stopPlayback() {
    playing = false;
    if (sched) { sched.stop(); sched = null; }
    if (src) { try { src.stop(); } catch (e) {} src = null; }
    if (raf) cancelAnimationFrame(raf); raf = null;
    const b = document.getElementById("ed-play");
    if (b) b.innerHTML = "&#9654; Play";
  }

  function playFrame() {
    if (!playing) return;
    raf = requestAnimationFrame(playFrame);
    cursorMs = (AudioEngine.now() - playT0) * 1000;
    if (cursorMs >= chart.lengthMs) { cursorMs = chart.lengthMs; stopPlayback(); }
    // keep cursor ~30% from the left edge
    const viewMs = cvs.width / pxPerMs;
    if (cursorMs < scrollMs + viewMs * 0.25 || cursorMs > scrollMs + viewMs * 0.75)
      scrollMs = Math.max(0, cursorMs - viewMs * 0.3);
    requestDraw();
  }

  /* ---------------- canvas ---------------- */
  function sizeCanvas() {
    const r = cvs.getBoundingClientRect();
    cvs.width = Math.max(300, Math.floor(r.width));
    cvs.height = Math.max(200, Math.floor(r.height));
    requestDraw();
  }

  const t2x = t => (t - scrollMs) * pxPerMs;
  const x2t = x => scrollMs + x / pxPerMs;
  const laneY = i => RULER_H + WAVE_H + i * LANE_H + LANE_H / 2;

  function snapMs() {
    const d = SNAP_DIVS[snapDiv];
    return d ? msPerBeat(chart.bpm) * (4 / d) : 1;
  }

  function bindCanvas() {
    cvs.addEventListener("mousedown", e => {
      if (!chart) return;
      const { x, y } = pos(e);
      if (y <= RULER_H + WAVE_H) { dragScrub = true; cursorMs = clamp(x2t(x), 0, chart.lengthMs); if (playing) restartAt(cursorMs); requestDraw(); return; }
      const lane = Math.floor((y - RULER_H - WAVE_H) / LANE_H);
      if (lane < 0 || lane > 2) return;
      const tRaw = x2t(x);
      const hit = noteNear(tRaw, lane);
      const nearPx = hit ? Math.abs(t2x(hit.t) - x) : Infinity;
      if (hit && nearPx <= (e.button === 2 ? NOTE_R + 12 : NOTE_R + 4)) {
        deleteNote(hit);
      } else if (e.button !== 2) {
        addNote(Math.round(snapT(tRaw)), lane);
      }
      requestDraw();
    });
    cvs.addEventListener("mousemove", e => {
      if (!dragScrub) return;
      const { x } = pos(e);
      cursorMs = clamp(x2t(x), 0, chart.lengthMs);
      requestDraw();
    });
    window.addEventListener("mouseup", () => { dragScrub = false; });
    cvs.addEventListener("contextmenu", e => e.preventDefault());
    cvs.addEventListener("wheel", e => {
      e.preventDefault();
      if (e.ctrlKey) {
        const anchorT = x2t(pos(e).x);
        pxPerMs = clamp(pxPerMs * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 0.02, 1.2);
        el("ed-zoom").value = pxPerMs;
        scrollMs = anchorT - pos(e).x / pxPerMs;
      } else {
        scrollMs = Math.max(0, scrollMs + e.deltaY * 0.35 / pxPerMs * 0.5);
      }
      requestDraw();
    }, { passive: false });
  }

  function restartAt(ms) {
    // scrubbing during playback: restart sources at new position
    const was = playing;
    stopPlayback();
    if (was) startPlayback(ms);
  }

  function pos(e) {
    const r = cvs.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function snapT(t) { const s = snapMs(); return Math.round(t / s) * s; }

  function noteNear(tRaw, lane) {
    let best = null, bestD = Infinity;
    for (const n of chart.notes) {
      if (n.lane !== lane) continue;
      const d = Math.abs(n.t - tRaw);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  function addNote(t, lane) {
    if (chart.notes.some(n => n.t === t && n.lane === lane)) return;
    pushUndo();
    chart.notes.push({ t: Math.max(0, Math.round(t)), lane });
    chart.notes.sort((a, b) => a.t - b.t);
    dirty = true;
    status(`Note added @ ${fmtT(t)} lane ${lane + 1} — ${chart.notes.length} notes.`);
  }

  function deleteNote(note) {
    pushUndo();
    chart.notes = chart.notes.filter(n => n !== note);
    dirty = true;
    status(`Note deleted @ ${fmtT(note.t)} lane ${note.lane + 1}.`);
  }

  function toggleAtCursor(lane) {
    const n = noteNear(cursorMs, lane);
    if (n && Math.abs(n.t - cursorMs) < snapMs() / 2) deleteNote(n);
    else addNote(Math.round(snapT(cursorMs)), lane);
    requestDraw();
  }

  function onKey(e) {
    if (!active) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === "z" && e.shiftKey) { e.preventDefault(); redo(); }
      else if (k === "z") { e.preventDefault(); undo(); }
      else if (k === "y") { e.preventDefault(); redo(); }
      else if (k === "s") { e.preventDefault(); saveMap(); }
      return;
    }
    if (k === " ") { e.preventDefault(); togglePlay(); }
    else if (k === "t") { cb.onTestPlay(chart, audioBuf, cursorMs); }
    else if (k === "arrowleft") { e.preventDefault(); cursorMs = clamp(snapT(cursorMs) - snapMs(), 0, chart.lengthMs); requestDraw(); }
    else if (k === "arrowright") { e.preventDefault(); cursorMs = clamp(snapT(cursorMs) + snapMs(), 0, chart.lengthMs); requestDraw(); }
    else if (k === "1" || k === "d") toggleAtCursor(0);
    else if (k === "2" || k === "f") toggleAtCursor(1);
    else if (k === "3" || k === "j") toggleAtCursor(2);
    else if (k === "delete" || k === "backspace") {
      // delete note nearest to cursor on any lane
      let best = null, bd = Infinity;
      for (const n of chart.notes) { const d = Math.abs(n.t - cursorMs); if (d < bd) { bd = d; best = n; } }
      if (best && bd <= snapMs()) { deleteNote(best); requestDraw(); }
    }
  }

  /* ---------------- drawing ---------------- */
  let drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; if (active) draw(); });
  }

  function draw() {
    const W = cvs.width, H = cvs.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#120d0b"; ctx.fillRect(0, 0, W, H);
    const viewMs = W / pxPerMs;
    const mpb = msPerBeat(chart.bpm);

    drawWaveform(W);
    drawGrid(W, mpb);
    drawLanes(W);
    drawNotes(W);
    drawCursor();
    updateTime();
  }

  function drawWaveform(W) {
    const y0 = RULER_H, h = WAVE_H;
    ctx.fillStyle = "#0d0a09"; ctx.fillRect(0, y0, W, h);
    if (audioBuf) {
      if (!wavePeaks) computePeaks();
      const ch = wavePeaks;
      const bucketMs = ch.msPerBucket;
      ctx.fillStyle = "#3b82d6";
      const startB = Math.max(0, Math.floor(scrollMs / bucketMs));
      const endB = Math.min(ch.peaks.length, Math.ceil((scrollMs + W / pxPerMs) / bucketMs));
      for (let b = startB; b < endB; b++) {
        const x = t2x(b * bucketMs);
        const p = ch.peaks[b];
        const yc = y0 + h / 2;
        ctx.fillRect(x, yc - p * (h / 2 - 3), Math.max(1, bucketMs * pxPerMs - 0.5), p * (h - 6));
      }
    } else {
      // synth track: draw drum-pattern ticks
      const mpb = msPerBeat(chart.bpm);
      const b0 = Math.floor(scrollMs / mpb), b1 = Math.ceil((scrollMs + W / pxPerMs) / mpb);
      for (let b = b0; b <= b1; b++) {
        const t = b * mpb;
        const x = t2x(t);
        ctx.fillStyle = "#e8452c";
        ctx.fillRect(x, y0 + h * 0.25, 3, h * 0.5);
        ctx.fillStyle = "#9b8a76";
        ctx.fillRect(t2x(t + mpb * 0.5), y0 + h * 0.4, 2, h * 0.2);
        ctx.fillRect(t2x(t + mpb * 0.25), y0 + h * 0.42, 1.5, h * 0.16);
        ctx.fillRect(t2x(t + mpb * 0.75), y0 + h * 0.42, 1.5, h * 0.16);
      }
    }
    ctx.strokeStyle = "#3a2517"; ctx.strokeRect(0.5, y0 + 0.5, W - 1, h - 1);
  }

  function computePeaks() {
    const buckets = Math.min(4000, Math.max(500, Math.ceil(audioBuf.duration * 40)));
    const data = audioBuf.getChannelData(0);
    const per = Math.floor(data.length / buckets);
    const peaks = new Float32Array(buckets);
    for (let b = 0; b < buckets; b++) {
      let m = 0;
      const s0 = b * per;
      for (let i = 0; i < per; i += 8) { const v = Math.abs(data[s0 + i]); if (v > m) m = v; }
      peaks[b] = m;
    }
    wavePeaks = { peaks, msPerBucket: audioBuf.duration * 1000 / buckets };
  }

  function drawGrid(W, mpb) {
    const snap = snapMs();
    const step = snap;
    const t0 = Math.floor(scrollMs / step) * step;
    const yTop = RULER_H + WAVE_H;
    for (let t = t0; t <= scrollMs + W / pxPerMs; t += step) {
      const x = t2x(t);
      const onBeat = Math.abs(t / mpb - Math.round(t / mpb)) < 1;
      const onBar = Math.abs(t / (mpb * 4) - Math.round(t / (mpb * 4))) < 1;
      ctx.strokeStyle = onBar ? "rgba(240,180,41,0.55)" : onBeat ? "rgba(240,228,207,0.28)" : "rgba(255,255,255,0.09)";
      ctx.lineWidth = onBar ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, cvs.height); ctx.stroke();
      if (onBeat) {
        ctx.fillStyle = onBar ? "#f0b429" : "#9b8a76";
        ctx.font = "10px 'Trebuchet MS', sans-serif";
        ctx.textAlign = "center";
        const bar = Math.round(t / (mpb * 4)) + 1;
        const beat = Math.round(t / mpb) % 4 + 1;
        ctx.fillText(onBar ? `|${bar}|` : `${bar}.${beat}`, x, RULER_H - 20);
      }
    }
    ctx.lineWidth = 1;
    // ruler base
    ctx.fillStyle = "#1a1310"; ctx.fillRect(0, 0, W, RULER_H - 8);
  }

  function drawLanes(W) {
    for (let i = 0; i < 3; i++) {
      const y = RULER_H + WAVE_H + i * LANE_H;
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.045)";
      ctx.fillRect(0, y, W, LANE_H);
      ctx.strokeStyle = "rgba(58,37,23,0.9)";
      ctx.strokeRect(0, y + 0.5, W, LANE_H - 1);
      // lane label
      const info = LANE_INFO[i];
      ctx.fillStyle = info.color;
      ctx.beginPath(); ctx.arc(16, y + LANE_H / 2, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#9b8a76";
      ctx.font = "10px 'Trebuchet MS', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(info.name.toUpperCase(), 30, y + LANE_H / 2 + 3);
    }
  }

  function drawNotes(W) {
    const tMax = scrollMs + W / pxPerMs;
    for (const n of chart.notes) {
      if (n.t < scrollMs - 50 || n.t > tMax + 50) continue;
      const x = t2x(n.t), y = laneY(n.lane), info = LANE_INFO[n.lane];
      ctx.beginPath(); ctx.arc(x, y, NOTE_R, 0, Math.PI * 2);
      if (n.lane === 1) {
        const grad = ctx.createRadialGradient(x - 4, y - 5, 2, x, y, NOTE_R);
        grad.addColorStop(0, info.hi); grad.addColorStop(1, info.color);
        ctx.fillStyle = grad; ctx.fill();
      } else {
        ctx.fillStyle = "#f2e4cf"; ctx.fill();
        ctx.lineWidth = 5; ctx.strokeStyle = info.color; ctx.stroke(); ctx.lineWidth = 1;
      }
    }
  }

  function drawCursor() {
    const x = t2x(cursorMs);
    ctx.strokeStyle = "#7ed07a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, cvs.height - 4); ctx.stroke();
    ctx.fillStyle = "#7ed07a";
    ctx.beginPath(); ctx.moveTo(x - 7, 4); ctx.lineTo(x + 7, 4); ctx.lineTo(x, 14); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 1;
    if (playing) {
      ctx.fillStyle = "#7ed07a";
      ctx.font = "700 11px 'Trebuchet MS', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("PLAYING", x + 8, 16);
    }
  }

  function updateTime() {
    document.getElementById("ed-time").textContent = fmtT(cursorMs);
  }

  function scrollTo(ms) {
    const viewMs = cvs.width / pxPerMs;
    scrollMs = Math.max(0, ms - viewMs * 0.3);
  }

  /* ---------------- helpers ---------------- */
  function fmtT(ms) {
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return `${m}:${r.toFixed(3).padStart(6, "0")}`;
  }
  function status(html) { document.getElementById("ed-status").innerHTML = html; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function getCustomMaps() {
    return Object.values(loadStore())
      .sort((a, b) => b.savedAt - a.savedAt)
      .map(m => m.chart);
  }

  return { init, open, close, suspend, resume, isActive, getCustomMaps };
})();
