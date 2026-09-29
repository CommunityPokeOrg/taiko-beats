/* Taiko Beats — gameplay: 3 vertical lanes, notes fall to a hit line.
   Judge windows: Perfect <=50ms, Good <=110ms, else Miss. */
"use strict";

const Game = (() => {
  const W = 540, H = 720;
  const HIT_Y = 580, TOP_Y = -60;
  const APPROACH_MS = 1900;          // note travel time top -> hit line
  const W_PERFECT = 50, W_GOOD = 110, W_LATE_MISS = 140, W_EARLY_IGNORE = 170;
  const LANE_W = 150, LANE_GAP = 12;
  const LANES_X = [-LANE_W - LANE_GAP, 0, LANE_W + LANE_GAP]; // relative to cx

  const KEY_TO_LANE = {
    d: 0, arrowleft: 0,
    f: 1, arrowdown: 1,
    j: 2, arrowright: 2,
  };

  let raf = null, keyHandler = null, ctx2d = null;
  let state = null;

  function start({ chart, audioBuffer = null, startMs = 0, onExit }) {
    AudioEngine.ensure();
    const cvs = document.getElementById("game-canvas");
    ctx2d = cvs.getContext("2d");

    const notes = chart.notes
      .filter(n => n.t >= startMs - W_GOOD)
      .map(n => ({ t: n.t, lane: n.lane, judged: false, result: null }));

    const LEAD_IN = 1.2;
    const t0 = AudioEngine.now() + LEAD_IN;
    const endMs = Math.max(
      chart.lengthMs || 0,
      notes.length ? notes[notes.length - 1].t + 1500 : 0
    );

    // audio: buffer playback or synthesized backing
    let source = null, sched = null;
    if (audioBuffer) {
      source = AudioEngine.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(AudioEngine.master);
      const off = Math.max(0, startMs / 1000 - (chart.offsetMs || 0) / 1000);
      source.start(t0, off);
    } else {
      const backing = synthBacking(chart.bpm, endMs)
        .filter(e => e.t >= startMs)
        .map(e => ({ ...e, t: e.t - startMs }));
      sched = createScheduler(backing, t0, 0);
    }

    state = {
      chart, notes, t0, startMs, endMs, onExit,
      source, sched,
      score: 0, combo: 0, maxCombo: 0,
      perfect: 0, good: 0, miss: 0,
      popups: [], flashes: [0, 0, 0], particles: [],
      lastNow: -LEAD_IN * 1000,
      finished: false,
    };

    keyHandler = (e) => {
      const k = e.key.toLowerCase();
      if (k === "escape") { abort(); return; }
      if (e.repeat) return;
      const lane = KEY_TO_LANE[k];
      if (lane !== undefined) { e.preventDefault(); hitLane(lane); }
    };
    window.addEventListener("keydown", keyHandler);

    raf = requestAnimationFrame(frame);
  }

  function now() {
    return (AudioEngine.now() - state.t0) * 1000 + state.startMs;
  }

  function hitLane(lane) {
    const t = now();
    state.flashes[lane] = t;
    AudioEngine.play(LANE_INFO[lane].inst, AudioEngine.now() + 0.001);
    // nearest unjudged note in lane
    let best = null, bestDt = Infinity;
    for (const n of state.notes) {
      if (n.lane !== lane || n.judged) continue;
      const dt = t - n.t;
      if (dt > W_GOOD) continue;         // too late (will be judged miss)
      if (dt < -W_EARLY_IGNORE) break;   // too early
      const a = Math.abs(dt);
      if (a < bestDt) { bestDt = a; best = n; }
    }
    if (!best) return;
    best.judged = true;
    if (bestDt <= W_PERFECT) judge(best, "perfect");
    else if (bestDt <= W_GOOD) judge(best, "good");
    else { best.judged = false; return; } // inside early-ignore band: no result
    spawnParticles(lane);
  }

  function judge(note, result) {
    note.result = result;
    if (result === "perfect") { state.perfect++; state.score += 300; state.combo++; }
    else if (result === "good") { state.good++; state.score += 150; state.combo++; }
    else { state.miss++; state.combo = 0; }
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.popups.push({ t: now(), lane: note.lane, text: result });
  }

  function spawnParticles(lane) {
    const cx = W / 2 + LANES_X[lane];
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5;
      state.particles.push({
        x: cx, y: HIT_Y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2,
        life: 1, color: LANE_INFO[lane].color,
      });
    }
  }

  function finish() {
    if (state.finished) return;
    state.finished = true;
    teardown();
    const total = state.perfect + state.good + state.miss;
    const acc = total ? (state.perfect * 300 + state.good * 150) / (total * 300) : 0;
    state.onExit({
      chart: state.chart,
      score: state.score, maxCombo: state.maxCombo,
      perfect: state.perfect, good: state.good, miss: state.miss,
      acc, grade: acc >= 0.95 ? "S" : acc >= 0.85 ? "A" : acc >= 0.7 ? "B" : acc >= 0.5 ? "C" : "D",
    });
  }

  function abort() {
    if (state.finished) return;
    state.finished = true;
    teardown();
    state.onExit(null); // aborted
  }

  function teardown() {
    if (raf) cancelAnimationFrame(raf); raf = null;
    if (keyHandler) window.removeEventListener("keydown", keyHandler);
    keyHandler = null;
    if (state.sched) state.sched.stop();
    if (state.source) { try { state.source.stop(); } catch (e) {} }
  }

  /* ---------------- rendering ---------------- */
  function frame() {
    if (!state || state.finished) return;
    raf = requestAnimationFrame(frame);
    const t = now();
    state.lastNow = t;
    const g = ctx2d;

    // judge misses
    for (const n of state.notes) {
      if (!n.judged && t - n.t > W_LATE_MISS) { n.judged = true; judge(n, "miss"); }
    }
    if (t > state.endMs) { finish(); return; }

    g.clearRect(0, 0, W, H);

    // backdrop
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#171210"); bg.addColorStop(1, "#241811");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    const cx = W / 2;
    drawLanes(g, cx, t);
    drawReceptors(g, cx, t);
    drawNotes(g, cx, t);
    drawDrum(g, cx, t);
    drawParticles(g);
    drawPopups(g, t);
    drawHud(g);
    if (t < 0) drawCountdown(g, t);
  }

  function drawLanes(g, cx, t) {
    for (let i = 0; i < 3; i++) {
      const x = cx + LANES_X[i];
      const flash = Math.max(0, 1 - (t - state.flashes[i]) / 180);
      g.fillStyle = flash > 0
        ? `rgba(${i === 1 ? "232,69,44" : "59,130,212"},${0.10 + flash * 0.18})`
        : "rgba(255,255,255,0.035)";
      roundRect(g, x - LANE_W / 2, 0, LANE_W, HIT_Y + 30, 12); g.fill();
      g.strokeStyle = "rgba(240,180,41,0.12)";
      g.stroke();
    }
    // hit line
    g.strokeStyle = "rgba(240,228,207,0.55)";
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(30, HIT_Y); g.lineTo(W - 30, HIT_Y); g.stroke();
    g.lineWidth = 1;
  }

  function drawReceptors(g, cx, t) {
    for (let i = 0; i < 3; i++) {
      const x = cx + LANES_X[i], info = LANE_INFO[i];
      const flash = Math.max(0, 1 - (t - state.flashes[i]) / 180);
      const r = 30 + flash * 7;
      g.beginPath(); g.arc(x, HIT_Y, r + 5, 0, Math.PI * 2);
      g.strokeStyle = info.color; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.arc(x, HIT_Y, r, 0, Math.PI * 2);
      g.fillStyle = flash > 0 ? info.hi : "#241a14";
      g.fill();
      g.strokeStyle = "rgba(240,228,207,0.35)"; g.lineWidth = 1.5; g.stroke();
      g.lineWidth = 1;
    }
  }

  function drawNotes(g, cx, t) {
    const pxPerMs = (HIT_Y - TOP_Y) / APPROACH_MS;
    for (const n of state.notes) {
      if (n.judged && n.result !== "miss") continue;
      const y = HIT_Y - (n.t - t) * pxPerMs;
      if (y < TOP_Y - 40 || y > HIT_Y + 60) continue;
      const x = cx + LANES_X[n.lane];
      const info = LANE_INFO[n.lane];
      const missed = n.judged && n.result === "miss";
      const r = 24;
      g.globalAlpha = missed ? 0.35 : 1;
      g.beginPath(); g.arc(x, y, r + 4, 0, Math.PI * 2);
      g.fillStyle = "#1a120d"; g.fill();
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      if (n.lane === 1) { // don: solid drum face
        const grad = g.createRadialGradient(x - 7, y - 8, 4, x, y, r);
        grad.addColorStop(0, info.hi); grad.addColorStop(1, info.color);
        g.fillStyle = grad; g.fill();
      } else {          // ka: blue rim ring
        g.fillStyle = "#f2e4cf"; g.fill();
        g.lineWidth = 7; g.strokeStyle = info.color; g.stroke(); g.lineWidth = 1;
      }
      g.globalAlpha = 1;
    }
  }

  function drawDrum(g, cx, t) {
    // taiko body under the receptors
    const flash = Math.max(...state.flashes.map(f => Math.max(0, 1 - (t - f) / 180)));
    const y = 660, r = 62 + flash * 5;
    g.beginPath(); g.arc(cx, y, r, 0, Math.PI * 2);
    const body = g.createRadialGradient(cx - 15, y - 18, 8, cx, y, r);
    body.addColorStop(0, "#f8e8d0"); body.addColorStop(0.7, "#e8d0ae"); body.addColorStop(1, "#c8a878");
    g.fillStyle = body; g.fill();
    g.lineWidth = 9; g.strokeStyle = "#e8452c"; g.stroke();
    g.lineWidth = 3; g.strokeStyle = "#7a1503"; g.stroke();
    g.lineWidth = 1;
    // tacks
    g.fillStyle = "#7a1503";
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.beginPath(); g.arc(cx + Math.cos(a) * (r - 11), y + Math.sin(a) * (r - 11), 2.4, 0, Math.PI * 2); g.fill();
    }
  }

  function drawParticles(g) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life -= 0.03;
      if (p.life <= 0) { state.particles.splice(i, 1); continue; }
      g.globalAlpha = p.life;
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, 3.2, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }

  function drawPopups(g, t) {
    g.textAlign = "center";
    for (let i = state.popups.length - 1; i >= 0; i--) {
      const p = state.popups[i];
      const age = t - p.t;
      if (age > 650) { state.popups.splice(i, 1); continue; }
      const x = W / 2 + LANES_X[p.lane];
      const y = HIT_Y - 70 - age * 0.06;
      g.globalAlpha = 1 - age / 650;
      g.font = "900 22px 'Trebuchet MS', sans-serif";
      g.fillStyle = p.text === "perfect" ? "#f0b429" : p.text === "good" ? "#7ed07a" : "#d05555";
      g.fillText(p.text.toUpperCase(), x, y);
    }
    g.globalAlpha = 1;
  }

  function drawHud(g) {
    const s = state;
    g.textAlign = "left";
    g.font = "700 20px 'Trebuchet MS', sans-serif";
    g.fillStyle = "#f0b429";
    g.fillText(String(s.score).padStart(7, "0"), 18, 34);
    if (s.combo >= 2) {
      g.textAlign = "center";
      g.font = "900 34px 'Trebuchet MS', sans-serif";
      g.fillStyle = "#f2e4cf";
      g.fillText(s.combo, W / 2, 200);
      g.font = "700 12px 'Trebuchet MS', sans-serif";
      g.fillStyle = "#9b8a76";
      g.fillText("COMBO", W / 2, 216);
      g.textAlign = "left";
    }
    // progress bar
    const prog = Math.min(1, Math.max(0, s.lastNow / s.endMs));
    g.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(g, 18, 46, W - 36, 5, 3); g.fill();
    g.fillStyle = "#e8452c";
    roundRect(g, 18, 46, (W - 36) * prog, 5, 3); g.fill();
  }

  function drawCountdown(g, t) {
    g.textAlign = "center";
    g.font = "900 64px 'Trebuchet MS', sans-serif";
    g.fillStyle = "#f0b429";
    g.globalAlpha = Math.min(1, -t / 400);
    g.fillText("READY…", W / 2, H / 2);
    g.globalAlpha = 1;
    g.textAlign = "left";
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  return { start, abort };
})();
