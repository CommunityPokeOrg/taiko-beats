/* Taiko Beats — chart format, built-in generated beatmaps, backing-track
   pattern generation. Shared by the game and the editor.

   Chart JSON format:
   {
     "format": "taiko-beats/1",
     "name": "Song name",
     "bpm": 120,
     "offsetMs": 0,          // shifts note times vs audio (+ = notes later)
     "lengthMs": 60000,      // song length
     "audio": "synth" | "file",
     "lanes": 3,             // 0 = left ka, 1 = don, 2 = right ka
     "notes": [{ "t": 1000, "lane": 1 }, ...]   // t in ms
   }
*/
"use strict";

const LANES = { KA_L: 0, DON: 1, KA_R: 2 };
const LANE_INFO = [
  { name: "Left Rim",  inst: "ka",  color: "#3b82d6", hi: "#7ab3f0", keys: ["d", "arrowleft"] },
  { name: "Drum",      inst: "don", color: "#e8452c", hi: "#ff7a55", keys: ["f", "arrowdown"] },
  { name: "Right Rim", inst: "ka",  color: "#3b82d6", hi: "#7ab3f0", keys: ["j", "arrowright"] },
];

function msPerBeat(bpm) { return 60000 / bpm; }

/* ---- note-list builder helpers -------------------------------------- */
function buildNotes(bpm, steps) {
  // steps: [[beat, lane], ...] -> sorted notes
  const mpb = msPerBeat(bpm);
  return steps
    .map(([beat, lane]) => ({ t: Math.round(beat * mpb), lane }))
    .sort((a, b) => a.t - b.t);
}

/* Synth backing-track pattern (kick / snare / hat) for a chart. */
function synthBacking(bpm, lengthMs) {
  const mpb = msPerBeat(bpm);
  const beats = Math.floor(lengthMs / mpb);
  const ev = [];
  for (let b = 0; b < beats; b++) {
    const t = b * mpb;
    ev.push({ t, inst: "kick", vol: b % 4 === 0 ? 1 : 0.85 });
    ev.push({ t: t + mpb * 0.5, inst: "hat", vol: 0.7 });
    ev.push({ t: t + mpb * 0.25, inst: "hat", vol: 0.45 });
    ev.push({ t: t + mpb * 0.75, inst: "hat", vol: 0.45 });
    if (b % 4 === 2) ev.push({ t, inst: "snare", vol: 0.9 });
  }
  return ev.sort((a, b) => a.t - b.t);
}

/* ================= built-in song 1: Festival Beat (96 BPM) ============= */
function chartFestival() {
  const bpm = 96;
  const s = [];
  const D = LANES.DON, L = LANES.KA_L, R = LANES.KA_R;
  // 2-bar intro (beats 0-7) then 7 phrases of 4 beats
  const phrases = [
    [[0,D],[1,D],[2,L],[3,D]],
    [[0,D],[1,R],[2,D],[3,L]],
    [[0,D],[0.5,D],[1,L],[2,D],[3,R]],
    [[0,L],[1,R],[2,L],[3,R]],
    [[0,D],[1,D],[1.5,L],[2,D],[3,D]],
    [[0,L],[0.5,R],[1,L],[1.5,R],[2,D],[3,D]],
    [[0,D],[1,D],[2,D],[2.5,L],[2.75,R],[3,D],[3.5,L],[3.75,R]],
  ];
  let beat = 8;
  for (let rep = 0; rep < 2; rep++)
    for (const ph of phrases) {
      for (const [b, lane] of ph) s.push([beat + b, lane]);
      beat += 4;
    }
  // outro roll feel
  for (const [b, lane] of [[0,D],[0.5,L],[1,R],[1.5,D],[2,L],[2.5,R],[3,D]]) s.push([beat + b, lane]);
  const lengthMs = (beat + 8) * msPerBeat(bpm);
  return {
    format: "taiko-beats/1", name: "Festival Beat", bpm, offsetMs: 0,
    lengthMs: Math.round(lengthMs), audio: "synth", lanes: 3,
    notes: buildNotes(bpm, s),
    desc: "96 BPM · warm-up groove",
  };
}

/* ================= built-in song 2: Thunder Roll (150 BPM) ============= */
function chartThunder() {
  const bpm = 150;
  const s = [];
  const D = LANES.DON, L = LANES.KA_L, R = LANES.KA_R;
  const phrases = [
    [[0,D],[0.5,D],[1,L],[1.5,R],[2,D],[2.5,D],[3,L],[3.5,R]],
    [[0,L],[0.25,L],[0.5,R],[0.75,R],[1,D],[2,D],[2.5,L],[3,R]],
    [[0,D],[1,D],[1.5,D],[2,L],[2.25,L],[2.5,R],[2.75,R],[3,D]],
    [[0,L],[0.5,R],[1,D],[1.5,L],[2,R],[2.5,D],[3,L],[3.5,R]],
    // drum roll: alternating ka 16ths for a bar
    [[0,L],[0.25,R],[0.5,L],[0.75,R],[1,L],[1.25,R],[1.5,L],[1.75,R],[2,L],[2.25,R],[2.5,L],[2.75,R],[3,D],[3.5,D]],
    [[0,D],[0.5,L],[1,D],[1.5,R],[2,D],[2.5,L],[2.75,R],[3,D],[3.25,D],[3.5,D],[3.75,D]],
  ];
  let beat = 8;
  for (let rep = 0; rep < 3; rep++)
    for (const ph of phrases) {
      for (const [b, lane] of ph) s.push([beat + b, lane]);
      beat += 4;
    }
  // finale
  for (const [b, lane] of [[0,D],[0.5,L],[0.75,R],[1,D],[1.5,L],[1.75,R],[2,D],[2.5,L],[2.75,R],[3,D],[3.25,L],[3.5,R],[3.75,D]]) s.push([beat + b, lane]);
  const lengthMs = (beat + 8) * msPerBeat(bpm);
  return {
    format: "taiko-beats/1", name: "Thunder Roll", bpm, offsetMs: 0,
    lengthMs: Math.round(lengthMs), audio: "synth", lanes: 3,
    notes: buildNotes(bpm, s),
    desc: "150 BPM · streams & a full-bar roll",
  };
}

const BUILTIN_CHARTS = [chartFestival(), chartThunder()];

/* ---- chart utilities shared with the editor -------------------------- */
function sanitizeChart(raw) {
  const c = {
    format: "taiko-beats/1",
    name: String(raw.name || "Untitled").slice(0, 64),
    bpm: Math.min(300, Math.max(40, Number(raw.bpm) || 120)),
    offsetMs: Math.round(Number(raw.offsetMs) || 0),
    lengthMs: Math.max(5000, Math.round(Number(raw.lengthMs) || 60000)),
    audio: raw.audio === "file" ? "file" : "synth",
    lanes: 3,
    notes: (Array.isArray(raw.notes) ? raw.notes : [])
      .filter(n => n && n.lane >= 0 && n.lane <= 2 && isFinite(n.t) && n.t >= 0)
      .map(n => ({ t: Math.round(n.t), lane: n.lane | 0 }))
      .sort((a, b) => a.t - b.t),
  };
  if (raw.desc) c.desc = String(raw.desc).slice(0, 80);
  return c;
}
